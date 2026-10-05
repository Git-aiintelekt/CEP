"""Digivize batch adapter: the signature against Digivize's own script, the batch body, the replies, the engine, the receipts. Rolled back; Digivize faked.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import hashlib
import hmac
import json
import uuid
from unittest import mock
from urllib.parse import parse_qs, urlsplit
import requests
from django.core.cache import cache
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from api.v1 import delivery_api
from apps.delivery.models import DeliveryProvider
from apps.delivery.providers import EventType, ProviderError, SmsMessage, registry
from apps.delivery.providers.digivize import DigivizeProvider, canonical_string, signature_for
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook, metrics
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_digivize_batch(check, admin_email):
    """Digivize batch adapter: the signature against Digivize's own script, the batch body, the replies, the engine, the receipts. Rolled back; Digivize faked."""
    REFERENCE = {"canonical": "auto_create_contacts=0&brand_id=3&callback_url=https%3A%2F%2Fexample.com%2Fwebhooks%2Fsms-batch&idempotency_key=1783523355120546028606188668268zbc0-2&key=sk_test_key&message=Hello+%7B%7BFIRST_NAME%7D%7D%2C+your+order+is+ready+for+pickup%21+It%27s+20%25+off+%26+more+%28%2A%29&message_type=marketing&recipients%5B0%5D%5Bto%5D=%2B15875764422&recipients%5B0%5D%5Bvariables%5D%5BFIRST_NAME%5D=Raymond+Rice&recipients%5B0%5D%5Bvariables%5D%5BFULL_NAME%5D=Raymond+Rice&recipients%5B0%5D%5Bvariables%5D%5BLAST_NAME%5D=Rice&recipients%5B0%5D%5Bvariables%5D%5BPARTY_ID%5D=20001964&recipients%5B0%5D%5Bexternal_ref%5D=cust_001&recipients%5B1%5D%5Bto%5D=%2B14045550100&recipients%5B1%5D%5Bexternal_ref%5D=cust_002&timestamp=1700000000&variable_normalization=gsm7_safe",
                 "signature": "efd8b9e1ae0212d7fef5a4e2ae17c40dd50742c5af0b512571f2d1237f1ab5dc"}
    sample = {
        "auto_create_contacts": False,                       # the script signs 0 and sends false: PHP's view of a boolean
        "brand_id": 3,
        "callback_url": "https://example.com/webhooks/sms-batch",
        "idempotency_key": "1783523355120546028606188668268zbc0-2",
        "key": "sk_test_key",
        "message": "Hello {{FIRST_NAME}}, your order is ready for pickup! It's 20% off & more (*)",
        "message_type": "marketing",
        "recipients": [{"to": "+15875764422", "variables": {"FIRST_NAME": "Raymond Rice", "FULL_NAME": "Raymond Rice", "LAST_NAME": "Rice", "PARTY_ID": "20001964"}, "external_ref": "cust_001"},
                       {"to": "+14045550100", "variables": {}, "external_ref": "cust_002"}],
        "timestamp": "1700000000",
        "variable_normalization": "gsm7_safe",
    }
    check("the canonical string equals the script's, including +, the %21 for !, %27 for ', %28%2A%29 for (*), nested order and an empty variables object",
          canonical_string(sample) == REFERENCE["canonical"], canonical_string(sample)[:120])
    check("the signature equals the script's, with the secret trimmed", signature_for(" s3cret ", sample) == REFERENCE["signature"])
    shuffled = {k: sample[k] for k in reversed(list(sample))}
    check("top-level order does not matter (sorted), nested order does", canonical_string(shuffled) == REFERENCE["canonical"]
          and canonical_string({**sample, "recipients": [{"external_ref": "cust_001", "to": "+15875764422"}]}) != canonical_string({**sample, "recipients": [{"to": "+15875764422", "external_ref": "cust_001"}]}))
    check("nulls are left out, true is 1", canonical_string({"a": None, "b": True}) == "b=1")

    # ---- 2. a fake Digivize that checks the signature the way the script computes it
    SECRET, KEY = "s3cret", "sk_test_key"
    fake = {"seen": [], "mode": "ok"}

    class FakeDigivize(requests.adapters.BaseAdapter):
        def send(self, request, **kwargs):
            fake["seen"].append(request)
            query = {k: v[0] for k, v in parse_qs(urlsplit(request.url).query).items()}
            body = json.loads(request.body or b"{}")
            expected = signature_for(SECRET, {**body, "key": query.get("key", ""), "timestamp": query.get("timestamp", "")})
            path = urlsplit(request.url).path
            if query.get("key") != KEY or not hmac.compare_digest(query.get("signature", ""), expected):
                status, answer = 401, {"success": False, "error": "Invalid signature"}
            elif path.endswith("/sms/send"):                                              # the route the sandbox serves: one `to`, recipients ignored
                if not isinstance(body.get("brand_id"), int):
                    status, answer = 400, {"success": False, "error": "The brand id field must be an integer.", "error_code": "VALIDATION_ERROR"}
                elif not body.get("to"):
                    status, answer = 400, {"success": False, "error": 'Either "to" or "contact_id" is required', "error_code": "VALIDATION_ERROR"}
                elif "idempotency_key" in body:                                               # idempotency_key crashes the route (probed 2026-10-02)
                    status, answer = 500, {"success": False, "error": "Internal server error", "error_code": "INTERNAL_ERROR"}
                elif body.get("message_type") == "marketing" and "STOP" not in body.get("message", ""):
                    status, answer = 400, {"success": False, "error": "Marketing SMS must contain a STOP/unsubscribe keyword", "error_code": "COMPLIANCE_FAILED"}
                elif fake["mode"] == "down":
                    status, answer = 503, {"success": False, "error": "Service unavailable"}
                elif body["to"].endswith("000"):
                    status, answer = 400, {"success": False, "error": "invalid_number: not a mobile number", "error_code": "VALIDATION_ERROR"}
                else:
                    status, answer = 200, {"success": True, "data": {"tracking_id": "trk-" + uuid.uuid4().hex[:8], "status": "queued", "to": body["to"]}}
            elif not path.endswith("/sms/batch"):
                status, answer = 419, {"error": "Your session has expired. Please refresh the page and try again."}
            elif not body.get("recipients"):
                status, answer = 422, {"success": False, "error": "The recipients field is required."}
            elif fake["mode"] == "down":
                status, answer = 503, {"success": False, "error": "Service unavailable"}
            else:
                rows = []
                for r in body["recipients"]:
                    if r["to"].endswith("000"):
                        rows.append({"to": r["to"], "external_ref": r["external_ref"], "status": "failed", "error_code": "invalid_number"})
                    else:
                        rows.append({"to": r["to"], "external_ref": r["external_ref"], "status": "queued", "tracking_id": "trk-" + uuid.uuid4().hex[:8]})
                status, answer = 200, {"success": True, "data": {"batch_id": "batch-" + uuid.uuid4().hex[:6], "recipients": rows}}
            response = requests.Response()
            response.status_code = status
            response._content = json.dumps(answer).encode()
            response.headers["Content-Type"] = "application/json"
            response.request = request
            response.url = request.url
            return response

        def close(self):
            pass

    class Fake(DigivizeProvider):
        def open(self):
            super().open()
            self._session.mount("https://", FakeDigivize())

    def rows(sql, args=()):
        with connection.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchall()

    tok = context.set_platform(True)
    staff = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    tenant = staff.tenant
    tid = str(tenant.id)
    c = Client()
    JWT = {"HTTP_X_TENANT": tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(staff))}
    J = {"content_type": "application/json"}
    cache.clear()

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(metrics, "P", "default"), \
            mock.patch.object(registry, "adapter_class", lambda kind: Fake if kind == "DIGIVIZE" else registry._ADAPTERS[kind]):
        ctx_token = context.set_current(tid, "default", str(staff.id))
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tid])
            cur.execute("SELECT set_config('app.current_user_id', %s, true)", [str(staff.id)])

        item = next(i for i in registry.catalogue() if i["provider_type"] == "DIGIVIZE")
        fields = [f["key"] for f in item["fields"]]
        check("the catalogue's form asks for the API key, the secret, the brand ID, the path and the send mode; no signature form to guess any more",
              {"api_key", "secret_key", "brand_id", "send_path", "message_type", "send_mode"} <= set(fields) and "signature_scheme" not in fields, str(fields))
        context.reset(ctx_token)
        r = c.post("/api/v1/delivery-providers/", data=json.dumps({"provider_type": "DIGIVIZE", "name": "Digivize texts", "config": {"api_key": KEY, "brand_id": "3"}, "secret": SECRET}), **J, **JWT)
        check("an engine is created with the key and brand in its settings and the secret write-only", r.status_code == 201 and r.json()["has_secret"] and r.json()["config"]["brand_id"] == "3", f"{r.status_code} {r.content[:160]}")
        pid = r.json()["id"]
        r = c.post("/api/v1/delivery-providers/", data=json.dumps({"provider_type": "DIGIVIZE", "name": "Digivize half", "config": {"api_key": KEY}, "secret": SECRET}), **J, **JWT)
        check("... and refuses one without the brand ID", r.status_code == 400 and "brand_id" in str(r.content), f"{r.status_code} {r.content[:160]}")

        # ---- Check: an empty batch, validated by Digivize = the credentials work
        fake["seen"].clear()
        r = c.post(f"/api/v1/delivery-providers/{pid}/check/", **JWT)
        body = r.json()
        check("Check posts a body without a number to sms/send and reads Digivize's validation answer as proof of the credentials", r.status_code == 200 and body["ok"] and "validated" in (body["detail"] or ""), str(body)[:160])
        probe = fake["seen"][-1]
        q = {k: v[0] for k, v in parse_qs(urlsplit(probe.url).query).items()}
        check("... with key, timestamp and signature in the query string and no auth or number in the body", set(q) == {"key", "timestamp", "signature"} and "key" not in json.loads(probe.body)
              and "to" not in json.loads(probe.body) and json.loads(probe.body)["brand_id"] == 3 and urlsplit(probe.url).path == "/api/v1/external/sms/send", probe.url[:120])
        ctx_token = context.set_current(tid, "default", str(staff.id))
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tid])

        # ---- sending: one batch per identical text, results in order
        provider = DeliveryProvider.objects.get(pk=pid)
        adapter = registry.for_provider(provider)
        msgs = [SmsMessage(to_number="+12125551001", from_sender="55123", text="Sale on now. Reply STOP to opt out.", idempotency_key="sms-1", tag="t"),
                SmsMessage(to_number="+12125551002", from_sender="55123", text="Sale on now. Reply STOP to opt out.", idempotency_key="sms-2", tag="t"),
                SmsMessage(to_number="+12125550000", from_sender="55123", text="Sale on now. Reply STOP to opt out.", idempotency_key="sms-3", tag="t"),
                SmsMessage(to_number="+12125551004", from_sender="55123", text="Hi Dana, sale on now. Reply STOP to opt out.", idempotency_key="sms-4", tag="t")]
        fake["seen"].clear()
        with adapter:
            single = adapter.send_many_guarded(msgs, related_ref="sms_run:0")
        singles = [json.loads(req.body) for req in fake["seen"]]
        check("single mode (the default): four messages are four requests to sms/send, each with brand_id, to, the text and external_ref = our id, and no idempotency_key (it crashes the route)",
              len(singles) == 4 and all(b["brand_id"] == 3 and b["to"] == m.to_number and b["message"] == m.text and b["external_ref"] == m.idempotency_key and "idempotency_key" not in b
                                        and "recipients" not in b for b, m in zip(singles, msgs)), json.dumps(singles[0])[:200])
        check("... results in order: accepted with tracking ids, the bad number rejected with Digivize's reason", [r.outcome.value for r in single] == ["ACCEPTED", "ACCEPTED", "REJECTED", "ACCEPTED"]
              and single[0].provider_message_id.startswith("trk-") and "invalid_number" in single[2].reason, str([(r.outcome.value, r.reason) for r in single]))
        with adapter:
            again_single = adapter.send_many([msgs[0]])
        check("... the same message again carries the same external_ref", json.loads(fake["seen"][-1].body)["external_ref"] == singles[0]["external_ref"] and again_single[0].outcome.value == "ACCEPTED")
        with adapter:
            no_stop = adapter.send_many([SmsMessage(to_number="+12125551009", from_sender="55123", text="Sale on now", idempotency_key="sms-9")])
        check("a marketing text without a STOP keyword is rejected with Digivize's compliance reason", no_stop[0].outcome.value == "REJECTED" and "STOP" in no_stop[0].reason, no_stop[0].reason)

        adapter.config = {**adapter.config, "send_mode": "batch", "send_path": "/api/v1/external/sms/batch"}     # the batch route, once Digivize provides it
        fake["seen"].clear()
        with adapter:
            out = adapter.send_many_guarded(msgs, related_ref="sms_run:1")
        sent = [json.loads(req.body) for req in fake["seen"]]
        check("batch mode: four messages with two distinct texts go out as two batches", len(sent) == 2 and [len(b["recipients"]) for b in sent] == [3, 1], str([len(b["recipients"]) for b in sent]))
        first = sent[0]
        check("a batch carries brand_id, the text, the type, gsm7_safe, no variables, external_ref = our id, and a stable idempotency key",
              first["brand_id"] == 3 and first["message"] == "Sale on now. Reply STOP to opt out." and first["message_type"] == "marketing" and first["variable_normalization"] == "gsm7_safe"
              and first["auto_create_contacts"] is False and [r["external_ref"] for r in first["recipients"]] == ["sms-1", "sms-2", "sms-3"] and all(r["variables"] == {} for r in first["recipients"])
              and first["idempotency_key"].startswith("cep-") and list(first) == ["brand_id", "message", "message_type", "recipients", "variable_normalization", "auto_create_contacts", "idempotency_key"],
              json.dumps(first)[:220])
        check("the body is sent in the order it was signed (the fake verified the signature and answered 200)", all(req.url for req in fake["seen"]) and out[0].outcome.value == "ACCEPTED")
        check("results come back in message order: two accepted with tracking ids, the bad number rejected with Digivize's reason, the other batch accepted",
              [r.outcome.value for r in out] == ["ACCEPTED", "ACCEPTED", "REJECTED", "ACCEPTED"] and out[0].provider_message_id.startswith("trk-") and "invalid_number" in out[2].reason, str([(r.outcome.value, r.reason) for r in out]))
        with adapter:
            again = adapter.send_many([msgs[0], msgs[1], msgs[2]])
        check("the same recipients again reuse the same idempotency key", json.loads(fake["seen"][-1].body)["idempotency_key"] == first["idempotency_key"] and len(again) == 3)
        fake["mode"] = "down"
        with adapter:
            down = adapter.send_many([msgs[0]])
        check("a 503 asks for a retry", down[0].outcome.value == "RETRY" and "503" in down[0].reason, down[0].reason)
        fake["mode"] = "ok"
        many = [SmsMessage(to_number=f"+1212555{i:04d}", from_sender="55123", text="Bulk. Reply STOP to opt out.", idempotency_key=f"bulk-{i}") for i in range(1, 251)]
        fake["seen"].clear()
        with adapter:
            bulk = adapter.send_many(many)
        check("250 recipients of one text go out in three batches of at most 100", [len(json.loads(req.body)["recipients"]) for req in fake["seen"]] == [100, 100, 50] and len(bulk) == 250)
        logged = rows("SELECT outcome, url FROM integration_log WHERE tenant_id = %s AND related_ref = 'sms_run:1' ORDER BY id DESC", [tid])
        check("the batch is in the integration log once per request, with the key and the signature masked in the address",
              len(logged) >= 2 and all("key=***" in url and "signature=***" in url and "timestamp=" in url for _, url in logged), str(logged)[:200])
        adapter.config = {k: v for k, v in adapter.config.items() if k not in ("send_mode", "send_path")}

        wrong = registry.for_provider(provider)
        wrong.secret = "other"
        with wrong:
            try:
                wrong.send_many_guarded([msgs[0]], related_ref="sms_run:2")
                check("a refused signature stops the run", False)
            except ProviderError as exc:
                check("a refused signature stops the run instead of failing one message", not exc.retryable and "refused" in str(exc), str(exc)[:120])

        # ---- receipts: by external_ref, per event or per batch
        events = adapter.parse_webhook({"event": "sms.delivered", "timestamp": 1774737615, "data": {"tracking_id": "trk-1", "to": "+12125551001", "external_ref": "sms-1", "status": "delivered"}})
        check("sms.delivered -> DELIVERED with the tracking id, our id and the time", len(events) == 1 and events[0].event_type is EventType.DELIVERED and events[0].provider_message_id == "trk-1"
              and events[0].idempotency_key == "sms-1" and events[0].occurred_at.year == 2026, str(events)[:160])
        hard = adapter.parse_webhook({"event": "sms.failed", "data": {"external_ref": "sms-2", "status": "failed", "error_code": "invalid_number"}})[0]
        soft = adapter.parse_webhook({"event": "sms.failed", "data": {"external_ref": "sms-3", "status": "undelivered", "error_code": "carrier_timeout"}})[0]
        opt = adapter.parse_webhook({"event": "sms.opted_out", "data": {"external_ref": "sms-4", "to": "+12125551004"}})[0]
        check("a permanent failure blocks the number, a temporary one does not, an opt-out is permanent", hard.bounce_type == "HARD" and soft.bounce_type == "SOFT" and opt.bounce_type == "HARD" and opt.reason == "opted_out")
        batch = adapter.parse_webhook({"event": "batch.completed", "timestamp": 1774737615, "data": {"batch_id": "batch-1", "recipients": [
            {"to": "+12125551001", "external_ref": "sms-1", "status": "delivered", "tracking_id": "trk-1"}, {"to": "+12125551002", "external_ref": "sms-2", "status": "failed", "error_code": "landline"},
            {"to": "+12125551003", "external_ref": "sms-5", "status": "queued"}]}})
        check("a batch callback with data.recipients[] becomes one event per recipient with a final status", [(e.event_type.name, e.idempotency_key, e.bounce_type) for e in batch]
              == [("DELIVERED", "sms-1", None), ("BOUNCED", "sms-2", "HARD")], str([(e.event_type.name, e.idempotency_key) for e in batch]))
        check("nothing else is an event", adapter.parse_webhook({"event": "campaign.completed", "data": {}}) == [] and adapter.parse_inbound({"event": "sms.delivered"}) == [])
        signed = DigivizeProvider(config={"webhook_secret": "hook"}, secret=None)
        raw = b'{"event":"sms.delivered"}'
        good = hmac.new(b"hook", raw, hashlib.sha256).hexdigest()
        check("a webhook secret verifies X-Signature over the body; none set accepts (the URL token is the check)",
              signed.verify_webhook({"x-signature": good}, raw) and not signed.verify_webhook({"x-signature": "0" * 64}, raw) and DigivizeProvider(config={}, secret=None).verify_webhook({}, raw))

        context.reset(ctx_token)
        url = f"/api/v1/webhooks/delivery/{tenant.code}/{pid}/{delivery_api.webhook_token(DeliveryProvider.objects.get(pk=pid))}/"
        r = c.post(url, data=json.dumps({"event": "sms.delivered", "timestamp": 1774737615, "data": {"tracking_id": "trk-none", "external_ref": "nope", "status": "delivered"}}), **J)
        check("Digivize's callback is accepted at the engine's address and counted", r.status_code == 200 and r.json()["received"] == 1 and r.json()["unmatched"] == 1, f"{r.status_code} {r.content[:160]}")
        transaction.set_rollback(True)
    check.done()
