"""Home's overview: what the cockpit cannot read from the report or the campaign list, answered in one request.

    attention     the counts behind Needs Attention: campaigns whose production send failed in the last week (their ids, so
                  Recent Campaigns can mark them), test-published campaigns, campaigns waiting for approval
    revenue_cost  attributed revenue against campaign cost over the period, by day (by week over a month), and by campaign.
                  Revenue and cost are per campaign (campaign_actual, else the campaign's planned cost) and are spread over
                  the days it sent in proportion to its sends; the target pace is the campaigns' revenue targets over the period
    governance    how many customers the period's production sends reached and how many governance held back, by reason
    journeys      active and paused journeys with who is in them (journey_enrollment); a journey whose last run failed reads FAILED

The period, channel and campaign filters are Home's. Marketing only: e-receipt campaigns are left out, as the report leaves them out. An answer is kept for 30 s, like the report.
"""
from datetime import date, timedelta

from django.core.cache import cache
from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone

from apps.campaigns import approval, service
from apps.campaigns.models import Campaign, CampaignRun
from apps.journeys.models import Journey
from apps.reporting import reports

FAMILY = {"EMAIL": "EMAIL", "SMS": "SMS", "MMS": "SMS"}
DELIVERED = {"EMAIL": "('DELIVERED', 'OPENED', 'CLICKED')", "SMS": "('DELIVERED', 'RESPONDED', 'OPTED_OUT')"}
WEEKLY_OVER_DAYS = 31
TOP_CAMPAIGNS = 5
FAILED_WITHIN = timedelta(days=7)
HELD_BACK = {"frequency_cap": ("FREQUENCY_CAP",), "no_consent": ("NO_CONSENT", "UNSUBSCRIBED", "TOPIC_OPTED_OUT"), "suppression": ("SUPPRESSED", "BLOCKED_ADDRESS", "INVALID_ADDRESS")}
COMMUNICATION_CHANNELS = ("EMAIL", "SMS", "MMS")


def _money(value) -> float:
    return round(float(value), 2)


def _scope(channel: str | None, campaign_ids: list[str]) -> tuple[str, dict]:
    """SQL on the campaign row `c`: marketing only, then Home's channel and campaign filters."""
    clauses, args = ["c.campaign_type <> 'E_RECEIPT'"], {}
    if channel:
        clauses.append("c.channel = %(channel)s")
        args["channel"] = channel
    if campaign_ids:
        clauses.append("c.id::text = ANY(%(ids)s)")
        args["ids"] = campaign_ids
    return " AND ".join(clauses), args


def attention(tenant_id) -> dict:
    campaigns = Campaign.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).exclude(status="ARCHIVED")
    failed_run = CampaignRun.objects.filter(campaign_id=OuterRef("pk"), test_mode=False, status="FAILED", completed_at__gte=timezone.now() - FAILED_WITHIN)
    asked = Q(approval_status=approval.REQUESTED, status__in=service.EDITABLE)
    failed = campaigns.filter(Exists(failed_run)).exclude(status="PAUSED").exclude(asked).order_by("-updated_at").values_list("id", flat=True)
    counts = campaigns.aggregate(publish=Count("id", filter=Q(status="TEST_PUBLISHED")), approval=Count("id", filter=asked))
    return {"failed_ids": [str(pk) for pk in failed], "awaiting_publish": counts["publish"], "awaiting_approval": counts["approval"],
            "drip_problems": drip_problems(tenant_id)}


PAUSED_LONG_AFTER = timedelta(days=3)


def drip_problems(tenant_id) -> list[dict]:
    """Drips that need someone: MESSAGE_FAILED, a message whose latest run failed in the last 7 days and reached nobody
    (paused or not); PAUSED_LONG, a drip paused 3 days or more, with the message waiting on it."""
    from apps.campaigns import drip_lifecycle
    now = timezone.now()
    drips = list(Campaign.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True, campaign_type=Campaign.CampaignType.DRIP)
                 .exclude(status__in=("ARCHIVED", "DRAFT", "TEST_PUBLISHED")).select_related("paused_by")
                 .prefetch_related("drip_steps", "campaign_runs"))
    problems = []
    for campaign in drips:
        steps = sorted(campaign.drip_steps.all(), key=lambda step: step.day)
        position = {step.pk: index for index, step in enumerate(steps, start=1)}
        latest = {}
        for run in sorted((run for run in campaign.campaign_runs.all() if not run.test_mode and run.drip_step_id), key=lambda run: run.run_number):
            latest[run.drip_step_id] = run
        for step in steps:
            run = latest.get(step.pk)
            if (run is not None and run.status == "FAILED" and run.completed_at and run.completed_at >= now - FAILED_WITHIN
                    and not drip_lifecycle._received(campaign, run)):
                problems.append({"kind": "MESSAGE_FAILED", "campaign_id": str(campaign.pk), "campaign_name": campaign.name, "position": position[step.pk],
                                 "message_name": step.name, "failed_at": run.completed_at})
        if campaign.status == "PAUSED" and campaign.paused_at and campaign.paused_at <= now - PAUSED_LONG_AFTER:
            waiting = next((run for step in steps for run in [latest.get(step.pk)] if run is not None and run.status == "SCHEDULED"), None)
            step = next((item for item in steps if waiting is not None and item.pk == waiting.drip_step_id), None)
            by = campaign.paused_by
            problems.append({"kind": "PAUSED_LONG", "campaign_id": str(campaign.pk), "campaign_name": campaign.name, "paused_at": campaign.paused_at,
                             "paused_by_name": (by.display_name or by.email) if by else None,
                             "next": {"position": position[step.pk], "name": step.name, "was_due": waiting.scheduled_at} if step else None})
    return problems


def revenue_cost(cursor, args: dict, first_day: date, last_day: date, channel: str | None, campaign_ids: list[str]) -> dict:
    scope, extra = _scope(channel, campaign_ids)
    args = {**args, **extra}
    families = [FAMILY[channel]] if channel else ["EMAIL", "SMS"]
    sends: dict[str, dict[date, int]] = {}
    delivered = 0
    for family in families:
        cursor.execute(f"""SELECT x.campaign_id::text, (x.submitted_at AT TIME ZONE %(zone)s)::date, count(*) FILTER (WHERE x.status NOT IN ('QUEUED', 'FAILED')),
                                  count(*) FILTER (WHERE x.status IN {DELIVERED[family]})
                             FROM {reports.TABLE[family]} x JOIN campaign_run r ON r.id = x.campaign_run_id JOIN campaign c ON c.id = x.campaign_id
                            WHERE x.tenant_id = %(tenant)s AND NOT r.test_mode AND x.created_at >= %(since)s AND x.created_at < %(until)s AND x.submitted_at IS NOT NULL AND {scope}
                            GROUP BY 1, 2""", args)
        for pk, day, sent, got in cursor.fetchall():
            sends.setdefault(pk, {})[day] = sends.get(pk, {}).get(day, 0) + int(sent)
            delivered += int(got)
    days = (last_day - first_day).days + 1
    step = 7 if days > WEEKLY_OVER_DAYS else 1
    granularity = "week" if step == 7 else "day"
    empty = {"revenue": None, "cost": 0, "roi": None, "revenue_per_1000_delivered": None}
    if not sends:
        return {"granularity": granularity, "points": [], "by_campaign": {"top": [], "others": None}, "summary": empty}

    ids = list(sends)
    cursor.execute("SELECT id::text, name FROM campaign WHERE tenant_id = %(tenant)s AND id::text = ANY(%(found)s)", {**args, "found": ids})
    names = dict(cursor.fetchall())
    cursor.execute("""SELECT DISTINCT ON (campaign_id) campaign_id::text, attributed_revenue, actual_delivery_cost, offer_cost FROM campaign_actual
                       WHERE tenant_id = %(tenant)s AND campaign_id::text = ANY(%(found)s) ORDER BY campaign_id, computed_at DESC""", {**args, "found": ids})
    actuals = {pk: (revenue, delivery_cost, offer_cost) for pk, revenue, delivery_cost, offer_cost in cursor.fetchall()}
    cursor.execute("""SELECT DISTINCT ON (campaign_id) campaign_id::text, target_revenue, planned_cost, planned_offer_cost FROM campaign_target
                       WHERE tenant_id = %(tenant)s AND deleted_at IS NULL AND campaign_id::text = ANY(%(found)s) ORDER BY campaign_id, created_at DESC""", {**args, "found": ids})
    targets = {pk: (target, planned, planned_offer) for pk, target, planned, planned_offer in cursor.fetchall()}

    revenue_of, cost_of = {}, {}
    for pk in ids:
        revenue, delivery_cost, offer_cost = actuals.get(pk, (None, None, None))
        target, planned, planned_offer = targets.get(pk, (None, None, None))
        revenue_of[pk] = _money(revenue) if revenue is not None else None
        if delivery_cost is not None or offer_cost is not None:
            cost_of[pk] = _money((delivery_cost or 0) + (offer_cost or 0))
        elif planned is not None or planned_offer is not None:
            cost_of[pk] = _money((planned or 0) + (planned_offer or 0))
        else:
            cost_of[pk] = 0.0
    attributed = any(value is not None for value in revenue_of.values())
    target_total = sum(float(target) for target, _, _ in targets.values() if target)

    buckets = (days + step - 1) // step
    revenue_by, cost_by = [0.0] * buckets, [0.0] * buckets
    for pk, per_day in sends.items():
        total = sum(per_day.values())
        for day, sent in per_day.items():
            index = (day - first_day).days // step
            if not 0 <= index < buckets or not total:
                continue
            share = sent / total
            revenue_by[index] += (revenue_of[pk] or 0) * share
            cost_by[index] += cost_of[pk] * share
    points = []
    for index in range(buckets):
        span = min(step, days - index * step)
        points.append({"day": first_day + timedelta(days=index * step), "revenue": _money(revenue_by[index]) if attributed else None, "cost": _money(cost_by[index]),
                       "target_pace": _money(target_total * span / days) if target_total else None})

    ranked = sorted(((pk, revenue_of[pk]) for pk in ids if revenue_of[pk]), key=lambda item: item[1], reverse=True)
    top = [{"id": pk, "name": names.get(pk, ""), "revenue": revenue} for pk, revenue in ranked[:TOP_CAMPAIGNS]]
    rest = ranked[TOP_CAMPAIGNS:]
    others = {"count": len(rest), "revenue": _money(sum(revenue for _, revenue in rest))} if rest else None
    revenue_total = _money(sum(value for value in revenue_of.values() if value)) if attributed else None
    cost_total = _money(sum(cost_of.values()))
    summary = {"revenue": revenue_total, "cost": cost_total,
               "roi": round(revenue_total / cost_total, 2) if revenue_total is not None and cost_total > 0 else None,
               "revenue_per_1000_delivered": _money(revenue_total / delivered * 1000) if revenue_total is not None and delivered else None}
    return {"granularity": granularity, "points": points, "by_campaign": {"top": top, "others": others}, "summary": summary}


def governance(cursor, args: dict, channel: str | None, campaign_ids: list[str]) -> dict:
    scope, extra = _scope(channel, campaign_ids)
    held = [reason for reasons in HELD_BACK.values() for reason in reasons]
    cursor.execute(f"""SELECT count(DISTINCT m.party_id) FILTER (WHERE m.suppression_reason IS NULL),
                              count(DISTINCT m.party_id) FILTER (WHERE m.suppression_reason = ANY(%(held)s)),
                              count(DISTINCT m.party_id) FILTER (WHERE m.suppression_reason = ANY(%(frequency_cap)s)),
                              count(DISTINCT m.party_id) FILTER (WHERE m.suppression_reason = ANY(%(no_consent)s)),
                              count(DISTINCT m.party_id) FILTER (WHERE m.suppression_reason = ANY(%(suppression)s))
                         FROM campaign_list_member m JOIN campaign_list l ON l.id = m.campaign_list_id JOIN campaign_run r ON r.id = l.campaign_run_id JOIN campaign c ON c.id = l.campaign_id
                        WHERE m.tenant_id = %(tenant)s AND m.created_at >= %(since)s AND m.created_at < %(until)s AND NOT r.test_mode AND {scope}""",
                   {**args, **extra, "held": held, **{key: list(reasons) for key, reasons in HELD_BACK.items()}})
    contacted, held_back, frequency_cap, no_consent, suppression = [int(value) for value in cursor.fetchone()]
    return {"contacted": contacted, "held_back": held_back, "reasons": {"frequency_cap": frequency_cap, "no_consent": no_consent, "suppression": suppression}}


def journeys(cursor, tenant_id) -> dict:
    rows = list(Journey.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True, status__in=(Journey.Status.ACTIVE, Journey.Status.PAUSED))
                .select_related("updated_by").order_by("name"))
    if not rows:
        return {"rows": [], "total": 0}
    ids = [str(journey.pk) for journey in rows]
    cursor.execute("""SELECT journey_id::text, count(*), count(*) FILTER (WHERE status = 'ACTIVE'), count(*) FILTER (WHERE status = 'COMPLETED')
                        FROM journey_enrollment WHERE tenant_id = %(tenant)s AND journey_id::text = ANY(%(ids)s) GROUP BY 1""", {"tenant": str(tenant_id), "ids": ids})
    people = {pk: (int(entered), int(active), int(completed)) for pk, entered, active, completed in cursor.fetchall()}
    versions = [str(journey.current_version_id) for journey in rows if journey.current_version_id]
    channels: dict[str, list[str]] = {}
    if versions:
        cursor.execute("""SELECT journey_version_id::text, array_agg(DISTINCT node_type) FROM journey_node
                           WHERE journey_version_id::text = ANY(%(versions)s) AND deleted_at IS NULL AND node_family = 'COMMUNICATION' GROUP BY 1""", {"versions": versions})
        channels = {version: [kind for kind in COMMUNICATION_CHANNELS if kind in kinds] for version, kinds in cursor.fetchall()}
    cursor.execute("""SELECT DISTINCT ON (c.origin_journey_id) c.origin_journey_id::text, r.status, COALESCE(r.completed_at, r.updated_at), c.channel
                        FROM campaign_run r JOIN campaign c ON c.id = r.campaign_id
                       WHERE c.tenant_id = %(tenant)s AND c.origin_journey_id::text = ANY(%(ids)s) AND NOT r.test_mode AND r.status IN ('COMPLETED', 'FAILED')
                       ORDER BY c.origin_journey_id, COALESCE(r.completed_at, r.updated_at) DESC""", {"tenant": str(tenant_id), "ids": ids})
    failing = {pk: (at, channel) for pk, status, at, channel in cursor.fetchall() if status == "FAILED"}
    out = []
    for journey in rows:
        pk = str(journey.pk)
        entered, active, completed = people.get(pk, (0, 0, 0))
        failed = failing.get(pk)
        paused = journey.status == Journey.Status.PAUSED
        out.append({"id": pk, "name": journey.name, "status": "FAILED" if failed else journey.status,
                    "channels": channels.get(str(journey.current_version_id), []),
                    "paused_at": journey.updated_at if paused else None,
                    "paused_by": (journey.updated_by.display_name or journey.updated_by.email) if paused and journey.updated_by else None,
                    "failing_since": failed[0] if failed else None, "failing_step": failed[1] if failed else None,
                    "in_flight": active, "entered": entered, "completed": completed,
                    "conversion_rate": round(completed * 100 / entered, 1) if entered else 0.0})
    return {"rows": out, "total": len(out)}


def overview(tenant, start: date | None, end: date | None, *, channel: str | None, campaign_ids: list[str], reports_allowed: bool, journeys_allowed: bool) -> dict:
    if channel and channel not in FAMILY:
        raise reports.ReportError("channel", "Filter by EMAIL, SMS or MMS.")
    zone = reports.zone_of(tenant)
    since, until, first_day, last_day = reports.period(start, end, zone)
    cache_key = f"cep:home_overview:{tenant.pk}:{first_day}:{last_day}:{channel or ''}:{','.join(sorted(campaign_ids))}:{int(reports_allowed)}{int(journeys_allowed)}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    args = {"tenant": str(tenant.pk), "since": since, "until": until, "zone": zone.key}
    out = {"period": {"from": first_day, "to": last_day, "timezone": zone.key, "days": (last_day - first_day).days + 1},
           "attention": attention(tenant.pk), "revenue_cost": None, "governance": None, "journeys": None}
    with reports._conn().cursor() as cursor:
        if reports_allowed:
            out["revenue_cost"] = revenue_cost(cursor, args, first_day, last_day, channel, campaign_ids)
            out["governance"] = governance(cursor, args, channel, campaign_ids)
        if journeys_allowed:
            out["journeys"] = journeys(cursor, tenant.pk)
    cache.set(cache_key, out, service.RESULTS_CACHE_TTL)
    return out
