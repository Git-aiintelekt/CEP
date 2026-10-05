"""Computed fields for the Journeys List page (phase 6c): per-row `channels` / `trigger_family` / `needs_attention`,
and the page's 4 stat cards. None of these are stored columns — they're derived in bulk, for a page of rows at a
time, the same way apps.reporting.home.journeys() derives a journey's FAILED state and channel list for the Home
overview's Active Journeys widget. That function covers only ACTIVE/PAUSED journeys for Home's purposes; this module
covers every status, since the List page shows all of them.

    channels          EMAIL/SMS/MMS node types on the journey's newest version (current_version if published,
                      otherwise its one draft) — same "communication nodes on this version" query Home already runs.
    trigger_family    one of CUSTOMER_LIFECYCLE / SEGMENT_LOYALTY / COMMERCE_OFFER / ENGAGEMENT, by entry_type and
                      (for EVENT entries) event_type. The Setup modal (6e) isn't built yet, so there's no stored
                      family — this mirrors the 4-group taxonomy its Event pill was designed to use
                      (journey-flow-plan.md), inferred from the real entry rule data that already exists.
    step_count        every step after the entry trigger on that same newest version (starters.summary's count).
    step_types        those steps' node types in canvas order (the trunk, a Condition's YES branch, then its NO
                      branch, then the rest of the trunk), for the Journeys page's grid cards' step-icon strip.
    entry_rule        that version's first entry rule ({entry_type, rule_definition}, plus reference_name when it names a
                      list or segment: graph.name_references), for the grid cards' trigger line.
    needs_attention   a live/paused journey whose most recent generated campaign run FAILED in the last 7 days —
                      the same definition Home's journeys() uses for its "FAILED" row state, not a stored status.
"""
from datetime import timedelta

from django.utils import timezone

from apps.tenants import context
from apps.tenants.models import Tenant

from . import graph
from .models import Journey, JourneyEntryRule

COMMUNICATION_CHANNELS = ("EMAIL", "SMS", "MMS")
FAILED_WITHIN = timedelta(days=7)
TODAY_CHANNELS = ("EMAIL", "SMS")
ENTRY_FAMILY = "ENTRY"

FAMILY_LABEL = {
    "CUSTOMER_LIFECYCLE": "Customer / Lifecycle",
    "SEGMENT_LOYALTY": "Segment / Loyalty",
    "COMMERCE_OFFER": "Commerce / Offer",
    "ENGAGEMENT": "Engagement",
}
# Which family an Event entry's event_type falls under (apps.journeys.models.JourneyEvent.event_type's documented
# vocabulary). Entry types that aren't EVENT are placed by what they are, not by inspecting rule_definition.
# SEGMENT_INCEPTION, EMAIL_ENGAGEMENT and NO_RESPONSE aren't in that model comment's vocabulary yet — the Setup
# modal (phase 6e) added them as real event_type values its Event trigger picker can produce, so they're placed
# here too; everything else that isn't listed (WELCOME, BIRTHDAY, ANNIVERSARY, FIRST_PURCHASE, CUSTOMER_CREATED, ...)
# falls through to the CUSTOMER_LIFECYCLE default below, which is already correct for them.
EVENT_FAMILY = {
    "PURCHASE": "COMMERCE_OFFER", "CATEGORY_PURCHASE": "COMMERCE_OFFER", "CART_ABANDON": "COMMERCE_OFFER",
    "COUPON_ISSUED": "COMMERCE_OFFER", "COUPON_REDEEMED": "COMMERCE_OFFER",
    "EMAIL_OPEN": "ENGAGEMENT", "EMAIL_CLICK": "ENGAGEMENT", "SMS_RESPONSE": "ENGAGEMENT",
    "EMAIL_ENGAGEMENT": "ENGAGEMENT", "NO_RESPONSE": "ENGAGEMENT",
    "SEGMENT_CHANGE": "SEGMENT_LOYALTY", "LOYALTY_TIER_CHANGE": "SEGMENT_LOYALTY", "SEGMENT_INCEPTION": "SEGMENT_LOYALTY",
}


def _conn():
    from django.db import connections
    return connections[context.require().db_alias]


def _family_for(entry_type: str, rule_definition: dict | None) -> str:
    if entry_type == "SEGMENT_CHANGE":
        return "SEGMENT_LOYALTY"
    if entry_type == "EVENT":
        event_type = str((rule_definition or {}).get("event_type") or "").upper()
        return EVENT_FAMILY.get(event_type, "CUSTOMER_LIFECYCLE")
    return "CUSTOMER_LIFECYCLE"  # CUSTOMER_LIST, DATE_TIME


def candidate_ids(tenant_id, *, channel: str | None = None, trigger_family: str | None = None, needs_attention: bool = False) -> set[str] | None:
    """Journey ids matching a computed filter, or None when no computed filter was asked for (caller skips the pk__in)."""
    if not channel and not trigger_family and not needs_attention:
        return None
    ids = [str(pk) for pk in Journey.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).values_list("id", flat=True)]
    info = enrich_by_id(ids)
    out = set(ids)
    if channel:
        out &= {pk for pk in out if channel.upper() in info[pk]["channels"]}
    if trigger_family:
        out &= {pk for pk in out if info[pk]["trigger_family"] == trigger_family.upper()}
    if needs_attention:
        out &= {pk for pk in out if info[pk]["needs_attention"]}
    return out


def _ordered_types(nodes: dict[str, tuple[str, str]], edges: list[tuple[str, str, str | None]]) -> list[str]:
    """Step node types after the entry in the canvas's order (graphModel.ts's flatten): a depth-first walk that takes
    YES before NO and reaches a node where branches rejoin only after every edge into it has been walked. `nodes` maps
    id -> (node_type, node_family); ENTRY-family nodes (START, and older seeded entry nodes) are where the walk begins
    and are not steps. A graph with no entry node starts from the nodes nothing points at."""
    outgoing: dict[str, list[tuple[str | None, str]]] = {}
    incoming = {key: 0 for key in nodes}
    for source, target, branch in edges:
        if source in nodes and target in nodes:
            outgoing.setdefault(source, []).append((branch, target))
            incoming[target] += 1
    branch_rank = {"YES": 0, "NO": 1}
    entries = [key for key, (_, family) in nodes.items() if family == ENTRY_FAMILY]
    stack = list(reversed(entries or [key for key, count in incoming.items() if count == 0]))
    seen: set[str] = set()
    ordered: list[str] = []
    while stack:
        key = stack.pop()
        if key in seen:
            continue
        seen.add(key)
        if nodes[key][1] != ENTRY_FAMILY:
            ordered.append(nodes[key][0])
        ready = []
        for branch, target in sorted(outgoing.get(key, []), key=lambda edge: branch_rank.get(edge[0] or "", 2)):
            incoming[target] -= 1
            if incoming[target] <= 0:
                ready.append(target)
        stack.extend(reversed(ready))
    # anything unreachable from START (a malformed graph) still counts, after the rest
    ordered.extend(node_type for key, (node_type, family) in nodes.items() if key not in seen and family != ENTRY_FAMILY)
    return ordered


def enrich_by_id(ids: list[str]) -> dict[str, dict]:
    out = {pk: {"channels": [], "trigger_family": None, "needs_attention": False, "step_count": 0, "step_types": [], "entry_rule": None} for pk in ids}
    if not ids:
        return out
    with _conn().cursor() as cursor:
        cursor.execute("""SELECT DISTINCT ON (journey_id) journey_id::text, id::text FROM journey_version
                           WHERE journey_id::text = ANY(%(ids)s) ORDER BY journey_id, version_number DESC""", {"ids": ids})
        latest_version = dict(cursor.fetchall())
        version_ids = list(latest_version.values())
        channels_by_version: dict[str, list[str]] = {}
        nodes_by_version: dict[str, dict[str, tuple[str, str]]] = {}
        edges_by_version: dict[str, list[tuple[str, str, str | None]]] = {}
        if version_ids:
            cursor.execute("""SELECT journey_version_id::text, array_agg(DISTINCT node_type) FROM journey_node
                               WHERE journey_version_id::text = ANY(%(versions)s) AND deleted_at IS NULL AND node_family = 'COMMUNICATION'
                               GROUP BY 1""", {"versions": version_ids})
            channels_by_version = {version: [kind for kind in COMMUNICATION_CHANNELS if kind in kinds] for version, kinds in cursor.fetchall()}
            cursor.execute("""SELECT journey_version_id::text, id::text, node_type, node_family FROM journey_node
                               WHERE journey_version_id::text = ANY(%(versions)s) AND deleted_at IS NULL
                               ORDER BY created_at, node_key""", {"versions": version_ids})
            for version, node_id, node_type, node_family in cursor.fetchall():
                nodes_by_version.setdefault(version, {})[node_id] = (node_type, node_family)
            cursor.execute("""SELECT journey_version_id::text, from_node_id::text, to_node_id::text, branch_key FROM journey_connection
                               WHERE journey_version_id::text = ANY(%(versions)s) AND deleted_at IS NULL""", {"versions": version_ids})
            for version, source, target, branch in cursor.fetchall():
                edges_by_version.setdefault(version, []).append((source, target, branch))
        cursor.execute("""SELECT DISTINCT ON (c.origin_journey_id) c.origin_journey_id::text, r.status
                           FROM campaign_run r JOIN campaign c ON c.id = r.campaign_id
                          WHERE c.origin_journey_id::text = ANY(%(ids)s) AND NOT r.test_mode AND r.status IN ('COMPLETED', 'FAILED')
                            AND COALESCE(r.completed_at, r.updated_at) >= %(since)s
                          ORDER BY c.origin_journey_id, COALESCE(r.completed_at, r.updated_at) DESC""",
                       {"ids": ids, "since": timezone.now() - FAILED_WITHIN})
        failing_ids = {pk for pk, status in cursor.fetchall() if status == "FAILED"}

    entry_by_version: dict[str, dict] = {}
    if version_ids:
        for rule in JourneyEntryRule.objects.filter(journey_version_id__in=version_ids, deleted_at__isnull=True).order_by("created_at"):
            entry_by_version.setdefault(str(rule.journey_version_id), {"entry_type": rule.entry_type, "rule_definition": rule.rule_definition or {}})
        graph.name_references(list(entry_by_version.values()), context.require().tenant_id)

    for pk in ids:
        version_id = latest_version.get(pk)
        entry = entry_by_version.get(version_id)
        step_types = _ordered_types(nodes_by_version.get(version_id, {}), edges_by_version.get(version_id, [])) if version_id else []
        out[pk] = {
            "channels": channels_by_version.get(version_id, []),
            "trigger_family": _family_for(entry["entry_type"], entry["rule_definition"]) if entry else None,
            "needs_attention": pk in failing_ids,
            "step_count": len(step_types),
            "step_types": step_types,
            "entry_rule": entry,
        }
    return out


def enrich(journeys: list[Journey]) -> dict[str, dict]:
    return enrich_by_id([str(journey.pk) for journey in journeys])


def stats(tenant_id) -> dict:
    tenant = Tenant.objects.get(pk=tenant_id)
    from apps.reporting.reports import zone_of  # local import: avoid a reporting <-> journeys import cycle at module load
    zone = zone_of(tenant)
    now = timezone.now()
    today_start = timezone.now().astimezone(zone).replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    with _conn().cursor() as cursor:
        cursor.execute("""SELECT count(*), count(*) FILTER (WHERE status = 'ACTIVE') FROM journey
                           WHERE tenant_id = %(t)s AND deleted_at IS NULL""", {"t": str(tenant_id)})
        total, active = cursor.fetchone()

        cursor.execute("SELECT count(*) FROM journey_enrollment WHERE tenant_id = %(t)s AND status = 'ACTIVE'", {"t": str(tenant_id)})
        enrolled_now = cursor.fetchone()[0]
        # "currently enrolled" as of a week ago: enrolled by then, and either still active or exited/completed after then
        cursor.execute("""SELECT count(*) FROM journey_enrollment
                           WHERE tenant_id = %(t)s AND enrolled_at <= %(since)s AND (exited_at IS NULL OR exited_at > %(since)s)""",
                       {"t": str(tenant_id), "since": week_ago})
        enrolled_week_ago = cursor.fetchone()[0]

        cursor.execute("""SELECT count(*) FROM journey_enrollment
                           WHERE tenant_id = %(t)s AND status = 'COMPLETED' AND exited_at >= %(since)s""",
                       {"t": str(tenant_id), "since": now - timedelta(days=30)})
        completed_30d = cursor.fetchone()[0]

        cursor.execute("""SELECT c.channel, count(DISTINCT r.id) FROM journey_generated_campaign_run gr
                           JOIN journey_generated_campaign g ON g.id = gr.journey_generated_campaign_id
                           JOIN campaign_run r ON r.id = gr.campaign_run_id
                           JOIN campaign c ON c.id = r.campaign_id
                          WHERE g.tenant_id = %(t)s AND g.generation_date = %(today)s GROUP BY 1""",
                       {"t": str(tenant_id), "today": today_start.date()})
        runs_today = dict(cursor.fetchall())

    enrolled_change = round((enrolled_now - enrolled_week_ago) * 100 / enrolled_week_ago, 1) if enrolled_week_ago else None
    return {
        "active_journeys": active, "total_journeys": total,
        "currently_enrolled": enrolled_now, "currently_enrolled_change_pct": enrolled_change,
        "completed_30d": completed_30d,
        "campaign_runs_today": sum(runs_today.values()),
        "campaign_runs_today_by_channel": {channel: runs_today.get(channel, 0) for channel in TODAY_CHANNELS},
    }
