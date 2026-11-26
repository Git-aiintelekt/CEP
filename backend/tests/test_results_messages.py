"""The Results API's per-recipient rows against the local database, rolled back: another system reads who got what, by
party ID, with a key that has results:read. Sends go through the sandbox text engine. Reading "what changed since" needs
the database's stamp on each message (patch 0102): where it is missing, the checks say so and the rest still runs."""
import csv
import io
import json
import time
from datetime import timedelta
from unittest import mock

import pytest
from django.db import connection, transaction
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.delivery import engine
from apps.delivery.engine import runs
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.reporting import result_rows, results
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]
ROWS = "/api/v1/results/messages/"


def test_results_messages(check, admin_email):
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None, h=H):
        if "cep_" in h.get("HTTP_AUTHORIZATION", ""):
            time.sleep(0.12)                               # a key's calls keep under the endpoint's ten a second
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
    began = timezone.now()

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(result_rows, "AS_OF_LAG_SECONDS", 0):
        stamped = sql("SELECT count(*) = 2 FROM information_schema.columns WHERE column_name = 'changed_at' AND table_name IN ('mailer_execution', 'sms_execution')", fetch=True)[0][0]
        for n in range(6):
            party = f"ZM-P{n:02d}"
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Zedmont', '[]'::jsonb, %s::jsonb)",
                [party, TENANT, f"Zedfolk{n}", json.dumps([{"number": f"+1470555{5000 + n}", "type": "MOBILE", "is_primary": True}])])
            if n < 5:                                      # ZM-P05 never opted in: the audience rules hold that person back
                sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'SMS', 'OPTED_IN', TRUE, now())", [TENANT, party])

        def make_list(name, parties):
            list_id = sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, %s, 'UPLOAD', 'PRODUCTION', %s, %s) RETURNING id",
                          [TENANT, name, len(parties), str(admin.pk)], True)[0][0]
            for party in parties:
                sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, TENANT, party])
            return str(list_id)

        six = make_list("ZM six", [f"ZM-P{n:02d}" for n in range(6)])
        two = make_list("ZM two", ["ZM-P00", "ZM-P01"])
        sandbox = api("post", "/api/v1/delivery-providers/", {"provider_type": "SANDBOX_SMS", "name": "ZM sandbox", "config": {}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": sandbox["id"], "display_name": "ZM Shop", "sender_id": "55182"}).json()
        api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "+14705550100"})
        template = api("post", "/api/v1/templates/", {"name": "ZM text", "channel": "SMS"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body) VALUES (%s, 1, %s)", [template["id"], "ZM Shop: Hi {{first_name}}. Reply STOP to opt out."])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])

        def send(name, list_id):
            campaign = api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "template": template["id"], "sender_profile": sender["id"],
                                                          "contact_lists": [list_id]}).json()
            with mock.patch("api.v1.views._enqueue_run"):
                run_id = api("post", f"/api/v1/campaigns/{campaign['id']}/publish/").json()["id"]
            with mock.patch.object(runs, "quiet_until", return_value=None):
                engine.process_run(TENANT, run_id)
            return campaign["id"], run_id

        first, run1 = send("ZM Fall Launch", six)
        second, run2 = send("ZM Loyalty Nudge", two)

        def mark(party, assignments, run=run1):
            sql(f"UPDATE sms_execution SET {assignments} WHERE tenant_id = %s AND campaign_run_id = %s AND party_id = %s", [TENANT, run, party])

        mark("ZM-P00", "status = 'RESPONDED', delivered_at = now(), responded_at = now()")
        mark("ZM-P01", "status = 'DELIVERED', delivered_at = now()")
        mark("ZM-P02", "status = 'DELIVERED', delivered_at = now(), read_at = now()")
        mark("ZM-P03", "status = 'FAILED', failed_at = now(), status_reason = 'Refused for zed.folk@example.com and +14705555003: unknown subscriber'")
        mark("ZM-P04", "status = 'OPTED_OUT', delivered_at = now(), responded_at = now()")
        stopped = sql("SELECT id FROM sms_execution WHERE tenant_id = %s AND campaign_run_id = %s AND party_id = 'ZM-P04'", [TENANT, run1], True)[0][0]
        sql("INSERT INTO consent_record (tenant_id, party_id, channel, action, source, campaign_id, campaign_run_id, sms_execution_id, occurred_at) VALUES (%s, 'ZM-P04', 'SMS', 'OPT_OUT', 'SMS_STOP', %s, %s, %s, now())",
            [TENANT, first, run1, stopped])
        mark("ZM-P01", "status = 'FAILED', not_sent_reason = 'STOPPED_EARLY', status_reason = 'Not sent: the drip was stopped early.'", run=run2)

        reader = api("post", "/api/v1/api-clients/", {"name": "ZM warehouse", "scopes": ["results:read"]})
        other = api("post", "/api/v1/api-clients/", {"name": "ZM events only", "scopes": ["events:ingest"]})
        K = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + reader.json().get("key", "")}
        K_OTHER = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + other.json().get("key", "")}

        # ---- 1. who may read
        answer = api("get", f"{ROWS}?campaign={first}", h=K)
        refused = [api("get", ROWS, h=h).status_code for h in (K_OTHER, H, {"HTTP_X_TENANT": CODE})]
        check("a key with results:read reads the rows; a key without the scope, a person's session and no key are refused",
              answer.status_code == 200 and refused == [403, 403, 401], f"{answer.status_code} {answer.content[:200]} {refused}")

        # ---- 2. by send day: one row a recipient, one a person held back
        body = answer.json()
        rows = body.get("results", [])
        by_party = {row["party_id"]: row for row in rows}
        check("with no dates the window is the 31 days up to today, 90 days kept; the answer says when it was read and has no further page",
              body.get("window") == {"sent_from": (today - timedelta(days=30)).isoformat(), "sent_to": today.isoformat(), "timezone": zone.key,
                                     "earliest": (today - timedelta(days=90)).isoformat(), "max_days": 31}
              and body.get("as_of") and body.get("next") is None and "changed_since" not in body and answer["X-As-Of"] and answer["Cache-Control"] == "no-store", str(body)[:300])
        check("five messages and the person held back, each with the same fields, the messages first in the order they were made",
              len(rows) == 6 and all(tuple(row) == result_rows.FIELDS for row in rows) and [row["id"][:2] for row in rows] == ["T-"] * 5 + ["H-"]
              and [int(row["id"][2:]) for row in rows[:5]] == sorted(int(row["id"][2:]) for row in rows[:5])
              and all(row["campaign_id"] == first and row["run_id"] == run1 and row["campaign_code"] and row["channel"] == "SMS" for row in rows), json.dumps(rows)[:400])
        check("each status in the API's words: replied, delivered, opened (read), failed, opted out, held back",
              {party: row["status"] for party, row in by_party.items()} == {"ZM-P00": "REPLIED", "ZM-P01": "DELIVERED", "ZM-P02": "OPENED", "ZM-P03": "FAILED", "ZM-P04": "OPTED_OUT",
                                                                           "ZM-P05": "HELD_BACK"}, str({party: row["status"] for party, row in by_party.items()}))
        check("each event has its own time: sent on all five, delivered, read, replied, failed; the unsubscribe comes from the consent record of that message",
              all(by_party[f"ZM-P0{n}"]["sent_at"] for n in range(5)) and by_party["ZM-P05"]["sent_at"] is None and by_party["ZM-P01"]["delivered_at"] and by_party["ZM-P02"]["opened_at"]
              and by_party["ZM-P00"]["replied_at"] and by_party["ZM-P03"]["failed_at"] and by_party["ZM-P04"]["unsubscribed_at"]
              and [party for party, row in by_party.items() if row["unsubscribed_at"]] == ["ZM-P04"] and all(row["changed_at"] for row in rows), json.dumps(by_party["ZM-P04"]))
        check("the reason: why held back, and a failure's words with the address and the number in them masked",
              by_party["ZM-P05"]["reason"] == "NO_CONSENT" and by_party["ZM-P03"]["reason"] == "Refused for [address] and [number]: unknown subscriber"
              and by_party["ZM-P01"]["reason"] is None, f"{by_party['ZM-P05']['reason']} | {by_party['ZM-P03']['reason']}")
        text = answer.content.decode()
        check("a customer is a party ID and nothing else: no number, no name", "+1470555" not in text and "Zedfolk" not in text and "Zedmont" not in text and "example.com" not in text
              and "ZM-P00" in text, text[:200])
        check("scrubbing keeps an engine's code and masks what could name a person",
              result_rows.scrubbed("550 5.1.1 <a.b+c@mail.example.org>: user unknown") == "550 5.1.1 <[address]>: user unknown"
              and result_rows.scrubbed("to 6591234567 failed, code 30007") == "to [number] failed, code 30007" and result_rows.scrubbed(None) is None, "")

        # ---- 3. a page at a time
        seen, pages, address, links = [], 0, f"{ROWS}?campaign={first}&page_size=2", []
        while address and pages < 6:
            page = api("get", address, h=K)
            seen += [row["id"] for row in page.json()["results"]]
            links.append(page.get("Link", ""))
            address, pages = page.json()["next"], pages + 1
        check("two rows a page: three pages, every row once, the next page's address in the answer and in the Link header, none after the last",
              pages == 3 and len(seen) == 6 and len(set(seen)) == 6 and seen == [row["id"] for row in rows] and all('rel="next"' in link and "cursor=" in link for link in links[:2])
              and links[2] == "", f"{pages} {seen} {links}")

        full = api("get", f"{ROWS}?campaign={first}&page_size=5", h=K).json()
        rest = api("get", full["next"], h=K).json() if full["next"] else {"results": [{"id": "none"}], "next": "?"}
        check("a page that ends exactly where the messages end is followed by the people held back: nobody is skipped at the join",
              [row["id"] for row in full["results"]] == [row["id"] for row in rows[:5]] and [row["id"] for row in rest["results"]] == [rows[5]["id"]] and rest["next"] is None,
              f"{[row['id'] for row in full['results']]} {[row['id'] for row in rest['results']]} {rest['next']}")

        # ---- 4. filters
        def count(query):
            got = api("get", f"{ROWS}?{query}", h=K)
            return len(got.json()["results"]) if got.status_code == 200 else got.status_code

        nudge = api("get", f"{ROWS}?run={run2}", h=K).json()["results"]
        check("by send, by status and by channel; a message CEP chose not to send says so and why",
              [count(f"campaign={first}&status=HELD_BACK"), count(f"campaign={first}&status=delivered"), count(f"campaign={first}&channel=SMS"), count(f"campaign={first}&channel=EMAIL"),
               count(f"campaign={first}&status=CLICKED")] == [1, 1, 6, 0, 0]
              and len(nudge) == 2 and {row["party_id"]: (row["status"], row["reason"]) for row in nudge} == {"ZM-P00": ("SENT", None), "ZM-P01": ("NOT_SENT", "STOPPED_EARLY")},
              f"{json.dumps(nudge)[:300]}")

        # ---- 5. what is refused
        asked = {"sent_from": f"sent_from={today - timedelta(days=91)}", "sent_to": f"sent_from={today - timedelta(days=40)}&sent_to={today}", "cursor": "cursor=not-a-cursor",
                 "campaign": "campaign=42", "status": "status=LOST", "channel": "channel=FAX", "changed_since": "changed_since=2026-11-26T08:00:00", "page_size": "page_size=lots"}
        answers = {field: api("get", f"{ROWS}?{query}", h=K) for field, query in asked.items()}
        both = api("get", f"{ROWS}?changed_since={(began - timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')}&sent_from={today}", h=K)
        check("older than 90 days, wider than 31, a cursor that is none, an id, status or channel that is none, a moment without its zone, and both ways of reading at once: refused by field",
              all(got.status_code == 400 and field in got.json()["errors"] for field, got in answers.items()) and "90 days" in str(answers["sent_from"].json()["errors"])
              and "31 days" in str(answers["sent_to"].json()["errors"]) and both.status_code == 400 and "changed_since" in both.json()["errors"],
              str({field: (got.status_code, got.content[:90]) for field, got in answers.items()}))

        # ---- 6. CSV
        sheet = api("get", f"{ROWS}?campaign={first}&format=csv", h=K)
        lines = list(csv.reader(io.StringIO(sheet.content.decode())))
        paged = api("get", f"{ROWS}?campaign={first}&format=csv&page_size=4", h=K)
        check("the same rows as CSV: one header line, a line a row, empty where there is nothing; the next page is in the Link header and stays CSV",
              sheet.status_code == 200 and sheet["Content-Type"].startswith("text/csv") and tuple(lines[0]) == result_rows.FIELDS and len(lines) == 7
              and [line[lines[0].index("party_id")] for line in lines[1:]] == [row["party_id"] for row in rows] and lines[6][lines[0].index("sent_at")] == ""
              and lines[6][lines[0].index("reason")] == "NO_CONSENT" and len(paged.content.decode().strip().splitlines()) == 5 and "format=csv" in paged["Link"] and "cursor=" in paged["Link"],
              f"{sheet.status_code} {sheet['Content-Type']} {lines[:2]} {paged.get('Link')}")
        totals = api("get", "/api/v1/results/campaigns/?format=csv", h=K)
        table = list(csv.DictReader(io.StringIO(totals.content.decode())))
        ours = next((line for line in table if line["id"] == first), {})
        sends_csv = api("get", f"/api/v1/results/runs/?campaign={first}&format=csv", h=K)
        check("the campaign and send totals as CSV too: counts, rates and money side by side, the held-back reasons in one cell",
              totals.status_code == 200 and ours.get("counts_sent") == "4" and ours.get("counts_held_back") == "1" and ours.get("held_back_reasons") == "NO_CONSENT=1"
              and ours.get("rates_delivery") and "money_revenue" in ours and ours.get("name") == "ZM Fall Launch"
              and sends_csv.status_code == 200 and sends_csv.content.decode().splitlines()[0].startswith("id,campaign_id,campaign_code") and len(sends_csv.content.decode().strip().splitlines()) == 2,
              f"{totals.status_code} {str(ours)[:300]}")
        as_json_client = api("get", f"{ROWS}?campaign={first}&format=csv&page_size=4", h={**K, "HTTP_ACCEPT": "application/json"})
        by_header = api("get", f"{ROWS}?campaign={first}&page_size=4", h={**K, "HTTP_ACCEPT": "text/csv"})
        named_json = api("get", f"{ROWS}?campaign={first}&format=json&page_size=4", h={**K, "HTTP_ACCEPT": "text/csv"})
        unknown = api("get", f"{ROWS}?campaign={first}&format=xml", h=K)
        check("?format= decides whatever the Accept header says; without it Accept decides; an unknown format is not found",
              as_json_client.status_code == 200 and as_json_client["Content-Type"].startswith("text/csv") and as_json_client.content == paged.content
              and by_header.status_code == 200 and by_header["Content-Type"].startswith("text/csv")
              and named_json.status_code == 200 and named_json["Content-Type"].startswith("application/json") and len(named_json.json()["results"]) == 4
              and unknown.status_code == 404,
              f"{as_json_client.status_code} {as_json_client['Content-Type']} | {by_header.status_code} {by_header['Content-Type']} | {named_json.status_code} {named_json['Content-Type']} | {unknown.status_code}")
        wrong = api("get", f"{ROWS}?format=csv&status=LOST", h=K)
        single = api("get", f"/api/v1/results/campaigns/{first}/?format=csv", h=K)
        check("a refusal asked for as CSV is still a problem document; one campaign has no CSV form",
              wrong.status_code == 400 and "status" in json.loads(wrong.content)["errors"] and wrong["Content-Type"].startswith("application/problem+json") and single.status_code == 404,
              f"{wrong.status_code} {wrong['Content-Type']} {wrong.content[:120]} {single.status_code}")

        # ---- 7. what changed since
        since = began.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        if stamped:
            whole = api("get", f"{ROWS}?campaign={first}&changed_since={since}", h=K)
            first_read = whole.json()
            check("by change: every row of the campaign moved since the test began, oldest change first, and the answer's as_of is the next read's changed_since",
                  whole.status_code == 200 and len(first_read["results"]) == 6 and "window" not in first_read and first_read["changed_since"] and first_read["as_of"]
                  and [row["changed_at"] for row in first_read["results"][:5]] == sorted(row["changed_at"] for row in first_read["results"][:5])
                  and first_read["results"][5]["status"] == "HELD_BACK", f"{whole.status_code} {whole.content[:300]}")
            time.sleep(0.05)
            mark("ZM-P01", "status = 'RESPONDED', responded_at = now()")
            opened = sql("SELECT id FROM sms_execution WHERE tenant_id = %s AND campaign_run_id = %s AND party_id = 'ZM-P02'", [TENANT, run1], True)[0][0]
            sql("INSERT INTO consent_record (tenant_id, party_id, channel, action, source, campaign_id, campaign_run_id, sms_execution_id, occurred_at) VALUES (%s, 'ZM-P02', 'SMS', 'OPT_OUT', 'PREFERENCE_CENTER', %s, %s, %s, now())",
                [TENANT, first, run1, opened])
            mark("ZM-P00", """provider_response = '{"note": "nothing a consumer reads"}'::jsonb""")
            time.sleep(0.05)
            moved = api("get", f"{ROWS}?changed_since={first_read['as_of']}", h=K).json()
            check("the next read from that moment has only what moved: the reply, and the message its person unsubscribed from; an update of nothing a consumer reads is not a change",
                  [(row["party_id"], row["status"]) for row in moved["results"]] == [("ZM-P01", "REPLIED"), ("ZM-P02", "OPENED")] and moved["results"][1]["unsubscribed_at"]
                  and moved["results"][0]["changed_at"] > first_read["as_of"], json.dumps(moved["results"])[:400])
            walked, address, marks = [], f"{ROWS}?campaign={first}&changed_since={since}&page_size=4", set()
            while address:
                page = api("get", address, h=K).json()
                walked += [row["id"] for row in page["results"]]
                marks.add(page["as_of"])
                address = page["next"]
            check("read by change a page at a time: every row once, and one as_of for the whole read", len(walked) == 6 and len(set(walked)) == 6 and len(marks) == 1, f"{walked} {marks}")
            tracked_from = result_rows.tracked_from()
            early = api("get", f"{ROWS}?changed_since={(tracked_from - timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ')}", h=K) if tracked_from else None
            check("the moment stamping began is recorded, and a read of changes cannot go back before it",
                  tracked_from is not None and tracked_from <= began and early.status_code == 400 and "changed_since" in early.json()["errors"], f"{tracked_from} {early and early.content[:200]}")
        else:
            untracked = api("get", f"{ROWS}?changed_since={since}", h=K)
            check("without the database's stamp (patch 0102) a read by change is refused in words, and rows are still read by send day",
                  untracked.status_code == 400 and "patch 0102" in str(untracked.json()["errors"]["changed_since"]) and answer.status_code == 200, f"{untracked.status_code} {untracked.content[:200]}")

        # ---- 8. the endpoint is an integration of its own; a test send never counts
        logged = sql("SELECT outcome, api_client_id::text, related_ref FROM integration_log WHERE tenant_id = %s AND kind = 'RESULTS_MESSAGES' ORDER BY id", [TENANT], True)
        record = sql("SELECT name, throttle_per_minute, log_level, status FROM integration WHERE tenant_id = %s AND kind = 'RESULTS_MESSAGES'", [TENANT], True)
        kinds = sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_integration_kind'", fetch=True)[0][0]
        check("every call is in the log with the key that made it, and (once the kind is known) the endpoint has its own record: 120 a minute, bodies kept for failures only",
              len(logged) >= 20 and all(row[1] == reader.json()["id"] for row in logged if row[0] == "OK") and any(row[2] == f"rows:{first}" for row in logged)
              and ("RESULTS_MESSAGES" not in kinds or record == [("Results: Recipients", 120, "ERRORS", "ACTIVE")]) and answer["X-RateLimit-Limit"] == "120", f"{len(logged)} {record}")
        sql("UPDATE campaign_run SET test_mode = TRUE WHERE tenant_id = %s AND id = %s", [TENANT, run2])
        check("a test send never counts", count(f"run={run2}") == 0 and count(f"campaign={first}") == 6, "")
        transaction.set_rollback(True)
    check.done()
