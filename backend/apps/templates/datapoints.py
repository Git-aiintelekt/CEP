"""The data points a personalization tag can read.

What each resolution source offers, as the back-office picker lists them and as a tag's source path is checked
against. Two sources take a path of the person's own: a customer attribute (`custom_attributes.<key>`) and a column
from a list upload (`custom_value_pairs.<column>`); everything else is a fixed set the renderer knows how to read
(`apps/delivery/engine/render.py`, Renderer._value).
"""
from __future__ import annotations

import re

SOURCES = {
    "CUSTOMER_MASTER": "Customer",
    "CAMPAIGN_LIST_MEMBER": "List upload",
    "CAMPAIGN": "Campaign",
    "CAMPAIGN_RUN": "Campaign run",
    "SYSTEM": "System",
    "RECEIPT": "Receipt (e-receipts)",
    "STORE": "Store (e-receipts)",
    "TRANSACTION": "Transaction (e-receipts from the point of sale)",
    "STATIC": "Static value",
}

CUSTOM_ATTRIBUTE = "custom_attributes."
UPLOAD_COLUMN = "custom_value_pairs."
_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,99}$")

# (path, label, data type). A path ending in "." is a prefix the person completes with a key of their own.
DATA_POINTS: dict[str, list[tuple[str, str, str]]] = {
    "CUSTOMER_MASTER": [
        ("party_id", "Party ID", "STRING"),
        ("first_name", "First Name", "STRING"),
        ("last_name", "Last Name", "STRING"),
        ("primary_address.line1", "Address Line 1", "STRING"),
        ("primary_address.city", "City", "STRING"),
        ("primary_address.state", "State", "STRING"),
        ("primary_address.postal_code", "Postal Code", "STRING"),
        ("primary_address.country", "Country", "STRING"),
        (CUSTOM_ATTRIBUTE, "A customer attribute (type its key)", "STRING"),
    ],
    "CAMPAIGN_LIST_MEMBER": [
        (UPLOAD_COLUMN + "coupon_code", "Coupon Code", "STRING"),
        (UPLOAD_COLUMN + "coupon_barcode_value", "Coupon Barcode Value", "STRING"),
        (UPLOAD_COLUMN + "coupon_qr_value", "Coupon QR Value", "STRING"),
        (UPLOAD_COLUMN, "A column from the upload (type its name)", "STRING"),
    ],
    "CAMPAIGN": [
        ("name", "Campaign Name", "STRING"),
        ("code", "Campaign Code", "STRING"),
        ("description", "Campaign Description", "STRING"),
    ],
    "CAMPAIGN_RUN": [
        ("run_number", "Run Number", "NUMBER"),
        ("started_at", "Run Started At", "DATE"),
        ("scheduled_at", "Run Scheduled For", "DATE"),
    ],
    "SYSTEM": [
        ("unsubscribe_url", "Unsubscribe Link", "STRING"),
        ("preference_url", "Preference Centre Link", "STRING"),
        ("current_year", "Current Year", "STRING"),
        ("today", "Today's Date", "DATE"),
        ("campaign_name", "Campaign Name", "STRING"),
        ("email", "Recipient's Address", "STRING"),
    ],
    "RECEIPT": [
        ("receipt.number", "Receipt Number", "STRING"),
        ("receipt.transaction_at", "Transaction Date", "DATE"),
        ("receipt.currency", "Currency", "STRING"),
        ("receipt.subtotal", "Subtotal", "NUMBER"),
        ("receipt.discount_total", "Discounts", "NUMBER"),
        ("receipt.tax_total", "Tax", "NUMBER"),
        ("receipt.grand_total", "Total", "NUMBER"),
        ("receipt.tender_summary", "Payment Method", "STRING"),
        ("receipt.order_number", "Order Number", "STRING"),
        ("receipt.order_url", "Order Tracking URL", "STRING"),
        ("receipt.shipping_address", "Shipping Address", "STRING"),
        ("receipt.delivery_estimate", "Delivery Estimate", "STRING"),
    ],
    "TRANSACTION": [
        ("id", "Transaction ID", "STRING"),
        ("category", "Transaction Category (Sale / Return)", "STRING"),
        ("date", "Transaction Date", "DATE"),
        ("time", "Transaction Time", "STRING"),
        ("store_number", "Store Number", "STRING"),
        ("register_number", "Register Number", "STRING"),
        ("terminal_id", "Terminal ID", "STRING"),
        ("clerk_id", "Clerk ID", "STRING"),
        ("clerk_name", "Clerk Name", "STRING"),
        ("item_count", "Item Count", "NUMBER"),
        ("barcode_value", "Receipt Barcode Value", "STRING"),
        ("layaway_number", "Layaway Number", "STRING"),
        ("layaway_balance_due", "Layaway Balance Due", "NUMBER"),
        ("currency", "Currency", "STRING"),
        ("subtotal", "Subtotal", "NUMBER"),
        ("discount_total", "Discounts", "NUMBER"),
        ("tax_total", "Tax", "NUMBER"),
        ("grand_total", "Total", "NUMBER"),
        ("tender_summary", "Payment Method", "STRING"),
        ("customer.id", "Customer ID (from the transaction)", "STRING"),
        ("customer.full_name", "Customer Full Name", "STRING"),
        ("customer.first_name", "Customer First Name", "STRING"),
        ("customer.last_name", "Customer Last Name", "STRING"),
        ("customer.email", "Customer Email Address", "STRING"),
        ("customer.phone", "Customer Phone", "STRING"),
        ("customer.birthday", "Customer Birthday", "STRING"),
        ("customer.full_address", "Customer Full Address", "STRING"),
        ("customer.loyalty_card", "Loyalty Card Number", "STRING"),
        ("customer.loyalty_level", "Loyalty Level", "STRING"),
        ("loyalty.program", "Loyalty Program", "STRING"),
        ("loyalty.earned", "Points Earned", "NUMBER"),
        ("loyalty.balance", "Points Balance", "NUMBER"),
        ("loyalty.next_reward", "Next Reward", "STRING"),
    ],
    "STORE": [
        ("name", "Store Name", "STRING"),
        ("id", "Store Number", "STRING"),
        ("brand", "Store Brand", "STRING"),
        ("address", "Store Address", "STRING"),
        ("address1", "Store Address 1", "STRING"),
        ("address2", "Store Address 2", "STRING"),
        ("city", "Store City", "STRING"),
        ("state", "Store State", "STRING"),
        ("postal_code", "Store Postal Code", "STRING"),
        ("country", "Store Country", "STRING"),
        ("district", "Store District", "STRING"),
        ("phone", "Store Phone", "STRING"),
        ("email", "Store Email", "STRING"),
        ("manager", "Store Manager", "STRING"),
        ("return_policy", "Store Return Policy", "STRING"),
        ("url1", "Store URL 1", "STRING"),
        ("url2", "Store URL 2", "STRING"),
        ("url3", "Store URL 3", "STRING"),
        ("url4", "Store URL 4", "STRING"),
        ("image_url", "Store Image URL", "STRING"),
    ],
    "STATIC": [],
}

STATIC_POINT = "STATIC|"


def point_id(source: str, path: str) -> str:
    """One value for the picker: source and path together."""
    return f"{source}|{path}"


def split_point(value: str) -> tuple[str, str]:
    source, _, path = (value or "").partition("|")
    return source, path


def choices() -> list[tuple[str, list[tuple[str, str]]]]:
    """Grouped choices for a select: every source with its data points, and Static as a value of its own."""
    grouped = []
    for source, name in SOURCES.items():
        if source == "STATIC":
            grouped.append((name, [(STATIC_POINT, "A fixed value, typed under Static value")]))
            continue
        grouped.append((name, [(point_id(source, path), label) for path, label, _ in DATA_POINTS[source]]))
    return grouped


def is_prefix(path: str) -> bool:
    return path.endswith(".")


def data_type_of(source: str, path: str) -> str | None:
    """The type a fixed data point carries; None for a typed one or an unknown path."""
    for known, _, data_type in DATA_POINTS.get(source, []):
        if known == path:
            return data_type
    return None


def problem(source: str, path: str | None, static_value: str | None) -> str | None:
    """Why this source and path cannot be read at send time; None when they can."""
    path = (path or "").strip()
    if source not in SOURCES:
        return "Choose where the value comes from."
    if source == "STATIC":
        if path:
            return "A static value has no data point: leave the path empty."
        return None if (static_value or "").strip() else "Type the static value."
    points = DATA_POINTS[source]
    if any(known == path for known, _, _ in points if not is_prefix(known)):
        return None
    for known, _, _ in points:
        if is_prefix(known) and path.startswith(known):
            return None if _KEY.match(path[len(known):]) else f"After {known} comes a key: letters, digits and underscores only."
    if source == "CUSTOMER_MASTER":
        return f"Not a customer data point. Pick one, or {CUSTOM_ATTRIBUTE}<key> for an attribute."
    if source == "CAMPAIGN_LIST_MEMBER":
        return f"Not a list data point. Use {UPLOAD_COLUMN}<column> for a column from the upload."
    return f"Not a data point {SOURCES[source]} offers."
