"""The Goal step (apps.journeys.goals): what counts as reached, conversion when the customer reaches the step and when the event
arrives while they are anywhere in the journey, exit or continue, the revenue, the journey page's figures and the nightly rollup."""
import json
import uuid
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.delivery.engine import session
from apps.journeys import details, events, goals, graph, publish
from apps.journeys.engine import enroll, rollup, steps
from apps.journeys.engine.outcome import Done, Finish
from apps.journeys.models import JourneyEnrollment, JourneyNode, JourneyVersion
from apps.reporting.models import JourneyMasterAnalytical

from .test_journey_events import T, customers, enrolled, make_journey, sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_goal_rules(check):
    check("a goal needs an event", goals.problem({}) == "Choose the event that counts as the goal." and goals.problem({"event_type": "PURCHASE"}) is None)
    check("the window is 1 to 365 days and when_reached EXIT or CONTINUE", "window_days" in goals.problem({"event_type": "PURCHASE", "window_days": 0})
          and "when_reached" in goals.problem({"event_type": "PURCHASE", "when_reached": "MAYBE"}))
    check("property filters use the condition operators", goals.problem({"event_type": "PURCHASE", "props": [{"key": "amount", "op": "gte", "value": 25}]}) is None
          and goals.problem({"event_type": "PURCHASE", "props": [{"key": "amount", "op": "sideways", "value": 25}]}) is not None)
    check("the goal reads in words", goals.describe({"event_type": "PURCHASE", "window_days": 14, "props": [{"key": "amount", "op": "gte", "value": 25}]}) == "Purchase with 1 filter within 14 days of entering")
    check("readiness: configured when complete", publish._step_configured(SimpleNamespace(node_type="GOAL", config={"event_type": "PURCHASE"}))
          and not publish._step_configured(SimpleNamespace(node_type="GOAL", config={})))
    bad = {"entry_rules": [], "nodes": [{"key": "start", "type": "START", "config": {}}, {"key": "g", "type": "GOAL", "config": {"event_type": "PURCHASE", "window_days": 900}}],
           "connections": [{"from": "start", "to": "g"}]}
    with pytest.raises(ValidationError) as caught:
        graph.clean(bad)
    check("saving refuses a goal that is wrong", "window_days" in json.dumps(caught.value.detail), json.dumps(caught.value.detail))


def test_goal_in_a_journey(check, fresh_cache):
    with session.tenant_scope(T):
        (p1, _e1), (p2, _e2), (p3, _e3), (p4, _e4) = customers(4)
        tag = uuid.uuid4().hex[:6].upper()
        enter, hit = f"ZJ_ENTER_{tag}", f"ZJ_BUY_{tag}"
        goal = {"event_type": hit, "window_days": 14, "when_reached": "EXIT", "props": [{"key": "amount", "op": "gte", "value": 25}]}
        journey = make_journey("goal", entry={"entry_type": "EVENT", "rule_definition": {"event_type": enter}},
                               nodes=[("WAIT", {"duration": 1, "unit": "DAYS"}), ("GOAL", goal)])
        version = JourneyVersion.objects.get(journey=journey)
        node = JourneyNode.objects.get(journey_version=version, node_key="goal-1")
        events.ingest(T, [events.clean({"event_type": enter, "party_id": party})[0] for party in (p1, p2, p3)])
        enroll.enroll_journey(T, journey)
        check("three customers are in", enrolled(journey) == {p1, p2, p3}, str(enrolled(journey)))

        # ---- the event arrives while they wait: converted, and out (EXIT)
        events.ingest(T, [events.clean({"event_type": hit, "party_id": p1, "payload": {"amount": 40}})[0],
                          events.clean({"event_type": hit, "party_id": p2, "payload": {"amount": 10}})[0]])
        counts = goals.check_tenant(T)
        row = JourneyEnrollment.objects.get(journey=journey, party_id=p1)
        other = JourneyEnrollment.objects.get(journey=journey, party_id=p2)
        check("a matching event converts the customer and, with EXIT, takes them out of the journey",
              counts == {"converted": 1, "exited": 1} and row.converted_at is not None and float(row.attributed_revenue) == 40.0
              and row.status == "COMPLETED" and row.exit_reason == goals.REACHED_REASON and str(row.converted_node_id) == str(node.pk), f"{counts} {row.status} {row.exit_reason}")
        check("an event the filters refuse converts nobody", other.converted_at is None and other.status == "ACTIVE")
        recorded = sql("SELECT result_data FROM journey_node_execution WHERE tenant_id = %s AND journey_enrollment_id = %s AND journey_node_id = %s", [T, str(row.pk), str(node.pk)])
        check("the goal step records the conversion", len(recorded) == 1 and recorded[0][0]["reached"] and recorded[0][0]["while"] == "in journey", str(recorded))
        check("a second pass converts nobody twice", goals.check_tenant(T) == {"converted": 0, "exited": 0})

        # ---- CONTINUE: converted, but they carry on
        JourneyNode.objects.filter(pk=node.pk).update(config={**goal, "when_reached": "CONTINUE"})
        events.ingest(T, [events.clean({"event_type": hit, "party_id": p2, "payload": {"amount": 60}})[0]])
        counts = goals.check_tenant(T)
        other.refresh_from_db()
        check("with CONTINUE the customer is converted and stays in the journey", counts == {"converted": 1, "exited": 0} and other.converted_at is not None
              and other.status == "ACTIVE" and float(other.attributed_revenue) == 60.0, f"{counts} {other.status}")

        # ---- reaching the step
        third = JourneyEnrollment.objects.get(journey=journey, party_id=p3)
        state = SimpleNamespace(state_data={}, entered_node_at=timezone.now())
        node.refresh_from_db()
        outcome = steps.run(node, state, third)
        check("reaching the goal without the event: not yet, the NO path", isinstance(outcome, Done) and outcome.branch == "NO" and not outcome.result["reached"], str(outcome))
        events.ingest(T, [events.clean({"event_type": hit, "party_id": p3, "payload": {"amount": 25}})[0]])
        outcome = steps.run(node, state, third)
        third.refresh_from_db()
        check("reaching the goal after the event: converted, the YES path (CONTINUE)", isinstance(outcome, Done) and outcome.branch == "YES" and third.converted_at is not None
              and float(third.attributed_revenue) == 25.0, str(outcome))
        node.config = goal
        fourth = JourneyEnrollment.objects.create(journey=journey, journey_version=version, tenant_id=T, party_id=p4, status="ACTIVE")
        events.ingest(T, [events.clean({"event_type": hit, "party_id": p4, "payload": {"amount": 30}})[0]])
        outcome = steps.run(node, state, fourth)
        check("reaching the goal with EXIT finishes the journey as completed, 'Goal reached'", isinstance(outcome, Finish) and outcome.status == "COMPLETED" and outcome.reason == goals.REACHED_REASON, str(outcome))

        # ---- the journey page and the rollup
        figures = details.metrics(journey)
        check("Goal Converted counts conversions when the journey has a goal, with the revenue",
              figures["has_goal"] and figures["goal_converted"] == 4 and figures["attributed_revenue"] == 155.0 and figures["revenue_per_conversion"] == 38.75, str(figures))
        messages = details.message_metrics(journey, timezone.now() - timezone.timedelta(days=30), timezone.now())
        check("the message figures across every step are there, zero for a journey that sent nothing",
              messages["sent"] == 0 and messages["held_back"] == 0 and messages["failed"] == 0 and "delivered_pct" in messages, str(messages))
        trend = details.enrollment_trend(journey)
        check("the trend chart counts the conversions this week", trend[-1]["goal_converted"] == 4, str(trend[-1]))
        rollup.rollup_tenant(T)
        analytical = JourneyMasterAnalytical.objects.get(journey_id=journey.pk)
        check("the nightly rollup carries the goal figures and the message counts", analytical.converted_count == 4 and float(analytical.attributed_revenue) == 155.0
              and analytical.sent_count == 0 and analytical.held_back_count == 0, f"{analytical.converted_count} {analytical.attributed_revenue} {analytical.sent_count}")
        check("a journey without a goal keeps counting Exit arrivals", not details.metrics(make_journey("plain", entry={"entry_type": "EVENT", "rule_definition": {"event_type": enter}}))["has_goal"])
