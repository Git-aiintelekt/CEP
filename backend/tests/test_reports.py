"""Reports API and the weekly report against the local database, rolled back. Sends go through the sandbox text engine.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from datetime import timedelta
from unittest import mock
from django.db import connection, transaction
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery import engine
from apps.delivery.engine import runs, session
from apps.identity.models import AppUser
from apps.platform_ops import notifications
from apps.reporting import reports
from apps.tenants import context
from workers import reports as weekly

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_reports(check, admin_email):
    """Reports API and the weekly report against the local database, rolled back. Sends go through the sandbox text engine."""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    analyst = AppUser.objects.get(email="priya.natarajan@northwindapparel.example")          # report.view, not user.admin
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()

    def headers(user):
        return {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(user))}

    H, HA = headers(admin), headers(analyst)

    def api(method, path, body=None, h=H):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **h)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **h)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    sent_mail = []
    NO_QUIET = mock.patch.object(runs, "quiet_until", return_value=None)
    zone = reports.zone_of(admin.tenant)
    today = timezone.now().astimezone(zone).date()

    with transaction.atomic(), mock.patch.object(notifications.mail, "send", side_effect=lambda t, to, ctx, *, subject, tenant_id=None: sent_mail.append({"to": sorted(to), "subject": subject, "lines": ctx.get("lines")}) or True):
        for n in range(5):
            party = f"ZR-P{n:02d}"
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Test', '[]'::jsonb, %s::jsonb)",
                [party, TENANT, f"Person{n}", json.dumps([{"number": f"+1470555{3000 + n}", "type": "MOBILE", "is_primary": True}])])
            sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'SMS', 'OPTED_IN', TRUE, now())", [TENANT, party])

        def make_list(name, parties):
            list_id = sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, %s, 'UPLOAD', 'PRODUCTION', %s, %s) RETURNING id",
                          [TENANT, name, len(parties), str(admin.pk)], True)[0][0]
            for party in parties:
                sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, TENANT, party])
            return str(list_id)

        big = make_list("ZR five", [f"ZR-P{n:02d}" for n in range(5)])
        small = make_list("ZR two", ["ZR-P00", "ZR-P01"])
        sandbox = api("post", "/api/v1/delivery-providers/", {"provider_type": "SANDBOX_SMS", "name": "ZR sandbox", "config": {}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": sandbox["id"], "display_name": "ZR Shop", "sender_id": "55180"}).json()
        api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "+14705550100"})
        template = api("post", "/api/v1/templates/", {"name": "ZR text", "channel": "SMS"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body) VALUES (%s, 1, %s)", [template["id"], "ZR Shop: Hi {{first_name}}. Reply STOP to opt out."])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])

        def send(name, list_id):
            campaign = api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "template": template["id"], "sender_profile": sender["id"],
                                                          "contact_lists": [list_id]}).json()
            with mock.patch("api.v1.views._enqueue_run"):
                run_id = api("post", f"/api/v1/campaigns/{campaign['id']}/publish/").json()["id"]
            with NO_QUIET:
                engine.process_run(TENANT, run_id)
            return campaign["id"], run_id

        first, run1 = send("ZR Fall Launch", big)
        second, run2 = send("ZR Loyalty Nudge", small)
        sql("UPDATE sms_execution SET status = 'DELIVERED', delivered_at = now() WHERE tenant_id = %s AND campaign_run_id = %s", [TENANT, run1])
        sql("INSERT INTO consent_record (tenant_id, party_id, channel, action, source, campaign_id, campaign_run_id, occurred_at) VALUES (%s, 'ZR-P04', 'SMS', 'OPT_OUT', 'SMS_STOP', %s, %s, now())",
            [TENANT, first, run1])

        # ---- 1. the period report
        report = api("get", f"/api/v1/reports/summary/?from={today}&to={today}&channel=SMS").json()
        rows = {row["name"]: row for row in report["campaigns"]}
        check("today's texts: totals, per-day series, per-campaign rows with delivered and unsubscribed, rates",
              report["totals"]["sent"] >= 7 and report["totals"]["campaigns"] >= 2 and {"ZR Fall Launch", "ZR Loyalty Nudge"} <= set(rows)
              and rows["ZR Fall Launch"]["sent"] == 5 and rows["ZR Fall Launch"]["delivered"] == 5 and rows["ZR Fall Launch"]["unsubscribed"] == 1 and rows["ZR Fall Launch"]["rates"]["delivery"] == 100.0
              and rows["ZR Loyalty Nudge"]["sent"] == 2 and any(day["day"] == today.isoformat() and day["sent"] >= 7 for day in report["days"]) and report["by_channel"]["SMS"]["sent"] >= 7
              and report["period"] == {"from": today.isoformat(), "to": today.isoformat(), "timezone": zone.key, "days": 1}, str(report)[:400])
        whole = api("get", "/api/v1/reports/summary/").json()
        check("no dates: this month so far, both channels, with highlights", whole["period"]["from"] == today.replace(day=1).isoformat() and whole["channel"] is None
              and set(whole["highlights"]) == {"highest_open_rate", "highest_click_rate", "most_unsubscribes", "best_send_hour"} and whole["totals"]["sent"] >= report["totals"]["sent"], str(whole["period"]))
        backwards = api("get", f"/api/v1/reports/summary/?from={today}&to={today - timedelta(days=1)}")
        fax = api("get", "/api/v1/reports/summary/?channel=FAX")
        long = api("get", f"/api/v1/reports/summary/?from={today - timedelta(days=400)}&to={today}")
        check("a period is checked in words", backwards.status_code == 400 and "before its start" in str(backwards.json()["errors"]) and fax.status_code == 400 and long.status_code == 400 and "366" in str(long.json()["errors"]),
              f"{backwards.content[:120]} {long.content[:120]}")
        csv_file = api("get", f"/api/v1/reports/campaigns.csv?from={today}&to={today}&channel=SMS")
        lines = csv_file.content.decode("utf-8-sig").splitlines()
        check("the same report as a CSV, one line per campaign and a total line", csv_file.status_code == 200 and lines[0].startswith("campaign,channel,type") and any(line.startswith("ZR Fall Launch,SMS") for line in lines)
              and lines[-1].startswith("Total,") and "attachment" in csv_file["Content-Disposition"], str(lines[:3]))

        # ---- 2. comparison
        compared = api("get", f"/api/v1/reports/compare/?ids={first},{second}").json()["campaigns"]
        one = api("get", f"/api/v1/reports/compare/?ids={first}")
        check("two campaigns side by side, each with its results and daily curve; fewer than two is refused",
              [item["name"] for item in compared] == ["ZR Fall Launch", "ZR Loyalty Nudge"] and compared[0]["metrics"]["counts"]["sent"] == 5 and compared[0]["metrics"]["counts"]["unsubscribed"] == 1
              and isinstance(compared[0]["days"], list) and one.status_code == 400, f"{one.content[:120]}")

        # ---- 3. the weekly email
        defaults = api("get", "/api/v1/reports/schedule/").json()
        no_recipients = api("put", "/api/v1/reports/schedule/", {"enabled": True})
        bad_day = api("put", "/api/v1/reports/schedule/", {"weekday": 9})
        saved = api("put", "/api/v1/reports/schedule/", {"enabled": True, "weekday": 0, "hour": 8, "recipients": ["Ops@nwa.example", admin_email]}).json()
        check("the schedule: off by default, Monday 08:00; switching on needs recipients; the weekday is checked; saved lower-cased",
              defaults == {"enabled": False, "weekday": 0, "hour": 8, "recipients": [], "last_sent_on": None} and no_recipients.status_code == 400 and bad_day.status_code == 400
              and saved["enabled"] is True and saved["recipients"] == ["ops@nwa.example", admin_email], f"{defaults} {no_recipients.content[:120]}")
        check("an analyst reads the schedule and the reports but cannot change the schedule",
              api("get", "/api/v1/reports/schedule/", h=HA).status_code == 200 and api("get", "/api/v1/reports/summary/", h=HA).status_code == 200
              and api("put", "/api/v1/reports/schedule/", {"enabled": False}, h=HA).status_code == 403)
        sent_mail.clear()
        with session.tenant_scope(TENANT):
            outcome = weekly.send_for(TENANT, saved)
        marked = api("get", "/api/v1/reports/schedule/").json()["last_sent_on"]
        check("the weekly email goes to the chosen addresses with last week's figures in words, and the day is remembered so it is not sent twice",
              outcome["email"] == 2 and sent_mail and sent_mail[0]["to"] == [admin_email, "ops@nwa.example"] and "last week in numbers" in sent_mail[0]["subject"]
              and sent_mail[0]["lines"] and marked == today.isoformat(), f"{outcome} {sent_mail}")
        lines = reports.weekly_lines(report)
        check("the email's lines read as sentences", lines[0].endswith("campaigns.") or lines[0].endswith("campaign.") and "Delivered" in lines[1], str(lines))

        transaction.set_rollback(True)
    check.done()
