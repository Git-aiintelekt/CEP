"""Workspace-level settings for tenant administrators: plan and usage, invoices, sign-in security, support access log."""
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.identity.models import Role
from apps.platform_ops import billing, crypto, mail, params, sso
from apps.platform_ops.models import MailServer, SupportAccessLog, TenantIdentityProvider, TenantInvoice
from apps.tenants import context
from apps.tenants.models import Tenant

ADMIN = [IsAuthenticated, HasPermissionCode.for_("user.admin")]


def _tenant_id():
    return context.require().tenant_id


class UsageView(APIView):
    """This month's usage against the plan. Figures are refreshed hourly by the rollup-usage job."""
    permission_classes = ADMIN

    @extend_schema(responses=inline_serializer("Usage", {"month": serializers.DateField(), "plan": serializers.DictField(allow_null=True),
                                                         "meters": serializers.ListField(child=serializers.DictField()), "breakdown": serializers.DictField(),
                                                         "can_send": serializers.BooleanField()}))
    def get(self, request, version=None):
        return Response(billing.quota(_tenant_id()))


class InvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantInvoice
        fields = ("id", "invoice_number", "period_month", "plan_code", "currency", "base_amount", "overage_amount", "total_amount", "line_items",
                  "status", "issued_at", "due_at", "paid_at")


class InvoicesView(APIView):
    permission_classes = ADMIN

    @extend_schema(responses=InvoiceSerializer(many=True))
    def get(self, request, version=None):
        invoices = TenantInvoice.objects.filter(tenant_id=_tenant_id()).exclude(status="DRAFT").order_by("-period_month")[:36]
        return Response(InvoiceSerializer(invoices, many=True).data)       # drafts are the platform's working copy, not the tenant's bill


class IdentityProviderSerializer(serializers.ModelSerializer):
    client_secret = serializers.CharField(write_only=True, required=False, allow_blank=True, help_text="leave blank to keep the stored secret")
    has_client_secret = serializers.SerializerMethodField()
    default_role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.filter(deleted_at__isnull=True), required=False, allow_null=True)

    class Meta:
        model = TenantIdentityProvider
        fields = ("display_name", "issuer", "client_id", "client_secret", "has_client_secret", "scopes", "allowed_email_domains", "jit_provisioning",
                  "default_role", "enforce_sso", "is_active")

    def get_has_client_secret(self, provider) -> bool:
        return bool(provider.client_secret_enc)

    def validate_issuer(self, value):
        value = value.strip().rstrip("/")
        if not value.startswith("https://"):
            raise serializers.ValidationError("The issuer must be an https:// address.")
        return value

    def validate_allowed_email_domains(self, domains):
        cleaned = [d.strip().lower().lstrip("@") for d in domains if d.strip()]
        bad = [d for d in cleaned if "." not in d or " " in d]
        if bad:
            raise serializers.ValidationError(f"Not a domain: {', '.join(bad)}")
        return cleaned

    def validate(self, attrs):
        current = lambda name: attrs.get(name, getattr(self.instance, name, None))          # noqa: E731
        if current("jit_provisioning") and not current("default_role"):
            raise serializers.ValidationError({"default_role": "Choose the role new users get when accounts are created on first sign-in."})
        if current("enforce_sso") and not current("is_active"):
            raise serializers.ValidationError({"enforce_sso": "Switch single sign-on on before requiring it."})
        if current("is_active"):
            try:
                sso.discovery(current("issuer"))            # fail now, in the form, not at the first user's sign-in
            except sso.SsoError as exc:
                raise serializers.ValidationError({"issuer": str(exc)}) from None
        return attrs


class SecurityView(APIView):
    """Sign-in rules of the workspace: require MFA, and the OpenID Connect identity provider."""
    permission_classes = ADMIN

    def _payload(self, tenant_id):
        tenant = Tenant.objects.get(pk=tenant_id)
        provider = TenantIdentityProvider.objects.filter(tenant_id=tenant_id).first()
        return {"require_mfa": bool((tenant.settings.get("security") or {}).get("require_mfa")),
                "sso_available": params.enabled(tenant_id, "sso"), "redirect_uri": sso.redirect_uri(),
                "identity_provider": IdentityProviderSerializer(provider).data if provider else None}

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(self._payload(_tenant_id()))

    @extend_schema(request=inline_serializer("SecuritySettings", {"require_mfa": serializers.BooleanField(required=False),
                                                                 "identity_provider": serializers.DictField(required=False, allow_null=True)}), responses={200: None})
    def put(self, request, version=None):
        tenant_id = _tenant_id()
        if "require_mfa" in request.data:
            tenant = Tenant.objects.get(pk=tenant_id)
            if request.data["require_mfa"] and not request.user.mfa_enabled:
                raise ValidationError({"require_mfa": "Set up multi-factor authentication on your own account first, so you are not locked out."})
            tenant.settings = {**tenant.settings, "security": {**(tenant.settings.get("security") or {}), "require_mfa": bool(request.data["require_mfa"])}}
            tenant.save(update_fields=["settings"])
        if "identity_provider" in request.data:
            if not params.enabled(tenant_id, "sso"):
                raise ValidationError({"identity_provider": "Single sign-on is not part of this workspace."})
            data = request.data["identity_provider"]
            provider = TenantIdentityProvider.objects.filter(tenant_id=tenant_id).first()
            if data is None:
                if provider:
                    provider.delete()
            else:
                form = IdentityProviderSerializer(provider, data=data, partial=provider is not None)
                form.is_valid(raise_exception=True)
                secret = form.validated_data.pop("client_secret", "")
                extra = {"client_secret_enc": crypto.encrypt(secret)} if secret else {}
                if provider is None:
                    form.save(tenant_id=tenant_id, created_by_id=request.user.pk, **extra)
                else:
                    form.save(**extra)
        return Response(self._payload(tenant_id))


class SupportAccessView(APIView):
    """Transparency: every time platform staff acted as one of this workspace's users."""
    permission_classes = ADMIN

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        rows = SupportAccessLog.objects.filter(tenant_id=_tenant_id()).select_related("target_user").order_by("-started_at")[:100]
        return Response([{"id": str(r.id), "staff": r.staff_name or "Platform support", "as_user": r.target_user.display_name, "as_email": r.target_user.email,
                          "reason": r.reason, "mode": r.access_mode, "started_at": r.started_at, "expires_at": r.expires_at, "ended_at": r.ended_at,
                          "writes": r.writes} for r in rows])


# ------------------------------------------------------------------------------------------------------------ email server
class MailServerSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, help_text="leave blank to keep the stored password")
    has_password = serializers.SerializerMethodField()

    class Meta:
        model = MailServer
        fields = ("host", "port", "security", "username", "password", "has_password", "from_email", "from_name", "reply_to", "use_platform_server", "is_active",
                  "last_tested_at", "last_test_ok", "last_test_error")
        read_only_fields = ("last_tested_at", "last_test_ok", "last_test_error")
        extra_kwargs = {"from_email": {"validators": []}}

    def get_has_password(self, server) -> bool:
        return bool(server.password_enc)

    def validate_from_email(self, value):
        value = value.strip().lower()
        serializers.EmailField().run_validation(value)
        return value

    def validate_reply_to(self, value):
        value = (value or "").strip().lower()
        if value:
            serializers.EmailField().run_validation(value)
        return value or None

    def validate_port(self, value):
        if not 1 <= int(value) <= 65535:
            raise serializers.ValidationError("Enter a port between 1 and 65535.")
        return value

    def validate_host(self, value):
        value = value.strip().lower()
        if value and (" " in value or "/" in value or "@" in value):
            raise serializers.ValidationError("Enter the server name only, e.g. smtp.example.com.")
        return value

    def validate(self, attrs):
        current = lambda name: attrs.get(name, getattr(self.instance, name, None))          # noqa: E731
        if current("use_platform_server"):
            if not mail.shared_with(mail.platform_server(), self.context["tenant_id"]):
                raise serializers.ValidationError({"use_platform_server": "The platform's mail server is not shared with this workspace."})
        elif not current("host"):
            raise serializers.ValidationError({"host": "Enter the SMTP server name, or use the platform's mail server."})
        port, security = current("port") or 587, current("security")
        if security == "SSL" and int(port) == 587 or security == "STARTTLS" and int(port) == 465:
            raise serializers.ValidationError({"port": "Port 587 goes with STARTTLS and port 465 with SSL/TLS. Check your provider's settings."})
        return attrs


class MailServerView(APIView):
    """The workspace's outgoing mail server: used for the messages the platform sends to this workspace's users, and
    offered as the From address for campaign email."""
    permission_classes = ADMIN

    def _payload(self, tenant_id):
        server = MailServer.objects.filter(tenant_id=tenant_id).first()
        platform = mail.platform_server()
        shared = mail.shared_with(platform, tenant_id)
        return {"server": MailServerSerializer(server).data if server else None,
                "platform_shared": shared, "platform_host": platform.host if shared else None,
                "in_use": mail.resolve(tenant_id, own=server).source}

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(self._payload(_tenant_id()))

    @extend_schema(request=MailServerSerializer, responses={200: None})
    def put(self, request, version=None):
        tenant_id = _tenant_id()
        server = MailServer.objects.filter(tenant_id=tenant_id).first()
        form = MailServerSerializer(server, data=request.data, partial=server is not None, context={"tenant_id": tenant_id})
        form.is_valid(raise_exception=True)
        password = form.validated_data.pop("password", "")
        extra = {"password_enc": crypto.encrypt(password)} if password else {}
        if form.validated_data.get("use_platform_server"):
            extra.update(host="", username=None, password_enc=None)          # nothing of a previous own server lingers
        if server is None:
            form.save(tenant_id=tenant_id, created_by_id=request.user.pk, **extra)
        else:
            form.save(updated_by_id=request.user.pk, **extra)
        return Response(self._payload(tenant_id))

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, version=None):
        MailServer.objects.filter(tenant_id=_tenant_id()).delete()
        return Response(status=204)


class MailServerTestView(APIView):
    permission_classes = ADMIN

    @extend_schema(request=inline_serializer("MailTest", {"to": serializers.EmailField(required=False)}), responses={200: None})
    def post(self, request, version=None):
        tenant_id = _tenant_id()
        server = MailServer.objects.filter(tenant_id=tenant_id).first()
        if server is None:
            raise ValidationError({"detail": "Save the mail server first."})
        to = str(request.data.get("to") or getattr(request.user, "email", "") or "").strip()
        if not to:
            raise ValidationError({"to": "Enter the address the test message should go to."})
        ok, error = mail.test(server, to, by=getattr(request.user, "display_name", ""))
        return Response({"ok": ok, "error": error or None, "to": to, "tested_at": server.last_tested_at})
