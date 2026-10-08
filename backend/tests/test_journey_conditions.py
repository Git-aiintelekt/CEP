"""Journey conditions (apps.journeys.conditions): one rule compiled to SQL and read by the Condition step, by an entry rule's
Only Customers Where filters and by the Customer Attribute Matches trigger; its validation on save; the field catalogue
and the counts behind the builder."""
import json
import uuid
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.journeys import conditions, events, graph, publish
from apps.journeys.engine import enroll, steps
from apps.journeys.models import JourneyCustomerState, JourneyEnrollment, JourneyNode, JourneyVersion

from .test_journey_events import T, customers, enrolled, make_journey, sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def rule(*items, all_=True):
    return {"all": all_, "conditions": list(items)}


def cond(field, op, value=None, **extra):
    found = {"field": field, "op": op, **extra}
    if value is not None:
        found["value"] = value
    return found


def set_attributes(party_id, **attributes):
    sql("UPDATE customer_master SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb) || %s::jsonb WHERE tenant_id = %s AND party_id = %s",
        [json.dumps(attributes), T, party_id], fetch=False)


def test_rules_are_checked(check):
    """What a rule may say, in words when it may not."""
    ok = rule(cond("attr:loyalty_tier", "in", ["GOLD", "PLATINUM"]), cond("customer:last_purchase_at", "older_than_days", 90),
              cond("message:welcome-3", "delivered_not_opened"), cond("step:cond-1", "yes"),
              rule(cond("list:" + str(uuid.uuid4()), "not_in"), cond("event:STORE_VISIT", "happened", days=14, props=[{"key": "store", "op": "is", "value": "Lakeside"}]), all_=False))
    check("a full rule is accepted, canonical, and counts its conditions", conditions.problem(ok, in_journey=True) is None
          and conditions.count_conditions(conditions.clean(ok, in_journey=True)) == 6 and conditions.is_complete(ok))
    check("message and step fields are refused at entry", "inside the journey" in (conditions.problem(ok, in_journey=False) or ""))
    refusals = {
        "no field": rule(cond("", "is", "x")),
        "unknown customer field": rule(cond("customer:shoe_size", "is", "x")),
        "wrong operator": rule(cond("customer:country", "gte", 3)),
        "between with one value": rule(cond("attr:visits", "between", [1])),
        "a date that is not one": rule(cond("attr:renewal", "before", "soon")),
        "days out of range": rule(cond("attr:renewal", "within_days", 0)),
        "a group in a group": rule(rule(rule(cond("customer:city", "is", "Austin")))),
        "too many": rule(*[cond("customer:city", "is", "Austin")] * 21),
        "a bad event type": rule(cond("event:store visit", "happened")),
        "a list without an id": rule(cond("list:vip", "in")),
    }
    for name, bad in refusals.items():
        check(f"refused: {name}", conditions.problem(bad, in_journey=True) is not None, name)
    check("an empty rule is valid but not complete", conditions.problem(rule(), in_journey=True) is None and not conditions.is_complete(rule()))
    check("the fields a rule names are listed for the graph check", conditions.references(ok) == [("message", "welcome-3"), ("step", "cond-1")])
    check("between on dates and numbers are different operators", conditions.problem(rule(cond("attr:renewal", "between_dates", ["2026-01-01", "2026-03-01"])), in_journey=False) is None
          and conditions.problem(rule(cond("attr:visits", "between", [1, 5])), in_journey=False) is None)
    args = {}
    where = conditions.compile_where(ok, args, in_journey=True)
    check("every value is a parameter, never in the SQL", "GOLD" not in where and "Lakeside" not in where and "welcome-3" not in where and args["c2"] == ["gold", "platinum"])


def test_conditions_in_a_journey(check, admin_email, fresh_cache):
    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    with session.tenant_scope(T):
        (p1, e1), (p2, e2), (p3, _e3) = customers(3)
        tag = uuid.uuid4().hex[:6]
        set_attributes(p1, zj_tier="Gold", zj_visits=7, zj_renewal="2020-02-02")
        set_attributes(p2, zj_tier="silver", zj_visits="3")

        # ---- the Condition step on a rule, against this customer's record
        journey = make_journey("cond", entry={"entry_type": "EVENT", "rule_definition": {"event_type": f"ZJ_{tag}"}},
                               nodes=[("EMAIL", {}), ("CONDITION", {"rule": rule(cond("attr:zj_tier", "is", "gold"))})])
        version = JourneyVersion.objects.get(journey=journey)
        enrollment = JourneyEnrollment.objects.create(journey=journey, journey_version=version, tenant_id=T, party_id=p1, status="ACTIVE")
        node = JourneyNode.objects.get(journey_version=version, node_key="condition-1")
        state = SimpleNamespace(state_data={}, entered_node_at=timezone.now())

        def answer(*items, all_=True):
            node.config = {"rule": rule(*items, all_=all_)}
            return steps._check(node, state, enrollment)

        check("a text attribute, compared without regard to case, answers Yes", answer(cond("attr:zj_tier", "is", "gold")).branch == "YES")
        check("the answer records how many conditions were checked and whether they were met",
              answer(cond("attr:zj_tier", "is", "gold")).result == {"conditions": 1, "met": True})
        check("a number attribute compares as a number", answer(cond("attr:zj_visits", "gte", 5)).branch == "YES" and answer(cond("attr:zj_visits", "lte", 5)).branch == "NO")
        check("a date attribute compares as a date", answer(cond("attr:zj_renewal", "older_than_days", 365)).branch == "YES"
              and answer(cond("attr:zj_renewal", "within_days", 30)).branch == "NO" and answer(cond("attr:zj_renewal", "before", "2020-02-02")).branch == "NO"
              and answer(cond("attr:zj_renewal", "before", "2020-02-03")).branch == "YES")
        check("an attribute the record lacks is not set", answer(cond("attr:zj_missing", "is_not_set")).branch == "YES" and answer(cond("attr:zj_missing", "is", "x")).branch == "NO")
        check("standard fields: the customer's email address", answer(cond("customer:email", "is", e1.upper())).branch == "YES" and answer(cond("customer:email", "is", e2)).branch == "NO")
        check("All and Any", answer(cond("attr:zj_tier", "is", "gold"), cond("attr:zj_visits", "eq", 1)).branch == "NO"
              and answer(cond("attr:zj_tier", "is", "gold"), cond("attr:zj_visits", "eq", 1), all_=False).branch == "YES")
        check("a group inside the rule", answer(cond("attr:zj_tier", "is", "gold"), rule(cond("attr:zj_visits", "eq", 1), cond("attr:zj_visits", "eq", 7), all_=False)).branch == "YES")
        check("this journey's email, never sent: not sent is Yes, delivered is No",
              answer(cond("message:email-0", "not_sent")).branch == "YES" and answer(cond("message:*", "delivered")).branch == "NO")
        failed = answer(cond("customer:nope", "is", "x"))
        check("a rule that cannot be read fails the step onto No, saying why", failed.status == "FAILED" and failed.branch == "NO" and "customer field" in failed.result["reason"])

        # ---- events, with their properties, and the derived purchase fields
        accepted = events.ingest(T, [events.clean({"event_type": "PURCHASE", "party_id": p1, "payload": {"store": "Lakeside Mall", "amount": 84.5}})[0]])
        check("the purchase event is in", accepted[0]["status"] == "ACCEPTED", str(accepted))
        check("an event that happened, within days, with a property filter", answer(cond("event:PURCHASE", "happened", days=1, props=[{"key": "store", "op": "contains", "value": "lakeside"}])).branch == "YES"
              and answer(cond("event:PURCHASE", "happened", days=1, props=[{"key": "amount", "op": "gte", "value": 100}])).branch == "NO"
              and answer(cond("event:PURCHASE", "not_happened", days=1)).branch == "NO")
        check("without days, an event counts since the customer entered the journey", answer(cond("event:PURCHASE", "happened")).branch == "YES")
        check("Last Purchase Date and Number of Purchases come from the purchase events",
              answer(cond("customer:last_purchase_at", "within_days", 1)).branch == "YES" and answer(cond("customer:purchase_count", "gte", 1)).branch == "YES")

        # ---- a prior Condition step's answer
        sql("""INSERT INTO journey_node_execution (journey_enrollment_id, journey_node_id, tenant_id, party_id, execution_status, result_data, executed_at)
               VALUES (%s, %s, %s, %s, 'SUCCESS', %s::jsonb, now())""", [str(enrollment.pk), str(node.pk), T, p1, json.dumps({"met": False, "conditions": 1})], fetch=False)
        check("a prior Condition step's answer", answer(cond("step:condition-1", "no")).branch == "YES" and answer(cond("step:condition-1", "yes")).branch == "NO")

        # ---- the count behind Match on Entry
        counted = conditions.count_in_journey(T, journey.pk, rule(cond("attr:zj_tier", "is", "gold")))
        check("Match on Entry counts the journey's active customers the rule holds for", counted == {"matching": 1, "total": 1, "sampled": False}, str(counted))

        # ---- the Customer Attribute Matches trigger, with Only Customers Where filters
        set_attributes(p1, zj_status=tag)
        set_attributes(p2, zj_status=tag)
        set_attributes(p3, zj_status=tag)
        matcher = make_journey("match", entry={"entry_type": "SEGMENT_CHANGE", "rule_definition": {
            "change_trigger": "ATTRIBUTE_MATCH", "rule": rule(cond("attr:zj_status", "is", tag)),
            "filters": rule(cond("customer:email", "in", [e1, e2]))}})
        enroll.enroll_journey(T, matcher)
        check("the customers whose record matches enter, narrowed by the filters", enrolled(matcher) == {p1, p2}, str(enrolled(matcher)))
        enroll.enroll_journey(T, matcher)
        check("a second pass enters nobody twice", JourneyEnrollment.objects.filter(journey=matcher).count() == 2)
        counted = conditions.count_customers(T, rule(cond("attr:zj_status", "is", tag)), rule(cond("customer:email", "in", [e1, e2])))
        check("the trigger's would-enter-now count agrees", counted["matching"] == 2 and counted["total"] >= 3, str(counted))

        # ---- filters on an event entry
        filtered = make_journey("filtered", entry={"entry_type": "EVENT", "rule_definition": {"event_type": f"ZJ_{tag}", "filters": rule(cond("customer:email", "is", e2))}})
        events.ingest(T, [events.clean({"event_type": f"ZJ_{tag}", "party_id": party})[0] for party in (p1, p2)])
        enroll.enroll_journey(T, filtered)
        check("an event entry's filters keep out the customers whose record does not match", enrolled(filtered) == {p2}, str(enrolled(filtered)))
        check("the test population honours the filters too", set(publish._random_candidates(T, JourneyVersion.objects.get(journey=filtered), 10)) == {p2})

        # ---- readiness and saving
        check("a Condition with a complete rule is configured; an empty rule is not",
              publish._step_configured(SimpleNamespace(node_type="CONDITION", config={"rule": rule(cond("attr:a", "is_set"))}))
              and not publish._step_configured(SimpleNamespace(node_type="CONDITION", config={"rule": rule()}))
              and publish._step_configured(SimpleNamespace(node_type="CONDITION", config={"check": "PURCHASED"})))
        readiness = publish.readiness(matcher, JourneyVersion.objects.get(journey=matcher))
        entry = next(item for item in readiness["items"] if item["key"] == "entry_rules")
        check("readiness reads the attribute trigger", entry["ok"] and "matches 1 condition" in entry["description"], entry["description"])
        bad = {"entry_rules": [{"entry_type": "SEGMENT_CHANGE", "rule_definition": {"change_trigger": "ATTRIBUTE_MATCH", "rule": rule(cond("message:x", "sent"))}}],
               "nodes": [{"key": "start", "type": "START", "config": {}}, {"key": "c", "type": "CONDITION", "config": {"rule": rule(cond("message:mail", "opened"))}}],
               "connections": [{"from": "start", "to": "c"}]}
        with pytest.raises(Exception) as caught:
            graph.clean(bad)
        found = json.dumps(caught.value.detail)
        check("saving refuses a journey field at entry and a message step that is not in the graph",
              "inside the journey" in found and "not in this journey" in found, found)

        # ---- the API: the catalogue and the counts
        web = APIClient()
        web.force_authenticate(user)
        catalogue = web.get("/api/v1/journeys/condition-fields/", HTTP_X_TENANT="NWA").json()
        tiers = next((item for item in catalogue["attributes"] if item["key"] == "attr:zj_tier"), None)
        check("the catalogue lists the standard fields, the custom attributes with a type and their few values, events, lists and segments",
              {"customer", "attributes", "events", "lists", "segments"} <= set(catalogue) and tiers is not None and tiers["type"] == "text"
              and set(tiers["values"]) >= {"Gold", "silver"} and any(item["key"] == "event:PURCHASE" for item in catalogue["events"]), json.dumps(catalogue)[:400])
        counted = web.post("/api/v1/journeys/condition-count/", {"rule": rule(cond("attr:zj_status", "is", tag))}, format="json", HTTP_X_TENANT="NWA")
        check("POST condition-count counts the workspace", counted.status_code == 200 and counted.json()["matching"] == 3, counted.content[:200])
        refused = web.post("/api/v1/journeys/condition-count/", {"rule": rule(cond("message:x", "sent"))}, format="json", HTTP_X_TENANT="NWA")
        check("a rule that cannot be read is a 400 naming the problem", refused.status_code == 400 and "rule" in json.dumps(refused.json()), refused.content[:200])
        in_journey = web.post(f"/api/v1/journeys/{journey.pk}/condition-count/", {"rule": rule(cond("attr:zj_tier", "is", "gold"))}, format="json", HTTP_X_TENANT="NWA")
        check("POST journeys/{id}/condition-count counts the journey", in_journey.status_code == 200 and in_journey.json()["matching"] == 1, in_journey.content[:200])
        JourneyCustomerState.objects.filter(journey_enrollment__journey__in=[journey, matcher, filtered]).delete()
