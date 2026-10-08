"""The Goal step (node_type GOAL): the outcome a journey is for, and what counts as converted.

    config  {event_type, props: [{key, op, value}], window_days: 1..365, when_reached: EXIT | CONTINUE, label?}

A customer has reached the goal when an event of `event_type` (with the property filters, apps.journeys.conditions'
operators) occurred after they entered the journey and within `window_days` of entering. The step is checked twice:

    when the customer reaches it (steps.py -> `run`)          reached: converted, then Finish (EXIT) or the YES branch
                                                              (CONTINUE: "Reached"); not yet: the NO branch ("Not yet")
    on every advance pass (`check_tenant`)                    a matching event that arrives while the customer is anywhere in
                                                              the journey converts them; with EXIT they leave at once
                                                              ("Goal reached"), with CONTINUE they carry on where they are

Converted means journey_enrollment.converted_at (the first matching event's moment), converted_node_id (the goal step) and
attributed_revenue (the sum of the matching events' `amount`, what purchases from Attribution carry). A journey with a Goal
counts "Goal Converted" on the journey page from these; one without keeps counting customers who reach an Exit step.
"""
import logging

from django.utils import timezone

from apps.delivery.engine import session

from . import conditions, events
from .engine.outcome import Done, Finish

log = logging.getLogger("cep.journeys")

MAX_WINDOW = 365
WHEN_REACHED = ("EXIT", "CONTINUE")
REACHED_REASON = "Goal reached"


def problem(config: dict) -> str | None:
    """What the goal still needs, in words; None when it is complete."""
    event_type = str(config.get("event_type") or "").strip().upper()
    if not event_type:
        return "Choose the event that counts as the goal."
    if not events.TYPE.match(event_type):
        return "An event type is capital letters, digits and underscores, starting with a letter."
    window = config.get("window_days", 30)
    if isinstance(window, bool) or not isinstance(window, int) or not 1 <= window <= MAX_WINDOW:
        return f"window_days is a whole number from 1 to {MAX_WINDOW}."
    if str(config.get("when_reached") or "EXIT").upper() not in WHEN_REACHED:
        return "when_reached is EXIT or CONTINUE."
    found = conditions.problem({"conditions": [{"field": f"event:{event_type}", "op": "happened", "props": config.get("props") or []}]}, in_journey=True)
    return found


def configured(config: dict) -> bool:
    return problem(config) is None


def continues(config: dict) -> bool:
    return str(config.get("when_reached") or "EXIT").upper() == "CONTINUE"


def _matching(config: dict, args: dict, prefix: str = "g") -> str:
    """The matching events of the enrolled customer `e`, as a SQL fragment over journey_event je; parameters added to args."""
    event_type = str(config["event_type"]).strip().upper()
    cleaned = conditions.clean({"conditions": [{"field": f"event:{event_type}", "op": "happened", "props": config.get("props") or []}]}, in_journey=True)
    params = conditions._Params(args, prefix)             # noqa: SLF001  the same parameter naming the conditions use
    where = [f"je.tenant_id = e.tenant_id", "je.party_id = e.party_id", f"je.event_type = {params.add(event_type)}",
             "je.occurred_at >= e.enrolled_at", f"je.occurred_at < e.enrolled_at + make_interval(days => {params.add(int(config.get('window_days', 30)))})"]
    for prop in cleaned["conditions"][0].get("props") or []:
        raw = f"(je.event_payload ->> {params.add(prop['key'])})"
        if prop["op"] in conditions.NUMBER_OPS:
            where.append(conditions._number_predicate(f"(CASE WHEN {raw} ~ '{conditions.NUMBER_TEXT}' THEN {raw}::numeric END)", prop["op"], prop.get("value"), params))  # noqa: SLF001
        else:
            where.append(conditions._text_predicate(raw, prop["op"], prop.get("value"), params))  # noqa: SLF001
    return " AND ".join(where)


REACHED = """
SELECT min(je.occurred_at), COALESCE(sum(CASE WHEN je.event_payload ->> 'amount' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (je.event_payload ->> 'amount')::numeric END), 0)
  FROM journey_enrollment e JOIN journey_event je ON {matching}
 WHERE e.id = %(enrollment)s"""

CONVERT = """
UPDATE journey_enrollment SET converted_at = %(at)s, converted_node_id = %(node)s, attributed_revenue = %(revenue)s
 WHERE id = %(enrollment)s AND converted_at IS NULL"""


def reached(config: dict, enrollment) -> tuple | None:
    """(first matching moment, revenue) for this enrolled customer, or None."""
    args = {"enrollment": str(enrollment.pk)}
    sql = REACHED.format(matching=_matching(config, args))
    with session.connection().cursor() as cursor:
        cursor.execute(sql, args)
        at, revenue = cursor.fetchone()
    return (at, revenue) if at else None


def convert(enrollment, node, at, revenue) -> bool:
    with session.connection().cursor() as cursor:
        cursor.execute(CONVERT, {"at": at, "node": str(node.pk), "revenue": revenue, "enrollment": str(enrollment.pk)})
        return cursor.rowcount > 0


def run(node, state, enrollment) -> Done | Finish:
    """The step itself: reached -> converted and out (EXIT) or the YES branch (CONTINUE); not yet -> the NO branch."""
    config = node.config or {}
    found = problem(config)
    if found:
        return Done("FAILED", {"reason": found}, branch="NO")
    hit = reached(config, enrollment)
    if hit is None:
        return Done(result={"reached": False}, branch="NO")
    at, revenue = hit
    convert(enrollment, node, at, revenue)
    result = {"reached": True, "at": at.isoformat(), "revenue": float(revenue or 0)}
    if continues(config):
        return Done(result=result, branch="YES")
    return Finish("COMPLETED", REACHED_REASON)


# ---------------------------------------------------------------------------------------------------- the pass
GOAL_NODES = """
SELECT n.id, n.journey_version_id, n.config FROM journey_node n
  JOIN journey_version v ON v.id = n.journey_version_id
  JOIN journey j ON j.id = v.journey_id
 WHERE j.tenant_id = %(tenant)s AND j.status = 'ACTIVE' AND j.deleted_at IS NULL AND n.node_type = 'GOAL' AND n.deleted_at IS NULL
   AND v.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM journey_enrollment e WHERE e.journey_version_id = v.id AND e.status = 'ACTIVE' AND e.converted_at IS NULL)"""

CONVERT_MANY = """
WITH hit AS (
    SELECT e.id, min(je.occurred_at) AS at,
           COALESCE(sum(CASE WHEN je.event_payload ->> 'amount' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (je.event_payload ->> 'amount')::numeric END), 0) AS revenue
      FROM journey_enrollment e JOIN journey_event je ON {matching}
     WHERE e.tenant_id = %(tenant)s AND e.journey_version_id = %(version)s AND e.status = 'ACTIVE' AND e.converted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM journey_customer_state s WHERE s.journey_enrollment_id = e.id AND s.state_data ->> 'entry' = 'TEST_PUBLISH')
     GROUP BY e.id LIMIT %(limit)s
), marked AS (
    UPDATE journey_enrollment e SET converted_at = hit.at, converted_node_id = %(node)s, attributed_revenue = hit.revenue
      FROM hit WHERE e.id = hit.id RETURNING e.id, e.party_id, e.tenant_id, hit.at, hit.revenue
), recorded AS (
    INSERT INTO journey_node_execution (journey_enrollment_id, journey_node_id, tenant_id, party_id, execution_status, result_data, executed_at)
    SELECT id, %(node)s, tenant_id, party_id, 'SUCCESS', jsonb_build_object('reached', true, 'at', at, 'revenue', revenue, 'while', 'in journey'), now() FROM marked
)
SELECT id FROM marked"""

EXIT_MANY = """
WITH gone AS (
    UPDATE journey_enrollment SET status = 'COMPLETED', exited_at = now(), exit_reason = %(reason)s
     WHERE id = ANY(%(ids)s) AND status = 'ACTIVE' RETURNING id
)
UPDATE journey_customer_state s SET next_scheduled_at = NULL, state_data = s.state_data - 'pending' FROM gone WHERE s.journey_enrollment_id = gone.id"""

PER_PASS = 5000


def check_tenant(tenant_id: str) -> dict:
    """Must run inside session.tenant_scope. Converts the customers of every live goal whose event has arrived since they
    entered; with EXIT they leave the journey at once."""
    counts = {"converted": 0, "exited": 0}
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(GOAL_NODES, {"tenant": str(tenant_id)})
        goals = cursor.fetchall()
    for node_id, version_id, config in goals:
        config = config if isinstance(config, dict) else {}
        if problem(config):
            continue
        args = {"tenant": str(tenant_id), "version": str(version_id), "node": str(node_id), "limit": PER_PASS}
        try:
            with session.tx(), session.connection().cursor() as cursor:
                cursor.execute(CONVERT_MANY.format(matching=_matching(config, args)), args)
                ids = [row[0] for row in cursor.fetchall()]
                counts["converted"] += len(ids)
                if ids and not continues(config):
                    cursor.execute(EXIT_MANY, {"ids": [str(item) for item in ids], "reason": REACHED_REASON})
                    counts["exited"] += len(ids)
        except Exception:                                  # noqa: BLE001  one goal's trouble must not stop the others
            log.exception("goal %s could not be checked", node_id)
    return counts


def describe(config: dict) -> str:
    """'Purchase within 14 days of entering' — the card's line and readiness."""
    event_type = str(config.get("event_type") or "").strip().upper()
    if not event_type:
        return "No goal event chosen"
    props = config.get("props") or []
    filtered = f" with {len(props)} filter{'s' if len(props) != 1 else ''}" if props else ""
    return f"{events.label(event_type)}{filtered} within {int(config.get('window_days', 30))} days of entering"
