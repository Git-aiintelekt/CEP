"""Suppressions: every address and number the engine will not send to, with the reason and the date, in one list.

Two tables feed it. contact_point_status holds what happened to an address or number (a hard bounce, a complaint, a
block by a person or an import); consent_suppression holds what the person decided (unsubscribed, replied STOP).
A bounce or a block can be undone here; an opt-out or a complaint cannot: the person has to opt in again.
"""
import csv
import io
import re

from django.utils import timezone

from apps.tenants import context

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+[1-9]\d{7,14}$")
MAX_IMPORT = 5000
PAGE_MAX = 200

# reason code -> (label, filter group)
REASONS = {"HARD_BOUNCE": ("Hard Bounce", "BOUNCED"), "SOFT_BOUNCE_THRESHOLD": ("Bounced Repeatedly", "BOUNCED"), "INVALID": ("Invalid", "BOUNCED"),
           "COMPLAINT": ("Complaint", "COMPLAINED"), "MANUAL": ("Blocked", "BLOCKED"), "GLOBAL_SUPPRESSION_LIST": ("Blocked", "BLOCKED"),
           "DND_REGISTRY": ("Do-Not-Disturb Registry", "BLOCKED"), "UNSUBSCRIBED": ("Unsubscribed", "UNSUBSCRIBED"), "OPTED_OUT": ("Opted Out", "UNSUBSCRIBED")}
GROUPS = {"UNSUBSCRIBED": "Unsubscribed", "BOUNCED": "Bounced", "COMPLAINED": "Complained", "BLOCKED": "Blocked by You"}
SOURCES = {"PROVIDER": "The sending engine", "POSTAL": "Postal", "DIGIVIZE": "Digivize", "IMPORT": "Import", "CSR": "Added by a person", "C360": "Customer 360",
           "UNSUBSCRIBE_LINK": "Unsubscribe link", "SMS_STOP": "Replied STOP", "PREFERENCE_CENTER": "Preference centre", "COMPLAINT": "Spam report"}

PRIMARY_EMAIL = "(SELECT lower(e ->> 'address') FROM jsonb_array_elements(cm.emails) e ORDER BY COALESCE((e ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1)"
PRIMARY_PHONE = "(SELECT e ->> 'number' FROM jsonb_array_elements(cm.phones) e ORDER BY COALESCE((e ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1)"

ROWS = f"""
    SELECT 'CONTACT_POINT' AS kind, cps.id::text AS id, CASE cps.contact_point_type WHEN 'EMAIL' THEN 'EMAIL' ELSE 'PHONE' END AS channel, cps.contact_value::text AS contact,
           cps.party_id, cm.first_name, cm.last_name, COALESCE(cps.block_reason, 'MANUAL') AS reason, cps.block_source AS source, cps.last_bounce_reason AS detail,
           COALESCE(cps.blocked_at, cps.updated_at) AS since, cps.block_reason IS DISTINCT FROM 'COMPLAINT' AS can_unblock
      FROM contact_point_status cps LEFT JOIN customer_master cm ON cm.tenant_id = cps.tenant_id AND cm.party_id = cps.party_id
     WHERE cps.tenant_id = %(tenant)s AND cps.blocked
    UNION ALL
    SELECT 'CONSENT', cs.id::text, CASE cs.channel WHEN 'EMAIL' THEN 'EMAIL' ELSE 'PHONE' END,
           CASE cs.channel WHEN 'EMAIL' THEN {PRIMARY_EMAIL} ELSE {PRIMARY_PHONE} END, cs.party_id, cm.first_name, cm.last_name,
           CASE WHEN cs.opt_out_method = 'SMS_STOP' THEN 'OPTED_OUT' ELSE 'UNSUBSCRIBED' END, cs.opt_out_method, cs.suppression_reason,
           COALESCE(cs.opted_out_at, cs.updated_at), FALSE
      FROM consent_suppression cs LEFT JOIN customer_master cm ON cm.tenant_id = cs.tenant_id AND cm.party_id = cs.party_id
     WHERE cs.tenant_id = %(tenant)s AND cs.consent_status = 'OPTED_OUT' AND cs.channel IN ('EMAIL', 'SMS') AND cs.opt_out_method IS DISTINCT FROM 'COMPLAINT'
"""


class SuppressionError(Exception):
    """Refused in words the person should read."""


def _conn():
    from django.db import connections
    return connections[context.require().db_alias]


def _where(channel: str | None, group: str | None, search: str | None) -> tuple[str, dict]:
    clauses, args = [], {}
    if channel:
        clauses.append("t.channel = %(channel)s")
        args["channel"] = channel.upper()
    if group:
        codes = [code for code, (_, member) in REASONS.items() if member == group.upper()]
        if not codes:
            raise SuppressionError("Filter by unsubscribed, bounced, complained or blocked.")
        clauses.append("t.reason = ANY(%(codes)s)")
        args["codes"] = codes
    if search:
        clauses.append("(t.contact ILIKE %(search)s OR t.party_id ILIKE %(search)s OR (COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '')) ILIKE %(search)s)")
        args["search"] = f"%{search.strip()}%"
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", args


def _row(record) -> dict:
    kind, pk, channel, contact, party_id, first, last, reason, source, detail, since, can_unblock = record
    label, group = REASONS.get(reason, (reason.replace("_", " ").title(), "BLOCKED"))
    return {"kind": kind, "id": pk, "channel": channel, "contact": contact, "party_id": party_id, "name": " ".join(filter(None, [first, last])) or None,
            "reason": reason, "reason_label": label, "group": group, "source": source, "source_label": SOURCES.get(source or "", source), "detail": detail,
            "since": since, "can_unblock": bool(can_unblock)}


def listing(*, channel: str | None = None, group: str | None = None, search: str | None = None, page: int = 1, page_size: int = 50) -> dict:
    page, page_size = max(1, int(page)), min(PAGE_MAX, max(1, int(page_size)))
    where, args = _where(channel, group, search)
    args["tenant"] = str(context.require().tenant_id)
    with _conn().cursor() as cursor:
        cursor.execute(f"SELECT count(*) FROM ({ROWS}) t{where}", args)
        total = cursor.fetchone()[0]
        cursor.execute(f"SELECT * FROM ({ROWS}) t{where} ORDER BY t.since DESC NULLS LAST, t.contact LIMIT %(limit)s OFFSET %(offset)s",
                       {**args, "limit": page_size, "offset": (page - 1) * page_size})
        rows = [_row(record) for record in cursor.fetchall()]
    return {"count": total, "page": page, "page_size": page_size, "results": rows}


def rows_for_export(*, channel=None, group=None, search=None):
    where, args = _where(channel, group, search)
    args["tenant"] = str(context.require().tenant_id)
    with _conn().cursor() as cursor:
        cursor.execute(f"SELECT * FROM ({ROWS}) t{where} ORDER BY t.since DESC NULLS LAST, t.contact", args)
        for record in cursor:
            yield _row(record)


def summary() -> dict:
    args = {"tenant": str(context.require().tenant_id)}
    with _conn().cursor() as cursor:
        cursor.execute(f"""SELECT t.reason, t.channel, count(*), count(*) FILTER (WHERE t.since >= now() - interval '7 days') FROM ({ROWS}) t GROUP BY 1, 2""", args)
        groups = {key: {"key": key, "label": label, "count": 0, "email": 0, "phone": 0, "this_week": 0} for key, label in GROUPS.items()}
        total = week = 0
        for reason, channel, count, recent in cursor.fetchall():
            group = groups[REASONS.get(reason, ("", "BLOCKED"))[1]]
            group["count"] += count
            group["email" if channel == "EMAIL" else "phone"] += count
            group["this_week"] += recent
            total += count
            week += recent
    return {"total": total, "this_week": week, "groups": list(groups.values())}


def unblock(kind: str, pk: str, user=None) -> dict:
    if kind != "CONTACT_POINT":
        raise SuppressionError("An unsubscribe or an opt-out cannot be undone here: the person has to opt in again through a form, a reply or the preference centre.")
    tenant = str(context.require().tenant_id)
    with _conn().cursor() as cursor:
        cursor.execute("SELECT contact_value::text, block_reason, contact_point_type FROM contact_point_status WHERE tenant_id = %s AND id::text = %s AND blocked", [tenant, pk])
        found = cursor.fetchone()
        if found is None:
            raise SuppressionError("That address or number is not blocked.")
        contact, reason, kind_of = found
        if reason == "COMPLAINT":
            raise SuppressionError("A spam complaint cannot be undone: the person has to ask for messages again.")
        cursor.execute("""UPDATE contact_point_status SET blocked = FALSE, unblocked_at = now(), block_source = COALESCE(block_source, 'CSR'), updated_by = %s, updated_at = now()
                           WHERE tenant_id = %s AND id::text = %s""", [str(getattr(user, "pk", None)) if getattr(user, "pk", None) else None, tenant, pk])
    return {"contact": contact, "channel": "EMAIL" if kind_of == "EMAIL" else "PHONE", "was": reason, "unblocked_at": timezone.now()}


def normalise(value: str) -> tuple[str, str] | None:
    """('EMAIL', address) or ('PHONE', +number); None when it is neither."""
    value = (value or "").strip()
    if EMAIL_RE.match(value):
        return "EMAIL", value.lower()
    digits = re.sub(r"[\s().-]", "", value)
    if digits and not digits.startswith("+") and digits.isdigit() and len(digits) == 10:
        digits = "+1" + digits                              # a bare North American number
    if PHONE_RE.match(digits):
        return "PHONE", digits
    return None


def block(values: list[str], *, user=None, source: str = "CSR", note: str = "") -> dict:
    """Blocks addresses and numbers by hand or from an import (block_reason MANUAL). Returns what happened to each."""
    if len(values) > MAX_IMPORT:
        raise SuppressionError(f"Up to {MAX_IMPORT:,} addresses or numbers at a time.")
    tenant = str(context.require().tenant_id)
    outcome = {"blocked": 0, "already_blocked": 0, "invalid": []}
    seen = set()
    by = str(getattr(user, "pk", None)) if getattr(user, "pk", None) else None
    with _conn().cursor() as cursor:
        for raw in values:
            parsed = normalise(raw)
            if parsed is None:
                if raw and raw.strip():
                    outcome["invalid"].append(raw.strip()[:120])
                continue
            if parsed in seen:
                continue
            seen.add(parsed)
            kind, contact = parsed
            cursor.execute("""SELECT cm.party_id FROM customer_master cm WHERE cm.tenant_id = %s AND EXISTS (
                                  SELECT 1 FROM jsonb_array_elements(CASE WHEN %s = 'EMAIL' THEN cm.emails ELSE cm.phones END) e
                                   WHERE lower(COALESCE(e ->> 'address', e ->> 'number')) = %s) LIMIT 1""", [tenant, kind, contact])
            party = (cursor.fetchone() or [None])[0]
            cursor.execute("SELECT blocked FROM contact_point_status WHERE tenant_id = %s AND contact_point_type = %s AND contact_value = %s", [tenant, kind, contact])
            was_blocked = bool((cursor.fetchone() or [False])[0])
            cursor.execute("""INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, blocked, block_reason, block_source, blocked_at,
                                                                last_bounce_reason, updated_by)
                              VALUES (%s, %s, %s, %s, TRUE, 'MANUAL', %s, now(), %s, %s)
                              ON CONFLICT (tenant_id, contact_point_type, contact_value) DO UPDATE
                                 SET blocked = TRUE, block_reason = CASE WHEN contact_point_status.blocked THEN contact_point_status.block_reason ELSE 'MANUAL' END,
                                     block_source = CASE WHEN contact_point_status.blocked THEN contact_point_status.block_source ELSE EXCLUDED.block_source END,
                                     blocked_at = COALESCE(contact_point_status.blocked_at, EXCLUDED.blocked_at), unblocked_at = NULL,
                                     last_bounce_reason = COALESCE(EXCLUDED.last_bounce_reason, contact_point_status.last_bounce_reason),
                                     party_id = COALESCE(contact_point_status.party_id, EXCLUDED.party_id), updated_by = EXCLUDED.updated_by, updated_at = now()""",
                           [tenant, kind, contact, party, source[:40], (note or "")[:200] or None, by])
            outcome["already_blocked" if was_blocked else "blocked"] += 1
    outcome["invalid_count"] = len(outcome["invalid"])
    outcome["invalid"] = outcome["invalid"][:20]
    return outcome


def values_from_upload(data: bytes) -> list[str]:
    """Every cell of a CSV (or one value per line) that could be an address or a number; a header row is skipped by nature."""
    text = data.decode("utf-8-sig", errors="replace")
    values = []
    for row in csv.reader(io.StringIO(text)):
        for cell in row:
            if normalise(cell):
                values.append(cell.strip())
    return values[:MAX_IMPORT + 1]
