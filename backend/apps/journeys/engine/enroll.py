"""Enrollment: who enters a live journey on this pass.

Every entry rule of the live version names candidates, each with the moment they qualified:

    CUSTOMER_LIST    {contact_list_id}                     members of the list (when they were added)
    EVENT            {event_type}                          journey_event rows of that type since the version went live (POST /events/,
                                                           purchases from orders); EMAIL_ENGAGEMENT also reads CEP's own opens and clicks
                                                           (tracking_event, scanners left out), SMS_RESPONSE the replies to its texts
    SEGMENT_CHANGE   {segment_id, change: JOINED | LEFT}   joined: customer_segment_membership.qualified_at since then;
                                                           joined or left: journey_event SEGMENT_CHANGE rows naming the segment
                     {change_trigger: LOYALTY_TIER | PREFERENCE_UPDATE | ADDRESS_CHANGE}: that attribute's change event
                                                           (events.ATTRIBUTE_EVENTS), read like an EVENT rule
                     {change_trigger: ATTRIBUTE_MATCH, rule}  the customers whose record matches the rule now
                                                           (apps.journeys.conditions), qualified when the record last changed
    any rule         {filters}                              a condition rule every candidate's record must also match
    DATE_TIME        {schedule, time, ...} (apps.journeys.schedule): when its latest moment has passed since the version went
                                                           live or last fired (journey_version.last_fired_at), the list's or segment's
                                                           members, or the customers whose date matches, enter at that moment

NO_RESPONSE events are raised here, before the journeys are read, when a live journey starts from them (events.raise_no_response,
at most every NO_RESPONSE_EVERY seconds per workspace).

Test Publish enrollments (state_data.entry = TEST_PUBLISH) never count as an earlier entry: a test customer may enter for real.

Population mode: FIXED takes who qualifies on the first pass after go-live (for a segment, everyone in it then) and closes
the version to newcomers (journey_version.population_frozen_at); CONTINUOUSLY_QUALIFYING and EVENT_TRIGGERED keep enrolling on
every pass, newcomers and new events alike.

A candidate enters unless the re-entry policy says no. Nobody is ever in a journey twice at once
(ux_journey_enrollment_no_reentry); after that, NEVER keeps them out, AFTER_X_DAYS lets them back once that many days have
passed since they last entered, and EVERY_QUALIFYING_EVENT lets them back each time they qualify again. Only customers in
customer_master enter: a message to someone unknown could never go out. A customer suppressed for the journey
(journey_suppression, apps.journeys.suppressions) never enters it.
"""
import logging

from django.core.cache import cache
from django.utils import timezone

from apps.delivery.engine import session

from .. import conditions, events, schedule
from ..models import Journey, JourneyEntryRule, JourneyNode, JourneyVersion
from . import tenants

log = logging.getLogger("cep.journeys")
PER_PASS = 5000                                           # per journey and pass; the rest enter on the next pass
LOOKBACK_DAYS = 7                                         # how far back events and segment changes are read, at most
NO_RESPONSE_EVERY = 15 * 60

FROM_TRACKING = {
    "EMAIL_ENGAGEMENT": """
        UNION ALL
        SELECT party_id, occurred_at FROM tracking_event
         WHERE tenant_id = %(tenant)s AND event_type IN ('OPEN', 'CLICK') AND NOT is_bot AND party_id IS NOT NULL AND occurred_at >= %(since)s""",
    "SMS_RESPONSE": """
        UNION ALL
        SELECT party_id, responded_at FROM sms_execution
         WHERE tenant_id = %(tenant)s AND responded_at IS NOT NULL AND responded_at >= %(since)s AND created_at >= %(since)s - interval '35 days'""",
}

CANDIDATES = {
    "CUSTOMER_LIST": """
        SELECT m.party_id, m.added_at AS qualified_at FROM contact_list_member m
          JOIN contact_list l ON l.id = m.contact_list_id AND l.tenant_id = m.tenant_id
         WHERE m.tenant_id = %(tenant)s AND m.contact_list_id::text = %(list)s AND l.deleted_at IS NULL AND l.status = 'ACTIVE'
           AND l.approval_status NOT IN ('AWAITING', 'REFUSED')""",
    "EVENT": """
        SELECT party_id, ingested_at AS qualified_at FROM journey_event
         WHERE tenant_id = %(tenant)s AND event_type = %(event_type)s AND occurred_at >= %(since)s AND ingested_at >= %(since)s""",
    "ATTRIBUTE_MATCH": """
        SELECT cm.party_id, cm.synced_at AS qualified_at FROM customer_master cm
         WHERE cm.tenant_id = %(tenant)s AND {where}""",
    "SEGMENT_CHANGE": """
        SELECT party_id, qualified_at FROM customer_segment_membership
         WHERE tenant_id = %(tenant)s AND segment_id::text = %(segment)s AND qualified_at >= %(since)s AND %(change)s = 'JOINED'
        UNION ALL
        SELECT party_id, ingested_at FROM journey_event
         WHERE tenant_id = %(tenant)s AND event_type = 'SEGMENT_CHANGE' AND occurred_at >= %(since)s AND ingested_at >= %(since)s
           AND event_payload ->> 'segment_id' = %(segment)s AND upper(COALESCE(event_payload ->> 'change', 'JOINED')) = %(change)s""",
}

ENROLL = """
WITH candidates AS ({candidates}),
best AS (
    SELECT c.party_id, max(c.qualified_at) AS qualified_at FROM candidates c
      JOIN customer_master cm ON cm.tenant_id = %(tenant)s AND cm.party_id = c.party_id{filters}
     WHERE NOT EXISTS (SELECT 1 FROM journey_suppression x WHERE x.tenant_id = %(tenant)s AND x.journey_id = %(journey)s AND x.party_id = c.party_id)
     GROUP BY c.party_id
), previous AS (
    SELECT e.party_id, max(e.enrolled_at) AS last_at, bool_or(e.status = 'ACTIVE') AS inside FROM journey_enrollment e
     WHERE e.tenant_id = %(tenant)s AND e.journey_id = %(journey)s
       AND NOT EXISTS (SELECT 1 FROM journey_customer_state s WHERE s.journey_enrollment_id = e.id AND s.state_data ->> 'entry' = 'TEST_PUBLISH')
     GROUP BY e.party_id
), eligible AS (
    SELECT b.party_id FROM best b LEFT JOIN previous p ON p.party_id = b.party_id
     WHERE p.party_id IS NULL
        OR (NOT p.inside AND ((%(policy)s = 'AFTER_X_DAYS' AND p.last_at <= now() - make_interval(days => %(days)s) AND (%(is_list)s OR b.qualified_at > p.last_at))
                              OR (%(policy)s = 'EVERY_QUALIFYING_EVENT' AND b.qualified_at > p.last_at)))
     ORDER BY b.qualified_at LIMIT %(limit)s
), entered AS (
    INSERT INTO journey_enrollment (journey_id, journey_version_id, tenant_id, party_id, status)
    SELECT %(journey)s, %(version)s, %(tenant)s, party_id, 'ACTIVE' FROM eligible
    ON CONFLICT DO NOTHING
    RETURNING id
)
INSERT INTO journey_customer_state (journey_enrollment_id, current_node_id, entered_node_at, next_scheduled_at, state_data)
SELECT id, %(start)s, now(), now(), jsonb_build_object('entry', %(entry)s) FROM entered
"""


def live_version(journey: Journey) -> JourneyVersion | None:
    """The version new entrants join: the journey's current version when it is ACTIVE, else its newest ACTIVE one."""
    versions = JourneyVersion.objects.filter(journey=journey, status=JourneyVersion.Status.ACTIVE)
    if journey.current_version_id:
        current = versions.filter(pk=journey.current_version_id).first()
        if current is not None:
            return current
    return versions.order_by("-version_number").first()


def is_attribute_match(rule: JourneyEntryRule) -> bool:
    return rule.entry_type == "SEGMENT_CHANGE" and str((rule.rule_definition or {}).get("change_trigger") or "").upper() == conditions.ATTRIBUTE_MATCH


def entry_filters(rule: JourneyEntryRule, args: dict) -> str:
    """The rule's Only Customers Where filters as " AND (...)" over cm, their parameters added to `args`; "" without any."""
    filters = (rule.rule_definition or {}).get("filters")
    where = conditions.compile_where(filters, args, in_journey=False, prefix="f") if isinstance(filters, dict) else None
    return f" AND {where}" if where else ""


def _sources(rule: JourneyEntryRule, args: dict) -> str | None:
    definition = rule.rule_definition or {}
    if is_attribute_match(rule):
        where = conditions.compile_where(definition.get("rule"), args, in_journey=False)
        return CANDIDATES["ATTRIBUTE_MATCH"].format(where=where) if where else None
    if rule.entry_type == "CUSTOMER_LIST" and definition.get("contact_list_id"):
        args["list"] = str(definition["contact_list_id"])
    elif rule.entry_type == "EVENT" and definition.get("event_type"):
        args["event_type"] = str(definition["event_type"]).upper()
        return CANDIDATES["EVENT"] + FROM_TRACKING.get(args["event_type"], "")
    elif rule.entry_type == "SEGMENT_CHANGE" and definition.get("segment_id"):
        args["segment"] = str(definition["segment_id"])
        args["change"] = str(definition.get("change") or "JOINED").upper()
    elif rule.entry_type == "SEGMENT_CHANGE" and str(definition.get("change_trigger") or "").upper() in events.ATTRIBUTE_EVENTS:
        args["event_type"] = events.ATTRIBUTE_EVENTS[str(definition["change_trigger"]).upper()]
        return CANDIDATES["EVENT"]
    elif rule.entry_type == "DATE_TIME" and schedule.problem(definition) is None:
        zone = schedule.tenant_zone(args["tenant"])
        moment = args.get("moment") or schedule.next_moment(definition, zone, timezone.now())   # Test Publish: who would enter next
        return schedule.candidates(definition, args, moment, zone) if moment else None
    else:
        return None                                       # a rule missing what it needs: nobody
    return CANDIDATES[rule.entry_type]


def enroll_journey(tenant_id: str, journey: Journey) -> int:
    """Must run inside session.tenant_scope(tenant_id). One transaction per rule, so one bad rule does not hold the others back."""
    version = live_version(journey)
    if version is None:
        return 0
    start = JourneyNode.objects.filter(journey_version=version, node_family="ENTRY", deleted_at__isnull=True).order_by("created_at").first()
    if start is None:
        return 0
    fixed = journey.population_mode == Journey.PopulationMode.FIXED
    if fixed and version.population_frozen_at is not None:
        return 0                                          # a Fixed population was taken at launch: nobody new
    since = max(version.published_at or version.updated_at, timezone.now() - timezone.timedelta(days=LOOKBACK_DAYS))
    entered, fired, waiting = 0, None, False
    for rule in JourneyEntryRule.objects.filter(journey_version=version, deleted_at__isnull=True):
        moment = None
        if rule.entry_type == "DATE_TIME":
            moment = schedule.latest_moment(rule.rule_definition or {}, schedule.tenant_zone(tenant_id), timezone.now())
            floor = version.last_fired_at or version.published_at
            if moment is None or floor is None or moment <= floor:
                waiting = True
                continue
        whole_segment = fixed and rule.entry_type == "SEGMENT_CHANGE" and bool((rule.rule_definition or {}).get("segment_id"))
        segment_since = timezone.datetime(2000, 1, 1, tzinfo=timezone.get_current_timezone()) if whole_segment else since
        args = {"tenant": str(tenant_id), "journey": str(journey.pk), "version": str(version.pk), "start": str(start.pk), "since": segment_since,
                "policy": journey.reentry_policy, "days": journey.reentry_after_days or 0, "is_list": rule.entry_type == "CUSTOMER_LIST" or is_attribute_match(rule),
                "limit": PER_PASS, "entry": rule.entry_type, "moment": moment}
        candidates = _sources(rule, args)
        if candidates is None:
            continue
        with session.tx(), session.connection().cursor() as cursor:
            cursor.execute(ENROLL.format(candidates=candidates, filters=entry_filters(rule, args)), args)
            entered += cursor.rowcount
            if moment is not None and cursor.rowcount < PER_PASS:   # a full pass leaves the rest of the audience for the next one
                fired = max(fired or moment, moment)
    if fired is not None:
        with session.tx():
            JourneyVersion.objects.filter(pk=version.pk).update(last_fired_at=fired)
    if fixed and (fired is not None or not waiting):
        with session.tx():
            JourneyVersion.objects.filter(pk=version.pk, population_frozen_at__isnull=True).update(population_frozen_at=timezone.now())
    return entered


def enroll_tenant(tenant_id: str) -> dict:
    entered, failed = 0, 0
    with session.tenant_scope(tenant_id):
        with session.tx():
            live = list(Journey.objects.filter(tenant_id=tenant_id, status=Journey.Status.ACTIVE, deleted_at__isnull=True))
        _raise_no_response(tenant_id, live)
        for journey in live:
            try:
                entered += enroll_journey(tenant_id, journey)
            except Exception:                              # noqa: BLE001  one journey's trouble must not stop the others
                log.exception("enrollment failed for journey %s", journey.pk)
                failed += 1
    return {"entered": entered, "failed": failed}


def _raise_no_response(tenant_id: str, live: list) -> None:
    starts_from_it = JourneyEntryRule.objects.filter(journey_version__journey__in=live, journey_version__status=JourneyVersion.Status.ACTIVE,
                                                     entry_type="EVENT", rule_definition__event_type="NO_RESPONSE", deleted_at__isnull=True)
    if not live or not starts_from_it.exists() or not cache.add(f"journeys:no-response:{tenant_id}", 1, timeout=NO_RESPONSE_EVERY):
        return
    try:
        with session.tx():
            events.raise_no_response(tenant_id)
    except Exception:                                      # noqa: BLE001  the journeys still enroll from what is there
        log.exception("No Response events could not be raised for tenant %s", tenant_id)


def run() -> dict:
    totals = {"tenants": 0, "entered": 0, "failed": 0}
    for tenant_id in tenants("""SELECT DISTINCT j.tenant_id FROM journey j JOIN tenant t ON t.id = j.tenant_id
                                  JOIN journey_version v ON v.journey_id = j.id AND v.status = 'ACTIVE'
                                 WHERE t.status = 'ACTIVE' AND j.status = 'ACTIVE' AND j.deleted_at IS NULL"""):
        try:
            result = enroll_tenant(tenant_id)
        except Exception:                                  # noqa: BLE001
            log.exception("enrollment failed for tenant %s", tenant_id)
            totals["failed"] += 1
            continue
        totals["tenants"] += 1
        totals["entered"] += result["entered"]
        totals["failed"] += result["failed"]
    return totals
