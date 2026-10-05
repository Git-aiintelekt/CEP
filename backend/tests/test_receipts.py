"""E-receipts through the Postal HTTP API (mocked at the HTTP layer), against the real database; rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import base64
import json
import secrets
from unittest import mock
import requests
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery.models import DeliveryProvider, SenderProfile
from apps.identity.models import ApiClient, AppUser
from apps.platform_ops import crypto
from apps.templates import starters
from apps.tenants import context
from apps.integrations.bridge import logbook

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_receipts(check, admin_email):
    """E-receipts through the Postal HTTP API (mocked at the HTTP layer), against the real database; rolled back."""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None, headers=None):
        h = headers or H
        if method in ("get", "delete"):
            return getattr(c, method)(path, **h)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **h)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    def postal_answer(body):
        r = requests.Response()
        r.status_code, r._content = 200, json.dumps(body).encode()
        return r

    OK = {"status": "success", "time": 0.02, "flags": {}, "data": {"message_id": "rcpt-1@postal.example", "messages": {"pat@example.com": {"id": 501, "token": "tkn"}}}}
    RECEIPT = {"number": "R-104-88213", "transaction_at": "2026-09-18T16:12:00", "currency": "USD", "subtotal": 84, "discount_total": -16.8, "tax_total": 5.38, "grand_total": 72.58,
               "tender_summary": "Visa ending 4242",
               "items": [{"description": "Merino crew <b>sweater</b>", "sku": "NW-1042", "quantity": 1, "unit_price": 64, "total": 64}, {"description": "Wool socks", "quantity": 2, "unit_price": 10}]}

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"):   # every inbound log row stays inside the rolled-back transaction
        # ------------------------------------------------------------------ the tenant's email engine: Postal over its HTTP API
        created = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZZ Postal transactional", "secret": "postal-server-key",
                                                              "config": {"endpoint": "https://postal.zz-shop.example"}})
        provider_id = created.json()["id"]
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": provider_id, "display_name": "ZZ Shop Receipts", "from_address": "receipts@zz-shop.example",
                                                           "reply_to_address": "help@zz-shop.example"}).json()
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "zz.me@example.com"})
        check("tenant settings: a Postal engine is added with its address and API key, and a sender with a reply-to is verified through it",
              created.status_code == 201 and created.json()["has_secret"] and crypto.decrypt(DeliveryProvider.objects.get(pk=provider_id).secret_enc) == "postal-server-key"
              and SenderProfile.objects.get(pk=sender["id"]).verification_status == "VERIFIED")

        # ------------------------------------------------------------------ an e-receipt campaign on the store-receipt starter
        template = api("post", "/api/v1/templates/", {"name": "ZZ store receipt", "channel": "E_RECEIPT", "starter": "store_receipt"}).json()
        starters.ensure_tags(TENANT) if hasattr(starters, "ensure_tags") else None
        has_content = sql("SELECT count(*) FROM rendered_template_content WHERE template_id = %s AND html_content <> ''", [template["id"]], True)[0][0]
        if not has_content:
            sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 1, %s, %s, %s)",
                [template["id"], "Your receipt from {{store_name}}", "<html><body><p>Receipt {{receipt_number}} · {{transaction_date}}</p>{{receipt_body}}<p>Total {{grand_total}} · {{payment_method}}</p></body></html>",
                 "Receipt {{receipt_number}}\n{{receipt_body}}\nTotal {{grand_total}}"])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])
        campaign = api("post", "/api/v1/campaigns/", {"name": "ZZ store receipts", "campaign_type": "E_RECEIPT", "channel": "EMAIL", "solicitation_type": "TRANSACTIONAL",
                                                      "template": template["id"], "sender_profile": sender["id"]})
        assert campaign.status_code == 201, campaign.content
        campaign = campaign.json()
        body = {"campaign": campaign["id"], "to": "Pat@Example.com", "name": "Pat Lee", "receipt": RECEIPT, "store": {"name": "ZZ Shop Lenox", "address": "3393 Peachtree Rd"}}
        early = api("post", "/api/v1/receipts/send/", body)
        published = api("post", f"/api/v1/campaigns/{campaign['id']}/publish/")
        check("an e-receipt campaign must be published first; publishing opens the day's receipt run instead of a one-time send",
              early.status_code == 409 and published.status_code == 201 and published.json()["run_type"] == "ERECEIPT_INSTANCE" and published.json()["status"] == "SENDING",
              f"{early.status_code} {published.status_code} {published.json().get('run_type')}")

        # ------------------------------------------------------------------ send: exactly what Postal receives
        pdf = base64.b64encode(b"%PDF-1.4 zz receipt").decode()
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)) as post:
            sent = api("post", "/api/v1/receipts/send/", {**body, "attachments": [{"name": "receipt-R-104-88213.pdf", "content_type": "application/pdf", "data": pdf}]})
            url, payload, key_header = post.call_args.args[0], post.call_args.kwargs["json"], None
        check("the receipt goes to Postal's HTTP API: /api/v1/send/message, one recipient, From and reply_to of the sender, the campaign code as tag, the PDF attached",
              sent.status_code == 201 and sent.json()["status"] == "SUBMITTED" and sent.json()["provider_message_id"] == "rcpt-1@postal.example" and sent.json()["duplicate"] is False
              and url == "https://postal.zz-shop.example/api/v1/send/message" and payload["to"] == ["pat@example.com"] and payload["from"] == "ZZ Shop Receipts <receipts@zz-shop.example>"
              and payload["reply_to"] == "help@zz-shop.example" and json.loads(payload["tag"])["c"] == campaign["code"] and json.loads(payload["tag"])["u"] == "receipt" and payload["attachments"] == [{"name": "receipt-R-104-88213.pdf", "content_type": "application/pdf", "data": pdf}]
              and "List-Unsubscribe" not in payload["headers"], str(sent.status_code) + " " + sent.content.decode()[:160])
        html, text = payload.get("html_body", ""), payload.get("plain_body", "")
        parts = {"number": "R-104-88213" in html, "total": "$72.58" in html, "tender": "Visa ending 4242" in html, "escaped item": "Merino crew &lt;b&gt;sweater&lt;/b&gt;" in html and "<b>sweater" not in html,
                 "sku": "SKU NW-1042" in html, "qty x price": "2 × $10.00" in html, "computed line total": "$20.00" in html, "no tags left": "{{" not in html,
                 "store in subject": "ZZ Shop Lenox" in payload["subject"], "items in text": "Wool socks" in text}
        check("content: receipt and store tags are filled, money is formatted, line items are rendered (and escaped), the text part has them too",
              all(parts.values()), str([k for k, v in parts.items() if not v]))

        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)) as post:
            again = api("post", "/api/v1/receipts/send/", body)
            calls_made = post.call_count
        row = sql("SELECT status, email_address, party_id, campaign_run_id::text FROM mailer_execution WHERE tenant_id = %s AND id = %s", [TENANT, sent.json()["execution_id"]], True)[0]
        check("a cash register that retries does not send twice: same receipt number -> the first result, nothing posted to Postal",
              again.status_code == 200 and again.json()["duplicate"] is True and again.json()["execution_id"] == sent.json()["execution_id"] and calls_made == 0
              and row[0] == "SUBMITTED" and row[1] == "pat@example.com" and row[3] == published.json()["id"])

        # ------------------------------------------------------------------ delivery callback from Postal lands on the receipt
        from api.v1.delivery_api import webhook_token
        hook = c.post(f"/api/v1/webhooks/delivery/{CODE}/{provider_id}/{webhook_token(DeliveryProvider.objects.get(pk=provider_id))}/", content_type="application/json",
                      data=json.dumps({"event": "MessageSent", "payload": {"message": {"id": 501, "token": "tkn", "message_id": "rcpt-1@postal.example", "to": "pat@example.com"}, "status": "Sent"}}))
        check("Postal's MessageSent callback marks the receipt delivered", hook.status_code == 200 and hook.json()["applied"] == 1
              and sql("SELECT status FROM mailer_execution WHERE tenant_id = %s AND id = %s", [TENANT, sent.json()["execution_id"]], True)[0][0] == "DELIVERED")

        # ------------------------------------------------------------------ failures are honest
        with mock.patch.object(requests.Session, "post", side_effect=requests.ConnectTimeout("timed out")) as post:
            down = api("post", "/api/v1/receipts/send/", {**body, "receipt": {**RECEIPT, "number": "R-104-88214"}})
            attempts = post.call_count
        failed = sql("SELECT status, status_reason FROM mailer_execution WHERE tenant_id = %s AND idempotency_key LIKE %s", [TENANT, "%R-104-88214"], True)
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            retried = api("post", "/api/v1/receipts/send/", {**body, "receipt": {**RECEIPT, "number": "R-104-88214"}})
        check("Postal unreachable: three quick attempts, then 424 'retryable' with the failed attempt on record; the caller's retry with the same number then goes through",
              down.status_code == 424 and down.json()["retryable"] is True and attempts == 3 and failed and failed[0][0] == "FAILED" and "ConnectTimeout" in failed[0][1]
              and retried.status_code == 201 and retried.json()["duplicate"] is False, f"{down.status_code} attempts={attempts}")
        with mock.patch.object(requests.Session, "post", return_value=postal_answer({"status": "parameter-error", "data": {"code": "UnauthenticatedFromAddress", "message": "not allowed"}})):
            refused = api("post", "/api/v1/receipts/send/", {**body, "receipt": {**RECEIPT, "number": "R-104-88215"}})
        sql("INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, blocked, block_reason, blocked_at) VALUES (%s, 'EMAIL', 'zz.bounced@example.com', TRUE, 'HARD_BOUNCE', now())", [TENANT])
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)) as post:
            blocked = api("post", "/api/v1/receipts/send/", {**body, "to": "zz.bounced@example.com", "receipt": {**RECEIPT, "number": "R-104-88216"}})
            nothing_sent = post.call_count == 0
        bad = api("post", "/api/v1/receipts/send/", {"campaign": campaign["id"], "to": "not-an-address", "receipt": {"items": [{"quantity": 1}]}})
        no_number = api("post", "/api/v1/receipts/send/", {"campaign": campaign["id"], "to": "pat@example.com", "receipt": {"grand_total": 5}})
        check("a permanent refusal by Postal is 422 with Postal's code; a blocked address is refused before anything is sent; bad input names its fields; a receipt needs a number",
              refused.status_code == 422 and "UnauthenticatedFromAddress" in refused.json()["detail"] and refused.json()["retryable"] is False and blocked.status_code == 422 and nothing_sent
              and "hard bounce" in blocked.json()["detail"] and bad.status_code == 400 and {"to", "receipt"} <= set(bad.json()["errors"]) and no_number.status_code == 400,
              f"{refused.status_code} {blocked.status_code} {bad.status_code} {no_number.status_code}")

        # ------------------------------------------------------------------ the point of sale uses an integration key
        raw = "cep_in_" + secrets.token_urlsafe(30)
        made = api("post", "/api/v1/api-clients/", {"name": "ZZ point of sale", "scopes": ["receipts:send"]})
        key = made.json().get("key", "")
        wrong_scope = api("post", "/api/v1/api-clients/", {"name": "ZZ events only", "scopes": ["events:ingest"]}).json().get("key", "")
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            by_key = api("post", "/api/v1/receipts/send/", {**body, "receipt": {**RECEIPT, "number": "R-104-88217"}}, headers={"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + key})
            other = api("post", "/api/v1/receipts/send/", {**body, "receipt": {**RECEIPT, "number": "R-104-88218"}}, headers={"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + wrong_scope})
        check("an integration key with the scope receipts:send may send receipts; a key without it may not", made.status_code == 201 and by_key.status_code == 201 and other.status_code in (401, 403),
              f"{made.status_code} {by_key.status_code} {other.status_code}")

        results_api = api("get", f"/api/v1/campaign-runs/{published.json()['id']}/results/").json()
        check("the day's receipt run reports what was sent, delivered and failed, and stays open", results_api["status"] == "SENDING" and results_api["messages"]["sent"] >= 3
              and results_api["messages"]["delivered"] == 1 and results_api["messages"]["failed"] >= 1, json.dumps(results_api["messages"]))
        transaction.set_rollback(True)

    tok = context.set_platform(True)
    left = (DeliveryProvider.objects.filter(name__startswith="ZZ ").count(), ApiClient.objects.filter(name__startswith="ZZ ").count())
    context.reset_platform(tok)
    check("rolled back", left == (0, 0), str(left))
    check.done()
