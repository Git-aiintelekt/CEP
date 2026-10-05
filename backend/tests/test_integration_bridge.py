"""Integration bridge (patch 0019) against the real local DB, rolled back. The platform alias is pointed at the default
connection for the run so every write shares the one transaction that is rolled back at the end.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
import time
import uuid
from unittest import mock
import requests
from django.core.cache import cache
from django.db import connection, transaction
from django.test import Client
from api.v1 import delivery_api
from apps.delivery.models import DeliveryProvider
from apps.delivery.providers import EmailMessage, Outcome, ProviderError, SmsMessage, registry
from apps.delivery.providers.postal import PostalProvider
from apps.delivery.providers.sandbox_sms import SandboxSmsProvider
from apps.delivery.engine import session
from apps.identity.models import ApiClient, AppUser
from apps.integrations.bridge import logbook, metrics, outbound, throttle
from apps.tenants import context
from rest_framework_simplejwt.tokens import AccessToken

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_integration_bridge(check, admin_email):
    """Integration bridge (patch 0019) against the real local DB, rolled back. The platform alias is pointed at the default"""
    tok = context.set_platform(True)
    staff = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    tenant = staff.tenant
    tid = str(tenant.id)
    c = Client()
    JWT = {"HTTP_X_TENANT": tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(staff))}
    J = {"content_type": "application/json"}
    cache.clear()

    class FakeTransport(requests.adapters.BaseAdapter):
        """Answers Postal's send endpoint with whatever the test queued."""
        def __init__(self):
            super().__init__()
            self.queue = []
            self.seen = []

        def send(self, request, **kwargs):
            self.seen.append(request)
            status, body = self.queue.pop(0) if self.queue else (200, {"status": "success", "data": {"message_id": "msg-1"}})
            response = requests.Response()
            response.status_code = status
            response._content = json.dumps(body).encode()
            response.headers["Content-Type"] = "application/json"
            response.request = request
            response.url = request.url
            return response

        def close(self):
            pass

    class FakePostal(PostalProvider):
        transport = FakeTransport()

        def open(self):
            self._session = self.new_session()
            self._session.headers.update({"X-Server-API-Key": self.secret or "", "Content-Type": "application/json"})
            self._session.mount("https://", self.transport)

    def rows(sql, args=()):
        with session.tx(), session.connection().cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchall()

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(metrics, "P", "default"), \
            mock.patch.object(metrics, "_aliases", lambda: ["default"]):
        ctx_token = context.set_current(tid, "default", str(staff.id))
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tid])
            cur.execute("SELECT set_config('app.current_user_id', %s, true)", [str(staff.id)])

        # ---- a sending engine with a fake Postal behind it
        provider = DeliveryProvider.objects.create(tenant_id=tid, provider_type="POSTAL", channel="EMAIL", name="Postal (bridge test)",
                                                   config={"endpoint": "https://postal.test"}, secret_ref="", secret_enc=None, rate_limit_per_minute=600, created_by_id=staff.id)
        with mock.patch.object(registry, "adapter_class", lambda kind: FakePostal if kind == "POSTAL" else registry._adapters[kind]), \
                mock.patch.object(registry, "resolve_secret", lambda p: "k"):
            adapter = registry.for_provider(provider)
        check("the adapter carries the provider's name and rate", adapter.provider_name == "Postal (bridge test)" and adapter.rate_limit_per_minute == 600)

        message = EmailMessage(to_email="a@x.test", to_name="A", from_email="r@nw.test", from_name="NW", reply_to=None, subject="Hello", html="<p>hi</p>", text="hi",
                               idempotency_key="k1", tag="t", headers={}, metadata={})
        with adapter:
            result = adapter.send_guarded(message, related_ref="mailer_execution:1")
        check("a guarded send through a logged session is accepted", result.provider_message_id == "msg-1")
        out = rows("SELECT direction, kind, system, method, url, request_body, response_status, outcome, related_ref, duration_ms, request_headers::text, integration_id "
                   "FROM integration_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 1", [tid])[0]
        check("... and one OUT log row holds method, address, body, status, outcome, reference and timing",
              out[:4] == ("OUT", "PROVIDER", "POSTAL", "POST") and out[4] == "https://postal.test/api/v1/send/message" and '"subject": "Hello"' in out[5]
              and out[6] == 200 and out[7] == "OK" and out[8] == "mailer_execution:1" and out[9] is not None and out[11] is not None, str(out[:10]))
        check("the API key header is redacted in the log", '"x-server-api-key": "***"' in out[10], out[10][:120])
        integration_id = str(out[11])
        seen = rows("SELECT name, kind, direction, system, last_outcome, last_call_at IS NOT NULL FROM integration WHERE id = %s", [integration_id])[0]
        check("the PROVIDER integration record was made on first use, named after the engine, with its last call",
              seen == ("Postal (bridge test)", "PROVIDER", "OUT", "POSTAL", "OK", True), str(seen))

        # ---- provider trouble: RETRY rows, then the breaker opens
        with session.tx(), session.connection().cursor() as cur:
            cur.execute("UPDATE integration SET breaker_failures = 2, breaker_cooldown_seconds = 30 WHERE id = %s", [integration_id])
        logbook.invalidate(tid, logbook.KIND_PROVIDER, str(provider.pk))
        adapter.guard = None
        FakePostal.transport.queue = [(500, {"status": "error"}), (503, {"status": "error"})]
        with adapter:
            r1 = adapter.send_guarded(message, related_ref="mailer_execution:2")
            r2 = adapter.send_guarded(message, related_ref="mailer_execution:3")
            try:
                adapter.send_guarded(message, related_ref="mailer_execution:4")
                opened = None
            except ProviderError as exc:
                opened = exc
        check("two 5xx answers are RETRY outcomes", r1.outcome is Outcome.RETRY and r2.outcome is Outcome.RETRY)
        check("... and the third send is refused by the open circuit, retryable, without an HTTP call",
              opened is not None and opened.retryable and "circuit is open" in str(opened) and len(FakePostal.transport.seen) == 3, str(opened))
        last = rows("SELECT outcome, error_message, method FROM integration_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 3", [tid])
        check("the log shows RETRY, RETRY, BREAKER", [r[0] for r in reversed(last)] == ["RETRY", "RETRY", "BREAKER"] and last[0][2] == "SEND", str(last))
        check("the record mirrors the open circuit for the status page", rows("SELECT breaker_open_until > now() FROM integration WHERE id = %s", [integration_id])[0][0])
        outbound.Breaker({"id": integration_id, "tenant_id": tid, "breaker_failures": 2, "breaker_cooldown_seconds": 30}).reset()
        check("resetting closes it", not outbound.Breaker({"id": integration_id, "tenant_id": tid, "breaker_failures": 2, "breaker_cooldown_seconds": 30}).open_until())

        # ---- throttle on an engine: 1 per minute -> the second send gives up its turn instead of blocking the worker
        with session.tx(), session.connection().cursor() as cur:
            cur.execute("UPDATE integration SET throttle_per_minute = 1 WHERE id = %s", [integration_id])
        logbook.invalidate(tid, logbook.KIND_PROVIDER, str(provider.pk))
        adapter.guard = None
        FakePostal.transport.queue = []
        cache.delete_many([k for k in [f"{throttle.PREFIX}:provider:{provider.pk}:m:{int(time.time() // 60)}", f"{throttle.PREFIX}:provider:{provider.pk}:s:{int(time.time())}"]])  # the minute's earlier sends
        real_wait = throttle.wait
        with mock.patch.object(outbound.throttle, "wait", lambda scope, per_minute, burst=None: real_wait(scope, per_minute, burst, sleep=lambda s: None)), adapter:
            first = adapter.send_guarded(message, related_ref="mailer_execution:5")
            try:
                adapter.send_guarded(message, related_ref="mailer_execution:6")
                second = None
            except ProviderError as exc:
                second = exc
        check("the first send passes the 1/min throttle, the second is handed back as retryable", first.outcome is Outcome.ACCEPTED and second is not None and second.retryable
              and "rate limit" in str(second), str(second))
        check("... with a THROTTLED row and no HTTP call for it", rows("SELECT outcome FROM integration_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 1", [tid])[0][0] == "THROTTLED")

        # ---- an engine without HTTP gets a synthetic row per send
        sandbox_row = DeliveryProvider.objects.create(tenant_id=tid, provider_type="SANDBOX_SMS", channel="SMS", name="Sandbox texts", config={}, created_by_id=staff.id)
        sandbox = registry.for_provider(sandbox_row)
        orphan = SandboxSmsProvider(config={}, secret=None, provider_id=str(uuid.uuid4()), tenant_id=tid)
        with orphan:
            orphan.send_guarded(SmsMessage(to_number="+14045550100", from_sender="55123", text="hi", media_url=None, subject="", idempotency_key="s0", tag="t", metadata={}), related_ref="sms_execution:0")
        check("an adapter whose engine row does not exist is still logged, without a record", rows("SELECT integration_id IS NULL, outcome FROM integration_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 1", [tid])[0] == (True, "OK"))
        with sandbox:
            sms = sandbox.send_guarded(SmsMessage(to_number="+14045550100", from_sender="55123", text="hi", media_url=None, subject="", idempotency_key="s1", tag="t", metadata={}), related_ref="sms_execution:1")
        srow = rows("SELECT system, method, url, outcome, response_body FROM integration_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 1", [tid])[0]
        check("a non-HTTP engine logs one SEND row with the outcome", srow[0] == "SANDBOX_SMS" and srow[1] == "SEND" and srow[2].startswith("sandbox_sms://") and srow[3] == "OK"
              and '"outcome": "accepted"' in srow[4].lower(), str(srow))

        # ---- inbound: the POS receipt endpoint behind an API key with a 2/min limit
        key_secret = "cep_in_Br1dGe" + "x" * 30
        import hashlib
        client_row = ApiClient.objects.create(tenant_id=tid, name="POS test", client_type="INTEGRATION", key_prefix=key_secret[:13], key_hash=hashlib.sha256(key_secret.encode()).hexdigest(),
                                              scopes=["receipts:send"], rate_limit_per_minute=2, created_by_id=staff.id)
        KEY = {"HTTP_X_TENANT": tenant.code, "HTTP_AUTHORIZATION": "Bearer " + key_secret, "HTTP_X_CORRELATION_ID": "pos-corr-0001"}
        body = {"campaign": "RCPT", "to": "buyer@x.test", "receipt": {"number": "R-1001", "grand_total": 12.5, "card_number": "4111 1111 1111 1111", "items": []}}
        context.reset(ctx_token)                                   # the request middleware sets its own context
        with mock.patch.object(delivery_api.receipts, "send", lambda *a, **k: {"status": "SUBMITTED", "execution_id": 7, "provider_message_id": "m", "duplicate": False}), \
                mock.patch("apps.platform_ops.params.RequiresFeature.has_permission", lambda self, r, v: True):
            r = c.post("/api/v1/receipts/send/", data=json.dumps(body), **J, **KEY)
            check("a receipt call is accepted and answered with the caller's correlation id and rate headers",
                  r.status_code == 201 and r["X-Correlation-Id"] == "pos-corr-0001" and r["X-RateLimit-Limit"] == "2" and r["X-RateLimit-Remaining"] == "1", f"status={r.status_code} headers={dict(r.items())}")
            r2 = c.post("/api/v1/receipts/send/", data=json.dumps(body), **J, **KEY)
            r3 = c.post("/api/v1/receipts/send/", data=json.dumps(body), **J, **KEY)
            check("the third call within the minute is refused: 429, Retry-After, problem+json", r2.status_code == 201 and r3.status_code == 429 and r3.has_header("Retry-After")
                  and r3["Content-Type"].startswith("application/"), f"{r2.status_code} {r3.status_code} {dict(r3.items())} {r3.content[:120]}")
        ctx_token = context.set_current(tid, "default", str(staff.id))
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tid])
        inbound = rows("SELECT direction, kind, system, correlation_id, related_ref, request_body, response_status, outcome, api_client_id::text, response_body "
                       "FROM integration_log WHERE tenant_id = %s AND direction = 'IN' ORDER BY id", [tid])
        check("three IN rows: OK, OK, THROTTLED, each with the correlation id, the receipt reference and the key that called",
              [r[7] for r in inbound] == ["OK", "OK", "THROTTLED"] and all(r[3] == "pos-corr-0001" and r[4] == "receipt:R-1001" and r[8] == str(client_row.pk) for r in inbound)
              and inbound[0][6] == 201 and inbound[2][6] == 429, str([(r[6], r[7]) for r in inbound]))
        check("the card number in the receipt is masked in the stored body, the rest kept verbatim",
              '"card_number": "***"' in inbound[0][5] and '"grand_total": 12.5' in inbound[0][5] and "4111" not in inbound[0][5], inbound[0][5][:160])
        check("the answer body is stored too", '"execution_id": 7' in inbound[0][9])
        pos = rows("SELECT id, name, direction, system FROM integration WHERE tenant_id = %s AND kind = 'POS_RECEIPTS'", [tid])[0]
        check("the POS receipts record exists", pos[1:] == ("POS receipts", "IN", "POS"), str(pos))

        # ---- pause = 503, logged as PAUSED
        with session.tx(), session.connection().cursor() as cur:
            cur.execute("UPDATE integration SET status = 'PAUSED' WHERE id = %s", [str(pos[0])])
        logbook.invalidate(tid, logbook.KIND_POS, None)
        context.reset(ctx_token)
        with mock.patch.object(delivery_api.receipts, "send", lambda *a, **k: {"status": "SUBMITTED", "execution_id": 8, "provider_message_id": "m", "duplicate": False}), \
                mock.patch("apps.platform_ops.params.RequiresFeature.has_permission", lambda self, r, v: True), \
                mock.patch.object(logbook, "record", wraps=logbook.record) as recorded:
            r = c.post("/api/v1/receipts/send/", data=json.dumps(body), **J, **{**KEY, "HTTP_X_CORRELATION_ID": ""})
        check("a paused POS integration answers 503 with a fresh correlation id", r.status_code == 503 and len(r["X-Correlation-Id"]) == 32, f"{r.status_code} {r.content[:100]}")
        ctx_token = context.set_current(tid, "default", str(staff.id))
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tid])
        # the middleware rolls a 5xx request back; in the pool the row goes through the platform connection, which this rolled-back test cannot use
        check("... recorded as PAUSED on its own connection", recorded.call_args is not None and recorded.call_args.kwargs["outcome"] == "PAUSED"
              and recorded.call_args.kwargs["own_transaction"] is True and recorded.call_args.kwargs["integration"]["status"] == "PAUSED",
              str(recorded.call_args and {k: recorded.call_args.kwargs[k] for k in ("outcome", "own_transaction", "response_status")}))
        with session.tx(), session.connection().cursor() as cur:
            cur.execute("UPDATE integration SET status = 'ACTIVE' WHERE id = %s", [str(pos[0])])
        logbook.invalidate(tid, logbook.KIND_POS, None)

        # ---- provider callback logged as IN
        payload = {"event": "MessageSent", "timestamp": time.time(), "payload": {"message": {"message_id": "msg-1", "to": "a@x.test"}}}
        context.reset(ctx_token)
        with mock.patch.object(registry, "adapter_class", lambda kind: FakePostal if kind == "POSTAL" else registry._adapters[kind]):
            r = c.post(f"/api/v1/webhooks/delivery/{tenant.code}/{provider.pk}/{delivery_api.webhook_token(provider)}/", data=json.dumps(payload), **J)
        ctx_token = context.set_current(tid, "default", str(staff.id))
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tid])
        cb = rows("SELECT direction, system, related_ref, response_body, outcome FROM integration_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 1", [tid])[0]
        check("a Postal callback is logged as an IN row for the engine's record", r.status_code == 200 and cb[0] == "IN" and cb[1] == "POSTAL" and cb[2] == f"provider:{provider.pk}"
              and '"received": 1' in cb[3], f"{r.status_code} {cb}")

        # ---- rollup, status, the settings API
        with mock.patch.object(metrics, "prune", return_value={"metrics_pruned": 0, "log_rows_pruned": 0}):   # deletes are the platform role's
            summary = metrics.rollup()
        check("the rollup writes minute buckets", summary["buckets"] >= 2, str(summary))
        status = metrics.status(tid)
        postal_status = next(s for s in status if s["id"] == integration_id)
        pos_status = next(s for s in status if s["kind"] == "POS_RECEIPTS")
        check("status: the engine shows its calls, failures and p95; the POS record its throttled call and effective limit",
              postal_status["calls_24h"] >= 5 and postal_status["retried_24h"] == 2 and postal_status["p95_ms"] is not None and pos_status["throttled_24h"] == 1
              and pos_status["effective_limit_per_minute"] in (60, 600, None) and postal_status["health"] in ("degraded", "healthy"), f"{postal_status['calls_24h']} {postal_status['retried_24h']} {pos_status['throttled_24h']} {postal_status['health']}")
        context.reset(ctx_token)
        r = c.get("/api/v1/integrations/", **JWT)
        listed = r.json() if r.status_code == 200 else []
        check("GET /integrations/ lists the POS record and the engine with their figures", r.status_code == 200 and {i["kind"] for i in listed} >= {"POS_RECEIPTS", "PROVIDER"}
              and any(i["id"] == integration_id and i["calls_24h"] >= 5 for i in listed), f"status={r.status_code} n={len(listed)}")
        r = c.get("/api/v1/integrations/log/?direction=IN&q=pos-corr-0001", **JWT)
        found = r.json()["results"] if r.status_code == 200 else []
        check("GET /integrations/log/ filters by direction and correlation id", r.status_code == 200 and len(found) == 3 and all(f["correlation_id"] == "pos-corr-0001" for f in found), f"{r.status_code} n={len(found)}")
        r = c.get(f"/api/v1/integrations/log/{found[0]['id']}/", **JWT)
        check("GET one row returns the request and response bodies with the card masked", r.status_code == 200 and '"card_number": "***"' in r.json()["request_body"] and r.json()["response_body"], f"{r.status_code}")
        r = c.post(f"/api/v1/integrations/{integration_id}/pause/", **JWT)
        r2 = c.post(f"/api/v1/integrations/{integration_id}/resume/", **JWT)
        check("pause and resume flip the record through the API", r.status_code == 200 and r.json()["status"] == "PAUSED" and r2.status_code == 200 and r2.json()["status"] == "ACTIVE", f"{r.status_code} {r2.status_code}")
        r = c.get(f"/api/v1/integrations/{integration_id}/metrics/?hours=24", **JWT)
        check("GET metrics answers chart buckets", r.status_code == 200 and r.json()["step_minutes"] == 15 and sum(b["calls"] for b in r.json()["buckets"]) >= 5, f"{r.status_code}")

        transaction.set_rollback(True)
    check.done()
