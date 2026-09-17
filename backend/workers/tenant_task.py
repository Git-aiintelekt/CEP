"""Every Celery task that touches tenant data is wrapped so it re-establishes the same RLS session contract as a request."""
from functools import wraps

from django.conf import settings
from django.db import connections, transaction

from apps.tenants import context


def tenant_task(fn):
    @wraps(fn)
    def wrapper(tenant_id, *args, **kwargs):
        from apps.tenants.models import TenantDatabase
        td = TenantDatabase.objects.using(settings.CONTROL_PLANE_ALIAS).filter(tenant_id=tenant_id).first()
        alias = td.db_alias if td else settings.CONTROL_PLANE_ALIAS
        if td and td.status != "ACTIVE":
            raise RuntimeError(f"tenant {tenant_id} database is {td.status}; task deferred")
        token = context.set_current(tenant_id, alias)
        try:
            with transaction.atomic(using=alias):
                with connections[alias].cursor() as cur:
                    cur.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])
                return fn(tenant_id, *args, **kwargs)
        finally:
            context.reset(token)
    return wrapper
