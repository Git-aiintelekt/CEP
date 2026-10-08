"""The smaller steps (apps.journeys.extras): Update Profile, Add to / Remove from List, Split by an attribute or at random; per-journey
suppressions (apps.journeys.suppressions) that keep a customer out and take one who is inside out; the Customers export and the
two permissions behind them."""
import json
import uuid
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.contact_lists.models import ContactList
from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.journeys import events, extras, graph, publish, suppressions
from apps.journeys.engine import enroll, steps
from apps.journeys.engine.outcome import Done
from apps.journeys.models import JourneyEnrollment, JourneyNode, JourneyVersion

from .test_journey_events import T, customers, enrolled, make_journey, sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def set_attributes(party_id, **attributes):
    sql("UPDATE customer_master SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb) || %s::jsonb WHERE tenant_id = %s AND party_id = %s",
        [json.dumps(attributes), T, party_id], fetch=False)


def test_step_rules(check):
    split = {"by": "ATTRIBUTE", "attribute": "home_store", "paths": [{"key": "P1", "label": "Lakeside", "values": ["Lakeside Mall"]}, {"key": "P2", "label": "Downtown or Airport", "values": ["Downtown", "Airport"]}]}
    check("a split by an attribute: paths with values, Everyone Else last", extras.split_problem(split) is None and extras.branch_keys(split) == ["P1", "P2", "OTHERWISE"]
          and extras.describe("SPLIT", split) == "Split by home store, 3 paths")
    check("a random split's shares add up to 100", "add up to 100" in extras.split_problem({"by": "RANDOM", "paths": [{"key": "A", "share": 50}, {"key": "B", "share": 40}]})
          and extras.split_problem({"by": "RANDOM", "paths": [{"key": "A", "share": 50}, {"key": "B", "share": 50}]}) is None)
    check("path keys are unique capitals, never OTHERWISE", "twice" in extras.split_problem({"by": "ATTRIBUTE", "attribute": "a", "paths": [{"key": "P1", "values": ["x"]}, {"key": "P1", "values": ["y"]}]})
          and "key" in extras.split_problem({"by": "ATTRIBUTE", "attribute": "a", "paths": [{"key": "otherwise", "values": ["x"]}]}))
    check("Update Profile needs an attribute and a value", extras.profile_problem({"attribute": "vip", "value": "yes"}) is None and extras.profile_problem({"attribute": "vip"}) == "Enter the value to set."
          and extras.profile_problem({"attribute": "no/slash", "value": 1}) is not None)
    check("the lists need a list", extras.list_problem({}) is not None and extras.list_problem({"contact_list_id": "x"}) is None)
    check("readiness reads them", publish._step_configured(SimpleNamespace(node_type="SPLIT", config=split)) and not publish._step_configured(SimpleNamespace(node_type="LIST_ADD", config={}))
          and publish._step_configured(SimpleNamespace(node_type="PROFILE_UPDATE", config={"attribute": "vip", "value": "yes"})))
    bad = {"entry_rules": [], "nodes": [{"key": "start", "type": "START", "config": {}}, {"key": "s", "type": "SPLIT", "config": {"by": "RANDOM", "paths": [{"key": "A", "share": 10}]}}],
           "connections": [{"from": "start", "to": "s"}]}
    with pytest.raises(ValidationError) as caught:
        graph.clean(bad)
    check("saving refuses a split that is wrong", "add up to 100" in json.dumps(caught.value.detail), json.dumps(caught.value.detail))


def test_steps_and_suppressions(check, admin_email, fresh_cache):
    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    with session.tenant_scope(T):
        (p1, e1), (p2, e2), (p3, _e3) = customers(3)
        tag = uuid.uuid4().hex[:6].upper()
        set_attributes(p1, zj_store="Lakeside Mall")
        set_attributes(p2, zj_store="airport")
        set_attributes(p3, zj_store="Online")
        contact_list = ContactList.objects.create(tenant_id=T, name=f"ZJ steps {tag}", source_type="UPLOAD", list_kind="STATIC", status="ACTIVE", channel="EMAIL", created_by_id=user.pk)
        split = {"by": "ATTRIBUTE", "attribute": "zj_store", "paths": [{"key": "P1", "label": "Lakeside", "values": ["Lakeside Mall"]}, {"key": "P2", "label": "Downtown or Airport", "values": ["Downtown", "Airport"]}]}
        journey = make_journey("extras", entry={"entry_type": "EVENT", "rule_definition": {"event_type": f"ZJ_{tag}"}},
                               nodes=[("PROFILE_UPDATE", {"attribute": "zj_flag", "value": "welcomed"}), ("LIST_ADD", {"contact_list_id": str(contact_list.pk), "contact_list_name": contact_list.name}),
                                      ("SPLIT", split), ("LIST_REMOVE", {"contact_list_id": str(contact_list.pk)})])
        version = JourneyVersion.objects.get(journey=journey)
        node = {n.node_key: n for n in JourneyNode.objects.filter(journey_version=version)}
        state = SimpleNamespace(state_data={}, entered_node_at=timezone.now())

        def enrollment_of(party):
            return JourneyEnrollment.objects.create(journey=journey, journey_version=version, tenant_id=T, party_id=party, status="ACTIVE")

        first = enrollment_of(p1)
        done = steps.run(node["profile_update-0"], state, first)
        flag = sql("SELECT custom_attributes ->> 'zj_flag' FROM customer_master WHERE tenant_id = %s AND party_id = %s", [T, p1])[0][0]
        check("Update Profile sets the attribute on the record", isinstance(done, Done) and done.status == "SUCCESS" and done.result["changed"] and flag == "welcomed", f"{done} {flag}")
        done = steps.run(node["list_add-1"], state, first)
        member = sql("SELECT membership_source FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s AND party_id = %s", [T, str(contact_list.pk), p1])
        check("Add to List adds the customer as a JOURNEY member", done.result["changed"] and member == [("JOURNEY",)], f"{done} {member}")
        check("adding again changes nothing", not steps.run(node["list_add-1"], state, first).result["changed"])
        done = steps.run(node["list_remove-3"], state, first)
        check("Remove from List takes them off", done.result["changed"] and sql("SELECT count(*) FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s AND party_id = %s", [T, str(contact_list.pk), p1])[0][0] == 0)
        node["list_remove-3"].config = {"contact_list_id": str(uuid.uuid4())}
        check("a list that is gone fails the step", steps.run(node["list_remove-3"], state, first).status == "FAILED")

        branches = {party: steps.run(node["split-2"], SimpleNamespace(state_data={}, entered_node_at=timezone.now()), enrollment_of(party) if party != p1 else first).branch for party in (p1, p2, p3)}
        check("Split by an attribute: each customer takes their path, case-insensitively, Everyone Else otherwise", branches == {p1: "P1", p2: "P2", p3: "OTHERWISE"}, str(branches))
        node["split-2"].config = {"by": "RANDOM", "paths": [{"key": "A", "label": "A", "share": 60}, {"key": "B", "label": "B", "share": 40}]}
        kept = SimpleNamespace(state_data={}, entered_node_at=timezone.now())
        rolled = steps.run(node["split-2"], kept, first)
        again = steps.run(node["split-2"], kept, first)
        check("a random split rolls once and keeps the choice", rolled.branch in ("A", "B") and again.branch == rolled.branch and again.result.get("kept") is True, f"{rolled} {again}")

        # ---- per-journey suppressions
        JourneyEnrollment.objects.filter(journey=journey).delete()
        events.ingest(T, [events.clean({"event_type": f"ZJ_{tag}", "party_id": party})[0] for party in (p1, p2)])
        enroll.enroll_journey(T, journey)
        check("both enter before any suppression", enrolled(journey) == {p1, p2}, str(enrolled(journey)))
        outcome = suppressions.add(journey, e1.upper(), "asked to be left out", user.pk)
        row = JourneyEnrollment.objects.get(journey=journey, party_id=p1)
        check("suppressing by email takes the customer out of the journey at once", outcome["added"] and outcome["party_id"] == p1 and outcome["exited"] == 1
              and row.status == "EXITED" and row.exit_reason == suppressions.REASON, f"{outcome} {row.status}")
        with pytest.raises(ValueError):
            suppressions.add(journey, "nobody@nowhere.example")
        JourneyEnrollment.objects.filter(journey=journey).delete()
        events.ingest(T, [events.clean({"event_type": f"ZJ_{tag}", "party_id": party, "event_id": f"again-{tag}-{party}"})[0] for party in (p1, p2)])
        enroll.enroll_journey(T, journey)
        check("a suppressed customer never enters again", enrolled(journey) == {p2}, str(enrolled(journey)))
        listed = suppressions.listing(journey)
        check("the list names them, with the note and who added them", len(listed) == 1 and listed[0]["party_id"] == p1 and listed[0]["note"] == "asked to be left out" and listed[0]["email"] == e1, str(listed))
        check("removing lets them in next time", suppressions.remove(journey, listed[0]["id"]) and suppressions.listing(journey) == [])

        # ---- the API and the permissions
        web = APIClient()
        web.force_authenticate(user)
        added = web.post(f"/api/v1/journeys/{journey.pk}/suppressions/", {"given": e2, "note": "test"}, format="json", HTTP_X_TENANT="NWA")
        listed = web.get(f"/api/v1/journeys/{journey.pk}/suppressions/", HTTP_X_TENANT="NWA")
        check("POST and GET suppressions", added.status_code == 201 and added.json()["exited"] == 1 and listed.status_code == 200 and len(listed.json()) == 1, f"{added.status_code} {listed.status_code} {added.content[:200]}")
        removed = web.delete(f"/api/v1/journeys/{journey.pk}/suppressions/{listed.json()[0]['id']}/", HTTP_X_TENANT="NWA")
        refused = web.post(f"/api/v1/journeys/{journey.pk}/suppressions/", {"given": "nobody@nowhere.example"}, format="json", HTTP_X_TENANT="NWA")
        check("DELETE removes; an unknown address is a 400 naming the field", removed.status_code == 204 and refused.status_code == 400 and "given" in json.dumps(refused.json()), f"{removed.status_code} {refused.status_code}")
        exported = web.get(f"/api/v1/journeys/{journey.pk}/customers/export/", HTTP_X_TENANT="NWA")
        lines = b"".join(exported.streaming_content).decode("utf-8").splitlines()
        check("the Customers export is a CSV with a header and one line per customer", exported.status_code == 200 and exported["Content-Type"].startswith("text/csv")
              and lines[0].startswith("name,email,customer_id,entered") and len(lines) == 1 + JourneyEnrollment.objects.filter(journey=journey).count(), f"{exported.status_code} {lines[:2]}")
        check("the two permissions exist", sql("SELECT count(*) FROM permission WHERE code IN ('journey.export', 'journey.suppress')")[0][0] == 2)
