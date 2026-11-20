"""Platform → Scheduled Upgrade: the upgrade notice people see in every workspace (apps.platform_ops.upgrade).
The install script marks the upgrade as started and done by itself (manage.py upgrade_notice); this page schedules it
ahead and does the same by hand."""
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.contrib import messages
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse

from . import upgrade

WORDS = {"NONE": ("Nothing Planned", "neutral"), "SCHEDULED": ("Scheduled", "warning"), "UPGRADING": ("Upgrading", "info"), "DONE": ("Upgraded", "ok")}


def _zone(name: str):
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _when(iso: str | None, zone: str) -> datetime | None:
    if not iso:
        return None
    return datetime.fromisoformat(iso).astimezone(_zone(zone))


def page(admin_site, request):
    here = reverse("admin:platform_ops_upgrade")
    stored = upgrade.stored(fresh=True)
    shown = upgrade.public(state=stored)
    zone = stored.get("zone") or "UTC"
    error = None
    form = {"starts": "", "zone": zone, "minutes": stored.get("minutes") or 10, "note": stored.get("note") or "", "release": ""}
    if shown["state"] == "SCHEDULED":
        form["starts"] = _when(shown["starts_at"], zone).strftime("%Y-%m-%dT%H:%M")

    if request.method == "POST":
        what = request.POST.get("do")
        user_id = request.user.pk
        try:
            if what == "save":
                form = {**form, "starts": request.POST.get("starts", ""), "zone": (request.POST.get("zone") or "UTC").strip(),
                        "minutes": request.POST.get("minutes") or "10", "note": request.POST.get("note", "")}
                try:
                    minutes = int(form["minutes"])
                except ValueError:
                    raise upgrade.UpgradeError("Say how long it takes in minutes, such as 10.") from None
                upgrade.schedule(upgrade.local_start(form["starts"].replace("T", " "), form["zone"]), minutes, form["note"], form["zone"], user_id)
                messages.success(request, "The upgrade is scheduled. People in every workspace see the strip from now until it starts.")
            elif what == "remove":
                upgrade.clear(user_id)
                messages.success(request, "Nothing is planned now. The strip is gone from every workspace.")
            elif what == "start":
                upgrade.start(user_id)
                messages.success(request, "Marked as upgrading. Every open page dims and reconnects by itself once the services are back.")
            elif what == "done":
                release = " ".join(str(request.POST.get("release") or "").split())
                upgrade.done(release, user_id)
                messages.success(request, f"Marked as done{' (' + release + ')' if release else ''}. People see it for an hour and are offered Reload.")
            return HttpResponseRedirect(here)
        except upgrade.UpgradeError as problem:
            error = str(problem)

    word, kind = WORDS[shown["state"]]
    starts, changed = _when(shown.get("starts_at"), zone), _when(shown.get("changed_at"), zone)
    context = {**admin_site.each_context(request), "title": "Scheduled Upgrade", "form": form, "error": error, "state": shown["state"], "state_word": word,
               "state_kind": kind, "starts": starts.strftime("%d %b %Y, %H:%M") if starts else "", "zone_name": zone,
               "minutes": shown.get("minutes"), "note": shown.get("note"), "version": shown.get("version"),
               "changed": changed.strftime("%H:%M") if changed else ""}
    return render(request, "admin/platform_ops/upgrade.html", context)
