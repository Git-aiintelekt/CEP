"""Receipt Layouts: the Store Register settings, the Custom HTML Item Row, and the library layouts E-Receipt templates pick.

The golden files in fixtures/receipt_layouts were written by the renderer before Receipt Layouts existed: a layout saved
then must print exactly the same. Never regenerate them to make a test pass. Every change is rolled back (tests/conftest.py)."""
import uuid

import pytest
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.delivery.engine import receipt_layout as rl
from apps.identity.models import AppUser
from apps.pos import mapping, ttdr
from apps.templates import design
from apps.templates.models import TemplateMaster
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

GOLDEN = "tests/fixtures/receipt_layouts/"
SLOT = "<html><head></head><body><!-- CEP:RECEIPT_SLOT_START --><!-- CEP:RECEIPT_SLOT_END --></body></html>"


def _golden(name: str) -> str:
    return open(GOLDEN + name, encoding="utf-8", newline="").read()


def _sale() -> tuple[dict, dict]:
    receipt = mapping.receipt_of(ttdr.parse(open("apps/pos/schemas/sample-transaction.xml", "rb").read()))
    return receipt, rl.transaction_from(receipt, {"number": "450", "name": "Store 450"}, "USD")


def _settings(**changes) -> dict:
    settings, errors = rl.clean_register_settings({**rl.default_register_settings(), **changes})
    assert errors == {}, errors
    return settings


def test_existing_receipts_print_as_before(check):
    _, t = _sale()
    check("Store Register without settings is byte for byte what it was", rl.render([], t, None, "REGISTER") == _golden("register_sale.html"))
    check("the default settings print the same", rl.render([], t, None, "REGISTER", rl.default_register_settings()) == _golden("register_sale.html"))
    check("the Standard sections are untouched", rl.render(design.default_receipt_sections(), t, None, "STANDARD") == _golden("standard_sale.html"))
    check("no settings stay no settings", rl.clean_register_settings(None) == (None, {}))
    check.done()


def test_store_register_settings(check):
    _, t = _sale()
    columns = [{"key": "description", "label": "Item"}, {"key": "size", "label": "Size"}, {"key": "color", "label": "Colour"},
               {"key": "quantity", "label": "Qty"}, {"key": "amount", "label": "Price"}]
    fields = [dict(f, label="Date") if f["key"] == "trans_at" else dict(f, visible=f["key"] != "register") for f in rl.default_register_settings()["fields"]]
    html = rl.render([], t, None, "REGISTER", _settings(title="Thank <you>", columns=columns, fields=fields,
                                                         footer_text="Returns within 30 days.\nCall {{store_phone}} & ask.",
                                                         under_item={"discount": True, "quantity_at_price": False, "sku": True, "upc": False}))
    check("the headers carry their new labels", all(f">{label}</td>" in html for label in ("Item", "Size", "Colour", "Qty", "Price")), html[:200])
    check("the title is escaped", "Thank &lt;you&gt;" in html)
    check("a renamed header field, a hidden one gone", "Date:</span>" in html and "Register:</span>" not in html and "Trans Dt" not in html)
    check("every line has its size and colour cells", html.count(f'class="{rl.WIDE_CLASS}"') == 3 * len(t["line_items"]) + 3)
    check("quantity at price is off, the SKU line is on", " @ " not in html and html.count("<span>SKU ") == len(t["line_items"]))
    check("the lines' sum spans every column", 'colspan="5"' in html)
    check("the footer keeps its tag for the renderer, escapes the rest, keeps the line break",
          "Call {{store_phone}} &amp; ask." in html and "30 days.<br />Call" in html and 'data-section="register-footer"' in html)
    check("phones fold the middle columns under the item", rl.FOLD_RULE in html and html.count(f'class="{rl.NARROW_CLASS}"') == len(t["line_items"]))
    first = t["line_items"][0]
    check("the folded line names each value", f"Size {first['size']} · Colour {first['color']} · Qty 1" in html)

    kept = rl.render([], t, None, "REGISTER", _settings(columns=columns, phone="KEEP"))
    check("Keep Every Column writes no phone rule", rl.FOLD_RULE not in kept and rl.NARROW_CLASS not in kept and rl.WIDE_CLASS not in kept)
    two = rl.render([], t, None, "REGISTER", _settings(columns=[{"key": "description", "label": "Item"}, {"key": "amount", "label": "Price"}]))
    check("two columns need no phone rule", rl.FOLD_RULE not in two and ">Item</td>" in two)

    bad = lambda **changes: rl.clean_register_settings({**rl.default_register_settings(), **changes})[1]   # noqa: E731
    check("six columns are refused", "register" in bad(columns=columns[:4] + [{"key": "sku"}, {"key": "upc"}, columns[4]]))
    check("Description first and Amount last", "register" in bad(columns=[columns[4], columns[0]]))
    check("a column twice is refused", "register" in bad(columns=[columns[0], columns[1], columns[1], columns[4]]))
    check("an unknown column is refused", "register" in bad(columns=[columns[0], {"key": "price_tag"}, columns[4]]))
    check("the header lists the six fields", "register" in bad(fields=rl.default_register_settings()["fields"][:5]))
    check("a footer over 500 characters is refused", "register" in bad(footer_text="x" * 501))
    check("an empty label falls back to the column's name", _settings(columns=[{"key": "description", "label": ""}, columns[4]])["columns"][0]["label"] == "Description")
    check.done()


def test_store_register_colours_text_and_totals(check):
    _, t = _sale()
    style = {"theme": "INK", "colors": None, "font": "COURIER", "size": "L", "title_size": "S", "title_align": "LEFT", "bold_labels": False, "upper_headers": True}
    totals = {"rows": [{"key": "points_balance", "label": "Balance"}, *rl.default_register_totals()["rows"], {"key": "items", "label": ""}],
              "layout": "SPREAD", "tax_rate": False, "tender_auth": False, "total_large": True}
    settings = _settings(style=style, totals=totals)
    check("the rows are kept in their printed order, an empty label takes the row's name",
          [row["key"] for row in settings["totals"]["rows"]] == ["subtotal", "taxes", "total", "tenders", "change", "items", "points_balance"]
          and settings["totals"]["rows"][5]["label"] == "Items Sold", settings["totals"]["rows"])
    html = rl.render([], t, None, "REGISTER", settings)
    check("Ink: the dark band, headers on it in white and in capitals", "background-color:#1f1f1f" in html and "color:#ffffff;font-weight:700;text-transform:uppercase" in html)
    check("Courier at the large size, a small left title, plain header labels",
          "font-family:'Courier New', Courier, monospace" in html and "font-size:14px;line-height:20px;" in html
          and "font-size:13px;line-height:18px;font-weight:700;letter-spacing:0.02em;text-align:left;" in html and '<span style="font-weight:400;">' in html)
    check("label left, no colons, no rate, no authorisation; Items Sold printed", ">Subtotal</td>" in html and "Subtotal:" not in html and "%)" not in html
          and "Auth:" not in html and ">Items Sold</td>" in html, html[-1500:])
    with_points = dict(t, loyalty={"points_earned": 44, "points_balance": 2424, "tier_progress": ""})
    check("a member's balance with a thousands comma; without loyalty the row drops out",
          ">2,424</td>" in rl.render([], with_points, None, "REGISTER", settings) and "Balance" not in html)
    own = rl.render([], t, None, "REGISTER", _settings(style={**style, "colors": {"frame": "#FAFAFA", "cards": "#222222", "columns": "#333333", "text": "#111111", "accent": "#00aa00"}}))
    check("own colours, text on the dark cards turns white", "background-color:#fafafa" in own and "color:#ffffff;" in own)

    bad = lambda **changes: rl.clean_register_settings({**rl.default_register_settings(), **changes})[1]   # noqa: E731
    check("an unknown theme is refused", "register" in bad(style={**style, "theme": "NEON"}))
    check("a colour that is not a hex code is refused", "register" in bad(style={**style, "colors": {"frame": "red", "cards": "#fff", "columns": "#000000", "text": "#000000", "accent": "#000000"}}))
    check("a register row cannot be left out", "register" in bad(totals={**totals, "rows": [row for row in totals["rows"] if row["key"] != "subtotal"]}))
    check("an unknown row is refused", "register" in bad(totals={**totals, "rows": [*totals["rows"], {"key": "lottery"}]}))
    check("TOTAL cannot be hidden", next(r for r in _settings(totals={**totals, "rows": [dict(r, visible=False) for r in totals["rows"]]})["totals"]["rows"] if r["key"] == "total")["visible"])
    check.done()


def test_custom_html_item_row(check):
    _, t = _sale()
    row = "<tr><td>{{item.description}}</td><td>{{ item.size }}</td><td>{{item.amount}}</td><td>{{item.nope}}</td></tr>"
    rows = rl.item_rows(row, t)
    check("one row per line", rows.count("<tr>") == len(t["line_items"]))
    check("values filled and money formatted", t["line_items"][0]["description"] in rows and "$14.99" in rows and "{{" not in rows, rows[:200])
    evil = dict(t, line_items=[dict(t["line_items"][0], description="<b>x</b>")])
    check("values are escaped", "&lt;b&gt;x&lt;/b&gt;" in rl.item_rows(row, evil))
    errors = lambda html, item_row: design.receipt_content_errors("CUSTOM_HTML", [], html, "", item_row)[0]   # noqa: E731
    check("an Item Row needs {{receipt_items}} once", "custom_html" in errors("<table></table>", row) and "custom_html" in errors("{{receipt_items}}{{receipt_items}}", row))
    check("item tags outside the Item Row are refused", "custom_html" in errors("<p>{{item.sku}}</p>", None))
    check("a script in the Item Row is refused", "item_row" in errors("<table>{{receipt_items}}</table>", "<script>x</script>"))
    check("a good one passes", errors("<table>{{receipt_items}}</table>", row) == {})
    check("custom HTML without an Item Row is as before", errors("<p>{{receipt_body}}</p>", None) == {})
    check.done()


def _api(admin_email):
    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    context.set_current(str(tenant.id), "default", str(user.pk))
    return tenant, Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)


def test_library_layouts_picked_by_templates(check, admin_email):
    tenant, api = _api(admin_email)
    post = lambda url, body: api.post(url, body, content_type="application/json")   # noqa: E731
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
            name = f"Register {uuid.uuid4().hex[:6]}"
            register = dict(rl.default_register_settings(), footer_text="Returns within 30 days.")
            made = post("/api/v1/receipt-layouts/", {"name": name, "layout_preset": "REGISTER", "register": register})
            check("a layout is made", made.status_code == 201, f"{made.status_code} {made.content[:200]}")
            layout = made.json()
            check("named, version 1, used by nothing", layout["name"] == name and layout["version_number"] == 1 and layout["used_by"] == 0)
            check("the same name twice is refused", post("/api/v1/receipt-layouts/", {"name": name.upper(), "layout_preset": "STANDARD"}).status_code == 400)

            template = post("/api/v1/templates/", {"name": f"Receipt {uuid.uuid4().hex[:6]}", "channel": "E_RECEIPT"}).json()
            own = post(f"/api/v1/templates/{template['id']}/receipt/", {"layout_preset": "STANDARD", "sections": design.default_receipt_sections(), "base_version": 0})
            check("the template saves its own layout as before", own.status_code == 201 and own.json()["layout_id"] is None, f"{own.status_code} {own.content[:200]}")
            picked = post(f"/api/v1/templates/{template['id']}/receipt/", {"layout_preset": "STANDARD", "sections": [], "base_version": own.json()["version_number"],
                                                                         "layout_id": layout["id"]})
            check("then picks the library layout", picked.status_code == 201 and picked.json()["layout_id"] == layout["id"], f"{picked.status_code} {picked.content[:200]}")
            back = api.get(f"/api/v1/templates/{template['id']}/receipt/").json()
            check("and reads the library layout's content", back["layout_preset"] == "REGISTER" and back["register"]["footer_text"] == "Returns within 30 days." and back["layout_name"] == name)
            listed = {row["id"]: row for row in api.get("/api/v1/receipt-layouts/").json()}
            check("the library counts the template", listed[layout["id"]]["used_by"] == 1)

            saved = api.put(f"/api/v1/receipt-layouts/{layout['id']}/", {"name": name, "layout_preset": "REGISTER", "base_version": 1,
                                                                        "register": dict(register, footer_text="Exchanges only.")}, content_type="application/json")
            check("a save makes version 2", saved.status_code == 200 and saved.json()["version_number"] == 2, f"{saved.status_code} {saved.content[:200]}")
            stale = api.put(f"/api/v1/receipt-layouts/{layout['id']}/", {"name": name, "layout_preset": "REGISTER", "base_version": 1, "register": register},
                            content_type="application/json")
            check("a stale save is refused", stale.status_code == 409)
            row = TemplateMaster.objects.get(pk=template["id"])
            sent = rl.apply(row, SLOT, {"number": "1", "items": [{"description": "Tee", "quantity": 1, "unit_price": 9.99, "total": 9.99}]}, None, "USD")
            check("the template's receipt prints the library layout's latest footer", "Exchanges only." in sent and 'data-layout="register"' in sent)

            check("archiving is refused while a template picks it", post(f"/api/v1/receipt-layouts/{layout['id']}/archive/", {}).status_code == 409)
            copy = post(f"/api/v1/receipt-layouts/{layout['id']}/duplicate/", {})
            check("a duplicate gets a copy name", copy.status_code == 201 and copy.json()["name"] == f"{name} copy")
            mine = post("/api/v1/receipt-layouts/", {"name": f"From template {uuid.uuid4().hex[:6]}", "from_template": template["id"]})
            check("Save to Library copies what the template shows", mine.status_code == 201 and mine.json()["layout_preset"] == "REGISTER")
            post(f"/api/v1/templates/{template['id']}/receipt/", {"layout_preset": "STANDARD", "sections": design.default_receipt_sections(),
                                                                  "base_version": picked.json()["version_number"]})
            archived = post(f"/api/v1/receipt-layouts/{layout['id']}/archive/", {})
            check("once no template picks it, it archives", archived.status_code == 200 and archived.json()["archived"])
            check("and leaves the list", layout["id"] not in {row["id"] for row in api.get("/api/v1/receipt-layouts/").json()})
            check("an archived layout cannot be picked", post(f"/api/v1/templates/{template['id']}/receipt/", {"layout_preset": "STANDARD", "sections": [],
                  "base_version": picked.json()["version_number"] + 1, "layout_id": layout["id"]}).status_code == 400)
            raise RuntimeError("roll back")
    except RuntimeError as exc:
        if str(exc) != "roll back":
            raise
    check.done()
