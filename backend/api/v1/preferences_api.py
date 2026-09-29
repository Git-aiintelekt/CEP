"""Settings -> Preference Centre: the switch and the page's words (workspace administrators), and the topics a person can
choose (read by anyone who sets up campaigns, changed by administrators)."""
import re

from django.db.models import Count
from django.utils import timezone
from django.utils.text import slugify
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.campaigns.models import Campaign
from apps.delivery.engine import unsubscribe
from apps.governance import preferences
from apps.governance.models import SubscriptionTopic
from apps.tenants import context
from apps.tenants.models import Tenant

ADMIN = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]
READ = [IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.view")]
TAG = "{{preference_url}}"


def _tenant():
    return Tenant.objects.get(pk=context.require().tenant_id)


class SubscriptionTopicSerializer(serializers.ModelSerializer):
    opted_out = serializers.SerializerMethodField()
    campaigns = serializers.SerializerMethodField()

    class Meta:
        model = SubscriptionTopic
        fields = ("id", "code", "name", "description", "channels", "is_shown", "sort_order", "opted_out", "campaigns", "created_at", "updated_at")
        read_only_fields = ("code", "created_at", "updated_at")

    def get_opted_out(self, topic) -> int:
        return int(self.context.get("opt_outs", {}).get(str(topic.pk), 0))

    def get_campaigns(self, topic) -> int:
        return int(self.context.get("campaign_counts", {}).get(str(topic.pk), 0))

    def validate_name(self, value):
        value = " ".join((value or "").split())
        if not value:
            raise serializers.ValidationError("Give the topic a name.")
        if len(value) > 80:
            raise serializers.ValidationError("Use 80 characters or fewer.")
        return value

    def validate_description(self, value):
        value = " ".join((value or "").split())
        if len(value) > 200:
            raise serializers.ValidationError("Use 200 characters or fewer.")
        return value or None

    def validate_channels(self, value):
        chosen = [channel for channel in dict.fromkeys(str(item).upper() for item in (value or [])) if channel in preferences.CHANNELS]
        if not chosen:
            raise serializers.ValidationError("Offer the topic on email, texts or both.")
        return chosen


class SubscriptionTopicViewSet(viewsets.ModelViewSet):
    """The topics people can choose on the preference page. Reads need campaign.view (the setup's Topic field), writes user.admin."""
    queryset = SubscriptionTopic.objects.none()
    serializer_class = SubscriptionTopicSerializer
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        return [p() for p in (READ if self.request.method in ("GET", "HEAD", "OPTIONS") else ADMIN)]

    def get_queryset(self):
        return SubscriptionTopic.objects.filter(tenant_id=context.require().tenant_id, deleted_at__isnull=True).order_by("sort_order", "name")

    def list(self, request, *args, **kwargs):
        """The topics with the switch state: the campaign setup shows its Topic field only while the centre is on."""
        response = super().list(request, *args, **kwargs)
        return Response({"enabled": preferences.enabled(_tenant()), "results": response.data})

    def get_serializer_context(self):
        tenant_id = context.require().tenant_id
        counts = {}
        for topic_id, n in Campaign.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True, topic_id__isnull=False).values_list("topic_id").annotate(n=Count("id")):
            counts[str(topic_id)] = n
        return {**super().get_serializer_context(), "opt_outs": preferences.opt_out_counts(tenant_id), "campaign_counts": counts}

    def perform_create(self, serializer):
        tenant_id = context.require().tenant_id
        name = serializer.validated_data["name"]
        base = re.sub(r"[^a-z0-9_]+", "_", slugify(name).replace("-", "_")).strip("_")[:36] or "topic"
        if not base[0].isalpha():
            base = "t_" + base
        code, n = base, 2
        while SubscriptionTopic.objects.filter(tenant_id=tenant_id, code=code).exists():
            code, n = f"{base[:33]}_{n}", n + 1
        last = SubscriptionTopic.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).order_by("-sort_order").values_list("sort_order", flat=True).first()
        serializer.save(tenant_id=tenant_id, code=code, sort_order=serializer.validated_data.get("sort_order", (last or 0) + 10), created_by_id=self.request.user.pk)

    def perform_update(self, serializer):
        serializer.save(updated_by_id=self.request.user.pk)

    def perform_destroy(self, topic):
        """Removed from the page and from the setup's choices; campaigns filed under it keep the reference and are told at publish."""
        SubscriptionTopic.objects.filter(pk=topic.pk).update(deleted_at=timezone.now(), is_shown=False, updated_by_id=self.request.user.pk)


class PreferenceCenterView(APIView):
    """The switch, the page's words, the tag to put in templates, a preview link and the last 30 days' figures."""
    permission_classes = ADMIN

    def _payload(self, tenant):
        token = unsubscribe.test_token(tenant_code=tenant.code, email="someone@example.com")
        return {**preferences.settings_of(tenant), "workspace_name": tenant.name, "tag": TAG, "preview_url": preferences.url_for(token),
                "stats": preferences.stats(tenant.pk), "topics": len(preferences.topics(tenant.pk))}

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(self._payload(_tenant()))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None):
        tenant = _tenant()
        try:
            preferences.save(tenant, request.data if isinstance(request.data, dict) else {})
        except preferences.PreferenceError as exc:
            raise ValidationError({exc.field: str(exc)}) from None
        return Response(self._payload(tenant))
