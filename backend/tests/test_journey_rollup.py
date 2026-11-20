"""The nightly journey rollup (apps.journeys.engine.rollup) for a workspace whose journeys have never run: no facts yet, so the
rollup starts from the beginning instead of failing (on .68 it failed for CITYST with "timestamp too small: '-infinity'"). Rolled back."""
import pytest

from apps.delivery.engine import session
from apps.journeys.engine import rollup

from .test_journey_events import T, make_journey, sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_a_workspace_whose_journeys_never_ran(check):
    with session.tenant_scope(T):
        sql("DELETE FROM journey_execution_master_analytical WHERE tenant_id = %s", [T], fetch=False)     # no facts yet
        make_journey("never ran", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_NEVER"}}, nodes=[("WAIT", {"duration": 1, "unit": "DAYS"})])
        result = rollup.rollup_tenant(T)
        check("the rollup runs and counts the journeys", result["journeys"] >= 1, str(result))
        totals = rollup.run()
        check("the nightly run reports no failed workspace", totals["failed"] == 0, str(totals))
    check.done()
