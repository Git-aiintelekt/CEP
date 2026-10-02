"""Contact lists beyond the upload: a list from an audience the data team defined, a clone, the people in a list, and
where a list is used. Runs inside the request's transaction, under the tenant's row-level security.

A campaign never reads a contact list while it sends: at send time the attached lists are merged into a frozen campaign
list. So editing a list is always safe for what was already built from it, and that is what the usage answer tells the
operator (`live`, `frozen`).
"""
import re

from django.db import connections
from django.utils import timezone

from apps.tenants import context

from . import governance
from .imports import EMAIL_RE, PARTY_ID
from .models import ContactList

LIVE = ("PRODUCTION_PUBLISHED", "ACTIVE")                 # a campaign that is sending or will send without anyone touching it
MANUAL_LIMIT = 500
_EMAIL = re.compile(EMAIL_RE)
PRIMARY_EMAIL = """(SELECT lower(e ->> 'address') FROM jsonb_array_elements(cm.emails) e WHERE COALESCE(e ->> 'address', '') <> ''
                     ORDER BY COALESCE((e ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1)"""


class ListError(Exception):
    """Something the operator can fix: the message is shown as is."""


def _conn():
    return connections[context.require().db_alias]


def _count(cursor, tenant_id, list_id) -> int:
    cursor.execute("SELECT count(*) FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s", [str(tenant_id), str(list_id)])
    return cursor.fetchone()[0]


def _touch(contact_list: ContactList, members: int, user_id=None, refreshed: bool = False):
    fields = {"member_count": members}
    if refreshed:
        fields["last_refreshed_at"] = timezone.now()
    if user_id:
        fields["updated_by_id"] = user_id
    ContactList.objects.filter(pk=contact_list.pk).update(**fields)
    contact_list.member_count = members


# ---------------------------------------------------------------- audiences (BI / extraction)
def audiences(tenant_id) -> list[dict]:
    """What the data team defined for this workspace: the C360 segments, with how many people qualify today."""
    with _conn().cursor() as cursor:
        cursor.execute("""SELECT s.id, s.code, s.name, s.description, s.source_system, s.synced_at,
                                 (SELECT count(*) FROM customer_segment_membership m WHERE m.tenant_id = s.tenant_id AND m.segment_id = s.id),
                                 (SELECT count(*) FROM contact_list l WHERE l.tenant_id = s.tenant_id AND l.deleted_at IS NULL AND l.criteria ->> 'segment_id' = s.id::text)
                            FROM segment s WHERE s.tenant_id = %s ORDER BY s.name""", [str(tenant_id)])
        return [{"id": str(pk), "code": code, "name": name, "description": description, "source_system": source, "synced_at": synced,
                 "member_count": members, "list_count": lists} for pk, code, name, description, source, synced, members, lists in cursor.fetchall()]


def sync_from_segment(contact_list: ContactList, user_id=None) -> dict:
    """Brings an audience list in line with its segment: people who qualify now are added, people who no longer do are
    removed. Contacts someone added by hand stay."""
    segment_id = (contact_list.criteria or {}).get("segment_id")
    if not segment_id:
        raise ListError("This list does not follow an audience.")
    tenant, pk = str(contact_list.tenant_id), str(contact_list.pk)
    with _conn().cursor() as cursor:
        cursor.execute("""DELETE FROM contact_list_member m
                           WHERE m.tenant_id = %s AND m.contact_list_id = %s AND m.membership_source = 'SEGMENT'
                             AND NOT EXISTS (SELECT 1 FROM customer_segment_membership s WHERE s.tenant_id = m.tenant_id AND s.segment_id = %s AND s.party_id = m.party_id)""",
                       [tenant, pk, segment_id])
        removed = cursor.rowcount
        cursor.execute("""INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id, membership_source, matched_by)
                          SELECT %s, s.tenant_id, s.party_id, 'SEGMENT', 'PARTY_ID' FROM customer_segment_membership s
                           WHERE s.tenant_id = %s AND s.segment_id = %s
                          ON CONFLICT (tenant_id, contact_list_id, party_id) DO NOTHING""", [pk, tenant, segment_id])
        added = cursor.rowcount
        members = _count(cursor, tenant, pk)
    _touch(contact_list, members, user_id, refreshed=True)
    return {"added": added, "removed": removed, "member_count": members}


def create_from_audience(*, tenant_id, segment_id, name, description, environment, channel="EMAIL", user_id=None) -> ContactList:
    with _conn().cursor() as cursor:
        cursor.execute("SELECT code, name, source_system FROM segment WHERE tenant_id = %s AND id = %s", [str(tenant_id), str(segment_id)])
        row = cursor.fetchone()
    if row is None:
        raise ListError("This audience no longer exists. Choose another one.")
    code, segment_name, source = row
    contact_list = ContactList.objects.create(
        tenant_id=tenant_id, name=name, description=description or None, source_type=ContactList.SourceType.BI, source_reference=f"{segment_name} ({code})"[:300],
        list_kind=ContactList.ListKind.SEGMENT, is_master=True, criteria={"segment_id": str(segment_id), "segment_code": code, "source_system": source},
        refresh_mode=ContactList.RefreshMode.SCHEDULED, refresh_interval_minutes=60, list_environment=environment, channel=channel, status=ContactList.Status.ACTIVE, created_by_id=user_id)
    sync_from_segment(contact_list, user_id)
    return contact_list


def refresh_due(tenant_id) -> int:
    """For the scheduled job: audience lists whose interval has passed."""
    due = ContactList.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True, status=ContactList.Status.ACTIVE, list_kind=ContactList.ListKind.SEGMENT,
                                     refresh_mode=ContactList.RefreshMode.SCHEDULED, criteria__has_key="segment_id")
    done, now = 0, timezone.now()
    for contact_list in due:
        minutes = contact_list.refresh_interval_minutes or 60
        if contact_list.last_refreshed_at is None or (now - contact_list.last_refreshed_at).total_seconds() >= minutes * 60:
            sync_from_segment(contact_list)
            done += 1
    return done


# ---------------------------------------------------------------- clone
def clone(source: ContactList, *, name, description, environment, channel=None, user_id=None) -> ContactList:
    """A snapshot: the people who are in the source now. The two lists are independent from here on."""
    if source.status == ContactList.Status.DRAFT:
        raise ListError("This list is still being imported. Finish or cancel the import first.")
    copy = ContactList.objects.create(
        tenant_id=source.tenant_id, name=name, description=description or None, source_type=ContactList.SourceType.CLONE, source_reference=source.name[:300],
        list_kind=ContactList.ListKind.STATIC, is_master=True, parent_contact_list=source, refresh_mode=ContactList.RefreshMode.MANUAL,
        list_environment=environment, channel=channel or source.channel, status=ContactList.Status.ACTIVE, created_by_id=user_id)
    with _conn().cursor() as cursor:
        cursor.execute("""INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id, custom_attributes, membership_source, matched_by)
                          SELECT %s, m.tenant_id, m.party_id, m.custom_attributes, 'CLONE', m.matched_by
                            FROM contact_list_member m WHERE m.tenant_id = %s AND m.contact_list_id = %s""", [str(copy.pk), str(source.tenant_id), str(source.pk)])
        members = cursor.rowcount
    _touch(copy, members, refreshed=True)
    return copy


# ---------------------------------------------------------------- the people in a list
MEMBER_STATUSES = ("MARKETABLE", "UNSUBSCRIBED", "HARD_BOUNCE", "SOFT_BOUNCE", "COMPLAINT", "BLOCKED", "INVALID_ADDRESS", "SUPPRESSED", "NO_CONSENT")


def members(contact_list: ContactList, *, search: str = "", source: str = "", status: str = "", page: int = 1, page_size: int = 50, ids: list[int] | None = None) -> dict:
    """`status`: one of MEMBER_STATUSES (the marketing-email verdict), or SENDABLE / NOT_SENDABLE."""
    tenant, pk = str(contact_list.tenant_id), str(contact_list.pk)
    where, params = ["m.tenant_id = %(tenant)s", "m.contact_list_id = %(list)s"], {"tenant": tenant, "list": pk}
    if status:
        status = status.upper()
        if status == "SENDABLE":
            where.append(f"({governance.status_sql()}) = 'MARKETABLE'")
        elif status == "NOT_SENDABLE":
            where.append(f"({governance.status_sql()}) <> 'MARKETABLE'")
        elif status in MEMBER_STATUSES:
            params["status"] = status
            where.append(f"({governance.status_sql()}) = %(status)s")
        else:
            raise ListError("Filter by a consent state: sendable, not sendable, unsubscribed, bounced, complaint, blocked, invalid, suppressed or no consent.")
    if search:
        params["q"] = f"%{search.strip().lower()}%"
        where.append(f"""(lower(COALESCE(cm.first_name, '') || ' ' || COALESCE(cm.last_name, '')) LIKE %(q)s OR {PRIMARY_EMAIL} LIKE %(q)s
                          OR lower(m.party_id) LIKE %(q)s)""")
    if source:
        params["source"] = source
        where.append("m.membership_source = %(source)s")
    if ids is not None:
        params["ids"] = ids
        where.append("m.id = ANY(%(ids)s)")
    clause = " AND ".join(where)
    joins = f"""LEFT JOIN customer_master cm ON cm.party_id = m.party_id AND cm.tenant_id = m.tenant_id
                LEFT JOIN consent_suppression cs ON cs.tenant_id = m.tenant_id AND cs.party_id = m.party_id AND cs.channel = 'EMAIL'
                LEFT JOIN contact_point_status cps ON cps.tenant_id = m.tenant_id AND cps.contact_point_type = 'EMAIL' AND cps.contact_value = {governance.PRIMARY_EMAIL_SQL}::citext"""
    with _conn().cursor() as cursor:
        if search or source or status or ids is not None:
            cursor.execute(f"SELECT count(*) FROM contact_list_member m {joins} WHERE {clause}", params)
            total = cursor.fetchone()[0]
        else:
            total = _count(cursor, tenant, pk)
        params.update({"limit": page_size, "offset": (page - 1) * page_size})
        cursor.execute(f"""SELECT m.id, m.party_id, {PRIMARY_EMAIL}, COALESCE(cm.first_name, m.custom_attributes ->> 'first_name'),
                                  COALESCE(cm.last_name, m.custom_attributes ->> 'last_name'), m.added_at, m.membership_source, cm.party_id IS NOT NULL,
                                  (SELECT p ->> 'number' FROM jsonb_array_elements(cm.phones) p ORDER BY COALESCE((p ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1),
                                  {governance.status_sql()}
                             FROM contact_list_member m {joins}
                            WHERE {clause} ORDER BY m.added_at DESC, m.id DESC LIMIT %(limit)s OFFSET %(offset)s""", params)
        rows = [{"id": mid, "party_id": party, "email": email, "first_name": first, "last_name": last, "added_at": added, "source": src, "known": known, "mobile": mobile,
                 "email_status": verdict, "email_status_label": governance.label(verdict), "sendable": governance.STATUSES[verdict][1]}
                for mid, party, email, first, last, added, src, known, mobile, verdict in cursor.fetchall()]
    return {"count": total, "page": page, "page_size": page_size, "results": rows}


def add_manually(contact_list: ContactList, contacts: list[dict], user_id=None) -> dict:
    """Adds people by email address. Someone CEP does not know yet becomes a customer row owned by CEP, as in an upload."""
    if contact_list.status == ContactList.Status.ARCHIVED:
        raise ListError("An archived list cannot be changed. Restore it first.")
    if len(contacts) > MANUAL_LIMIT:
        raise ListError(f"Add up to {MANUAL_LIMIT} contacts at a time. For more, upload a file.")
    tenant, pk = str(contact_list.tenant_id), str(contact_list.pk)
    invalid, wanted = [], {}
    for contact in contacts:
        email = (contact.get("email") or "").strip().lower()
        if not email:
            continue
        if len(email) > 254 or not _EMAIL.match(email):
            invalid.append(email)
            continue
        wanted.setdefault(email, contact)
    added = already = created = 0
    with _conn().cursor() as cursor:
        for email, contact in wanted.items():
            cursor.execute("""SELECT min(cm.party_id) FROM customer_master cm, jsonb_array_elements(cm.emails) e
                               WHERE cm.tenant_id = %s AND lower(e ->> 'address') = %s""", [tenant, email])
            party = cursor.fetchone()[0]
            if party is None:
                cursor.execute(f"""INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, source_system, is_synced_copy)
                                   SELECT {PARTY_ID.format(email='%(email)s::text')}, r.tenant_id, %(first)s, %(last)s,
                                          jsonb_build_array(jsonb_build_object('address', %(email)s::text, 'is_primary', TRUE, 'is_valid', TRUE)), 'CEP_MANUAL', FALSE
                                     FROM (SELECT %(tenant)s::uuid AS tenant_id) r
                                   ON CONFLICT (party_id) DO UPDATE SET party_id = EXCLUDED.party_id RETURNING party_id""",
                               {"email": email, "tenant": tenant, "first": (contact.get("first_name") or "").strip()[:120] or None,
                                "last": (contact.get("last_name") or "").strip()[:120] or None})
                party = cursor.fetchone()[0]
                created += 1
            cursor.execute("""INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id, membership_source, matched_by)
                              VALUES (%s, %s, %s, 'MANUAL', 'EMAIL') ON CONFLICT (tenant_id, contact_list_id, party_id) DO NOTHING""", [pk, tenant, party])
            if cursor.rowcount:
                added += 1
            else:
                already += 1
        total = _count(cursor, tenant, pk)
    _touch(contact_list, total, user_id)
    return {"added": added, "already_in_list": already, "new_people": created, "invalid": invalid, "member_count": total}


def remove(contact_list: ContactList, member_ids: list[int], user_id=None) -> dict:
    if contact_list.status == ContactList.Status.ARCHIVED:
        raise ListError("An archived list cannot be changed. Restore it first.")
    tenant, pk = str(contact_list.tenant_id), str(contact_list.pk)
    with _conn().cursor() as cursor:
        cursor.execute("DELETE FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s AND id = ANY(%s)", [tenant, pk, list(member_ids)])
        removed = cursor.rowcount
        total = _count(cursor, tenant, pk)
    _touch(contact_list, total, user_id)
    return {"removed": removed, "member_count": total}


def remove_all(contact_list: ContactList):
    """Before a list is deleted: its members and whatever its imports staged go with it."""
    tenant, pk = str(contact_list.tenant_id), str(contact_list.pk)
    with _conn().cursor() as cursor:
        cursor.execute("DELETE FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s", [tenant, pk])
        cursor.execute("""DELETE FROM contact_list_import_row r USING contact_list_import i
                           WHERE r.tenant_id = %s AND i.tenant_id = r.tenant_id AND i.id = r.import_id AND i.contact_list_id = %s""", [tenant, pk])


def governance_now(contact_list: ContactList) -> dict:
    """The list's people as a marketing email send would judge them today. One set-based query over indexed keys."""
    with _conn().cursor() as cursor:
        cursor.execute(f"""SELECT v.status, count(*) FROM (
                               SELECT {governance.status_sql()} AS status
                                 FROM contact_list_member m LEFT JOIN customer_master cm ON cm.party_id = m.party_id AND cm.tenant_id = m.tenant_id
                                 LEFT JOIN consent_suppression cs ON cs.tenant_id = m.tenant_id AND cs.party_id = m.party_id AND cs.channel = 'EMAIL'
                                 LEFT JOIN contact_point_status cps ON cps.tenant_id = m.tenant_id AND cps.contact_point_type = 'EMAIL'
                                      AND cps.contact_value = {governance.PRIMARY_EMAIL_SQL}::citext
                                WHERE m.tenant_id = %s AND m.contact_list_id = %s) v GROUP BY 1""", [str(contact_list.tenant_id), str(contact_list.pk)])
        counts = dict(cursor.fetchall())
    total = sum(counts.values())
    return {"total": total, "sendable": int(counts.get("MARKETABLE", 0)), "not_sendable": total - int(counts.get("MARKETABLE", 0)),
            "statuses": governance.breakdown(counts), "checked_at": timezone.now()}


TEXT_STATUS_SQL = """CASE WHEN ph.number IS NULL THEN 'NO_PHONE' WHEN cps.blocked THEN 'BLOCKED' WHEN cs.consent_status = 'OPTED_OUT' THEN 'UNSUBSCRIBED'
                          WHEN COALESCE(cs.consent_status, 'UNKNOWN') <> 'OPTED_IN' THEN 'NO_CONSENT' ELSE 'MARKETABLE' END"""


def reach(contact_list: ContactList) -> dict:
    """How many of the list's people a marketing send could reach today, by channel: what the audience build computes for a campaign."""
    email = governance_now(contact_list)
    with _conn().cursor() as cursor:
        cursor.execute(f"""SELECT v.status, count(*) FROM (
                               SELECT {TEXT_STATUS_SQL} AS status
                                 FROM contact_list_member m LEFT JOIN customer_master cm ON cm.party_id = m.party_id AND cm.tenant_id = m.tenant_id
                                 LEFT JOIN LATERAL (SELECT p ->> 'number' AS number FROM jsonb_array_elements(cm.phones) p
                                                     ORDER BY COALESCE((p ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1) ph ON TRUE
                                 LEFT JOIN consent_suppression cs ON cs.tenant_id = m.tenant_id AND cs.party_id = m.party_id AND cs.channel = 'SMS'
                                 LEFT JOIN contact_point_status cps ON cps.tenant_id = m.tenant_id AND cps.contact_point_type = 'PHONE' AND cps.contact_value = ph.number::citext
                                WHERE m.tenant_id = %s AND m.contact_list_id = %s) v GROUP BY 1""", [str(contact_list.tenant_id), str(contact_list.pk)])
        texts = dict(cursor.fetchall())
    total_texts = sum(texts.values())
    return {"email": {"total": email["total"], "sendable": email["sendable"]}, "sms": {"total": total_texts, "sendable": int(texts.get("MARKETABLE", 0)),
            "no_phone": int(texts.get("NO_PHONE", 0))}, "checked_at": timezone.now()}


# ---------------------------------------------------------------- where a list is used
def usage(contact_list: ContactList) -> dict:
    with _conn().cursor() as cursor:
        cursor.execute("""SELECT c.id, c.name, c.code, c.status, c.channel, c.scheduled_at, l.attached_at,
                                 (SELECT count(*) FROM campaign_list cl WHERE cl.tenant_id = c.tenant_id AND cl.campaign_id = c.id AND cl.status = 'FROZEN')
                            FROM contact_list_campaign l JOIN campaign c ON c.id = l.campaign_id AND c.tenant_id = l.tenant_id
                           WHERE l.tenant_id = %s AND l.contact_list_id = %s AND c.deleted_at IS NULL ORDER BY l.attached_at DESC""",
                       [str(contact_list.tenant_id), str(contact_list.pk)])
        campaigns = [{"id": str(pk), "name": name, "code": code, "status": status, "channel": channel, "scheduled_at": scheduled, "attached_at": attached,
                      "live": status in LIVE, "frozen_lists": frozen} for pk, name, code, status, channel, scheduled, attached, frozen in cursor.fetchall()]
        cursor.execute("SELECT count(*) FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s AND added_at > now() - interval '7 days'",
                       [str(contact_list.tenant_id), str(contact_list.pk)])
        week = cursor.fetchone()[0]
    return {"campaigns": campaigns, "attached_campaigns": len(campaigns), "live_campaigns": sum(1 for c in campaigns if c["live"]), "added_this_week": week}


def stats(tenant_id) -> dict:
    with _conn().cursor() as cursor:
        cursor.execute("""SELECT (SELECT count(*) FROM contact_list l WHERE l.tenant_id = %(t)s AND l.deleted_at IS NULL AND l.status <> 'DRAFT'),
                                 (SELECT count(DISTINCT m.party_id) FROM contact_list_member m JOIN contact_list l ON l.id = m.contact_list_id
                                   WHERE m.tenant_id = %(t)s AND l.deleted_at IS NULL AND l.status <> 'DRAFT'),
                                 (SELECT count(DISTINCT lc.contact_list_id) FROM contact_list_campaign lc JOIN campaign c ON c.id = lc.campaign_id
                                    JOIN contact_list l ON l.id = lc.contact_list_id
                                   WHERE lc.tenant_id = %(t)s AND c.deleted_at IS NULL AND l.deleted_at IS NULL AND c.status = ANY(%(live)s))""",
                       {"t": str(tenant_id), "live": list(LIVE)})
        lists, people, live = cursor.fetchone()
    return {"total_lists": lists, "total_contacts": people, "attached_to_live_campaigns": live}
