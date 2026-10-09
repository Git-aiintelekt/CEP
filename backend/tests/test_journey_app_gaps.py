"""The journey app gaps: the Customers card's held-back reason filter, the customer page (apps.customers.profile) and the
Journeys dataset in Reports (apps.reporting.journey_reports), against the local database, rolled back."""
import json
import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.customers import profile
from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.journeys import events, timeline
from apps.journeys.engine import advance, enroll
from apps.journeys.models import JourneyEnrollment, JourneyNode, JourneyNodeExecution, JourneyVersion
from apps.reporting import journey_reports
from apps.tenants.models import Tenant

from .test_journey_events import T, customers, enrolled, make_journey, sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_reason_filter_customer_page_and_journeys_report(check, admin_email, fresh_cache):
    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    tenant = Tenant.objects.using("platform").get(pk=T)
    with session.tenant_scope(T):
        (p1, e1), (p2, e2), (p3, _e3) = customers(3)
        tag = uuid.uuid4().hex[:6].upper()
        enter = f"ZJ_ENTER_{tag}"
        journey = make_journey("gaps", entry={"entry_type": "EVENT", "rule_definition": {"event_type": enter}},
                               nodes=[("WAIT", {"duration": 0, "unit": "DAYS"}), ("EMAIL", {"template_id": str(uuid.uuid4()), "template_name": "Welcome"})])
        version = JourneyVersion.objects.get(journey=journey)
        events.ingest(T, [events.clean({"event_type": enter, "party_id": party})[0] for party in (p1, p2)])
        enroll.enroll_journey(T, journey)
        check("both customers entered", enrolled(journey) == {p1, p2}, str(enrolled(journey)))
        first = JourneyEnrollment.objects.get(journey=journey, party_id=p1)
        second = JourneyEnrollment.objects.get(journey=journey, party_id=p2)
        email_node = JourneyNode.objects.get(journey_version=version, node_key="email-1")
        JourneyNodeExecution.objects.create(journey_enrollment=first, journey_node=email_node, tenant_id=T, party_id=p1, execution_status="SKIPPED",
                                            result_data={"reason": "NO_CONSENT"})
        JourneyNodeExecution.objects.create(journey_enrollment=second, journey_node=email_node, tenant_id=T, party_id=p2, execution_status="FAILED",
                                            result_data={"reason": "There is no email sender to send from."})

        # ---- the reason filter
        reasons = timeline.held_back_reasons(journey)
        check("the reasons list names the held-back reason with how many customers, in words",
              reasons == [{"reason": "NO_CONSENT", "label": "No consent", "customers": 1}], json.dumps(reasons))
        check("?reason= keeps the customers held back for it and nobody else",
              [row["party_id"] for row in timeline.customers(journey, reason="NO_CONSENT")["results"]] == [p1] and timeline.customers(journey, reason="FREQUENCY_CAP")["count"] == 0
              and timeline.customers(journey)["count"] == 2)
        web = APIClient()
        web.force_authenticate(user)
        listed = web.get(f"/api/v1/journeys/{journey.pk}/customers/", {"reason": "NO_CONSENT"}, HTTP_X_TENANT="NWA")
        named = web.get(f"/api/v1/journeys/{journey.pk}/customers/reasons/", HTTP_X_TENANT="NWA")
        exported = web.get(f"/api/v1/journeys/{journey.pk}/customers/export/", {"reason": "NO_CONSENT"}, HTTP_X_TENANT="NWA")
        check("the API filters the card and the export by reason and lists the reasons",
              listed.status_code == 200 and listed.json()["count"] == 1 and listed.json()["results"][0]["party_id"] == p1
              and named.status_code == 200 and named.json()["results"][0]["reason"] == "NO_CONSENT"
              and exported.status_code == 200 and b"".join(exported.streaming_content).decode().count("\r\n") == 2, (listed.status_code, named.status_code, exported.status_code))

        # ---- the customer page
        found = profile.record(T, p1)
        mine = [row for row in found["journeys"] if row["journey_id"] == str(journey.pk)]
        check("the customer page holds the record, consent, lists, events, orders, messages and the journeys entered",
              found["customer"]["party_id"] == p1 and (found["customer"]["emails"][0].get("address") or "").lower() == e1 and isinstance(found["consent"], list)
              and isinstance(found["lists"], list) and any(event["event_type"] == enter for event in found["events"]) and isinstance(found["orders"], list)
              and isinstance(found["messages"], list) and len(mine) == 1 and mine[0]["status"] == "ACTIVE" and mine[0]["journey_name"] == journey.name
              and mine[0]["where"] is not None, json.dumps(found, default=str)[:600])
        check("an unknown customer is None", profile.record(T, "nobody-" + tag) is None)
        search = profile.search(T, q=e1)
        check("the search finds a customer by email address", search["count"] >= 1 and any(row["party_id"] == p1 for row in search["results"]), json.dumps(search, default=str)[:300])
        digits = "".join(ch for ch in (found["customer"]["phones"][0].get("number") if found["customer"]["phones"] else "") if ch.isdigit())
        if digits:
            check("and by mobile number digits", any(row["party_id"] == p1 for row in profile.search(T, q=digits[-7:])["results"]))
        check("and by id", profile.search(T, q=p1)["results"][0]["party_id"] == p1)
        page = web.get("/api/v1/customers/", {"q": e1}, HTTP_X_TENANT="NWA")
        one = web.get(f"/api/v1/customers/{p1}/", HTTP_X_TENANT="NWA")
        missing = web.get(f"/api/v1/customers/nobody-{tag}/", HTTP_X_TENANT="NWA")
        check("the API serves the search, the record and a 404 for an unknown customer",
              page.status_code == 200 and page.json()["count"] >= 1 and one.status_code == 200 and one.json()["customer"]["party_id"] == p1 and missing.status_code == 404,
              (page.status_code, one.status_code, missing.status_code))

        # ---- the Journeys dataset
        JourneyEnrollment.objects.filter(pk=second.pk).update(converted_at=timezone.now(), attributed_revenue=42.5)
        zone = journey_reports.zone_of(tenant)
        today = timezone.now().astimezone(zone).date()
        report = journey_reports.summary(tenant, today - timedelta(days=1), today, journey_id=str(journey.pk))
        row = report["by_journey"][0] if report["by_journey"] else None
        check("the dataset counts the journey's entries, conversion with revenue, the held-back and the failed message step, per day",
              row is not None and row["id"] == str(journey.pk) and row["entered"] == 2 and row["converted"] == 1 and row["revenue"] == 42.5 and row["held_back"] == 1
              and row["failed"] == 1 and report["totals"]["entered"] == 2 and report["rates"]["conversion"] == 50.0 and len(report["days"]) == 1
              and report["days"][0]["day"] == today and len(report["rows"]) == 1 and report["rows"][0]["journey_name"] == journey.name, json.dumps(report, default=str)[:700])
        check("every journey of the workspace is offered for the filter", any(item["id"] == str(journey.pk) for item in report["journeys"]))
        text = journey_reports.csv_text(report)
        check("the CSV has a header, the journey's day and a total", text.count("\r\n") == 3 and journey.name in text and text.strip().endswith("1"), text[:300])
        answered = web.get("/api/v1/reports/journeys/", {"journey": str(journey.pk)}, HTTP_X_TENANT="NWA")
        file = web.get("/api/v1/reports/journeys.csv", {"journey": str(journey.pk)}, HTTP_X_TENANT="NWA")
        check("the API serves the dataset and its CSV", answered.status_code == 200 and answered.json()["totals"]["entered"] == 2 and file.status_code == 200
              and file["Content-Type"].startswith("text/csv"), (answered.status_code, file.status_code, answered.content[:200]))
        advance.advance_tenant(T)          # nothing in the journey breaks because of the executions written by hand
    check.done()
