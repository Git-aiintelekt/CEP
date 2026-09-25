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
                      "amount": amount if amount is not None else quantity * unit})
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
    return {
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


def render(sections: list[dict], transaction: dict, barcode_url: str | None = None) -> str:
    """The receipt, ready for the slot: the hide-on-phones rule, then one centred 600px table, a hairline between
    sections and a dashed one above Totals."""
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
    """The outer email with the receipt in its slot. Custom HTML layouts go in as they are (their own tags are filled
    by the renderer afterwards). Without a slot the outer design is used as it is: its {{receipt_body}} still works."""
    if not has_slot(html):
        return html
    layout = layout_for(template)
    if layout.get("layout_preset") == "CUSTOM_HTML" and layout.get("custom_html"):
        css = layout.get("custom_css") or ""
        return inject(html, (f"<style>{css}</style>" if css else "") + layout["custom_html"])
    transaction = transaction_from(receipt, store, currency)
    if barcode_url is None and transaction["receipt_id"] and barcode.valid(transaction["receipt_id"]):
        barcode_url = barcode.url(transaction["receipt_id"])
    return inject(html, render(layout.get("sections") or [], transaction, barcode_url))
