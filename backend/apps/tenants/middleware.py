"""TenantMiddleware — one transaction per request with the RLS session settings scoped to it (PgBouncer-safe)."""
from django.conf import settings
from django.db import connections, transaction
from django.http import JsonResponse

from apps.tenants import context
from apps.tenants.resolver import resolve_tenant

EXEMPT_PREFIXES = ("/healthz", "/admin/", "/static/", "/media/", "/api/v1/schema", "/api/v1/docs", "/api/v1/redoc")


class PlatformAdminMiddleware:
    """Requests under PLATFORM_PATH_PREFIXES (Django Admin) run on the BYPASSRLS `platform` connection: the back-office
    is cross-tenant and staff-only, and its login has no tenant context to satisfy RLS with. Must sit above
    SessionMiddleware / AuthenticationMiddleware so session and user lookups use the same connection."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith(settings.PLATFORM_PATH_PREFIXES):
            return self.get_response(request)
        token = context.set_platform(True)
        try:
            return self.get_response(request)
        finally:
            context.reset_platform(token)


class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path == "/" or request.path.startswith(EXEMPT_PREFIXES):
            return self.get_response(request)
        tenant = resolve_tenant(request)
        if tenant is None:
            return JsonResponse({"type": "about:blank", "title": "Unknown tenant", "status": 404}, status=404, content_type="application/problem+json")
        if tenant["db_status"] != "ACTIVE":
            return JsonResponse({"type": "about:blank", "title": "Tenant is being migrated; retry shortly", "status": 503}, status=503, content_type="application/problem+json")
        alias = tenant["db_alias"]
        request.tenant = tenant
        token = context.set_current(tenant["id"], alias, getattr(getattr(request, "user", None), "id", None))
        try:
            with transaction.atomic(using=alias):
                with connections[alias].cursor() as cur:
                    # set_config(..., is_local => true) == SET LOCAL, but accepts bind parameters (SET does not)
                    cur.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant["id"])])
                    user = getattr(request, "user", None)
                    if user is not None and getattr(user, "is_authenticated", False):
                        cur.execute("SELECT set_config('app.current_user_id', %s, true)", [str(user.id)])
                response = self.get_response(request)
                if response.status_code >= 500:
                    transaction.set_rollback(True, using=alias)
                return response
        finally:
            context.reset(token)


def set_current_user(user_id) -> None:
    """Called by the API layer once DRF has authenticated the request (JWT / API key happen after middleware)."""
    ctx = context.current()
    if ctx is None:
        return
    with connections[ctx.db_alias].cursor() as cur:
        cur.execute("SELECT set_config('app.current_user_id', %s, true)", [str(user_id)])
    context.set_current(ctx.tenant_id, ctx.db_alias, user_id)
