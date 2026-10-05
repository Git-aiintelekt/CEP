"""Barcode and QR code blocks on an e-receipt: the receipt's own coupon fields fill the coupon tags, a RECEIPT tag works as a source,
and a receipt that went without a block says so in the answer. Local DB, rolled back; Postal mocked at the HTTP layer.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from unittest import mock
import requests
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery.engine import receipts
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.platform_ops import params
from apps.templates import codes
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_codes_receipt(check):
    """Barcode and QR code blocks on an e-receipt: the receipt's own coupon fields fill the coupon tags, a RECEIPT tag works as a source,"""
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

    def sql(statement, args=None):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])

    def postal_answer(body):
        r = requests.Response()
        r.status_code, r._content = 200, json.dumps(body).encode()
        r.headers["Content-Type"] = "application/json"
        return r

    def region(config):
        return f"<!-- CEP:CODE {json.dumps(config)} --><table><tr><td>sample</td></tr></table><!-- CEP:CODE_END -->"

    check("coupon_values takes the receipt's three coupon fields, and nothing else", receipts.coupon_values(
        {"number": "R-1", "coupon_code": " SAVE20 ", "coupon_barcode_value": "CPN9", "coupon_qr_value": "", "discount_code": "X"}) == {"coupon_code": "SAVE20", "coupon_barcode_value": "CPN9"})

    OK = {"status": "success", "data": {"message_id": "rcpt-code@postal.example"}}
    RECEIPT = {"number": "R-104-88213", "order_number": "NW-2026-104882", "transaction_at": "2026-09-18T16:12:00", "currency": "USD", "subtotal": 10, "grand_total": 10,
               "items": [{"description": "Socks", "quantity": 1, "unit_price": 10}], "coupon_barcode_value": "CPN400012345678"}
    BAR = {"kind": "barcode", "source": "coupon_barcode_value", "format": "code128", "width": 300, "height": 80, "text": True, "align": "center"}
    QR = {"kind": "qr", "source": "coupon_qr_value", "ecc": "M", "size": 180, "text": False, "align": "center"}
    NUMBER = {"kind": "barcode", "source": "receipt_number", "format": "code128", "width": 300, "height": 80, "text": True, "align": "center"}
    outer = f"<html><body><p>Hi {{{{first_name}}}}</p>{region(BAR)}{region(QR)}{region(NUMBER)}<p>{{{{receipt_body}}}}</p></body></html>"

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(params, "enabled", return_value=True):
        provider = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZZ Postal codes", "secret": "k", "config": {"endpoint": "https://postal.zz.example"}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": provider["id"], "display_name": "ZZ Receipts", "from_address": "receipts@zz.example"}).json()
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "me@zz.example"})
        template = api("post", "/api/v1/templates/", {"name": "ZZ coded receipt", "channel": "E_RECEIPT", "starter": "store_receipt"}).json()
        sql("DELETE FROM rendered_template_content WHERE template_id = %s", [template["id"]])
        sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 9, %s, %s, %s)",
            [template["id"], "Your receipt {{receipt_number}}", outer, "Receipt {{receipt_number}}"])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])
        campaign = api("post", "/api/v1/campaigns/", {"name": "ZZ coded receipts", "campaign_type": "E_RECEIPT", "channel": "EMAIL", "solicitation_type": "TRANSACTIONAL",
                                                      "template": template["id"], "sender_profile": sender["id"]}).json()
        api("post", f"/api/v1/campaigns/{campaign['id']}/publish/")
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)) as post:
            sent = api("post", "/api/v1/receipts/send/", {"campaign": campaign["id"], "to": "pat@example.com", "name": "Pat Lee", "receipt": RECEIPT})
            body = post.call_args.kwargs["json"].get("html_body", "")
        addresses = [part.split('"')[0] for part in body.split('src="')[1:] if "/public/code/" in part.split('"')[0]]
        values = sorted(codes.load(address.rsplit("/", 1)[1][:-4])["value"] for address in addresses)
        check("the receipt is sent", sent.status_code == 201, f"{sent.status_code} {sent.content[:200]}")
        check("the coupon barcode comes from the receipt's own field, the receipt-number barcode from the RECEIPT tag", values == ["CPN400012345678", "R-104-88213"], values)
        check("no marker, no stand-in left in what the customer gets", "CEP:CODE" not in body and ">sample<" not in body)
        check("the answer names the block the customer did not get", sent.json().get("codes_left_out") == ["coupon_qr_value"], sent.json())
        transaction.set_rollback(True)
    check.done()
