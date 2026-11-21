"""Blackout dates (patch 0093): days with no marketing on any channel, in the workspace's time zone. A run due on one waits for
the next clear day and then for its send window; the platform's dates reach the workspaces locked. Rolled back."""
import json
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.db import connections, transaction
from django.test import Client
from django.utils.timezone import now
from rest_framework_simplejwt.tokens import AccessToken

from apps.governance import blackout, platform, windows
from apps.governance.models import CommunicationGovernancePolicy
from apps.identity.models import AppUser
from apps.platform_ops.models import PlatformGovernancePolicy
from apps.tenants import context
from apps.tenants.models import Tenant

P = "platform"
ZONE = ZoneInfo("America/New_York")
B = blackout.Blackout


def test_a_blackout_covers_its_days_every_year_across_the_new_year_and_on_leap_days():
    christmas = B(date(2026, 12, 25), date(2026, 12, 25), True, "Christmas")
    holidays = B(date(2026, 12, 24), date(2027, 1, 2), True, "Holidays")
    migration = B(date(2026, 11, 30), date(2026, 12, 1), False, "Migration")
    assert christmas.covers(date(2031, 12, 25)) and not christmas.covers(date(2031, 12, 26))
    assert holidays.covers(date(2027, 12, 30)) and holidays.covers(date(2028, 1, 1)) and not holidays.covers(date(2028, 1, 3))
    assert migration.covers(date(2026, 12, 1)) and not migration.covers(date(2027, 11, 30))                # a one-off date does not come back
    assert B(date(2028, 2, 29), date(2028, 2, 29), True).covers(date(2027, 2, 28))                         # 29 February is the 28th in other years
    assert blackout.next_clear_day([christmas, holidays], date(2026, 12, 24)) == date(2027, 1, 3)
    assert blackout.next_clear_day([christmas], date(2026, 12, 24)) == date(2026, 12, 24)
    assert holidays.next_start(date(2027, 1, 1)) == date(2026, 12, 24) and holidays.next_start(date(2027, 1, 3)) == date(2027, 12, 24)
    assert migration.next_start(date(2026, 12, 2)) is None
    assert blackout.describe(date(2026, 12, 25), date(2026, 12, 25), True) == "25 Dec, every year"
    assert blackout.describe(date(2026, 12, 24), date(2027, 1, 2), True) == "24 Dec – 2 Jan, every year"
    assert blackout.describe(date(2026, 11, 30), date(2026, 12, 1), False) == "30 Nov – 1 Dec 2026"
    assert blackout.describe(date(2027, 1, 1), date(2027, 1, 1), False) == "1 Jan 2027"


def _office(admin_email):
    token = context.set_platform(True)
    admin = AppUser.objects.using(P).select_related("tenant").get(email=admin_email)
    context.reset_platform(token)
    context.set_current(str(admin.tenant_id), "default", str(admin.pk))
    return admin, Client(HTTP_X_TENANT=admin.tenant.code, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(admin)))


def _errors(response) -> dict:
    body = response.json()
    return body.get("errors", body) if isinstance(body, dict) else {}


@pytest.mark.django_db(databases=["default", "platform"])
def test_the_workspace_adds_its_own_blackout_dates_beside_the_platform_ones_and_a_send_due_on_one_waits(check, admin_email):
    admin, office = _office(admin_email)
    tenant_id = str(admin.tenant_id)
    soon = date.today() + timedelta(days=10)
    with transaction.atomic(using="default"), transaction.atomic(using=P):
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [tenant_id])
            cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(admin.pk)])
        CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).update(deleted_at=now())   # this workspace's rules would blur it
        rule = PlatformGovernancePolicy.objects.create(name="Test Boxing Day", scope="GLOBAL", max_messages=1, period_days=1,
                                                       blackout_from=date(2026, 12, 26), blackout_to=date(2026, 12, 26), blackout_yearly=True, applies_all=True)
        locked = CommunicationGovernancePolicy.objects.create(tenant_id=tenant_id, name="Test Boxing Day", scope="GLOBAL", max_messages=1, period_days=1,
                                                              blackout_from=date(2026, 12, 26), blackout_to=date(2026, 12, 26), blackout_yearly=True, platform_policy_id=rule.pk)

        post = lambda body: office.post("/api/v1/workspace/governance/blackouts/", json.dumps(body), content_type="application/json")  # noqa: E731
        patch = lambda pk, body: office.patch(f"/api/v1/workspace/governance/blackouts/{pk}/", json.dumps(body), content_type="application/json")  # noqa: E731

        made = post({"name": "  Christmas ", "from": "2026-12-25", "yearly": True})
        rows = made.json()["blackouts"] if made.status_code == 201 else []
        own = next((row for row in rows if row["name"] == "Christmas"), None)
        check("a yearly date of the workspace's own: one day, named, worded", made.status_code == 201 and own is not None and own["rule"] == "25 Dec, every year"
              and own["to"] == "2026-12-25" and own["platform"] is False and own["is_active"] is True, made.content[:400])
        check("the platform's date is listed too, locked", any(row["id"] == str(locked.pk) and row["platform"] for row in rows), rows)
        check("soonest first", [row["name"] for row in rows][:2] == ["Christmas", "Test Boxing Day"], [row["name"] for row in rows])

        check("no name is refused on Name", "name" in _errors(post({"name": " ", "from": "2026-12-25"})))
        check("an end before the start is refused on To", "to" in _errors(post({"name": "Backwards", "from": str(soon), "to": str(soon - timedelta(days=1))})))
        check("more than 31 days is refused on To", "to" in _errors(post({"name": "Too Long", "from": str(soon), "to": str(soon + timedelta(days=31))})))
        check("a one-off date that has passed is refused on From", "from" in _errors(post({"name": "Last Year", "from": "2025-01-01"})))
        check("a name another rule has is refused", "name" in _errors(post({"name": "Christmas", "from": str(soon)})))
        ranged = post({"name": "Migration", "from": str(soon), "to": str(soon + timedelta(days=2))})
        check("a range of three days from now on is kept", ranged.status_code == 201, ranged.content[:300])

        page = office.get("/api/v1/workspace/governance/").json()
        check("a blackout is not a cap", {str(locked.pk), own["id"] if own else ""}.isdisjoint({row["id"] for row in page["caps"]}), page["caps"])
        check("the page carries the dates", len(page.get("blackouts", [])) == 3, page.get("blackouts"))

        renamed = patch(own["id"], {"name": "Christmas Day"})
        check("renamed on the same row", renamed.status_code == 200 and any(row["id"] == own["id"] and row["name"] == "Christmas Day" for row in renamed.json()["blackouts"]))
        check("the platform's date cannot be changed here", patch(str(locked.pk), {"name": "Mine Now"}).status_code == 403)
        check("an unknown date is not found", patch("00000000-0000-4000-8000-000000000000", {"name": "X"}).status_code == 404)

        # a window for email: 07:00 to 21:00 every day, so the waits below end at a window's opening
        office.put("/api/v1/workspace/governance/windows/EMAIL/", json.dumps({"start": "07:00", "end": "21:00", "days": list(windows.EVERY_DAY), "is_active": True}),
                   content_type="application/json")
        with connections["default"].cursor() as cursor:
            hold = lambda channel, moment: windows.hold_until(cursor, tenant_id, channel, "America/New_York", now=moment)  # noqa: E731
            opens, words = hold("EMAIL", datetime(2026, 12, 25, 10, 0, tzinfo=ZONE))
            check("an email due on Christmas waits past Boxing Day (the platform's) to 27 December at 07:00", opens == datetime(2026, 12, 27, 7, 0, tzinfo=ZONE)
                  and words.startswith("Blackout date (Christmas Day)"), (opens, words))
            opens, words = hold("EMAIL", datetime(2026, 12, 24, 22, 0, tzinfo=ZONE))
            check("an email due after the window shuts on Christmas Eve: the window would open on Christmas, so it waits to the 27th",
                  opens == datetime(2026, 12, 27, 7, 0, tzinfo=ZONE) and words.startswith("Blackout date"), (opens, words))
            check("Christmas Eve at noon goes now", hold("EMAIL", datetime(2026, 12, 24, 12, 0, tzinfo=ZONE)) == (None, ""))
            opens, words = hold("WHATSAPP", datetime(2027, 12, 25, 12, 0, tzinfo=ZONE))
            check("every channel, every year: WhatsApp on Christmas 2027 waits to the 27th", opens is not None and opens.date() == date(2027, 12, 27)
                  and words.startswith("Blackout date"), (opens, words))
            opens, words = hold("SMS", datetime(2026, 12, 25, 12, 0, tzinfo=ZONE))
            check("a text on Christmas waits to the 27th (then for any quiet hours)", opens is not None and opens.date() == date(2026, 12, 27), (opens, words))

        off = patch(own["id"], {"is_active": False})
        check("switched off, it stays listed", off.status_code == 200 and any(row["id"] == own["id"] and not row["is_active"] for row in off.json()["blackouts"]))
        with connections["default"].cursor() as cursor:
            opens, _ = windows.hold_until(cursor, tenant_id, "EMAIL", "America/New_York", now=datetime(2026, 12, 25, 10, 0, tzinfo=ZONE))
            check("switched off, Christmas no longer holds; Boxing Day still does not touch the 25th", opens is None, opens)
        removed = office.delete(f"/api/v1/workspace/governance/blackouts/{own['id']}/")
        check("removed", removed.status_code == 200 and own["id"] not in {row["id"] for row in removed.json()["blackouts"]})
        check("the platform's cannot be removed here", office.delete(f"/api/v1/workspace/governance/blackouts/{locked.pk}/").status_code == 403)
        transaction.set_rollback(True, using="default")
        transaction.set_rollback(True, using=P)
    check.done()


@pytest.mark.django_db(databases=["default", "platform"])
def test_a_platform_blackout_reaches_the_workspace_and_the_back_office_form_makes_one_for_every_channel(check):
    from apps.platform_ops.admin_governance import BLACKOUT, ONE, PlatformPolicyForm
    token = context.set_platform(True)
    try:
        with transaction.atomic(using=P):
            made = Tenant.objects.using(P).create(name="Governance Blackout Test", code="ZZGOVD")
            with connections[P].cursor() as cursor:
                cursor.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [str(made.pk)])
            form = PlatformPolicyForm(data={"name": "Test New Year", "kind": BLACKOUT, "scope": "CHANNEL", "channel": "EMAIL", "blackout_from": "2027-01-01",
                                            "blackout_yearly": "on", "priority": 10, "is_active": "on", "reach": ONE, "workspace": str(made.pk)})
            check("the form takes a blackout with no end: one day, every channel", form.is_valid(), form.errors)
            policy = form.save(commit=False)
            check("saved as every channel, one day, every year", (policy.scope, policy.channel, policy.blackout_from, policy.blackout_to, policy.blackout_yearly)
                  == ("GLOBAL", None, date(2027, 1, 1), date(2027, 1, 1), True), (policy.scope, policy.channel, policy.blackout_to))
            policy.save(using=P)
            check("the back-office names it", policy.rule() == "No marketing 1 Jan, every year", policy.rule())
            platform.push(policy, using=P)
            copy = CommunicationGovernancePolicy.objects.using(P).get(platform_policy_id=policy.pk, tenant_id=made.pk, deleted_at__isnull=True)
            check("the workspace's copy carries the dates", (copy.blackout_from, copy.blackout_to, copy.blackout_yearly, copy.scope) == (date(2027, 1, 1), date(2027, 1, 1), True, "GLOBAL"))
            too_long = PlatformPolicyForm(data={"name": "Test Too Long", "kind": BLACKOUT, "scope": "GLOBAL", "blackout_from": "2027-01-01", "blackout_to": "2027-02-15",
                                                "priority": 10, "is_active": "on", "reach": ONE, "workspace": str(made.pk)})
            check("more than 31 days is refused", not too_long.is_valid() and "blackout_to" in too_long.errors, too_long.errors)
            transaction.set_rollback(True, using=P)
    finally:
        context.reset_platform(token)
    check.done()
