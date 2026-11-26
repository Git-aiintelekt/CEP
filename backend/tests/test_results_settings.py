"""Settings -> Results API against the local database, rolled back: what a workspace administrator is shown before any key
can read, and once a system has read."""
import json
import time
from unittest import mock

import pytest
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"])]
PAGE = "/api/v1/workspace/results-api/"


def test_results_settings(check, admin_email):
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    analyst = AppUser.objects.get(email="priya.natarajan@northwindapparel.example")          # signed in, not an administrator
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()

    def headers(user):
        return {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(user))}

    H = headers(admin)

    def api(method, path, body=None, h=H):
        if "cep_" in h.get("HTTP_AUTHORIZATION", ""):
            time.sleep(0.12)
        if method in ("get", "delete"):
            return getattr(c, method)(path, **h)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **h)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"):
        sql("UPDATE api_client SET revoked_at = now() WHERE tenant_id = %s AND revoked_at IS NULL AND scopes @> ARRAY['results:read']::text[]", [TENANT])
        for kind in logbook.RESULTS:
            logbook.invalidate(TENANT, kind)
        fresh = sql("SELECT count(*) FROM integration WHERE tenant_id = %s AND kind LIKE 'RESULTS%%'", [TENANT], True)[0][0] == 0      # a database nobody has read results from
        known = "RESULTS_SUPPRESSIONS" in sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_integration_kind'", fetch=True)[0][0]

        # ---- 1. the first visit: nothing can read yet
        first = api("get", PAGE)
        body = first.json()
        check("an administrator is shown the address to hand over, the scope, and that no key holds it",
              first.status_code == 200 and body["endpoint"].endswith("/api/v1/results/") and body["description_url"].endswith("/api/v1/docs/") and body["scope"] == "results:read"
              and body["keys"] == [], f"{first.status_code} {first.content[:300]}")
        check("the four lists are named with their address and limit, and none has been read",
              [(row["name"], row["path"], row["limit_per_minute"], row["health"], row["calls_24h"], row["last_read_by"]) for row in body["lists"]]
              == [("Campaigns", "campaigns/", 60, "idle", 0, None), ("Sends", "runs/", 60, "idle", 0, None), ("Recipients", "messages/", 120, "idle", 0, None),
                  ("Suppressions", "suppressions/", 60, "idle", 0, None)] and all(row["integration_id"] is None for row in body["lists"])
              if fresh else [(row["name"], row["path"]) for row in body["lists"]] == [("Campaigns", "campaigns/"), ("Sends", "runs/"), ("Recipients", "messages/"), ("Suppressions", "suppressions/")],
              json.dumps(body["lists"])[:400])
        refused = [api("get", PAGE, h=headers(analyst)).status_code, api("get", PAGE, h={"HTTP_X_TENANT": CODE}).status_code]
        check("someone who is not an administrator, and nobody at all, are refused", refused == [403, 401], str(refused))

        # ---- 2. a key is made, and a system reads
        soon = api("post", "/api/v1/api-clients/", {"name": "ZT Data Warehouse", "scopes": ["results:read"], "allowed_ip_cidrs": ["203.0.113.0/28"]})
        api("post", "/api/v1/api-clients/", {"name": "ZT Events Only", "scopes": ["events:ingest"]})
        K = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + soon.json().get("key", ""), "REMOTE_ADDR": "203.0.113.5"}      # from an address the key allows
        by_key = api("get", PAGE, h=K)
        read = [api("get", "/api/v1/results/campaigns/", h=K).status_code, api("get", "/api/v1/results/suppressions/", h=K).status_code]
        after = api("get", PAGE).json()
        lists = {row["name"]: row for row in after["lists"]}
        check("the key that holds the scope is named, with where it may call from; a key with another scope is not",
              soon.status_code == 201 and [(key["name"], key["allowed_ip_cidrs"], bool(key["key_prefix"]), bool(key["last_used_at"])) for key in after["keys"]]
              == [("ZT Data Warehouse", ["203.0.113.0/28"], True, True)] and "key" not in after["keys"][0], json.dumps(after["keys"])[:300])
        check("a key itself cannot open the page: it is for the administrator", by_key.status_code == 403, str(by_key.status_code))
        if known:
            check("once a key may read, each list has its integration record; a list that was read says when and by which key",
                  read == [200, 200] and all(row["integration_id"] and row["status"] == "ACTIVE" for row in after["lists"])
                  and lists["Campaigns"]["last_read_by"] == "ZT Data Warehouse" and lists["Campaigns"]["last_call_at"] and lists["Suppressions"]["last_read_by"] == "ZT Data Warehouse"
                  and lists["Sends"]["last_read_by"] is None and lists["Sends"]["last_call_at"] is None, json.dumps(after["lists"])[:500])
            paused = api("post", f"/api/v1/integrations/{lists['Sends']['integration_id']}/pause/")
            stopped = {row["name"]: (row["status"], row["health"]) for row in api("get", PAGE).json()["lists"]}
            closed = api("get", "/api/v1/results/runs/", h=K)
            check("a list paused with the Integrations switch reads Paused here, and the other system is answered 503 on that list alone",
                  paused.status_code == 200 and stopped["Sends"] == ("PAUSED", "paused") and stopped["Campaigns"][0] == "ACTIVE" and closed.status_code == 503, f"{stopped} {closed.status_code}")
            sql("UPDATE integration SET throttle_per_minute = NULL WHERE tenant_id = %s AND kind = 'RESULTS_MESSAGES'", [TENANT])
            logbook.invalidate(TENANT, "RESULTS_MESSAGES")
            cards = {row["kind"]: row for row in api("get", "/api/v1/integrations/").json()}
            check("a Results list whose record has no figure of its own keeps the endpoint's limit, on this page and on Integrations: never the plan's, never none",
                  {row["name"]: row["limit_per_minute"] for row in api("get", PAGE).json()["lists"]}["Recipients"] == 120
                  and cards["RESULTS_MESSAGES"]["effective_limit_per_minute"] == 120, str(cards["RESULTS_MESSAGES"].get("effective_limit_per_minute")))
        else:
            check("before the database knows the Results kinds the page still answers, the lists without a record", read == [200, 200] and all(row["integration_id"] is None for row in after["lists"]), "")

        # ---- 3. a revoked or expired key is no longer named
        sql("UPDATE api_client SET expires_at = now() - interval '1 day' WHERE tenant_id = %s AND name = 'ZT Data Warehouse'", [TENANT])
        check("a key that has expired is no longer among the keys that can read", api("get", PAGE).json()["keys"] == [], "")
        transaction.set_rollback(True)
    check.done()
