"""The Postal tag map: sent on every message, read back on callbacks, matched first, and the log row named after the send.

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
from apps.delivery.providers import EmailMessage
from apps.delivery.providers.postal import PostalProvider, read_tag, tag_for
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_postal_tag(check):
    """The Postal tag map: sent on every message, read back on callbacks, matched first, and the log row named after the send."""
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

    # ---------------------------------------------------------------------------------------------------- the map itself
    message = EmailMessage(to_email="a@x.test", from_email="r@nw.test", subject="s", html="h", tag="FALL26",
                           metadata={"cep_tenant": "NWA", "cep_run": "11111111-2222-4333-8444-555555555555", "cep_execution": "42", "cep_party": "P-7",
                                     "cep_campaign": "FALL26", "cep_purpose": "receipt", "cep_receipt": "R-104-88213", "cep_store": "Lenox"})
    tag = tag_for(message)
    check("the tag is compact JSON with our execution id first, then campaign, purpose, party, receipt, store, run, workspace",
          json.loads(tag) == {"x": "42", "c": "FALL26", "u": "receipt", "p": "P-7", "n": "R-104-88213", "s": "Lenox", "r": "11111111-2222-4333-8444-555555555555", "t": "NWA"}
          and tag.startswith('{"x":"42"'), tag)
    check("... within Postal's limit", len(tag) <= 250, str(len(tag)))
    long = EmailMessage(to_email="a", from_email="b", subject="s", html="h", tag="C", metadata={**message.metadata, "cep_store": "S" * 200})
    trimmed = json.loads(tag_for(long))
    check("a map that does not fit loses its least useful keys from the end and keeps the execution id", "x" in trimmed and "c" in trimmed and "t" not in trimmed and "r" not in trimmed
          and len(tag_for(long)) <= 250, str(list(trimmed)))
    check("a message with no metadata keeps its plain campaign code; a plain tag reads back as nothing", tag_for(EmailMessage(to_email="a", from_email="b", subject="s", html="h", tag="FALL26")) == "FALL26"
          and read_tag("FALL26") == {} and read_tag(None) == {} and read_tag("{not json") == {} and read_tag(tag)["x"] == "42")

    adapter = PostalProvider(config={"endpoint": "https://postal.test"}, secret="k")
    bounced = adapter.parse_webhook({"event": "MessageBounced", "payload": {"original_message": {"message_id": "m1", "to": "a@x.test", "tag": tag}, "bounce": {}}})[0]
    sent = adapter.parse_webhook({"event": "MessageSent", "payload": {"message": {"message_id": "m2", "to": "a@x.test", "tag": "FALL26"}}})[0]
    check("a callback carries the map back: the execution id and the whole tag, from message.tag or original_message.tag on a bounce",
          bounced.execution_id == 42 and bounced.tag["n"] == "R-104-88213" and sent.execution_id is None and sent.tag == {}, str(bounced.tag))

    # ---------------------------------------------------------------------------------------------------- end to end on a receipt
    OK = {"status": "success", "data": {"message_id": "rcpt-1@postal.example"}}
    RECEIPT = {"number": "R-104-88213", "transaction_at": "2026-09-18T16:12:00", "currency": "USD", "subtotal": 84, "tax_total": 5.38, "grand_total": 89.38, "tender_summary": "Visa 4242",
               "items": [{"description": "Wool socks", "quantity": 2, "unit_price": 10}]}
    with transaction.atomic(), mock.patch.object(logbook, "P", "default"):
        provider = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZZ Postal tags", "secret": "k", "config": {"endpoint": "https://postal.zz.example"}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": provider["id"], "display_name": "ZZ Receipts", "from_address": "receipts@zz.example"}).json()
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "me@zz.example"})
        template = api("post", "/api/v1/templates/", {"name": "ZZ tag receipt", "channel": "E_RECEIPT", "starter": "store_receipt"}).json()
        sql("DELETE FROM rendered_template_content WHERE template_id = %s", [template["id"]])
        sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 9, %s, %s, %s)",
            [template["id"], "Receipt {{receipt_number}}", "<p>{{receipt_body}}</p>", "{{receipt_body}}"])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])
        campaign = api("post", "/api/v1/campaigns/", {"name": "ZZ tag receipts", "campaign_type": "E_RECEIPT", "channel": "EMAIL", "solicitation_type": "TRANSACTIONAL",
                                                      "template": template["id"], "sender_profile": sender["id"]}).json()
        api("post", f"/api/v1/campaigns/{campaign['id']}/publish/")
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)) as post:
            sent_r = api("post", "/api/v1/receipts/send/", {"campaign": campaign["id"], "to": "pat@example.com", "name": "Pat Lee", "party_id": "P-7", "receipt": RECEIPT, "store": {"code": "0123", "name": "Lenox"}})
            payload = post.call_args.kwargs["json"]
        execution_id = sent_r.json()["execution_id"]
        carried = json.loads(payload["tag"])
        check("a receipt send carries the map: its execution id, the campaign code, purpose receipt, the party, the receipt number and the store code",
              sent_r.status_code == 201 and carried == {"x": str(execution_id), "c": campaign["code"], "u": "receipt", "p": "P-7", "n": "R-104-88213", "s": "0123",
                                                        "r": carried.get("r"), "t": CODE} and carried["r"], str(carried))

        # the callback names a message id we never stored (Postal's per-recipient id): the tag's execution id still finds the row
        hook = c.post(f"/api/v1/webhooks/delivery/{CODE}/{provider['id']}/{webhook_token(DeliveryProvider.objects.get(pk=provider['id']))}/", content_type="application/json",
                      data=json.dumps({"event": "MessageSent", "payload": {"message": {"id": 9, "message_id": "some-other-id@postal", "to": "pat@example.com", "tag": payload["tag"]}, "status": "Sent"}}))
        status = sql("SELECT status FROM mailer_execution WHERE tenant_id = %s AND id = %s", [TENANT, execution_id], True)[0][0]
        check("a callback is matched on the echoed execution id before any provider id: the receipt is DELIVERED", hook.status_code == 200 and hook.json()["applied"] == 1 and status == "DELIVERED",
              f"{hook.status_code} {hook.content[:100]} {status}")
        row = sql("SELECT related_ref, direction FROM integration_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 1", [TENANT], True)[0]
        check("the log row of the callback carries the send's own reference, so one search finds both", row == ("receipt:R-104-88213", "IN"), str(row))
        plain = c.post(f"/api/v1/webhooks/delivery/{CODE}/{provider['id']}/{webhook_token(DeliveryProvider.objects.get(pk=provider['id']))}/", content_type="application/json",
                       data=json.dumps({"event": "MessageLoaded", "payload": {"message": {"message_id": "rcpt-1@postal.example", "to": "pat@example.com", "tag": "FALL26"}}}))
        row = sql("SELECT related_ref FROM integration_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 1", [TENANT], True)[0][0]
        check("a callback with a plain tag still matches on the message id and is logged under the engine", plain.json()["applied"] == 1 and row == f"provider:{provider['id']}", row)
        transaction.set_rollback(True)
    check.done()
