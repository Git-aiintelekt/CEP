"""API-key authentication backed by api_client (hashed key, scopes, IP allow-list, expiry, revocation)."""
import hashlib
import ipaddress

from django.utils import timezone
from rest_framework import authentication, exceptions

from apps.identity.models import ApiClient


class ApiClientPrincipal:
    """Stands in for request.user when a key authenticates; is_authenticated so IsAuthenticated passes."""
    is_authenticated = True
    is_anonymous = False
    is_active = True
    is_staff = False
    is_platform_admin = False

    def __init__(self, client: ApiClient):
        self.client = client
        self.id = client.id
        self.pk = client.id
        self.tenant_id = client.tenant_id
        self.scopes = set(client.scopes or [])

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes

    def __str__(self):
        return f"api_client:{self.client.name}"


class ApiKeyAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"
    PREFIX = "cep_"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode()
        if header.lower().startswith("bearer ") and header[7:].startswith(self.PREFIX):
            key = header[7:].strip()
        elif str(request.META.get("HTTP_ACCESSTOKENKEY", "")).startswith(self.PREFIX):        # a point of sale sends the key in its own header
            key = request.META["HTTP_ACCESSTOKENKEY"].strip()
        else:
            return None                                       # not an API key: let JWT / session handle it
        prefix = key[:13]                                     # cep_xx_XXXXXX
        client = ApiClient.objects.filter(key_prefix=prefix, revoked_at__isnull=True).first()
        if client is None or client.key_hash != hashlib.sha256(key.encode()).hexdigest():
            raise exceptions.AuthenticationFailed("Invalid API key")
        if client.expires_at and client.expires_at < timezone.now():
            raise exceptions.AuthenticationFailed("API key expired")
        if client.allowed_ip_cidrs:
            ip = ipaddress.ip_address(request.META.get("HTTP_X_FORWARDED_FOR", request.META.get("REMOTE_ADDR", "0.0.0.0")).split(",")[0].strip())
            if not any(ip in ipaddress.ip_network(c) for c in client.allowed_ip_cidrs):
                raise exceptions.AuthenticationFailed("IP address not allowed for this key")
        ApiClient.objects.filter(pk=client.pk).update(last_used_at=timezone.now())
        return ApiClientPrincipal(client), key

    def authenticate_header(self, request):
        return "Bearer"


try:                                                      # document the scheme in OpenAPI (drf-spectacular)
    from drf_spectacular.extensions import OpenApiAuthenticationExtension

    class ApiKeyAuthenticationScheme(OpenApiAuthenticationExtension):
        target_class = "api.auth.ApiKeyAuthentication"
        name = "ApiKeyAuth"

        def get_security_definition(self, auto_schema):
            return {"type": "http", "scheme": "bearer", "bearerFormat": "cep_<type>_<key>",
                    "description": "API key issued to an integration or service (api_client). Send as `Authorization: Bearer cep_…`."}
except ImportError:                                       # pragma: no cover
    pass


# =====================================================================================================================
# JWT + the two restricted kinds of token (kept here, not in api.v1.auth_api: DRF imports authentication classes while
# it is still importing rest_framework.views, so this module must not import views)
# =====================================================================================================================
from rest_framework_simplejwt.authentication import JWTAuthentication  # noqa: E402

SAFE = ("GET", "HEAD", "OPTIONS")
SUPPORT_FORBIDDEN = ("/users/", "/roles/", "/api-clients/", "/workspace/security/", "/auth/mfa/")
MFA_SETUP_ALLOWED = ("/auth/mfa/", "/me/", "/auth/token/refresh/")


class CepJWTAuthentication(JWTAuthentication):
    """* a support session (claim `imp`) is read-only unless opened for writing, never touches users / roles / keys /
         sign-in security, and stops working the moment it is ended or expires;
       * a visit (claim `visit`, Switch Workspace): a platform administrator in another workspace as themselves, read through the
         platform connection (the workspace's row-level security hides them), only in that workspace and while the visit is open;
       * a user who must enrol MFA first (claim `mfa_setup`) reaches only the enrolment endpoints and /me."""

    def get_user(self, validated_token):
        if validated_token.get("visit"):
            from django.conf import settings

            from apps.identity.models import AppUser
            user = AppUser.objects.using(settings.PLATFORM_ALIAS).filter(pk=validated_token.get("sub"), is_active=True, is_platform_admin=True).first()
            if user is None:
                raise exceptions.AuthenticationFailed("This visit has ended.")
            return user
        return super().get_user(validated_token)

    def authenticate(self, request):
        from django.conf import settings
        from django.db import connections

        from apps.platform_ops.models import SupportAccessLog
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result
        path = request.path.split("/api/v1", 1)[-1]

        session_id = token.get("imp")
        if session_id:
            session = SupportAccessLog.objects.filter(pk=session_id, target_user_id=user.pk, ended_at__isnull=True, expires_at__gt=timezone.now()).first()
            if session is None:
                raise exceptions.AuthenticationFailed("This support session has ended.")
            request._request.support_session = session
            if any(path.startswith(prefix) for prefix in SUPPORT_FORBIDDEN):
                raise exceptions.PermissionDenied("Support sessions cannot manage users, roles, API keys or sign-in security.")
            if request.method not in SAFE and not path.startswith("/auth/support-session/end/"):
                if session.access_mode != "WRITE":
                    raise exceptions.PermissionDenied("This support session is read-only.")
                with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
                    cursor.execute("UPDATE support_access_log SET writes = writes + 1 WHERE id = %s", [str(session.pk)])

        visit_id = token.get("visit")
        if visit_id:
            from apps.platform_ops import visits
            tenant = getattr(request._request, "tenant", None) or {}
            visit = visits.open_visit(visit_id, user.pk, tenant.get("id"))
            if visit is None:
                raise exceptions.AuthenticationFailed("This visit has ended. Go back to your workspace and switch again.")
            request._request.platform_visit = visit
            visits.touch(visit_id, request.method not in SAFE)

        if token.get("mfa_setup") and not user.mfa_enabled and not any(path.startswith(prefix) for prefix in MFA_SETUP_ALLOWED):
            raise exceptions.PermissionDenied("Set up multi-factor authentication first: your workspace requires it.")
        return user, token


try:                                                      # same bearer scheme as SimpleJWT in the OpenAPI document
    from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme

    class CepJWTScheme(SimpleJWTScheme):
        target_class = "api.auth.CepJWTAuthentication"
        name = "jwtAuth"
except ImportError:                                       # pragma: no cover
    pass
