"""Advancing: customers whose next step is due move through the journey.

A customer whose step is over moves along the connection the step chose (branch_key YES / NO / a split's path, or the
unlabelled one) and the next step runs at once, in the same pass, until one holds them (a Wait, a message on its way) or
the journey ends for them. Every step that finishes writes a journey_node_execution row (SUCCESS / FAILED / SKIPPED). A
failed or skipped step does not stop the customer: they carry on, as the content brief asks. A step with nowhere to go
next ends the journey for that customer (EXITED).

Each customer is handled in a transaction of its own, their state row locked (SKIP LOCKED: two schedulers never handle
the same customer). Only journeys that are ACTIVE move; a paused journey keeps everyone where they are.
"""
import logging

from django.utils import timezone

from apps.delivery.engine import session

from ..models import JourneyConnection, JourneyCustomerState, JourneyEnrollment, JourneyNodeExecution
from . import steps, tenants
from .outcome import Done, Finish, Hold

log = logging.getLogger("cep.journeys")
PER_PASS = 2000                                           # customers per tenant and pass
MAX_HOPS = 50                                             # steps per customer and pass: a loop in the graph cannot spin forever

DUE = """SELECT s.journey_enrollment_id FROM journey_customer_state s
           JOIN journey_enrollment e ON e.id = s.journey_enrollment_id
           JOIN journey j ON j.id = e.journey_id AND j.tenant_id = e.tenant_id
          WHERE e.tenant_id = %s AND s.next_scheduled_at <= now() AND e.status = 'ACTIVE' AND j.status = 'ACTIVE' AND j.deleted_at IS NULL
          ORDER BY s.next_scheduled_at LIMIT %s"""


def _record(node, enrollment, outcome: Done) -> None:
    JourneyNodeExecution.objects.create(journey_enrollment=enrollment, journey_node=node, tenant_id=enrollment.tenant_id, party_id=enrollment.party_id,
                                        execution_status=outcome.status, result_data=outcome.result or None, generated_campaign_run_id=outcome.run_id)


def _next(node, branch: str | None):
    edges = list(JourneyConnection.objects.select_related("to_node").filter(from_node=node, deleted_at__isnull=True))
    wanted = str(branch).upper() if branch else None
    chosen = next((edge for edge in edges if wanted and (edge.branch_key or "").upper() == wanted), None)
    chosen = chosen or next((edge for edge in edges if not edge.branch_key), None)
    if chosen is None and not wanted and len(edges) == 1:
        chosen = edges[0]
    return chosen.to_node if chosen else None


def _finish(state, enrollment, status: str, reason: str | None) -> None:
    now = timezone.now()
    JourneyEnrollment.objects.filter(pk=enrollment.pk).update(status=status, exited_at=now, exit_reason=reason)
    state.next_scheduled_at = None
    state.state_data.pop("pending", None)


def advance_one(enrollment_id) -> str:
    """One customer, as far as they can go now. -> 'moved', 'held', 'finished' or 'busy' (someone else has them)."""
    with session.tx():
        state = (JourneyCustomerState.objects.select_for_update(skip_locked=True, of=("self",))
                 .select_related("journey_enrollment__journey", "current_node")
                 .filter(pk=enrollment_id, next_scheduled_at__lte=timezone.now()).first())
        if state is None:
            return "busy"
        enrollment = state.journey_enrollment
        state.state_data = state.state_data or {}
        outcome_label = "held"
        for _hop in range(MAX_HOPS):
            node = state.current_node
            if node is None:
                _finish(state, enrollment, "EXITED", "Their step no longer exists.")
                outcome_label = "finished"
                break
            outcome = steps.run(node, state, enrollment)
            if isinstance(outcome, Hold):
                state.next_scheduled_at = outcome.until
                break
            if isinstance(outcome, Finish):
                _record(node, enrollment, Done("SUCCESS", {"finished": outcome.status}))
                _finish(state, enrollment, outcome.status, outcome.reason)
                outcome_label = "finished"
                break
            _record(node, enrollment, outcome)
            state.state_data.pop("pending", None)
            following = _next(node, outcome.branch)
            if following is None:
                _finish(state, enrollment, "EXITED", f"No step follows {node.node_key}" + (f" on the {outcome.branch} path." if outcome.branch else "."))
                outcome_label = "finished"
                break
            now = timezone.now()
            state.current_node, state.entered_node_at, state.next_scheduled_at = following, now, now
            outcome_label = "moved"
        else:
            log.warning("enrollment %s took %s steps in one pass; it continues on the next", enrollment.pk, MAX_HOPS)
        state.save(update_fields=["current_node", "entered_node_at", "next_scheduled_at", "state_data"])
        return outcome_label


def advance_tenant(tenant_id: str) -> dict:
    counts = {"moved": 0, "held": 0, "finished": 0, "busy": 0, "failed": 0}
    with session.tenant_scope(tenant_id):
        with session.tx(), session.connection().cursor() as cursor:
            cursor.execute(DUE, [str(tenant_id), PER_PASS])
            due = [row[0] for row in cursor.fetchall()]
        for enrollment_id in due:
            try:
                counts[advance_one(enrollment_id)] += 1
            except Exception:                              # noqa: BLE001  one customer's trouble must not stop the others; they are tried again next pass
                log.exception("journey enrollment %s could not advance", enrollment_id)
                counts["failed"] += 1
    return counts


def run() -> dict:
    totals = {"tenants": 0, "moved": 0, "held": 0, "finished": 0, "busy": 0, "failed": 0}
    for tenant_id in tenants("""SELECT DISTINCT e.tenant_id FROM journey_customer_state s
                                  JOIN journey_enrollment e ON e.id = s.journey_enrollment_id
                                  JOIN journey j ON j.id = e.journey_id JOIN tenant t ON t.id = e.tenant_id
                                 WHERE s.next_scheduled_at <= now() AND e.status = 'ACTIVE' AND j.status = 'ACTIVE' AND j.deleted_at IS NULL
                                   AND t.status = 'ACTIVE'"""):
        try:
            counts = advance_tenant(tenant_id)
        except Exception:                                  # noqa: BLE001
            log.exception("journeys could not advance for tenant %s", tenant_id)
            totals["failed"] += 1
            continue
        totals["tenants"] += 1
        for key, value in counts.items():
            totals[key] += value
    return totals
