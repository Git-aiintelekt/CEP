"""One customer across the workspace: the record C360 synced (or an upload added), their consent per channel, the lists they
are on, the events received for them, their orders, their messages and every journey they entered. The customer page reads it
(GET /customers/{party_id}/); GET /customers/?q= finds a customer by name, email address, mobile number or id.

Everything is read from the tenant's own tables under RLS; nothing is written.
"""
import re

from apps.delivery.engine import session
from apps.journeys import events as journey_events
from apps.journeys.timeline import _json, _step_words

PAGE_SIZE = 25
PHONE_LIKE = re.compile(r"[0-9+()./ -]+")
EVENTS, ORDERS, MESSAGES = 50, 20, 30

SEARCH_SQL = """
SELECT cm.party_id, cm.first_name, cm.last_name, lower(cm.emails -> 0 ->> 'address'), cm.phones -> 0 ->> 'number', cm.source_system, cm.synced_at,
       count(*) OVER () AS total
  FROM customer_master cm
 WHERE cm.tenant_id = %(tenant)s
   AND (%(q)s = '' OR cm.party_id = %(q)s OR cm.first_name ILIKE %(like)s OR cm.last_name ILIKE %(like)s
        OR (coalesce(cm.first_name, '') || ' ' || coalesce(cm.last_name, '')) ILIKE %(like)s
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(cm.emails) e WHERE lower(e ->> 'address') LIKE %(lower_like)s)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(cm.phones) p WHERE regexp_replace(p ->> 'number', '[^0-9]', '', 'g') LIKE %(digits_like)s))
 ORDER BY cm.last_name NULLS LAST, cm.first_name NULLS LAST, cm.party_id LIMIT %(limit)s OFFSET %(offset)s"""

RECORD_SQL = """SELECT party_id, first_name, last_name, emails, phones, primary_address, custom_attributes, source_system, synced_at
                  FROM customer_master WHERE tenant_id = %(tenant)s AND party_id = %(party)s"""
CONSENT_SQL = """SELECT channel, consent_status, marketable, marketable_reason, opted_in_at, opted_out_at, opt_out_method, suppressed, suppression_reason, updated_at
                   FROM consent_suppression WHERE tenant_id = %(tenant)s AND party_id = %(party)s ORDER BY channel"""
LISTS_SQL = """SELECT l.id::text, l.name, l.source_type, m.membership_source, m.added_at
                 FROM contact_list_member m JOIN contact_list l ON l.id = m.contact_list_id AND l.tenant_id = m.tenant_id
                WHERE m.tenant_id = %(tenant)s AND m.party_id = %(party)s AND l.deleted_at IS NULL
                  AND NOT (l.source_type = 'EXTRACTION' AND coalesce(l.source_reference, '') LIKE 'journey:%%')
                ORDER BY m.added_at DESC"""
EVENTS_SQL = """SELECT id, event_type, event_source, external_id, event_payload, occurred_at, ingested_at
                  FROM journey_event WHERE tenant_id = %(tenant)s AND party_id = %(party)s ORDER BY occurred_at DESC, id DESC LIMIT %(limit)s"""
ORDERS_SQL = """SELECT o.order_ref, o.kind, o.amount, o.currency, o.ordered_at, o.channel, o.status, o.campaign_id::text, c.name
                  FROM attributed_order o LEFT JOIN campaign c ON c.id = o.campaign_id
                 WHERE o.tenant_id = %(tenant)s AND o.party_id = %(party)s ORDER BY o.ordered_at DESC LIMIT %(limit)s"""
MESSAGES_SQL = """
SELECT * FROM (
    SELECT 'EMAIL' AS channel, x.campaign_id::text, c.name, c.is_journey_generated, x.status, x.status_reason, x.submitted_at, x.delivered_at, x.opened_at, x.clicked_at, x.created_at
      FROM mailer_execution x LEFT JOIN campaign c ON c.id = x.campaign_id WHERE x.tenant_id = %(tenant)s AND x.party_id = %(party)s
    UNION ALL
    SELECT x.message_type, x.campaign_id::text, c.name, c.is_journey_generated, x.status, x.status_reason, x.submitted_at, x.delivered_at, NULL, NULL, x.created_at
      FROM sms_execution x LEFT JOIN campaign c ON c.id = x.campaign_id WHERE x.tenant_id = %(tenant)s AND x.party_id = %(party)s) m
 ORDER BY coalesce(m.submitted_at, m.created_at) DESC LIMIT %(limit)s"""
JOURNEYS_SQL = """
SELECT e.id::text, j.id::text, j.name, j.status, v.version_number, e.enrolled_at, e.status, e.converted_at, e.attributed_revenue, e.exited_at, e.exit_reason,
       n.node_key, n.node_type, n.config, s.next_scheduled_at
  FROM journey_enrollment e
  JOIN journey j ON j.id = e.journey_id
  JOIN journey_version v ON v.id = e.journey_version_id
  LEFT JOIN journey_customer_state s ON s.journey_enrollment_id = e.id
  LEFT JOIN journey_node n ON n.id = s.current_node_id
 WHERE e.tenant_id = %(tenant)s AND e.party_id = %(party)s AND j.deleted_at IS NULL
 ORDER BY e.enrolled_at DESC"""
SUPPRESSED_SQL = """SELECT j.id::text, j.name, s.note, s.created_at FROM journey_suppression s JOIN journey j ON j.id = s.journey_id
                     WHERE s.tenant_id = %(tenant)s AND s.party_id = %(party)s AND j.deleted_at IS NULL ORDER BY s.created_at DESC"""


def _name(first, last, party_id) -> str:
    return " ".join(part for part in (first, last) if part) or party_id


def search(tenant_id, q: str = "", page: int = 1, page_size: int = PAGE_SIZE) -> dict:
    """Customers whose name, email address, mobile number or id match ?q=, a page at a time."""
    page_size = max(1, min(int(page_size or PAGE_SIZE), 200))
    page = max(1, int(page or 1))
    q = (q or "").strip()[:120]
    digits = "".join(ch for ch in q if ch.isdigit()) if PHONE_LIKE.fullmatch(q) else ""
    args = {"tenant": str(tenant_id), "q": q, "like": f"%{q}%", "lower_like": f"%{q.lower()}%", "digits_like": f"%{digits}%" if digits else None,
            "limit": page_size, "offset": (page - 1) * page_size}
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(SEARCH_SQL, args)
        rows = cursor.fetchall()
    total = rows[0][-1] if rows else 0
    return {"count": total, "page": page, "page_size": page_size,
            "results": [{"party_id": party, "name": _name(first, last, party), "email": email, "phone": phone, "source_system": source, "synced_at": synced}
                        for party, first, last, email, phone, source, synced, _total in rows]}


def record(tenant_id, party_id: str) -> dict | None:
    """Everything the customer page shows for one customer, or None when the records do not hold them."""
    args = {"tenant": str(tenant_id), "party": party_id, "limit": EVENTS}
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(RECORD_SQL, args)
        row = cursor.fetchone()
        if row is None:
            return None
        party, first, last, emails, phones, address, attributes, source, synced = row
        customer = {"party_id": party, "first_name": first, "last_name": last, "name": _name(first, last, party), "emails": _json(emails) if emails else [],
                    "phones": _json(phones) if phones else [], "primary_address": _json(address) if address else None, "custom_attributes": _json(attributes) if attributes else {},
                    "source_system": source, "synced_at": synced}
        cursor.execute(CONSENT_SQL, args)
        consent = [{"channel": channel, "consent_status": status, "marketable": bool(marketable), "marketable_reason": reason, "opted_in_at": opted_in, "opted_out_at": opted_out,
                    "opt_out_method": method, "suppressed": bool(suppressed), "suppression_reason": why, "updated_at": updated}
                   for channel, status, marketable, reason, opted_in, opted_out, method, suppressed, why, updated in cursor.fetchall()]
        cursor.execute(LISTS_SQL, args)
        lists = [{"id": pk, "name": name, "source_type": source_type, "membership_source": how, "added_at": added} for pk, name, source_type, how, added in cursor.fetchall()]
        cursor.execute(EVENTS_SQL, args)
        events = [{"id": pk, "event_type": kind, "label": journey_events.label(kind), "source": where, "event_id": external, "payload": _json(payload) if payload else {},
                   "occurred_at": occurred, "received_at": received}
                  for pk, kind, where, external, payload, occurred, received in cursor.fetchall()]
        cursor.execute(ORDERS_SQL, {**args, "limit": ORDERS})
        orders = [{"order_ref": ref, "kind": kind, "amount": float(amount), "currency": currency, "ordered_at": when, "channel": channel, "status": status,
                   "campaign_id": campaign_id, "campaign_name": campaign_name}
                  for ref, kind, amount, currency, when, channel, status, campaign_id, campaign_name in cursor.fetchall()]
        cursor.execute(MESSAGES_SQL, {**args, "limit": MESSAGES})
        messages = [{"channel": channel, "campaign_id": campaign_id, "campaign_name": name, "journey_generated": bool(generated), "status": status, "status_reason": reason,
                     "submitted_at": submitted, "delivered_at": delivered, "opened_at": opened, "clicked_at": clicked, "at": submitted or created}
                    for channel, campaign_id, name, generated, status, reason, submitted, delivered, opened, clicked, created in cursor.fetchall()]
        cursor.execute(JOURNEYS_SQL, args)
        journeys = []
        for (enrollment_id, journey_id, journey_name, journey_status, version_number, enrolled_at, state, converted_at, revenue, exited_at, exit_reason,
             node_key, node_type, config, next_at) in cursor.fetchall():
            journeys.append({"enrollment_id": enrollment_id, "journey_id": journey_id, "journey_name": journey_name, "journey_status": journey_status,
                             "version_number": version_number, "enrolled_at": enrolled_at, "status": state, "converted_at": converted_at,
                             "attributed_revenue": float(revenue) if revenue is not None else None, "exited_at": exited_at, "exit_reason": exit_reason,
                             "where": None if state != "ACTIVE" or node_key is None else {"node_key": node_key, "node_type": node_type, "label": _step_words(node_type, _json(config)),
                                                                                           "next_scheduled_at": next_at}})
        cursor.execute(SUPPRESSED_SQL, args)
        suppressed = [{"journey_id": pk, "journey_name": name, "note": note, "created_at": created} for pk, name, note, created in cursor.fetchall()]
    return {"customer": customer, "consent": consent, "lists": lists, "events": events, "orders": orders, "messages": messages, "journeys": journeys,
            "journey_suppressions": suppressed}
