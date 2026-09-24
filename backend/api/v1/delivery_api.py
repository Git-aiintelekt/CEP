"""Delivery settings for a workspace: providers (Postal, SendGrid, ... one adapter each), senders, test sends, run results."""
from django.conf import settings
from django.core import signing
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.campaigns.models import Campaign, CampaignRun
import re

from apps.delivery.engine import dispatch, dispatch_sms, receipts, runs
from apps.delivery.models import DeliveryProvider, SenderProfile
from apps.delivery.providers import EmailMessage, Outcome, ProviderError, SmsMessage, registry
from apps.platform_ops import crypto, params
from apps.tenants import context

WEBHOOK_SALT = "cep.delivery.webhook"
E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")
SENDER_ID = re.compile(r"^(\+[1-9][0-9]{7,14}|[0-9]{3,8}|[A-Za-z0-9 ]{3,11})$")          # long number, short code, alphanumeric sender
MANAGE = [IsAuthenticated, SameTenant, HasPermissionCode.for_("provider.edit")]


def webhook_token(provider_id) -> str:
    return signing.Signer(salt=WEBHOOK_SALT).signature(str(provider_id))[:32]


def webhook_url(tenant_code: str, provider_id) -> str:
    return f"{params.public_api_url()}/api/v1/webhooks/delivery/{tenant_code}/{provider_id}/{webhook_token(provider_id)}/"


# ------------------------------------------------------------------------------------------------------------ providers
class DeliveryProviderSerializer(serializers.ModelSerializer):
    channel = serializers.CharField(read_only=True)
    secret = serializers.CharField(write_only=True, required=False, allow_blank=True, help_text="API key; leave blank to keep the stored one")
    has_secret = serializers.SerializerMethodField()
    webhook_url = serializers.SerializerMethodField()
    sender_count = serializers.SerializerMethodField()

    class Meta:
        model = DeliveryProvider
        fields = ("id", "provider_type", "channel", "name", "config", "secret", "has_secret", "secret_ref", "rate_limit_per_minute", "is_default", "is_active",
                  "webhook_url", "sender_count", "last_checked_at", "last_check_ok", "last_check_error", "row_version")
        read_only_fields = ("channel", "last_checked_at", "last_check_ok", "last_check_error", "row_version")

    def get_has_secret(self, provider) -> bool:
        return bool(provider.secret_enc or provider.secret_ref)

    def get_webhook_url(self, provider) -> str | None:
        cls = registry.adapter_class(provider.provider_type) if provider.provider_type in {c["provider_type"] for c in registry.catalogue()} else None
        return webhook_url(self.context["tenant_code"], provider.pk) if cls is not None and cls.supports_webhooks else None

    def get_sender_count(self, provider) -> int:
        return provider.sender_profiles.filter(deleted_at__isnull=True).count() if hasattr(provider, "sender_profiles") else \
            SenderProfile.objects.filter(delivery_provider=provider, deleted_at__isnull=True).count()

    def validate_secret_ref(self, value):
        value = (value or "").strip()
        if value and not value.startswith("env:"):
            raise serializers.ValidationError("Use env:NAME to read the credential from an environment variable, or enter it in the API key field.")
        return value or None

    def validate(self, attrs):
        provider_type = attrs.get("provider_type", getattr(self.instance, "provider_type", None))
        if self.instance is not None and "provider_type" in attrs and attrs["provider_type"] != self.instance.provider_type:
            raise serializers.ValidationError({"provider_type": "The type of a provider cannot be changed. Add a new provider instead."})
        try:
            cls = registry.adapter_class(provider_type)
        except ProviderError:
            raise serializers.ValidationError({"provider_type": "No adapter is installed for this provider type."}) from None
        if not cls.manageable and self.instance is None:
            raise serializers.ValidationError({"provider_type": "This provider is switched on from Settings -> Email server."})
        config = {**(getattr(self.instance, "config", None) or {}), **(attrs.get("config") or {})}
        config = {k: (v.strip() if isinstance(v, str) else v) for k, v in config.items() if k in {f.key for f in cls.config_fields if not f.secret}}
        has_secret = bool(attrs.get("secret") or attrs.get("secret_ref") or getattr(self.instance, "secret_enc", None) or getattr(self.instance, "secret_ref", None))
        errors = cls.validate_config(config, has_secret)
        if errors:
            secret_keys = {f.key for f in cls.config_fields if f.secret}
            raise serializers.ValidationError({("secret" if key in secret_keys else f"config.{key}"): message for key, message in errors.items()})
        attrs["config"] = config
        return attrs


class DeliveryProviderViewSet(viewsets.ModelViewSet):
    """Email delivery providers of the workspace. Each type is an adapter in apps/delivery/providers; `catalogue` lists
    the installed ones with the fields their form needs."""
    queryset = DeliveryProvider.objects.none()              # for the OpenAPI schema; requests use get_queryset()
    serializer_class = DeliveryProviderSerializer
    permission_classes = MANAGE
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return DeliveryProvider.objects.filter(tenant_id=context.require().tenant_id, deleted_at__isnull=True).order_by("channel", "name")

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "tenant_code": self.request.tenant["code"]}

    @extend_schema(responses={200: None})
    @action(detail=False, methods=["get"])
    def catalogue(self, request, version=None):
        return Response(registry.catalogue())

    def _save(self, serializer, **extra):
        secret = serializer.validated_data.pop("secret", "")
        if secret:
            extra["secret_enc"] = crypto.encrypt(secret)
        tenant_id = context.require().tenant_id
        channel = extra.get("channel") or serializer.instance.channel
        if serializer.validated_data.get("is_default"):                     # one default engine per channel
            DeliveryProvider.objects.filter(tenant_id=tenant_id, channel=channel, is_default=True).exclude(pk=getattr(serializer.instance, "pk", None)).update(is_default=False)
        return serializer.save(**extra)

    def perform_create(self, serializer):
        tenant_id = context.require().tenant_id
        if DeliveryProvider.objects.filter(tenant_id=tenant_id, name=serializer.validated_data["name"]).exists():
            raise ValidationError({"name": "A provider with this name already exists (or existed). Choose another name."})
        channel = registry.adapter_class(serializer.validated_data["provider_type"]).channel          # EMAIL, or SMS for text engines (they carry MMS too)
        self._save(serializer, tenant_id=tenant_id, channel=channel, created_by_id=self.request.user.pk)

    def perform_update(self, serializer):
        self._save(serializer, updated_by_id=self.request.user.pk)

    def perform_destroy(self, provider):
        if registry.adapter_class(provider.provider_type).manageable is False:
            raise Conflict("This provider belongs to Settings -> Email server. Switch 'Offer as a campaign sender' off there.")
        if Campaign.objects.filter(tenant_id=provider.tenant_id, sender_profile__delivery_provider=provider, status__in=["PRODUCTION_PUBLISHED", "ACTIVE"]).exists():
            raise Conflict("A published campaign is sending through this provider. Wait until it has finished, or choose another sender for it.")
        now = timezone.now()
        SenderProfile.objects.filter(delivery_provider=provider, deleted_at__isnull=True).update(deleted_at=now, is_default=False)
        DeliveryProvider.objects.filter(pk=provider.pk).update(deleted_at=now, is_default=False, is_active=False, name=f"{provider.name} (removed {now:%Y-%m-%d %H:%M:%S})"[:150])

    @extend_schema(request=None, responses={200: None})
    @action(detail=True, methods=["post"])
    def check(self, request, pk=None, version=None):
        """Validates the address and credential with the provider, without sending anything."""
        provider = self.get_object()
        try:
            ok, detail = registry.for_provider(provider).check()
        except ProviderError as exc:
            ok, detail = False, str(exc)
        DeliveryProvider.objects.filter(pk=provider.pk).update(last_checked_at=timezone.now(), last_check_ok=ok, last_check_error=detail or None)
        return Response({"ok": ok, "detail": detail or None})


# ------------------------------------------------------------------------------------------------------------ senders
class SenderProfileWriteSerializer(serializers.ModelSerializer):
    channel = serializers.CharField(read_only=True)
    provider_type = serializers.CharField(source="delivery_provider.provider_type", read_only=True)
    provider_name = serializers.CharField(source="delivery_provider.name", read_only=True)

    class Meta:
        model = SenderProfile
        fields = ("id", "delivery_provider", "display_name", "channel", "from_address", "reply_to_address", "sender_id", "verification_status", "is_default",
                  "provider_type", "provider_name")
        read_only_fields = ("channel", "verification_status")
        extra_kwargs = {"from_address": {"required": False, "allow_null": True, "allow_blank": True}, "sender_id": {"required": False, "allow_null": True, "allow_blank": True}}

    def validate_delivery_provider(self, provider):
        if str(provider.tenant_id) != context.require().tenant_id or provider.deleted_at is not None:
            raise serializers.ValidationError("Choose one of this workspace's providers.")
        if not registry.adapter_class(provider.provider_type).manageable:
            raise serializers.ValidationError("Senders of the workspace mail server are managed under Settings -> Email server.")
        return provider

    def validate_from_address(self, value):
        value = (value or "").strip().lower()
        if value:
            serializers.EmailField().run_validation(value)
        return value or None

    def validate(self, attrs):
        provider = attrs.get("delivery_provider") or getattr(self.instance, "delivery_provider", None)
        current = lambda name: attrs.get(name, getattr(self.instance, name, None))         # noqa: E731
        if provider is not None and registry.adapter_class(provider.provider_type).channel == "SMS":
            sender_id = (current("sender_id") or "").strip()
            if not SENDER_ID.match(sender_id):
                raise serializers.ValidationError({"sender_id": "Enter the number texts come from: a long number (+14045550100), a short code (55123) or an alphanumeric sender (up to 11 characters)."})
            attrs.update(sender_id=sender_id, from_address=None, reply_to_address=None)
        else:
            if not current("from_address"):
                raise serializers.ValidationError({"from_address": "Enter the address email comes from."})
            attrs["sender_id"] = None
        return attrs

    def validate_reply_to_address(self, value):
        value = (value or "").strip().lower()
        if value:
            serializers.EmailField().run_validation(value)
        return value or None


class SenderProfileManageViewSet(viewsets.ModelViewSet):
    """Create and verify senders. Campaigns read them through /sender-profiles/ (permission campaign.edit)."""
    queryset = SenderProfile.objects.none()                 # for the OpenAPI schema; requests use get_queryset()
    serializer_class = SenderProfileWriteSerializer
    permission_classes = MANAGE
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return SenderProfile.objects.filter(tenant_id=context.require().tenant_id, deleted_at__isnull=True).select_related("delivery_provider").order_by("channel", "display_name")

    def _default(self, serializer, channel):
        if serializer.validated_data.get("is_default"):
            SenderProfile.objects.filter(tenant_id=context.require().tenant_id, channel=channel, is_default=True).exclude(pk=getattr(serializer.instance, "pk", None)).update(is_default=False)

    def perform_create(self, serializer):
        channel = registry.adapter_class(serializer.validated_data["delivery_provider"].provider_type).channel
        self._default(serializer, channel)
        serializer.save(tenant_id=context.require().tenant_id, channel=channel, verification_status="PENDING", created_by_id=self.request.user.pk)

    def perform_update(self, serializer):
        self._default(serializer, serializer.instance.channel)
        changed_address = any(name in serializer.validated_data and serializer.validated_data[name] != getattr(serializer.instance, name) for name in ("from_address", "sender_id"))
        if registry.adapter_class(serializer.instance.delivery_provider.provider_type).manageable is False:
            raise Conflict("This sender follows Settings -> Email server. Change it there.")
        serializer.save(updated_by_id=self.request.user.pk, **({"verification_status": "PENDING"} if changed_address else {}))

    def perform_destroy(self, sender):
        if registry.adapter_class(sender.delivery_provider.provider_type).manageable is False:
            raise Conflict("This sender follows Settings -> Email server. Switch 'Offer as a campaign sender' off there.")
        SenderProfile.objects.filter(pk=sender.pk).update(deleted_at=timezone.now(), is_default=False)

    @extend_schema(request=inline_serializer("SenderVerify", {"to": serializers.EmailField(required=False)}), responses={200: None})
    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None, version=None):
        """Sends a real message from this address through its provider. Accepted by the provider = verified for publishing."""
        sender = self.get_object()
        texts = registry.adapter_class(sender.delivery_provider.provider_type).channel == "SMS"
        to = str(request.data.get("to") or ("" if texts else getattr(request.user, "email", "")) or "").strip()
        if texts and not E164.match(to):
            raise ValidationError({"to": "Enter the mobile number the verification text should go to, with country code: +14045550100."})
        if not to:
            raise ValidationError({"to": "Enter the address the test message should go to."})
        try:
            with registry.for_provider(sender.delivery_provider) as provider:
                result = provider.send(SmsMessage(to_number=to, from_sender=sender.sender_id or "", tag="verification",
                                                  text=f"{settings.EMAIL_PRODUCT_NAME}: this text confirms that {sender.sender_id} can send through {sender.delivery_provider.name}.",
                                                  idempotency_key=f"verify:{sender.pk}:{timezone.now().timestamp():.0f}")) if texts else provider.send(EmailMessage(
                    to_email=to, from_email=sender.from_address, from_name=sender.display_name, reply_to=sender.reply_to_address or None,
                    subject=f"[{settings.EMAIL_PRODUCT_NAME}] Sender verification", idempotency_key=f"verify:{sender.pk}:{timezone.now().timestamp():.0f}", tag="verification",
                    text=f"This message confirms that {sender.from_address} can send through {sender.delivery_provider.name}.",
                    html=f"<p>This message confirms that <strong>{sender.from_address}</strong> can send through {sender.delivery_provider.name}.</p>"))
            ok, detail = result.outcome is Outcome.ACCEPTED, result.reason
        except ProviderError as exc:
            ok, detail = False, str(exc)
        SenderProfile.objects.filter(pk=sender.pk).update(verification_status="VERIFIED" if ok else "FAILED")
        return Response({"ok": ok, "detail": detail or None, "to": to, "verification_status": "VERIFIED" if ok else "FAILED"})


# ------------------------------------------------------------------------------------------------------------ campaigns: test send, results
class SendTestSerializer(serializers.Serializer):
    to = serializers.ListField(child=serializers.CharField(max_length=254), min_length=1, max_length=5)


class CampaignSendTestView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode.for_("campaign.edit")]

    @extend_schema(request=SendTestSerializer, responses={200: None})
    def post(self, request, pk, version=None):
        campaign = Campaign.objects.select_related("template", "sender_profile__delivery_provider", "tenant").filter(pk=pk, tenant_id=context.require().tenant_id).first()
        if campaign is None:
            raise ValidationError({"detail": "No such campaign."})
        form = SendTestSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        missing = {}
        if campaign.template_id is None:
            missing["template"] = "Choose a template first."
        if campaign.sender_profile_id is None or campaign.sender_profile.deleted_at is not None:
            missing["sender_profile"] = "Choose a sender first."
        if missing:
            raise ValidationError(missing)
        texts = runs.family(campaign) == "SMS"
        to = [item.strip() for item in form.validated_data["to"]]
        bad = [item for item in to if not (E164.match(item) if texts else re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", item))]
        if bad:
            raise ValidationError({"to": f"Not a {'mobile number with country code (+14045550100)' if texts else 'valid email address'}: {', '.join(bad)}"})
        try:
            return Response({"results": (dispatch_sms if texts else dispatch).send_test(campaign.tenant_id, campaign, to)})
        except ProviderError as exc:
            raise Conflict(str(exc)) from None


class CampaignRunResultsView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode.for_("campaign.view")]

    @extend_schema(responses={200: None})
    def get(self, request, pk, version=None):
        tenant_id = context.require().tenant_id
        run = CampaignRun.objects.filter(pk=pk, tenant_id=tenant_id).first()
        if run is None:
            raise ValidationError({"detail": "No such run."})
        return Response({"id": str(run.pk), "status": run.status, "started_at": run.started_at, "completed_at": run.completed_at, **runs.stats(tenant_id, run.pk)})


# ------------------------------------------------------------------------------------------------------------ e-receipts
class CanSendReceipts(HasPermissionCode):
    """An integration key with the scope receipts:send (the point of sale, the web shop), or a user who may publish campaigns."""
    def has_permission(self, request, view):
        user = request.user
        if getattr(user, "is_platform_admin", False):
            return True
        if hasattr(user, "has_scope"):
            return user.has_scope("receipts:send")
        return "campaign.publish" in user.permission_codes()


class ReceiptItemSerializer(serializers.Serializer):
    description = serializers.CharField(max_length=300)
    sku = serializers.CharField(max_length=100, required=False, allow_blank=True)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, required=False, default=1, coerce_to_string=False)
    unit_price = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True, coerce_to_string=False)
    total = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True, coerce_to_string=False)


class ReceiptAttachmentSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    content_type = serializers.CharField(max_length=100, required=False, default="application/pdf")
    data = serializers.CharField(help_text="base64")


class ReceiptSendSerializer(serializers.Serializer):
    campaign = serializers.CharField(help_text="id or code of a published E_RECEIPT campaign")
    to = serializers.EmailField()
    name = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    party_id = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    receipt = serializers.DictField(help_text="number (or order_number), transaction_at, currency, subtotal, discount_total, tax_total, grand_total, tender_summary, "
                                              "items [...] and anything else your template's RECEIPT tags read (source_path receipt.<key>)")
    store = serializers.DictField(required=False, default=dict, help_text="name, address ... for the template's STORE tags")
    attachments = ReceiptAttachmentSerializer(many=True, required=False, default=list)
    idempotency_key = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")

    def validate_receipt(self, value):
        items = ReceiptItemSerializer(data=value.get("items") or [], many=True)
        items.is_valid(raise_exception=True)
        return {**value, "items": [{k: (float(v) if hasattr(v, "quantize") else v) for k, v in item.items()} for item in items.validated_data]}


class ReceiptSendView(APIView):
    """Send one e-receipt now. Idempotent on receipt.number: repeating the call returns the first result with
    `duplicate: true` and sends nothing. 424 = the delivery provider is failing temporarily: call again later."""
    permission_classes = [IsAuthenticated, CanSendReceipts, params.RequiresFeature.for_("ereceipt")]

    @extend_schema(request=ReceiptSendSerializer, responses={200: None, 201: None})
    def post(self, request, version=None):
        form = ReceiptSendSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        data = form.validated_data
        try:
            result = receipts.send(context.require().tenant_id, campaign_ref=data["campaign"], to=data["to"], receipt=data["receipt"], store=data["store"],
                                   party_id=data["party_id"] or None, name=data["name"], attachments=data["attachments"], idempotency_key=data["idempotency_key"] or None)
        except receipts.ReceiptRefused as exc:
            body = {"type": "about:blank", "title": "The receipt was not sent", "status": exc.status, "detail": str(exc), "retryable": exc.status == 424}
            if exc.field:
                body["errors"] = {exc.field: [str(exc)]}
            return Response(body, status=exc.status, content_type="application/problem+json")
        return Response(result, status=200 if result["duplicate"] else 201)


# ------------------------------------------------------------------------------------------------------------ replies to texts
class SmsInboundView(APIView):
    """What people texted back: STOP / START / HELP and free replies, newest first. ?campaign=<id> narrows it to one campaign."""
    permission_classes = [IsAuthenticated, HasPermissionCode.for_("campaign.view")]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        from apps.delivery.engine import session
        campaign = request.query_params.get("campaign")
        with session.connection().cursor() as cursor:
            cursor.execute("""SELECT i.id, i.from_number, i.to_number, i.body, i.keyword, i.action, i.party_id, i.campaign_id, i.received_at,
                                     (SELECT trim(concat_ws(' ', c.first_name, c.last_name)) FROM customer_master c WHERE c.tenant_id = i.tenant_id AND c.party_id = i.party_id)
                                FROM sms_inbound_message i WHERE i.tenant_id = %s AND (%s::uuid IS NULL OR i.campaign_id = %s::uuid)
                               ORDER BY i.received_at DESC LIMIT 200""", [context.require().tenant_id, campaign or None, campaign or None])
            rows = cursor.fetchall()
        return Response([{"id": r[0], "from_number": r[1], "to_number": r[2], "body": r[3], "keyword": r[4], "action": r[5], "party_id": r[6],
                          "campaign": r[7] and str(r[7]), "received_at": r[8], "name": r[9] or None} for r in rows])
