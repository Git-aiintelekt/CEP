"""The receipt layout at send time and the Code 128 barcode: against the real local DB, rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import io
import json
from unittest import mock
import requests
from django.core.cache import cache
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery.engine import barcode, receipt_layout
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.tenants import context
from PIL import Image
from apps.templates.design import default_receipt_sections

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_receipt_barcode(check):
    """The receipt layout at send time and the Code 128 barcode: against the real local DB, rolled back."""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email="aby.john@aiintelekt.com")
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}
    cache.delete("cep:barcode:R-104-88213")

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

    OK = {"status": "success", "data": {"message_id": "rcpt-9@postal.example"}}
    RECEIPT = {"number": "R-104-88213", "order_number": "NW-2026-104882", "transaction_at": "2026-09-18T16:12:00", "currency": "USD", "subtotal": 84, "discount_total": -16.8,
               "discount_code": "FALL20", "tax_total": 5.38, "grand_total": 72.58, "tender_summary": "Visa ending 4242", "billing_address": "18 Oak Lane, Decatur",
               "loyalty": {"points_earned": 73, "points_balance": 1240, "tier_progress": "Gold in 2 more visits"},
               "items": [{"description": "Merino crew <b>sweater</b>", "sku": "NW-1042", "quantity": 1, "unit_price": 64, "total": 64}, {"description": "Wool socks", "quantity": 2, "unit_price": 10}]}
    STORE = {"name": "ZZ Shop Lenox", "address": "3393 Peachtree Rd"}
    SLOT = "<!-- CEP:RECEIPT_SLOT_START -->\n<table><tr><td>Receipt content injects here</td></tr></table>\n<!-- CEP:RECEIPT_SLOT_END -->"

    # ---------------------------------------------------------------------------------------------------- the barcode image itself
    image = Image.open(io.BytesIO(barcode.png("R-104-88213")))
    pixels = set(image.convert("L").getdata())
    check("the barcode is a 480x128 PNG with black bars on white", image.size == (480, 128) and image.format == "PNG" and 0 in pixels and 255 in pixels, f"{image.size} {image.format}")
    check("what a receipt number looks like is accepted; anything else is not", barcode.valid("R-104-88213") and barcode.valid("NW 2026/1") is False and not barcode.valid("a" * 49) and not barcode.valid("<script>"))
    with mock.patch("apps.platform_ops.params.public_api_url", return_value="https://cep.example"):
        check("the image address is built from the public address, with the number escaped", barcode.url("R-104 #1") == "https://cep.example/api/v1/public/barcode/R-104%20%231.png", barcode.url("R-104 #1"))

    r = c.get("/api/v1/public/barcode/R-104-88213.png")
    check("GET /public/barcode/<number>.png answers the image with no sign-in and no tenant, cached for a year",
          r.status_code == 200 and r["Content-Type"] == "image/png" and r.content[:8] == b"\x89PNG\r\n\x1a\n" and "immutable" in r["Cache-Control"], f"{r.status_code} {r.get('Content-Type')}")
    check("... and 404 for a text that is not a receipt number", c.get("/api/v1/public/barcode/%3Cscript%3E.png").status_code == 404)

    # ---------------------------------------------------------------------------------------------------- the layout renderer
    t = receipt_layout.transaction_from(RECEIPT, STORE, "USD")
    check("the POS payload becomes the shape the sections read: money, dates, items, discount, loyalty", t["receipt_id"] == "R-104-88213" and t["order_number"] == "NW-2026-104882"
          and t["order_date"] == "Sep 18, 2026" and t["store"] == "ZZ Shop Lenox" and t["source"] == "POS" and t["subtotal"] == 84 and t["discount"] == {"code": "FALL20", "amount": 16.8}
          and t["total"] == 72.58 and [i["amount"] for i in t["line_items"]] == [64, 20] and t["loyalty"]["points_balance"] == 1240 and t["payment"]["authorized_at"] == "Sep 18, 2026, 4:12 PM", str(t)[:300])
    sections = default_receipt_sections()
    for s in sections:
        if s["key"] == "support":
            s["barcode"] = True
    html = receipt_layout.render(sections, t, "https://cep.example/api/v1/public/barcode/R-104-88213.png")
    order = [m for m in __import__("re").findall(r'data-section="([a-z_]+)"', html)]
    check("every section renders in order, with the dashed rule on Totals only", order == ["header", "customer_fulfillment", "items", "totals", "payment", "loyalty", "support"]
          and html.count("1px dashed #9ea2ad") == 2 and 'data-section="totals" style="padding:16px;border-top:1px dashed' in html, str(order))
    parts = {"escaped item": "Merino crew &lt;b&gt;sweater&lt;/b&gt;" in html and "<b>sweater" not in html, "total": "$72.58" in html, "discount minus": "−$16.80" in html,
             "savings": "You saved" in html and "$16.80" in html, "store": "ZZ Shop Lenox" in html, "loyalty": "1,240" in html, "qty": ">2<" in html, "unit": "$10.00" in html,
             "barcode img": '<img src="https://cep.example/api/v1/public/barcode/R-104-88213.png" alt="Barcode R-104-88213" width="240" height="64"' in html,
             "phone rule": "cep-hide-mobile" in html, "no tags": "{{" not in html}
    check("content: escaping, money with the minus sign, the savings callout, loyalty, the barcode image", all(parts.values()), str([k for k, v in parts.items() if not v]))
    no_points = receipt_layout.render(sections, receipt_layout.transaction_from({**RECEIPT, "loyalty": None}, STORE, "USD"), None)
    check("a customer without loyalty gets no Loyalty section; no barcode address means no image", 'data-section="loyalty"' not in no_points and "<img" not in no_points)
    euro = receipt_layout.render(sections, receipt_layout.transaction_from({**RECEIPT, "currency": "EUR"}, STORE, "EUR"), None)
    check("the receipt's currency is honoured", "€72.58" in euro)

    outer = f"<html><body><p>Hi {{{{first_name}}}}</p>{SLOT}<p>Total {{{{grand_total}}}}</p></body></html>"
    filled = receipt_layout.inject(outer, "<b>RECEIPT</b>")
    check("the receipt goes between the slot markers, the markers stay, nothing else moves", "Receipt content injects here" not in filled and "<b>RECEIPT</b>" in filled
          and filled.count("CEP:RECEIPT_SLOT_START") == 1 and filled.startswith("<html><body><p>Hi {{first_name}}</p>") and filled.endswith("<p>Total {{grand_total}}</p></body></html>"))
    check("a design without a slot comes back untouched", receipt_layout.inject("<p>{{receipt_body}}</p>", "x") == "<p>{{receipt_body}}</p>")

    # ---------------------------------------------------------------------------------------------------- end to end: what Postal receives
    with transaction.atomic(), mock.patch.object(logbook, "P", "default"):   # every inbound log row stays inside the rolled-back transaction
        provider = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZZ Postal receipts", "secret": "k", "config": {"endpoint": "https://postal.zz.example"}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": provider["id"], "display_name": "ZZ Receipts", "from_address": "receipts@zz.example"}).json()
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "me@zz.example"})
        template = api("post", "/api/v1/templates/", {"name": "ZZ slot receipt", "channel": "E_RECEIPT", "starter": "store_receipt"}).json()
        sql("DELETE FROM rendered_template_content WHERE template_id = %s", [template["id"]])
        sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 9, %s, %s, %s)",
            [template["id"], "Your receipt {{receipt_number}}", outer, "Receipt {{receipt_number}}\n{{receipt_body}}"])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])
        layout = api("get", f"/api/v1/templates/{template['id']}/receipt/").json()
        saved_sections = [({**s, "barcode": True} if s["key"] == "support" else s) for s in layout["sections"]]
        saved = api("post", f"/api/v1/templates/{template['id']}/receipt/", {"layout_preset": "STANDARD", "sections": saved_sections, "custom_html": None, "custom_css": None, "base_version": layout["version_number"]})
        check("the receipt layout is saved with the barcode switched on", saved.status_code == 201, f"{saved.status_code} {saved.content[:160]}")
        campaign = api("post", "/api/v1/campaigns/", {"name": "ZZ slot receipts", "campaign_type": "E_RECEIPT", "channel": "EMAIL", "solicitation_type": "TRANSACTIONAL",
                                                      "template": template["id"], "sender_profile": sender["id"]}).json()
        api("post", f"/api/v1/campaigns/{campaign['id']}/publish/")
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)) as post, \
                mock.patch("apps.platform_ops.params.public_api_url", return_value="https://cep.example"):
            sent = api("post", "/api/v1/receipts/send/", {"campaign": campaign["id"], "to": "pat@example.com", "name": "Pat Lee", "receipt": RECEIPT, "store": STORE})
            payload = post.call_args.kwargs["json"]
        body = payload.get("html_body", "")
        parts = {"sent": sent.status_code == 201, "slot filled": "Receipt content injects here" not in body, "sections": 'data-section="items"' in body and 'data-section="support"' in body,
                 "barcode": '<img src="https://cep.example/api/v1/public/barcode/R-104-88213.png" alt="Barcode R-104-88213"' in body,
                 "outer tags filled": "Hi Pat" in body and "Total $72.58" in body and "{{" not in body, "items": "Wool socks" in body and "$20.00" in body,
                 "text part": "Wool socks" in payload.get("plain_body", "")}
        check("the sent receipt is the layout in the outer design's slot, with the barcode image and every tag filled", all(parts.values()), str([k for k, v in parts.items() if not v]) + " " + str(sent.status_code))
        transaction.set_rollback(True)
    check.done()
