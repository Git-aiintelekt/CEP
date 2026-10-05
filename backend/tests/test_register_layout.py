"""The Store Register receipt layout: rendered from a parsed TTDR sale, and saved as a template's layout through the API. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import re
import uuid
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery.engine import receipt_layout
from apps.identity.models import AppUser
from apps.pos import mapping, ttdr
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_register_layout(check):
    """The Store Register receipt layout: rendered from a parsed TTDR sale, and saved as a template's layout through the API. Rolled back."""
    sample = open("apps/pos/schemas/sample-transaction.xml", "rb").read()
    read = ttdr.parse(sample)
    receipt = mapping.receipt_of(read)
    check("the receipt carries its tenders with their labels and authorisations", receipt["tenders"] and all({"label", "amount", "auth_code"} <= set(x) for x in receipt["tenders"]), str(receipt["tenders"])[:160])
    t = receipt_layout.transaction_from(receipt, {"number": "450", "name": "Store 450"}, "USD")
    r = t["register"]
    check("register details: the transaction number, register, store, a 07/02/2026 17:31 stamp, cashier, items sold, taxes and tenders",
          r["trans_number"] == receipt["number"] and r["store_number"] and re.match(r"\d\d/\d\d/\d{4} \d\d:\d\d$", r["trans_at"]) and r["item_count"] and isinstance(r["taxes"], list) and r["tenders"],
          str(r)[:220])
    html = receipt_layout.render([], t, None, "REGISTER")
    check("YOUR RECEIPT with the two rows of three", all(word in html for word in ("YOUR RECEIPT", "Trans Num:", "Register:", "Store:", "Trans Dt:", "Cashier:", "Item(s) Sold:")))
    check("Description / Amount, every line with its quantity at price", "Description" in html and "Amount" in html and html.count(" @ ") == len(t["line_items"]), str(html.count(" @ ")))
    check("Subtotal, each tax with its rate when known, TOTAL, every tender, the change only with cash",
          "Subtotal:" in html and "TOTAL:" in html and html.count("Paid with ") == len(r["tenders"]) and ("Cash Change:" in html) == (any(x["label"].startswith("CASH") for x in r["tenders"]) or bool(r["change_due"])),
          str([x["label"] for x in r["tenders"]]))
    discounted = dict(t, line_items=[dict(t["line_items"][0], discount=10.0)])
    check("a line's discount prints in green under its description", "Discount: ($10.00)" in receipt_layout.render([], discounted, None, "REGISTER") and receipt_layout.REGISTER["discount"] in receipt_layout.render([], discounted, None, "REGISTER"))
    check("the sections layouts are untouched by the new preset", receipt_layout.render([], t, None, "STANDARD") != html and "YOUR RECEIPT" not in receipt_layout.render([{"key": "items", "columns": {"amount": True}}], t, None, None))

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email="aby.john@aiintelekt.com")
    context.reset_platform(ptok)
    context.set_current(str(tenant.id), "default", str(user.pk))
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
            made = API.post("/api/v1/templates/", {"name": f"Register receipt {uuid.uuid4().hex[:6]}", "channel": "E_RECEIPT", "template_type": "EMAIL"}, content_type="application/json")
            if made.status_code != 201:
                made = API.post("/api/v1/templates/", {"name": f"Register receipt {uuid.uuid4().hex[:6]}", "channel": "E_RECEIPT"}, content_type="application/json")
            check("setup: an e-receipt template", made.status_code == 201, f"{made.status_code} {str(made.content)[:120]}")
            if made.status_code == 201:
                pk = made.json()["id"]
                saved = API.post(f"/api/v1/templates/{pk}/receipt/", {"layout_preset": "REGISTER", "sections": [], "custom_html": None, "custom_css": None, "base_version": 0}, content_type="application/json")
                check("the layout saves with the REGISTER preset", saved.status_code == 201 and saved.json()["layout_preset"] == "REGISTER", f"{saved.status_code} {str(saved.content)[:120]}")
                back = API.get(f"/api/v1/templates/{pk}/receipt/").json()
                check("and reads back", back["layout_preset"] == "REGISTER")
            raise RuntimeError("roll back")
    except RuntimeError as exc:
        if str(exc) != "roll back":
            raise
    check.done()
