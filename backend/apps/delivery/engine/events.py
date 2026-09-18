"""Applies what providers report back (DeliveryEvent) to the execution, the address and the person's consent.

Status only moves forward: SUBMITTED -> DELIVERED -> OPENED -> CLICKED. A bounce, a complaint or a drop wins over all of
them, because they decide whether the address may be used again. Events can arrive twice and out of order; applying one
a second time changes nothing.
"""
from django.utils import timezone

from ..providers.base import DeliveryEvent, EventType
from . import session, unsubscribe

RANK = {"QUEUED": 0, "SUBMITTED": 1, "DELIVERED": 2, "OPENED": 3, "CLICKED": 4}
TERMINAL = {"BOUNCED", "COMPLAINED", "FAILED"}
SOFT_BOUNCE_BLOCK_AFTER = 3


def find_execution(tenant_id, event: DeliveryEvent):
    """-> (id, party_id, email, status, campaign_id, run_id) or None. The echoed idempotency key is preferred: it is ours."""
    with session.connection().cursor() as cursor:
        for column, value in (("idempotency_key", event.idempotency_key), ("provider_message_id", event.provider_message_id)):
            if not value:
                continue
            cursor.execute(f"""SELECT id, party_id, email_address, status, campaign_id, campaign_run_id FROM mailer_execution
                                WHERE tenant_id = %s AND {column} = %s ORDER BY created_at DESC LIMIT 1""", [str(tenant_id), value])
            row = cursor.fetchone()
            if row:
                return row
    return None


def apply(tenant_id, event: DeliveryEvent) -> str:
    """-> 'applied' | 'ignored' (nothing new) | 'unmatched' (no such message in this workspace)."""
    found = find_execution(tenant_id, event)
    if found is None:
        return "unmatched"
    execution_id, party_id, email, status, campaign_id, run_id = found
    when = event.occurred_at or timezone.now()
    kind = event.event_type
    sets: dict[str, object] = {}

    if kind is EventType.DELIVERED:
        if status not in TERMINAL and RANK.get(status, 0) < RANK["DELIVERED"]:
            sets.update(status="DELIVERED", delivered_at=when)
    elif kind is EventType.OPENED:
        if status not in TERMINAL and RANK.get(status, 0) < RANK["OPENED"]:
            sets.update(status="OPENED")
        sets.setdefault("opened_at", when)
    elif kind is EventType.CLICKED:
        if status not in TERMINAL:
            sets.update(status="CLICKED")
        sets.setdefault("clicked_at", when)
    elif kind is EventType.BOUNCED:
        sets.update(status="BOUNCED", bounced_at=when, bounce_type=event.bounce_type or "HARD", status_reason=event.reason[:200] or None,
                    bounce_domain=email.rsplit("@", 1)[-1][:200])
    elif kind is EventType.DROPPED:
        sets.update(status="FAILED", status_reason=(event.reason or "Dropped by the provider")[:200])
    elif kind is EventType.COMPLAINED:
        sets.update(status="COMPLAINED", complained_at=when)
    elif kind is EventType.DEFERRED:
        sets.update(status_reason=("Deferred: " + event.reason)[:200])
    if event.user_agent and kind in (EventType.OPENED, EventType.CLICKED):
        sets.update(user_agent=event.user_agent, ip_address=event.ip_address)

    with session.connection().cursor() as cursor:
        changed = 0
        if sets:
            first_time = {"opened_at", "clicked_at"} & set(sets)                # keep the first open / click time
            assignments = ", ".join(f"{col} = COALESCE({col}, %s)" if col in first_time else f"{col} = %s" for col in sets)
            cursor.execute(f"UPDATE mailer_execution SET {assignments} WHERE tenant_id = %s AND id = %s", [*sets.values(), str(tenant_id), execution_id])
            changed = cursor.rowcount
        if kind in (EventType.OPENED, EventType.CLICKED):
            cursor.execute("""INSERT INTO tracking_event (tenant_id, party_id, event_type, channel, campaign_id, campaign_run_id, mailer_execution_id, url, ip_address,
                                                          user_agent, occurred_at)
                              VALUES (%s, %s, %s, 'EMAIL', %s, %s, %s, %s, %s, %s, %s)""",
                           [str(tenant_id), party_id, "OPEN" if kind is EventType.OPENED else "CLICK", str(campaign_id), str(run_id), execution_id,
                            event.url or None, event.ip_address, event.user_agent or None, when])
        if kind is EventType.BOUNCED and status != "BOUNCED":
            _address_bounced(cursor, tenant_id, party_id, email, event, when)
        if kind is EventType.COMPLAINED and status != "COMPLAINED":
            cursor.execute("""INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, complaint_count, last_complaint_at, blocked,
                                                                block_reason, block_source, blocked_at)
                              VALUES (%s, 'EMAIL', %s, %s, 1, %s, TRUE, 'COMPLAINT', 'PROVIDER', %s)
                              ON CONFLICT (tenant_id, contact_point_type, contact_value) DO UPDATE
                                 SET complaint_count = contact_point_status.complaint_count + 1, last_complaint_at = EXCLUDED.last_complaint_at, blocked = TRUE,
                                     block_reason = 'COMPLAINT', block_source = 'PROVIDER', blocked_at = COALESCE(contact_point_status.blocked_at, EXCLUDED.blocked_at)""",
                           [str(tenant_id), email, party_id, when, when])
    if kind is EventType.COMPLAINED and status != "COMPLAINED":
        unsubscribe.opt_out(tenant_id=tenant_id, party_id=party_id, email=email, campaign_id=campaign_id, run_id=run_id, method="COMPLAINT",
                            evidence={"provider_event": event.raw.get("event") if isinstance(event.raw, dict) else None}, execution_id=execution_id)
    if kind is EventType.UNSUBSCRIBED:
        unsubscribe.opt_out(tenant_id=tenant_id, party_id=party_id, email=email, campaign_id=campaign_id, run_id=run_id, evidence={"via": "provider"}, execution_id=execution_id)
        return "applied"
    return "applied" if changed or kind in (EventType.OPENED, EventType.CLICKED) else "ignored"


def _address_bounced(cursor, tenant_id, party_id, email, event: DeliveryEvent, when) -> None:
    hard = (event.bounce_type or "HARD") == "HARD"
    cursor.execute("""INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, hard_bounce_count, soft_bounce_count, last_bounce_at,
                                                        last_bounce_reason, blocked, block_reason, block_source, blocked_at)
                      VALUES (%s, 'EMAIL', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                      ON CONFLICT (tenant_id, contact_point_type, contact_value) DO UPDATE
                         SET hard_bounce_count = contact_point_status.hard_bounce_count + EXCLUDED.hard_bounce_count,
                             soft_bounce_count = contact_point_status.soft_bounce_count + EXCLUDED.soft_bounce_count,
                             last_bounce_at = EXCLUDED.last_bounce_at, last_bounce_reason = EXCLUDED.last_bounce_reason,
                             blocked = contact_point_status.blocked OR EXCLUDED.blocked
                                       OR contact_point_status.soft_bounce_count + EXCLUDED.soft_bounce_count >= %s,
                             block_reason = CASE WHEN contact_point_status.blocked THEN contact_point_status.block_reason
                                                 WHEN EXCLUDED.blocked THEN 'HARD_BOUNCE'
                                                 WHEN contact_point_status.soft_bounce_count + EXCLUDED.soft_bounce_count >= %s THEN 'SOFT_BOUNCE_THRESHOLD' END,
                             block_source = COALESCE(contact_point_status.block_source, 'PROVIDER'),
                             blocked_at = COALESCE(contact_point_status.blocked_at, CASE WHEN EXCLUDED.blocked
                                          OR contact_point_status.soft_bounce_count + EXCLUDED.soft_bounce_count >= %s THEN EXCLUDED.last_bounce_at END)""",
                   [str(tenant_id), email, party_id, 1 if hard else 0, 0 if hard else 1, when, event.reason[:200] or None, hard, "HARD_BOUNCE" if hard else None,
                    "PROVIDER" if hard else None, when if hard else None, SOFT_BOUNCE_BLOCK_AFTER, SOFT_BOUNCE_BLOCK_AFTER, SOFT_BOUNCE_BLOCK_AFTER])
