"""Resolve the tenant for an incoming request: X-Tenant header (code or subdomain) → host subdomain → custom domain."""
from django.conf import settings
from django.core.cache import cache

from django.db import connections

CACHE_TTL = 60


def _lookup(key: str, value: str):
    """fn_resolve_tenant() is SECURITY DEFINER: the registry is invisible to the RLS-bound application role until a tenant
    context exists, and resolving the tenant is what creates that context. It returns routing data only."""
    cache_key = f"tenant:{key}:{value.lower()}"
    hit = cache.get(cache_key)
    if hit is not None:
        return hit
    with connections[settings.CONTROL_PLANE_ALIAS].cursor() as cur:
        cur.execute("SELECT id, code, timezone, db_alias, db_status FROM fn_resolve_tenant(%s, %s)", [key, value])
        row = cur.fetchone()
    if row is None:
        return None
    alias = row[3] if row[3] in settings.DATABASES else settings.CONTROL_PLANE_ALIAS
    result = {"id": str(row[0]), "code": row[1], "timezone": row[2], "db_alias": alias, "db_status": row[4]}
    cache.set(cache_key, result, CACHE_TTL)
    return result


PUBLIC_LINK_PREFIXES = ("/api/v1/public/unsubscribe/", "/api/v1/public/preferences/", "/api/v1/l/")


def resolve_tenant(request):
    if request.path.startswith("/api/v1/auth/sso/"):         # a browser navigation cannot carry X-Tenant
        from apps.platform_ops import sso
        code = request.GET.get("tenant") or sso.tenant_from_state(request.GET.get("state", ""))
        if code:
            return _lookup("code", code)
    if request.path.startswith("/api/v1/webhooks/delivery/"):  # a provider's callback: the workspace code is part of the address
        parts = request.path.split("/")
        return _lookup("code", parts[5]) if len(parts) > 5 and parts[5] else None
    if request.path.startswith("/api/v1/l/"):                 # a text campaign's short link: /api/v1/l/<workspace>/<code>/
        parts = request.path.split("/")
        return _lookup("code", parts[4]) if len(parts) > 4 and parts[4] else None
    if request.path.startswith("/api/v1/public/embed/"):      # an Insights embed: the workspace code is part of the address
        parts = request.path.split("/")
        return _lookup("code", parts[5]) if len(parts) > 5 and parts[5] else None
    if request.path.startswith(PUBLIC_LINK_PREFIXES):          # a link in an email: the signed token names the workspace
        from apps.delivery.engine import unsubscribe
        claims = unsubscribe.read(request.GET.get("t", ""))
        return _lookup("code", claims["t"]) if claims and claims.get("t") else None
    header = request.headers.get("X-Tenant") or request.headers.get("X-Tenant-Key")      # the point of sale names the workspace as X-Tenant-Key
    if header:
        return _lookup("code", header) or _lookup("subdomain", header)
    host = request.get_host().split(":")[0].lower()
    parts = host.split(".")
    if len(parts) >= 3 and parts[0] not in ("www", "app", "api"):
        found = _lookup("subdomain", parts[0])
        if found:
            return found
    return _lookup("custom_app_domain", host)
