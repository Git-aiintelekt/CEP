"""From a read TTDR transaction to what the e-receipt engine wants: the receipt dictionary the receipt layout renders, the
STORE and TRANSACTION tag sources, the recipient, and which e-receipt campaign carries it (tenant.settings["pos"])."""
from __future__ import annotations

from apps.delivery.engine.receipts import ReceiptRefused

KEY = "pos"
TENDER_WORDS = {"DEBIT": "Debit", "CREDIT": "Credit", "CASH": "Cash", "CHECK": "Check", "GIFT": "Gift card", "GIFTCARD": "Gift card", "STORECREDIT": "Store credit"}


def settings_of(tenant) -> dict:
    stored = (tenant.settings or {}).get(KEY) or {}
    return {"campaign": stored.get("campaign") or None, "return_campaign": stored.get("return_campaign") or None}


def save_settings(tenant, data: dict) -> dict:
    current = settings_of(tenant)
    for key in ("campaign", "return_campaign"):
        if key in data:
            current[key] = str(data[key]) if data[key] else None
    tenant.settings = {**(tenant.settings or {}), KEY: current}
    tenant.save(update_fields=["settings"])
    return current


def campaign_for(tenant, read: dict):
    """The campaign reference the receipt goes out on: the workspace's choice, else its one published e-receipt campaign."""
    from apps.campaigns.models import Campaign
    chosen = settings_of(tenant)
    category = read["transaction"]["category"]
    reference = (chosen["return_campaign"] if category in ("Return", "Exchange") else None) or chosen["campaign"]
    if reference:
        return reference
    live = list(Campaign.objects.filter(tenant_id=tenant.pk, deleted_at__isnull=True, campaign_type="E_RECEIPT", status__in=("PRODUCTION_PUBLISHED", "ACTIVE")).order_by("created_at")[:2])
    if len(live) == 1:
        return str(live[0].pk)
    if not live:
        raise ReceiptRefused("No e-receipt campaign is published. Publish one, or choose it under Settings, POS Receipts.", "campaign", 409)
    raise ReceiptRefused("More than one e-receipt campaign is published: choose the one for the point of sale under Settings, POS Receipts.", "campaign", 409)


def tender_words(tenders: list[dict]) -> str:
    parts = []
    for tender in tenders:
        word = TENDER_WORDS.get((tender.get("method") or tender.get("type") or "").upper().split("-")[0], (tender.get("method") or tender.get("type") or "").title())
        last4 = tender.get("last4")
        parts.append(f"{word} ···{last4}" if last4 and word not in ("Cash", "Check") else word)
    return ", ".join(part for part in parts if part)


def receipt_of(read: dict) -> dict:
    """The receipt dictionary receipts.send() takes: the keys the receipt layout and the RECEIPT tags read."""
    t, totals = read["transaction"], read["totals"]
    items = [{"description": item["description"] or item["sku"], "sku": item["sku"], "quantity": item["quantity"], "unit_price": item["unit_price"], "total": item["total"],
              "discount": item["discount"], "tax": item["tax"], "upc": item["upc"], "color": item["color"], "size": item["size"], "status": item["status"]}
             for item in read["items"]]
    receipt = {
        "number": t["id"], "order_number": t["id"], "transaction_at": t["at"].isoformat(sep=" ") if t["at"] else t["date"], "currency": t["currency"],
        "subtotal": totals["subtotal"], "discount_total": totals["discount_total"], "tax_total": totals["tax_total"], "grand_total": totals["grand_total"],
        "change_due": totals["change_due"], "amount_paid": round(sum(x["amount"] or 0 for x in read["tenders"]), 2) if read["tenders"] else None,
        "tender_summary": tender_words(read["tenders"]), "items": items, "item_count": t["items_sold"] if t["items_sold"] is not None else sum(i["quantity"] for i in items),
        "taxes": read["taxes"], "category": t["category"], "store_number": t["store_number"], "register": t["register_number"], "clerk": t["clerk_name"] or t["clerk_id"],
        "barcode_value": t["barcode_value"], "coupon_barcode_value": t["barcode_value"],
    }
    if read["loyalty"]:
        receipt["loyalty"] = read["loyalty"]
    return receipt


def transaction_tags(read: dict) -> dict:
    """The TRANSACTION source: what the Transaction and Customer tags of an e-receipt read, from the document alone."""
    t, r, totals = read["transaction"], read["recipient"], read["totals"]
    full_name = " ".join(part for part in (r.get("first_name"), r.get("last_name")) if part)
    address = r.get("address") or {}
    return {
        "id": t["id"], "original_id": t["original_id"], "category": t["category"], "type": t["type"], "date": t["date"], "time": t["time"], "at": t["at"],
        "merchant_number": t["merchant_number"], "store_number": t["store_number"], "register_number": t["register_number"], "terminal_id": t["terminal_id"],
        "clerk_id": t["clerk_id"], "clerk_name": t["clerk_name"], "currency": t["currency"], "item_count": t["items_sold"], "items_returned": t["items_returned"],
        "barcode_value": t["barcode_value"], "barcode_type": t["barcode_type"], "layaway_number": t["layaway_number"], "layaway_balance_due": t["layaway_balance_due"],
        "subtotal": totals["subtotal"], "discount_total": totals["discount_total"], "tax_total": totals["tax_total"], "grand_total": totals["grand_total"],
        "tender_summary": tender_words(read["tenders"]),
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
