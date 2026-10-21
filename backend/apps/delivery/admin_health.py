"""Back-office → Engine Health: every active sending engine of every workspace, worst first (apps/delivery/health.py does the checks).

    /admin/delivery/deliveryproviderhealth/              the page
    /admin/delivery/deliveryproviderhealth/run/          Run Checks Now (POST): the check-engine-health job
    /admin/delivery/deliveryproviderhealth/daily/        Run Daily Check (POST): every engine's Check, nothing sent
"""
from django.contrib import admin, messages
from django.http import HttpResponseNotAllowed, HttpResponseRedirect
from django.shortcuts import render
from django.urls import path, reverse

from apps.adminutils import BaseAdmin

from . import health
from .models import DeliveryProviderHealth

PILL = {"FAILING": ("Failing", "danger"), "ATTENTION": ("Attention", "warning"), "HEALTHY": ("Healthy", "ok"), "QUIET": ("Quiet", "neutral")}
VALUE_STATE = {health.FAILING: "over", health.ATTENTION: "near"}


def _shown(engine: dict) -> dict:
    word, kind = PILL.get(engine["status"], ("Not Checked Yet", "neutral"))
    if engine["standing"]:
        word = "No Receipts Yet"
    checks = engine["checks"]
    cell = {key: {"value": (checks.get(key) or {}).get("value") or "—", "state": VALUE_STATE.get((checks.get(key) or {}).get("state"), ""),
                  "off": (checks.get(key) or {}).get("state") in (health.OFF, None)}
            for key in ("callbacks", "refused", "speed", "bounces", "receipts", "daily_check")}
    return {**engine, "word": word, "kind": kind, "cell": cell, "channel_word": "Texts" if engine["channel"] != "EMAIL" else "Email",
            "sent_1h": (engine["figures"] or {}).get("sent_1h")}


@admin.register(DeliveryProviderHealth)
class EngineHealthAdmin(BaseAdmin):
    """The list is the Engine Health page; results are written by the check-engine-health job, never by hand."""

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def get_urls(self):
        view = self.admin_site.admin_view
        return [path("run/", view(self.run_view), name="delivery_deliveryproviderhealth_run"),
                path("daily/", view(self.daily_view), name="delivery_deliveryproviderhealth_daily"),
                *super().get_urls()]

    def changelist_view(self, request, extra_context=None):
        data = health.overview()                                       # None before patch 0068
        context = {**self.admin_site.each_context(request), "title": "Engine Health", "data": data, "can_change": self.has_change_permission(request),
                   "engines": [_shown(engine) for engine in (data or {}).get("engines", [])]}
        return render(request, "admin/delivery/engine_health.html", context)

    def run_view(self, request):
        if request.method != "POST" or not self.has_change_permission(request):
            return HttpResponseNotAllowed(["POST"])
        try:
            result = health.run()
        except Exception as exc:                                       # noqa: BLE001
            messages.error(request, f"The checks did not finish: {exc}")
        else:
            if result.get("skipped"):
                messages.warning(request, "Engine Health needs a database update (patch 0068).")
            else:
                note = f" {len(result['errors'])} workspace{'s' if len(result['errors']) != 1 else ''} could not be checked." if result["errors"] else ""
                messages.success(request, f"Checked {result['engines']} engine{'s' if result['engines'] != 1 else ''}: {result['FAILING']} failing, "
                                          f"{result['ATTENTION']} need attention.{note}")
        return HttpResponseRedirect(reverse("admin:delivery_deliveryproviderhealth_changelist"))

    def daily_view(self, request):
        if request.method != "POST" or not self.has_change_permission(request):
            return HttpResponseNotAllowed(["POST"])
        try:
            result = health.check_all()
        except Exception as exc:                                       # noqa: BLE001
            messages.error(request, f"The Check did not finish: {exc}")
        else:
            failed = result["failed"]
            (messages.warning if failed else messages.success)(
                request, f"Checked {result['checked']} engine{'s' if result['checked'] != 1 else ''}"
                         + (f": {len(failed)} failed ({'; '.join(failed[:3])})." if failed else ": every key and address was accepted."))
        return HttpResponseRedirect(reverse("admin:delivery_deliveryproviderhealth_changelist"))
