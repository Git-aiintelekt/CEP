"""The Results API against the local database, rolled back: another system reads campaign results with a key that has
results:read. Sends go through the sandbox text engine."""
import json
from datetime import timedelta
from unittest import mock

import pytest
from django.core.cache import cache
from django.db import connection, transaction
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.delivery import engine
from apps.delivery.engine import runs
from apps.identity.models import AppUser
from apps.reporting import results
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_results_api(check, admin_email):
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    analyst = AppUser.objects.get(email="priya.natarajan@northwindapparel.example")          # a signed-in person, not a key
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None, h=H):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **h)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **h)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    zone = results.zone_of(admin.tenant)
    today = timezone.now().astimezone(zone).date()

    with transaction.atomic():
        for n in range(6):
            party = f"ZQ-P{n:02d}"
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Zedquist', '[]'::jsonb, %s::jsonb)",
                [party, TENANT, f"Zedperson{n}", json.dumps([{"number": f"+1470555{4000 + n}", "type": "MOBILE", "is_primary": True}])])
            if n < 5:                                      # ZQ-P05 never opted in: the audience rules hold that person back
                sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'SMS', 'OPTED_IN', TRUE, now())", [TENANT, party])

        def make_list(name, parties):
            list_id = sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, %s, 'UPLOAD', 'PRODUCTION', %s, %s) RETURNING id",
                          [TENANT, name, len(parties), str(admin.pk)], True)[0][0]
            for party in parties:
                sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, TENANT, party])
            return str(list_id)

        six = make_list("ZQ six", [f"ZQ-P{n:02d}" for n in range(6)])
        two = make_list("ZQ two", ["ZQ-P00", "ZQ-P01"])
        sandbox = api("post", "/api/v1/delivery-providers/", {"provider_type": "SANDBOX_SMS", "name": "ZQ sandbox", "config": {}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": sandbox["id"], "display_name": "ZQ Shop", "sender_id": "55181"}).json()
        api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "+14705550100"})
        template = api("post", "/api/v1/templates/", {"name": "ZQ text", "channel": "SMS"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body) VALUES (%s, 1, %s)", [template["id"], "ZQ Shop: Hi {{first_name}}. Reply STOP to opt out."])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])

        def send(name, list_id):
            campaign = api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "template": template["id"], "sender_profile": sender["id"],
                                                          "contact_lists": [list_id]}).json()
            with mock.patch("api.v1.views._enqueue_run"):
                run_id = api("post", f"/api/v1/campaigns/{campaign['id']}/publish/").json()["id"]
            with mock.patch.object(runs, "quiet_until", return_value=None):
                engine.process_run(TENANT, run_id)
            return campaign["id"], run_id

        first, run1 = send("ZQ Fall Launch", six)
        second, run2 = send("ZQ Loyalty Nudge", two)
        sql("UPDATE sms_execution SET status = 'DELIVERED', delivered_at = now() WHERE tenant_id = %s AND campaign_run_id = %s AND party_id <> 'ZQ-P03'", [TENANT, run1])
        sql("UPDATE sms_execution SET status = 'RESPONDED', responded_at = now() WHERE tenant_id = %s AND campaign_run_id = %s AND party_id = 'ZQ-P00'", [TENANT, run1])
        sql("INSERT INTO consent_record (tenant_id, party_id, channel, action, source, campaign_id, campaign_run_id, occurred_at) VALUES (%s, 'ZQ-P04', 'SMS', 'OPT_OUT', 'SMS_STOP', %s, %s, now())",
            [TENANT, first, run1])
        sql("""INSERT INTO campaign_actual (campaign_id, tenant_id, attributed_revenue, attributed_orders, attributed_conversions, actual_delivery_cost, campaign_contribution, campaign_roi)
               VALUES (%s, %s, 1250.50, 9, 7, 0.12, 1250.38, 10420.8333)""", [first, TENANT])

        reader = api("post", "/api/v1/api-clients/", {"name": "ZQ warehouse", "scopes": ["results:read"]})
        other = api("post", "/api/v1/api-clients/", {"name": "ZQ events only", "scopes": ["events:ingest"]})
        scopes = api("get", "/api/v1/api-clients/scopes/").json()["scopes"]
        K = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + reader.json().get("key", "")}
        K_OTHER = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + other.json().get("key", "")}

        # ---- 1. who may read
        listing = api("get", "/api/v1/results/campaigns/", h=K)
        check("a key can be given results:read, and reads the campaigns with it", "results:read" in scopes and reader.status_code == 201 and listing.status_code == 200,
              f"{reader.status_code} {listing.status_code} {listing.content[:200]}")
        refused = [api("get", path, h=h).status_code for path in ("/api/v1/results/campaigns/", "/api/v1/results/runs/", f"/api/v1/results/campaigns/{first}/")
                   for h in (K_OTHER, {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(analyst))}, {"HTTP_X_TENANT": CODE})]
        check("a key without the scope, a signed-in person and no key at all are refused on every endpoint", all(code in (401, 403) for code in refused) and 403 in refused, str(refused))

        # ---- 2. the campaigns in the window
        body = listing.json()
        rows = {row["name"]: row for row in body["results"]}
        fall = rows.get("ZQ Fall Launch") or {}
        check("the window is the 30 days kept, in the workspace's zone, and both campaigns are in it",
              body["window"] == {"sent_from": (today - timedelta(days=30)).isoformat(), "sent_to": today.isoformat(), "timezone": zone.key, "days_kept": 30}
              and {"ZQ Fall Launch", "ZQ Loyalty Nudge"} <= set(rows) and body["count"] == len(body["results"]) and body["next"] is None and body["as_of"], str(body["window"]))
        check("a campaign's counts: five messages and one person held back for want of consent; four delivered, one of them replied, one unsubscribed",
              fall.get("counts") == {"audience": 6, "held_back": 1, "queued": 0, "not_sent": 0, "sent": 5, "failed": 0, "delivered": 4, "opened": 0, "clicked": 0, "bounced": 0,
                                     "complained": 0, "unsubscribed": 1, "replied": 1}
              and fall.get("held_back") == {"NO_CONSENT": 1}, json.dumps(fall.get("counts")) + json.dumps(fall.get("held_back")))
        check("rates are percentages of what was sent and delivered; the send times and the latest activity are given",
              fall.get("rates") == {"delivery": 80.0, "open": 0.0, "click": 0.0, "bounce": 0.0, "unsubscribe": 25.0} and fall.get("first_sent_at") and fall.get("last_sent_at")
              and fall.get("last_activity_at") >= fall.get("last_sent_at"), json.dumps(fall.get("rates")))
        check("the campaign is named by id, code, type, channel and status",
              fall.get("id") == first and fall.get("code") and fall.get("campaign_type") == "REGULAR_MARKETING" and fall.get("channel") == "SMS" and fall.get("status") and "journey_id" in fall,
              str({k: fall.get(k) for k in ("id", "code", "campaign_type", "channel", "status")}))
        check("money comes from the campaign's attribution rollup; a campaign without one has none",
              {k: v for k, v in (fall.get("money") or {}).items() if k not in ("computed_at", "currency")}
              == {"revenue": 1250.5, "orders": 9, "conversions": 7, "message_cost": 0.12, "offer_cost": None, "contribution": 1250.38, "roi": 10420.8333}
              and fall["money"]["computed_at"] and "currency" in fall["money"] and rows["ZQ Loyalty Nudge"]["money"] is None, json.dumps(fall.get("money")))
        own = api("get", f"/api/v1/campaigns/{first}/metrics/").json()["counts"]
        check("the figures agree with the campaign's own Results tab", all(fall["counts"][key] == own[key] for key in ("queued", "sent", "failed", "not_sent", "delivered", "opened",
                                                                                                                      "clicked", "bounced", "complained", "unsubscribed", "replied")), json.dumps(own))
        text = listing.content.decode()
        check("nothing personal is answered: no number, no name, no party", "+1470555" not in text and "Zedperson" not in text and "Zedquist" not in text and "ZQ-P0" not in text, text[:200])

        # ---- 3. one campaign, and the sends
        one = api("get", f"/api/v1/results/campaigns/{first}/", h=K).json()
        check("one campaign: the same figures, with its send", one["counts"] == fall["counts"] and one["money"] == fall["money"] and [run["id"] for run in one["runs"]] == [run1]
              and one["runs"][0]["counts"] == fall["counts"] and one["runs"][0]["run_number"] == 1 and one["runs"][0]["run_type"] == "ONE_TIME" and one["window"] == body["window"],
              json.dumps(one.get("runs"))[:300])
        sends = api("get", "/api/v1/results/runs/", h=K).json()
        mine = api("get", f"/api/v1/results/runs/?campaign={second}", h=K).json()
        check("the sends of the window, and one campaign's alone", {run1, run2} <= {run["id"] for run in sends["results"]} and [run["id"] for run in mine["results"]] == [run2]
              and mine["results"][0]["counts"]["sent"] == 2 and mine["results"][0]["campaign_code"] == rows["ZQ Loyalty Nudge"]["code"] and mine["results"][0]["held_back"] == {},
              json.dumps(mine["results"])[:300])

        # ---- 4. pages and filters
        page1 = api("get", "/api/v1/results/campaigns/?page_size=1", h=K).json()
        page2 = c.get(page1["next"], **K).json() if page1["next"] else {}
        check("a page at a time: next leads to the following rows, and the pages do not overlap",
              len(page1["results"]) == 1 and page1["count"] == body["count"] and "offset=1" in (page1["next"] or "") and len(page2.get("results", [])) == 1
              and page2["results"][0]["id"] != page1["results"][0]["id"], str(page1.get("next")))
        emails = api("get", "/api/v1/results/campaigns/?channel=email", h=K).json()
        texts = api("get", "/api/v1/results/campaigns/?channel=SMS&campaign_type=REGULAR_MARKETING", h=K).json()
        check("filtered by channel and campaign type", not {"ZQ Fall Launch", "ZQ Loyalty Nudge"} & {row["name"] for row in emails["results"]}
              and {"ZQ Fall Launch", "ZQ Loyalty Nudge"} <= {row["name"] for row in texts["results"]} and all(row["channel"] == "SMS" for row in texts["results"]), str(emails["count"]))

        # ---- 5. the window and what is refused
        yesterday = today - timedelta(days=1)
        earlier = api("get", f"/api/v1/results/campaigns/?sent_from={yesterday}&sent_to={yesterday}", h=K).json()
        gone = api("get", f"/api/v1/results/campaigns/{first}/?sent_to={yesterday}", h=K)
        check("a window that ends before the send has neither campaign, and the campaign itself answers 404",
              not {"ZQ Fall Launch", "ZQ Loyalty Nudge"} & {row["name"] for row in earlier["results"]} and earlier["window"]["sent_from"] == yesterday.isoformat() and gone.status_code == 404,
              f"{earlier['count']} {gone.status_code}")
        too_old = api("get", f"/api/v1/results/campaigns/?sent_from={today - timedelta(days=31)}", h=K)
        backwards = api("get", f"/api/v1/results/runs/?sent_from={today}&sent_to={yesterday}", h=K)
        not_a_day = api("get", "/api/v1/results/campaigns/?sent_from=last-week", h=K)
        fax = api("get", "/api/v1/results/campaigns/?channel=FAX", h=K)
        huge = api("get", "/api/v1/results/campaigns/?page_size=many", h=K)
        check("older than 30 days, a window back to front, a date that is none, an unknown channel and a page size in words are refused by field",
              too_old.status_code == 400 and "30 days" in str(too_old.json()["errors"]["sent_from"]) and backwards.status_code == 400 and "sent_to" in backwards.json()["errors"]
              and not_a_day.status_code == 400 and "sent_from" in not_a_day.json()["errors"] and fax.status_code == 400 and huge.status_code == 400,
              f"{too_old.content[:160]} {backwards.content[:120]}")

        # ---- 6. a test send never counts
        sql("UPDATE campaign_run SET test_mode = TRUE WHERE tenant_id = %s AND id = %s", [TENANT, run2])
        cache.clear()
        after = api("get", "/api/v1/results/campaigns/", h=K).json()
        check("a test send never counts", "ZQ Loyalty Nudge" not in {row["name"] for row in after["results"]} and "ZQ Fall Launch" in {row["name"] for row in after["results"]},
              str([row["name"] for row in after["results"]][:6]))
        transaction.set_rollback(True)
    check.done()
