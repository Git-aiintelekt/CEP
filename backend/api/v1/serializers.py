import re

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from apps.campaigns.models import Campaign, CampaignRun, ContactListCampaign
from apps.delivery.models import SenderProfile
from apps.media.models import MediaAsset
from apps.contact_lists.models import ContactList
from apps.journeys.models import Journey
from apps.templates.models import PersonalizationTag, TemplateMaster

AUDIT_FIELDS = ("tenant", "created_by", "updated_by", "created_at", "updated_at", "deleted_at", "row_version")


class TenantModelSerializer(serializers.ModelSerializer):
    """Audit / tenant columns are read-only everywhere: the API layer stamps them, the database maintains them."""
    class Meta:
        read_only_fields = AUDIT_FIELDS

    def get_fields(self):
        fields = super().get_fields()
        for name in AUDIT_FIELDS:
            if name in fields:
                fields[name].read_only = True
        return fields


class CampaignRunSerializer(TenantModelSerializer):
    class Meta(TenantModelSerializer.Meta):
        model = CampaignRun
        fields = "__all__"


class SenderProfileSerializer(serializers.ModelSerializer):
    provider_type = serializers.CharField(source="delivery_provider.provider_type", read_only=True)
    provider_name = serializers.CharField(source="delivery_provider.name", read_only=True)

    class Meta:
        model = SenderProfile
        fields = ("id", "display_name", "channel", "from_address", "reply_to_address", "sender_id", "verification_status", "is_default", "provider_type", "provider_name")
        read_only_fields = fields


class AttachedContactListSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactList
        fields = ("id", "name", "list_kind", "is_master", "list_environment", "status", "member_count")
        read_only_fields = fields


CAMPAIGN_CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,39}$")            # == ck_campaign_code_format
TEMPLATE_CHANNELS = {"EMAIL": {"EMAIL", "E_RECEIPT"}, "SMS": {"SMS"}, "MMS": {"MMS"}, "MULTI": {"EMAIL", "E_RECEIPT", "SMS", "MMS"}}
SENDER_CHANNELS = {"EMAIL": {"EMAIL"}, "SMS": {"SMS"}, "MMS": {"MMS", "SMS"}, "MULTI": {"EMAIL", "SMS", "MMS"}}
WITH_LISTS = ("campaign_runs", "contact_list_campaigns__contact_list")


class CampaignSerializer(TenantModelSerializer):
    runs = CampaignRunSerializer(source="campaign_runs", many=True, read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    template_name = serializers.CharField(source="template.name", read_only=True, allow_null=True)
    sender_profile_name = serializers.CharField(source="sender_profile.display_name", read_only=True, allow_null=True)
    code = serializers.CharField(max_length=40, required=False, allow_blank=True,
                                 help_text="Business key, e.g. CMP-2026-0042. Generated when left blank.")
    contact_lists = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True,
                                          help_text="IDs of the source contact lists (replaces the current set).")
    contact_list_details = serializers.SerializerMethodField()

    class Meta(TenantModelSerializer.Meta):
        model = Campaign
        fields = "__all__"
        read_only_fields = AUDIT_FIELDS + ("status", "is_journey_generated", "origin_journey", "owner_user", "legacy_marketing_campaign_id")

    # ---- representation
    @staticmethod
    def _attached(campaign):
        return [link.contact_list for link in campaign.contact_list_campaigns.all()]

    def get_contact_list_details(self, campaign) -> list[dict]:
        return AttachedContactListSerializer(self._attached(campaign), many=True).data

    def to_representation(self, campaign):
        data = super().to_representation(campaign)
        data["contact_lists"] = [str(item.id) for item in self._attached(campaign)]
        return data

    # ---- validation (mirrors the CHECK constraints so the client gets field errors, not a 500)
    def validate_name(self, value):
        value = value.strip()
        if len(value) < 3:
            raise serializers.ValidationError("Use at least 3 characters.")
        return value

    def validate_code(self, value):
        value = (value or "").strip().upper()
        if not value:
            return ""
        if not CAMPAIGN_CODE_RE.match(value):
            raise serializers.ValidationError("3 to 40 characters: capital letters, digits, hyphen or underscore, starting with a letter or digit.")
        clash = Campaign.objects.filter(code=value)               # RLS keeps this inside the tenant; soft-deleted codes stay reserved
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("Another campaign already uses this code.")
        return value

    def validate_campaign_type(self, value):
        current = getattr(self.instance, "campaign_type", None)
        if value == "JOURNEY" and current != "JOURNEY":
            raise serializers.ValidationError("Journey campaigns are generated by a journey and cannot be created by hand.")
        return value

    def validate_scheduled_at(self, value):
        unchanged = self.instance is not None and self.instance.scheduled_at == value
        if value is not None and not unchanged and value <= timezone.now():
            raise serializers.ValidationError("Choose a time in the future.")
        return value

    def validate(self, attrs):
        def current(name):
            return attrs[name] if name in attrs else getattr(self.instance, name, None)

        errors = {}
        channel, ctype = current("channel"), current("campaign_type")
        template, sender = current("template"), current("sender_profile")

        if ctype == "E_RECEIPT":
            if channel != "EMAIL":
                errors["channel"] = "E-receipt campaigns are sent by email."
            if (current("solicitation_type") or "MARKETING") != "TRANSACTIONAL":
                errors["solicitation_type"] = "E-receipts are transactional messages."
        if template is not None:
            if template.deleted_at is not None or template.status == "ARCHIVED":
                errors["template"] = "This template is archived."
            elif ctype == "E_RECEIPT" and template.channel != "E_RECEIPT":
                errors["template"] = "E-receipt campaigns need an e-receipt template."
            elif channel and template.channel not in TEMPLATE_CHANNELS.get(channel, set()):
                errors["template"] = f"A {template.get_channel_display()} template cannot be used for a {channel} campaign."
        if sender is not None:
            if sender.deleted_at is not None:
                errors["sender_profile"] = "This sender profile no longer exists."
            elif channel and sender.channel not in SENDER_CHANNELS.get(channel, set()):
                errors["sender_profile"] = f"A {sender.get_channel_display()} sender cannot be used for a {channel} campaign."

        if "contact_lists" in attrs:
            ids = list(dict.fromkeys(attrs["contact_lists"]))                       # de-duplicate, keep order
            found = {item.id: item for item in ContactList.objects.filter(id__in=ids, deleted_at__isnull=True)}
            missing = [str(i) for i in ids if i not in found]
            inactive = [found[i].name for i in ids if i in found and found[i].status != "ACTIVE"]
            if missing:
                errors["contact_lists"] = f"Unknown contact list: {', '.join(missing)}"
            elif inactive:
                errors["contact_lists"] = f"Not active: {', '.join(inactive)}"
            attrs["contact_lists"] = [found[i] for i in ids if i in found]

        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    # ---- persistence
    @staticmethod
    def _next_code():
        prefix = f"CMP-{timezone.now():%Y}-"
        taken = set(Campaign.objects.filter(code__startswith=prefix).values_list("code", flat=True))
        number = len(taken) + 1
        while f"{prefix}{number:04d}" in taken:
            number += 1
        return f"{prefix}{number:04d}"

    @staticmethod
    def _set_lists(campaign, lists):
        keep = {item.id for item in lists}
        ContactListCampaign.objects.filter(campaign=campaign).exclude(contact_list_id__in=keep).delete()
        existing = set(ContactListCampaign.objects.filter(campaign=campaign).values_list("contact_list_id", flat=True))
        ContactListCampaign.objects.bulk_create(
            [ContactListCampaign(campaign=campaign, contact_list=item, tenant_id=campaign.tenant_id) for item in lists if item.id not in existing])

    def create(self, validated_data):
        lists = validated_data.pop("contact_lists", [])
        generated = not validated_data.get("code")
        campaign = None
        for attempt in range(5):
            if generated:
                validated_data["code"] = self._next_code()
            try:
                with transaction.atomic():                         # savepoint: a code collision must not poison the request transaction
                    campaign = Campaign.objects.create(**validated_data)
                break
            except IntegrityError:
                if not generated or attempt == 4:
                    raise serializers.ValidationError({"code": "Another campaign already uses this code."}) from None
        self._set_lists(campaign, lists)
        return Campaign.objects.prefetch_related(*WITH_LISTS).get(pk=campaign.pk)

    def update(self, campaign, validated_data):
        lists = validated_data.pop("contact_lists", None)
        if "code" in validated_data and not validated_data["code"]:
            validated_data.pop("code")                             # blank on edit = keep the current code
        for name, value in validated_data.items():
            setattr(campaign, name, value)
        if validated_data:
            campaign.save(update_fields=list(validated_data))
        if lists is not None:
            self._set_lists(campaign, lists)
        # row_version / updated_at are maintained by the database trigger: return what is actually stored
        return Campaign.objects.prefetch_related(*WITH_LISTS).get(pk=campaign.pk)


class TemplateStarterSerializer(serializers.Serializer):
    key = serializers.CharField()
    name = serializers.CharField()
    channel = serializers.CharField()
    category = serializers.CharField()
    description = serializers.CharField()
    subject_line = serializers.CharField(allow_blank=True)
    preheader = serializers.CharField(allow_blank=True)
    html_content = serializers.CharField(allow_null=True, help_text="rendered preview for EMAIL / E_RECEIPT starters")
    sms_body = serializers.CharField(allow_null=True, help_text="text for SMS / MMS starters")


class TemplateSerializer(TenantModelSerializer):
    latest_version = serializers.IntegerField(read_only=True, default=0, help_text="0 until a design has been saved")
    starter = serializers.CharField(write_only=True, required=False, allow_blank=True,
                                    help_text="on create: key from /template-starters/; its content becomes version 1")

    def validate(self, attrs):
        from apps.templates import starters
        key = attrs.get("starter")
        if key:
            if self.instance is not None:
                raise serializers.ValidationError({"starter": "A starter can only be chosen when the template is created."})
            starter = starters.BY_KEY.get(key)
            if starter is None:
                raise serializers.ValidationError({"starter": "Unknown starter."})
            if starter["channel"] != attrs.get("channel"):
                raise serializers.ValidationError({"starter": f"The {starter['name']} starter is for {starter['channel']} templates."})
        return attrs

    def create(self, validated_data):
        from apps.templates import starters
        key = validated_data.pop("starter", "")
        template = super().create(validated_data)
        if key:
            starters.apply(template, validated_data.get("created_by_id"), key)
            template.latest_version = 1
        return template

    def update(self, instance, validated_data):
        validated_data.pop("starter", None)
        return super().update(instance, validated_data)

    class Meta(TenantModelSerializer.Meta):
        model = TemplateMaster
        fields = "__all__"
        read_only_fields = AUDIT_FIELDS + ("status", "cloned_from", "legacy_template_id")

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 3:
            raise serializers.ValidationError("Use at least 3 characters.")
        clash = TemplateMaster.objects.filter(name__iexact=value, deleted_at__isnull=True)      # == ux_template_master_name_live
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("Another template already has this name.")
        return value

    def validate_channel(self, value):
        from apps.platform_ops import params
        from apps.tenants import context
        feature = params.CHANNEL_FEATURE.get(value)
        if self.instance is None and feature and not params.enabled(context.require().tenant_id, feature):
            raise serializers.ValidationError(f"{params.FEATURES[feature]['name']} is not part of this workspace.")
        if self.instance is not None and self.instance.channel != value:
            raise serializers.ValidationError("The channel of an existing template cannot be changed. Create a new template instead.")
        return value


class DesignSaveSerializer(serializers.Serializer):
    editor_state = serializers.JSONField(help_text="GrapesJS project data (editor.getProjectData())")
    mjml_source = serializers.CharField(trim_whitespace=False, help_text="MJML produced by the editor; the server renders the HTML from it")
    subject_line = serializers.CharField(max_length=300, allow_blank=True, default="")
    preheader = serializers.CharField(max_length=300, allow_blank=True, default="")
    base_version = serializers.IntegerField(min_value=0, help_text="version the editor loaded; a newer stored version answers 409")

    def validate_editor_state(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Expected the GrapesJS project object.")
        return value


class DesignFindingsSerializer(serializers.Serializer):
    tags_used = serializers.ListField(child=serializers.CharField())
    unknown_tags = serializers.ListField(child=serializers.CharField())
    missing_unsubscribe = serializers.BooleanField()
    missing_subject = serializers.BooleanField()
    html_bytes = serializers.IntegerField()
    may_be_clipped = serializers.BooleanField()


class DesignSerializer(serializers.Serializer):
    template = serializers.UUIDField()
    version_number = serializers.IntegerField()
    latest_version = serializers.IntegerField()
    editor_state = serializers.JSONField(allow_null=True)
    mjml_source = serializers.CharField(allow_null=True)
    html_content = serializers.CharField(allow_null=True)
    text_content = serializers.CharField(allow_null=True)
    subject_line = serializers.CharField(allow_blank=True)
    preheader = serializers.CharField(allow_blank=True)
    saved_at = serializers.DateTimeField(allow_null=True)
    saved_by = serializers.CharField(allow_null=True)
    findings = DesignFindingsSerializer(required=False)


class DesignVersionSerializer(serializers.Serializer):
    version_number = serializers.IntegerField()
    saved_at = serializers.DateTimeField()
    saved_by = serializers.CharField(allow_null=True)


class MessageSaveSerializer(serializers.Serializer):
    sms_body = serializers.CharField(trim_whitespace=False, allow_blank=True, help_text="message text with {{tags}}")
    subject_line = serializers.CharField(max_length=80, allow_blank=True, default="", help_text="MMS only")
    media_asset = serializers.UUIDField(allow_null=True, default=None, help_text="MMS only: id of an uploaded image")
    base_version = serializers.IntegerField(min_value=0, help_text="version the editor loaded; a newer stored version answers 409")


class MessageFindingsSerializer(serializers.Serializer):
    encoding = serializers.ChoiceField(choices=["GSM-7", "UCS-2"])
    units = serializers.IntegerField(help_text="billable characters of the text with sample values filled in")
    segments = serializers.IntegerField()
    per_segment = serializers.IntegerField()
    non_gsm_characters = serializers.ListField(child=serializers.CharField())
    estimated = serializers.BooleanField()
    tags_used = serializers.ListField(child=serializers.CharField())
    unknown_tags = serializers.ListField(child=serializers.CharField())
    wrong_channel_tags = serializers.ListField(child=serializers.CharField())
    missing_opt_out = serializers.BooleanField()
    long_message = serializers.BooleanField()
    has_link = serializers.BooleanField()
    missing_media = serializers.BooleanField()
    media_bytes = serializers.IntegerField(allow_null=True)
    media_heavy = serializers.BooleanField()


class MessageSerializer(serializers.Serializer):
    template = serializers.UUIDField()
    channel = serializers.CharField()
    version_number = serializers.IntegerField()
    latest_version = serializers.IntegerField()
    sms_body = serializers.CharField(allow_blank=True)
    subject_line = serializers.CharField(allow_blank=True)
    media_asset = serializers.DictField(allow_null=True)
    saved_at = serializers.DateTimeField(allow_null=True)
    saved_by = serializers.CharField(allow_null=True)
    findings = MessageFindingsSerializer()


class MediaAssetSerializer(serializers.ModelSerializer):
    url = serializers.CharField(source="public_url", read_only=True)

    class Meta:
        model = MediaAsset
        fields = ("id", "file_name", "mime_type", "byte_size", "width_px", "height_px", "url", "created_at")
        read_only_fields = fields


class PersonalizationTagSerializer(TenantModelSerializer):
    class Meta(TenantModelSerializer.Meta):
        model = PersonalizationTag
        fields = "__all__"


class MePrincipalSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["user", "api_client"])
    id = serializers.CharField(required=False)
    email = serializers.EmailField(required=False)
    display_name = serializers.CharField(required=False)
    name = serializers.CharField(required=False)
    is_staff = serializers.BooleanField(required=False)
    is_platform_admin = serializers.BooleanField(required=False)
    permissions = serializers.ListField(child=serializers.CharField(), required=False)
    scopes = serializers.ListField(child=serializers.CharField(), required=False)


class MeTenantSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    code = serializers.CharField()
    timezone = serializers.CharField()
    db_alias = serializers.CharField()
    db_status = serializers.CharField()


class MeSessionSerializer(serializers.Serializer):
    """How long the browser waits before warning of inactivity, and how long the warning stays up before signing out.
    Global parameters (security.idle_timeout_minutes, security.idle_warning_seconds): change them without a deployment."""
    idle_timeout_minutes = serializers.IntegerField(help_text="Minutes of no activity in the browser before the warning appears")
    idle_warning_seconds = serializers.IntegerField(help_text="Seconds the warning stays up before the session ends")


class MeSerializer(serializers.Serializer):
    principal = MePrincipalSerializer()
    tenant = MeTenantSerializer()
    industry = serializers.CharField()
    features = serializers.DictField(child=serializers.BooleanField(), help_text="feature code -> enabled for this workspace")
    terminology = serializers.DictField(child=serializers.CharField())
    mfa_setup_required = serializers.BooleanField()
    support_session = serializers.DictField(allow_null=True)
    session = MeSessionSerializer()


class JourneySerializer(TenantModelSerializer):
    class Meta(TenantModelSerializer.Meta):
        model = Journey
        fields = "__all__"
        read_only_fields = AUDIT_FIELDS + ("status", "current_version")
