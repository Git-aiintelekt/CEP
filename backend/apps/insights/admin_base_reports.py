"""Configuration -> Base Reports (docs/mockups/base-reports.html): the platform's base packs, what each holds, and which workspaces added
which version. Read-only: packs ship with the release (apps/insights/base_packs), and a workspace adds one from Insights -> All
Reports -> Add Base Reports, which platform staff reach through Switch Workspace. Mounted under the report datasets admin's
address: /admin/insights/reportdataset/base-reports/.
"""
from django.conf import settings
from django.contrib import admin
from django.db import connections
from django.shortcuts import render
from django.urls import path

from .base_packs import PACKS

P = settings.PLATFORM_ALIAS


def _installs() -> list[dict]:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.report_base_install') IS NOT NULL")
        if not cursor.fetchone()[0]:
            return []
        cursor.execute("""SELECT i.pack_key, t.code, t.name, i.version, i.created_at, u.display_name
                            FROM report_base_install i JOIN tenant t ON t.id = i.tenant_id LEFT JOIN app_user u ON u.id = i.created_by
                           ORDER BY i.created_at DESC""")
        return [dict(zip(("pack", "code", "name", "version", "at", "by"), row)) for row in cursor.fetchall()]


def base_reports_view(request):
    installs = _installs()
    packs = []
    for pack in PACKS.values():
        latest = {}
        for row in installs:
            if row["pack"] == pack["key"] and row["code"] not in latest:
                latest[row["code"]] = row
        packs.append({"pack": pack, "datasets": [d["label"] for d in pack["datasets"]], "reports": [r["name"] for r in pack["reports"]],
                      "dashboards": [d["name"] for d in pack["dashboards"]], "workspaces": list(latest.values())})
    context = {**admin.site.each_context(request), "title": "Base Reports", "packs": packs}
    return render(request, "admin/insights/base_reports.html", context)


def base_reports_urls(admin_site):
    return [path("base-reports/", admin_site.admin_view(base_reports_view), name="insights_base_reports")]
