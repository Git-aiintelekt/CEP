"""The Results API against the local database, rolled back: another system reads campaign results with a key that has
results:read. Sends go through the sandbox text engine. Each endpoint is an integration of the workspace: limited, logged,
and (once patch 0101 is on the database) a record that can be configured and paused."""
import json
import time
from datetime import date, timedelta
from unittest import mock

import pytest
from django.core.cache import cache
from django.db import OperationalError, connection, transaction
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.delivery import engine
from apps.delivery.engine import runs
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook, throttle
from apps.reporting import results
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


class context_of:
    """The workspace's context, as a request has it, for a call made straight to the module."""

    def __init__(self, tenant_id):
        self.tenant_id = tenant_id

    def __enter__(self):
        self.token = context.set_current(self.tenant_id, "default")

    def __exit__(self, *exc):
        context.reset(self.token)


def test_results_api(check, admin_email):
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    analyst = AppUser.objects.get(email="priya.natarajan@northwindapparel.example")          # a signed-in person, not a key
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None, h=H):
        if "cep_" in h.get("HTTP_AUTHORIZATION", ""):
            time.sleep(0.12)                               # a key's calls keep under the endpoint's ten a second, as a real consumer does
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

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"):
        patched = "RESULTS_RUNS" in sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_integration_kind'", fetch=True)[0][0]
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
                   for h in (K_OTHER, {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(analyst))}, H, {"HTTP_X_TENANT": CODE})]
        check("a key without the scope, a signed-in person, the administrator's own session and no key at all are refused on every endpoint",
              all(code in (401, 403) for code in refused) and refused.count(403) == 9 and refused.count(401) == 3, str(refused))
        elsewhere = type("Key", (), {"tenant_id": "b0000000-0000-4000-8000-00000000000b", "has_scope": lambda self, scope: True})()
        here = type("Key", (), {"tenant_id": TENANT, "has_scope": lambda self, scope: scope == "results:read"})()
        token = context.set_current(TENANT, "default")
        from api.v1.results_api import ResultsKey
        verdicts = [ResultsKey().has_permission(type("R", (), {"user": key})(), None) for key in (here, elsewhere)]
        context.reset(token)
        check("a key is checked against the workspace it was made in: one from another workspace is refused whatever its scopes", verdicts == [True, False], str(verdicts))
        check("an answer says how much of the minute is left, and that it must not be kept by a proxy or a browser",
              listing["X-RateLimit-Limit"] == "60" and int(listing["X-RateLimit-Remaining"]) < 60 and listing.has_header("X-RateLimit-Reset") and listing["Cache-Control"] == "no-store",
              str(dict(listing.items())))

        # ---- 2. the campaigns in the window
        body = listing.json()
        rows = {row["name"]: row for row in body["results"]}
        fall = rows.get("ZQ Fall Launch") or {}
        check("with no dates the window is the 31 days up to today, in the workspace's zone, and both campaigns are in it; it says how far back and how wide a call may go",
              body["window"] == {"sent_from": (today - timedelta(days=30)).isoformat(), "sent_to": today.isoformat(), "timezone": zone.key,
                                 "earliest": results.earliest_day(today).isoformat(), "max_days": 31}
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
        earliest = results.earliest_day(today)
        last_year = api("get", f"/api/v1/results/campaigns/?sent_from={earliest}", h=K)
        last_year_end = api("get", f"/api/v1/results/runs/?sent_to={earliest + timedelta(days=3)}", h=K)
        check("thirteen months back can be read: a start alone runs 31 days from it, an end alone 31 days up to it, never before the earliest day",
              last_year.status_code == 200 and last_year.json()["window"]["sent_from"] == earliest.isoformat() and last_year.json()["window"]["sent_to"] == (earliest + timedelta(days=30)).isoformat()
              and last_year_end.status_code == 200 and last_year_end.json()["window"]["sent_from"] == earliest.isoformat()
              and last_year_end.json()["window"]["sent_to"] == (earliest + timedelta(days=3)).isoformat()
              and results.earliest_day(date(2026, 11, 26)) == date(2025, 10, 26) and results.earliest_day(date(2026, 3, 31)) == date(2025, 2, 28)
              and results.earliest_day(date(2026, 1, 15)) == date(2024, 12, 15),
              f"{last_year.content[:160]} {last_year_end.content[:160]}")
        too_old = api("get", f"/api/v1/results/campaigns/?sent_from={earliest - timedelta(days=1)}", h=K)
        too_wide = api("get", f"/api/v1/results/campaigns/?sent_from={today - timedelta(days=31)}&sent_to={today}", h=K)
        widest = api("get", f"/api/v1/results/campaigns/?sent_from={today - timedelta(days=30)}&sent_to={today}", h=K)
        ahead = api("get", f"/api/v1/results/campaigns/?sent_from={today + timedelta(days=2)}", h=K)
        backwards = api("get", f"/api/v1/results/runs/?sent_from={today}&sent_to={yesterday}", h=K)
        not_a_day = api("get", "/api/v1/results/campaigns/?sent_from=last-week", h=K)
        fax = api("get", "/api/v1/results/campaigns/?channel=FAX", h=K)
        huge = api("get", "/api/v1/results/campaigns/?page_size=many", h=K)
        check("older than 13 months is refused with the earliest day; more than 31 days in one call is refused with the latest end, and 31 days are served",
              too_old.status_code == 400 and "13 months" in str(too_old.json()["errors"]["sent_from"]) and earliest.isoformat() in str(too_old.json()["errors"]["sent_from"])
              and too_wide.status_code == 400 and "31 days" in str(too_wide.json()["errors"]["sent_to"]) and (today - timedelta(days=1)).isoformat() in str(too_wide.json()["errors"]["sent_to"])
              and widest.status_code == 200, f"{too_old.content[:160]} {too_wide.content[:160]} {widest.status_code}")
        check("a window back to front or in the future, a date that is none, an unknown channel and a page size in words are refused by field",
              backwards.status_code == 400 and "sent_to" in backwards.json()["errors"] and ahead.status_code == 400 and "sent_from" in ahead.json()["errors"]
              and not_a_day.status_code == 400 and "sent_from" in not_a_day.json()["errors"] and fax.status_code == 400 and huge.status_code == 400,
              f"{backwards.content[:120]} {ahead.content[:120]}")

        # ---- 6. a test send never counts
        sql("UPDATE campaign_run SET test_mode = TRUE WHERE tenant_id = %s AND id = %s", [TENANT, run2])
        cache.clear()
        after = api("get", "/api/v1/results/campaigns/", h=K).json()
        check("a test send never counts", "ZQ Loyalty Nudge" not in {row["name"] for row in after["results"]} and "ZQ Fall Launch" in {row["name"] for row in after["results"]},
              str([row["name"] for row in after["results"]][:6]))

        # ---- 7. each endpoint is limited on its own, and every call is in the log with the key that made it
        key_id = reader.json()["id"]
        if time.time() % 60 > 54:
            time.sleep(7)                                  # the four calls below must fall in one minute of the limit's clock
        sql("UPDATE integration SET throttle_per_minute = 3 WHERE tenant_id = %s AND kind = 'RESULTS_RUNS'", [TENANT])
        logbook.invalidate(TENANT, "RESULTS_RUNS")
        cache.delete_many([key for key in (f"{throttle.PREFIX}:inbound:{TENANT}:RESULTS_RUNS:m:{int(time.time() // 60) + n}" for n in (0, 1))])
        with mock.patch.dict(logbook.RESULTS["RESULTS_RUNS"], {"per_minute": 3}):
            sends3 = [api("get", "/api/v1/results/runs/", h=K) for _ in range(4)]
            still = api("get", "/api/v1/results/campaigns/", h=K)
        check("the sends endpoint at three a minute: the fourth call answers 429 with Retry-After and the limit, while the campaigns endpoint goes on",
              [r.status_code for r in sends3] == [200, 200, 200, 429] and sends3[3].has_header("Retry-After") and sends3[3]["X-RateLimit-Limit"] == "3"
              and sends3[0]["X-RateLimit-Limit"] == "3" and still.status_code == 200, f"{[r.status_code for r in sends3]} {dict(sends3[3].items())} {still.status_code}")
        logged = sql("""SELECT kind, outcome, response_status, api_client_id::text, method, url, response_body IS NULL, related_ref FROM integration_log
                         WHERE tenant_id = %s AND kind LIKE 'RESULTS%%' ORDER BY id""", [TENANT], True)
        check("every call is in the integration log: its endpoint, the key that made it, the address asked and how it was answered, refusals and throttled calls too",
              len(logged) >= 30 and {row[0] for row in logged} == {"RESULTS_CAMPAIGNS", "RESULTS_RUNS"} and {"OK", "REJECTED", "THROTTLED"} <= {row[1] for row in logged}
              and all(row[3] == key_id for row in logged if row[1] == "OK") and all(row[4] == "GET" and "/api/v1/results/" in row[5] for row in logged)
              and any(row[7] == f"campaign:{first}" for row in logged) and [row[1] for row in logged if row[0] == "RESULTS_RUNS"][-4:] == ["OK", "OK", "OK", "THROTTLED"],
              str([(row[0], row[1], row[2]) for row in logged][-6:]))

        # ---- 8. a read never weighs on the server
        day = today - timedelta(days=40)
        cache.add(f"cep:results_api:busy:{TENANT}", 1, 60)
        waiting = api("get", f"/api/v1/results/campaigns/?sent_from={day}", h=K)
        cache.delete(f"cep:results_api:busy:{TENANT}")
        cancelled = OperationalError("canceling statement due to statement timeout")
        cancelled.__cause__ = type("QueryCanceled", (Exception,), {})()
        with mock.patch.object(results, "_work_out", side_effect=cancelled):
            slow = api("get", f"/api/v1/results/campaigns/?sent_from={day}", h=K)
        freed = api("get", f"/api/v1/results/campaigns/?sent_from={day}", h=K)
        check("one read is worked out at a time: a second is asked to retry in two seconds; a query past its time is stopped and answered 504, and the next read goes through",
              waiting.status_code == 429 and waiting["Retry-After"] == "2" and slow.status_code == 504 and slow["Retry-After"] == "60" and "too long" in slow.json().get("detail", "")
              and freed.status_code == 200,
              f"{waiting.status_code} {dict(waiting.items()).get('Retry-After')} {slow.status_code} {slow.content[:160]} {freed.status_code}")
        with connection.cursor() as cur:
            cur.execute("SELECT current_setting('statement_timeout')")
            before = cur.fetchone()[0]
        with context_of(TENANT), CaptureQueriesContext(connection) as queries:
            results.collect(admin.tenant, today - timedelta(days=50), today - timedelta(days=45))       # a window nobody asked for yet: worked out, not remembered
        limits = [query["sql"] for query in queries if "set_config('statement_timeout'" in query["sql"]]
        with connection.cursor() as cur:
            cur.execute("SELECT current_setting('statement_timeout')")
            after_read = cur.fetchone()[0]
        check("the queries of a read run under a 15-second limit, and the connection has its own setting back afterwards",
              len(limits) == 2 and "'15s'" in limits[0] and f"'{before}'" in limits[1] and after_read == before, f"{before} {after_read} {limits}")

        # ---- 9. the integration records (patch 0101)
        page = api("get", "/api/v1/integrations/")
        check("Settings -> Integrations answers whether or not the database knows the Results kinds yet", page.status_code == 200 and isinstance(page.json(), list), f"{page.status_code} {page.content[:200]}")
        if patched:
            records = {row[0]: row for row in sql("SELECT kind, name, system, direction, status, throttle_per_minute, log_level FROM integration WHERE tenant_id = %s AND kind LIKE 'RESULTS%%'", [TENANT], True)}
            check("each endpoint has its own integration record, made at its first call: named, inbound, 60 a minute, bodies kept for failures only",
                  records.get("RESULTS_CAMPAIGNS") == ("RESULTS_CAMPAIGNS", "Results: Campaigns", "Results API", "IN", "ACTIVE", 60, "ERRORS")
                  and records.get("RESULTS_RUNS") == ("RESULTS_RUNS", "Results: Sends", "Results API", "IN", "ACTIVE", 3, "ERRORS"), str(records))
            check("an answer that went well keeps no body in the log; a refusal keeps what was answered",
                  all(row[6] for row in logged if row[1] == "OK") and any(not row[6] for row in logged if row[1] in ("REJECTED", "THROTTLED")), str([(row[1], row[6]) for row in logged][-6:]))
            cards = {row["name"]: row for row in page.json() if row["kind"].startswith("RESULTS")}
            check("Settings -> Integrations lists each endpoint, with its limit", set(cards) == {"Results: Campaigns", "Results: Sends", "Results: Recipients", "Results: Suppressions"} and cards["Results: Sends"]["effective_limit_per_minute"] == 3
                  and cards["Results: Campaigns"]["effective_limit_per_minute"] == 60 and cards["Results: Recipients"]["effective_limit_per_minute"] == 120 and cards["Results: Suppressions"]["effective_limit_per_minute"] == 60,
                  str({name: card["effective_limit_per_minute"] for name, card in cards.items()}))
            paused = api("post", f"/api/v1/integrations/{cards['Results: Campaigns']['id']}/pause/")
            closed, open_still = api("get", "/api/v1/results/campaigns/", h=K), None
            cache.delete_many([f"{throttle.PREFIX}:inbound:{TENANT}:RESULTS_RUNS:m:{int(time.time() // 60) + n}" for n in (0, 1)])
            sql("UPDATE integration SET throttle_per_minute = 60 WHERE tenant_id = %s AND kind = 'RESULTS_RUNS'", [TENANT])
            logbook.invalidate(TENANT, "RESULTS_RUNS")
            open_still = api("get", "/api/v1/results/runs/", h=K)
            resumed = api("post", f"/api/v1/integrations/{cards['Results: Campaigns']['id']}/resume/")
            back = api("get", "/api/v1/results/campaigns/", h=K)
            check("pausing one endpoint answers 503 there and nowhere else; resuming opens it again",
                  paused.status_code == 200 and closed.status_code == 503 and open_still.status_code == 200 and resumed.status_code == 200 and back.status_code == 200,
                  f"{paused.status_code} {closed.status_code} {open_still.status_code} {resumed.status_code} {back.status_code}")
        transaction.set_rollback(True)
    check.done()
