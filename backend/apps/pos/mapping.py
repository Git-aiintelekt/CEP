"""From a read TTDR transaction to what the e-receipt engine wants: the receipt dictionary the receipt layout renders, the
STORE and TRANSACTION tag sources, the recipient, and which e-receipt campaign carries it (tenant.settings["pos"])."""
from __future__ import annotations

from apps.delivery.engine.receipts import ReceiptRefused, money as mapping_money

KEY = "pos"
TENDER_WORDS = {"DEBIT": "Debit", "CREDIT": "Credit", "CASH": "Cash", "CHECK": "Check", "GIFT": "Gift card", "GIFTCARD": "Gift card", "STORECREDIT": "Store credit",
                "STORE": "Store account", "COUPON": "Coupon", "LOYALTY": "Loyalty points", "STOREDVALUE": "Stored value", "APPLEPAY": "Apple Pay", "GOOGLEPAY": "Google Pay",
                "PAYPAL": "PayPal", "MOBILE": "Mobile payment", "VOUCHER": "Voucher", "NONE": ""}
REFUNDS = ("Return", "Void")                               # the money went back to the customer: amounts read as negatives, the tender as a refund


def settings_of(tenant) -> dict:
    stored = (tenant.settings or {}).get(KEY) or {}
    return {"campaign": stored.get("campaign") or None, "return_campaign": stored.get("return_campaign") or None, "text_campaign": stored.get("text_campaign") or None,
            "default_country": stored.get("default_country") or "US"}


def save_settings(tenant, data: dict) -> dict:
    current = settings_of(tenant)
    for key in ("campaign", "return_campaign", "text_campaign"):
        if key in data:
            current[key] = str(data[key]) if data[key] else None
    if "default_country" in data:
        current["default_country"] = (str(data["default_country"] or "US").strip().upper()[:2]) or "US"
    tenant.settings = {**(tenant.settings or {}), KEY: current}
    tenant.save(update_fields=["settings"])
    return current


def _live(tenant, channel_in: tuple) -> list:
    from apps.campaigns.models import Campaign
    return list(Campaign.objects.filter(tenant_id=tenant.pk, deleted_at__isnull=True, campaign_type="E_RECEIPT", channel__in=channel_in,
                                        status__in=("PRODUCTION_PUBLISHED", "ACTIVE")).order_by("created_at")[:2])


def campaign_for(tenant, read: dict):
    """The email campaign the receipt goes out on: the workspace's choice, else its one published e-receipt email campaign."""
    chosen = settings_of(tenant)
    category = read["transaction"]["category"]
    reference = (chosen["return_campaign"] if category in ("Return", "Exchange") else None) or chosen["campaign"]
    if reference:
        return reference
    live = _live(tenant, ("EMAIL", "MULTI"))
    if len(live) == 1:
        return str(live[0].pk)
    if not live:
        raise ReceiptRefused("No e-receipt campaign is published. Publish one, or choose it under Settings, POS Receipts.", "campaign", 409)
    raise ReceiptRefused("More than one e-receipt campaign is published: choose the one for the point of sale under Settings, POS Receipts.", "campaign", 409)


def text_campaign_for(tenant):
    """The text campaign (an e-receipt campaign on the SMS channel) for EntryType SMS: the choice, else the one published; None when there is none."""
    chosen = settings_of(tenant)["text_campaign"]
    if chosen:
        return chosen
    live = _live(tenant, ("SMS",))
    return str(live[0].pk) if len(live) == 1 else None


def e164(phone: str, country: str = "US") -> str | None:
    """A phone number as the text engines want it: +14249440599. Ten digits are read as North American when the default country is US or CA."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if not digits:
        return None
    if (phone or "").strip().startswith("+") and 8 <= len(digits) <= 15:
        return "+" + digits
    if len(digits) == 10 and country.upper() in ("US", "CA"):
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1") and country.upper() in ("US", "CA"):
        return "+" + digits
    return "+" + digits if 8 <= len(digits) <= 15 else None


def tender_words(tenders: list[dict], refund: bool = False) -> str:
    parts = []
    for tender in tenders:
        if tender.get("voided"):
            continue
        key = (tender.get("method") or tender.get("type") or "").upper().replace("-", "").replace(" ", "")
        word = TENDER_WORDS.get(key) or TENDER_WORDS.get(key.split("-")[0] if "-" in (tender.get("type") or "") else key) or \
            TENDER_WORDS.get((tender.get("type") or "").upper().split("-")[0]) or (tender.get("method") or tender.get("type") or "").replace("-", " ").title()
        if not word:
            continue
        last4 = tender.get("last4")
        text = f"{word} ···{last4}" if last4 and word not in ("Cash", "Check", "Coupon", "Loyalty points") else word
        parts.append(f"Refund to {text[0].lower() + text[1:]}" if refund else text)
    return ", ".join(part for part in parts if part)


def _signed(value, refund: bool):
    return -abs(value) if refund and value is not None else value


def receipt_of(read: dict) -> dict:
    """The receipt dictionary receipts.send() takes: the keys the receipt layout and the RECEIPT tags read. A return or a void
    reads as a refund — every amount negative, the tender 'Refund to …'; on an exchange only the lines that came back are negative."""
    t, totals = read["transaction"], read["totals"]
    refund = t["category"] in REFUNDS
    items = []
    for item in read["items"]:
        if item.get("voided"):
            continue
        back = refund or item.get("returned")
        items.append({"description": item["description"] or item["sku"], "sku": item["sku"], "quantity": -abs(item["quantity"]) if back else item["quantity"],
                      "unit_price": item["unit_price"], "total": _signed(item["total"], back), "discount": item["discount"], "tax": _signed(item["tax"], back),
                      "upc": item["upc"], "color": item["color"], "size": item["size"], "status": item["status"], "returned": bool(back), "gift_receipt": item.get("gift_receipt", False),
                      "promo_codes": item.get("promo_codes") or []})
    codes = [d["code"] for d in read.get("discounts") or [] if d.get("code")] + [code for item in read["items"] for code in (item.get("promo_codes") or [])]
    receipt = {
        "number": t["id"], "order_number": t["id"], "transaction_at": t["at"].isoformat(sep=" ") if t["at"] else t["date"], "currency": t["currency"],
        "subtotal": _signed(totals["subtotal"], refund), "discount_total": totals["discount_total"], "tax_total": _signed(totals["tax_total"], refund),
        "grand_total": _signed(totals["grand_total"], refund), "shipping_total": totals.get("shipping_total"), "change_due": totals["change_due"],
        "amount_paid": _signed(round(sum(x["amount"] or 0 for x in read["tenders"] if not x.get("voided")), 2), refund) if read["tenders"] else None,
        "tender_summary": tender_words(read["tenders"], refund), "items": items, "item_count": t["items_sold"] if t["items_sold"] is not None else sum(abs(i["quantity"]) for i in items),
        "items_returned": t.get("items_returned"), "taxes": read["taxes"], "category": t["category"], "kind": t["category"], "refund": refund,
        "original_number": t["original_id"], "store_number": t["store_number"], "register": t["register_number"], "clerk": t["clerk_name"] or t["clerk_id"],
        "barcode_value": t["barcode_value"], "coupon_barcode_value": t["barcode_value"], "discount_code": ", ".join(dict.fromkeys(codes)),
        "discounts": read.get("discounts") or [], "employee_sale": t.get("employee_sale", False), "tax_exempt": t.get("tax_exempt", False),
    }
    if read["loyalty"]:
        receipt["loyalty"] = read["loyalty"]
    return receipt


def transaction_tags(read: dict) -> dict:
    """The TRANSACTION source: what the Transaction and Customer tags of an e-receipt read, from the document alone."""
    t, r, totals = read["transaction"], read["recipient"], read["totals"]
    full_name = " ".join(part for part in (r.get("first_name"), r.get("last_name")) if part)
    address = r.get("address") or {}
    refund = t["category"] in REFUNDS
    return {
        "id": t["id"], "original_id": t["original_id"], "category": t["category"], "type": t["type"], "date": t["date"], "time": t["time"], "at": t["at"],
        "refund": refund, "employee_sale": t.get("employee_sale", False), "tax_exempt": t.get("tax_exempt", False),
        "merchant_number": t["merchant_number"], "store_number": t["store_number"], "register_number": t["register_number"], "terminal_id": t["terminal_id"],
        "clerk_id": t["clerk_id"], "clerk_name": t["clerk_name"], "currency": t["currency"], "item_count": t["items_sold"], "items_returned": t["items_returned"],
        "barcode_value": t["barcode_value"], "barcode_type": t["barcode_type"], "layaway_number": t["layaway_number"], "layaway_balance_due": t["layaway_balance_due"],
        "subtotal": _signed(totals["subtotal"], refund), "discount_total": totals["discount_total"], "tax_total": _signed(totals["tax_total"], refund),
        "grand_total": _signed(totals["grand_total"], refund), "shipping_total": totals.get("shipping_total"), "cash_back": totals.get("cash_back"),
        "discount_codes": ", ".join(dict.fromkeys([d["code"] for d in read.get("discounts") or [] if d.get("code")] + [c for i in read["items"] for c in (i.get("promo_codes") or [])])),
        "discount_words": "; ".join(f"{d['description']} {mapping_money(d['amount'], t['currency'])}".strip() for d in read.get("discounts") or [] if d.get("description") or d.get("amount")),
        "tender_summary": tender_words(read["tenders"], refund),
        "customer": {"id": r.get("customer_id", ""), "first_name": r.get("first_name", ""), "last_name": r.get("last_name", ""), "full_name": full_name,
                     "email": r.get("email", ""), "phone": r.get("phone", ""), "birthday": r.get("birthday", ""), "loyalty_card": r.get("loyalty_card", ""),
                     "loyalty_level": r.get("loyalty_level", ""), "language": r.get("language", ""),
                     "full_address": ", ".join(part for part in (address.get("line1"), address.get("line2"), address.get("city"), address.get("state"), address.get("postal_code")) if part)},
        "loyalty": read["loyalty"],
    }


def store_tags(tenant_id, read: dict) -> dict:
    """The STORE source: the workspace's store row for the number, with whatever the document itself says on top."""
    from .models import Store
    number = read["transaction"]["store_number"]
    row = Store.objects.filter(tenant_id=tenant_id, store_number=number, is_active=True).first() if number else None
    base = row.as_tags() if row else {"id": number, "number": number, "name": f"Store {number}" if number else ""}
    given = read.get("store") or {}
    overlay = {"address": given.get("address1"), "address1": given.get("address1"), "address2": given.get("address2"), "city": given.get("city"), "state": given.get("state"),
               "postal_code": given.get("postal_code"), "country": given.get("country"), "phone": given.get("phone"), "email": given.get("email")}
    return {**base, **{key: value for key, value in overlay.items() if value}}
