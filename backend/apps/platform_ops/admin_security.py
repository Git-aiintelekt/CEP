"""Back-office → Security: what needs updating on this server, worst first (apps/platform_ops/security.py does the checks).

    /admin/platform_ops/securityfinding/                  the page
    /admin/platform_ops/securityfinding/check/            Check Now (POST)
    /admin/platform_ops/securityfinding/<id>/accept/      Accept the Risk: a reason and a review date
    /admin/platform_ops/securityfinding/<id>/reopen/      an accepted item open again (POST)
"""
from datetime import date, timedelta

from django.contrib import admin, messages
from django.http import HttpResponseNotAllowed, HttpResponseRedirect
from django.shortcuts import render
from django.urls import path, reverse

from apps.adminutils import BaseAdmin

from . import security
from .models import SecurityFinding

SEVERITY_WORDS = {"CRITICAL": ("Critical", "danger"), "HIGH": ("High", "danger"), "MEDIUM": ("Medium", "warning"), "LOW": ("Low", "neutral")}
WHERE_WORDS = {"PyPI": "Backend · Python", "npm": "Frontend · npm"}
KIND_WORDS = {"SETTING": "Server setting", "HEADER": "Site header"}


def _shown(row: dict) -> dict:
    word, pill = SEVERITY_WORDS[row["severity"]]
    return {**row, "severity_word": word, "severity_pill": pill, "where": WHERE_WORDS.get(row["ecosystem"]) or KIND_WORDS.get(row["kind"], row["kind"].title()),
            "first_advisory": (row["advisories"] or [None])[0], "more_advisories": max(0, len(row["advisories"] or []) - 1), "is_package": row["kind"] == "PACKAGE"}


@admin.register(SecurityFinding)
class SecurityFindingAdmin(BaseAdmin):
    """The list is the Security page; findings are written by the check, never by hand."""

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def get_urls(self):
        view = self.admin_site.admin_view
        return [path("check/", view(self.check_view), name="platform_ops_securityfinding_check"),
                path("<int:finding_id>/accept/", view(self.accept_view), name="platform_ops_securityfinding_accept"),
                path("<int:finding_id>/reopen/", view(self.reopen_view), name="platform_ops_securityfinding_reopen"),
                *super().get_urls()]

    def changelist_view(self, request, extra_context=None):
        data = security.overview()                                    # None before patch 0066
        context = {**self.admin_site.each_context(request), "title": "Security", "data": data, "can_change": self.has_change_permission(request),
                   "open": [_shown(r) for r in (data or {}).get("open", [])], "accepted": [_shown(r) for r in (data or {}).get("accepted", [])],
                   "next_check": (data["last"]["started_at"] + timedelta(days=1)) if data and data["last"] else None}
        return render(request, "admin/platform_ops/security.html", context)

    def check_view(self, request):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        try:
            result = security.run("MANUAL", request.user.pk)
        except Exception as exc:                                       # noqa: BLE001
            messages.error(request, f"The check did not finish: {exc}")
        else:
            open_now = sum(result[s] for s in security.SEVERITIES)
            note = f" {result['error']}" if result.get("error") else ""
            (messages.warning if result.get("error") else messages.success)(
                request, f"Checked {result['python'] + result['npm']:,} packages and the settings: {open_now} open, {result['fixed']} fixed since the last check.{note}")
        return HttpResponseRedirect(reverse("admin:platform_ops_securityfinding_changelist"))

    def accept_view(self, request, finding_id):
        if not self.has_change_permission(request):
            messages.error(request, "Accepting a risk needs a platform superuser.")
            return HttpResponseRedirect(reverse("admin:platform_ops_securityfinding_changelist"))
        row = next((r for r in (security.overview() or {}).get("open", []) if r["id"] == finding_id), None)
        if row is None:
            messages.error(request, "That item is not open on this server.")
            return HttpResponseRedirect(reverse("admin:platform_ops_securityfinding_changelist"))
        error = None
        review_on = (date.today() + timedelta(days=90)).isoformat()
        if request.method == "POST":
            reason = " ".join(str(request.POST.get("reason") or "").split())
            review_on = str(request.POST.get("review_on") or "")
            try:
                when = date.fromisoformat(review_on)
            except ValueError:
                when = None
            if len(reason) < 10:
                error = "Say why the risk is acceptable, in a sentence."
            elif when is None or when <= date.today() or when > date.today() + timedelta(days=366):
                error = "Choose a review date after today and within a year."
            else:
                security.accept(finding_id, request.user.pk, reason, when)
                messages.success(request, f"{row['title']} is accepted until {when:%d %b %Y}.")
                return HttpResponseRedirect(reverse("admin:platform_ops_securityfinding_changelist"))
        context = {**self.admin_site.each_context(request), "title": f"Accept the Risk: {row['title']}", "row": _shown(row), "error": error,
                   "reason": request.POST.get("reason", ""), "review_on": review_on, "list_url": reverse("admin:platform_ops_securityfinding_changelist")}
        return render(request, "admin/platform_ops/security_accept.html", context)

    def reopen_view(self, request, finding_id):
        if request.method != "POST" or not self.has_change_permission(request):
            return HttpResponseNotAllowed(["POST"])
        security.reopen(finding_id)
        messages.success(request, "The item is open again.")
        return HttpResponseRedirect(reverse("admin:platform_ops_securityfinding_changelist"))
