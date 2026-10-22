"""Insights in the back-office: the semantic catalogue (datasets, their fields and sources) the platform team maps, and
each workspace's engine setting (the analytics engine, its limits and freshness)."""
from django import forms
from django.contrib import admin, messages
from django.shortcuts import redirect
from unfold.decorators import action
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextInputWidget
from django.utils import timezone

from apps.adminutils import BaseAdmin
from . import catalog, links
from .models import ReportDataset, ReportDatasetLink, ReportDatasetSource, ReportEngineConnection, ReportEngineSetting, ReportField


class ReportFieldForm(forms.ModelForm):
    """A field row; a formula makes it a calculated measure, checked against the dataset's other fields as the catalogue will read them."""
    class Meta:
        model = ReportField
        fields = "__all__"

    def clean(self):
        data = super().clean()
        formula = data.get("formula")
        if formula:
            dataset = data.get("dataset") or getattr(self.instance, "dataset", None)
            others = ReportField.objects.filter(dataset=dataset).exclude(pk=self.instance.pk) if dataset else ReportField.objects.none()
            siblings = [{"key": f.key, "label": f.label, "role": f.role, "aggregates": f.aggregates or [], "formula": f.formula} for f in others]
            message = catalog.formula_error(siblings, formula)
            if message:
                raise forms.ValidationError({"formula": message})
            data["type"], data["role"], data["aggregates"] = "number", "measure", [catalog.CALC]
            if not data.get("column_name"):
                data["column_name"] = data.get("key") or "formula"
        return data


class ReportFieldInline(admin.TabularInline):
    model = ReportField
    form = ReportFieldForm
    extra = 0
    fields = ("key", "label", "column_name", "type", "role", "aggregates", "display_format", "sensitivity", "sort_order", "formula")
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


LINK_STATUSES = (("ACTIVE", "Active: report authors can add the measures"), ("HIDDEN", "Hidden"))


class ReportDatasetLinkForm(forms.ModelForm):
    """The pairs must name dimensions of the two datasets, of one type each; the time pair two dates."""
    status = forms.ChoiceField(choices=LINK_STATUSES, widget=UnfoldAdminSelectWidget)

    class Meta:
        model = ReportDatasetLink
        fields = ("from_dataset", "to_dataset", "label", "pairs", "time_pair", "status", "sort_order")

    def clean(self):
        data = super().clean()
        first, second = data.get("from_dataset"), data.get("to_dataset")
        if not first or not second:
            return data
        if first == second:
            raise forms.ValidationError({"to_dataset": "Link a dataset to another one."})
        fields = {f.dataset_id + "." + f.key: f for f in ReportField.objects.filter(dataset__in=[first, second])}

        def field(dataset, key, where):
            found = fields.get(f"{dataset.pk}.{key}")
            if found is None or found.role != "dimension":
                raise forms.ValidationError({where: f"{key} is not a dimension of {dataset.label}."})
            return found
        pairs = data.get("pairs")
        if not isinstance(pairs, list) or any(not isinstance(p, list) or len(p) != 2 for p in pairs):
            raise forms.ValidationError({"pairs": "A list of pairs, each [first dataset's field, second dataset's field]."})
        for a, b in pairs:
            left, right = field(first, a, "pairs"), field(second, b, "pairs")
            if left.type != right.type:
                raise forms.ValidationError({"pairs": f"{a} is {left.type} and {b} is {right.type}; a pair is of one type."})
        time_pair = data.get("time_pair")
        if time_pair not in (None, [], ""):
            if not isinstance(time_pair, list) or len(time_pair) != 2:
                raise forms.ValidationError({"time_pair": "Two dates: [first dataset's, second dataset's]."})
            for dataset, key in zip((first, second), time_pair):
                if field(dataset, key, "time_pair").type not in ("date", "datetime"):
                    raise forms.ValidationError({"time_pair": f"{key} is not a date."})
        else:
            data["time_pair"] = None
        if not pairs and not data["time_pair"]:
            raise forms.ValidationError({"pairs": "Give at least one shared dimension, or the dates."})
        return data


@admin.register(ReportDatasetLink)
class ReportDatasetLinkAdmin(BaseAdmin):
    """Configuration → Dataset Links: two datasets that share dimensions, so a report on the first adds measures from the second."""
    form = ReportDatasetLinkForm
    list_display = ("from_dataset", "to_dataset", "label", "show_pairs", "status", "sort_order")
    ordering = ("from_dataset", "sort_order")

    @admin.display(description="Shared")
    def show_pairs(self, obj):
        shared = [a if a == b else f"{a} = {b}" for a, b in obj.pairs or []]
        if obj.time_pair:
            shared.append(f"{obj.time_pair[0]} = {obj.time_pair[1]} (dates)")
        return ", ".join(shared) or "—"

    def save_model(self, request, obj, form, change):
        obj.updated_at = timezone.now()
        if change:
            obj.row_version = (obj.row_version or 1) + 1
        super().save_model(request, obj, form, change)
        links.invalidate()
        catalog.invalidate()

    def delete_model(self, request, obj):
        super().delete_model(request, obj)
        links.invalidate()
        catalog.invalidate()


ENGINES = (("postgresql", "PostgreSQL"), ("clickhouse", "ClickHouse"))
ENGINE_STATUSES = (("ACTIVE", "Active: reports run on this engine"), ("MIGRATING", "Migrating: loading or checking, reports still run on PostgreSQL"),
                   ("READ_ONLY", "Read only"))
FRESHNESS = (("LIVE", "Live"), ("QUARTER_HOUR", "Every quarter hour (ClickHouse refresh)"), ("MINUTES_5", "Every 5 minutes"), ("HOURLY", "Hourly"), ("DAILY", "Daily"))


def _select(choices, **kwargs):
    return forms.ChoiceField(choices=choices, widget=UnfoldAdminSelectWidget, **kwargs)


class ReportEngineConnectionForm(forms.ModelForm):
    """The password is write-only: typed to set or change it, stored encrypted, never shown."""
    engine = _select(ENGINES, initial="clickhouse")
    status = _select((("ACTIVE", "Active"), ("DISABLED", "Disabled")), initial="ACTIVE")
    password = forms.CharField(required=False, widget=UnfoldAdminTextInputWidget(attrs={"type": "password", "autocomplete": "new-password"}),
                               help_text="Leave empty to keep the stored password. Stored encrypted, never shown.")

    class Meta:
        model = ReportEngineConnection
        fields = ("profile", "engine", "url", "username", "database_name", "status", "notes")

    def clean(self):
        data = super().clean()
        if data.get("engine") == "clickhouse" and data.get("url") and not str(data["url"]).startswith(("http://", "https://")):
            self.add_error("url", "ClickHouse is reached over its HTTP interface: http://host:8123 or https://host:8443.")
        if self.instance._state.adding and not self.cleaned_data.get("password"):
            self.add_error("password", "Give the connection's password.")
        return data

    def save(self, commit=True):
        from apps.platform_ops import crypto
        if self.cleaned_data.get("password"):
            self.instance.password_enc = crypto.encrypt(self.cleaned_data["password"])
        return super().save(commit)


@admin.register(ReportEngineConnection)
class ReportEngineConnectionAdmin(BaseAdmin):
    """Configuration → Report Engine Connections: the analytics engines a workspace can be pointed at. A profile named on a
    workspace's Report Engines row wins over the server's CLICKHOUSE_* environment; the password is stored encrypted."""
    form = ReportEngineConnectionForm
    list_display = ("profile", "engine", "url", "database_name", "status", "last_tested_at", "last_test_ok")
    readonly_fields = ("last_tested_at", "last_test_ok", "last_test_error", "created_at", "updated_at")
    actions_detail = ("test_connection",)
    fieldsets = (("Connection", {"fields": ("profile", "engine", "url", "username", "password", "database_name", "status", "notes")}),
                 ("Last test", {"fields": ("last_tested_at", "last_test_ok", "last_test_error", "created_at", "updated_at")}))

    @action(description="Test Connection: reach the server and read its version")
    def test_connection(self, request, object_id):
        from django.conf import settings as dj
        from django.db import connections
        from django.utils import timezone as tz
        from apps.insights import clickhouse
        row = ReportEngineConnection.objects.using(dj.PLATFORM_ALIAS).get(pk=object_id)
        ok, message = clickhouse.test(clickhouse.from_row({"profile": row.profile, "url": row.url, "username": row.username, "password_enc": row.password_enc, "database_name": row.database_name}))
        with connections[dj.PLATFORM_ALIAS].cursor() as cursor:
            cursor.execute("UPDATE report_engine_connection SET last_tested_at = %s, last_test_ok = %s, last_test_error = %s, updated_at = now() WHERE id = %s",
                           [tz.now(), ok, None if ok else message[:300], str(object_id)])
        (messages.success if ok else messages.error)(request, message)
        return redirect("admin:insights_reportengineconnection_change", object_id)


MAX_STATEMENT_TIMEOUT_MS = 110_000                                       # under the 120 s gunicorn and nginx allow a request


class ReportEngineSettingForm(forms.ModelForm):
    """Engine, status and freshness are the values the table allows; connection_profile offers the connections the back-office
    knows, or the server's environment."""
    engine = _select(ENGINES, help_text="Where this workspace's reports run. Switch with the buttons above, not by hand: they load and check ClickHouse first.")
    status = _select(ENGINE_STATUSES)
    freshness_sla = _select(FRESHNESS, label="Freshness SLA", help_text="What the line under a report's title tells people.")

    class Meta:
        model = ReportEngineSetting
        fields = ("tenant", "engine", "connection_profile", "status", "freshness_sla", "query_limits")
        help_texts = {"query_limits": 'Overrides of the defaults, e.g. {"statement_timeout_ms": 60000} for a slow or very large database. statement_timeout_ms '
                                      '(15000) is how long a report may run, on the engine and on the Report Databases, at most 110000: the web '
                                      'server stops a request after 120 seconds. Also preview_rows (200), run_rows (5000), export_rows (100000), concurrent (4).'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from django.conf import settings as dj
        from apps.insights import clickhouse
        profiles = list(ReportEngineConnection.objects.using(dj.PLATFORM_ALIAS).filter(status="ACTIVE").order_by("profile").values_list("profile", "engine")) if clickhouse.table_present() else []
        current = (self.instance.connection_profile if self.instance else "") or ""
        if current == "pg-reporting-shared":                                    # the column's old default: the environment
            current = ""
            self.initial["connection_profile"] = ""
        choices = [("", "The server's environment (CLICKHOUSE_*)")] + [(p, f"{p} · {e}") for p, e in profiles]
        if current and current not in dict(choices):
            choices.append((current, f"{current} (no such connection)"))
        self.fields["connection_profile"] = forms.ChoiceField(choices=choices, required=False, label="Connection profile", widget=UnfoldAdminSelectWidget,
                                                              help_text="Which ClickHouse this workspace loads into and reads from. Empty: the server's environment.")

    def clean_connection_profile(self):
        return self.cleaned_data.get("connection_profile") or ""

    def clean_query_limits(self):
        limits = self.cleaned_data.get("query_limits") or {}
        if not isinstance(limits, dict):
            raise forms.ValidationError('Write the limits as an object, e.g. {"statement_timeout_ms": 60000}.')
        timeout = limits.get("statement_timeout_ms")
        if timeout is not None and (not isinstance(timeout, int) or not 1_000 <= timeout <= MAX_STATEMENT_TIMEOUT_MS):
            raise forms.ValidationError(f"statement_timeout_ms is milliseconds from 1000 to {MAX_STATEMENT_TIMEOUT_MS}: the web server stops a request after 120 seconds.")
        return limits


@admin.register(ReportEngineSetting)
class ReportEngineSettingAdmin(BaseAdmin):
    """Tenant Administration → Report Engine: which analytics engine runs a workspace's reports, and its limits. The switch to
    ClickHouse: Backfill (load every dataset; runs stay on PostgreSQL while MIGRATING), Reconcile (counts on both engines),
    Activate ClickHouse, Roll Back to PostgreSQL (apps/insights/clickhouse.py)."""
    list_display = ("tenant", "engine", "status", "freshness_sla", "last_reconciled_at", "updated_at")
    fields = ("tenant", "engine", "connection_profile", "status", "freshness_sla", "query_limits", "last_reconciled_at")
    form = ReportEngineSettingForm
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
        conn = clickhouse.connection_for(str(object_id))
        if conn is None:
            messages.error(request, "No ClickHouse for this workspace: choose a connection profile on this row, or set CLICKHOUSE_URL on the server.")
            return self._back(object_id)
        try:
            with session.tenant_scope(str(object_id)):
                loaded = clickhouse.backfill(str(object_id), conn)
        except Exception as exc:                                    # noqa: BLE001  the reason goes to the administrator
            messages.error(request, f"The backfill failed: {exc}")
            return self._back(object_id)
        self._set(object_id, request, engine="clickhouse", status="MIGRATING")
        messages.success(request, f"Loaded into ClickHouse ({conn.source}): " + ", ".join(f"{k} {v:,}" for k, v in loaded.items()) + ". The workspace is migrating: reports still run on PostgreSQL until Activate.")
        return self._back(object_id)

    @action(description="Reconcile: count every dataset on both engines")
    def reconcile_engines(self, request, object_id):
        from django.utils import timezone as tz
        from apps.delivery.engine import session
        from apps.insights import clickhouse
        conn = clickhouse.connection_for(str(object_id))
        if conn is None:
            messages.error(request, "No ClickHouse for this workspace: choose a connection profile on this row, or set CLICKHOUSE_URL on the server.")
            return self._back(object_id)
        try:
            with session.tenant_scope(str(object_id)):
                counts = clickhouse.reconcile(str(object_id), conn)
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
        from apps.insights import clickhouse
        if clickhouse.connection_for(str(object_id)) is None:
            messages.error(request, "No ClickHouse for this workspace: choose a connection profile on this row, or set CLICKHOUSE_URL on the server.")
            return self._back(object_id)
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
