"""A Postal callback delivered twice is kept as DUPLICATE and applied once (patch 0021). Real local DB, rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
from apps.delivery.models import DeliveryProvider
import json
from unittest import mock
import requests
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from api.v1.delivery_api import webhook_token
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_webhook_dedupe(check):
    """A Postal callback delivered twice is kept as DUPLICATE and applied once (patch 0021). Real local DB, rolled back."""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email="aby.john@aiintelekt.com")
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **H)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **H)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    def postal_answer(body):
        r = requests.Response()
        r.status_code, r._content = 200, json.dumps(body).encode()
        r.headers["Content-Type"] = "application/json"
        return r

    OK = {"status": "success", "data": {"message_id": "rcpt-1@postal.example"}}
    RECEIPT = {"number": "R-104-88213", "transaction_at": "2026-09-18T16:12:00", "currency": "USD", "subtotal": 84, "tax_total": 5.38, "grand_total": 89.38, "tender_summary": "Visa 4242",
               "items": [{"description": "Wool socks", "quantity": 2, "unit_price": 10}]}

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"):
        provider = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZZ Postal dedupe", "secret": "k", "config": {"endpoint": "https://postal.zz.example"}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": provider["id"], "display_name": "ZZ Receipts", "from_address": "receipts@zz.example"}).json()
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "me@zz.example"})
        template = api("post", "/api/v1/templates/", {"name": "ZZ dedupe receipt", "channel": "E_RECEIPT", "starter": "store_receipt"}).json()
        sql("DELETE FROM rendered_template_content WHERE template_id = %s", [template["id"]])
        sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 9, %s, %s, %s)",
            [template["id"], "Receipt {{receipt_number}}", "<p>{{receipt_body}}</p>", "{{receipt_body}}"])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])
        campaign = api("post", "/api/v1/campaigns/", {"name": "ZZ dedupe receipts", "campaign_type": "E_RECEIPT", "channel": "EMAIL", "solicitation_type": "TRANSACTIONAL",
                                                      "template": template["id"], "sender_profile": sender["id"]}).json()
        api("post", f"/api/v1/campaigns/{campaign['id']}/publish/")
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            sent = api("post", "/api/v1/receipts/send/", {"campaign": campaign["id"], "to": "pat@example.com", "name": "Pat Lee", "receipt": RECEIPT, "store": {"name": "Lenox"}})
        execution_id = sent.json()["execution_id"]
        hook_url = f"/api/v1/webhooks/delivery/{CODE}/{provider['id']}/{webhook_token(DeliveryProvider.objects.get(pk=provider['id']))}/"

        def callback(event, uuid=None, extra=None):
            body = {"event": event, "timestamp": 1774737615.0, "payload": {"message": {"id": 501, "message_id": "rcpt-1@postal.example", "to": "pat@example.com"}, **(extra or {})}}
            if uuid:
                body["uuid"] = uuid
            return c.post(hook_url, content_type="application/json", data=json.dumps(body))

        def opens():
            return sql("SELECT count(*) FROM tracking_event WHERE tenant_id = %s AND mailer_execution_id = %s AND event_type = 'OPEN'", [TENANT, execution_id], True)[0][0]

        first = callback("MessageLoaded", uuid="evt-0001", extra={"user_agent": "Mail/1.0", "ip_address": "10.0.0.9"})
        check("an open arrives with Postal's own event id and is applied: one tracking row, the message OPENED", first.status_code == 200 and first.json()["applied"] == 1 and first.json()["duplicate"] == 0 and opens() == 1
              and sql("SELECT status FROM mailer_execution WHERE tenant_id = %s AND id = %s", [TENANT, execution_id], True)[0][0] == "OPENED", f"{first.content[:120]} opens={opens()}")

        again = callback("MessageLoaded", uuid="evt-0001", extra={"user_agent": "Mail/1.0", "ip_address": "10.0.0.9"})
        check("the same callback delivered again (a Postal retry) is counted as a duplicate, not applied: still one tracking row",
              again.status_code == 200 and again.json() == {"received": 1, "applied": 0, "ignored": 0, "unmatched": 0, "failed": 0, "duplicate": 1} and opens() == 1, f"{again.content[:120]} opens={opens()}")
        rows = sql("SELECT processing_status, provider_event_id, processed_at IS NOT NULL FROM delivery_webhook_event WHERE tenant_id = %s AND provider_event_id = 'evt-0001' ORDER BY id", [TENANT], True)
        check("both arrivals are kept: the first PROCESSED, the second DUPLICATE with the same event id and a processed time", rows == [("PROCESSED", "evt-0001", True), ("DUPLICATE", "evt-0001", True)], str(rows))

        second = callback("MessageLoaded", uuid="evt-0002")
        check("a second open with its own event id is a real second open: two tracking rows", second.json()["applied"] == 1 and opens() == 2, f"{second.content[:100]} opens={opens()}")

        plain_a = callback("MessageLinkClicked", extra={"url": "https://shop.example/a"})
        plain_b = callback("MessageLinkClicked", extra={"url": "https://shop.example/a"})
        clicks = sql("SELECT count(*) FROM tracking_event WHERE tenant_id = %s AND mailer_execution_id = %s AND event_type = 'CLICK'", [TENANT, execution_id], True)[0][0]
        no_id = sql("SELECT count(*) FROM delivery_webhook_event WHERE tenant_id = %s AND event_type = 'CLICKED' AND provider_event_id IS NULL", [TENANT], True)[0][0]
        check("a callback without an event id keeps today's behaviour: applied each time, stored without an id", plain_a.json()["applied"] == 1 and plain_b.json()["applied"] == 1 and clicks == 2 and no_id == 2,
              f"clicks={clicks} rows without id={no_id}")

        logged = sql("SELECT response_body FROM integration_log WHERE tenant_id = %s AND direction = 'IN' AND system = 'POSTAL' ORDER BY id", [TENANT], True)
        check("the integration log's callback rows report the duplicate count", any('"duplicate": 1' in (row[0] or "") for row in logged) and all('"duplicate"' in (row[0] or "") for row in logged), str(logged)[:200])
        transaction.set_rollback(True)
    check.done()
