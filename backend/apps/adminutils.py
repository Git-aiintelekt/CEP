"""Django Admin = the internal platform back-office (cross-tenant, staff only). Every model of every domain app is
registered with a generic, read-friendly ModelAdmin; refine per model as the back-office grows.

The admin runs on the BYPASSRLS `platform` connection (see PlatformAdminMiddleware), so it sees all tenants:
list pages therefore always offer a tenant filter when the model has one.
"""
from django.apps import apps as django_apps
from django.contrib import admin
from django.contrib.postgres.fields import ArrayField
from django.db import models

AUDIT_FIELDS = {"created_at", "updated_at", "created_by", "updated_by", "deleted_at", "row_version", "last_login"}
SEARCHABLE = ("name", "code", "email", "display_name", "subject", "party_id", "key_prefix", "event_type")
FILTERABLE = ("status", "channel", "campaign_type", "run_type", "list_kind", "tag_kind", "auth_provider",
              "isolation_mode", "is_active", "is_staff", "tenant")
SECRET_FIELDS = {"password", "key_hash"}


class GenericAdmin(admin.ModelAdmin):
    list_per_page = 50
    show_full_result_count = False                        # no COUNT(*) over partitioned execution tables
    list_select_related = False

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
    """Call from <app>/admin.py: register_app_models(__package__)."""
    config = django_apps.get_containing_app_config(f"{package}.models")
    for model in config.get_models():
        if isinstance(model._meta.pk, models.CompositePrimaryKey):
            continue                                       # Django Admin cannot address composite-key rows (link tables, usage counters)
        if not admin.site.is_registered(model):
            admin.site.register(model, GenericAdmin)


admin.site.site_header = "CEP platform administration"
admin.site.site_title = "CEP admin"
admin.site.index_title = "All tenants · internal staff only"
