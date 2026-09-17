"""Django Admin = the internal platform back-office (cross-tenant, staff only), themed with django-unfold (Tailwind).

Tenant administrators never come here: they use Settings in the React app. This is for the platform team: tenants,
plans, routing, people across tenants, operations.

Every request under /admin/ runs on the BYPASSRLS `platform` connection (PlatformAdminMiddleware), so lists show all
tenants and always offer a tenant filter. Models not given a purpose-built admin below are registered generically.
"""
from django.apps import apps as django_apps
from django.conf import settings
from django.contrib import admin
from django.contrib.postgres.fields import ArrayField
from django.db import connections, models
from unfold.admin import ModelAdmin

AUDIT_FIELDS = {"created_at", "updated_at", "created_by", "updated_by", "deleted_at", "row_version", "last_login"}
SEARCHABLE = ("name", "code", "email", "display_name", "subject", "party_id", "key_prefix", "event_type")
FILTERABLE = ("status", "channel", "campaign_type", "run_type", "list_kind", "tag_kind", "auth_provider",
              "isolation_mode", "is_active", "is_staff", "tenant")
SECRET_FIELDS = {"password", "key_hash"}


class PlatformWriteMixin:
    """Writes from the back-office carry the acting staff user and the row's tenant into the database session, so the
    touch trigger stamps updated_by and the definition audit trail records who changed what, as it does for the API."""

    def _stamp(self, request, obj):
        with connections[settings.PLATFORM_ALIAS].cursor() as cursor:         # inside the admin view's transaction
            cursor.execute("SELECT set_config('app.current_user_id', %s, true)", [str(request.user.pk)])
            tenant_id = getattr(obj, "tenant_id", None) or (obj.pk if obj._meta.db_table == "tenant" else None)
            if tenant_id:
                cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])

    def save_model(self, request, obj, form, change):
        self._stamp(request, obj)
        if not change:
            if hasattr(obj, "created_by_id") and obj.created_by_id is None and obj._meta.db_table != "app_user":
                obj.created_by_id = request.user.pk
            return super().save_model(request, obj, form, change)
        # Edits write only what changed: generated columns (tenant.partition_seq) cannot be written at all, and a
        # narrow UPDATE keeps the audit trail's changed_columns meaningful.
        concrete = {f.name for f in obj._meta.concrete_fields}
        changed = [name for name in (form.changed_data if form is not None else []) if name in concrete]
        if changed:
            obj.save(update_fields=changed)

    def set_fields(self, request, obj, **values):
        """For actions: change a few columns on one row with the same stamping as a form save."""
        self._stamp(request, obj)
        for name, value in values.items():
            setattr(obj, name, value)
        obj.save(update_fields=list(values))

    def delete_model(self, request, obj):
        self._stamp(request, obj)
        super().delete_model(request, obj)


class BaseAdmin(PlatformWriteMixin, ModelAdmin):
    list_per_page = 50
    show_full_result_count = False                        # no COUNT(*) over partitioned execution tables
    list_select_related = False
    list_filter_submit = True
    warn_unsaved_form = True
    compressed_fields = True

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        field = super().formfield_for_dbfield(db_field, request, **kwargs)
        # Django forms treat {} and [] as "empty": a JSON / array column with a default is optional, not required
        if field is not None and isinstance(db_field, (models.JSONField, ArrayField)) and db_field.has_default():
            field.required = False
        return field

    def get_fieldsets(self, request, obj=None):
        """Read-only system fields (ids, counters, timestamps) are filled by the database on insert: before the row
        exists they hold a DatabaseDefault placeholder, not a value, so the add form leaves them out."""
        fieldsets = super().get_fieldsets(request, obj)
        if obj is not None:
            return fieldsets
        hidden = set(self.get_readonly_fields(request, None))
        kept = []
        for title, options in fieldsets:
            fields = [f for f in options.get("fields", ()) if (f not in hidden if isinstance(f, str) else True)]
            if fields:
                kept.append((title, {**options, "fields": fields}))
        return kept


class ReadOnlyAdmin(BaseAdmin):
    """System-written tables (audit trail, executions, events): look, never touch."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class GenericAdmin(BaseAdmin):
    def __init__(self, model, admin_site):
        fields = list(model._meta.concrete_fields)
        names = [f.name for f in fields]
        bulky = (models.JSONField, ArrayField, models.BinaryField)
        columns = [f.name for f in fields
                   if not isinstance(f, bulky) and f.name not in SECRET_FIELDS
                   and (f.name not in AUDIT_FIELDS or f.name == "created_at")
                   and not (isinstance(f, models.TextField) and f.name not in SEARCHABLE)]
        self.list_display = columns[:8] or [model._meta.pk.name]
        self.search_fields = [n for n in SEARCHABLE if n in names]
        self.list_filter = [n for n in FILTERABLE if n in names][:5]
        self.raw_id_fields = [f.name for f in fields if f.is_relation]          # never render a <select> of every row
        self.readonly_fields = [n for n in names if n in AUDIT_FIELDS and n not in self.raw_id_fields]
        self.exclude = [n for n in names if n in SECRET_FIELDS]
        if "created_at" in names:
            self.ordering = ("-created_at",)
        super().__init__(model, admin_site)


def register_app_models(package: str) -> None:
    """Call LAST in <app>/admin.py: registers whatever the app has not given its own admin."""
    config = django_apps.get_containing_app_config(f"{package}.models")
    for model in config.get_models():
        if isinstance(model._meta.pk, models.CompositePrimaryKey):
            continue                                       # Django Admin cannot address composite-key rows (link tables, usage counters)
        if not admin.site.is_registered(model):
            admin.site.register(model, GenericAdmin)
