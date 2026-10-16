"""Insights in the back-office: the semantic catalogue (datasets, their fields and sources) the platform team maps, and
each workspace's engine setting (the analytics engine, its limits and freshness)."""
from django.contrib import admin, messages
from django.shortcuts import redirect
from unfold.decorators import action
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
    """Tenant Administration → Report Engine: which analytics engine runs a workspace's reports, and its limits. The switch to
    ClickHouse: Backfill (load every dataset; runs stay on PostgreSQL while MIGRATING), Reconcile (counts on both engines),
    Activate ClickHouse, Roll Back to PostgreSQL (apps/insights/clickhouse.py)."""
    list_display = ("tenant", "engine", "status", "freshness_sla", "last_reconciled_at", "updated_at")
    fields = ("tenant", "engine", "connection_profile", "status", "freshness_sla", "query_limits", "last_reconciled_at")
    actions_detail = ("backfill_clickhouse", "reconcile_engines", "activate_clickhouse", "roll_back_postgresql")
    list_before_template = "admin/insights/engine_help.html"                   # how the page works, and the guide chapter
    change_form_before_template = "admin/insights/engine_help.html"

    def _set(self, tenant_id, request, **fields):
        from django.db import connections
        from django.conf import settings as dj
        sets = ", ".join(f"{k} = %s" for k in fields)
        with connections[dj.PLATFORM_ALIAS].cursor() as cursor:
            cursor.execute(f"UPDATE report_engine_setting SET {sets}, updated_by = %s, updated_at = now(), row_version = row_version + 1 WHERE tenant_id = %s",
                           [*fields.values(), str(request.user.pk), str(tenant_id)])
            if cursor.rowcount == 0:
                cursor.execute("""INSERT INTO report_engine_setting (tenant_id, engine, status, freshness_sla, query_limits, updated_by)
                                  VALUES (%s, %s, %s, %s, '{}'::jsonb, %s)""",
                               [str(tenant_id), fields.get("engine", "postgresql"), fields.get("status", "ACTIVE"), fields.get("freshness_sla", "LIVE"), str(request.user.pk)])

    def _back(self, object_id):
        return redirect("admin:insights_reportenginesetting_change", object_id)

    @action(description="Backfill ClickHouse: load every dataset (runs stay on PostgreSQL until Activate)")
    def backfill_clickhouse(self, request, object_id):
        from apps.delivery.engine import session
        from apps.insights import clickhouse
        if not clickhouse.configured():
            messages.error(request, "ClickHouse is not configured on this server (CLICKHOUSE_URL).")
            return self._back(object_id)
        try:
            with session.tenant_scope(str(object_id)):
                loaded = clickhouse.backfill(str(object_id))
        except Exception as exc:                                    # noqa: BLE001  the reason goes to the administrator
            messages.error(request, f"The backfill failed: {exc}")
            return self._back(object_id)
        self._set(object_id, request, engine="clickhouse", status="MIGRATING")
        messages.success(request, "Loaded into ClickHouse: " + ", ".join(f"{k} {v:,}" for k, v in loaded.items()) + ". The workspace is migrating: reports still run on PostgreSQL until Activate.")
        return self._back(object_id)

    @action(description="Reconcile: count every dataset on both engines")
    def reconcile_engines(self, request, object_id):
        from django.utils import timezone as tz
        from apps.delivery.engine import session
        from apps.insights import clickhouse
        try:
            with session.tenant_scope(str(object_id)):
                counts = clickhouse.reconcile(str(object_id))
        except Exception as exc:                                    # noqa: BLE001
            messages.error(request, f"The reconcile failed: {exc}")
            return self._back(object_id)
        self._set(object_id, request, last_reconciled_at=tz.now())
        off = [c for c in counts if c["postgresql"] != c["clickhouse"]]
        words = ", ".join(f"{c['dataset']}: PostgreSQL {c['postgresql']:,}, ClickHouse {c['clickhouse']:,}" for c in counts)
        (messages.warning if off else messages.success)(request, ("The engines differ. " if off else "The engines agree. ") + words)
        return self._back(object_id)

    @action(description="Activate ClickHouse: reports run there from now")
    def activate_clickhouse(self, request, object_id):
        self._set(object_id, request, engine="clickhouse", status="ACTIVE", freshness_sla="QUARTER_HOUR")
        messages.success(request, "ClickHouse is active for this workspace. Its reports read the reporting tables, refreshed every quarter hour.")
        return self._back(object_id)

    @action(description="Roll Back to PostgreSQL")
    def roll_back_postgresql(self, request, object_id):
        self._set(object_id, request, engine="postgresql", status="ACTIVE", freshness_sla="LIVE")
        messages.success(request, "Back on PostgreSQL: the workspace's reports read the live views again.")
        return self._back(object_id)

    def get_readonly_fields(self, request, obj=None):
        return ("tenant", "last_reconciled_at") if obj else ("last_reconciled_at",)

    def save_model(self, request, obj, form, change):
        obj.updated_by_id = request.user.pk
        obj.updated_at = timezone.now()
        super().save_model(request, obj, form, change)
