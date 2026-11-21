"""Send windows (patch 0092): when marketing of a channel may go out, in the workspace's time zone. A run due outside waits
for the windows to open; the workspace's own window can only narrow the platform's. Rolled back."""
import json
from datetime import datetime, time
from zoneinfo import ZoneInfo

import pytest
from django.db import connections, transaction
from django.test import Client
from django.utils.timezone import now
from rest_framework_simplejwt.tokens import AccessToken

from apps.governance import windows
from apps.governance.models import CommunicationGovernancePolicy
from apps.identity.models import AppUser
from apps.platform_ops.models import PlatformGovernancePolicy
from apps.tenants import context

P = "platform"
ZONE = ZoneInfo("America/New_York")
W = windows.Window


def at(day: int, clock: str) -> datetime:
    """a moment in the week of Monday 2026-11-23, New York time"""
    hour, minute = map(int, clock.split(":"))
    return datetime(2026, 11, 22 + day, hour, minute, tzinfo=ZONE)


def test_a_window_allows_its_hours_on_its_days_and_opens_next_when_shut():
    weekdays = W(time(10), time(20), (1, 2, 3, 4, 5))
    night = W(time(22), time(2), (5,))                                     # Friday 22:00 to Saturday 02:00
    assert weekdays.allows(at(1, "10:00")) and not weekdays.allows(at(1, "20:00")) and not weekdays.allows(at(6, "12:00"))
    assert night.allows(at(5, "23:30")) and night.allows(at(6, "01:59")) and not night.allows(at(6, "02:00")) and not night.allows(at(6, "23:00"))
    assert windows.next_opening([weekdays], at(1, "12:00")) == at(1, "12:00")
    assert windows.next_opening([weekdays], at(1, "21:00")) == at(2, "10:00")
    assert windows.next_opening([weekdays], at(5, "21:00")) == at(8, "10:00")          # Friday evening: Monday
    every = W(time(8), time(21), windows.EVERY_DAY)
    assert windows.next_opening([every, weekdays], at(1, "09:00")) == at(1, "10:00")    # both must allow
    assert windows.next_opening([every, W(time(22), time(23), windows.EVERY_DAY)], at(1, "09:00")) is None
    assert windows.ever_open([every, weekdays]) and not windows.ever_open([every, W(time(22), time(23), windows.EVERY_DAY)])
    assert windows.describe(time(10), time(20), [5, 1, 2, 3, 4]) == "10:00–20:00, Mon–Fri"
    assert windows.describe(time(7), time(21), windows.EVERY_DAY) == "07:00–21:00, every day"
    assert windows.channel_family("MMS") == "SMS"


def _office(admin_email):
    token = context.set_platform(True)
    admin = AppUser.objects.using(P).select_related("tenant").get(email=admin_email)
    context.reset_platform(token)
    context.set_current(str(admin.tenant_id), "default", str(admin.pk))
    return admin, Client(HTTP_X_TENANT=admin.tenant.code, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(admin)))


@pytest.mark.django_db(databases=["default", "platform"])
def test_the_workspace_sets_its_window_inside_the_platform_one_and_a_send_outside_waits(check, admin_email):
    admin, office = _office(admin_email)
    tenant_id = str(admin.tenant_id)
    with transaction.atomic(using="default"), transaction.atomic(using=P):
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [tenant_id])
            cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(admin.pk)])
        CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).update(deleted_at=now())   # this workspace's rules would blur it
        rule = PlatformGovernancePolicy.objects.create(name="Test Text Window", scope="CHANNEL", channel="SMS", max_messages=1, period_days=1,
                                                       window_start=time(8), window_end=time(21), window_days=list(windows.EVERY_DAY), applies_all=True)
        locked = CommunicationGovernancePolicy.objects.create(tenant_id=tenant_id, name="Test Text Window", scope="CHANNEL", channel="SMS", max_messages=1, period_days=1,
                                                              window_start=time(8), window_end=time(21), window_days=list(windows.EVERY_DAY), platform_policy_id=rule.pk)

        page = office.get("/api/v1/workspace/governance/").json()
        entries = {entry["channel"]: entry for entry in page.get("windows", [])}
        check("one entry per channel; the platform's text window locked, no older quiet hours once a window exists",
              list(entries) == ["EMAIL", "SMS", "WHATSAPP"] and [(w["rule"], w["platform"]) for w in entries["SMS"]["platform"]] == [("Texts 08:00–21:00, every day", True)]
              and entries["SMS"]["quiet_hours"] is None and entries["EMAIL"]["own"] is None and entries["EMAIL"]["recommended"]["start"] == "07:00", entries)
        check("a window is neither a cap nor a gap", str(locked.pk) not in {row["id"] for row in page["caps"]})

        put = lambda channel, body: office.put(f"/api/v1/workspace/governance/windows/{channel}/", json.dumps(body), content_type="application/json")  # noqa: E731
        made = put("SMS", {"start": "10:00", "end": "20:00", "days": [1, 2, 3, 4, 5], "is_active": True})
        check("the workspace narrows texts to weekdays 10:00 to 20:00", made.status_code == 200 and made.json()["own"]["rule"] == "Texts 10:00–20:00, Mon–Fri", made.content[:300])
        refused = put("SMS", {"start": "22:00", "end": "23:00"})
        check("hours that never meet the platform's window are refused on From", refused.status_code == 400 and "start" in refused.json().get("errors", refused.json()), refused.content[:300])
        check("the same start and end are refused", put("SMS", {"start": "10:00", "end": "10:00"}).status_code == 400)
        check("no days is refused", put("SMS", {"days": []}).status_code == 400)
        check("an unknown channel is not found", put("FAX", {"start": "10:00"}).status_code == 404)
        changed = put("SMS", {"days": [1, 2, 3, 4, 5, 6]})
        check("days change on the same row", changed.status_code == 200 and changed.json()["own"]["id"] == made.json()["own"]["id"] and changed.json()["own"]["days"] == [1, 2, 3, 4, 5, 6])

        with connections["default"].cursor() as cursor:
            saturday_night = datetime(2026, 11, 28, 21, 30, tzinfo=ZONE)
            opens, words = windows.hold_until(cursor, tenant_id, "MMS", "America/New_York", now=saturday_night)
            check("a picture message on Saturday at 21:30 waits until Monday 10:00, the first moment both windows allow", opens == datetime(2026, 11, 30, 10, 0, tzinfo=ZONE)
                  and "Outside the send window for marketing texts" in words, (opens, words))
            inside = windows.hold_until(cursor, tenant_id, "SMS", "America/New_York", now=datetime(2026, 11, 30, 12, 0, tzinfo=ZONE))
            check("a text on Monday at noon goes now", inside == (None, ""), inside)
            email = windows.hold_until(cursor, tenant_id, "EMAIL", "America/New_York", now=saturday_night)
            check("email has no window here, so it never waits", email == (None, ""), email)
        off = put("SMS", {"is_active": False})
        check("switched off, the workspace's window stops applying", off.status_code == 200 and off.json()["own"]["is_active"] is False)
        transaction.set_rollback(True, using="default")
        transaction.set_rollback(True, using=P)
    check.done()
