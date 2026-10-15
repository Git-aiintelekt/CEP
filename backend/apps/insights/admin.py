"""Insights in the back-office: the semantic catalogue (datasets, their fields and sources) the platform team maps, and
each workspace's engine setting (the analytics engine, its limits and freshness)."""
from django.contrib import admin
from django.utils import timezone

from apps.adminutils import BaseAdmin
from . import catalog
from .models import ReportDataset, ReportDatasetSource, ReportEngineSetting, ReportField


class ReportFieldInline(admin.TabularInline):
    model = ReportField
    extra = 0
    fields = ("key", "label", "column_name", "type", "role", "aggregates", "display_format", "sensitivity", "sort_order")
    ordering = ("sort_order", "key")


class ReportDatasetSourceInline(admin.TabularInline):
    model = ReportDatasetSource
    extra = 0
    fields = ("engine", "source_name", "status")


@admin.register(ReportDataset)
class ReportDatasetAdmin(BaseAdmin):
    """Configuration → Report Datasets: what report authors can report on, mapped to the reporting views."""
    list_display = ("label", "key", "component", "show_fields", "show_sources", "freshness_policy", "status", "sort_order")
    ordering = ("sort_order", "key")
    fields = ("key", "component", "label", "description", "primary_key", "time_field", "workspace_field", "freshness_policy", "status", "sort_order")
    inlines = [ReportFieldInline, ReportDatasetSourceInline]

    def get_readonly_fields(self, request, obj=None):
        return ("key",) if obj else ()

    @admin.display(description="Fields")
    def show_fields(self, obj):
        return obj.fields.count()

    @admin.display(description="Sources")
    def show_sources(self, obj):
        return ", ".join(f"{s.engine}: {s.source_name}" for s in obj.sources.all()) or "—"

    def save_model(self, request, obj, form, change):
        obj.updated_by_id = request.user.pk
        obj.updated_at = timezone.now()
        super().save_model(request, obj, form, change)
        catalog.invalidate()

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        catalog.invalidate()


@admin.register(ReportEngineSetting)
class ReportEngineSettingAdmin(BaseAdmin):
    """Tenant Administration → Report Engine: which analytics engine runs a workspace's reports, and its limits."""
    list_display = ("tenant", "engine", "status", "freshness_sla", "last_reconciled_at", "updated_at")
    fields = ("tenant", "engine", "connection_profile", "status", "freshness_sla", "query_limits", "last_reconciled_at")

    def get_readonly_fields(self, request, obj=None):
        return ("tenant", "last_reconciled_at") if obj else ("last_reconciled_at",)

    def save_model(self, request, obj, form, change):
        obj.updated_by_id = request.user.pk
        obj.updated_at = timezone.now()
        super().save_model(request, obj, form, change)
