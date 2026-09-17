"""Control-plane models always use the pool database; everything else follows the current tenant's alias."""
from django.conf import settings

from apps.tenants import context


class TenantRouter:
    def _alias(self, model):
        if context.is_platform():                          # /admin/ back-office: every table, every tenant
            return settings.PLATFORM_ALIAS
        if model._meta.db_table in settings.CONTROL_PLANE_MODELS or model._meta.app_label in ("auth", "contenttypes", "sessions", "admin"):
            return settings.CONTROL_PLANE_ALIAS
        ctx = context.current()
        return ctx.db_alias if ctx else settings.CONTROL_PLANE_ALIAS

    def db_for_read(self, model, **hints):
        return self._alias(model)

    def db_for_write(self, model, **hints):
        return self._alias(model)

    def allow_relation(self, obj1, obj2, **hints):
        return True

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        return True                                       # identical schema in the pool and every dedicated database
