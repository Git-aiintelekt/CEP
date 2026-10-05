"""Journeys completed: events in (POST /events/, purchases from orders, email engagement from tracking), enrollment from
them, the Fixed population lock, the coupon requests C360 fulfils, the governance check in words, archive, cancel schedule,
one live version at a time, and the Settings → Events data."""
import hashlib
import json
import secrets
import uuid
from datetime import timedelta

import pytest
from django.db import connections
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from apps.delivery.engine import session
from apps.governance.models import CommunicationGovernancePolicy
from apps.identity.models import ApiClient, AppUser
from apps.journeys import events, graph, lifecycle, publish
from apps.journeys.engine import enroll, steps
from apps.journeys.models import Journey, JourneyCustomerState, JourneyEnrollment, JourneyNode, JourneyVersion
from apps.reporting import attribution
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
T = "a0000000-0000-4000-8000-000000000001"


def sql(query, args=(), fetch=True):
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(query, args)
        return cursor.fetchall() if fetch and cursor.description else cursor.rowcount


def api_key(scopes) -> str:
    prefix = "cep_in_" + secrets.token_hex(3)
    key = prefix + secrets.token_urlsafe(24).replace("-", "a").replace("_", "b")
    ApiClient.objects.create(tenant_id=T, name=f"Test {scopes}", client_type="INTEGRATION", key_prefix=prefix,
                             key_hash=hashlib.sha256(key.encode()).hexdigest(), scopes=list(scopes))
    return key


def customers(n=3):
    """Known NWA customers with an email address: (party_id, email)."""
    return sql("""SELECT party_id, lower(emails -> 0 ->> 'address') FROM customer_master
                   WHERE tenant_id = %s AND jsonb_array_length(emails) > 0 ORDER BY party_id LIMIT %s""", [T, n])


def make_journey(name, *, entry, nodes=None, population="EVENT_TRIGGERED", status="ACTIVE", published_ago=timedelta(minutes=5)) -> Journey:
    """A journey whose version 1 is live (or in the given status): Start -> the nodes -> Exit, with one entry rule."""
    body_nodes = [{"key": "start", "type": "START", "config": {}, "position": {"x": 0, "y": 0}}]
    connections_ = []
    previous = "start"
    for index, (node_type, config) in enumerate((nodes or []) + [("EXIT", {})]):
        key = f"{node_type.lower()}-{index}"
        body_nodes.append({"key": key, "type": node_type, "config": config, "position": {"x": 0, "y": 150 * (index + 1)}})
        connections_.append({"from": previous, "to": key, "branch_key": None, "label": None})
        previous = key
    journey = Journey.objects.create(tenant_id=T, name=f"ZJ {name} {uuid.uuid4().hex[:6]}", code=lifecycle._next_code(T),
                                     population_mode=population, reentry_policy="EVERY_QUALIFYING_EVENT")
    version = graph.create_first(journey, None, {"entry_rules": [entry], "nodes": body_nodes, "connections": connections_})
    if status == "ACTIVE":
        JourneyVersion.objects.filter(pk=version.pk).update(status="ACTIVE", published_at=timezone.now() - published_ago)
        Journey.objects.filter(pk=journey.pk).update(status="ACTIVE", current_version=version)
    journey.refresh_from_db()
    return journey


def enrolled(journey) -> set[str]:
    return set(JourneyEnrollment.objects.filter(journey=journey).values_list("party_id", flat=True))


def test_journey_events(check, admin_email):
    """Events in, journeys entered, coupons requested, governance in words, archive and cancel schedule."""
    tenant = Tenant.objects.using("platform").get(pk=T)
    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    def post(body, client=None):
        return (client or shop).post("/api/v1/events/", json.dumps(body), content_type="application/json")

    with session.tenant_scope(T):
        (p1, e1), (p2, e2), (p3, e3) = customers(3)
        shop = Client(HTTP_X_TENANT="NWA", HTTP_AUTHORIZATION=f"Bearer {api_key(['events:ingest'])}")
        # ---- POST /events/
        r = post({"events": [{"event_type": "cart_abandon", "party_id": p1, "event_id": "cart-1", "payload": {"cart_value": 84.5}},
                             {"event_type": "CART_ABANDON", "email": e2.upper(), "event_id": "cart-2"},
                             {"event_type": "CART_ABANDON", "email": "nobody@nowhere.example", "event_id": "cart-3"},
                             {"event_type": "cart abandon!", "party_id": p1}]})
        body = r.json()
        check("events are taken one by one: by id, by email (any case), an unknown email and a bad type refused", r.status_code == 200
              and [x["status"] for x in body["results"]] == ["ACCEPTED", "ACCEPTED", "REJECTED", "REJECTED"] and body["results"][1]["party_id"] == p2
              and "customer" in body["results"][2]["errors"] and "event_type" in body["results"][3]["errors"], json.dumps(body)[:300])
        check("all refused is a 400; more than 500 is refused; a key without events:ingest is refused",
              post({"event_type": "X", "party_id": p1}).status_code == 400 and post({"events": [{"event_type": "PURCHASE", "party_id": p1}] * 501}).status_code == 400
              and post({"event_type": "PURCHASE", "party_id": p1}, Client(HTTP_X_TENANT="NWA", HTTP_AUTHORIZATION=f"Bearer {api_key(['lists:write'])}")).status_code == 403)
        same = events.clean({"event_type": "PURCHASE", "party_id": p3, "event_id": "dup-1", "occurred_at": "2026-10-01T10:00:00Z"})[0]
        first, second = events.ingest(T, [same]), events.ingest(T, [same])
        check("one event with one id and moment is kept once", first[0]["status"] == "ACCEPTED" and second[0]["status"] == "DUPLICATE", f"{first} {second}")

        # ---- purchases from orders
        attribution.save_settings(tenant, {"enabled": True})
        order = attribution.clean({"order_id": f"ZJ-{uuid.uuid4().hex[:6]}", "amount": 50, "party_id": p3}, currency="USD")[0]
        sql("DELETE FROM journey_event WHERE tenant_id = %s AND party_id = %s AND event_type IN ('PURCHASE', 'FIRST_PURCHASE') AND external_id <> 'dup-1'", [T, p3], fetch=False)
        sql("DELETE FROM journey_event WHERE tenant_id = %s AND party_id = %s AND external_id = 'dup-1'", [T, p3], fetch=False)
        attribution.ingest(T, [order])
        kinds = sorted(row[0] for row in sql("SELECT event_type FROM journey_event WHERE tenant_id = %s AND party_id = %s AND external_id LIKE 'order:%%'", [T, p3]))
        check("an order is a PURCHASE event, and the customer's first one is also FIRST_PURCHASE", kinds == ["FIRST_PURCHASE", "PURCHASE"], str(kinds))
        later = attribution.clean({"order_id": f"ZJ-{uuid.uuid4().hex[:6]}", "amount": 20, "party_id": p3, "ordered_at": (timezone.now() + timedelta(minutes=1)).isoformat()},
                                  currency="USD")[0]
        attribution.ingest(T, [later])
        kinds = sorted(row[0] for row in sql("SELECT event_type FROM journey_event WHERE tenant_id = %s AND party_id = %s AND external_id LIKE 'order:%%'", [T, p3]))
        check("a second order is only a PURCHASE", kinds == ["FIRST_PURCHASE", "PURCHASE", "PURCHASE"], str(kinds))

        # ---- enrollment from events
        cart = make_journey("cart", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "CART_ABANDON"}})
        enroll.enroll_journey(T, cart)
        check("an event-triggered journey enrols the customers whose event came after it went live", enrolled(cart) >= {p1, p2}, str(enrolled(cart)))

        click_journey = make_journey("clicks", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "EMAIL_ENGAGEMENT"}})
        run = sql("SELECT r.id::text, r.campaign_id::text FROM campaign_run r WHERE r.tenant_id = %s ORDER BY r.created_at LIMIT 1", [T])[0]
        for party, email, bot in ((p1, e1, False), (p2, e2, True)):
            mid = sql("""INSERT INTO mailer_execution (tenant_id, campaign_id, campaign_run_id, party_id, email_address, idempotency_key, status, delivered_at)
                         VALUES (%s, %s, %s, %s, %s, %s, 'DELIVERED', now()) RETURNING id""", [T, run[1], run[0], party, email, f"zj-{uuid.uuid4().hex}"])[0][0]
            sql("""INSERT INTO tracking_event (tenant_id, party_id, event_type, channel, campaign_id, campaign_run_id, mailer_execution_id, is_bot)
                   VALUES (%s, %s, 'CLICK', 'EMAIL', %s, %s, %s, %s)""", [T, party, run[1], run[0], mid, bot], fetch=False)
        enroll.enroll_journey(T, click_journey)
        check("Email Open/Click enrols from CEP's own clicks, with no event sent; a scanner's click does not count",
              p1 in enrolled(click_journey) and p2 not in enrolled(click_journey), str(enrolled(click_journey)))

        fixed = make_journey("fixed", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_FIXED"}}, population="FIXED")
        events.ingest(T, [events.clean({"event_type": "ZJ_FIXED", "party_id": p1})[0]])
        enroll.enroll_journey(T, fixed)
        events.ingest(T, [events.clean({"event_type": "ZJ_FIXED", "party_id": p2})[0]])
        enroll.enroll_journey(T, fixed)
        frozen = JourneyVersion.objects.get(journey=fixed).population_frozen_at
        check("a Fixed journey takes who qualifies at launch, then closes: a later event enrols nobody", enrolled(fixed) == {p1} and frozen is not None, str(enrolled(fixed)))
        flowing = make_journey("flowing", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_FLOW"}}, population="CONTINUOUSLY_QUALIFYING")
        events.ingest(T, [events.clean({"event_type": "ZJ_FLOW", "party_id": p1})[0]])
        enroll.enroll_journey(T, flowing)
        events.ingest(T, [events.clean({"event_type": "ZJ_FLOW", "party_id": p2})[0]])
        enroll.enroll_journey(T, flowing)
        check("a Continuously Qualifying journey keeps letting newcomers in", enrolled(flowing) == {p1, p2}, str(enrolled(flowing)))

        # ---- Issue Coupon: a request for C360, and a COUPON_ISSUED event
        coupon_id = sql("""INSERT INTO coupon (tenant_id, code, name) VALUES (%s, %s, 'Ten off') RETURNING id::text""", [T, f"ZJ{uuid.uuid4().hex[:6]}"])[0][0]
        coupon_journey = make_journey("coupon", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_COUPON"}}, nodes=[("COUPON_ISSUE", {"coupon_id": coupon_id})])
        node = JourneyNode.objects.get(journey_version__journey=coupon_journey, node_type="COUPON_ISSUE")
        enrollment = JourneyEnrollment.objects.create(journey=coupon_journey, journey_version=node.journey_version, tenant_id=T, party_id=p1, status="ACTIVE")
        state = JourneyCustomerState.objects.create(journey_enrollment=enrollment, current_node=node, entered_node_at=timezone.now(), next_scheduled_at=timezone.now(), state_data={})
        done, again_done = steps.run(node, state, enrollment), steps.run(node, state, enrollment)
        requests_ = sql("SELECT id, status, party_id FROM coupon_issuance WHERE tenant_id = %s AND journey_enrollment_id = %s", [T, str(enrollment.pk)])
        issued_event = sql("SELECT count(*) FROM journey_event WHERE tenant_id = %s AND party_id = %s AND event_type = 'COUPON_ISSUED' AND external_id = %s",
                           [T, p1, f"coupon-issuance:{requests_[0][0]}"])[0][0]
        check("Issue Coupon records one request per customer and step, and raises COUPON_ISSUED once",
              len(requests_) == 1 and requests_[0][1] == "REQUESTED" and done.result["issuance_id"] == again_done.result["issuance_id"] and issued_event == 1,
              f"{requests_} {done.result} {issued_event}")
        c360 = Client(HTTP_X_TENANT="NWA", HTTP_AUTHORIZATION=f"Bearer {api_key(['coupons:issue'])}")
        listed = c360.get("/api/v1/coupon-issuances/").json()["results"]
        check("C360 collects the open requests with a coupons:issue key", any(row["id"] == requests_[0][0] and row["coupon_code"] for row in listed), str(listed)[:200])
        marked = c360.patch(f"/api/v1/coupon-issuances/{requests_[0][0]}/", json.dumps({"status": "ISSUED", "external_code": "TEN-8K2Q"}), content_type="application/json")
        check("and marks one issued with the customer's own code", marked.status_code == 200 and marked.json()["status"] == "ISSUED"
              and marked.json()["external_code"] == "TEN-8K2Q" and marked.json()["resolved_at"], marked.content[:200])
        check("a wrong status is refused; an unknown id is 404; a shop key cannot read them",
              c360.patch(f"/api/v1/coupon-issuances/{requests_[0][0]}/", json.dumps({"status": "MAYBE"}), content_type="application/json").status_code == 400
              and c360.patch("/api/v1/coupon-issuances/999999999/", json.dumps({"status": "FAILED"}), content_type="application/json").status_code == 404
              and shop.get("/api/v1/coupon-issuances/").status_code == 403)

        # ---- governance in words
        template_id = sql("SELECT id::text FROM template_master WHERE tenant_id = %s AND status = 'ACTIVE' ORDER BY created_at LIMIT 1", [T])
        mail = make_journey("mail", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_MAIL"}}, status="DRAFT",
                            nodes=[("EMAIL", {"template_id": template_id[0][0] if template_id else str(uuid.uuid4())})])
        version = JourneyVersion.objects.get(journey=mail)
        CommunicationGovernancePolicy.objects.filter(tenant_id=T).update(is_active=False)
        item = next(i for i in publish.readiness(mail, version)["items"] if i["key"] == "governance")
        check("with no cap, the check says so in words and passes", item["ok"] and item["description"] == "Emails: no frequency cap applies.", item["description"])
        CommunicationGovernancePolicy.objects.create(tenant_id=T, name="ZJ weekly", scope="GLOBAL", max_messages=3, period_days=7)
        item = next(i for i in publish.readiness(mail, version)["items"] if i["key"] == "governance")
        check("a cap is named with its numbers", item["ok"] and item["description"] == "Emails: at most 3 in 7 days (ZJ weekly). A customer who has reached a cap is held back, not sent.",
              item["description"])
        CommunicationGovernancePolicy.objects.create(tenant_id=T, name="ZJ email daily", scope="CHANNEL", channel="EMAIL", max_messages=1, period_days=1)
        item = next(i for i in publish.readiness(mail, version)["items"] if i["key"] == "governance")
        check("every cap that applies is named, a day in the singular", item["ok"] and "at most 3 in 7 days (ZJ weekly)" in item["description"]
              and "at most 1 in 1 day (ZJ email daily)" in item["description"], item["description"])
        texts = make_journey("texts", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_TEXT"}}, status="DRAFT",
                             nodes=[("SMS", {"template_id": str(uuid.uuid4())})])
        item = next(i for i in publish.readiness(texts, JourneyVersion.objects.get(journey=texts))["items"] if i["key"] == "governance")
        check("a texting journey is told the quiet hours", "Texts wait out quiet hours, 21:00 to 08:00" in item["description"], item["description"])

        # ---- archive, cancel schedule, one live version
        live = make_journey("live", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_LIVE"}})
        events.ingest(T, [events.clean({"event_type": "ZJ_LIVE", "party_id": p1})[0]])
        enroll.enroll_journey(T, live)
        web = APIClient()
        web.force_authenticate(user)
        archived = web.post(f"/api/v1/journeys/{live.pk}/archive/", HTTP_X_TENANT="NWA")
        row = JourneyEnrollment.objects.get(journey=live, party_id=p1)
        check("Archive ends the journey: status, everyone inside leaves with the reason, versions retired",
              archived.status_code == 200 and archived.json()["status"] == "ARCHIVED" and archived.json()["ended"] == 1 and row.status == "EXITED"
              and row.exit_reason == "Journey archived" and set(JourneyVersion.objects.filter(journey=live).values_list("status", flat=True)) == {"RETIRED"},
              f"{archived.status_code} {archived.content[:200]}")
        check("archiving twice is refused", web.post(f"/api/v1/journeys/{live.pk}/archive/", HTTP_X_TENANT="NWA").status_code == 409)

        scheduled = make_journey("scheduled", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_SCHED"}}, status="DRAFT")
        Journey.objects.filter(pk=scheduled.pk).update(status="APPROVED", scheduled_activate_at=timezone.now() + timedelta(days=2))
        cancelled = web.post(f"/api/v1/journeys/{scheduled.pk}/cancel-schedule/", HTTP_X_TENANT="NWA")
        check("Cancel Schedule takes a scheduled journey back to Test", cancelled.status_code == 200 and cancelled.json()["status"] == "TEST"
              and cancelled.json()["scheduled_activate_at"] is None, cancelled.content[:200])
        check("and refuses a journey that is not scheduled", web.post(f"/api/v1/journeys/{scheduled.pk}/cancel-schedule/", HTTP_X_TENANT="NWA").status_code == 409)

        two = make_journey("two versions", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_TWO"}})
        v2 = graph.new_version(two, None)
        publish._retire_others(two, v2.pk)
        JourneyVersion.objects.filter(pk=v2.pk).update(status="ACTIVE")
        check("when a new version goes live the old one is retired: one live version", list(JourneyVersion.objects.filter(journey=two, status="ACTIVE")
                                                                                          .values_list("version_number", flat=True)) == [2])

        # ---- Settings → Events
        page = web.get("/api/v1/workspace/events/", HTTP_X_TENANT="NWA")
        data = page.json() if page.status_code == 200 else {}
        check("Settings → Events: the endpoint, scope, keys, known types and the last 7 days", page.status_code == 200 and data["endpoint"].endswith("/api/v1/events/")
              and data["scope"] == "events:ingest" and data["keys_with_scope"] >= 1 and data["summary"]["total"] >= 3
              and any(t["event_type"] == "EMAIL_ENGAGEMENT" and t["from_tracking"] for t in data["types"]) and data["coupons"]["issued"] >= 1, str(page.status_code))
        recent = web.get("/api/v1/workspace/events/recent/?type=CART_ABANDON", HTTP_X_TENANT="NWA").json()["results"]
        check("the latest events, filtered by type, with the label and the customer's name", recent and all(r["event_type"] == "CART_ABANDON" for r in recent)
              and recent[0]["label"] == "Abandoned Cart", str(recent[:1])[:200])
    check.done()
