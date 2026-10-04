"""Attribution: which campaign earned an order, and the per-campaign figures that follow.

    settings_of / save_settings   the workspace's switch, windows and send costs (tenant.settings["attribution"])
    clean / ingest                orders and refunds from POST /orders/ (an API key with orders:ingest) or the point of sale
    attribute_pending             credits each waiting order: a campaign code, else the last click, open or text in the windows
    rollup                        writes campaign_actual: attributed revenue, orders, buyers, cost, contribution, ROI
    run                           the attribute-orders job: every workspace with attribution on
    summary / recent              what Settings → Attribution shows

The model is last touch, one campaign per order, whole amount: easy to explain and to check against the shop. A campaign
code named by the shop wins; otherwise the latest click within click_days, then the latest open within open_days (marketing
campaigns only: a receipt read on the way to the till is not a reason to buy), then the latest text within text_days. A
refund follows its original order. Orders wait a minute before they are judged, so a click that is still on its way from
the sending engine is counted. Nothing about the basket is kept: the amount, the person, the store and the codes.
"""
import re
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import connections
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.delivery.engine import session

KEY = "attribution"
DEFAULTS = {"enabled": False, "click_days": 7, "open_days": 1, "text_days": 1, "store_sales": False, "email_cost_per_1000": None, "text_cost_per_1000": None}
CLICK_DAYS = (1, 3, 7, 14, 30)
OPEN_DAYS = (0, 1, 2, 3, 7)
TEXT_DAYS = (0, 1, 2, 3, 7)
CHANNELS = ("ONLINE", "STORE", "APP", "PHONE", "OTHER")
SETTLE_SECONDS = 60
BATCH = 1000
MAX_BATCH = 500
RECENT_RUN_DAYS = 35
WAIT_FOR_ORIGINAL = timedelta(days=1)
ROI_CAP = Decimal("999999.9999")                          # the column's ceiling; a near-zero cost would overflow it
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AttributionError(Exception):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


# ---------------------------------------------------------------------------------------------------- settings
def settings_of(tenant) -> dict:
    stored = (tenant.settings or {}).get(KEY) or {}
    return {key: stored.get(key, default) for key, default in DEFAULTS.items()} | {"enabled_at": stored.get("enabled_at"), "needs_full": bool(stored.get("needs_full"))}


def _rate(value, field):
    if value in (None, ""):
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise AttributionError(field, "Enter an amount, for example 0.85.") from None
    if number < 0 or number > 100000:
        raise AttributionError(field, "Enter an amount between 0 and 100,000.")
    return float(round(number, 4))


def save_settings(tenant, data: dict) -> dict:
    current = settings_of(tenant)
    for key, choices in (("click_days", CLICK_DAYS), ("open_days", OPEN_DAYS), ("text_days", TEXT_DAYS)):
        if key in data:
            try:
                value = int(data[key])
            except (TypeError, ValueError):
                raise AttributionError(key, "Choose one of the offered windows.") from None
            if value not in choices:
                raise AttributionError(key, "Choose one of the offered windows.")
            current[key] = value
    for key in ("enabled", "store_sales"):
        if key in data:
            current[key] = bool(data[key])
    for key in ("email_cost_per_1000", "text_cost_per_1000"):
        if key in data:
            current[key] = _rate(data[key], key)
    stored = (tenant.settings or {}).get(KEY) or {}
    changed_rules = any(key in data and stored.get(key, DEFAULTS[key]) != current[key]
                        for key in ("click_days", "open_days", "text_days", "email_cost_per_1000", "text_cost_per_1000"))
    if current["enabled"] and not stored.get("enabled"):
        current["enabled_at"] = timezone.now().isoformat()
        current["needs_full"] = True                    # every campaign that ever sent gets its figures on the next pass
    elif changed_rules:
        current["needs_full"] = True
    tenant.settings = {**(tenant.settings or {}), KEY: current}
    tenant.save(update_fields=["settings"])
    return current


def _set_flag(tenant_id, needs_full: bool):
    from apps.tenants.models import Tenant
    tenant = Tenant.objects.get(pk=tenant_id)
    tenant.settings = {**(tenant.settings or {}), KEY: {**((tenant.settings or {}).get(KEY) or {}), "needs_full": needs_full}}
    tenant.save(update_fields=["settings"])


# ---------------------------------------------------------------------------------------------------- orders in
def _text(raw, limit, field, errors, required=False):
    value = "" if raw is None else str(raw).strip()
    if required and not value:
        errors[field] = "Required."
    elif len(value) > limit:
        errors[field] = f"At most {limit} characters."
    return value or None


def clean(raw, *, currency: str) -> tuple[dict | None, dict]:
    """One order from the shop, checked. Returns (order, {}) or (None, {field: message})."""
    if not isinstance(raw, dict):
        return None, {"order": "Each order is an object."}
    errors: dict = {}
    order_id = _text(raw.get("order_id"), 120, "order_id", errors, required=True)
    kind = str(raw.get("type") or "ORDER").strip().upper()
    if kind not in ("ORDER", "REFUND"):
        errors["type"] = "ORDER or REFUND."
    try:
        amount = Decimal(str(raw.get("amount")))
        if not amount.is_finite() or amount < 0 or amount >= Decimal("100000000000"):
            raise InvalidOperation
        amount = round(amount, 2)
    except (InvalidOperation, ValueError, TypeError):
        errors["amount"] = "The revenue to count, a number of 0 or more (a refund's amount is positive too)."
        amount = None
    code = str(raw.get("currency") or currency or "USD").strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", code):
        errors["currency"] = "A three-letter currency code."
    when = raw.get("ordered_at")
    now = timezone.now()
    if when in (None, ""):
        ordered_at = now
    else:
        ordered_at = parse_datetime(str(when)) if isinstance(when, str) else None
        if ordered_at is None:
            errors["ordered_at"] = "An ISO 8601 date and time, for example 2026-10-04T14:30:00Z."
        else:
            if timezone.is_naive(ordered_at):
                ordered_at = ordered_at.replace(tzinfo=dt_timezone.utc)
            if ordered_at > now + timedelta(days=1):
                errors["ordered_at"] = "Cannot be in the future."
            elif ordered_at < now - timedelta(days=400):
                errors["ordered_at"] = "Older than 400 days."
    party_id = _text(raw.get("party_id") or raw.get("customer_id"), 60, "party_id", errors)
    email = _text(raw.get("email"), 254, "email", errors)
    if email and not EMAIL.match(email):
        errors["email"] = "Not an email address."
    phone = _text(raw.get("phone"), 30, "phone", errors)
    if phone:
        phone = re.sub(r"[^\d+]", "", phone)
    channel = str(raw.get("channel") or "ONLINE").strip().upper()
    if channel not in CHANNELS:
        errors["channel"] = "ONLINE, STORE, APP, PHONE or OTHER."
    coupons = raw.get("coupon_codes") or []
    if isinstance(coupons, str):
        coupons = [coupons]
    if not isinstance(coupons, list) or len(coupons) > 20 or any(len(str(c)) > 60 for c in coupons):
        errors["coupon_codes"] = "A list of at most 20 codes of up to 60 characters."
        coupons = []
    items = raw.get("items")
    if items not in (None, ""):
        try:
            items = int(items)
            if items < 0:
                raise ValueError
        except (TypeError, ValueError):
            errors["items"] = "A whole number of 0 or more."
            items = None
    else:
        items = None
    original = _text(raw.get("original_order_id"), 120, "original_order_id", errors)
    if kind == "REFUND" and not original:
        errors["original_order_id"] = "A refund names the order it refunds."
    store = _text(raw.get("store_number"), 40, "store_number", errors)
    campaign_code = _text(raw.get("campaign_code"), 40, "campaign_code", errors)
    if errors:
        return None, errors
    return {"order_ref": order_id, "match_ref": order_id, "kind": kind, "original_ref": original, "party_id": party_id, "email": email.lower() if email else None,
            "phone": phone or None, "amount": -amount if kind == "REFUND" else amount, "currency": code, "ordered_at": ordered_at, "channel": channel,
            "store_number": store, "campaign_code": campaign_code, "coupon_codes": [str(c).strip() for c in coupons if str(c).strip()], "items": items}, {}


def ingest(tenant_id, orders: list[dict], source: str = "API") -> list[dict]:
    """Stores cleaned orders; an order already received (same source and id) is a duplicate and is left as it was.
    Must run inside session.tenant_scope(tenant_id)."""
    out = []
    with session.tx(), session.connection().cursor() as cursor:
        for order in orders:
            cursor.execute("""INSERT INTO attributed_order (tenant_id, source, order_ref, match_ref, kind, original_ref, party_id, email, phone, amount, currency,
                                                            ordered_at, channel, store_number, campaign_code, coupon_codes, items)
                              VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                              ON CONFLICT (tenant_id, source, order_ref) DO NOTHING RETURNING id""",
                           [str(tenant_id), source, order["order_ref"], order["match_ref"], order["kind"], order["original_ref"], order["party_id"], order["email"],
                            order["phone"], order["amount"], order["currency"], order["ordered_at"], order["channel"], order["store_number"], order["campaign_code"],
                            order["coupon_codes"], order["items"]])
            row = cursor.fetchone()
            out.append({"order_id": order["match_ref"], "status": "ACCEPTED" if row else "DUPLICATE"})
    return out


def from_pos(read: dict, *, key: str) -> dict | None:
    """A point-of-sale transaction as an order: the net amount (no tax, shipping or handling), the person, the store and
    the promotion codes. Employee sales and transactions without an amount are left out."""
    from apps.pos import mapping
    transaction, totals, recipient = read["transaction"], read.get("totals") or {}, read.get("recipient") or {}
    if transaction.get("employee_sale") or totals.get("grand_total") is None:
        return None
    net = Decimal(str(totals["grand_total"])) - Decimal(str(totals.get("tax_total") or 0)) - Decimal(str(totals.get("shipping_total") or 0)) \
        - Decimal(str(totals.get("handling_total") or 0))
    refund = transaction.get("category") in mapping.REFUNDS or net < 0
    original = transaction.get("original_id") or None
    if refund and not original:
        return None                                        # nothing to follow: an unreferenced return credits no campaign
    codes = [d.get("code") for d in read.get("discounts") or [] if d.get("code")] + [code for item in read.get("items") or [] for code in item.get("promo_codes") or []]
    at = transaction.get("at")
    if isinstance(at, str):
        at = parse_datetime(at)
    if at is None or at > timezone.now() + timedelta(days=1):
        at = timezone.now()
    if timezone.is_naive(at):
        at = at.replace(tzinfo=dt_timezone.utc)
    return {"order_ref": key[:200], "match_ref": (transaction.get("id") or key)[:120], "kind": "REFUND" if refund else "ORDER", "original_ref": original if refund else None,
            "party_id": (recipient.get("customer_id") or None), "email": (recipient.get("email") or None), "phone": re.sub(r"[^\d+]", "", recipient.get("phone") or "") or None,
            "amount": -abs(round(net, 2)) if refund else round(net, 2), "currency": (transaction.get("currency") or "USD")[:3].upper(), "ordered_at": at, "channel": "STORE",
            "store_number": transaction.get("store_number") or None, "campaign_code": None, "coupon_codes": list(dict.fromkeys(codes))[:20], "items": None}


def record_pos(tenant, read: dict, *, key: str) -> bool:
    """Called by the point-of-sale endpoint for every transaction; stores it only when the workspace counts store sales."""
    config = settings_of(tenant)
    if not (config["enabled"] and config["store_sales"]):
        return False
    order = from_pos(read, key=key)
    if order is None:
        return False
    return ingest(tenant.pk, [order], source="POS")[0]["status"] == "ACCEPTED"


# ---------------------------------------------------------------------------------------------------- attribution
def _parties(cursor, tenant_id, order) -> list[str]:
    """The person behind an order: its customer id, and whoever CEP sent to at its email address or phone number."""
    found = [order["party_id"]] if order["party_id"] else []
    since = order["ordered_at"] - timedelta(days=120)
    if order["email"]:
        cursor.execute("SELECT DISTINCT party_id FROM mailer_execution WHERE tenant_id = %s AND email_address = %s AND created_at > %s LIMIT 20",
                       [tenant_id, order["email"], since])
        found += [row[0] for row in cursor.fetchall()]
    if order["phone"]:
        cursor.execute("SELECT DISTINCT party_id FROM sms_execution WHERE tenant_id = %s AND phone_number = %s AND created_at > %s LIMIT 20",
                       [tenant_id, order["phone"], since])
        found += [row[0] for row in cursor.fetchall()]
    return list(dict.fromkeys(found))


def decide(cursor, tenant_id, order: dict, config: dict) -> dict:
    """{status, campaign_id, touch_type, touch_at, touch_party_id, note}; status PENDING means look again on the next pass."""
    at = order["ordered_at"]
    if order["kind"] == "REFUND":
        cursor.execute("""SELECT status, campaign_id, touch_type, touch_at, touch_party_id FROM attributed_order
                           WHERE tenant_id = %s AND source = %s AND match_ref = %s AND kind = 'ORDER' ORDER BY id LIMIT 1""",
                       [tenant_id, order["source"], order["original_ref"]])
        original = cursor.fetchone()
        if original and original[0] == "ATTRIBUTED":
            return {"status": "ATTRIBUTED", "campaign_id": original[1], "touch_type": "REFUND", "touch_at": original[3], "touch_party_id": original[4], "note": None}
        if original and original[0] == "PENDING" and timezone.now() - order["received_at"] < WAIT_FOR_ORIGINAL:
            return {"status": "PENDING"}
        return {"status": "UNATTRIBUTED", "note": "Its original order was not received or was not credited to a campaign." if not original
                else "Its original order was not credited to a campaign."}
    codes = [code.upper() for code in [order["campaign_code"], *order["coupon_codes"]] if code]
    if codes:
        cursor.execute("SELECT id FROM campaign WHERE tenant_id = %s AND upper(code) = ANY(%s) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [tenant_id, codes])
        row = cursor.fetchone()
        if row:
            return {"status": "ATTRIBUTED", "campaign_id": row[0], "touch_type": "CODE", "touch_at": at, "touch_party_id": order["party_id"], "note": None}
    parties = _parties(cursor, tenant_id, order)
    if not parties:
        return {"status": "UNATTRIBUTED", "note": "No person: no customer id, and no email address or phone number CEP sent to."}
    cursor.execute("""SELECT campaign_id, occurred_at, party_id FROM tracking_event
                       WHERE tenant_id = %s AND party_id = ANY(%s) AND event_type = 'CLICK' AND NOT is_bot AND campaign_id IS NOT NULL
                         AND occurred_at >= %s AND occurred_at <= %s ORDER BY occurred_at DESC LIMIT 1""",
                   [tenant_id, parties, at - timedelta(days=config["click_days"]), at])
    row = cursor.fetchone()
    if row:
        return {"status": "ATTRIBUTED", "campaign_id": row[0], "touch_type": "CLICK", "touch_at": row[1], "touch_party_id": row[2], "note": None}
    if config["open_days"]:
        cursor.execute("""SELECT t.campaign_id, t.occurred_at, t.party_id FROM tracking_event t JOIN campaign c ON c.id = t.campaign_id
                           WHERE t.tenant_id = %s AND t.party_id = ANY(%s) AND t.event_type = 'OPEN' AND NOT t.is_bot
                             AND c.campaign_type <> 'E_RECEIPT' AND c.solicitation_type = 'MARKETING'
                             AND t.occurred_at >= %s AND t.occurred_at <= %s ORDER BY t.occurred_at DESC LIMIT 1""",
                       [tenant_id, parties, at - timedelta(days=config["open_days"]), at])
        row = cursor.fetchone()
        if row:
            return {"status": "ATTRIBUTED", "campaign_id": row[0], "touch_type": "OPEN", "touch_at": row[1], "touch_party_id": row[2], "note": None}
    if config["text_days"]:
        since = at - timedelta(days=config["text_days"])
        cursor.execute("""SELECT s.campaign_id, coalesce(s.delivered_at, s.submitted_at), s.party_id FROM sms_execution s JOIN campaign c ON c.id = s.campaign_id
                           WHERE s.tenant_id = %s AND s.party_id = ANY(%s) AND s.status NOT IN ('QUEUED', 'FAILED')
                             AND c.campaign_type <> 'E_RECEIPT' AND c.solicitation_type = 'MARKETING'
                             AND s.created_at >= %s AND coalesce(s.delivered_at, s.submitted_at) >= %s AND coalesce(s.delivered_at, s.submitted_at) <= %s
                           ORDER BY 2 DESC LIMIT 1""",
                       [tenant_id, parties, since - timedelta(days=1), since, at])
        row = cursor.fetchone()
        if row:
            return {"status": "ATTRIBUTED", "campaign_id": row[0], "touch_type": "TEXT", "touch_at": row[1], "touch_party_id": row[2], "note": None}
    windows = [f"click within {_days(config['click_days'])}"]
    if config["open_days"]:
        windows.append(f"open within {_days(config['open_days'])}")
    if config["text_days"]:
        windows.append(f"text within {_days(config['text_days'])}")
    listed = ", ".join(windows[:-1]) + " or " + windows[-1] if len(windows) > 1 else windows[0]
    return {"status": "UNATTRIBUTED", "note": f"No campaign: no {listed} before the order."}


def _days(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


COLUMNS = ("id", "source", "kind", "original_ref", "party_id", "email", "phone", "amount", "ordered_at", "campaign_code", "coupon_codes", "received_at")


def attribute_pending(tenant_id, config: dict, *, limit: int = BATCH, settle_seconds: int = SETTLE_SECONDS) -> dict:
    """Credits the waiting orders of one workspace. Must run inside session.tenant_scope(tenant_id) and session.tx()."""
    tenant_id = str(tenant_id)
    done = {"attributed": 0, "unattributed": 0, "waiting": 0, "campaigns": set()}
    with session.connection().cursor() as cursor:
        cursor.execute(f"""SELECT {', '.join(COLUMNS)} FROM attributed_order WHERE tenant_id = %s AND status = 'PENDING' AND received_at <= now() - make_interval(secs => %s)
                            ORDER BY kind, ordered_at LIMIT %s FOR UPDATE SKIP LOCKED""", [tenant_id, settle_seconds, limit])
        orders = [dict(zip(COLUMNS, row)) for row in cursor.fetchall()]
        for order in orders:
            verdict = decide(cursor, tenant_id, order, config)
            if verdict["status"] == "PENDING":
                done["waiting"] += 1
                continue
            cursor.execute("""UPDATE attributed_order SET status = %s, campaign_id = %s, touch_type = %s, touch_at = %s, touch_party_id = %s, note = %s, attributed_at = now()
                               WHERE id = %s""",
                           [verdict["status"], verdict.get("campaign_id"), verdict.get("touch_type"), verdict.get("touch_at"), verdict.get("touch_party_id"),
                            verdict.get("note"), order["id"]])
            if verdict["status"] == "ATTRIBUTED":
                done["attributed"] += 1
                done["campaigns"].add(str(verdict["campaign_id"]))
            else:
                done["unattributed"] += 1
    return done


def _money(value):
    return None if value is None else Decimal(str(value)).quantize(Decimal("0.01"))


def rollup(tenant_id, config: dict, campaign_ids=(), *, full: bool = False) -> int:
    """Writes campaign_actual for the campaigns given, those that sent in the last 35 days, or (full) every campaign that ever
    sent. Revenue is net of refunds; buyers are distinct people (an order without
    a person counts as one buyer). Cost is the delivered sends at the workspace's rates; with no
    rate set the campaign's actual cost is left as it was (Home then uses the planned cost). Must run inside tenant_scope + tx."""
    tenant_id = str(tenant_id)
    with session.connection().cursor() as cursor:
        if full:
            cursor.execute("SELECT DISTINCT campaign_id::text FROM campaign_run WHERE tenant_id = %s AND started_at IS NOT NULL", [tenant_id])
        else:
            cursor.execute("SELECT DISTINCT campaign_id::text FROM campaign_run WHERE tenant_id = %s AND started_at > now() - make_interval(days => %s)",
                           [tenant_id, RECENT_RUN_DAYS])
        scope = sorted({row[0] for row in cursor.fetchall()} | {str(pk) for pk in campaign_ids})
        if not scope:
            return 0
        cursor.execute("""SELECT campaign_id::text, sum(amount), count(*) FILTER (WHERE kind = 'ORDER'),
                                 count(DISTINCT coalesce(touch_party_id, party_id, email::text, phone)) FILTER (WHERE kind = 'ORDER')
                                 + count(*) FILTER (WHERE kind = 'ORDER' AND coalesce(touch_party_id, party_id, email::text, phone) IS NULL)
                            FROM attributed_order WHERE tenant_id = %s AND status = 'ATTRIBUTED' AND campaign_id::text = ANY(%s) GROUP BY 1""", [tenant_id, scope])
        credit = {pk: (_money(revenue), int(orders), int(buyers)) for pk, revenue, orders, buyers in cursor.fetchall()}
        cursor.execute("SELECT campaign_id::text, array_agg(id) FROM campaign_run WHERE tenant_id = %s AND campaign_id::text = ANY(%s) GROUP BY 1", [tenant_id, scope])
        runs = {pk: ids for pk, ids in cursor.fetchall()}
        all_runs = [run for ids in runs.values() for run in ids]
        emails, texts = {}, {}
        if all_runs:
            cursor.execute("""SELECT campaign_id::text, count(*) FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = ANY(%s)
                                 AND (delivered_at IS NOT NULL OR status IN ('DELIVERED', 'OPENED', 'CLICKED', 'COMPLAINED')) GROUP BY 1""", [tenant_id, all_runs])
            emails = dict(cursor.fetchall())
            cursor.execute("""SELECT campaign_id::text, count(*) FROM sms_execution WHERE tenant_id = %s AND campaign_run_id = ANY(%s)
                                 AND status NOT IN ('QUEUED', 'FAILED') GROUP BY 1""", [tenant_id, all_runs])
            texts = dict(cursor.fetchall())
        cursor.execute("""SELECT DISTINCT ON (campaign_id) campaign_id::text, planned_cost, planned_offer_cost FROM campaign_target
                           WHERE tenant_id = %s AND deleted_at IS NULL AND campaign_id::text = ANY(%s) ORDER BY campaign_id, created_at DESC""", [tenant_id, scope])
        planned = {pk: (cost, offer) for pk, cost, offer in cursor.fetchall()}
        cursor.execute("""SELECT DISTINCT ON (campaign_id) campaign_id::text, actual_delivery_cost, offer_cost FROM campaign_actual
                           WHERE tenant_id = %s AND campaign_id::text = ANY(%s) ORDER BY campaign_id, computed_at DESC""", [tenant_id, scope])
        existing = {pk: (cost, offer) for pk, cost, offer in cursor.fetchall()}
        email_rate, text_rate = config.get("email_cost_per_1000"), config.get("text_cost_per_1000")
        written = 0
        for pk in scope:
            revenue, orders, buyers = credit.get(pk, (Decimal("0.00"), 0, 0))
            sent_emails, sent_texts = int(emails.get(pk, 0)), int(texts.get(pk, 0))
            delivered = sent_emails + sent_texts
            if email_rate is None and text_rate is None:
                delivery_cost = existing.get(pk, (None, None))[0]
            else:
                delivery_cost = _money(Decimal(sent_emails) / 1000 * Decimal(str(email_rate or 0)) + Decimal(sent_texts) / 1000 * Decimal(str(text_rate or 0)))
            offer_cost = existing.get(pk, (None, None))[1]
            if delivery_cost is not None or offer_cost is not None:
                cost = (delivery_cost or 0) + (offer_cost or 0)
            else:
                plan = planned.get(pk, (None, None))
                cost = (plan[0] or 0) + (plan[1] or 0) if plan != (None, None) else None
            cost = _money(cost) if cost is not None else None
            values = {"attributed_revenue": revenue, "attributed_orders": orders, "attributed_conversions": buyers, "actual_delivery_cost": delivery_cost,
                      "campaign_contribution": _money(revenue - cost) if cost is not None else None,
                      "campaign_roi": min(round(revenue / cost, 4), ROI_CAP) if cost else None,
                      "revenue_per_delivered": round(revenue / delivered, 4) if delivered else None,
                      "cost_per_conversion": round(cost / buyers, 4) if cost is not None and buyers else None}
            sets = ", ".join(f"{name} = %s" for name in values)
            cursor.execute(f"UPDATE campaign_actual SET {sets}, computed_at = now() WHERE tenant_id = %s AND campaign_id::text = %s", [*values.values(), tenant_id, pk])
            if cursor.rowcount == 0:
                cursor.execute(f"INSERT INTO campaign_actual (campaign_id, tenant_id, {', '.join(values)}) VALUES (%s, %s, {', '.join(['%s'] * len(values))})",
                               [pk, tenant_id, *values.values()])
            written += 1
    return written


# ---------------------------------------------------------------------------------------------------- the job
def enabled_tenants() -> list[tuple[str, dict]]:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("""SELECT id::text, settings -> 'attribution' FROM tenant
                           WHERE status = 'ACTIVE' AND deleted_at IS NULL AND (settings -> 'attribution' ->> 'enabled') = 'true'""")
        return [(tid, {**DEFAULTS, **(stored or {})}) for tid, stored in cursor.fetchall()]


def run_for(tenant_id, config: dict, *, settle_seconds: int = SETTLE_SECONDS) -> dict:
    """One pass for one workspace: credit the waiting orders, then write the figures. Opens its own tenant scope."""
    full = bool(config.get("needs_full"))
    with session.tenant_scope(tenant_id):
        with session.tx():
            done = attribute_pending(tenant_id, config, settle_seconds=settle_seconds)
            written = rollup(tenant_id, config, done["campaigns"], full=full)
        if full:
            _set_flag(tenant_id, False)
    return {"attributed": done["attributed"], "unattributed": done["unattributed"], "waiting": done["waiting"], "campaigns": written, "full": full}


def run() -> dict:
    import logging
    log = logging.getLogger("cep.attribution")
    totals = {"workspaces": 0, "attributed": 0, "unattributed": 0, "campaigns": 0, "failed": 0}
    for tenant_id, config in enabled_tenants():
        try:
            outcome = run_for(tenant_id, config)
        except Exception:                                  # noqa: BLE001  one workspace's trouble must not stop the others
            log.exception("attribution failed for tenant %s", tenant_id)
            totals["failed"] += 1
            continue
        totals["workspaces"] += 1
        for key in ("attributed", "unattributed", "campaigns"):
            totals[key] += outcome[key]
    return totals


def recalculate(tenant, days: int = 400) -> dict:
    """Judges the last `days` of orders again under the current rules and rewrites every campaign's figures on the next pass
    (the first batch at once). Must run in the workspace's request."""
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""UPDATE attributed_order SET status = 'PENDING', campaign_id = NULL, touch_type = NULL, touch_at = NULL, touch_party_id = NULL, note = NULL,
                                 attributed_at = NULL WHERE tenant_id = %s AND ordered_at > now() - make_interval(days => %s)""", [str(tenant.pk), days])
        reset = cursor.rowcount
    _set_flag(tenant.pk, True)
    config = settings_of(tenant) | {"needs_full": True}
    outcome = run_for(tenant.pk, config, settle_seconds=0) if config["enabled"] else {"attributed": 0, "unattributed": 0, "waiting": 0, "campaigns": 0}
    return {"reset": reset, **outcome, "remaining": max(0, reset - outcome["attributed"] - outcome["unattributed"])}


# ---------------------------------------------------------------------------------------------------- what Settings shows
def summary(tenant_id, days: int = 30) -> dict:
    tenant_id = str(tenant_id)
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""SELECT count(*) FILTER (WHERE kind = 'ORDER'), coalesce(sum(amount), 0), coalesce(sum(amount) FILTER (WHERE status = 'ATTRIBUTED'), 0),
                                 count(*) FILTER (WHERE kind = 'ORDER' AND status = 'ATTRIBUTED'), count(*) FILTER (WHERE status = 'PENDING'),
                                 count(*) FILTER (WHERE kind = 'ORDER' AND status = 'UNATTRIBUTED'), max(received_at)
                            FROM attributed_order WHERE tenant_id = %s AND ordered_at > now() - make_interval(days => %s)""", [tenant_id, days])
        orders, revenue, attributed_revenue, attributed, pending, unattributed, last = cursor.fetchone()
        cursor.execute("""SELECT touch_type, count(*), coalesce(sum(amount), 0) FROM attributed_order
                           WHERE tenant_id = %s AND status = 'ATTRIBUTED' AND kind = 'ORDER' AND ordered_at > now() - make_interval(days => %s) GROUP BY 1""", [tenant_id, days])
        by_touch = {touch: {"orders": int(n), "revenue": float(total)} for touch, n, total in cursor.fetchall()}
        cursor.execute("""SELECT o.campaign_id::text, c.name, sum(o.amount), count(*) FILTER (WHERE o.kind = 'ORDER') FROM attributed_order o JOIN campaign c ON c.id = o.campaign_id
                           WHERE o.tenant_id = %s AND o.status = 'ATTRIBUTED' AND o.ordered_at > now() - make_interval(days => %s)
                           GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 5""", [tenant_id, days])
        top = [{"id": pk, "name": name, "revenue": float(total), "orders": int(n)} for pk, name, total, n in cursor.fetchall()]
        cursor.execute("SELECT count(*) FROM attributed_order WHERE tenant_id = %s AND source = 'POS'", [tenant_id])
        store_orders = cursor.fetchone()[0]
    return {"days": days, "orders": int(orders), "revenue": float(revenue), "attributed_revenue": float(attributed_revenue), "attributed_orders": int(attributed),
            "attributed_share": round(attributed * 100 / orders, 1) if orders else None, "pending": int(pending), "unattributed": int(unattributed),
            "last_received_at": last, "by_touch": {key: by_touch.get(key, {"orders": 0, "revenue": 0.0}) for key in ("CODE", "CLICK", "OPEN", "TEXT")},
            "top_campaigns": top, "store_orders": int(store_orders)}


def recent(tenant_id, *, status: str | None = None, q: str = "", limit: int = 50) -> list[dict]:
    tenant_id = str(tenant_id)
    where, args = ["o.tenant_id = %s"], [tenant_id]
    if status in ("PENDING", "ATTRIBUTED", "UNATTRIBUTED"):
        where.append("o.status = %s")
        args.append(status)
    if q:
        where.append("(o.match_ref ILIKE %s OR o.email::text ILIKE %s OR o.party_id ILIKE %s OR c.name ILIKE %s)")
        args += [f"%{q}%"] * 4
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(f"""SELECT o.id, o.source, o.match_ref, o.kind, o.amount, o.currency, o.ordered_at, o.channel, o.store_number, o.party_id, o.email, o.phone,
                                  o.status, o.campaign_id::text, c.name, o.touch_type, o.touch_at, o.note, o.received_at
                             FROM attributed_order o LEFT JOIN campaign c ON c.id = o.campaign_id
                            WHERE {' AND '.join(where)} ORDER BY o.ordered_at DESC, o.id DESC LIMIT %s""", [*args, limit])
        rows = cursor.fetchall()
    keys = ("id", "source", "order_id", "kind", "amount", "currency", "ordered_at", "channel", "store_number", "party_id", "email", "phone", "status", "campaign_id",
            "campaign_name", "touch_type", "touch_at", "note", "received_at")
    out = []
    for row in rows:
        item = dict(zip(keys, row))
        item["amount"] = float(item["amount"])
        item["phone"] = ("•" * max(0, len(item["phone"]) - 4) + item["phone"][-4:]) if item["phone"] else None
        out.append(item)
    return out
