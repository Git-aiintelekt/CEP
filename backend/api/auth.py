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
        if not header.lower().startswith("bearer ") or not header[7:].startswith(self.PREFIX):
            return None                                       # not an API key: let JWT / session handle it
        key = header[7:].strip()
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
