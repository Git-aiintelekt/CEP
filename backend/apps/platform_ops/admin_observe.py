"""Back-office pages for observability: Errors, Uptime, and Tenant performance (the views live on the tenant admin)."""
import re
from datetime import timedelta

from django.conf import settings
from django.contrib import admin, messages
from django.db import connections
from django.db.models import Count
from django.http import Http404, HttpResponseRedirect
from django.shortcuts import render
from django.urls import path, reverse
from django.utils import timezone
from unfold.decorators import action, display

from apps.adminutils import BaseAdmin

from . import observe
from .models import ErrorEvent, ErrorGroup, UptimeCheck, UptimeTarget

P = settings.PLATFORM_ALIAS
WINDOWS = {"1h": (1, "Last hour"), "24h": (24, "Last 24 hours"), "7d": (24 * 7, "Last 7 days")}
SOURCE_ICON = {"BACKEND": "dns", "BROWSER": "web", "JOB": "schedule"}


def _window(request):
    key = request.GET.get("window", "24h")
    key = key if key in WINDOWS else "24h"
    return key, *WINDOWS[key]


# ------------------------------------------------------------------------------------------------------------ errors
class ErrorStateFilter(admin.SimpleListFilter):
    """Open errors unless another state is picked: the list is a to-do list."""
    title = "state"
    parameter_name = "state"
    STATES = {"open": {"status": "OPEN"}, "regressed": {"status": "OPEN", "regressed_at__isnull": False}, "resolved": {"status": "RESOLVED"},
              "ignored": {"status": "IGNORED"}, "all": {}}

    def lookups(self, request, model_admin):
        return (("open", "Open"), ("regressed", "Regressed"), ("resolved", "Resolved"), ("ignored", "Ignored"), ("all", "All"))

    def queryset(self, request, queryset):
        return queryset.filter(**self.STATES.get(self.value() or "open", self.STATES["open"]))

    def choices(self, changelist):
        current = self.value() or "open"
        for lookup, title in self.lookup_choices:
            yield {"selected": current == lookup, "query_string": changelist.get_query_string({self.parameter_name: lookup}), "display": title}


@admin.register(ErrorGroup)
class ErrorGroupAdmin(BaseAdmin):
    """Written by the API, the jobs and the browsers. Resolve an error once it is fixed: if it comes back it reopens as a regression."""
    list_display = ("show_kind", "show_source", "occurrences", "show_tenants", "first_seen", "last_seen", "show_status")
    list_filter = (ErrorStateFilter, "source")
    search_fields = ("kind", "message", "culprit")
    ordering = ("-last_seen",)
    actions = ("resolve", "ignore", "reopen")
    list_per_page = 50

    def get_search_results(self, request, queryset, search_term):
        """A reference a user was given ("ER-123", api/exceptions.py) finds its error group."""
        match = re.fullmatch(r"\s*ER-(\d+)\s*", search_term or "", flags=re.IGNORECASE)
        if match:
            return queryset.filter(pk=int(match.group(1))), False
        return super().get_search_results(request, queryset, search_term)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(tenant_count=Count("events__tenant_id", distinct=True))

    @display(description="Error", header=True)
    def show_kind(self, obj):
        where = obj.culprit or ""
        return [obj.message[:140], f"{obj.kind}{f' · {where}' if where else ''}"]

    @display(description="Source", label={"API": "info", "Browser": "warning", "Job": "info"})
    def show_source(self, obj):
        return obj.get_source_display()

    @display(description="Status", label={"Open": "danger", "Regressed": "danger", "Resolved": "success", "Ignored": "info"})
    def show_status(self, obj):
        return "Regressed" if obj.status == "OPEN" and obj.regressed_at else obj.get_status_display()

    @display(description="Tenants")
    def show_tenants(self, obj):
        return getattr(obj, "tenant_count", 0) or "—"

    def _set(self, request, queryset, status):
        values = {"status": status, "resolved_at": timezone.now() if status == "RESOLVED" else None,
                  "resolved_by_id": request.user.pk if status in ("RESOLVED", "IGNORED") else None}
        if status == "OPEN":
            values["regressed_at"] = None
        return queryset.update(**values)

    @action(description="Resolve: fixed; reopens if it happens again")
    def resolve(self, request, queryset):
        messages.success(request, f"{self._set(request, queryset.exclude(status='RESOLVED'), 'RESOLVED')} resolved.")

    @action(description="Ignore: known and accepted; keeps counting, never alerts")
    def ignore(self, request, queryset):
        messages.success(request, f"{self._set(request, queryset.exclude(status='IGNORED'), 'IGNORED')} ignored.")

    @action(description="Reopen")
    def reopen(self, request, queryset):
        messages.success(request, f"{self._set(request, queryset.exclude(status='OPEN'), 'OPEN')} reopened.")

    def change_view(self, request, object_id, form_url="", extra_context=None):
        group = ErrorGroup.objects.using(P).filter(pk=object_id).first()
        if group is None:
            raise Http404
        if request.method == "POST":
            status = {"resolve": "RESOLVED", "ignore": "IGNORED", "reopen": "OPEN"}.get(request.POST.get("do"))
            note = (request.POST.get("note") or "").strip()
            if status:
                self._set(request, ErrorGroup.objects.using(P).filter(pk=group.pk), status)
            if note != (group.note or ""):
                ErrorGroup.objects.using(P).filter(pk=group.pk).update(note=note or None)
            messages.success(request, "Saved.")
            return HttpResponseRedirect(request.path)
        events = list(group.events.order_by("-occurred_at")[:20])
        with connections[P].cursor() as cursor:
            cursor.execute("""SELECT coalesce(e.tenant_code, '—'), e.tenant_id, count(*), max(e.occurred_at) FROM error_event e WHERE e.group_id = %s
                               GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10""", [group.pk])
            tenants = [{"code": code, "id": tid, "count": n, "last": last} for code, tid, n, last in cursor.fetchall()]
            cursor.execute("""SELECT (occurred_at AT TIME ZONE %s)::date, count(*) FROM error_event WHERE group_id = %s AND occurred_at > now() - interval '14 days'
                               GROUP BY 1 ORDER BY 1""", [settings.TIME_ZONE, group.pk])
            days = cursor.fetchall()
        counts = dict(days)
        today = timezone.localdate()
        series = [(today - timedelta(days=offset), counts.get(today - timedelta(days=offset), 0)) for offset in range(13, -1, -1)]
        peak = max((n for _, n in series), default=0)
        context = {**self.admin_site.each_context(request), "title": group.kind, "group": group, "events": events, "tenants": tenants,
                   "days": [{"day": day, "count": n, "height": max(4, round(n * 100 / peak)) if n else 0} for day, n in series] if peak else [],
                   "opts": self.model._meta, "list_url": reverse("admin:platform_ops_errorgroup_changelist")}
        return render(request, "admin/platform_ops/error_detail.html", context)


# ------------------------------------------------------------------------------------------------------------ uptime
@admin.register(UptimeTarget)
class UptimeTargetAdmin(BaseAdmin):
    """The probe-uptime job calls each active target every minute. Down after uptime.failures_before_alert failures in a
    row, which opens an Uptime alert and notifies; the first success closes it."""
    list_display = ("name", "url", "show_state", "show_since", "show_ms", "show_day", "show_week", "show_month", "last_checked_at")
    list_filter = ("state", "is_active")
    ordering = ("name",)
    actions_list = ("probe_all",)
    fields = ("name", "url", "expect_status", "expect_text", "timeout_ms", "is_active", "state", "state_since", "consecutive_failures", "last_checked_at",
              "last_ms", "last_error")
    readonly_fields = ("state", "state_since", "consecutive_failures", "last_checked_at", "last_ms", "last_error")
    change_form_after_template = "admin/platform_ops/uptime_checks.html"

    @display(description="State", label={"Up": "success", "Down": "danger", "Not checked yet": "info"})
    def show_state(self, obj):
        return obj.get_state_display()

    @display(description="Since")
    def show_since(self, obj):
        from django.utils.timesince import timesince
        return timesince(obj.state_since) if obj.state != "UNKNOWN" else "—"

    @display(description="Response")
    def show_ms(self, obj):
        return f"{obj.last_ms:,} ms" if obj.last_ms is not None else "—"

    def _percent(self, obj, hours):
        figures = observe.availability(obj.pk, hours)
        return f"{figures['percent']:g}%" if figures["percent"] is not None else "—"

    @display(description="24 h")
    def show_day(self, obj):
        return self._percent(obj, 24)

    @display(description="7 Days")
    def show_week(self, obj):
        return self._percent(obj, 24 * 7)

    @display(description="30 Days")
    def show_month(self, obj):
        return self._percent(obj, 24 * 30)

    @action(description="Probe Now", url_path="probe-all", icon="refresh")
    def probe_all(self, request):
        result = observe.probe_uptime()
        messages.success(request, f"Probed {result['checked']} target{'s' if result['checked'] != 1 else ''}."
                                  + (f" Changed: {', '.join(result['changed'])}." if result["changed"] else ""))
        return HttpResponseRedirect(reverse("admin:platform_ops_uptimetarget_changelist"))

    def change_view(self, request, object_id, form_url="", extra_context=None):
        extra = dict(extra_context or {})
        target = UptimeTarget.objects.using(P).filter(pk=object_id).first()
        if target is not None:
            extra["uptime"] = {"checks": list(UptimeCheck.objects.using(P).filter(target=target).order_by("-checked_at")[:30]),
                               "windows": [("24 hours", observe.availability(target.pk, 24)), ("7 days", observe.availability(target.pk, 24 * 7)),
                                           ("30 days", observe.availability(target.pk, 24 * 30))]}
        return super().change_view(request, object_id, form_url, extra)


# ------------------------------------------------------------------------------------------------------------ tenant performance
def performance_urls(admin_site):
    """Mounted by the tenant admin: /admin/tenants/tenant/performance/ and /admin/tenants/tenant/<id>/performance/."""
    return [path("performance/", admin_site.admin_view(performance_view), name="tenants_tenant_performance"),
            path("<uuid:tenant_id>/performance/", admin_site.admin_view(tenant_performance_view), name="tenants_tenant_performance_detail")]


def performance_view(request):
    key, hours, label = _window(request)
    rows = observe.tenant_performance(hours)
    totals = {"requests": sum(r["requests"] for r in rows), "server_errors": sum(r["server_errors"] for r in rows), "sent": sum(r["sent"] for r in rows),
              "bad": sum(1 for r in rows if r["grade"] == "bad"), "warn": sum(1 for r in rows if r["grade"] == "warn")}
    context = {**admin.site.each_context(request), "title": "Tenant Performance", "rows": rows, "totals": totals, "window": key, "window_label": label,
               "windows": [(k, v[1]) for k, v in WINDOWS.items()]}
    return render(request, "admin/platform_ops/performance.html", context)


def tenant_performance_view(request, tenant_id):
    from apps.tenants.models import Tenant
    tenant = Tenant.objects.using(P).filter(pk=tenant_id).first()
    if tenant is None:
        raise Http404
    key, hours, label = _window(request)
    summary = next((r for r in observe.tenant_performance(hours) if r["id"] == str(tenant.pk)), None)
    context = {**admin.site.each_context(request), "title": f"{tenant.name}: performance", "tenant": tenant, "row": summary,
               "detail": observe.tenant_detail(tenant.pk, hours), "window": key, "window_label": label, "windows": [(k, v[1]) for k, v in WINDOWS.items()]}
    return render(request, "admin/platform_ops/tenant_performance.html", context)


def tenant_panel(tenant_id) -> dict | None:
    """The tenant page's short summary of the last 24 hours."""
    try:
        return next((r for r in observe.tenant_performance(24) if r["id"] == str(tenant_id)), None)
    except Exception:                                      # noqa: BLE001  the tenant page has to open regardless
        return None


__all__ = ["ErrorGroupAdmin", "UptimeTargetAdmin", "performance_urls", "tenant_panel", "ErrorEvent"]
