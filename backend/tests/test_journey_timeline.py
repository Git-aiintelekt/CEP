"""The journey page's Customers card and one customer's timeline (apps.journeys.timeline), the live canvas's counts, and Preview
Route: a dry run through a version's graph as one customer, sending and recording nothing."""
import json
import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.journeys import events, graph, timeline
from apps.journeys.engine import advance, enroll
from apps.journeys.models import JourneyEnrollment, JourneyNode, JourneyNodeExecution, JourneyVersion

from .test_journey_events import T, customers, enrolled, make_journey, sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def set_attributes(party_id, **attributes):
    sql("UPDATE customer_master SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb) || %s::jsonb WHERE tenant_id = %s AND party_id = %s",
        [json.dumps(attributes), T, party_id], fetch=False)


def test_timeline_and_preview(check, admin_email, fresh_cache):
    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    with session.tenant_scope(T):
        (p1, e1), (p2, e2), (p3, _e3) = customers(3)
        tag = uuid.uuid4().hex[:6].upper()
        enter, buy = f"ZJ_ENTER_{tag}", f"ZJ_BUY_{tag}"
        set_attributes(p1, zj_tier="Gold", timezone="Europe/Paris")
        journey = make_journey("timeline", entry={"entry_type": "EVENT", "rule_definition": {"event_type": enter, "filters": {"conditions": [{"field": "attr:zj_tier", "op": "is", "value": "Gold"}]}}},
                               nodes=[("WAIT", {"duration": 0, "unit": "DAYS"}), ("CONDITION", {"label": "Gold?", "rule": {"conditions": [{"field": "attr:zj_tier", "op": "is", "value": "Gold"}]}}),
                                      ("WAIT", {"mode": "TIME_OF_DAY", "time": "09:00", "label": "Morning"}), ("GOAL", {"event_type": buy, "window_days": 14, "when_reached": "EXIT"})])
        version = JourneyVersion.objects.get(journey=journey)
        events.ingest(T, [events.clean({"event_type": enter, "party_id": party})[0] for party in (p1, p2)])
        enroll.enroll_journey(T, journey)
        check("the entry filters admit the Gold customer only", enrolled(journey) == {p1}, str(enrolled(journey)))
        advance.advance_tenant(T)
        enrollment = JourneyEnrollment.objects.get(journey=journey, party_id=p1)

        # ---- the Customers card
        page = timeline.customers(journey, q="")
        row = page["results"][0]
        check("the Customers card lists the enrolled customer, where they are now", page["count"] == 1 and row["party_id"] == p1 and row["email"] == e1 and row["status"] == "ACTIVE"
              and row["where"]["node_key"] == "wait-2" and row["where"]["label"] == "Morning" and row["where"]["next_scheduled_at"] is not None, json.dumps(page, default=str)[:400])
        check("the card searches by email and filters by status", timeline.customers(journey, q=e1[:8])["count"] == 1 and timeline.customers(journey, q="nobody@nowhere")["count"] == 0
              and timeline.customers(journey, status="COMPLETED")["count"] == 0)

        # ---- the timeline
        found = timeline.timeline(journey, enrollment.pk)
        kinds = [(step["node_key"], step["status"]) for step in found["steps"]]
        check("the timeline holds the entry, every step so far with its outcome, and the current position",
              found["name"] and found["email"] == e1 and found["entry"] == "EVENT" and kinds == [("start", "SUCCESS"), ("wait-0", "SUCCESS"), ("condition-1", "SUCCESS")]
              and found["steps"][2]["label"] == "Gold?" and found["steps"][2]["result"]["met"] is True and found["now"]["node_key"] == "wait-2" and found["status"] == "ACTIVE",
              json.dumps(found, default=str)[:600])
        check("an unknown enrollment is None", timeline.timeline(journey, uuid.uuid4()) is None)

        # ---- the live counts
        figures = timeline.counts(version)
        check("the counts: passed per step, waiting at the hold, Yes at the condition",
              figures["entered"] == 1 and figures["steps"]["wait-0"]["passed"] == 1 and figures["steps"]["condition-1"]["yes"] == 1
              and figures["steps"]["wait-2"]["waiting"] == 1 and figures["steps"]["wait-2"]["passed"] == 0, json.dumps(figures)[:400])

        # ---- Preview Route
        route = timeline.preview(version, p2, {})
        labels = [(step["node_type"], step["branch"], step["depends"]) for step in route["steps"]]
        check("the preview walks the graph as the customer: a Condition on the record is answered now, the Goal asks for an assumption",
              route["customer"]["party_id"] == p2 and route["entry"]["enters"] is False and "filters do not match" in route["entry"]["outcome"]
              and labels[1] == ("CONDITION", "NO", False) and labels[3] == ("GOAL", None, True) and route["steps"][3]["assumed"] == "NO"
              and route["steps"][-1]["node_type"] == "END" and "not converted" in route["steps"][-1]["outcome"], json.dumps(route, default=str)[:700])
        route = timeline.preview(version, p1, {"goal-3": "YES"})
        check("as the Gold customer the filters pass, the Condition answers Yes, the time-of-day wait is in their zone, and an assumed goal converts and exits",
              route["entry"]["enters"] is True and route["steps"][1]["branch"] == "YES" and "their time" in route["steps"][2]["outcome"]
              and route["steps"][3]["assumed"] == "YES" and "out of the journey" in route["steps"][3]["outcome"] and len(route["steps"]) == 4, json.dumps(route, default=str)[:700])
        check("the preview recorded nothing", JourneyNodeExecution.objects.filter(journey_enrollment__journey=journey).count() == 3
              and JourneyEnrollment.objects.filter(journey=journey).count() == 1)
        check("an unknown customer previews as nobody", timeline.preview(version, "nobody", {})["customer"] is None)
        found_customers = timeline.search_customers(T, e2[:10])
        check("Preview Route finds a customer by email", any(item["party_id"] == p2 for item in found_customers), str(found_customers)[:200])

        # ---- the API
        web = APIClient()
        web.force_authenticate(user)
        listed = web.get(f"/api/v1/journeys/{journey.pk}/customers/", {"q": e1[:6]}, HTTP_X_TENANT="NWA")
        one = web.get(f"/api/v1/journeys/{journey.pk}/customers/{enrollment.pk}/", HTTP_X_TENANT="NWA")
        counts = web.get(f"/api/v1/journeys/{journey.pk}/versions/1/counts/", HTTP_X_TENANT="NWA")
        previewed = web.post(f"/api/v1/journeys/{journey.pk}/versions/1/preview/", {"party_id": p1, "assumptions": {"goal-3": "NO"}}, format="json", HTTP_X_TENANT="NWA")
        who = web.get("/api/v1/journeys/preview-customers/", {"q": e2[:10]}, HTTP_X_TENANT="NWA")
        refused = web.post(f"/api/v1/journeys/{journey.pk}/versions/1/preview/", {}, format="json", HTTP_X_TENANT="NWA")
        check("the five endpoints answer", listed.status_code == 200 and listed.json()["count"] == 1 and one.status_code == 200 and one.json()["now"]["node_key"] == "wait-2"
              and counts.status_code == 200 and counts.json()["entered"] == 1 and previewed.status_code == 200 and len(previewed.json()["steps"]) == 5
              and who.status_code == 200 and len(who.json()) >= 1 and refused.status_code == 400,
              f"{listed.status_code} {one.status_code} {counts.status_code} {previewed.status_code} {who.status_code} {refused.status_code}")
        missing = web.get(f"/api/v1/journeys/{journey.pk}/customers/{uuid.uuid4()}/", HTTP_X_TENANT="NWA")
        check("a customer who is not in the journey is a 404", missing.status_code == 404)
