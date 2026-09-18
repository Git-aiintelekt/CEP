"""Tenant sessions for the send engine.

A request or a @tenant_task runs in ONE transaction. Sending cannot: every message must be durably claimed before it goes
to the provider and durably recorded afterwards, or a crashed worker would send a batch twice. So the engine opens a
tenant *scope* (context + database alias) and, inside it, as many short transactions as it needs; each one re-establishes
the row-level-security setting, exactly like the middleware does per request.
"""
from contextlib import contextmanager

from django.conf import settings
from django.db import connections, transaction

from apps.tenants import context


@contextmanager
def tenant_scope(tenant_id):
    """Sets the tenant context for the block. Reuses the current one when a request or task already established it."""
    existing = context.current()
    if existing is not None and existing.tenant_id == str(tenant_id):
        yield existing
        return
    from apps.tenants.models import TenantDatabase
    routing = TenantDatabase.objects.using(settings.CONTROL_PLANE_ALIAS).filter(tenant_id=tenant_id).first()
    if routing is not None and routing.status != "ACTIVE":
        raise RuntimeError(f"tenant {tenant_id} database is {routing.status}; sending is deferred")
    alias = routing.db_alias if routing is not None and routing.db_alias in settings.DATABASES else settings.CONTROL_PLANE_ALIAS
    token = context.set_current(tenant_id, alias)
    try:
        yield context.current()
    finally:
        context.reset(token)


def connection():
    return connections[context.require().db_alias]


@contextmanager
def tx():
    """One short transaction under the tenant's row-level security. Nested inside an outer transaction it is a savepoint."""
    scope = context.require()
    with transaction.atomic(using=scope.db_alias):
        with connections[scope.db_alias].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [scope.tenant_id])
        yield
