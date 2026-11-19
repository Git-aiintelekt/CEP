"""Tenant self-administration ("Settings" in the React app): users, roles, API keys, workspace facts.

Everything here is for a tenant's own administrators (permission `user.admin`). Cross-tenant operations (creating
tenants, plans, database routing) belong to the platform back-office in Django Admin, never to this API.

user_role and role_permission have no tenant_id and therefore no row-level security: every id written to them is first
looked up through Role / AppUser, which RLS confines to the caller's tenant.
"""
import hashlib
import ipaddress
import secrets

from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.identity.models import ApiClient, AppUser, Permission, Role, RolePermission, UserRole
from apps.platform_ops import links, mail, params
from apps.tenants import context
from apps.tenants.models import Tenant, TenantSubscription

ADMIN = "user.admin"
SERVICE_SCOPES = ["events:ingest", "receipts:send", "orders:ingest", "coupons:issue", "scores:write", "customers:read", "consent:write", "lists:write"]
KEY_TYPES = {"INTEGRATION": "in", "SERVICE": "sv", "WEBHOOK_SOURCE": "wh"}


def _tenant_id():
    return context.require().tenant_id


def _acting_user_id(request):
    return None if hasattr(request.user, "has_scope") else request.user.id


def _admins(exclude_user=None, without_role=None):
    """Active users who still hold user.admin, optionally pretending one user or one role no longer counts."""
    roles = Role.objects.filter(deleted_at__isnull=True, role_permissions__permission__code=ADMIN)
    if without_role is not None:
        roles = roles.exclude(pk=without_role)
    users = AppUser.objects.filter(is_active=True, deleted_at__isnull=True, pk__in=UserRole.objects.filter(role__in=roles).values("user_id"))
    return users.exclude(pk=exclude_user) if exclude_user is not None else users


# ------------------------------------------------------------------------------------------------------------ users
class UserSerializer(serializers.ModelSerializer):
    roles = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    has_password = serializers.SerializerMethodField()

    class Meta:
        model = AppUser
        fields = ("id", "email", "display_name", "is_active", "auth_provider", "mfa_enabled", "last_login", "created_at", "roles", "has_password")
        read_only_fields = ("id", "mfa_enabled", "last_login", "created_at")

    def get_has_password(self, user) -> bool:
        return bool(user.password)

    def to_representation(self, user):
        data = super().to_representation(user)
        assigned = list(Role.objects.filter(deleted_at__isnull=True, user_roles__user=user).order_by("name").values("id", "name"))
        data["roles"] = [str(role["id"]) for role in assigned]
        data["role_names"] = [role["name"] for role in assigned]
        data["is_self"] = str(user.id) == str(getattr(self.context.get("request"), "user", None) and self.context["request"].user.id)
        return data

    def validate_email(self, value):
        value = value.strip().lower()
        serializers.EmailField().run_validation(value)
        if self.instance is not None and self.instance.email.lower() != value:
            raise serializers.ValidationError("The email address is the sign-in name and cannot be changed. Create a new user instead.")
        return value

    def validate_display_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Enter the person's name.")
        return value

    def validate_roles(self, ids):
        ids = list(dict.fromkeys(ids))
        found = {role.id: role for role in Role.objects.filter(id__in=ids, deleted_at__isnull=True)}      # RLS: this tenant's roles only
        missing = [str(i) for i in ids if i not in found]
        if missing:
            raise serializers.ValidationError(f"Unknown role: {', '.join(missing)}")
        return [found[i] for i in ids]

    def validate(self, attrs):
        user, request = self.instance, self.context["request"]
        if user is not None:
            loses_access = attrs.get("is_active") is False
            loses_admin = "roles" in attrs and not any(
                RolePermission.objects.filter(role=role, permission__code=ADMIN).exists() for role in attrs["roles"])
            if str(user.id) == str(request.user.id) and loses_access:
                raise serializers.ValidationError({"is_active": "You cannot deactivate your own account."})
            if (loses_access or loses_admin) and _admins().filter(pk=user.pk).exists() and not _admins(exclude_user=user.pk).exists():
                raise serializers.ValidationError({"roles" if loses_admin else "is_active": "This is the last active administrator. Give another user an administrator role first."})
        return attrs

    @staticmethod
    def _set_roles(user, roles):
        keep = [role.id for role in roles]
        UserRole.objects.filter(user=user).exclude(role_id__in=keep).delete()
        existing = set(UserRole.objects.filter(user=user).values_list("role_id", flat=True))
        UserRole.objects.bulk_create([UserRole(user=user, role=role) for role in roles if role.id not in existing])

    def create(self, validated_data):
        roles = validated_data.pop("roles", [])
        try:
            with transaction.atomic():                        # savepoint: the email may exist in a tenant RLS hides from us
                user = AppUser.objects.create(**validated_data)
        except IntegrityError:
            raise serializers.ValidationError({"email": "This email address is already in use."}) from None
        self._set_roles(user, roles)
        return user

    def update(self, user, validated_data):
        roles = validated_data.pop("roles", None)
        validated_data.pop("email", None)
        for name, value in validated_data.items():
            setattr(user, name, value)
        if validated_data:
            user.save(update_fields=list(validated_data))
        if roles is not None:
            self._set_roles(user, roles)
        return AppUser.objects.get(pk=user.pk)


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """People who can sign in to this workspace. Users are deactivated, never deleted: their history keeps its author."""
    queryset = AppUser.objects.filter(deleted_at__isnull=True).order_by("display_name")
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_(ADMIN)]
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["is_active", "auth_provider"]
    search_fields = ["email", "display_name"]
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().filter(tenant_id=_tenant_id())

    def perform_create(self, serializer):
        plan = TenantSubscription.objects.filter(tenant_id=_tenant_id(), status__in=["ACTIVE", "TRIAL", "PAST_DUE"]).select_related("plan").first()
        limit = plan.plan.max_users if plan else None
        if limit is not None and self.get_queryset().filter(is_active=True).count() >= limit:
            raise Conflict(f"Your plan allows {limit} active users. Deactivate someone or upgrade the plan.")
        serializer.save(tenant_id=_tenant_id(), created_by_id=_acting_user_id(self.request), auth_provider=serializer.validated_data.get("auth_provider", "LOCAL"))

    @extend_schema(request=None, responses=inline_serializer("PasswordLink", {"path": serializers.CharField(), "expires_in_hours": serializers.IntegerField()}))
    @action(detail=True, methods=["post"], url_path="password-link")
    def password_link(self, request, pk=None, version=None):
        """A one-time link on which the user chooses their own password. Administrators never see or set passwords.
        The link stops working once it is used, after the next sign-in, or after security.password_link_hours."""
        from django.conf import settings
        user = self.get_object()
        if not user.is_active:
            raise Conflict("Activate the user before sending a password link.")
        if user.auth_provider != "LOCAL":
            raise Conflict("This user signs in through single sign-on and has no password here.")
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        path = f"/set-password?tenant={request.tenant['code']}&uid={uid}&token={token}"
        hours = links.hours()
        emailed = False
        if request.data.get("send"):                        # {"send": true}: email it; the administrator never has to handle the link
            emailed = mail.is_configured(request.tenant["id"]) & mail.send("password_link", user.email, tenant_id=request.tenant["id"], subject=f"Choose your password for {request.tenant['code']}", context={
                "name": user.display_name, "workspace": request.tenant["code"], "link": settings.FRONTEND_URL.rstrip("/") + path, "hours": hours,
                "invited": not user.password, "invited_by": getattr(request.user, "display_name", "An administrator")})
        return Response({"path": path, "expires_in_hours": hours, "emailed": emailed, "email_configured": mail.is_configured(request.tenant["id"]), "email": user.email})


class SetPasswordThrottle(AnonRateThrottle):
    rate = "10/min"


class SetPasswordView(APIView):
    """Public: the holder of a valid one-time link chooses a password. Every failure looks the same from outside."""
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [SetPasswordThrottle]

    @extend_schema(request=inline_serializer("SetPassword", {"uid": serializers.CharField(), "token": serializers.CharField(), "password": serializers.CharField()}),
                   responses={204: None})
    def post(self, request, version=None):
        uid, token, password = (str(request.data.get(key) or "") for key in ("uid", "token", "password"))
        try:
            user = AppUser.objects.filter(pk=force_str(urlsafe_base64_decode(uid)), is_active=True, deleted_at__isnull=True, auth_provider="LOCAL").first()
        except (ValueError, TypeError, OverflowError, DjangoValidationError):
            user = None
        if user is None or not links.check(user, token):
            raise ValidationError({"token": "This link is not valid any more. Ask your administrator for a new one."})
        try:
            validate_password(password, user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)}) from None
        user.set_password(password)
        user.save(update_fields=["password"])
        return Response(status=204)


# ------------------------------------------------------------------------------------------------------------ roles
class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ("code", "description")


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.ListField(child=serializers.CharField(), required=False, write_only=True, help_text="permission codes")
    user_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Role
        fields = ("id", "name", "description", "permissions", "user_count", "created_at", "updated_at", "row_version")
        read_only_fields = ("id", "created_at", "updated_at", "row_version")

    def to_representation(self, role):
        data = super().to_representation(role)
        data["permissions"] = sorted(RolePermission.objects.filter(role=role).values_list("permission__code", flat=True))
        return data

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Enter a role name.")
        clash = Role.objects.filter(name__iexact=value, deleted_at__isnull=True)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("Another role already has this name.")
        return value

    def validate_permissions(self, codes):
        codes = list(dict.fromkeys(codes))
        found = {p.code: p for p in Permission.objects.filter(code__in=codes)}
        unknown = [code for code in codes if code not in found]
        if unknown:
            raise serializers.ValidationError(f"Unknown permission: {', '.join(unknown)}")
        return [found[code] for code in codes]

    def validate(self, attrs):
        role = self.instance
        if role is not None and "permissions" in attrs and ADMIN not in [p.code for p in attrs["permissions"]]:
            had_admin = RolePermission.objects.filter(role=role, permission__code=ADMIN).exists()
            if had_admin and not _admins(without_role=role.pk).exists():
                raise serializers.ValidationError({"permissions": "This role is the only one that gives anyone user administration. Keep user.admin on it, or give it to another role that has active users first."})
        return attrs

    @staticmethod
    def _set_permissions(role, permissions):
        keep = [p.id for p in permissions]
        RolePermission.objects.filter(role=role).exclude(permission_id__in=keep).delete()
        existing = set(RolePermission.objects.filter(role=role).values_list("permission_id", flat=True))
        RolePermission.objects.bulk_create([RolePermission(role=role, permission=p) for p in permissions if p.id not in existing])

    def create(self, validated_data):
        permissions = validated_data.pop("permissions", [])
        try:
            with transaction.atomic():
                role = Role.objects.create(**validated_data)
        except IntegrityError:
            raise serializers.ValidationError({"name": "Another role already has this name."}) from None
        self._set_permissions(role, permissions)
        return role

    def update(self, role, validated_data):
        permissions = validated_data.pop("permissions", None)
        for name, value in validated_data.items():
            setattr(role, name, value)
        if validated_data:
            role.save(update_fields=list(validated_data))
        if permissions is not None:
            self._set_permissions(role, permissions)
        return Role.objects.annotate(user_count=Count("user_roles", filter=Q(user_roles__user__deleted_at__isnull=True))).get(pk=role.pk)


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.filter(deleted_at__isnull=True).annotate(
        user_count=Count("user_roles", filter=Q(user_roles__user__deleted_at__isnull=True))).order_by("name")
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_(ADMIN)]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().filter(tenant_id=_tenant_id())

    def perform_create(self, serializer):
        serializer.save(tenant_id=_tenant_id(), created_by_id=_acting_user_id(self.request))

    def perform_destroy(self, role):
        if UserRole.objects.filter(role=role, user__deleted_at__isnull=True).exists():
            raise Conflict("People still have this role. Move them to another role first.")
        RolePermission.objects.filter(role=role).delete()
        role.deleted_at = timezone.now()
        role.save(update_fields=["deleted_at"])

    @extend_schema(responses=PermissionSerializer(many=True))
    @action(detail=False, methods=["get"])
    def permissions(self, request, version=None):
        """The permission catalogue roles are built from (the same for every workspace)."""
        return Response(PermissionSerializer(Permission.objects.order_by("code"), many=True).data)


# ------------------------------------------------------------------------------------------------------------ API keys
class ApiClientSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()

    class Meta:
        model = ApiClient
        fields = ("id", "name", "client_type", "key_prefix", "scopes", "allowed_ip_cidrs", "rate_limit_per_minute", "expires_at",
                  "revoked_at", "last_used_at", "created_at", "status")
        read_only_fields = ("id", "key_prefix", "revoked_at", "last_used_at", "created_at")
        extra_kwargs = {"client_type": {"required": False, "default": "INTEGRATION"}, "scopes": {"required": True},
                        "allowed_ip_cidrs": {"required": False, "allow_null": True}}

    def get_status(self, client) -> str:
        if client.revoked_at:
            return "REVOKED"
        return "EXPIRED" if client.expires_at and client.expires_at <= timezone.now() else "ACTIVE"

    def validate_scopes(self, scopes):
        allowed = {code.replace(".", ":") for code in Permission.objects.values_list("code", flat=True)} | set(SERVICE_SCOPES)
        unknown = [scope for scope in scopes if scope not in allowed]
        if unknown:
            raise serializers.ValidationError(f"Unknown scope: {', '.join(unknown)}")
        if not scopes:
            raise serializers.ValidationError("Choose at least one scope: a key without scopes can do nothing.")
        if ADMIN.replace(".", ":") in scopes:
            raise serializers.ValidationError("API keys cannot administer users.")
        return list(dict.fromkeys(scopes))

    def validate_allowed_ip_cidrs(self, cidrs):
        cleaned = []
        for item in cidrs or []:
            try:
                cleaned.append(str(ipaddress.ip_network(item.strip(), strict=False)))
            except ValueError:
                raise serializers.ValidationError(f"{item} is not an IP address or CIDR range, for example 203.0.113.0/24.") from None
        return cleaned or None

    def validate_expires_at(self, value):
        if value is not None and value <= timezone.now():
            raise serializers.ValidationError("Choose a time in the future.")
        return value

    def validate_rate_limit_per_minute(self, value):
        if value is not None and not 1 <= value <= 100_000:
            raise serializers.ValidationError("Between 1 and 100,000 requests per minute.")
        return value


class ApiClientViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Keys for integrations. The full key is returned once, on creation; only its SHA-256 hash is stored."""
    queryset = ApiClient.objects.order_by("-created_at")
    serializer_class = ApiClientSerializer
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_(ADMIN), params.RequiresFeature.for_("api_access")]
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().filter(tenant_id=_tenant_id())

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        kind = serializer.validated_data.get("client_type", "INTEGRATION")
        for _ in range(5):                                       # key_prefix is unique: retry the (tiny) chance of a clash
            alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
            prefix = f"cep_{KEY_TYPES[kind]}_" + "".join(secrets.choice(alphabet) for _ in range(6))
            key = prefix + secrets.token_urlsafe(32).replace("-", "").replace("_", "")
            try:
                with transaction.atomic():
                    client = serializer.save(tenant_id=_tenant_id(), created_by_id=_acting_user_id(request), client_type=kind,
                                             key_prefix=prefix, key_hash=hashlib.sha256(key.encode()).hexdigest())
                break
            except IntegrityError:
                continue
        else:
            raise Conflict("Could not generate a unique key. Try again.")
        return Response({**self.get_serializer(client).data, "key": key}, status=201)

    @extend_schema(request=None, responses=ApiClientSerializer)
    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None, version=None):
        client = self.get_object()
        if client.revoked_at is None:
            client.revoked_at = timezone.now()
            client.save(update_fields=["revoked_at"])
        return Response(self.get_serializer(client).data)

    @extend_schema(responses=inline_serializer("ApiScopes", {"scopes": serializers.ListField(child=serializers.CharField())}))
    @action(detail=False, methods=["get"])
    def scopes(self, request, version=None):
        codes = [code.replace(".", ":") for code in Permission.objects.exclude(code=ADMIN).order_by("code").values_list("code", flat=True)]
        return Response({"scopes": codes + SERVICE_SCOPES})


# ------------------------------------------------------------------------------------------------------------ workspace
class WorkspaceView(APIView):
    """Read-only facts about the workspace for the Settings overview. Plans and limits are changed by the platform team."""
    permission_classes = [IsAuthenticated, HasPermissionCode.for_(ADMIN)]

    @extend_schema(responses=inline_serializer("Workspace", {
        "name": serializers.CharField(), "code": serializers.CharField(), "timezone": serializers.CharField(), "status": serializers.CharField(),
        "subdomain": serializers.CharField(allow_null=True), "region": serializers.CharField(allow_null=True), "plan": serializers.CharField(allow_null=True),
        "max_users": serializers.IntegerField(allow_null=True), "active_users": serializers.IntegerField(), "roles": serializers.IntegerField(),
        "active_api_keys": serializers.IntegerField()}))
    def get(self, request, version=None):
        tenant = Tenant.objects.get(pk=_tenant_id())
        subscription = TenantSubscription.objects.filter(tenant_id=tenant.id).select_related("plan").order_by("-started_at").first()
        return Response({
            "name": tenant.name, "code": tenant.code, "timezone": tenant.timezone, "status": tenant.status, "subdomain": tenant.subdomain,
            "region": tenant.region, "plan": subscription.plan.name if subscription else None,
            "max_users": subscription.plan.max_users if subscription else None,
            "active_users": AppUser.objects.filter(tenant_id=tenant.id, is_active=True, deleted_at__isnull=True).count(),
            "roles": Role.objects.filter(tenant_id=tenant.id, deleted_at__isnull=True).count(),
            "active_api_keys": ApiClient.objects.filter(tenant_id=tenant.id, revoked_at__isnull=True).count(),
        })
