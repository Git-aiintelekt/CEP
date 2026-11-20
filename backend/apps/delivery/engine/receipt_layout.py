"""The receipt layout, rendered at send time: the Python twin of frontend/src/features/receipt/receiptEmailHtml.ts.

An E-Receipt template has two halves: the outer design (MJML, compiled to HTML with a receipt slot between two
comment markers) and the receipt layout (sections with their settings, saved through /templates/{id}/receipt/). The
editor previews the layout with sample transactions; this module fills it with the real receipt the point of sale
sent and puts the result into the slot, so the sent email is exactly what Preview & Test showed. The two renderers
share their rules (receiptRules.ts) and must not drift.

    transaction_from(receipt, store, currency)   the POS payload -> the shape the sections read
    render(sections, transaction, barcode_url)   the receipt as email-safe tables, escaped
    inject(html, receipt_html)                   between the slot markers; unchanged when the design has no slot
    apply(template, html, receipt, store, ...)   the three together, for receipts.send
"""
import re
from datetime import datetime
from html import escape

from . import barcode

COLOR = {"text": "#17181c", "muted": "#6b6f7b", "line": "#e7e8ef", "subtle": "#eeeff5", "rule": "#9ea2ad", "surface": "#ffffff",
         "callout_bg": "#eef2fe", "callout_text": "#312e7c"}
FONT = "Helvetica, Arial, sans-serif"
NUMERIC = "font-variant-numeric:tabular-nums;"
TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
HIDE_MOBILE_CLASS = "cep-hide-mobile"
HIDE_MOBILE_RULE = ("@media only screen and (max-width:480px){." + HIDE_MOBILE_CLASS +
                    "{display:none!important;max-height:0!important;overflow:hidden!important;font-size:0!important;line-height:0!important;}}")
MINUS = "−"                                              # a refund reads as a minus in every font
SLOT_START = re.compile(r"<!--\s*CEP:RECEIPT_SLOT_START\s*-->")
SLOT_END = re.compile(r"<!--\s*CEP:RECEIPT_SLOT_END\s*-->")
ORDER = ("header", "customer_fulfillment", "items", "totals", "payment", "loyalty", "support")


# ------------------------------------------------------------------------------------------------ the POS payload as a transaction
def _number(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _date_text(value) -> str:
    if not value:
        return ""
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value)
    return f"{moment.strftime('%b')} {moment.day}, {moment.year}"


def _stamp_text(value) -> str:
    """07/02/2026 17:31: the register's own date and time."""
    if not value:
        return ""
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value)
    return moment.strftime("%m/%d/%Y %H:%M")


def _time_text(value) -> str:
    if not value:
        return ""
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value)
    return f"{moment.strftime('%b')} {moment.day}, {moment.year}, {moment.strftime('%I:%M %p').lstrip('0')}"


def transaction_from(receipt: dict, store: dict | None, currency: str = "USD") -> dict:
    """The shape the sections read (SampleTransaction in the editor), from what the point of sale sent."""
    store = store or {}
    items = []
    for item in receipt.get("items") or []:
        quantity = _number(item.get("quantity"), 1.0)
        unit = _number(item.get("unit_price"), 0.0)
        amount = _number(item.get("total", item.get("amount")), None)
        items.append({"sku": str(item.get("sku") or ""), "description": str(item.get("description") or item.get("name") or "Item"),
                      "image_url": item.get("image_url") or None, "quantity": quantity, "unit_price": unit,
                      "amount": amount if amount is not None else quantity * unit, "discount": abs(_number(item.get("discount"), 0.0)),
                      # read only by Store Register columns and Item Row tags
                      "upc": str(item.get("upc") or ""), "size": str(item.get("size") or ""), "color": str(item.get("color") or ""),
                      "tax": _number(item.get("tax"), None), "status": str(item.get("status") or "")})
    discount_total = _number(receipt.get("discount_total"), 0.0)
    subtotal = _number(receipt.get("subtotal"), None)
    if subtotal is None:
        subtotal = sum(item["amount"] for item in items)
    shipping = _number(receipt.get("shipping_total"), None)
    tax = _number(receipt.get("tax_total"), 0.0)
    tip = _number(receipt.get("tip_total"), None)
    total = _number(receipt.get("grand_total"), None)
    if total is None:
        total = subtotal - abs(discount_total) + (shipping or 0) + tax + (tip or 0)
    source = str(receipt.get("source") or "").upper()
    online = source in ("ECOMMERCE", "WEB", "ONLINE") or (not source and bool(receipt.get("order_url") or receipt.get("shipping_address")))
    loyalty = receipt.get("loyalty") if isinstance(receipt.get("loyalty"), dict) else None
    if loyalty is not None and loyalty.get("enrolled") is False:
        loyalty = None
    when = receipt.get("transaction_at")
    taxes = [{"label": str(tax.get("description") or "Sales Tax"), "percent": _number(tax.get("percent"), None), "amount": _number(tax.get("amount"), 0.0)}
             for tax in (receipt.get("taxes") or []) if isinstance(tax, dict)] or ([{"label": "Sales Tax", "percent": None, "amount": tax}] if tax else [])
    tenders = [{"label": str(x.get("label") or ""), "amount": _number(x.get("amount"), 0.0), "auth": str(x.get("auth_code") or "")}
               for x in (receipt.get("tenders") or []) if isinstance(x, dict) and x.get("amount") is not None]
    if not tenders and (receipt.get("tender_summary") or receipt.get("payment_method")):
        tenders = [{"label": str(receipt.get("tender_summary") or receipt.get("payment_method")).upper(), "amount": _number(receipt.get("amount_paid"), total), "auth": ""}]
    item_count = _number(receipt.get("item_count"), None)
    register = {
        "trans_number": str(receipt.get("number") or receipt.get("order_number") or ""), "register": str(receipt.get("register") or ""),
        "store_number": str(receipt.get("store_number") or store.get("number") or store.get("id") or ""), "trans_at": _stamp_text(when),
        "cashier": str(receipt.get("clerk") or ""), "item_count": item_count if item_count is not None else sum(abs(item["quantity"]) for item in items),
        "taxes": taxes, "tenders": tenders, "change_due": _number(receipt.get("change_due"), 0.0),
    }
    return {
        "register": register,
        "source": "ECOMMERCE" if online else "POS", "currency": currency,
        "order_number": str(receipt.get("order_number") or receipt.get("number") or ""), "order_date": _date_text(when),
        "store": str(store.get("name") or receipt.get("store_name") or ""), "receipt_id": str(receipt.get("number") or receipt.get("order_number") or ""),
        "ship_to": receipt.get("shipping_address") or None, "pickup_location": receipt.get("pickup_location") or None,
        "delivery_estimate": receipt.get("delivery_estimate") or None, "line_items": items, "subtotal": subtotal,
        "discount": {"code": str(receipt.get("discount_code") or ""), "amount": abs(discount_total)} if discount_total else None,
        "shipping": shipping, "tax": tax, "tip": tip, "total": total,
        "payment": {"masked_method": str(receipt.get("tender_summary") or receipt.get("payment_method") or ""),
                    "authorized_at": _time_text(receipt.get("authorized_at") or when), "billing_address": str(receipt.get("billing_address") or "")},
        "loyalty": {"points_earned": int(_number(loyalty.get("points_earned"), 0)), "points_balance": int(_number(loyalty.get("points_balance"), 0)),
                    "tier_progress": str(loyalty.get("tier_progress") or "")} if loyalty else None,
    }


# ------------------------------------------------------------------------------------------------ the rules (receiptRules.ts)
def money(amount: float, currency: str) -> str:
    from .receipts import SYMBOLS
    symbol = SYMBOLS.get((currency or "USD").upper())
    text = f"{abs(amount):,.2f}"
    sign = MINUS if amount < 0 else ""
    return f"{sign}{symbol}{text}" if symbol else f"{sign}{text} {currency.upper()}"


def shows(section: dict, transaction: dict) -> bool:
    if section.get("key") == "loyalty" and not transaction.get("loyalty"):
        return False
    return bool(section.get("locked") or section.get("visible"))


def fulfillment_of(section: dict, transaction: dict) -> tuple[str, str | None]:
    mode = section.get("address_mode", "AUTO")
    shipping = True if mode == "SHIP_TO" else False if mode == "PICKUP" else (transaction["ship_to"] is not None or transaction["pickup_location"] is None)
    if shipping:
        return "Delivery", transaction["ship_to"]
    return "In store", transaction["pickup_location"] or transaction["store"]


def totals_rows(section: dict, transaction: dict) -> list[dict]:
    rows = section.get("rows") or {}
    out = []
    if rows.get("subtotal"):
        out.append({"label": "Subtotal", "amount": transaction["subtotal"]})
    if rows.get("discount") and transaction["discount"]:
        out.append({"label": "Discount", "amount": -transaction["discount"]["amount"], "note": transaction["discount"]["code"]})
    if rows.get("shipping") and transaction["source"] != "POS" and transaction["shipping"] is not None:
        out.append({"label": "Shipping", "amount": transaction["shipping"]})
    if rows.get("tax"):
        out.append({"label": "Tax", "amount": transaction["tax"]})
    if rows.get("tip") and transaction["tip"] is not None:
        out.append({"label": "Tip", "amount": transaction["tip"]})
    return out


# ------------------------------------------------------------------------------------------------ the look (receiptEmailHtml.ts)
def _e(text) -> str:
    return escape(str(text), quote=True)


def _title(text: str) -> str:
    return f'<p style="margin:0 0 4px;font-size:12px;line-height:16px;font-weight:600;color:{COLOR["muted"]};">{_e(text)}</p>'


def _row(label: str, value: str, note: str | None = None, strong: bool = False, numeric: bool = False) -> str:
    size = "font-size:16px;line-height:24px;font-weight:600;" if strong else "font-size:14px;line-height:20px;"
    chip = f' <span style="padding:0 4px;border-radius:4px;background-color:{COLOR["subtle"]};font-size:12px;color:{COLOR["muted"]};">{_e(note)}</span>' if note else ""
    return (f'<tr>\n    <td style="padding:2px 0;{size}color:{COLOR["text"] if strong else COLOR["muted"]};">{_e(label)}{chip}</td>\n'
            f'    <td align="right" style="padding:2px 0 2px 16px;{size}{NUMERIC if numeric else ""}color:{COLOR["text"]};text-align:right;">{_e(value)}</td>\n  </tr>')


def _rows(body: str) -> str:
    return f"<table {TABLE}>{body}</table>"


def _quantity(value: float) -> str:
    return f"{value:g}"


def _header(section: dict, t: dict) -> str:
    fields = section.get("fields") or {}
    listed = [(fields.get("order_number"), "Order", t["order_number"]), (fields.get("order_date"), "Date", t["order_date"]),
              (fields.get("store"), "Store", t["store"]), (fields.get("receipt_id"), "Receipt ID", t["receipt_id"])]
    return _rows("".join(_row(label, value) for on, label, value in listed if on))


def _fulfillment(section: dict, t: dict) -> str:
    heading, address = fulfillment_of(section, t)
    estimate = (f'<p style="margin:4px 0 0;font-size:14px;line-height:20px;color:{COLOR["muted"]};">{_e(t["delivery_estimate"])}</p>'
                if section.get("delivery_estimate") and t["delivery_estimate"] else "")
    return f'{_title(heading)}<p style="margin:0;font-size:14px;line-height:20px;color:{COLOR["text"]};">{_e(address or "No address on this order")}</p>{estimate}'


def _items(section: dict, t: dict, currency: str) -> str:
    columns = section.get("columns") or {}
    pad = "6px" if section.get("row_height") == "COMPACT" else "12px"

    def head(label, width, align):
        return (f'<td width="{width}" align="{align}" style="padding:8px 0 8px 12px;border-bottom:1px solid {COLOR["line"]};font-size:12px;line-height:16px;'
                f'font-weight:600;color:{COLOR["muted"]};text-align:{align};">{label}</td>')

    headings = "".join([
        f'<td class="{HIDE_MOBILE_CLASS}" width="64" style="padding:8px 0;border-bottom:1px solid {COLOR["line"]};"></td>' if columns.get("product_image") else "",
        f'<td style="padding:8px 0;border-bottom:1px solid {COLOR["line"]};font-size:12px;line-height:16px;font-weight:600;color:{COLOR["muted"]};">Item</td>',
        head("Qty", "36", "center") if columns.get("quantity") else "",
        head("Unit price", "76", "right") if columns.get("unit_price") else "",
        head("Amount", "76", "right") if columns.get("amount") else "",
    ])
    lines = []
    items = t["line_items"]
    for index, item in enumerate(items):
        border = "" if index == len(items) - 1 else f'border-bottom:1px solid {COLOR["subtle"]};'

        def cell(align, value):
            return (f'<td align="{align}" style="padding:{pad} 0 {pad} 12px;{border}font-size:14px;line-height:20px;{NUMERIC}white-space:nowrap;'
                    f'color:{COLOR["text"]};text-align:{align};">{_e(value)}</td>')

        image = (f'<img src="{_e(item["image_url"])}" alt="" width="52" height="52" style="display:block;width:52px;height:52px;border:0;border-radius:4px;" />'
                 if item["image_url"] else
                 f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="52" height="52" style="width:52px;height:52px;border-radius:4px;'
                 f'background-color:{COLOR["subtle"]};"></td></tr></table>')
        sku = f'<br /><span style="font-size:12px;line-height:16px;color:{COLOR["muted"]};">{_e(item["sku"])}</span>' if columns.get("sku") else ""
        lines.append("<tr>\n      " + "\n      ".join(filter(None, [
            f'<td class="{HIDE_MOBILE_CLASS}" width="64" valign="middle" style="padding:{pad} 12px {pad} 0;{border}">{image}</td>' if columns.get("product_image") else "",
            f'<td valign="middle" style="padding:{pad} 0;{border}font-size:14px;line-height:20px;color:{COLOR["text"]};">{_e(item["description"])}{sku}</td>',
            cell("center", _quantity(item["quantity"])) if columns.get("quantity") else "",
            cell("right", money(item["unit_price"], currency)) if columns.get("unit_price") else "",
            cell("right", money(item["amount"], currency)) if columns.get("amount") else "",
        ])) + "\n    </tr>")
    return f"<table {TABLE}><tr>{headings}</tr>{''.join(lines)}</table>"


def _totals(section: dict, t: dict, currency: str) -> str:
    listed = totals_rows(section, t)
    body = "".join(_row(item["label"], money(item["amount"], currency), note=item.get("note"), numeric=True) for item in listed)
    rule = (f'<tr><td colspan="2" style="padding-top:4px;border-bottom:1px solid {COLOR["line"]};font-size:0;line-height:0;">&nbsp;</td></tr>'
            f'<tr><td colspan="2" style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>') if listed else ""
    savings = ""
    if section.get("savings_callout") and t["discount"]:
        savings = (f'<table {TABLE} style="margin-top:8px;"><tr><td style="padding:8px 12px;border-radius:4px;background-color:{COLOR["callout_bg"]};font-size:12px;'
                   f'line-height:16px;color:{COLOR["callout_text"]};">You saved <span style="{NUMERIC}">{_e(money(t["discount"]["amount"], currency))}</span> on this order.</td></tr></table>')
    return _rows(f'{body}{rule}{_row("Total", money(t["total"], currency), strong=True, numeric=True)}') + savings


def _payment(section: dict, t: dict) -> str:
    fields = section.get("fields") or {}
    pay = t["payment"]
    return _title("Payment") + _rows("".join([
        _row("Paid with", pay["masked_method"]) if fields.get("method") and pay["masked_method"] else "",
        _row("Authorized", pay["authorized_at"]) if fields.get("authorization_time") and pay["authorized_at"] else "",
        _row("Billing address", pay["billing_address"]) if fields.get("billing_address") and pay["billing_address"] else "",
    ]))


def _loyalty(section: dict, t: dict) -> str:
    points = t["loyalty"]
    if not points:
        return ""
    fields = section.get("fields") or {}
    return _title("Loyalty") + _rows("".join([
        _row("Points earned", f"{points['points_earned']:,}", numeric=True) if fields.get("points_earned") else "",
        _row("Points balance", f"{points['points_balance']:,}", numeric=True) if fields.get("points_balance") else "",
        _row("Tier progress", points["tier_progress"]) if fields.get("tier_progress") and points["tier_progress"] else "",
    ]))


def barcode_block(number: str, image_url: str) -> str:
    """The return barcode: a Code 128 image of the receipt number with the number under it, in the dashed box the editor shows."""
    return (f'<table {TABLE} style="margin-top:12px;"><tr><td align="center" style="padding:12px;border:1px dashed {COLOR["rule"]};border-radius:4px;text-align:center;">'
            f'<img src="{_e(image_url)}" alt="Barcode {_e(number)}" width="240" height="64" style="display:block;margin:0 auto 6px;width:240px;height:64px;border:0;" />'
            f'<span style="font-size:12px;line-height:16px;color:{COLOR["muted"]};{NUMERIC}">{_e(number)}</span></td></tr></table>')


# ------------------------------------------------------------------------------------------------ the Store Register layout
REGISTER = {"band": "#e4deed", "header": "#ffffff", "columns": "#f5f5f5", "card": "#ffffff", "text": "#1f1f1f", "line": "#e6e2ed", "discount": "#2e9e3a"}
REGISTER_PRESET = "REGISTER"


REGISTER_FIELDS = {"trans_number": "Trans Num", "register": "Register", "store_number": "Store", "trans_at": "Trans Dt", "cashier": "Cashier",
                   "item_count": "Item(s) Sold"}
# what a Store Register column can show; Description is always first and Amount always last
REGISTER_COLUMNS = {"description": "Description", "size": "Size", "color": "Colour", "quantity": "Qty", "unit_price": "Unit Price",
                    "discount": "Discount", "tax": "Line Tax", "sku": "SKU", "upc": "UPC", "status": "Status", "amount": "Amount"}
MAX_REGISTER_COLUMNS = 5
MAX_REGISTER_LABEL = 40
MAX_REGISTER_TITLE = 60
MAX_REGISTER_FOOTER = 500
WIDE_CLASS = "cep-rl-wide"
NARROW_CLASS = "cep-rl-narrow"
# on a phone the middle columns fold into a line under the item; clients that ignore media queries keep the columns
FOLD_RULE = ("@media only screen and (max-width:480px){." + WIDE_CLASS + "{display:none!important;}." + NARROW_CLASS +
             "{display:block!important;max-height:none!important;overflow:visible!important;}}")


def _count_text(value: float) -> str:
    return f"{value:g}"


def default_register_settings() -> dict:
    """The Store Register as it printed before it had settings: these print exactly that."""
    return {"title": "YOUR RECEIPT", "fields": [{"key": key, "label": label, "visible": True} for key, label in REGISTER_FIELDS.items()],
            "columns": [{"key": "description", "label": "Description"}, {"key": "amount", "label": "Amount"}],
            "under_item": {"discount": True, "quantity_at_price": True, "sku": False, "upc": False},
            "footer_text": "", "footer_align": "CENTER", "phone": "FOLD"}


def clean_register_settings(raw) -> tuple[dict | None, dict]:
    """-> (settings, errors). None stays None: a layout saved without settings prints the fixed Store Register."""
    if raw is None:
        return None, {}
    if not isinstance(raw, dict):
        return None, {"register": "The Store Register settings must be an object."}
    errors: dict[str, str] = {}
    out = default_register_settings()
    out["title"] = str(raw.get("title", out["title"]) or "").strip()
    if len(out["title"]) > MAX_REGISTER_TITLE:
        errors["register"] = f"The title is longer than {MAX_REGISTER_TITLE} characters."

    fields = raw.get("fields", out["fields"])
    keys = [f.get("key") for f in fields if isinstance(f, dict)] if isinstance(fields, list) else []
    if sorted(keys) != sorted(REGISTER_FIELDS):
        errors["register"] = "The header must list each of the six transaction fields once."
    else:
        out["fields"] = [{"key": f["key"], "label": str(f.get("label") or "").strip() or REGISTER_FIELDS[f["key"]], "visible": f.get("visible", True) is not False}
                         for f in fields]

    columns = raw.get("columns", out["columns"])
    keys = [c.get("key") for c in columns if isinstance(c, dict)] if isinstance(columns, list) else []
    if not keys or keys[0] != "description" or keys[-1] != "amount" or len(keys) < 2:
        errors["register"] = "The columns start with the item's description and end with its amount."
    elif len(keys) > MAX_REGISTER_COLUMNS:
        errors["register"] = f"At most {MAX_REGISTER_COLUMNS} columns: a sixth does not fit a phone."
    elif len(set(keys)) != len(keys) or any(key not in REGISTER_COLUMNS for key in keys):
        errors["register"] = "Each column shows a different value from the list."
    else:
        out["columns"] = [{"key": c["key"], "label": str(c.get("label") or "").strip() or REGISTER_COLUMNS[c["key"]]} for c in columns]

    labels = [f["label"] for f in out["fields"]] + [c["label"] for c in out["columns"]]
    if any(len(label) > MAX_REGISTER_LABEL for label in labels):
        errors["register"] = f"A label is longer than {MAX_REGISTER_LABEL} characters."
    under = raw.get("under_item") if isinstance(raw.get("under_item"), dict) else {}
    out["under_item"] = {key: bool(under.get(key, value)) for key, value in out["under_item"].items()}
    out["footer_text"] = str(raw.get("footer_text") or "").strip()
    if len(out["footer_text"]) > MAX_REGISTER_FOOTER:
        errors["register"] = f"The footer text is longer than {MAX_REGISTER_FOOTER} characters."
    out["footer_align"] = "LEFT" if raw.get("footer_align") == "LEFT" else "CENTER"
    out["phone"] = "KEEP" if raw.get("phone") == "KEEP" else "FOLD"
    return out, errors


def column_value(key: str, item: dict, currency: str) -> str:
    """A Store Register cell: money as money, a discount in brackets, an empty value as nothing."""
    if key == "quantity":
        return _count_text(item["quantity"])
    if key in ("unit_price", "amount"):
        return money(item[key], currency)
    if key == "discount":
        return f"({money(item['discount'], currency)})" if item.get("discount") else ""
    if key == "tax":
        return money(item["tax"], currency) if item.get("tax") is not None else ""
    return str(item.get(key) or "")


def folds(settings: dict | None) -> bool:
    """The receipt carries the phone rule: middle columns that fold under the item."""
    return bool(settings) and settings.get("phone") != "KEEP" and len(settings.get("columns") or []) > 2


def render_register(t: dict, settings: dict | None = None) -> str:
    """The receipt as the register prints it: the title, the transaction's numbers in rows of three, the columns (Description
    and Amount at least) with each line's discount (green) and its "1 @ $19.99", the lines' sum, then Subtotal, each tax with
    its rate, TOTAL, every tender with its authorisation, the change, and the footer text. Without settings (a layout saved
    before they existed) it prints exactly what it always printed."""
    s = settings or default_register_settings()
    currency = t.get("currency") or "USD"
    r = t.get("register") or {}
    cell = f'font-size:12px;line-height:18px;color:{REGISTER["text"]};'
    strong = cell + "font-weight:700;"
    line = f'border-bottom:1px solid {REGISTER["line"]};'

    def meta(label, value, align):
        return f'<td align="{align}" style="padding:1px 0;{cell}text-align:{align};"><span style="font-weight:700;">{_e(label)}:</span> {_e(value)}</td>'

    values = {"trans_number": r.get("trans_number", ""), "register": r.get("register", ""), "store_number": r.get("store_number", ""),
              "trans_at": r.get("trans_at", ""), "cashier": r.get("cashier", ""), "item_count": _count_text(_number(r.get("item_count"), 0.0))}
    shown = [f for f in s["fields"] if f.get("visible", True)]
    header_rows = "".join("<tr>" + "".join(meta(f["label"], values[f["key"]], ("left", "center", "right")[i]) for i, f in enumerate(shown[at:at + 3])) + "</tr>"
                          for at in range(0, len(shown), 3))
    header = f"<table {TABLE}>{header_rows}</table>" if header_rows else ""

    first, *middle, last = s["columns"]
    fold = folds(s)
    wide = f' class="{WIDE_CLASS}"' if fold else ""
    amount_width = ' width="80"' if middle else ""
    under = s["under_item"]
    lines = []
    for item in t["line_items"]:
        folded = ""
        if fold:
            parts = [f"{column['label']} {value}" for column in middle if (value := column_value(column["key"], item, currency))]
            folded = (f'<div class="{NARROW_CLASS}" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{_e(" · ".join(parts))}</div>' if parts else "")
        discount = (f'<br /><span style="color:{REGISTER["discount"]};">Discount: ({_e(money(item["discount"], currency))})</span>' if under["discount"] and item.get("discount") else "")
        at_price = f'<br /><span>{_e(_count_text(item["quantity"]))} @ {_e(money(item["unit_price"], currency))}</span>' if under["quantity_at_price"] else ""
        codes = "".join(f"<br /><span>{label} {_e(item[key])}</span>" for key, label in (("sku", "SKU"), ("upc", "UPC")) if under.get(key) and item.get(key))
        cells = "".join(f'<td align="center" valign="bottom" width="64"{wide} style="padding:10px 0 10px 12px;{line}{cell}text-align:center;">{_e(column_value(column["key"], item, currency))}</td>'
                        for column in middle)
        lines.append(f'<tr><td valign="bottom" style="padding:10px 0;{line}{cell}">{_e(item["description"])}{discount}{at_price}{codes}{folded}</td>{cells}'
                     f'<td align="right" valign="bottom"{amount_width} style="padding:10px 0 10px 16px;{line}{cell}{NUMERIC}white-space:nowrap;text-align:right;">{_e(money(item["amount"], currency))}</td></tr>')
    lines_total = sum(item["amount"] for item in t["line_items"])
    heads = "".join(f'<td align="center" width="64"{wide} style="padding:0 0 0 12px;{strong}text-align:center;">{_e(column["label"])}</td>' for column in middle)
    last_head = (f'<td align="right"{amount_width} style="padding:0 0 0 16px;{strong}text-align:right;">{_e(last["label"])}</td>' if middle
                 else f'<td align="right" style="padding:0;{strong}text-align:right;">{_e(last["label"])}</td>')
    columns = f'<table {TABLE}><tr><td style="padding:0;{strong}">{_e(first["label"])}</td>{heads}{last_head}</tr></table>'
    items = (f'<table {TABLE}>{"".join(lines)}'
             f'<tr><td colspan="{len(s["columns"])}" align="right" style="padding:10px 0;{line}{strong}{NUMERIC}text-align:right;">{_e(money(lines_total, currency))}</td></tr></table>')

    def total_row(label, value, big=False):
        size = "font-size:14px;line-height:20px;" if big else ""
        return (f'<tr><td align="right" style="padding:2px 0;{strong}{size}text-align:right;">{_e(label)}:</td>'
                f'<td align="right" width="96" style="padding:2px 0 2px 12px;{cell}{size}{NUMERIC}text-align:right;">{_e(value)}</td></tr>')

    rows = [total_row("Subtotal", money(t["subtotal"], currency))]
    for tax in r.get("taxes") or []:
        rate = f" ({_count_text(tax['percent'])}%)" if tax.get("percent") is not None else ""
        rows.append(total_row(f"{tax['label']}{rate}", money(tax["amount"], currency)))
    rows.append(total_row("TOTAL", money(t["total"], currency), big=True))
    for tender in r.get("tenders") or []:
        auth = f" (Auth: {tender['auth']})" if tender.get("auth") else ""
        rows.append(total_row(f"Paid with {tender['label']}{auth}", money(tender["amount"], currency)))
    if any((tender.get("label") or "").startswith("CASH") for tender in r.get("tenders") or []) or r.get("change_due"):
        rows.append(total_row("Cash Change", money(_number(r.get("change_due"), 0.0), currency)))
    totals = f'<table {TABLE}>{"".join(rows)}</table>'

    def block(name, colour, padding, inner):
        return f'          <table data-section="{name}" {TABLE} style="border-radius:4px;border-collapse:separate;background-color:{colour};"><tr><td style="padding:{padding};">{inner}</td></tr></table>\n'

    gap = f'          <table {TABLE}><tr><td style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr></table>\n'
    title = (f'<p data-section="register-title" style="margin:0 0 10px;font-size:15px;line-height:20px;font-weight:700;letter-spacing:0.02em;text-align:center;">{_e(s["title"])}</p>'
             if s["title"] else "")
    footer = ""
    if s["footer_text"]:
        align = "left" if s["footer_align"] == "LEFT" else "center"
        text = _e(s["footer_text"]).replace("\r\n", "\n").replace("\n", "<br />")
        footer = gap + block("register-footer", REGISTER["card"], "12px 18px", f'<p style="margin:0;{cell}text-align:{align};">{text}</p>')
    return ((f"<style>{FOLD_RULE}</style>\n" if fold else "")
            + f'<table {TABLE} align="center" style="width:100%;max-width:600px;margin:0 auto;">\n  <tr>\n    <td style="padding:8px 24px 24px;">\n'
            f'      <table {TABLE} data-layout="register" style="border-radius:6px;border-collapse:separate;background-color:{REGISTER["band"]};font-family:{FONT};color:{REGISTER["text"]};">\n'
            f'        <tr><td style="padding:16px;">\n'
            + block("register-header", REGISTER["header"], "14px 18px 12px", title + header) + gap
            + f'          <table data-section="register-body" {TABLE} style="border-radius:4px;border-collapse:separate;background-color:{REGISTER["card"]};">'
            f'<tr><td data-section="register-columns" style="padding:8px 18px;border-radius:4px 4px 0 0;border-bottom:1px solid {REGISTER["line"]};background-color:{REGISTER["columns"]};">{columns}</td></tr>'
            f'<tr><td style="padding:2px 18px 16px;"><div data-section="register-items">{items}</div><div data-section="register-totals" style="margin-top:12px;">{totals}</div></td></tr></table>\n'
            + footer
            + '        </td></tr>\n      </table>\n    </td>\n  </tr>\n</table>')


# ------------------------------------------------------------------------------------------------ Custom HTML: the Item Row
ITEM_TAG = re.compile(r"\{\{\s*item\.([a-z_]+)\s*\}\}")
RECEIPT_ITEMS = re.compile(r"\{\{\s*receipt_items\s*\}\}")
ITEM_TAGS = ("description", "sku", "upc", "size", "color", "quantity", "unit_price", "discount", "tax", "amount", "status")


def item_value(key: str, item: dict, currency: str) -> str:
    """An {{item.*}} tag's value: money as money, a discount only when there is one, an unknown tag as nothing."""
    if key == "discount":
        return money(item["discount"], currency) if item.get("discount") else ""
    if key in ITEM_TAGS:
        return column_value(key, item, currency)
    return ""


def item_rows(item_row: str, t: dict) -> str:
    """The Item Row once per line, its {{item.*}} tags filled and escaped."""
    currency = t.get("currency") or "USD"
    return "".join(ITEM_TAG.sub(lambda m, item=item: _e(item_value(m.group(1), item, currency)), item_row) for item in t["line_items"])


def with_head_style(html: str, css: str) -> str:
    """Some clients keep only the <style> in <head>, so a phone rule goes there too. No head, no insert."""
    at = re.search(r"</head>", html, re.I)
    return html if at is None else f"{html[:at.start()]}<style>{css}</style>{html[at.start():]}"


def _support(section: dict, t: dict, barcode_url: str | None) -> str:
    policy = str(section.get("policy_text") or "").strip()
    policy_html = (f'<p style="margin:4px 0 0;font-size:14px;line-height:20px;color:{COLOR["muted"]};">{_e(policy).replace(chr(13) + chr(10), "<br />").replace(chr(10), "<br />")}</p>'
                   if policy else "")
    code = barcode_block(t["receipt_id"], barcode_url) if section.get("barcode") and barcode_url and t["receipt_id"] else ""
    return _title("Returns & support") + policy_html + code


def _body(section: dict, t: dict, currency: str, barcode_url: str | None) -> str:
    key = section.get("key")
    if key == "header":
        return _header(section, t)
    if key == "customer_fulfillment":
        return _fulfillment(section, t)
    if key == "items":
        return _items(section, t, currency)
    if key == "totals":
        return _totals(section, t, currency)
    if key == "payment":
        return _payment(section, t)
    if key == "loyalty":
        return _loyalty(section, t)
    if key == "support":
        return _support(section, t, barcode_url)
    return ""


def render(sections: list[dict], transaction: dict, barcode_url: str | None = None, preset: str | None = None, register: dict | None = None) -> str:
    """The receipt, ready for the slot: the hide-on-phones rule, then one centred 600px table, a hairline between
    sections and a dashed one above Totals. The Store Register preset has a layout of its own, with its settings."""
    if preset == REGISTER_PRESET:
        return render_register(transaction, register)
    currency = transaction.get("currency") or "USD"
    ordered = sorted((s for s in sections if isinstance(s, dict) and s.get("key") in ORDER), key=lambda s: (s.get("order", ORDER.index(s["key"])), ORDER.index(s["key"])))
    shown = [s for s in ordered if shows(s, transaction)]
    cells = []
    for index, section in enumerate(shown):
        divider = "" if index == 0 else f'border-top:1px dashed {COLOR["rule"]};' if section["key"] == "totals" else f'border-top:1px solid {COLOR["line"]};'
        padding = "8px 16px" if section["key"] == "items" else "16px"
        cells.append(f'<tr><td data-section="{section["key"]}" style="padding:{padding};{divider}">{_body(section, transaction, currency, barcode_url)}</td></tr>')
    inner = "\n        ".join(cells)
    return (f"<style>{HIDE_MOBILE_RULE}</style>\n"
            f'<table {TABLE} align="center" style="width:100%;max-width:600px;margin:0 auto;background-color:{COLOR["surface"]};">\n'
            f'  <tr>\n    <td style="padding:8px 24px 24px;">\n'
            f'      <table {TABLE} style="border:1px solid {COLOR["line"]};border-radius:8px;border-collapse:separate;background-color:{COLOR["surface"]};font-family:{FONT};color:{COLOR["text"]};">\n'
            f"        {inner}\n      </table>\n    </td>\n  </tr>\n</table>")


# ------------------------------------------------------------------------------------------------ into the outer email
def has_slot(html: str) -> bool:
    return bool(html) and SLOT_START.search(html) is not None and SLOT_END.search(html) is not None


def inject(html: str, receipt_html: str) -> str:
    """Replaces what lies between the slot markers, keeping the markers. A design with no slot comes back unchanged."""
    out, position = [], 0
    for start in SLOT_START.finditer(html):
        if start.start() < position:
            continue
        end = SLOT_END.search(html, start.end())
        if end is None:
            break
        out.append(html[position:start.end()])
        out.append(f"\n{receipt_html}\n")
        position = end.start()
    if not out:
        return html
    out.append(html[position:])
    return "".join(out)


def layout_for(template) -> dict:
    from apps.templates import design
    return design.receipt_payload(template)


def apply(template, html: str, receipt: dict, store: dict | None, currency: str, *, barcode_url: str | None = None) -> str:
    """The outer email with the receipt in its slot. Custom HTML layouts go in as they are, with their Item Row repeated
    at {{receipt_items}} (their other tags are filled by the renderer afterwards). Without a slot the outer design is used
    as it is: its {{receipt_body}} still works. A library layout the template picked is read the same way (receipt_payload)."""
    if not has_slot(html):
        return html
    layout = layout_for(template)
    if layout.get("layout_preset") == "CUSTOM_HTML" and layout.get("custom_html"):
        css = layout.get("custom_css") or ""
        body = layout["custom_html"]
        if layout.get("item_row") and RECEIPT_ITEMS.search(body):
            rows = item_rows(layout["item_row"], transaction_from(receipt, store, currency))
            body = RECEIPT_ITEMS.sub(lambda _: rows, body)
        return inject(html, (f"<style>{css}</style>" if css else "") + body)
    transaction = transaction_from(receipt, store, currency)
    if barcode_url is None and transaction["receipt_id"] and barcode.valid(transaction["receipt_id"]):
        barcode_url = barcode.url(transaction["receipt_id"])
    register = clean_register_settings(layout.get("register"))[0] if layout.get("layout_preset") == REGISTER_PRESET else None
    if register is not None and folds(register):
        html = with_head_style(html, FOLD_RULE)
    return inject(html, render(layout.get("sections") or [], transaction, barcode_url, layout.get("layout_preset"), register))
