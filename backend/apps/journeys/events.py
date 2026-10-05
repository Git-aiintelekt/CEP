"""Journey events: what happened to a customer, from the shop, the loyalty system or CEP itself.

    clean / ingest    POST /events/ (an API key with events:ingest): checked, the customer found, one event kept once
    emit              CEP's own events (a purchase from the orders it receives, a coupon a journey asked for, a tier a journey
                      set, a preference-centre save), same table
    raise_no_response NO_RESPONSE for lapsed engagers, raised by the enrollment pass when a live journey starts from it
    summary / recent  what Settings → Events shows

An event names its customer by party_id, or by an email address or phone number that is matched against customer_master.
A journey whose entry rule is "Event: X" enrolls customers with X events since it went live (apps.journeys.engine.enroll);
a Condition step can check for an event since the customer entered. Email opens and clicks, and text replies, need no
event: CEP reads them from its own tracking (EMAIL_ENGAGEMENT, SMS_RESPONSE in the enrollment engine).
"""
import json
import logging
import re
from datetime import timedelta, timezone as dt_timezone

from django.db import DatabaseError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.delivery.engine import session

log = logging.getLogger("cep.journeys")

KNOWN = {
    "CUSTOMER_CREATED": "Customer Creation", "WELCOME": "Welcome", "BIRTHDAY": "Birthday", "ANNIVERSARY": "Anniversary",
    "PURCHASE": "Purchase", "FIRST_PURCHASE": "First Purchase", "CATEGORY_PURCHASE": "Category Purchase", "CART_ABANDON": "Abandoned Cart",
    "COUPON_ISSUED": "Coupon Issue", "COUPON_REDEEMED": "Coupon Redemption", "SEGMENT_INCEPTION": "Segment Inception",
    "SEGMENT_CHANGE": "Segment Change", "LOYALTY_TIER_CHANGE": "Loyalty Tier Change", "EMAIL_ENGAGEMENT": "Email Open/Click",
    "SMS_RESPONSE": "SMS Response", "NO_RESPONSE": "No Response", "PREFERENCE_UPDATE": "Preference Update", "ADDRESS_CHANGE": "Address Change",
}
FROM_TRACKING = ("EMAIL_ENGAGEMENT", "SMS_RESPONSE")      # CEP sees these itself; a sender may still send them
TYPE = re.compile(r"^[A-Z][A-Z0-9_]{1,59}$")
SOURCE = re.compile(r"^[A-Z][A-Z0-9_]{1,39}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_PAYLOAD = 8000
MAX_BATCH = 500


def label(event_type: str) -> str:
    return KNOWN.get(event_type) or event_type.replace("_", " ").title()


# ---------------------------------------------------------------------------------------------------- checking
def clean(raw) -> tuple[dict | None, dict]:
    """One event from a sender, checked. Returns (event, {}) or (None, {field: message})."""
    if not isinstance(raw, dict):
        return None, {"event": "Each event is an object."}
    errors: dict = {}
    event_type = str(raw.get("event_type") or raw.get("type") or "").strip().upper()
    if not TYPE.match(event_type):
        errors["event_type"] = "Required: capital letters, digits and underscores, for example PURCHASE or CART_ABANDON."
    source = str(raw.get("source") or "API").strip().upper()
    if not SOURCE.match(source):
        errors["source"] = "Capital letters, digits and underscores, for example COMMERCE or LOYALTY."
    event_id = str(raw.get("event_id") or "").strip() or None
    if event_id and len(event_id) > 120:
        errors["event_id"] = "At most 120 characters."
    party_id = str(raw.get("party_id") or raw.get("customer_id") or "").strip() or None
    email = str(raw.get("email") or "").strip().lower() or None
    phone = re.sub(r"[^\d+]", "", str(raw.get("phone") or "")) or None
    if party_id and len(party_id) > 60:
        errors["party_id"] = "At most 60 characters."
    if email and not EMAIL.match(email):
        errors["email"] = "Not an email address."
    if not (party_id or email or phone):
        errors["customer"] = "Name the customer: party_id, email or phone."
    now = timezone.now()
    when = raw.get("occurred_at")
    occurred_at = now
    if when not in (None, ""):
        parsed = parse_datetime(str(when)) if isinstance(when, str) else None
        if parsed is None:
            errors["occurred_at"] = "An ISO 8601 date and time, for example 2026-10-06T09:30:00Z."
        else:
            occurred_at = parsed if not timezone.is_naive(parsed) else parsed.replace(tzinfo=dt_timezone.utc)
            if occurred_at > now + timedelta(days=1):
                errors["occurred_at"] = "Cannot be in the future."
            elif occurred_at < now - timedelta(days=400):
                errors["occurred_at"] = "Older than 400 days."
    payload = raw.get("payload") or {}
    if not isinstance(payload, dict):
        errors["payload"] = "An object of the event's details, for example {\"cart_value\": 84.5}."
        payload = {}
    elif len(json.dumps(payload, default=str)) > MAX_PAYLOAD:
        errors["payload"] = f"At most {MAX_PAYLOAD:,} characters."
    if errors:
        return None, errors
    return {"event_type": event_type, "source": source, "event_id": event_id, "party_id": party_id, "email": email, "phone": phone,
            "occurred_at": occurred_at, "payload": payload}, {}


# ---------------------------------------------------------------------------------------------------- the customer
def find_party(cursor, tenant_id, *, party_id=None, email=None, phone=None) -> str | None:
    """The customer behind an event: party_id as given (the sender knows its customers; one not synced yet enters journeys
    once customer_master has them), else the one whose email address or phone number (last ten digits) matches."""
    tenant_id = str(tenant_id)
    if party_id:
        return party_id
    if email:
        cursor.execute("""SELECT party_id FROM customer_master WHERE tenant_id = %s
                             AND (emails @> jsonb_build_array(jsonb_build_object('address', %s::text))
                                  OR EXISTS (SELECT 1 FROM jsonb_array_elements(emails) e WHERE lower(e ->> 'address') = %s))
                           LIMIT 1""", [tenant_id, email, email])
        row = cursor.fetchone()
        if row:
            return row[0]
    if phone:
        digits = re.sub(r"\D", "", phone)[-10:]
        if len(digits) >= 7:
            cursor.execute("""SELECT party_id FROM customer_master WHERE tenant_id = %s AND EXISTS (
                                  SELECT 1 FROM jsonb_array_elements(phones) p WHERE right(regexp_replace(p ->> 'number', '\\D', '', 'g'), 10) = %s)
                               LIMIT 1""", [tenant_id, digits])
            row = cursor.fetchone()
            if row:
                return row[0]
    return None


# ---------------------------------------------------------------------------------------------------- saving
# Setup's "Attribute Change" triggers (SEGMENT_CHANGE {change_trigger}) enter on these events. CEP raises the first two
# itself (the Update Loyalty Tier step, the preference centre); C360 or the loyalty system sends the others to POST /events/.
ATTRIBUTE_EVENTS = {"LOYALTY_TIER": "LOYALTY_TIER_CHANGE", "PREFERENCE_UPDATE": "PREFERENCE_UPDATE", "ADDRESS_CHANGE": "ADDRESS_CHANGE"}

# No Response: at least NO_RESPONSE_SENDS marketing emails delivered in NO_RESPONSE_DAYS, and no open or click (scanners left
# out) and no text reply in that time. One event per customer per NO_RESPONSE_DAYS.
NO_RESPONSE_DAYS, NO_RESPONSE_SENDS, NO_RESPONSE_PER_PASS = 30, 3, 5000
NO_RESPONSE_SQL = """
SELECT s.party_id, s.sent FROM (
    SELECT me.party_id, count(*) AS sent FROM mailer_execution me
      JOIN campaign c ON c.id = me.campaign_id
     WHERE me.tenant_id = %(tenant)s AND me.party_id IS NOT NULL AND me.status IN ('DELIVERED', 'OPENED', 'CLICKED')
       AND COALESCE(me.delivered_at, me.submitted_at, me.created_at) >= %(since)s
       AND c.solicitation_type = 'MARKETING' AND c.campaign_type <> 'E_RECEIPT'
     GROUP BY me.party_id HAVING count(*) >= %(sends)s
) s
 WHERE NOT EXISTS (SELECT 1 FROM tracking_event t WHERE t.tenant_id = %(tenant)s AND t.party_id = s.party_id
                      AND t.event_type IN ('OPEN', 'CLICK') AND NOT t.is_bot AND t.occurred_at >= %(since)s)
   AND NOT EXISTS (SELECT 1 FROM sms_execution x WHERE x.tenant_id = %(tenant)s AND x.party_id = s.party_id AND x.responded_at >= %(since)s)
   AND NOT EXISTS (SELECT 1 FROM journey_event e WHERE e.tenant_id = %(tenant)s AND e.party_id = s.party_id
                      AND e.event_type = 'NO_RESPONSE' AND e.occurred_at >= %(since)s)
 LIMIT %(limit)s"""

INSERT = """INSERT INTO journey_event (tenant_id, party_id, event_type, event_source, event_payload, occurred_at, external_id)
            VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)
            ON CONFLICT (tenant_id, event_source, external_id, occurred_at) WHERE external_id IS NOT NULL DO NOTHING
            RETURNING id"""


def _insert(cursor, tenant_id, party_id, event: dict) -> str:
    """ACCEPTED, DUPLICATE or NO_MONTH (no partition for that date). In a savepoint, so one bad row never spoils the rest."""
    try:
        with transaction.atomic(using=cursor.db.alias):
            cursor.execute(INSERT, [str(tenant_id), party_id, event["event_type"], event["source"], json.dumps(event["payload"], default=str),
                                    event["occurred_at"], event["event_id"]])
            return "ACCEPTED" if cursor.fetchone() else "DUPLICATE"
    except DatabaseError as exc:
        if "no partition" in str(exc):
            return "NO_MONTH"
        raise


def ingest(tenant_id, events: list[dict]) -> list[dict]:
    """Stores cleaned events. Must run inside session.tenant_scope(tenant_id)."""
    out = []
    with session.tx(), session.connection().cursor() as cursor:
        for event in events:
            party = find_party(cursor, tenant_id, party_id=event["party_id"], email=event["email"], phone=event["phone"])
            if party is None:
                out.append({"event_id": event["event_id"], "status": "REJECTED", "errors": {"customer": "No customer has this email address or phone number."}})
                continue
            status = _insert(cursor, tenant_id, party, event)
            if status == "NO_MONTH":
                out.append({"event_id": event["event_id"], "status": "REJECTED", "errors": {"occurred_at": "Too far back: that month is no longer kept."}})
            else:
                out.append({"event_id": event["event_id"], "status": status, "party_id": party})
    return out


def raise_no_response(tenant_id) -> int:
    """Must run inside session.tenant_scope(tenant_id) and a transaction. Returns how many NO_RESPONSE events it raised."""
    now = timezone.now()
    since = now - timedelta(days=NO_RESPONSE_DAYS)
    raised = 0
    with session.connection().cursor() as cursor:
        cursor.execute(NO_RESPONSE_SQL, {"tenant": str(tenant_id), "since": since, "sends": NO_RESPONSE_SENDS, "limit": NO_RESPONSE_PER_PASS})
        for party_id, sent in cursor.fetchall():
            status = _insert(cursor, tenant_id, party_id, {"event_type": "NO_RESPONSE", "source": "CEP", "occurred_at": now,
                                                           "payload": {"emails_without_response": sent, "days": NO_RESPONSE_DAYS},
                                                           "event_id": f"no-response:{party_id}:{now:%Y-%m-%d}"})
            raised += status == "ACCEPTED"
    return raised


def emit(tenant_id, party_id: str, event_type: str, *, source: str, payload: dict | None = None, occurred_at=None, external_id: str | None = None) -> bool:
    """CEP's own event, on the caller's tenant connection and transaction (a savepoint). Never raises into the caller's work."""
    if not party_id:
        return False
    try:
        with session.connection().cursor() as cursor:
            status = _insert(cursor, tenant_id, party_id, {"event_type": event_type, "source": source, "payload": payload or {},
                                                            "occurred_at": occurred_at or timezone.now(), "event_id": external_id})
        return status == "ACCEPTED"
    except Exception as exc:                               # noqa: BLE001  an event is never worth a failed order or step
        log.warning("event %s for %s not recorded: %s", event_type, party_id, exc)
        return False


def emit_purchase(cursor, tenant_id, order: dict, *, source: str, order_source: str) -> None:
    """A purchase CEP received as an order (POST /orders/, or a store sale when attribution counts them): PURCHASE, and
    FIRST_PURCHASE when the customer has no earlier order or purchase. Only for workspaces with journeys, only for a known customer."""
    from apps.platform_ops import params
    if order.get("kind") != "ORDER" or not params.enabled(str(tenant_id), "journeys"):
        return
    party = find_party(cursor, tenant_id, party_id=order.get("party_id"), email=order.get("email"), phone=order.get("phone"))
    if party is None:
        return
    payload = {"order_id": order.get("match_ref"), "amount": float(order["amount"]), "currency": order.get("currency"), "channel": order.get("channel"),
               "store_number": order.get("store_number"), "coupon_codes": order.get("coupon_codes") or []}
    reference = f"order:{order_source}:{order.get('order_ref')}"
    cursor.execute("""SELECT EXISTS (SELECT 1 FROM attributed_order WHERE tenant_id = %s AND kind = 'ORDER' AND ordered_at < %s
                                        AND (party_id = %s OR touch_party_id = %s))
                          OR EXISTS (SELECT 1 FROM journey_event WHERE tenant_id = %s AND party_id = %s AND event_type IN ('PURCHASE', 'FIRST_PURCHASE')
                                        AND occurred_at < %s)""",
                   [str(tenant_id), order["ordered_at"], party, party, str(tenant_id), party, order["ordered_at"]])
    bought_before = cursor.fetchone()[0]
    emit(tenant_id, party, "PURCHASE", source=source, payload=payload, occurred_at=order["ordered_at"], external_id=reference)
    if not bought_before:
        emit(tenant_id, party, "FIRST_PURCHASE", source=source, payload=payload, occurred_at=order["ordered_at"], external_id=reference + ":first")


# ---------------------------------------------------------------------------------------------------- what Settings shows
def summary(tenant_id, days: int = 7) -> dict:
    tenant_id = str(tenant_id)
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""SELECT event_type, count(*), max(ingested_at) FROM journey_event WHERE tenant_id = %s AND ingested_at > now() - make_interval(days => %s)
                           GROUP BY 1 ORDER BY 2 DESC""", [tenant_id, days])
        types = [{"event_type": t, "label": label(t), "count": int(n), "last_received_at": last} for t, n, last in cursor.fetchall()]
        cursor.execute("SELECT max(ingested_at) FROM journey_event WHERE tenant_id = %s", [tenant_id])
        last = cursor.fetchone()[0]
        cursor.execute("""SELECT count(*) FROM journey_event e WHERE e.tenant_id = %s AND e.ingested_at > now() - make_interval(days => %s)
                             AND NOT EXISTS (SELECT 1 FROM customer_master c WHERE c.tenant_id = e.tenant_id AND c.party_id = e.party_id)""", [tenant_id, days])
        unknown = cursor.fetchone()[0]
    return {"days": days, "total": sum(t["count"] for t in types), "by_type": types, "last_received_at": last, "unknown_customers": int(unknown)}


def recent(tenant_id, *, event_type: str | None = None, q: str = "", limit: int = 50) -> list[dict]:
    tenant_id = str(tenant_id)
    where, args = ["e.tenant_id = %s"], [tenant_id]
    if event_type:
        where.append("e.event_type = %s")
        args.append(event_type.upper())
    if q:
        where.append("(e.party_id ILIKE %s OR e.external_id ILIKE %s OR e.event_source ILIKE %s)")
        args += [f"%{q}%"] * 3
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(f"""SELECT e.id, e.event_type, e.event_source, e.party_id, e.external_id, e.event_payload, e.occurred_at, e.ingested_at,
                                  (SELECT trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) FROM customer_master c
                                    WHERE c.tenant_id = e.tenant_id AND c.party_id = e.party_id) AS name
                             FROM journey_event e WHERE {' AND '.join(where)} ORDER BY e.ingested_at DESC, e.id DESC LIMIT %s""", [*args, limit])
        rows = cursor.fetchall()
    keys = ("id", "event_type", "source", "party_id", "event_id", "payload", "occurred_at", "received_at", "customer_name")
    return [{**dict(zip(keys, row)), "label": label(row[1])} for row in rows]
