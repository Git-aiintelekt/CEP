"""What each kind of step does with one customer. advance.py calls `run` and acts on what it returns:

    Hold(until)                         stay on this step; look again at `until`
    Done(status, result, branch, run)   the step is over: record it (journey_node_execution) and follow the connection
                                        whose branch_key is `branch` (or the unlabelled one)
    Finish(status, reason)              the journey is over for this customer

Step configuration (journey_node.config), by node_type:

    START            -
    WAIT             {duration, unit: MINUTES | HOURS | DAYS | WEEKS}, {duration: "P1DT6H"} (ISO 8601) or {days, hours, minutes}
    CONDITION        {check, days?, event_type?, segment_id?, category?, message_step?}  ->  branch YES or NO
                     check: PURCHASED, OPENED, CLICKED, REDEEMED, EVENT (any journey_event of event_type), IN_SEGMENT.
                     `days` looks back that many days from now; without it, back to when the customer entered.
                     OPENED / CLICKED look at the emails of this journey: those of `message_step` (a node key) when given.
    SPLIT            {by: RANDOM | LOYALTY_TIER | CUSTOMER_TYPE, paths: [{branch_key, share} | {branch_key, values: [...]}], otherwise?}
                     The path chosen is kept in state_data["splits"] so a retry never rolls again.
    EMAIL, SMS, MMS  see messages.py
    COUPON_ISSUE     {coupon_id}  ->  a coupon_issuance request C360 fulfils (GET /coupon-issuances/) and a COUPON_ISSUED event
    LOYALTY_CHANGE   {tier_id}    ->  confirms an apps.customers.LoyaltyTier reference, sets customer_master.custom_attributes.loyalty_tier
    SEGMENT_UPDATE   {segment_id, action: ADD | REMOVE}
    EXIT             -
"""
import hashlib
import re
from datetime import timedelta

from django.utils import timezone

from apps.customers.models import Coupon, CustomerMaster, LoyaltyTier, Segment
from apps.delivery.engine import session

from ..models import JourneyGeneratedCampaign, JourneyNode
from . import messages
from .outcome import Done, Finish, Hold

UNITS = {"MINUTES": 60, "HOURS": 3600, "DAYS": 86400, "WEEKS": 7 * 86400}
ISO_DURATION = re.compile(r"P(?:(?P<WEEKS>[\d.]+)W)?(?:(?P<DAYS>[\d.]+)D)?(?:T(?:(?P<HOURS>[\d.]+)H)?(?:(?P<MINUTES>[\d.]+)M)?)?")
SPLIT_ATTRIBUTE = {"LOYALTY_TIER": "loyalty_tier", "CUSTOMER_TYPE": "customer_type"}
EVENT_CHECKS = {"PURCHASED": ("PURCHASE", "CATEGORY_PURCHASE"), "REDEEMED": ("COUPON_REDEEMED",)}


def wait_seconds(config: dict) -> int | None:
    """The configured wait in seconds, or None when it cannot be read."""
    try:
        if isinstance(config.get("duration"), str) and config["duration"].upper().startswith("P"):
            match = ISO_DURATION.fullmatch(config["duration"].upper())
            return None if match is None else sum(int(float(match[name] or 0) * UNITS[name]) for name in UNITS)
        if "duration" in config:
            return int(float(config["duration"]) * UNITS[str(config.get("unit") or "DAYS").upper()])
        total = sum(float(config.get(name) or 0) * UNITS[name.upper()] for name in ("minutes", "hours", "days", "weeks"))
        return int(total) if any(name in config for name in ("minutes", "hours", "days", "weeks")) else None
    except (KeyError, TypeError, ValueError):
        return None


def _wait(node, state, enrollment) -> Hold | Done:
    seconds = wait_seconds(node.config or {})
    if seconds is None or seconds < 0:
        return Done("FAILED", {"reason": "The wait has no valid duration."})
    due = state.entered_node_at + timedelta(seconds=seconds)
    return Hold(due) if due > timezone.now() else Done(result={"waited_seconds": seconds})


def _journey_campaigns(enrollment, step_key: str | None) -> list[str]:
    links = JourneyGeneratedCampaign.objects.filter(tenant_id=enrollment.tenant_id, journey_id=enrollment.journey_id)
    if step_key:
        links = links.filter(journey_node__node_key=step_key)
    return [str(campaign_id) for campaign_id in links.values_list("campaign_id", flat=True)]


def _check(node, state, enrollment) -> Done:
    config = node.config or {}
    expression = config.get("expr") if isinstance(config.get("expr"), dict) else {}
    if not config.get("check") and expression.get("event"):         # the seed data's form: {expr: {event, within_days}}
        config = {"check": "EVENT", "event_type": expression["event"], "days": expression.get("within_days")}
    check = str(config.get("check") or "").upper()
    since = enrollment.enrolled_at
    if config.get("days") not in (None, ""):
        try:
            since = timezone.now() - timedelta(days=float(config["days"]))
        except (TypeError, ValueError):
            return Done("FAILED", {"reason": "The check's number of days is not a number."}, branch="NO")
    args = {"tenant": str(enrollment.tenant_id), "party": enrollment.party_id, "since": since}
    if check in EVENT_CHECKS or check == "EVENT":
        types = EVENT_CHECKS.get(check) or ((str(config.get("event_type") or "").upper(),) if config.get("event_type") else ())
        if not types:
            return Done("FAILED", {"reason": "The check names no event type."}, branch="NO")
        sql = """SELECT EXISTS (SELECT 1 FROM journey_event WHERE tenant_id = %(tenant)s AND party_id = %(party)s AND event_type = ANY(%(types)s)
                                   AND occurred_at >= %(since)s AND (%(category)s = '' OR event_payload ->> 'category' = %(category)s))"""
        args.update(types=list(types), category=str(config.get("category") or ""))
        if check == "PURCHASED":                           # a purchase may also arrive through link tracking
            sql += """ OR EXISTS (SELECT 1 FROM tracking_event WHERE tenant_id = %(tenant)s AND party_id = %(party)s AND event_type = 'PURCHASE'
                                     AND occurred_at >= %(since)s AND %(category)s = '')"""
    elif check in ("OPENED", "CLICKED"):
        campaigns = _journey_campaigns(enrollment, config.get("message_step"))
        if not campaigns:
            return Done(result={"check": check, "met": False, "reason": "No email of this journey has gone to anyone yet."}, branch="NO")
        column = "opened_at" if check == "OPENED" else "clicked_at"
        sql = f"""SELECT EXISTS (SELECT 1 FROM mailer_execution WHERE tenant_id = %(tenant)s AND party_id = %(party)s AND campaign_id::text = ANY(%(campaigns)s)
                                    AND created_at >= %(entered)s AND {column} >= %(since)s)"""
        args.update(campaigns=campaigns, entered=enrollment.enrolled_at - timedelta(days=1))
    elif check == "IN_SEGMENT":
        if not config.get("segment_id"):
            return Done("FAILED", {"reason": "The check names no segment."}, branch="NO")
        sql = "SELECT EXISTS (SELECT 1 FROM customer_segment_membership WHERE tenant_id = %(tenant)s AND party_id = %(party)s AND segment_id::text = %(segment)s)"
        args["segment"] = str(config["segment_id"])
    else:
        return Done("FAILED", {"reason": f"Unknown check '{check}'."}, branch="NO")
    with session.connection().cursor() as cursor:
        cursor.execute(sql, args)
        met = bool(cursor.fetchone()[0])
    return Done(result={"check": check, "met": met}, branch="YES" if met else "NO")


def _split(node, state, enrollment) -> Done:
    chosen = (state.state_data.get("splits") or {}).get(node.node_key)
    if chosen is not None:
        return Done(result={"path": chosen, "kept": True}, branch=chosen)
    config = node.config or {}
    paths = [path for path in config.get("paths") or [] if isinstance(path, dict) and path.get("branch_key")]
    by = str(config.get("by") or "RANDOM").upper()
    chosen = None
    if by == "RANDOM":
        shares = [(str(path["branch_key"]), max(0.0, float(path.get("share") or 0))) for path in paths]
        total = sum(share for _key, share in shares)
        if total > 0:                                     # stable per customer and step: the same roll on every retry
            roll = int(hashlib.sha256(f"{enrollment.pk}:{node.node_key}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF * total
            for key, share in shares:
                roll -= share
                if roll <= 0:
                    chosen = key
                    break
            chosen = chosen or shares[-1][0]
    elif by in SPLIT_ATTRIBUTE:
        attributes = CustomerMaster.objects.filter(tenant_id=enrollment.tenant_id, party_id=enrollment.party_id).values_list("custom_attributes", flat=True).first() or {}
        value = str(attributes.get(SPLIT_ATTRIBUTE[by]) or "").strip().lower()
        chosen = next((str(path["branch_key"]) for path in paths if value and value in {str(item).strip().lower() for item in path.get("values") or []}), None)
    else:
        return Done("FAILED", {"reason": f"Unknown split '{by}'."}, branch=config.get("otherwise"))
    chosen = chosen or config.get("otherwise")
    state.state_data.setdefault("splits", {})[node.node_key] = chosen
    return Done(result={"path": chosen, "by": by}, branch=chosen)


def _segment(node, state, enrollment) -> Done:
    config = node.config or {}
    action = str(config.get("action") or "ADD").upper()
    segment = Segment.objects.filter(tenant_id=enrollment.tenant_id, pk=config.get("segment_id")).first() if config.get("segment_id") else None
    if segment is None:
        return Done("FAILED", {"reason": "The segment does not exist (any more)."})
    if action not in ("ADD", "REMOVE"):
        return Done("FAILED", {"reason": f"Unknown segment action '{action}'."})
    with session.connection().cursor() as cursor:
        if action == "ADD":
            cursor.execute("""INSERT INTO customer_segment_membership (tenant_id, party_id, segment_id) VALUES (%s, %s, %s)
                              ON CONFLICT DO NOTHING""", [str(enrollment.tenant_id), enrollment.party_id, str(segment.pk)])
        else:
            cursor.execute("DELETE FROM customer_segment_membership WHERE tenant_id = %s AND party_id = %s AND segment_id = %s",
                           [str(enrollment.tenant_id), enrollment.party_id, str(segment.pk)])
        changed = cursor.rowcount > 0
    return Done(result={"segment": segment.code, "action": action, "changed": changed})


def _coupon(node, state, enrollment) -> Done:
    """Issue Coupon: CEP does not make coupons (C360 owns them, see apps.customers.Coupon). The step records a request,
    once per customer and step (coupon_issuance), that C360 collects from GET /coupon-issuances/ and marks issued, with the
    customer's own code when it has one; and it raises a COUPON_ISSUED event, which a Coupon Expiry Reminder journey enters on."""
    from apps.journeys import events
    config = node.config or {}
    coupon = Coupon.objects.filter(tenant_id=enrollment.tenant_id, pk=config.get("coupon_id"), is_active=True).first() if config.get("coupon_id") else None
    if coupon is None:
        return Done("FAILED", {"reason": "The coupon does not exist (any more) or is inactive."})
    tenant = str(enrollment.tenant_id)
    with session.connection().cursor() as cursor:
        cursor.execute("""INSERT INTO coupon_issuance (tenant_id, coupon_id, party_id, journey_id, journey_node_key, journey_enrollment_id)
                          VALUES (%s, %s, %s, %s, %s, %s)
                          ON CONFLICT (tenant_id, journey_enrollment_id, journey_node_key) WHERE journey_enrollment_id IS NOT NULL DO NOTHING
                          RETURNING id, requested_at""", [tenant, str(coupon.pk), enrollment.party_id, str(enrollment.journey_id), node.node_key, str(enrollment.pk)])
        row = cursor.fetchone()
        if row is None:
            cursor.execute("SELECT id, requested_at FROM coupon_issuance WHERE tenant_id = %s AND journey_enrollment_id = %s AND journey_node_key = %s",
                           [tenant, str(enrollment.pk), node.node_key])
            row = cursor.fetchone()
    issuance_id, requested_at = row
    events.emit(tenant, enrollment.party_id, "COUPON_ISSUED", source="CEP", external_id=f"coupon-issuance:{issuance_id}", occurred_at=requested_at,
                payload={"coupon_code": coupon.code, "coupon_name": coupon.name, "issuance_id": issuance_id, "journey_id": str(enrollment.journey_id)})
    return Done(result={"coupon": coupon.code, "name": coupon.name, "issuance_id": issuance_id, "status": "REQUESTED"})


def _loyalty(node, state, enrollment) -> Done:
    """Update Loyalty Tier: a cached C360 tier reference (see apps.customers.LoyaltyTier). Sets
    customer_master.custom_attributes->>'loyalty_tier' to the tier's code — the same field CustomerMaster
    already documents as holding it — rather than a new tier-assignment table."""
    config = node.config or {}
    tier = LoyaltyTier.objects.filter(tenant_id=enrollment.tenant_id, pk=config.get("tier_id")).first() if config.get("tier_id") else None
    if tier is None:
        return Done("FAILED", {"reason": "The loyalty tier does not exist (any more)."})
    with session.connection().cursor() as cursor:
        cursor.execute(
            "UPDATE customer_master SET custom_attributes = jsonb_set(custom_attributes, '{loyalty_tier}', %s::jsonb) "
            "WHERE tenant_id = %s AND party_id = %s",
            [f'"{tier.code}"', str(enrollment.tenant_id), enrollment.party_id],
        )
        changed = cursor.rowcount > 0
    return Done(result={"tier": tier.code, "name": tier.name, "changed": changed})


HANDLERS = {
    "START": lambda node, state, enrollment: Done(result={"entry": state.state_data.get("entry")}),
    "WAIT": _wait,
    "CONDITION": _check,
    "SPLIT": _split,
    "EMAIL": messages.step,
    "SMS": messages.step,
    "MMS": messages.step,
    "COUPON_ISSUE": _coupon,
    "LOYALTY_CHANGE": _loyalty,
    "SEGMENT_UPDATE": _segment,
    "EXIT": lambda node, state, enrollment: Finish("COMPLETED"),
}


def run(node: JourneyNode, state, enrollment) -> Hold | Done | Finish:
    handler = HANDLERS.get("START" if node.node_family == "ENTRY" else node.node_type)
    if handler is None:
        return Done("SKIPPED", {"reason": f"{node.node_type} steps are not available yet."})
    return handler(node, state, enrollment)
