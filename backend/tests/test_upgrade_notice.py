"""The upgrade notice every signed-in person sees, in every workspace (apps.platform_ops.upgrade): the state and its stale
rules, the public status call, the install script's command and Platform → Scheduled Upgrade in the back-office. Rolled back.

Writes go to the platform connection; in a rolled-back test the default connection cannot see them, so the rows are read
back on the platform connection and public() is checked against a given state."""
import json
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest import mock

import pytest
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.core.management import CommandError, call_command
from django.db import connections
from django.test import Client
from django.utils import timezone

from apps.identity.models import AppUser
from apps.platform_ops import upgrade

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS
NOW = datetime(2026, 11, 20, 14, 0, tzinfo=dt_timezone.utc)


def _row() -> dict:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT value FROM platform_setting WHERE key = 'platform.upgrade'")
        found = cursor.fetchone()
    value = found[0] if found else None
    return json.loads(value) if isinstance(value, str) else (value or {})


def _given(state: dict):
    return mock.patch.object(upgrade, "stored", lambda fresh=False: state)


def test_the_state_people_are_told_and_stale_ones_put_right(check):
    starts = NOW + timedelta(hours=2)
    with _given({"state": "SCHEDULED", "starts_at": starts.isoformat(), "minutes": 10, "note": "New reports.", "changed_at": NOW.isoformat()}):
        shown = upgrade.public(NOW)
    check("a schedule ahead: its start, length and note", shown["state"] == "SCHEDULED" and shown["minutes"] == 10 and shown["note"] == "New reports."
          and datetime.fromisoformat(shown["starts_at"]) == starts, str(shown))
    with _given({"state": "SCHEDULED", "starts_at": (NOW - timedelta(hours=2)).isoformat(), "minutes": 10}):
        check("a schedule long past that nobody marked as upgrading stops showing", upgrade.public(NOW) == {"state": "NONE"})
    with _given({"state": "UPGRADING", "minutes": 10, "changed_at": (NOW - timedelta(minutes=20)).isoformat()}):
        check("an upgrade that started 20 minutes ago is still upgrading", upgrade.public(NOW)["state"] == "UPGRADING")
    with _given({"state": "UPGRADING", "minutes": 10, "changed_at": (NOW - timedelta(minutes=61)).isoformat()}):
        check("one nobody marked done goes away after an hour, so no page stays dimmed", upgrade.public(NOW) == {"state": "NONE"})
    with _given({"state": "DONE", "version": "v1.2.2", "changed_at": (NOW - timedelta(minutes=30)).isoformat()}):
        check("done: shown with the release for an hour", upgrade.public(NOW)["version"] == "v1.2.2")
    with _given({"state": "DONE", "version": "v1.2.2", "changed_at": (NOW - timedelta(minutes=61)).isoformat()}):
        check("and then not", upgrade.public(NOW) == {"state": "NONE"})
    with mock.patch.object(upgrade.params, "get", lambda key, default=None: {"state": "SOMETHING"} if key == upgrade.KEY else default):
        check("an unreadable value reads as nothing planned", upgrade.public(NOW) == {"state": "NONE"})
    check.done()


def test_a_schedule_is_checked_before_it_is_kept(check):
    def refused(call) -> str:
        try:
            call()
        except upgrade.UpgradeError as error:
            return str(error)
        return ""

    ahead = (timezone.now() + timedelta(days=1)).strftime("%Y-%m-%d %H:%M")
    check("a start in the past is refused", "in the past" in refused(lambda: upgrade.local_start("2020-01-01 10:00", "UTC")))
    check("an unknown time zone is refused", "not a time zone" in refused(lambda: upgrade.local_start(ahead, "Mars/Olympus")))
    check("words that are not a time are refused", "date and time" in refused(lambda: upgrade.local_start("tonight", "UTC")))
    start = upgrade.local_start(ahead, "Asia/Singapore")
    check("a local time is read in its own zone", start.utcoffset() == timedelta(hours=8), str(start))
    check("a length of 0 or over 240 minutes is refused", "between 1 and 240" in refused(lambda: upgrade.schedule(start, 0)) and "between 1 and 240" in refused(lambda: upgrade.schedule(start, 300)))
    check("a long note is refused", "under 200" in refused(lambda: upgrade.schedule(start, 10, "x" * 201)))
    check.done()


def test_every_page_can_ask_without_a_workspace_or_a_sign_in(check):
    starts = timezone.now() + timedelta(hours=3)
    with _given({"state": "SCHEDULED", "starts_at": starts.isoformat(), "minutes": 15, "note": "", "changed_at": timezone.now().isoformat()}):
        response = Client().get("/api/v1/platform-status/")
    check("200 with no X-Tenant and no token", response.status_code == 200, str(response.status_code))
    check("never cached", response["Cache-Control"] == "no-store")
    check("the upgrade as public() gives it", response.json()["upgrade"]["state"] == "SCHEDULED" and response.json()["upgrade"]["minutes"] == 15, response.content[:200])
    check.done()


def test_the_install_scripts_command(check, capsys):
    ahead = (timezone.now() + timedelta(days=2)).strftime("%Y-%m-%d 22:00")
    call_command("upgrade_notice", "schedule", "--at", ahead, "--zone", "Asia/Singapore", "--minutes", "12", "--note", "  New   reports. ")
    row = _row()
    check("schedule keeps the start in UTC, the length, the zone and a tidied note", row["state"] == "SCHEDULED" and row["minutes"] == 12 and row["zone"] == "Asia/Singapore"
          and row["note"] == "New reports." and datetime.fromisoformat(row["starts_at"]).utcoffset() == timedelta(0), str(row))
    call_command("upgrade_notice", "start")
    row = _row()
    check("start: upgrading, keeping the schedule's length and note", row["state"] == "UPGRADING" and row["minutes"] == 12 and row["note"] == "New reports.", str(row))
    call_command("upgrade_notice", "done", "--release", "v9.9.9")
    check("done names the release", _row()["state"] == "DONE" and _row()["version"] == "v9.9.9", str(_row()))
    call_command("upgrade_notice", "clear")
    check("clear: nothing planned", _row()["state"] == "NONE")
    with pytest.raises(CommandError) as refused:
        call_command("upgrade_notice", "schedule", "--at", "2020-01-01 10:00")
    check("a past start is refused in words", "in the past" in str(refused.value), str(refused.value))
    with pytest.raises(CommandError):
        call_command("upgrade_notice", "schedule")
    check.done()


def test_scheduled_upgrade_in_the_back_office(check):
    staff = AppUser.objects.using(P).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
    if staff is None:
        pytest.skip("no platform superuser in this database")
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        office = Client()
        office.force_login(staff)
        page = office.get("/admin/platform_ops/platformsetting/upgrade/")
        body = page.content.decode()
        check("the page opens with its two parts", page.status_code == 200 and "Scheduled Upgrade" in body and "Right Now" in body and "Schedule an Upgrade" in body, str(page.status_code))
        check("the sidebar links to it", 'href="/admin/platform_ops/platformsetting/upgrade/"' in body)

        ahead = (timezone.now() + timedelta(days=1)).strftime("%Y-%m-%dT21:30")
        saved = office.post("/admin/platform_ops/platformsetting/upgrade/", {"do": "save", "starts": ahead, "zone": "Asia/Kolkata", "minutes": "20", "note": "New reports."})
        row = _row()
        check("Save schedules it and comes back to the page", saved.status_code == 302 and row["state"] == "SCHEDULED" and row["minutes"] == 20 and row["zone"] == "Asia/Kolkata", str(row))
        check("by the person who saved it", _updated_by() == staff.pk)
        starts = datetime.fromisoformat(row["starts_at"])
        with mock.patch.object(upgrade, "stored", lambda fresh=False: row):
            shown = office.get("/admin/platform_ops/platformsetting/upgrade/").content.decode()
        check("Right Now gives the start in the schedule's own zone, as the form does", "21:30 (Asia/Kolkata)" in shown and starts.astimezone(dt_timezone.utc).strftime("%H:%M (Asia") not in shown)

        refused = office.post("/admin/platform_ops/platformsetting/upgrade/", {"do": "save", "starts": "2020-01-01T10:00", "zone": "UTC", "minutes": "10", "note": ""})
        check("a past start stays on the page with the reason", refused.status_code == 200 and "in the past" in refused.content.decode())

        office.post("/admin/platform_ops/platformsetting/upgrade/", {"do": "start"})
        check("Mark as Upgrading", _row()["state"] == "UPGRADING")
        office.post("/admin/platform_ops/platformsetting/upgrade/", {"do": "done", "release": "v9.9.9"})
        check("Mark as Done, with the release", _row()["state"] == "DONE" and _row()["version"] == "v9.9.9")
        office.post("/admin/platform_ops/platformsetting/upgrade/", {"do": "remove"})
        check("Clear", _row()["state"] == "NONE")
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    check.done()


def _updated_by():
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT updated_by FROM platform_setting WHERE key = 'platform.upgrade'")
        return cursor.fetchone()[0]
