"""Two credentials on one sending engine (patch 0020), against the real local DB, rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from unittest import mock
import requests
from django.core.cache import cache
from django.db import connection, transaction
from django.test import Client
from apps.delivery.models import DeliveryProvider
from apps.delivery.providers import TRAFFIC_BULK, TRAFFIC_TRANSACTIONAL, EmailMessage, registry
from apps.delivery.providers.postal import PostalProvider
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook, metrics, throttle
from apps.platform_ops import crypto
from apps.tenants import context
from rest_framework_simplejwt.tokens import AccessToken

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_transactional_key(check):
    """Two credentials on one sending engine (patch 0020), against the real local DB, rolled back."""
    tok = context.set_platform(True)
    staff = AppUser.objects.select_related("tenant").get(email="aby.john@aiintelekt.com")
    context.reset_platform(tok)
    tenant = staff.tenant
    tid = str(tenant.id)
    c = Client()
    JWT = {"HTTP_X_TENANT": tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(staff))}
    J = {"content_type": "application/json"}
    cache.clear()

    class FakeTransport(requests.adapters.BaseAdapter):
        """Postal's send endpoint: a good key answers a parameter error for an empty body / success for a message; a bad key InvalidServerAPIKey."""
        good = {"bulk-key", "txn-key"}

        def __init__(self):
            super().__init__()
            self.seen = []

        def send(self, request, **kwargs):
            self.seen.append(request)
            key = request.headers.get("X-Server-API-Key")
            if key not in self.good:
                body = {"status": "error", "data": {"code": "InvalidServerAPIKey", "message": "The API key could not be found"}}
            elif json.loads(request.body or b"{}") == {}:
                body = {"status": "parameter-error", "data": {"message": "`to` parameter is required"}}
            else:
                body = {"status": "success", "data": {"message_id": f"msg-{key}"}}
            response = requests.Response()
            response.status_code = 200
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
            super().open()
            self._session.mount("https://", self.transport)

    def rows(sql, args=()):
        with connection.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchall()

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(metrics, "P", "default"), \
            mock.patch.object(registry, "adapter_class", lambda kind: FakePostal if kind == "POSTAL" else registry._ADAPTERS[kind]):
        ctx_token = context.set_current(tid, "default", str(staff.id))
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tid])
            cur.execute("SELECT set_config('app.current_user_id', %s, true)", [str(staff.id)])

        # ---- the catalogue tells the form which secret field is the second credential
        postal = next(item for item in registry.catalogue() if item["provider_type"] == "POSTAL")
        creds = {f["key"]: f["credential"] for f in postal["fields"] if f["secret"]}
        check("the catalogue marks Postal's two credentials", creds == {"api_key": "secret", "transactional_api_key": "transactional_secret"}, str(creds))
        check("SendGrid keeps one credential", not registry._ADAPTERS["SENDGRID"].supports_transactional_credential())

        # ---- create through the API with both keys; neither is readable back
        context.reset(ctx_token)
        r = c.post("/api/v1/delivery-providers/", data=json.dumps({"provider_type": "POSTAL", "name": "Postal (two servers)", "config": {"endpoint": "https://postal.test"},
                                                                  "secret": "bulk-key", "transactional_secret": "txn-key"}), **J, **JWT)
        body = r.json()
        check("an engine is created with both credentials, both write-only", r.status_code == 201 and body["has_secret"] and body["has_transactional_secret"]
              and "secret" not in body and "transactional_secret" not in body, f"{r.status_code} {list(body)[:8]}")
        pid = body["id"]
        r = c.post("/api/v1/delivery-providers/", data=json.dumps({"provider_type": "SENDGRID", "name": "SG", "config": {}, "secret": "k", "transactional_secret": "t"}), **J, **JWT)
        check("an engine with one credential refuses a second one", r.status_code == 400 and "transactional_secret" in r.json().get("errors", {}), f"{r.status_code} {r.content[:160]}")
        ctx_token = context.set_current(tid, "default", str(staff.id))
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tid])
        stored = rows("SELECT secret_enc, transactional_secret_enc FROM delivery_provider WHERE id = %s", [pid])[0]
        check("both are stored encrypted, decrypting to what was entered", stored[0] != "bulk-key" and stored[1] != "txn-key"
              and crypto.decrypt(stored[0]) == "bulk-key" and crypto.decrypt(stored[1]) == "txn-key")
        audit = rows("SELECT new_row::text FROM definition_audit_log WHERE entity_table = 'delivery_provider' AND entity_id = %s ORDER BY id DESC LIMIT 1", [pid])
        check("the audit trail holds neither credential", audit and "txn-key" not in audit[0][0] and stored[1] not in audit[0][0] and "transactional_secret_enc" not in audit[0][0], str(audit)[:200])

        # ---- the adapter sends each traffic class with its own key
        provider = DeliveryProvider.objects.get(pk=pid)
        adapter = registry.for_provider(provider)
        bulk = EmailMessage(to_email="a@x.test", from_email="r@nw.test", subject="Sale", html="<p>hi</p>", idempotency_key="b1", traffic=TRAFFIC_BULK)
        receipt = EmailMessage(to_email="a@x.test", from_email="r@nw.test", subject="Your receipt", html="<p>hi</p>", idempotency_key="r1", traffic=TRAFFIC_TRANSACTIONAL)
        check("a message is bulk unless said otherwise", EmailMessage(to_email="a", from_email="b", subject="s", html="h").traffic == TRAFFIC_BULK)
        with adapter:
            r_bulk = adapter.send_guarded(bulk, related_ref="mailer_execution:1")
            r_txn = adapter.send_guarded(receipt, related_ref="receipt:R-1")
        keys = [req.headers.get("X-Server-API-Key") for req in FakePostal.transport.seen[-2:]]
        check("a campaign message goes out with the server key, a receipt with the transactional key", keys == ["bulk-key", "txn-key"] and r_bulk.provider_message_id == "msg-bulk-key"
              and r_txn.provider_message_id == "msg-txn-key", str(keys))
        check("the two lanes throttle separately", adapter.guard.scope(bulk) != adapter.guard.scope(receipt) and adapter.guard.scope(receipt).endswith(":transactional"),
              f"{adapter.guard.scope(bulk)} / {adapter.guard.scope(receipt)}")
        logged = rows("SELECT request_headers::text, request_body FROM integration_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 2", [tid])
        check("both keys are masked in the log", all('"x-server-api-key": "***"' in row[0] and "txn-key" not in row[0] and "bulk-key" not in row[0] for row in logged), str(logged)[:200])

        # ---- one key: everything goes out on it; the lane is shared
        only = DeliveryProvider.objects.create(tenant_id=tid, provider_type="POSTAL", channel="EMAIL", name="Postal (one server)", config={"endpoint": "https://postal.test"},
                                               secret_enc=crypto.encrypt("bulk-key"), created_by_id=staff.id)
        single = registry.for_provider(only)
        with single:
            single.send_guarded(receipt, related_ref="receipt:R-2")
        check("without a second key a receipt goes out on the server key, in the shared lane", FakePostal.transport.seen[-1].headers.get("X-Server-API-Key") == "bulk-key"
              and single.guard.scope(receipt) == single.guard.scope(bulk))

        # ---- check() tries both keys and names the bad one
        ok, detail = adapter.check()
        check("the check passes when both keys work", ok and detail == "Both keys work.", f"{ok} {detail}")
        adapter.transactional_secret = "wrong"
        ok, detail = adapter.check()
        check("... and names the transactional key when it is refused", not ok and "transactional server API key" in detail and "InvalidServerAPIKey" in detail, detail)

        # ---- edit: blank keeps, the drop flag removes
        context.reset(ctx_token)
        r = c.patch(f"/api/v1/delivery-providers/{pid}/", data=json.dumps({"name": "Postal (two servers)", "secret": "", "transactional_secret": ""}), **J, **JWT)
        check("saving with blank keys keeps both", r.status_code == 200 and r.json()["has_secret"] and r.json()["has_transactional_secret"], f"{r.status_code} {r.content[:120]}")
        r = c.patch(f"/api/v1/delivery-providers/{pid}/", data=json.dumps({"drop_transactional_secret": True}), **J, **JWT)
        check("the drop flag removes the transactional key and keeps the server key", r.status_code == 200 and r.json()["has_secret"] and not r.json()["has_transactional_secret"], f"{r.status_code} {r.content[:120]}")
        ctx_token = context.set_current(tid, "default", str(staff.id))
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tid])
        check("... in the database too", rows("SELECT transactional_secret_enc IS NULL FROM delivery_provider WHERE id = %s", [pid])[0][0])
        context.reset(ctx_token)
        transaction.set_rollback(True)
    check.done()
