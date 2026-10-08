"""Per-journey suppressions (phase 5): customers this one journey must never enter or message. journey_suppression rows name a
customer (party_id) with how they were given (an email address, a mobile number or the id) and why. Enrollment leaves them out
(enroll.py's `best` CTE) and adding one takes a customer who is inside out at once ("Suppressed for this journey").
Workspace-level suppressions and consent (apps.governance) stay as they are and apply before these."""
from django.utils import timezone

from apps.delivery.engine import session

from .models import Journey

REASON = "Suppressed for this journey"
MAX_NOTE = 200


def _conn():
    return session.connection()


def listing(journey: Journey) -> list[dict]:
    with _conn().cursor() as cursor:
        cursor.execute("""SELECT s.id::text, s.party_id, s.given, s.note, s.created_at, u.display_name, cm.first_name, cm.last_name, lower(cm.emails -> 0 ->> 'address')
                            FROM journey_suppression s
                            LEFT JOIN customer_master cm ON cm.tenant_id = s.tenant_id AND cm.party_id = s.party_id
                            LEFT JOIN app_user u ON u.id = s.created_by
                           WHERE s.tenant_id = %s AND s.journey_id = %s ORDER BY s.created_at DESC""", [str(journey.tenant_id), str(journey.pk)])
        return [{"id": row[0], "party_id": row[1], "given": row[2], "note": row[3], "created_at": row[4], "created_by_name": row[5],
                 "name": " ".join(part for part in (row[6], row[7]) if part) or row[1], "email": row[8]} for row in cursor.fetchall()]


def resolve(tenant_id, given: str) -> str | None:
    """The party a value names: a customer id, an email address (any case) or a mobile number; None when nobody matches."""
    given = (given or "").strip()
    if not given:
        return None
    digits = "".join(ch for ch in given if ch.isdigit())
    with _conn().cursor() as cursor:
        cursor.execute("""SELECT cm.party_id FROM customer_master cm
                           WHERE cm.tenant_id = %(tenant)s AND (cm.party_id = %(given)s
                              OR EXISTS (SELECT 1 FROM jsonb_array_elements(cm.emails) e WHERE lower(e ->> 'address') = lower(%(given)s))
                              OR (%(digits)s <> '' AND EXISTS (SELECT 1 FROM jsonb_array_elements(cm.phones) p WHERE regexp_replace(p ->> 'number', '[^0-9]', '', 'g') = %(digits)s)))
                           ORDER BY cm.party_id LIMIT 1""", {"tenant": str(tenant_id), "given": given, "digits": digits})
        row = cursor.fetchone()
    return row[0] if row else None


def add(journey: Journey, given: str, note: str = "", user_id=None) -> dict:
    """Adds the customer `given` names; a customer who is inside leaves now. -> {added, party_id, exited} or a ValueError."""
    party_id = resolve(journey.tenant_id, given)
    if party_id is None:
        raise ValueError("No customer has that email address, mobile number or id.")
    note = (note or "").strip()[:MAX_NOTE]
    with _conn().cursor() as cursor:
        cursor.execute("""INSERT INTO journey_suppression (tenant_id, journey_id, party_id, given, note, created_by)
                          VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (journey_id, party_id) DO NOTHING RETURNING id::text""",
                       [str(journey.tenant_id), str(journey.pk), party_id, given.strip()[:200], note, str(user_id) if user_id else None])
        added = cursor.fetchone() is not None
        cursor.execute("""WITH gone AS (
                              UPDATE journey_enrollment SET status = 'EXITED', exited_at = %(now)s, exit_reason = %(reason)s
                               WHERE tenant_id = %(tenant)s AND journey_id = %(journey)s AND party_id = %(party)s AND status = 'ACTIVE' RETURNING id)
                          UPDATE journey_customer_state s SET next_scheduled_at = NULL, state_data = s.state_data - 'pending' FROM gone WHERE s.journey_enrollment_id = gone.id""",
                       {"now": timezone.now(), "reason": REASON, "tenant": str(journey.tenant_id), "journey": str(journey.pk), "party": party_id})
        exited = cursor.rowcount
    return {"added": added, "party_id": party_id, "exited": exited}


def remove(journey: Journey, suppression_id) -> bool:
    with _conn().cursor() as cursor:
        cursor.execute("DELETE FROM journey_suppression WHERE tenant_id = %s AND journey_id = %s AND id = %s", [str(journey.tenant_id), str(journey.pk), str(suppression_id)])
        return cursor.rowcount > 0
