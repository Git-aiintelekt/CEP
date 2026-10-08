"""Retries (apps.journeys.engine.retries): a temporary failure is tried again after 5, 15 and 60 minutes, then given up and listed on
Needs Attention with Retry Now and Skip Step; a permanent failure is recorded and the customer carries on; a step that blows up
counts as temporary; one scheduler per workspace through an advisory lock."""
from datetime import timedelta

import pytest
from django.db import connections
from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.journeys import events, timeline
from apps.journeys.engine import advance, enroll, retries, steps
from apps.journeys.engine.outcome import Done
from apps.journeys.models import JourneyCustomerState, JourneyEnrollment, JourneyNodeExecution, JourneyVersion

from .test_journey_events import T, customers, enrolled, make_journey

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_retries(check, admin_email, fresh_cache, monkeypatch):
    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    with session.tenant_scope(T):
        (p1, _e1), (p2, _e2) = customers(2)
        tag = timezone.now().strftime("%H%M%S")
        journey = make_journey("retries", entry={"entry_type": "EVENT", "rule_definition": {"event_type": f"ZJ_RETRY_{tag}"}},
                               nodes=[("EMAIL", {"template_id": None}), ("WAIT", {"duration": 1, "unit": "DAYS"})])
        version = JourneyVersion.objects.get(journey=journey)
        events.ingest(T, [events.clean({"event_type": f"ZJ_RETRY_{tag}", "party_id": party})[0] for party in (p1, p2)])
        enroll.enroll_journey(T, journey)
        check("two customers are in", enrolled(journey) == {p1, p2}, str(enrolled(journey)))
        first = JourneyEnrollment.objects.get(journey=journey, party_id=p1)
        second = JourneyEnrollment.objects.get(journey=journey, party_id=p2)

        outcomes = {"kind": "temporary"}

        def fake_email(node, state, enrollment):
            if outcomes["kind"] == "temporary":
                return Done("FAILED", {"reason": "The email engine answered 503"}, retry=True)
            if outcomes["kind"] == "permanent":
                return Done("FAILED", {"reason": "The step's template does not exist (any more)."})
            if outcomes["kind"] == "boom":
                raise RuntimeError("the engine is down")
            return Done(result={"sent": True})

        monkeypatch.setitem(steps.HANDLERS, "EMAIL", fake_email)

        def state_of(enrollment):
            return JourneyCustomerState.objects.get(journey_enrollment=enrollment)

        def due_now(enrollment):
            JourneyCustomerState.objects.filter(journey_enrollment=enrollment).update(next_scheduled_at=timezone.now() - timedelta(seconds=1))

        # ---- 5, 15, 60 minutes, then given up
        waits = []
        labels = []
        for _try in range(4):
            due_now(first)
            labels.append(advance.advance_one(first.pk))
            state = state_of(first)
            waits.append(None if state.next_scheduled_at is None else round((state.next_scheduled_at - timezone.now()).total_seconds() / 60))
        retry = state_of(first).state_data["retry"]
        check("a temporary failure is retried after 5, 15 and 60 minutes, then given up", labels == ["retrying", "retrying", "retrying", "gave_up"] and waits == [5, 15, 60, None]
              and retry["attempts"] == 4 and retry["gave_up_at"] and retry["step"] == "email-0" and "503" in retry["reason"], f"{labels} {waits} {retry}")
        check("every try is recorded on the timeline, the last one as given up",
              JourneyNodeExecution.objects.filter(journey_enrollment=first, execution_status="FAILED").count() == 4
              and JourneyNodeExecution.objects.filter(journey_enrollment=first).order_by("-executed_at", "-id").first().result_data.get("gave_up") is True)
        check("the customer is still in the journey, at the step, not due", first.status == "ACTIVE" and state_of(first).current_node.node_key == "email-0")

        # ---- Needs Attention, Retry Now, Skip Step
        listed = timeline.attention(journey)
        check("Needs Attention lists them with the reason, the tries and that it gave up", len(listed) == 1 and listed[0]["id"] == str(first.pk) and listed[0]["attempts"] == 4
              and listed[0]["gave_up_at"] and listed[0]["label"].startswith("Email"), str(listed)[:300])
        outcomes["kind"] = "ok"
        check("Retry Now makes the step due again", timeline.retry_now(journey, first.pk) and state_of(first).next_scheduled_at is not None)
        label = advance.advance_one(first.pk)
        check("and a try that succeeds moves the customer on and clears the retry", label in ("moved", "held") and "retry" not in state_of(first).state_data
              and state_of(first).current_node.node_key == "wait-1", f"{label} {state_of(first).state_data}")
        check("nothing needs attention any more", timeline.attention(journey) == [])

        outcomes["kind"] = "boom"
        due_now(second)
        label = advance.advance_one(second.pk)
        retry = state_of(second).state_data.get("retry") or {}
        check("a step that blows up is a temporary failure, tried again", label == "retrying" and retry.get("attempts") == 1 and "RuntimeError" in retry.get("reason", ""), f"{label} {retry}")
        check("Skip Step records the step as skipped and moves the customer on", timeline.skip_step(journey, second.pk) and state_of(second).current_node.node_key == "wait-1"
              and JourneyNodeExecution.objects.filter(journey_enrollment=second, execution_status="SKIPPED", result_data__reason="Skipped by hand").exists()
              and "retry" not in state_of(second).state_data)

        # ---- a permanent failure carries on, as before
        third = JourneyEnrollment.objects.create(journey=journey, journey_version=version, tenant_id=T, party_id=p1 + "-x", status="ACTIVE")
        start = version.journey_nodes.get(node_key="start") if hasattr(version, "journey_nodes") else None
        from apps.journeys.models import JourneyNode
        email_node = JourneyNode.objects.get(journey_version=version, node_key="email-0")
        JourneyCustomerState.objects.create(journey_enrollment=third, current_node=email_node, entered_node_at=timezone.now(), next_scheduled_at=timezone.now() - timedelta(seconds=1), state_data={})
        outcomes["kind"] = "permanent"
        label = advance.advance_one(third.pk)
        check("a permanent failure is recorded once and the customer moves on", label in ("moved", "held") and state_of(third).current_node.node_key == "wait-1"
              and JourneyNodeExecution.objects.filter(journey_enrollment=third, execution_status="FAILED").count() == 1 and "retry" not in state_of(third).state_data, f"{label}")
        _ = start

        # ---- one scheduler per workspace
        with connections[settings.PLATFORM_ALIAS].cursor() as other:
            other.execute(retries.LOCK_SQL, [f"journeys:advance:{T}"])
            held_elsewhere = other.fetchone()[0]
            try:
                counts = advance.advance_tenant(T)
                check("a second scheduler skips a workspace another one holds", held_elsewhere and counts["locked"] == 1 and counts["moved"] + counts["held"] == 0, str(counts))
            finally:
                other.execute(retries.UNLOCK_SQL, [f"journeys:advance:{T}"])
        counts = advance.advance_tenant(T)
        check("and runs it once the lock is free", counts["locked"] == 0, str(counts))

        # ---- the API
        outcomes["kind"] = "temporary"
        fourth = JourneyEnrollment.objects.create(journey=journey, journey_version=version, tenant_id=T, party_id=p2 + "-x", status="ACTIVE")
        JourneyCustomerState.objects.create(journey_enrollment=fourth, current_node=email_node, entered_node_at=timezone.now(), next_scheduled_at=timezone.now() - timedelta(seconds=1), state_data={})
        advance.advance_one(fourth.pk)
        web = APIClient()
        web.force_authenticate(user)
        listed = web.get(f"/api/v1/journeys/{journey.pk}/attention/", HTTP_X_TENANT="NWA")
        retried = web.post(f"/api/v1/journeys/{journey.pk}/customers/{fourth.pk}/retry/", HTTP_X_TENANT="NWA")
        skipped = web.post(f"/api/v1/journeys/{journey.pk}/customers/{fourth.pk}/skip/", HTTP_X_TENANT="NWA")
        nothing = web.post(f"/api/v1/journeys/{journey.pk}/customers/{fourth.pk}/retry/", HTTP_X_TENANT="NWA")
        check("GET attention, POST retry and skip; nothing to retry is a 404",
              listed.status_code == 200 and any(row["id"] == str(fourth.pk) for row in listed.json()) and retried.status_code == 200 and skipped.status_code == 200 and nothing.status_code == 404,
              f"{listed.status_code} {retried.status_code} {skipped.status_code} {nothing.status_code}")
        JourneyCustomerState.objects.filter(journey_enrollment__in=[third, fourth]).delete()
