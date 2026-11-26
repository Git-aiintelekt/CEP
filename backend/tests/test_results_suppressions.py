"""The Results API's list of who must not be contacted, against the local database, rolled back: another system reads the
unsubscribes, STOP replies and blocked addresses by party ID with a key that has results:read."""
import csv
import io
import json
import time
import uuid
from datetime import timedelta
from unittest import mock

import pytest
from django.db import connection, transaction
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.delivery.engine import unsubscribe
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.reporting import result_suppressions
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]
LIST = "/api/v1/results/suppressions/"


def test_results_suppressions(check, admin_email):
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

    def as_workspace(work):
        token = context.set_current(TENANT, "default")
        try:
            sql("SELECT 1")
            return work()
        finally:
            context.reset(token)

    began = (timezone.now() - timedelta(seconds=2)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    campaign = str(uuid.uuid4())

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(result_suppressions, "AS_OF_LAG_SECONDS", 0):
        nobody_before = sql("SELECT count(*) FROM contact_point_status WHERE tenant_id = %s AND blocked AND party_id IS NULL", [TENANT], True)[0][0]
        for n in range(7):
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Zedstone', %s::jsonb, %s::jsonb)",
                [f"ZS-P{n:02d}", TENANT, f"Zedkin{n}", json.dumps([{"address": f"zedkin{n}@zs.example", "is_primary": True}]),
                 json.dumps([{"number": f"+1470555{6000 + n}", "type": "MOBILE", "is_primary": True}])])

        def block(kind, value, party, reason, source, blocked=True):
            sql("""INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, blocked, block_reason, block_source, blocked_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, now())""", [TENANT, kind, value, party, blocked, reason, source])

        # what CEP learned first: a link, a STOP reply (which also blocks the number), a bounce, a complaint (a block and an opt-out)
        as_workspace(lambda: unsubscribe.opt_out(tenant_id=TENANT, party_id="ZS-P00", email="zedkin0@zs.example", campaign_id=campaign, method="UNSUBSCRIBE_LINK", channel="EMAIL"))
        as_workspace(lambda: unsubscribe.opt_out(tenant_id=TENANT, party_id="ZS-P01", method="SMS_STOP", channel="SMS"))
        block("PHONE", "+14705556001", "ZS-P01", "MANUAL", "SMS_STOP")
        block("EMAIL", "zedkin2@zs.example", "ZS-P02", "HARD_BOUNCE", "POSTAL")
        as_workspace(lambda: unsubscribe.opt_out(tenant_id=TENANT, party_id="ZS-P03", email="zedkin3@zs.example", method="COMPLAINT", channel="EMAIL"))
        block("EMAIL", "zedkin3@zs.example", "ZS-P03", "COMPLAINT", "POSTAL")
        # what the customer system itself sent: an opt-out that came with the customer, a block marked C360
        sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, opted_out_at, marketable) VALUES (%s, 'ZS-P04', 'EMAIL', 'OPTED_OUT', now(), FALSE)", [TENANT])
        block("PHONE", "+14705556005", "ZS-P05", "MANUAL", "C360")
        # an address with no customer behind it, and a person who simply opted in
        block("EMAIL", "nobody@zs.example", None, "GLOBAL_SUPPRESSION_LIST", "IMPORT")
        sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, opted_in_at, marketable) VALUES (%s, 'ZS-P06', 'EMAIL', 'OPTED_IN', now(), TRUE)", [TENANT])

        reader = api("post", "/api/v1/api-clients/", {"name": "ZS iCRM", "scopes": ["results:read"]})
        other = api("post", "/api/v1/api-clients/", {"name": "ZS events only", "scopes": ["events:ingest"]})
        K = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + reader.json().get("key", "")}
        K_OTHER = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + other.json().get("key", "")}

        def ours(answer):
            return {row["party_id"]: row for row in answer.json()["results"] if row["party_id"].startswith("ZS-")}

        # ---- 1. who may read, and what the list holds
        answer = api("get", f"{LIST}?changed_since={began}", h=K)
        refused = [api("get", LIST, h=h).status_code for h in (K_OTHER, H, {"HTTP_X_TENANT": CODE})]
        check("a key with results:read reads the list; a key without the scope, a person's session and no key are refused",
              answer.status_code == 200 and refused == [403, 403, 401], f"{answer.status_code} {answer.content[:200]} {refused}")
        rows = ours(answer)
        check("one row a fact, by party ID: the unsubscribe with its campaign, the STOP reply (not the block it caused), the bounce, the complaint (not the opt-out it caused)",
              set(rows) == {"ZS-P00", "ZS-P01", "ZS-P02", "ZS-P03"} and len(answer.json()["results"]) == len(rows)
              and (rows["ZS-P00"]["reason"], rows["ZS-P00"]["source"], rows["ZS-P00"]["channel"], rows["ZS-P00"]["campaign_id"], rows["ZS-P00"]["id"][:2])
              == ("UNSUBSCRIBED", "UNSUBSCRIBE_LINK", "EMAIL", campaign, "C-")
              and (rows["ZS-P01"]["reason"], rows["ZS-P01"]["source"], rows["ZS-P01"]["channel"]) == ("OPTED_OUT", "SMS_STOP", "SMS")
              and (rows["ZS-P02"]["reason"], rows["ZS-P02"]["source"], rows["ZS-P02"]["channel"], rows["ZS-P02"]["id"][:2]) == ("HARD_BOUNCE", "POSTAL", "EMAIL", "B-")
              and (rows["ZS-P03"]["reason"], rows["ZS-P03"]["id"][:2]) == ("COMPLAINT", "B-"), json.dumps(list(rows.values()))[:500])
        check("every row has the same fields, holds now, and says since when; the answer says when it was read",
              all(tuple(row) == result_suppressions.FIELDS and row["active"] is True and row["since"] and row["changed_at"] for row in rows.values())
              and answer.json()["as_of"] and answer.json()["changed_since"] and answer["X-As-Of"] and answer["Cache-Control"] == "no-store", str(answer.json())[:200])
        text = answer.content.decode()
        check("a customer is a party ID and nothing else: no address, no number, no name", "zs.example" not in text and "+1470555" not in text and "Zedkin" not in text, text[:200])
        whole = api("get", f"{LIST}?page_size=1000", h=K)
        check("with no moment the whole list is read: everything that holds now, and how many blocked addresses have no customer behind them and so are left out",
              whole.status_code == 200 and {"ZS-P00", "ZS-P01", "ZS-P02", "ZS-P03"} <= set(ours(whole)) and "changed_since" not in whole.json()
              and whole.json()["left_out"] == {"without_party_id": nobody_before + 1} and all(row["active"] for row in whole.json()["results"]), str(whole.json().get("left_out")))

        # ---- 2. what the customer system itself sent is left out unless asked for
        everything = ours(api("get", f"{LIST}?changed_since={began}&origin=all", h=K))
        check("an opt-out that came with the customer and a block marked C360 are left out, and answered with origin=all",
              set(everything) == {"ZS-P00", "ZS-P01", "ZS-P02", "ZS-P03", "ZS-P04", "ZS-P05"} and (everything["ZS-P04"]["reason"], everything["ZS-P04"]["source"]) == ("UNSUBSCRIBED", None)
              and (everything["ZS-P05"]["source"], everything["ZS-P05"]["channel"]) == ("C360", "PHONE") and "ZS-P06" not in everything, str(sorted(everything)))

        # ---- 3. filters, pages, CSV
        emails, texts = ours(api("get", f"{LIST}?changed_since={began}&channel=EMAIL", h=K)), ours(api("get", f"{LIST}?changed_since={began}&channel=sms", h=K))
        phones = ours(api("get", f"{LIST}?changed_since={began}&channel=PHONE&origin=all", h=K))
        check("by channel: email, texts, and blocked numbers alone", set(emails) == {"ZS-P00", "ZS-P02", "ZS-P03"} and set(texts) == {"ZS-P01"} and set(phones) == {"ZS-P05"},
              f"{sorted(emails)} {sorted(texts)} {sorted(phones)}")
        seen, pages, address, marks = [], 0, f"{LIST}?changed_since={began}&page_size=1", set()
        while address and pages < 8:
            page = api("get", address, h=K)
            seen += [row["party_id"] for row in page.json()["results"]]
            marks.add(page.json()["as_of"])
            address, pages = page.json()["next"], pages + 1
        check("a row a page: every row once, one as_of for the whole read, the people's own decisions before the blocks",
              pages == 4 and sorted(seen) == ["ZS-P00", "ZS-P01", "ZS-P02", "ZS-P03"] and seen[:2] == ["ZS-P00", "ZS-P01"] and len(marks) == 1, f"{pages} {seen} {marks}")
        sheet = api("get", f"{LIST}?changed_since={began}&format=csv&page_size=3", h=K)
        lines = list(csv.reader(io.StringIO(sheet.content.decode())))
        check("the same rows as CSV, the next page in the Link header",
              sheet.status_code == 200 and sheet["Content-Type"].startswith("text/csv") and tuple(lines[0]) == result_suppressions.FIELDS and len(lines) == 4
              and lines[1][lines[0].index("active")] == "True" and "format=csv" in sheet["Link"], f"{sheet.status_code} {lines[:2]} {sheet.get('Link')}")

        # ---- 4. what was lifted
        as_workspace(lambda: unsubscribe.opt_in(tenant_id=TENANT, party_id="ZS-P01", channel="SMS", source="SMS_STOP"))
        sql("UPDATE contact_point_status SET blocked = FALSE, unblocked_at = now() WHERE tenant_id = %s AND party_id = 'ZS-P02'", [TENANT])
        after = ours(api("get", f"{LIST}?changed_since={began}", h=K))
        held = ours(api("get", f"{LIST}?page_size=1000", h=K))
        check("a person who asks for messages again and a block that was removed come back as lifted in a read by change, and are gone from the whole list; a plain opt-in is no news",
              set(after) == {"ZS-P00", "ZS-P01", "ZS-P02", "ZS-P03"} and after["ZS-P01"]["active"] is False and after["ZS-P02"]["active"] is False and after["ZS-P00"]["active"] is True
              and "ZS-P01" not in held and "ZS-P02" not in held and {"ZS-P00", "ZS-P03"} <= set(held), f"{[(p, r['active']) for p, r in after.items()]} {sorted(held)}")

        # ---- 5. what is refused, and the endpoint's own integration
        asked = {"changed_since": "changed_since=2026-11-26T08:00:00", "channel": "channel=FAX", "origin": "origin=mars", "cursor": "cursor=not-a-cursor", "page_size": "page_size=lots"}
        answers = {field: api("get", f"{LIST}?{query}", h=K) for field, query in asked.items()}
        check("a moment without its zone, a channel or origin that is none, a cursor that is none and a page size in words are refused by field",
              all(got.status_code == 400 and field in got.json()["errors"] for field, got in answers.items()), str({field: (got.status_code, got.content[:80]) for field, got in answers.items()}))
        logged = sql("SELECT outcome, api_client_id::text FROM integration_log WHERE tenant_id = %s AND kind = 'RESULTS_SUPPRESSIONS' ORDER BY id", [TENANT], True)
        record = sql("SELECT name, throttle_per_minute, log_level, status FROM integration WHERE tenant_id = %s AND kind = 'RESULTS_SUPPRESSIONS'", [TENANT], True)
        kinds = sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_integration_kind'", fetch=True)[0][0]
        check("every call is in the log with the key that made it; the endpoint is limited to 60 a minute and (once the kind is known) has its own record",
              len(logged) >= 12 and all(row[1] == reader.json()["id"] for row in logged if row[0] == "OK") and answer["X-RateLimit-Limit"] == "60"
              and ("RESULTS_SUPPRESSIONS" not in kinds or record == [("Results: Suppressions", 60, "ERRORS", "ACTIVE")]), f"{len(logged)} {record}")
        transaction.set_rollback(True)
    check.done()
