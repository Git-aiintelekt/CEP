"""Unengaged Contacts (patch 0094): marketing email leaves out people who have long stopped engaging, to keep the workspace out
of spam folders. Mailbox providers judge a sender partly by how many recipients ignore it.

A person is unengaged when, for the strictest active rule (fewest days D, fewest emails M):
  - their first marketing email went out at least D days ago, so CEP has watched them for the whole period;
  - they were sent at least M marketing emails in the last D days;
  - in those D days they made no email click, text link click, purchase (an order, an e-receipt) or preference-page visit.
Opens are not counted (Apple Mail opens every message on its own), nor clicks a security scanner made (tracking_event.is_bot).
Email only; transactional messages and e-receipts are never held back. Nobody is unsubscribed: the next engagement brings the
person back on the next send. A campaign with include_unengaged (a win-back campaign) reaches them.

Every check reads the source tables (no stored score), so it is always as current as the last click. D is at most 360: click
history (tracking_event) is kept 12 months.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from django.core.cache import cache
from django.db import connection
from django.utils import timezone

from apps.governance.models import CommunicationGovernancePolicy

MIN_DAYS, MAX_DAYS = 30, 360
MIN_EMAILS, MAX_EMAILS = 1, 20
RECOMMENDED_DAYS, RECOMMENDED_EMAILS = 180, 5
SENT = "('QUEUED', 'FAILED')"
MARKETING_EMAIL = "JOIN campaign mc ON mc.id = x.campaign_id AND mc.solicitation_type = 'MARKETING' AND mc.campaign_type <> 'E_RECEIPT'"


def _now() -> datetime:
    return timezone.now()


@dataclass(frozen=True)
class Rule:
    days: int
    min_emails: int
    policy_id: str

    def since(self, now: datetime | None = None) -> datetime:
        return (now or _now()) - timedelta(days=self.days)


def describe(days: int, min_emails: int) -> str:
    return f"No engagement in {days} days, after at least {min_emails} marketing email{'s' if min_emails != 1 else ''}"


def rule(tenant_id, using: str = "default") -> Rule | None:
    """The rule that applies: the fewest days and the fewest emails of every active rule, the platform's and the workspace's own."""
    rows = list(CommunicationGovernancePolicy.objects.using(using).filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True, unengaged_days__isnull=False)
                .order_by("unengaged_days", "unengaged_min_emails").values_list("pk", "unengaged_days", "unengaged_min_emails"))
    if not rows:
        return None
    return Rule(days=rows[0][1], min_emails=min(row[2] for row in rows), policy_id=str(rows[0][0]))


def params(tenant_id, active: Rule | None) -> dict:
    """The SQL parameters SQL() reads: ue_on is false when no rule applies, and everything else then goes unread."""
    return {"tenant": str(tenant_id), "ue_on": active is not None, "ue_since": (active.since() if active else _now()),
            "ue_min": active.min_emails if active else 1, "ue_policy": active.policy_id if active else None}


def engaged_sql(party: str, after: str = "%(ue_since)s") -> str:
    """SQL: the party `party` engaged after the moment `after`. A purchase is an order the shop sent, a tracked purchase, or an
    e-receipt by email or text."""
    receipts = " OR ".join(
        f"""EXISTS (SELECT 1 FROM {table} r JOIN campaign rc ON rc.id = r.campaign_id AND rc.campaign_type = 'E_RECEIPT'
                     WHERE r.tenant_id = %(tenant)s AND r.party_id = {party} AND r.created_at >= {after} AND r.status NOT IN {SENT})"""
        for table in ("mailer_execution", "sms_execution"))
    return f"""(EXISTS (SELECT 1 FROM tracking_event t WHERE t.tenant_id = %(tenant)s AND t.party_id = {party} AND t.occurred_at >= {after}
                        AND t.event_type IN ('CLICK', 'PREFERENCE_VIEW', 'PURCHASE') AND NOT t.is_bot)
           OR EXISTS (SELECT 1 FROM mailer_execution c WHERE c.tenant_id = %(tenant)s AND c.party_id = {party} AND c.clicked_at >= {after})
           OR EXISTS (SELECT 1 FROM attributed_order o WHERE o.tenant_id = %(tenant)s AND o.party_id = {party} AND o.kind = 'ORDER' AND o.ordered_at >= {after})
           OR {receipts})"""


def SQL(party: str) -> str:
    """SQL: the party `party` is unengaged under the rule in params(). False whenever ue_on is."""
    return f"""(%(ue_on)s
       AND EXISTS (SELECT 1 FROM mailer_execution x {MARKETING_EMAIL}
                    WHERE x.tenant_id = %(tenant)s AND x.party_id = {party} AND x.status NOT IN {SENT} AND x.created_at < %(ue_since)s)
       AND (SELECT count(*) FROM mailer_execution x {MARKETING_EMAIL}
             WHERE x.tenant_id = %(tenant)s AND x.party_id = {party} AND x.status NOT IN {SENT} AND x.created_at >= %(ue_since)s) >= %(ue_min)s
       AND NOT {engaged_sql(party)})"""


PEOPLE = """
    SELECT cm.party_id FROM customer_master cm
      JOIN consent_suppression cs ON cs.tenant_id = cm.tenant_id AND cs.party_id = cm.party_id AND cs.channel = 'EMAIL'
     WHERE cm.tenant_id = %(tenant)s AND cs.consent_status = 'OPTED_IN' AND NOT COALESCE(cs.suppressed, FALSE)
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(cm.emails) e WHERE COALESCE((e ->> 'is_valid')::boolean, TRUE) AND COALESCE(e ->> 'address', '') <> '')"""


def _engaged_set(after: str = "%(ue_since)s") -> str:
    """SQL: every party that engaged after `after`, as one set (for counting the whole workspace at once)."""
    return f"""
    SELECT party_id FROM tracking_event WHERE tenant_id = %(tenant)s AND occurred_at >= {after} AND event_type IN ('CLICK', 'PREFERENCE_VIEW', 'PURCHASE') AND NOT is_bot AND party_id IS NOT NULL
    UNION SELECT party_id FROM mailer_execution WHERE tenant_id = %(tenant)s AND clicked_at >= {after}
    UNION SELECT party_id FROM attributed_order WHERE tenant_id = %(tenant)s AND kind = 'ORDER' AND ordered_at >= {after} AND party_id IS NOT NULL
    UNION SELECT r.party_id FROM mailer_execution r JOIN campaign rc ON rc.id = r.campaign_id AND rc.campaign_type = 'E_RECEIPT'
           WHERE r.tenant_id = %(tenant)s AND r.created_at >= {after} AND r.status NOT IN {SENT}
    UNION SELECT r.party_id FROM sms_execution r JOIN campaign rc ON rc.id = r.campaign_id AND rc.campaign_type = 'E_RECEIPT'
           WHERE r.tenant_id = %(tenant)s AND r.created_at >= {after} AND r.status NOT IN {SENT}"""


GROUPED = f"""
WITH people AS ({PEOPLE}
), mailed AS (
    SELECT x.party_id, min(x.created_at) AS first_at, count(*) FILTER (WHERE x.created_at >= %(ue_since)s) AS recent
      FROM mailer_execution x {MARKETING_EMAIL}
     WHERE x.tenant_id = %(tenant)s AND x.status NOT IN {SENT}
     GROUP BY x.party_id
), engaged AS ({_engaged_set()}
), judged AS (
    SELECT p.party_id, m.first_at, COALESCE(m.recent, 0) AS recent, e.party_id IS NOT NULL AS engaged,
           e.party_id IS NULL AND m.first_at < %(ue_since)s AND COALESCE(m.recent, 0) >= %(ue_min)s AS unengaged
      FROM people p LEFT JOIN mailed m ON m.party_id = p.party_id LEFT JOIN engaged e ON e.party_id = p.party_id
)"""


def today(tenant_id, active: Rule | None) -> dict:
    """The workspace's email contacts (marketing consent, a valid address) as the rule sees them now: engaged, too new to judge,
    unengaged. With nobody unengaged yet, `starts_on`: the day the first people can be (180 days after the earliest first email).
    Cached for 10 minutes per rule."""
    rule_for = active or Rule(RECOMMENDED_DAYS, RECOMMENDED_EMAILS, "")
    key = f"governance:unengaged:{tenant_id}:{rule_for.days}:{rule_for.min_emails}"
    found = cache.get(key)
    if found is not None:
        return found
    args = params(tenant_id, rule_for)
    with connection.cursor() as cursor:
        cursor.execute(GROUPED + """
            SELECT count(*), count(*) FILTER (WHERE engaged), count(*) FILTER (WHERE unengaged), min(first_at) FROM judged""", args)
        total, engaged, unengaged, earliest = cursor.fetchone()
    starts = None
    if not unengaged:
        first = earliest
        if first is None:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT min(x.created_at) FROM mailer_execution x {MARKETING_EMAIL} WHERE x.tenant_id = %(tenant)s AND x.status NOT IN {SENT}", args)
                first = cursor.fetchone()[0]
        if first is not None and first + timedelta(days=rule_for.days) > _now():
            starts = (first + timedelta(days=rule_for.days)).date().isoformat()
    found = {"total": total, "engaged": engaged, "unengaged": unengaged, "too_new": total - engaged - unengaged, "starts_on": starts}
    cache.set(key, found, 600)
    return found


def recent(tenant_id, days: int = 30) -> dict:
    """The last `days` days: campaign recipients left out as unengaged, and the people among them who have engaged since."""
    since = _now() - timedelta(days=days)
    args = {"tenant": str(tenant_id), "since": since}
    with connection.cursor() as cursor:
        cursor.execute(f"""
            WITH left_out AS (SELECT party_id, min(created_at) AS at FROM campaign_list_member
                               WHERE tenant_id = %(tenant)s AND suppression_reason = 'UNENGAGED' AND created_at >= %(since)s GROUP BY party_id)
            SELECT (SELECT count(*) FROM campaign_list_member WHERE tenant_id = %(tenant)s AND suppression_reason = 'UNENGAGED' AND created_at >= %(since)s),
                   (SELECT count(*) FROM left_out l WHERE {engaged_sql('l.party_id', 'l.at')})""", args)
        left_out, came_back = cursor.fetchone()
    return {"days": days, "left_out": left_out, "came_back": came_back}


def people(tenant_id, active: Rule) -> list[tuple]:
    """Everyone the rule leaves out now, for a win-back campaign: party, email, names, emails in the period, first marketing
    email, last engagement ever (empty: never)."""
    args = params(tenant_id, active)
    with connection.cursor() as cursor:
        cursor.execute(GROUPED + f"""
            SELECT j.party_id,
                   (SELECT lower(e ->> 'address') FROM jsonb_array_elements(cm.emails) e WHERE COALESCE((e ->> 'is_valid')::boolean, TRUE)
                     ORDER BY COALESCE((e ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1),
                   cm.first_name, cm.last_name, j.recent, j.first_at,
                   {last_engaged_sql('j.party_id')}
              FROM judged j JOIN customer_master cm ON cm.tenant_id = %(tenant)s AND cm.party_id = j.party_id
             WHERE j.unengaged ORDER BY j.party_id""", args)
        return cursor.fetchall()


def last_engaged_sql(party: str) -> str:
    """SQL: the latest engagement of `party` in the kept history, or NULL."""
    return f"""GREATEST(
        (SELECT max(occurred_at) FROM tracking_event WHERE tenant_id = %(tenant)s AND party_id = {party} AND event_type IN ('CLICK', 'PREFERENCE_VIEW', 'PURCHASE') AND NOT is_bot),
        (SELECT max(clicked_at) FROM mailer_execution WHERE tenant_id = %(tenant)s AND party_id = {party}),
        (SELECT max(ordered_at) FROM attributed_order WHERE tenant_id = %(tenant)s AND party_id = {party} AND kind = 'ORDER'),
        (SELECT max(r.created_at) FROM mailer_execution r JOIN campaign rc ON rc.id = r.campaign_id AND rc.campaign_type = 'E_RECEIPT'
          WHERE r.tenant_id = %(tenant)s AND r.party_id = {party} AND r.status NOT IN {SENT}),
        (SELECT max(r.created_at) FROM sms_execution r JOIN campaign rc ON rc.id = r.campaign_id AND rc.campaign_type = 'E_RECEIPT'
          WHERE r.tenant_id = %(tenant)s AND r.party_id = {party} AND r.status NOT IN {SENT}))"""


def for_party(tenant_id, party_id, cursor, using: str = "default") -> dict:
    """One person, for the customer page: last engagement, marketing emails in the period, and whether the rule leaves them out
    now (with roughly since when: the later of the last engagement and the first email, plus the period). On the caller's cursor."""
    active = rule(tenant_id, using=using)
    args = {**params(tenant_id, active), "party": str(party_id)}
    cursor.execute(f"""SELECT {last_engaged_sql('%(party)s')},
                              (SELECT count(*) FROM mailer_execution x {MARKETING_EMAIL} WHERE x.tenant_id = %(tenant)s AND x.party_id = %(party)s
                                  AND x.status NOT IN {SENT} AND x.created_at >= %(ue_since)s),
                              (SELECT min(x.created_at) FROM mailer_execution x {MARKETING_EMAIL} WHERE x.tenant_id = %(tenant)s AND x.party_id = %(party)s
                                  AND x.status NOT IN {SENT}),
                              {SQL('%(party)s')}""", args)
    last, emails, first, unengaged = cursor.fetchone()
    since = None
    if unengaged and active:
        since = (max(moment for moment in (last, first) if moment is not None) + timedelta(days=active.days)).date().isoformat()
    return {"last_engaged_at": last.isoformat() if last else None, "emails": emails, "days": active.days if active else None,
            "rule_on": active is not None, "unengaged": bool(unengaged), "unengaged_since": since}
