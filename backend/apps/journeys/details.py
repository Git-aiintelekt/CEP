"""Journey Details (phase 6d): everything the page needs beyond what `performance()` (6f) already serves —
metrics, the Setup card's Audience & enrollment facts, the enrollment-over-time chart, the Generated Campaigns
table, and a lightweight Activity log. None of this is a stored rollup: it is read live from
journey_enrollment / journey_entry_rule / journey_generated_campaign(_run) / journey_version, the same way
apps.journeys.listing computes the List page's row-level facts.

    metrics()              Enrolled / In Journey / Goal Converted / Exited Early — the page's 4 cards.
                            "Goal converted" reads a COMPLETED enrollment (reached an Exit node normally) as having
                            met the journey's goal, and "Exited early" an EXITED one (fell off with nowhere to go,
                            or an explicit early-exit reason) — the engine has no scored "goal" concept of its own
                            (see Journey.goal_description's docstring), so this is the closest honest mapping onto
                            the enrollment states it does track, not a stand-in for real goal-tracking.
    audience()              Source lists (CUSTOMER_LIST entry rules' contact lists), eligible pool size (today's
                            qualifying candidates, read-only — same candidate SQL enroll.py/publish.py use), and
                            the enrollment rate (enrolled ever / days since the journey was created).
    enrollment_trend()      6 weekly buckets of Enrolled / Goal Converted / Exited Early, for the chart.
    generated_campaigns()   one row per JourneyGeneratedCampaign: its campaign, node, last run, recipients, status.
    activity()              a derived timeline from JourneyVersion rows and the Journey's own timestamps — there is
                            no journey audit-log table (unlike campaigns' CampaignActivity); nothing here is invented.
"""
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from apps.contact_lists.models import ContactList
from apps.tenants import context

from .engine import enroll as enroll_engine
from .models import (
    Journey, JourneyEntryRule, JourneyEnrollment, JourneyGeneratedCampaign, JourneyNode, JourneyVersion,
)

WEEKS = 6


def _conn():
    from django.db import connections
    return connections[context.require().db_alias]


# ---------------------------------------------------------------------------------------------------- metrics

def has_goal(journey: Journey) -> bool:
    """Whether any version of the journey has a Goal step: then Goal Converted counts conversions, not Exit arrivals."""
    return JourneyNode.objects.filter(journey_version__journey=journey, node_type="GOAL", deleted_at__isnull=True).exists()


def metrics(journey: Journey) -> dict:
    empty = {"enrolled": None, "in_journey": None, "goal_converted": None, "goal_converted_pct": None, "exited_early": None, "exited_early_pct": None,
             "has_goal": has_goal(journey), "attributed_revenue": None, "revenue_per_conversion": None}
    if journey.status == Journey.Status.DRAFT:
        return empty
    counts = JourneyEnrollment.objects.filter(tenant_id=journey.tenant_id, journey_id=journey.id).values("status").order_by().annotate(n=Count("id"))
    by_status = {row["status"]: row["n"] for row in counts}
    active, completed, exited = by_status.get("ACTIVE", 0), by_status.get("COMPLETED", 0), by_status.get("EXITED", 0)
    enrolled = active + completed + exited

    def pct(n: int) -> float | None:
        return round(n * 100 / enrolled, 1) if enrolled else None

    converted, revenue = completed, None
    if empty["has_goal"]:
        with _conn().cursor() as cursor:
            cursor.execute("SELECT count(*), COALESCE(sum(attributed_revenue), 0) FROM journey_enrollment WHERE tenant_id = %s AND journey_id = %s AND converted_at IS NOT NULL",
                           [str(journey.tenant_id), str(journey.id)])
            converted, revenue = cursor.fetchone()
            revenue = float(revenue)
    return {**empty, "enrolled": enrolled, "in_journey": active, "goal_converted": converted, "goal_converted_pct": pct(converted),
            "exited_early": exited, "exited_early_pct": pct(exited), "attributed_revenue": revenue,
            "revenue_per_conversion": round(revenue / converted, 2) if revenue is not None and converted else None}


MESSAGES_SQL = """
SELECT count(*) FILTER (WHERE x.sent), count(*) FILTER (WHERE x.delivered), count(*) FILTER (WHERE x.opened), count(*) FILTER (WHERE x.clicked),
       count(*) FILTER (WHERE x.bounced), count(*) FILTER (WHERE x.complained)
  FROM journey_generated_campaign g
  JOIN (SELECT tenant_id, campaign_id, created_at,
               (submitted_at IS NOT NULL OR status IN ('SUBMITTED', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED')) AS sent,
               (delivered_at IS NOT NULL OR status IN ('DELIVERED', 'OPENED', 'CLICKED')) AS delivered,
               (opened_at IS NOT NULL OR status IN ('OPENED', 'CLICKED')) AS opened, (clicked_at IS NOT NULL OR status = 'CLICKED') AS clicked,
               (bounced_at IS NOT NULL OR status = 'BOUNCED') AS bounced, (complained_at IS NOT NULL OR status = 'COMPLAINED') AS complained
          FROM mailer_execution WHERE tenant_id = %(tenant)s AND created_at >= %(start)s AND created_at < %(end)s
        UNION ALL
        SELECT tenant_id, campaign_id, created_at,
               (submitted_at IS NOT NULL OR status IN ('SUBMITTED', 'DELIVERED', 'RESPONDED')), (delivered_at IS NOT NULL OR status IN ('DELIVERED', 'RESPONDED')),
               FALSE, FALSE, status = 'FAILED', FALSE
          FROM sms_execution WHERE tenant_id = %(tenant)s AND created_at >= %(start)s AND created_at < %(end)s) x
    ON x.tenant_id = g.tenant_id AND x.campaign_id = g.campaign_id
 WHERE g.tenant_id = %(tenant)s AND g.journey_id = %(journey)s"""
HELD_SQL = """
SELECT x.execution_status, x.result_data ->> 'reason', count(*)
  FROM journey_node_execution x JOIN journey_node n ON n.id = x.journey_node_id
  JOIN journey_enrollment e ON e.id = x.journey_enrollment_id AND e.tenant_id = x.tenant_id
 WHERE x.tenant_id = %(tenant)s AND e.journey_id = %(journey)s AND n.node_family = 'COMMUNICATION' AND x.execution_status IN ('SKIPPED', 'FAILED')
   AND x.executed_at >= %(start)s AND x.executed_at < %(end)s
 GROUP BY 1, 2 ORDER BY 3 DESC"""
UNSUBSCRIBED_SQL = """
SELECT count(*) FROM consent_record c JOIN journey_generated_campaign g ON g.tenant_id = c.tenant_id AND g.campaign_id = c.campaign_id
 WHERE c.tenant_id = %(tenant)s AND g.journey_id = %(journey)s AND c.action = 'OPT_OUT'
   AND c.occurred_at >= %(start)s AND c.occurred_at < %(end)s"""


def message_metrics(journey: Journey, start, end) -> dict:
    """The journey's messages across every step within the window: the figures each step's generated campaign keeps, added up,
    plus what governance held back and what failed (from the message steps' own records)."""
    args = {"tenant": str(journey.tenant_id), "journey": str(journey.id), "start": start, "end": end}
    with _conn().cursor() as cursor:
        cursor.execute(MESSAGES_SQL, args)
        sent, delivered, opened, clicked, bounced, complained = cursor.fetchone()
        cursor.execute(HELD_SQL, args)
        held, failed, reasons = 0, 0, []
        for status, reason, count in cursor.fetchall():
            if status == "SKIPPED":
                held += count
                reasons.append({"reason": reason or "held back", "count": count})
            else:
                failed += count
        try:
            cursor.execute(UNSUBSCRIBED_SQL, args)
            unsubscribed = cursor.fetchone()[0]
        except Exception:                                  # noqa: BLE001  a consent record shape this build does not know: no figure rather than no page
            unsubscribed = None

    def pct(n: int) -> float | None:
        return round(n * 100 / sent, 1) if sent else None

    return {"sent": sent, "delivered": delivered, "delivered_pct": pct(delivered), "opened": opened, "opened_pct": pct(opened), "clicked": clicked,
            "clicked_pct": pct(clicked), "bounced": bounced, "complained": complained, "unsubscribed": unsubscribed, "held_back": held,
            "held_back_reasons": reasons[:5], "failed": failed}


# ---------------------------------------------------------------------------------------------------- audience & enrollment

def audience(journey: Journey) -> dict:
    version = (JourneyVersion.objects.filter(journey=journey, pk=journey.current_version_id).first()
              or JourneyVersion.objects.filter(journey=journey).order_by("-version_number").first())
    rules = list(JourneyEntryRule.objects.filter(journey_version=version, deleted_at__isnull=True)) if version else []
    list_ids = [str(rule.rule_definition.get("contact_list_id")) for rule in rules
                if rule.entry_type == "CUSTOMER_LIST" and isinstance(rule.rule_definition, dict) and rule.rule_definition.get("contact_list_id")]
    source_lists = [{"id": row["id"], "name": row["name"]} for row in
                    ContactList.objects.filter(tenant_id=journey.tenant_id, pk__in=list_ids).values("id", "name")] if list_ids else []

    if journey.status == Journey.Status.DRAFT or version is None:
        return {"source_lists": source_lists, "eligible_pool": None, "enrollment_rate_per_day": None}

    eligible = 0
    since = timezone.now() - timedelta(days=enroll_engine.LOOKBACK_DAYS)
    for rule in rules:
        args = {"tenant": str(journey.tenant_id), "since": since}
        sql = enroll_engine._sources(rule, args)  # noqa: SLF001  same module family, not a public API boundary
        if sql is None:
            continue
        with _conn().cursor() as cursor:
            cursor.execute(f"SELECT count(DISTINCT c.party_id) FROM ({sql}) c "
                           f"JOIN customer_master cm ON cm.tenant_id = %(tenant)s AND cm.party_id = c.party_id", args)
            eligible += cursor.fetchone()[0]

    ever = JourneyEnrollment.objects.filter(tenant_id=journey.tenant_id, journey_id=journey.id).count()
    days = max(1, (timezone.now() - journey.created_at).days)
    return {"source_lists": source_lists, "eligible_pool": eligible, "enrollment_rate_per_day": round(ever / days, 1)}


# ---------------------------------------------------------------------------------------------------- enrollment over time

def enrollment_trend(journey: Journey) -> list[dict]:
    """6 weeks, oldest first, ending this week: how many enrolled / goal-converted / exited-early within each week."""
    if journey.status == Journey.Status.DRAFT:
        return []
    now = timezone.now()
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    starts = [week_start - timedelta(weeks=offset) for offset in range(WEEKS - 1, -1, -1)]
    with _conn().cursor() as cursor:
        cursor.execute("""
            SELECT date_trunc('week', enrolled_at)::date AS wk, count(*) AS enrolled, 0 AS converted, 0 AS exited
              FROM journey_enrollment WHERE tenant_id = %(tenant)s AND journey_id = %(journey)s AND enrolled_at >= %(since)s
             GROUP BY 1
            UNION ALL
            SELECT date_trunc('week', exited_at)::date, 0, count(*) FILTER (WHERE status = 'COMPLETED' AND NOT %(goal)s), count(*) FILTER (WHERE status = 'EXITED')
              FROM journey_enrollment WHERE tenant_id = %(tenant)s AND journey_id = %(journey)s AND exited_at >= %(since)s
             GROUP BY 1
            UNION ALL
            SELECT date_trunc('week', converted_at)::date, 0, count(*), 0
              FROM journey_enrollment WHERE tenant_id = %(tenant)s AND journey_id = %(journey)s AND converted_at >= %(since)s AND %(goal)s
             GROUP BY 1""", {"tenant": str(journey.tenant_id), "journey": str(journey.id), "since": starts[0], "goal": has_goal(journey)})
        by_week: dict = {}
        for wk, enrolled, converted, exited in cursor.fetchall():
            row = by_week.setdefault(wk, {"enrolled": 0, "goal_converted": 0, "exited_early": 0})
            row["enrolled"] += enrolled
            row["goal_converted"] += converted
            row["exited_early"] += exited
    return [{"week_start": start.date().isoformat(), **by_week.get(start.date(), {"enrolled": 0, "goal_converted": 0, "exited_early": 0})}
            for start in starts]


# ---------------------------------------------------------------------------------------------------- generated campaigns

def generated_campaigns(journey: Journey) -> list[dict]:
    rows = list(JourneyGeneratedCampaign.objects.filter(tenant_id=journey.tenant_id, journey=journey)
                .select_related("campaign", "journey_node").order_by("-generation_date"))
    if not rows:
        return []
    args = {"tenant": str(journey.tenant_id), "journey": str(journey.id)}
    with _conn().cursor() as cursor:
        # the newest run per generated campaign, by whichever timestamp it has: completed, else started, else scheduled
        cursor.execute("""
            SELECT DISTINCT ON (gc.id) gc.id::text, r.status, COALESCE(r.completed_at, r.started_at, r.scheduled_at)
              FROM journey_generated_campaign gc
              JOIN journey_generated_campaign_run gcr ON gcr.journey_generated_campaign_id = gc.id
              JOIN campaign_run r ON r.id = gcr.campaign_run_id
             WHERE gc.tenant_id = %(tenant)s AND gc.journey_id = %(journey)s
             ORDER BY gc.id, COALESCE(r.completed_at, r.started_at, r.scheduled_at) DESC NULLS LAST""", args)
        last_run = {row[0]: {"status": row[1], "at": row[2]} for row in cursor.fetchall()}

        # recipients reached across every run of a generated campaign: distinct party ids, mail or SMS
        cursor.execute("""
            SELECT gc.id::text, count(DISTINCT coalesce(m.party_id, sm.party_id))
              FROM journey_generated_campaign gc
              JOIN journey_generated_campaign_run gcr ON gcr.journey_generated_campaign_id = gc.id
              LEFT JOIN mailer_execution m ON m.campaign_run_id = gcr.campaign_run_id AND m.tenant_id = %(tenant)s
              LEFT JOIN sms_execution sm ON sm.campaign_run_id = gcr.campaign_run_id AND sm.tenant_id = %(tenant)s
             WHERE gc.tenant_id = %(tenant)s AND gc.journey_id = %(journey)s
             GROUP BY gc.id""", args)
        party_ids_by_gc: dict[str, int] = dict(cursor.fetchall())

    return [{
        "id": str(row.id), "campaign_id": str(row.campaign_id), "campaign_name": row.campaign.name,
        "node_key": row.journey_node.node_key, "node_type": row.journey_node.node_type,
        "generation_date": row.generation_date.isoformat(),
        "last_run_at": (last_run.get(str(row.id)) or {}).get("at"),
        "recipients": party_ids_by_gc.get(str(row.id), 0),
        "status": (last_run.get(str(row.id)) or {}).get("status") or row.campaign.status,
    } for row in rows]


# ---------------------------------------------------------------------------------------------------- activity

def activity(journey: Journey) -> list[dict]:
    """Derived, not stored: one entry per version (created, and published/retired when that happened), plus the
    journey's own created/paused-or-resumed moment inferred from updated_at when its status is PAUSED. Newest first."""
    versions = list(JourneyVersion.objects.filter(journey=journey).select_related("created_by", "updated_by").order_by("version_number"))
    entries = []
    for version in versions:
        who = version.created_by.display_name if version.created_by else None
        entries.append({"event_type": "CREATED", "message": f"Version {version.version_number} created.",
                        "actor_name": who, "occurred_at": version.created_at.isoformat(), "version_number": version.version_number})
        if version.published_at:
            who = version.updated_by.display_name if version.updated_by else None
            label = "activated" if version.status == JourneyVersion.Status.ACTIVE else version.get_status_display().lower()
            entries.append({"event_type": "PUBLISHED", "message": f"Version {version.version_number} {label}.",
                            "actor_name": who, "occurred_at": version.published_at.isoformat(), "version_number": version.version_number})
    if journey.status == Journey.Status.PAUSED:
        entries.append({"event_type": "PAUSED", "message": "Journey paused.", "actor_name": None,
                        "occurred_at": journey.updated_at.isoformat(), "version_number": journey.latest_version if hasattr(journey, "latest_version") else None})
    entries.sort(key=lambda entry: entry["occurred_at"], reverse=True)
    return entries
