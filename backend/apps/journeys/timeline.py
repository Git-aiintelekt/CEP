"""One customer's path through a journey, and the dry run before it (phase 4 of the journey gaps).

    customers(journey, q, page)        the journey page's Customers card: everyone enrolled, where they are now
    timeline(journey, enrollment_id)   one customer's timeline: entry, every step with its outcome and delivery record, the
                                       current position, conversion, exit — from journey_node_execution, journey_customer_state
                                       and the mailer / SMS execution of each message step's run; nothing new is stored
    counts(version)                    per step: how many passed, are waiting, answered Yes / No, reached the goal (a live canvas)
    search_customers(tenant_id, q)     who Preview Route can walk as
    preview(version, party_id, ...)    Preview Route: walks the graph with the customer's record as it is now, sending nothing
                                       and recording nothing. A Condition that depends on something that has not happened
                                       (this journey's messages, earlier steps, the goal) asks which way to assume.
"""
import json
from datetime import timedelta

from django.utils import timezone

from apps.contact_lists.governance import PRIMARY_EMAIL_SQL, STATUSES, status_sql
from apps.delivery.engine import session

from . import conditions, goals, schedule, waits, webhooks
from .engine import steps as steps_engine
from .engine.advance import _next
from .models import Journey, JourneyEnrollment, JourneyEntryRule, JourneyNode, JourneyVersion

PAGE_SIZE = 25
MAX_HOPS = 100
MESSAGE_TYPES = ("EMAIL", "SMS", "MMS")


def _conn():
    return session.connection()


def _json(value):
    """A raw cursor leaves jsonb as text; the ORM gives it parsed. Either way, a dict (or list)."""
    if isinstance(value, (str, bytes)):
        try:
            return json.loads(value)
        except ValueError:
            return {}
    return value if value is not None else {}


# ---------------------------------------------------------------------------------------------------- the customers
CUSTOMERS_SQL = """
SELECT e.id::text, e.party_id, cm.first_name, cm.last_name, lower(cm.emails -> 0 ->> 'address'), e.enrolled_at, v.version_number, e.status,
       e.converted_at, e.attributed_revenue, e.exited_at, e.exit_reason, n.node_key, n.node_type, n.config, s.entered_node_at, s.next_scheduled_at,
       count(*) OVER () AS total
  FROM journey_enrollment e
  JOIN journey_version v ON v.id = e.journey_version_id
  LEFT JOIN customer_master cm ON cm.tenant_id = e.tenant_id AND cm.party_id = e.party_id
  LEFT JOIN journey_customer_state s ON s.journey_enrollment_id = e.id
  LEFT JOIN journey_node n ON n.id = s.current_node_id
 WHERE e.tenant_id = %(tenant)s AND e.journey_id = %(journey)s
   AND (%(q)s = '' OR cm.first_name ILIKE %(like)s OR cm.last_name ILIKE %(like)s OR (cm.first_name || ' ' || cm.last_name) ILIKE %(like)s
        OR (cm.emails -> 0 ->> 'address') ILIKE %(like)s OR e.party_id = %(q)s)
   AND (%(status)s = '' OR e.status = %(status)s)
 ORDER BY e.enrolled_at DESC LIMIT %(limit)s OFFSET %(offset)s"""


def _name(first, last, party_id) -> str:
    return " ".join(part for part in (first, last) if part) or party_id


def _step_words(node_type: str | None, config: dict | None) -> str:
    """What the card calls a step: its name, else what it does."""
    config = config or {}
    if config.get("label"):
        return str(config["label"])
    if node_type == "WAIT":
        return "Wait " + waits.describe(config) if waits.mode_of(config) != "DURATION" else f"Wait {config.get('duration', '?')} {str(config.get('unit') or 'DAYS').lower()}"
    if node_type == "CONDITION":
        return "Condition"
    if node_type in MESSAGE_TYPES:
        return f"{'Email' if node_type == 'EMAIL' else node_type}: {config.get('template_name') or 'message'}"
    if node_type == "GOAL":
        return f"Goal: {goals.describe(config)}"
    if node_type == "COUPON_ISSUE":
        return f"Issue coupon {config.get('coupon_name') or ''}".strip()
    if node_type == "LOYALTY_CHANGE":
        return f"Update loyalty tier to {config.get('tier_name') or '?'}"
    if node_type == "SEGMENT_UPDATE":
        return f"{'Remove from' if str(config.get('action') or '').upper() == 'REMOVE' else 'Add to'} segment {config.get('segment_name') or ''}".strip()
    if node_type == "WEBHOOK":
        return webhooks.describe(config)
    if node_type == "EXIT":
        return "Exit journey"
    return str(node_type or "Step").title()


def customers(journey: Journey, q: str = "", status: str = "", page: int = 1, page_size: int = PAGE_SIZE) -> dict:
    page_size = max(1, min(int(page_size or PAGE_SIZE), 200))
    page = max(1, int(page or 1))
    q = (q or "").strip()
    args = {"tenant": str(journey.tenant_id), "journey": str(journey.id), "q": q, "like": f"%{q}%", "status": (status or "").upper(),
            "limit": page_size, "offset": (page - 1) * page_size}
    with _conn().cursor() as cursor:
        cursor.execute(CUSTOMERS_SQL, args)
        rows = cursor.fetchall()
    total = rows[0][-1] if rows else 0
    results = []
    for (enrollment_id, party_id, first, last, email, enrolled_at, version_number, state, converted_at, revenue, exited_at, exit_reason,
         node_key, node_type, config, entered_node_at, next_at, _total) in rows:
        results.append({
            "id": enrollment_id, "party_id": party_id, "name": _name(first, last, party_id), "email": email, "enrolled_at": enrolled_at,
            "version_number": version_number, "status": state, "converted_at": converted_at, "attributed_revenue": float(revenue) if revenue is not None else None,
            "exited_at": exited_at, "exit_reason": exit_reason,
            "where": None if state != "ACTIVE" or node_key is None else {"node_key": node_key, "node_type": node_type, "label": _step_words(node_type, _json(config)),
                                                                           "entered_node_at": entered_node_at, "next_scheduled_at": next_at},
        })
    return {"count": total, "page": page, "page_size": page_size, "results": results}


# ---------------------------------------------------------------------------------------------------- one customer's timeline
EXECUTIONS_SQL = """
SELECT x.id, x.executed_at, x.execution_status, x.result_data, x.generated_campaign_run_id::text, n.node_key, n.node_type, n.config
  FROM journey_node_execution x JOIN journey_node n ON n.id = x.journey_node_id
 WHERE x.tenant_id = %(tenant)s AND x.journey_enrollment_id = %(enrollment)s
 ORDER BY x.executed_at, x.id"""
DELIVERY_SQL = """
SELECT 'EMAIL', campaign_run_id::text, status, status_reason, submitted_at, delivered_at, opened_at, clicked_at, bounced_at, NULL::timestamptz, NULL::timestamptz
  FROM mailer_execution WHERE tenant_id = %(tenant)s AND party_id = %(party)s AND campaign_run_id = ANY(%(runs)s::uuid[])
UNION ALL
SELECT message_type, campaign_run_id::text, status, status_reason, submitted_at, delivered_at, NULL, NULL, NULL, responded_at, failed_at
  FROM sms_execution WHERE tenant_id = %(tenant)s AND party_id = %(party)s AND campaign_run_id = ANY(%(runs)s::uuid[])"""


def timeline(journey: Journey, enrollment_id) -> dict | None:
    enrollment = (JourneyEnrollment.objects.filter(tenant_id=journey.tenant_id, journey=journey, pk=enrollment_id)
                  .select_related("journey_version").first())
    if enrollment is None:
        return None
    args = {"tenant": str(journey.tenant_id), "enrollment": str(enrollment.pk), "party": enrollment.party_id}
    with _conn().cursor() as cursor:
        cursor.execute("SELECT first_name, last_name, lower(emails -> 0 ->> 'address'), custom_attributes FROM customer_master WHERE tenant_id = %(tenant)s AND party_id = %(party)s", args)
        row = cursor.fetchone() or (None, None, None, {})
        row = (row[0], row[1], row[2], _json(row[3]))
        cursor.execute(EXECUTIONS_SQL, args)
        executions = cursor.fetchall()
        runs = [run_id for *_rest, run_id, _key, _type, _config in [(x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]) for x in executions] if run_id]
        delivery: dict[str, dict] = {}
        if runs:
            cursor.execute(DELIVERY_SQL, {**args, "runs": runs})
            for channel, run_id, status, reason, submitted, delivered, opened, clicked, bounced, responded, failed in cursor.fetchall():
                delivery[run_id] = {"channel": channel, "status": status, "status_reason": reason, "submitted_at": submitted, "delivered_at": delivered,
                                    "opened_at": opened, "clicked_at": clicked, "bounced_at": bounced, "responded_at": responded, "failed_at": failed}
        cursor.execute("""SELECT n.node_key, n.node_type, n.config, s.entered_node_at, s.next_scheduled_at, s.state_data FROM journey_customer_state s
                           LEFT JOIN journey_node n ON n.id = s.current_node_id WHERE s.journey_enrollment_id = %(enrollment)s""", args)
        state = cursor.fetchone()
    items = [{"at": executed_at, "node_key": key, "node_type": node_type, "label": _step_words(node_type, _json(config)), "status": status,
              "result": _json(result), "delivery": delivery.get(run_id) if run_id else None}
             for _id, executed_at, status, result, run_id, key, node_type, config in executions]
    state = (state[0], state[1], _json(state[2]), state[3], state[4], _json(state[5])) if state else None
    entry = (state[5] or {}).get("entry") if state else None
    return {
        "id": str(enrollment.pk), "party_id": enrollment.party_id, "name": _name(row[0], row[1], enrollment.party_id), "email": row[2],
        "attributes": row[3] or {}, "enrolled_at": enrollment.enrolled_at, "entry": entry, "version_number": enrollment.journey_version.version_number,
        "status": enrollment.status, "converted_at": enrollment.converted_at,
        "attributed_revenue": float(enrollment.attributed_revenue) if enrollment.attributed_revenue is not None else None,
        "exited_at": enrollment.exited_at, "exit_reason": enrollment.exit_reason,
        "now": None if enrollment.status != "ACTIVE" or not state or state[0] is None else {
            "node_key": state[0], "node_type": state[1], "label": _step_words(state[1], state[2]), "entered_node_at": state[3], "next_scheduled_at": state[4],
            "pending": (state[5] or {}).get("pending")},
        "steps": items,
    }


# ---------------------------------------------------------------------------------------------------- Needs Attention
ATTENTION_SQL = """
SELECT e.id::text, e.party_id, cm.first_name, cm.last_name, lower(cm.emails -> 0 ->> 'address'), n.node_key, n.node_type, n.config, s.state_data -> 'retry', s.next_scheduled_at
  FROM journey_customer_state s
  JOIN journey_enrollment e ON e.id = s.journey_enrollment_id AND e.status = 'ACTIVE'
  LEFT JOIN customer_master cm ON cm.tenant_id = e.tenant_id AND cm.party_id = e.party_id
  LEFT JOIN journey_node n ON n.id = s.current_node_id
 WHERE e.tenant_id = %(tenant)s AND e.journey_id = %(journey)s AND s.state_data ? 'retry'
 ORDER BY (s.state_data -> 'retry' ->> 'gave_up_at') DESC NULLS LAST, s.next_scheduled_at"""


def attention(journey: Journey) -> list[dict]:
    """Customers whose step is being retried or was given up on (apps.journeys.engine.retries): the journey page's Needs Attention card."""
    with _conn().cursor() as cursor:
        cursor.execute(ATTENTION_SQL, {"tenant": str(journey.tenant_id), "journey": str(journey.pk)})
        rows = cursor.fetchall()
    found = []
    for enrollment_id, party_id, first, last, email, node_key, node_type, config, retry, next_at in rows:
        retry = _json(retry)
        found.append({"id": enrollment_id, "party_id": party_id, "name": _name(first, last, party_id), "email": email,
                      "node_key": node_key, "node_type": node_type, "label": _step_words(node_type, _json(config)),
                      "reason": retry.get("reason"), "attempts": retry.get("attempts") or 0, "max_attempts": 3,
                      "next_try_at": next_at if not retry.get("gave_up_at") else None, "gave_up_at": retry.get("gave_up_at"),
                      "first_failed_at": retry.get("first_failed_at")})
    return found


def retry_now(journey: Journey, enrollment_id) -> bool:
    """Retry Now: the step runs again on the next pass."""
    from .engine import retries
    from .models import JourneyCustomerState
    with session.tx():
        state = JourneyCustomerState.objects.select_for_update().filter(journey_enrollment__journey=journey, journey_enrollment_id=enrollment_id,
                                                                         journey_enrollment__status="ACTIVE").first()
        if state is None or not (state.state_data or {}).get("retry"):
            return False
        retries.retry_now(state)
        state.save(update_fields=["state_data", "next_scheduled_at"])
    return True


def skip_step(journey: Journey, enrollment_id) -> bool:
    """Skip Step: the step is recorded as skipped and the customer moves to what follows it (or exits when nothing does)."""
    from django.utils import timezone as dj_timezone

    from .engine.advance import _next
    from .engine.outcome import Done
    from .models import JourneyCustomerState, JourneyEnrollment, JourneyNodeExecution
    with session.tx():
        state = (JourneyCustomerState.objects.select_for_update(of=("self",)).select_related("journey_enrollment", "current_node")
                 .filter(journey_enrollment__journey=journey, journey_enrollment_id=enrollment_id, journey_enrollment__status="ACTIVE").first())
        if state is None or state.current_node is None:
            return False
        enrollment, node = state.journey_enrollment, state.current_node
        retry = (state.state_data or {}).get("retry") or {}
        JourneyNodeExecution.objects.create(journey_enrollment=enrollment, journey_node=node, tenant_id=enrollment.tenant_id, party_id=enrollment.party_id,
                                            execution_status="SKIPPED", result_data={"reason": "Skipped by hand", "after": retry.get("reason"), "attempts": retry.get("attempts")})
        state.state_data = {key: value for key, value in (state.state_data or {}).items() if key not in ("retry", "pending")}
        following = _next(node, None)
        now = dj_timezone.now()
        if following is None:
            JourneyEnrollment.objects.filter(pk=enrollment.pk).update(status="EXITED", exited_at=now, exit_reason=f"No step follows {node.node_key}.")
            state.next_scheduled_at = None
        else:
            state.current_node, state.entered_node_at, state.next_scheduled_at = following, now, now
        state.save(update_fields=["current_node", "entered_node_at", "next_scheduled_at", "state_data"])
        _ = Done
    return True


# ---------------------------------------------------------------------------------------------------- counts on a live canvas
COUNTS_SQL = """
SELECT n.node_key,
       count(DISTINCT x.journey_enrollment_id) FILTER (WHERE x.id IS NOT NULL) AS passed,
       count(DISTINCT x.journey_enrollment_id) FILTER (WHERE x.execution_status = 'SKIPPED') AS held,
       count(DISTINCT x.journey_enrollment_id) FILTER (WHERE x.execution_status = 'FAILED') AS failed,
       count(DISTINCT x.journey_enrollment_id) FILTER (WHERE x.result_data ->> 'met' = 'true' OR x.result_data ->> 'reached' = 'true') AS yes,
       count(DISTINCT x.journey_enrollment_id) FILTER (WHERE x.result_data ->> 'met' = 'false' OR x.result_data ->> 'reached' = 'false') AS no
  FROM journey_node n
  LEFT JOIN journey_node_execution x ON x.journey_node_id = n.id AND x.tenant_id = %(tenant)s
 WHERE n.journey_version_id = %(version)s AND n.deleted_at IS NULL
 GROUP BY n.node_key"""
WAITING_SQL = """
SELECT n.node_key, count(*) FROM journey_customer_state s
  JOIN journey_enrollment e ON e.id = s.journey_enrollment_id AND e.status = 'ACTIVE'
  JOIN journey_node n ON n.id = s.current_node_id
 WHERE e.tenant_id = %(tenant)s AND e.journey_version_id = %(version)s
 GROUP BY n.node_key"""


def counts(version: JourneyVersion) -> dict:
    args = {"tenant": str(version.journey.tenant_id), "version": str(version.pk)}
    with _conn().cursor() as cursor:
        cursor.execute(COUNTS_SQL, args)
        found = {key: {"passed": passed, "held_back": held, "failed": failed, "yes": yes, "no": no, "waiting": 0}
                 for key, passed, held, failed, yes, no in cursor.fetchall()}
        cursor.execute(WAITING_SQL, args)
        for key, waiting in cursor.fetchall():
            found.setdefault(key, {"passed": 0, "held_back": 0, "failed": 0, "yes": 0, "no": 0, "waiting": 0})["waiting"] = waiting
        cursor.execute("SELECT count(*), count(*) FILTER (WHERE status = 'ACTIVE') FROM journey_enrollment WHERE tenant_id = %(tenant)s AND journey_version_id = %(version)s", args)
        entered, inside = cursor.fetchone()
    return {"entered": entered, "in_journey": inside, "steps": found}


# ---------------------------------------------------------------------------------------------------- Preview Route
SEARCH_SQL = """
SELECT cm.party_id, cm.first_name, cm.last_name, lower(cm.emails -> 0 ->> 'address'), cm.custom_attributes
  FROM customer_master cm
 WHERE cm.tenant_id = %(tenant)s AND (cm.first_name ILIKE %(like)s OR cm.last_name ILIKE %(like)s OR (cm.first_name || ' ' || cm.last_name) ILIKE %(like)s
       OR (cm.emails -> 0 ->> 'address') ILIKE %(like)s OR cm.party_id = %(q)s)
 ORDER BY cm.last_name, cm.first_name LIMIT 10"""
SEND_CHECK_SQL = {
    "EMAIL": f"""
SELECT {PRIMARY_EMAIL_SQL} AS address, {status_sql()} AS status
  FROM customer_master cm
  LEFT JOIN LATERAL (SELECT x.consent_status, x.suppressed FROM consent_suppression x WHERE x.tenant_id = cm.tenant_id AND x.party_id = cm.party_id AND x.channel = 'EMAIL'
                     ORDER BY x.updated_at DESC NULLS LAST LIMIT 1) cs ON TRUE
  LEFT JOIN LATERAL (SELECT p.blocked, p.block_reason, p.is_valid FROM contact_point_status p
                     WHERE p.tenant_id = cm.tenant_id AND p.contact_point_type = 'EMAIL' AND p.contact_value = {PRIMARY_EMAIL_SQL} LIMIT 1) cps ON TRUE
 WHERE cm.tenant_id = %(tenant)s AND cm.party_id = %(party)s""",
    "SMS": """
SELECT (cm.phones -> 0 ->> 'number') AS number,
       CASE WHEN (cm.phones -> 0 ->> 'number') IS NULL THEN 'NO_NUMBER'
            WHEN cps.blocked THEN 'BLOCKED' WHEN cs.suppressed THEN 'SUPPRESSED' WHEN cs.consent_status = 'OPTED_OUT' THEN 'UNSUBSCRIBED'
            WHEN COALESCE(cs.consent_status, 'UNKNOWN') <> 'OPTED_IN' THEN 'NO_CONSENT' ELSE 'MARKETABLE' END AS status
  FROM customer_master cm
  LEFT JOIN LATERAL (SELECT x.consent_status, x.suppressed FROM consent_suppression x WHERE x.tenant_id = cm.tenant_id AND x.party_id = cm.party_id AND x.channel IN ('SMS', 'MMS')
                     ORDER BY x.updated_at DESC NULLS LAST LIMIT 1) cs ON TRUE
  LEFT JOIN LATERAL (SELECT p.blocked FROM contact_point_status p WHERE p.tenant_id = cm.tenant_id AND p.contact_point_type = 'PHONE' AND p.contact_value = (cm.phones -> 0 ->> 'number') LIMIT 1) cps ON TRUE
 WHERE cm.tenant_id = %(tenant)s AND cm.party_id = %(party)s""",
}
SMS_STATUS = {"NO_NUMBER": "No mobile number on the record", "BLOCKED": "Number blocked (STOP or registry)", "SUPPRESSED": "Suppressed",
              "UNSUBSCRIBED": "Opted out of texts", "NO_CONSENT": "No text consent on record", "MARKETABLE": "Can receive texts"}
DEPENDENT_KINDS = ("message", "step", "goal")


def search_customers(tenant_id, q: str) -> list[dict]:
    q = (q or "").strip()
    if not q:
        return []
    with _conn().cursor() as cursor:
        cursor.execute(SEARCH_SQL, {"tenant": str(tenant_id), "q": q, "like": f"%{q}%"})
        return [{"party_id": party_id, "name": _name(first, last, party_id), "email": email,
                 "summary": " · ".join(str(value) for key, value in (attributes or {}).items() if key in ("loyalty_tier", "home_store", "customer_status", "timezone") and value)}
                for party_id, first, last, email, attributes in ((r[0], r[1], r[2], r[3], _json(r[4])) for r in cursor.fetchall())]


def _holds(rule, args: dict, in_journey: bool) -> bool | None:
    """Whether a condition rule holds for the preview customer now; None when it cannot be read."""
    where = conditions.compile_where(rule, args, in_journey=in_journey, prefix="p")
    if where is None:
        return None
    source = ("FROM (SELECT %(tenant)s::uuid AS tenant_id, %(party)s AS party_id, now() AS enrolled_at, NULL::uuid AS id, %(journey)s::uuid AS journey_id, NULL::timestamptz AS converted_at) e "
              "JOIN customer_master cm ON cm.tenant_id = e.tenant_id AND cm.party_id = e.party_id") if in_journey else "FROM customer_master cm"
    with _conn().cursor() as cursor:
        cursor.execute(f"SELECT EXISTS (SELECT 1 {source} WHERE cm.tenant_id = %(tenant)s AND cm.party_id = %(party)s AND {where})", args)
        return bool(cursor.fetchone()[0])


def _depends(rule) -> bool:
    """A rule that looks at this journey's messages, earlier steps or the goal: nothing has happened yet in a preview."""
    try:
        cleaned = conditions.clean(rule, in_journey=True)
    except conditions.RuleError:
        return False
    def walk(group) -> bool:
        for item in group["conditions"]:
            if "conditions" in item:
                if walk(item):
                    return True
            elif conditions.field_kind(item["field"])[0] in DEPENDENT_KINDS:
                return True
        return False
    return walk(cleaned)


def _entry_words(version: JourneyVersion, args: dict) -> tuple[str, bool | None]:
    rule = JourneyEntryRule.objects.filter(journey_version=version, deleted_at__isnull=True).order_by("created_at").first()
    if rule is None:
        return "No entry rule yet.", None
    definition = rule.rule_definition or {}
    filters = definition.get("filters") if isinstance(definition.get("filters"), dict) else None
    filtered = _holds(filters, dict(args), False) if filters and conditions.count_conditions(conditions.clean(filters, in_journey=False)) else None
    if filtered is False:
        return "Would not enter: the Only Customers Where filters do not match this record.", False
    passed = " The entry filters pass." if filtered else ""
    if rule.entry_type == "SEGMENT_CHANGE" and str(definition.get("change_trigger") or "").upper() == conditions.ATTRIBUTE_MATCH:
        holds = _holds(definition.get("rule"), dict(args), False)
        return ("Would enter now: the record matches." + passed, True) if holds else ("Would not enter: the record does not match the conditions.", False)
    if rule.entry_type == "EVENT":
        from . import events
        return f"Enters when a {events.label(str(definition.get('event_type') or 'matching'))} event arrives for them.{passed}", True
    if rule.entry_type == "CUSTOMER_LIST":
        with _conn().cursor() as cursor:
            cursor.execute("SELECT EXISTS (SELECT 1 FROM contact_list_member WHERE tenant_id = %(tenant)s AND party_id = %(party)s AND contact_list_id::text = %(list)s)",
                           {**args, "list": str(definition.get("contact_list_id") or "")})
            member = cursor.fetchone()[0]
        return ("Would enter: on the list." + passed, True) if member else ("Would not enter: not on the list.", False)
    if rule.entry_type == "SEGMENT_CHANGE":
        return f"Enters when they {'leave' if str(definition.get('change') or '').upper() == 'LEFT' else 'join'} the segment, or on a {str(definition.get('change_trigger') or 'segment').replace('_', ' ').lower()} change.{passed}", True
    if rule.entry_type == "DATE_TIME":
        return f"Enters on the schedule: {schedule.describe(definition)}.{passed}", True
    return "Enters on the entry rule.", True


def preview(version: JourneyVersion, party_id: str, assumptions: dict | None = None) -> dict:
    """The route, one entry per step reached, with a virtual clock that starts now."""
    journey = version.journey
    tenant = str(journey.tenant_id)
    assumptions = {str(key): str(value).upper() for key, value in (assumptions or {}).items()}
    with _conn().cursor() as cursor:
        cursor.execute("SELECT first_name, last_name, lower(emails -> 0 ->> 'address'), custom_attributes FROM customer_master WHERE tenant_id = %s AND party_id = %s", [tenant, party_id])
        row = cursor.fetchone()
    if row is None:
        return {"customer": None, "steps": [], "entry": None}
    attributes = _json(row[3])
    customer = {"party_id": party_id, "name": _name(row[0], row[1], party_id), "email": row[2], "attributes": attributes}
    args = {"tenant": tenant, "party": party_id, "journey": str(journey.pk)}
    entry_words, enters = _entry_words(version, args)
    workspace_zone = schedule.tenant_zone(tenant)
    clock = timezone.now()
    steps: list[dict] = []
    node = JourneyNode.objects.filter(journey_version=version, node_family="ENTRY", deleted_at__isnull=True).order_by("created_at").first()
    converted = False
    node = _next(node, None) if node is not None else None
    for _hop in range(MAX_HOPS):
        if node is None:
            break
        config = node.config or {}
        entry = {"node_key": node.node_key, "node_type": node.node_type, "label": _step_words(node.node_type, config), "at": None, "depends": False, "assumed": None, "branch": None}
        branch = None
        if node.node_type == "WAIT":
            if waits.mode_of(config) == "DURATION":
                seconds = steps_engine.wait_seconds(config)
                clock = clock + timedelta(seconds=seconds or 0)
                entry["outcome"] = f"Continues {clock.astimezone(workspace_zone).strftime('%a %d %b, %H:%M')}" if seconds else "No duration set: continues at once"
            else:
                at = schedule._time(config)                 # noqa: SLF001
                zone, own = waits.customer_zone(attributes, workspace_zone) if str(config.get("zone") or "CUSTOMER").upper() == "CUSTOMER" else (workspace_zone, False)
                if at is None:
                    entry["outcome"] = "The wait has no time yet"
                elif waits.mode_of(config) == "TIME_OF_DAY":
                    clock = max(clock, waits.next_time_of_day(at, list(config.get("weekdays") or []), zone, clock))
                    entry["outcome"] = f"Continues {clock.astimezone(zone).strftime('%a %d %b, %H:%M %Z')}{' (their time)' if own else ''}"
                else:
                    moment = waits.date_moment(attributes.get(str(config.get("attribute") or "")), int(config.get("offset_days") or 0), at, zone)
                    if moment is None or moment <= clock:
                        exits = str(config.get("if_passed") or "CONTINUE").upper() == "EXIT"
                        entry["outcome"] = ("No date on the record" if moment is None else "The date has passed") + (": would exit the journey" if exits else ": continues at once")
                        if exits:
                            entry["at"] = clock
                            steps.append(entry)
                            break
                    else:
                        clock = moment
                        entry["outcome"] = f"Continues {clock.astimezone(zone).strftime('%a %d %b, %H:%M %Z')}{' (their time)' if own else ''}"
            entry["at"] = clock
        elif node.node_type in MESSAGE_TYPES:
            kind = "EMAIL" if node.node_type == "EMAIL" else "SMS"
            with _conn().cursor() as cursor:
                cursor.execute(SEND_CHECK_SQL[kind], args)
                check = cursor.fetchone()
            address, status = (check or (None, "NO_EMAIL"))
            if kind == "EMAIL":
                words = "No email address on the record" if not address else STATUSES.get(status, (status, False))[0]
                ok = bool(address) and STATUSES.get(status, (status, False))[1]
            else:
                words, ok = SMS_STATUS.get(status, status), status == "MARKETABLE"
            template = "" if config.get("template_id") else " No template chosen yet."
            entry["outcome"] = (f"Would send to {address}: {words.lower()}. Frequency caps and quiet hours apply at send time." if ok else f"Would be held back: {words.lower()}.") + template
            entry["at"] = clock
        elif node.node_type == "CONDITION":
            rule = config.get("rule") if isinstance(config.get("rule"), dict) else None
            if rule is None or _depends(rule):
                entry["depends"] = True
                entry["assumed"] = "YES" if assumptions.get(node.node_key) == "YES" else "NO"
                branch = entry["assumed"]
                entry["outcome"] = "Depends on what has not happened yet in this journey: " + ("assuming Yes" if branch == "YES" else "assuming No")
            else:
                holds = _holds(rule, dict(args), True)
                branch = "YES" if holds else "NO"
                entry["outcome"] = "Yes: the record matches now" if holds else "No: the record does not match now"
            entry["branch"] = branch
            entry["at"] = clock
        elif node.node_type == "GOAL":
            entry["depends"] = True
            entry["assumed"] = "YES" if assumptions.get(node.node_key) == "YES" else "NO"
            reached = entry["assumed"] == "YES"
            entry["at"] = clock
            if reached:
                converted = True
                if goals.continues(config):
                    branch = "YES"
                    entry["outcome"] = "Assuming the goal is reached: converted, the Reached path continues"
                else:
                    entry["outcome"] = "Assuming the goal is reached: converted and out of the journey"
                    entry["branch"] = None
                    steps.append(entry)
                    break
            else:
                branch = "NO" if goals.continues(config) else None
                entry["outcome"] = "Not reached yet" + ("; the Not Yet path continues" if goals.continues(config) else "; continues")
            entry["branch"] = branch
        elif node.node_type == "EXIT":
            entry["outcome"] = f"Would exit {clock.astimezone(workspace_zone).strftime('%a %d %b')} as {'converted' if converted else 'not converted'}"
            entry["at"] = clock
            steps.append(entry)
            break
        else:
            entry["outcome"] = {"COUPON_ISSUE": "Would request the coupon from C360", "LOYALTY_CHANGE": "Would set the loyalty tier",
                                "SEGMENT_UPDATE": "Would change the segment membership", "WEBHOOK": f"Would POST to {webhooks.host_of(config)} (not called in a preview)",
                                "PROFILE_UPDATE": "Would set the attribute", "LIST_ADD": "Would add to the list", "LIST_REMOVE": "Would remove from the list"}.get(node.node_type, "Would run")
            entry["at"] = clock
        steps.append(entry)
        following = _next(node, branch)
        if following is None:
            steps.append({"node_key": None, "node_type": "END", "label": "End of the path", "at": clock, "depends": False, "assumed": None, "branch": None,
                          "outcome": f"Would exit {clock.astimezone(workspace_zone).strftime('%a %d %b')} as {'converted' if converted else 'not converted'}: nothing follows"})
            break
        node = following
    return {"customer": customer, "entry": {"outcome": entry_words, "enters": enters}, "steps": steps, "sends": False}
