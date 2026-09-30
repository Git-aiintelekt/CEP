"""A TransactionTree TTDR 3.2.2 transaction, as the point of sale posts it: validated against the vendored schema and read
into plain dictionaries. Nothing here is stored — the transaction lives only as long as the request that sends the receipt.

Amounts in a TTDR document are whole cents (8373 = 83.73) and quantities are hundredths (100 = one). A line's quantity is
taken from its own arithmetic (extended amount over unit amount) so a register that sends plain units reads right too.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time
from pathlib import Path

from lxml import etree

NS = "https://www.transactiontree.com/framework/schema/vrg/3.2.2/TTDR3.2.2.xsd"
SCHEMA_PATH = Path(__file__).parent / "schemas" / "TTDR-3.2.2.xsd"
MAX_BYTES = 2 * 1024 * 1024
CARD = re.compile(r"(?<!\d)(\d{6})\d{3,9}(\d{4})(?!\d)")     # a card number that slipped through unmasked
_schema = None

SALE_TYPES = {"SaleTransaction": "Sale", "ReturnTransaction": "Return", "ExchangeTransaction": "Exchange", "VoidTransaction": "Void", "LayawayTransaction": "Layaway",
              "PostVoidTransaction": "Void", "OrderTransaction": "Order"}


class TtdrError(ValueError):
    """The document cannot be read. `code` is the answer the point of sale gets (E1xx)."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def schema() -> etree.XMLSchema:
    global _schema
    if _schema is None:
        _schema = etree.XMLSchema(etree.parse(str(SCHEMA_PATH)))
    return _schema


def mask(text: str) -> str:
    """A card number written in full is masked before anything is logged; the six-and-four the POS sends stays as it is."""
    return CARD.sub(lambda m: m.group(1) + "X" * (len(m.group(0)) - 10) + m.group(2), text)


def parse(raw: bytes | str) -> dict:
    """The document -> {'transaction', 'store', 'recipient', 'items', 'tenders', 'totals', 'taxes', 'loyalty'}; raises TtdrError."""
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if not raw or not raw.strip():
        raise TtdrError("E101", "The request carries no XML.")
    if len(raw) > MAX_BYTES:
        raise TtdrError("E104", f"The document is larger than {MAX_BYTES // 1024} KB.")
    try:
        parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)
        doc = etree.fromstring(raw, parser)
    except etree.XMLSyntaxError as exc:
        raise TtdrError("E102", f"The XML is not well formed: {exc}") from None
    if etree.QName(doc).localname != "Transaction" or etree.QName(doc).namespace != NS:
        raise TtdrError("E103", "The root element must be <Transaction> in the TTDR 3.2.2 namespace.")
    if not schema().validate(doc):
        error = schema().error_log.last_error
        raise TtdrError("E103", f"The document does not follow TTDR 3.2.2: line {error.line}: {error.message}")
    return _read(doc)


# ------------------------------------------------------------------------------------------------------------ reading
def _t(node, path: str) -> str:
    found = node.find("/".join(f"{{{NS}}}{part}" for part in path.split("/")))
    return (found.text or "").strip() if found is not None and found.text else ""


def _all(node, path: str):
    return node.findall("/".join(f"{{{NS}}}{part}" for part in path.split("/")))


def _cents(text: str) -> float | None:
    try:
        return int(text) / 100
    except (TypeError, ValueError):
        return None


def _number(text: str) -> float | None:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _when(node) -> datetime | None:
    day, clock = _t(node, "TransactionDateTime/TransactionDate"), _t(node, "TransactionDateTime/TransactionTime")
    try:
        the_date = date.fromisoformat(day)
    except ValueError:
        return None
    try:
        the_time = time.fromisoformat(clock[:8]) if clock else time(0, 0)
    except ValueError:
        the_time = time(0, 0)
    return datetime.combine(the_date, the_time)


def _read(doc) -> dict:
    location = doc.find(f"{{{NS}}}TransactionLocation")
    associate = doc.find(f"{{{NS}}}TransactionAssociate")
    data = doc.find(f"{{{NS}}}TransactionData")
    settings = data.find(f"{{{NS}}}TransactionSettings") if data is not None else None
    kind = _t(doc, "TransactionType")
    transaction = {
        "id": _t(doc, "TransId"), "original_id": _t(doc, "OriginalTransId"), "type": kind, "category": SALE_TYPES.get(kind, kind.replace("Transaction", "") or "Sale"),
        "merchant_number": _t(doc, "MerchantNumber"), "application": _t(doc, "ApplicationID"), "entry_type": _t(doc, "EntryType"),
        "historical": _t(doc, "TransactionHistory").upper() == "Y", "at": _when(doc), "date": _t(doc, "TransactionDateTime/TransactionDate"),
        "time": _t(doc, "TransactionDateTime/TransactionTime"),
        "store_number": _t(location, "StoreNumber") if location is not None else "", "register_number": _t(location, "RegisterNumber") if location is not None else "",
        "register_type": _t(location, "RegisterType") if location is not None else "", "location_type": _t(location, "LocationType") if location is not None else "",
        "clerk_id": _t(associate, "ClerkId") if associate is not None else "", "clerk_name": _t(associate, "ClerkName") if associate is not None else "",
        "clerk_role": _t(associate, "ClerkRole") if associate is not None else "",
        "currency": (_t(settings, "CurrencyType") if settings is not None else "") or "USD", "language": _t(settings, "OutputLanguage") if settings is not None else "",
        "items_sold": (_number(_t(settings, "ItemsSold")) or 0) / 100 if settings is not None and _t(settings, "ItemsSold") else None,
        "items_returned": (_number(_t(settings, "ItemsReturned")) or 0) / 100 if settings is not None and _t(settings, "ItemsReturned") else None,
        "barcode_type": _t(settings, "BarCode/BarCodeType") if settings is not None else "", "barcode_value": _t(settings, "BarCode/BarCodeValue") if settings is not None else "",
        "layaway_number": _t(doc, "LayawayData/LayawayNumber"), "layaway_balance_due": _cents(_t(doc, "LayawayData/LayawayBalanceDue")),
        "terminal_id": "",
    }
    store = {}
    if location is not None:
        store = {"number": transaction["store_number"], "address1": _t(location, "Address/Address1"), "address2": _t(location, "Address/Address2"),
                 "city": _t(location, "Address/City"), "state": _t(location, "Address/StateCode"), "postal_code": _t(location, "Address/StoreZip"),
                 "country": _t(location, "Address/CountryCode"), "phone": _t(location, "StorePhone/StorePhoneNumber"), "email": _t(location, "StoreEmailAddress")}
        store = {key: value for key, value in store.items() if value}

    recipients = [_recipient(node) for node in _all(doc, "Recipients/Recipient")]
    recipient = next((r for r in recipients if r["email"]), None) or (recipients[0] if recipients else {})

    items = [_item(node) for node in _all(data, "DetailedTransactionData")] if data is not None else []
    tenders = [_tender(node) for node in _all(data, "TenderTypeData")] if data is not None else []
    for tender in tenders:
        if tender["amount"] is not None and tender["method"] == "Debit":
            transaction["terminal_id"] = transaction["terminal_id"] or tender.get("terminal_id", "")
    totals = data.find(f"{{{NS}}}TotalsTransactionData") if data is not None else None
    summary = {
        "subtotal": _cents(_t(totals, "Totals/SubTotalAmount")) if totals is not None else None,
        "discount_total": _cents(_t(totals, "Totals/DiscountTotal")) if totals is not None else None,
        "tax_total": _cents(_t(totals, "TotalTax/TotalTaxAmount")) if totals is not None else None,
        "grand_total": _cents(_t(totals, "Totals/TotalAmount")) if totals is not None else None,
        "change_due": _cents(_t(totals, "Totals/Change")) if totals is not None else None,
        "balance": _cents(_t(totals, "Totals/Balance")) if totals is not None else None,
    }
    if summary["grand_total"] is None and settings is not None:
        summary["grand_total"] = _cents(_t(settings, "TotalAmount"))
    taxes = [{"description": _t(node, "TaxDescription"), "percent": _number(_t(node, "TaxPercent")), "amount": _cents(_t(node, "TaxAmount")),
              "taxable": _cents(_t(node, "TaxAmountTaxable"))} for node in _all(data, "FinalTaxLines")] if data is not None else []
    return {"transaction": transaction, "store": store, "recipient": recipient, "recipients": recipients, "items": items, "tenders": tenders, "totals": summary,
            "taxes": taxes, "loyalty": recipient.get("loyalty") or {}}


def _recipient(node) -> dict:
    birthday = node.find(f"{{{NS}}}Demographics/{{{NS}}}Birthday")
    loyalty = node.find(f"{{{NS}}}LoyaltySummary")
    return {
        "type": _t(node, "RecipientType"), "first_name": _t(node, "FirstName"), "last_name": _t(node, "LastName"), "middle_name": _t(node, "MiddleName"),
        "company": _t(node, "Company"), "email": _t(node, "EmailAddress").lower(), "phone": _t(node, "Phone/PhoneNumber"),
        "customer_id": _t(node, "RecipientIds/CustomerID"), "loyalty_card": _t(node, "RecipientIds/LoyaltyCardNumber"), "loyalty_level": _t(node, "RecipientIds/LoyaltyLevel"),
        "language": _t(node, "LanguageSelection"),
        "address": {key: _t(node, f"Address/{tag}") for key, tag in (("line1", "Address1"), ("line2", "Address2"), ("city", "City"), ("state", "State"), ("postal_code", "Zip"), ("country", "Country"))},
        "birthday": "-".join(part for part in (_t(birthday, "Year"), _t(birthday, "Month").zfill(2), _t(birthday, "Day").zfill(2)) if part) if birthday is not None else "",
        "loyalty": {"program": _t(loyalty, "ProgramName"), "earned": _number(_t(loyalty, "Earnings")), "balance": _number(_t(loyalty, "RewardsBalance")),
                    "next_reward": _t(loyalty, "NextReward"), "expiring": _t(loyalty, "Expiring")} if loyalty is not None else {},
    }


def _item(node) -> dict:
    unit, extended = _cents(_t(node, "Price/DollarAmount")), _cents(_t(node, "Price/ExtDollarAmount"))
    sold = _number(_t(node, "Quantity/QuantitySold"))
    if unit and extended is not None and unit > 0 and abs(extended / unit - round(extended / unit, 3)) < 0.0005:
        quantity = round(extended / unit, 3)
    else:
        quantity = (sold or 0) / 100 if sold is not None and sold >= 100 and sold % 1 == 0 else (sold or 1)
    attributes = {(_t(a, "AttributeDescription") or _t(a, "AttributeType")): _t(a, "AttributeData") for a in _all(node, "ItemAttributes/Attribute")}
    taxes = [_cents(_t(t, "TaxAmount")) or 0 for t in _all(node, "ItemTax/Tax")]
    return {
        "sku": _t(node, "ProductId"), "id_type": _t(node, "ProductIDType"), "description": _t(node, "Description"), "department": _t(node, "DepartmentCode"),
        "quantity": quantity, "unit_price": unit, "discount": _cents(_t(node, "Price/DiscountDollarAmount")), "total": extended,
        "original_price": _cents(_t(node, "Price/OrginalAmount")), "tax": round(sum(taxes), 2) if taxes else None,
        "status": _t(node, "ItemStatus/ItemReceivedType"), "upc": attributes.get("ProductUPC", ""), "color": attributes.get("Color", ""), "size": attributes.get("Size", ""),
        "style": attributes.get("ProductStyle", ""), "product_class": attributes.get("ProductClass", ""), "attributes": attributes,
    }


def _tender(node) -> dict:
    response = node.find(f"{{{NS}}}PaymentResponse")
    account = _t(node, "AccountNumber") or (_t(response, "CardNumber") if response is not None else "")
    return {
        "type": _t(node, "TenderType"), "entry": _t(node, "TenderEntryMethod"), "amount": _cents(_t(node, "TotalAmount")),
        "account": mask(account), "last4": re.sub(r"\D", "", account)[-4:] if account else "", "auth_code": _t(node, "AuthCode"),
        "method": _t(response, "PaymentMethod") if response is not None else "", "approval": _t(response, "ApprovalStatus") if response is not None else "",
        "terminal_id": _t(response, "TerminalID") if response is not None else "",
    }
