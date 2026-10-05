"""Journeys' remaining gaps: Attribute Change triggers (loyalty tier, preference update, address change), No Response for
lapsed engagers, and a new version of a live journey taken through Test Publish, a schedule, its cancellation and go-live
without the live version stopping. Test Publish customers can still enter for real."""
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from api.v1 import preferences_public
from apps.customers.models import LoyaltyTier
from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.journeys import events, graph, lifecycle, publish, schedule
from apps.journeys.engine import enroll, steps
from apps.journeys.models import Journey, JourneyEnrollment, JourneyVersion

from .test_journey_events import T, customers, enrolled, make_journey, sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def event_types(party_id, *types):
    return [row[0] for row in sql("SELECT event_type FROM journey_event WHERE tenant_id = %s AND party_id = %s AND event_type = ANY(%s) ORDER BY id",
                                  [T, party_id, list(types)])]


def test_journey_gaps(check, admin_email, fresh_cache, monkeypatch):
    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    with session.tenant_scope(T):
        (p1, _e1), (p2, e2), (p3, e3) = customers(3)

        # ---- Attribute Change triggers
        tier_journey = make_journey("tier", entry={"entry_type": "SEGMENT_CHANGE", "rule_definition": {"change_trigger": "LOYALTY_TIER"}})
        tier = LoyaltyTier.objects.create(tenant_id=T, code=f"ZJ-{uuid.uuid4().hex[:6]}", name="ZJ Gold")
        holder = JourneyEnrollment.objects.create(journey=tier_journey, journey_version=JourneyVersion.objects.get(journey=tier_journey),
                                                  tenant_id=T, party_id=p1, status="EXITED")
        node = SimpleNamespace(config={"tier_id": str(tier.pk)}, node_key="loyalty-0")
        done = steps._loyalty(node, SimpleNamespace(state_data={}), holder)
        steps._loyalty(node, SimpleNamespace(state_data={}), holder)
        check("Update Loyalty Tier raises one Loyalty Tier Change, with the tier before and after",
              done.result["changed"] and event_types(p1, "LOYALTY_TIER_CHANGE") == ["LOYALTY_TIER_CHANGE"], str(done.result))
        JourneyEnrollment.objects.filter(pk=holder.pk).delete()
        enroll.enroll_journey(T, tier_journey)
        check("Attribute Change: Loyalty Tier enrols on that event", p1 in enrolled(tier_journey), str(enrolled(tier_journey)))

        address = make_journey("address", entry={"entry_type": "SEGMENT_CHANGE", "rule_definition": {"change_trigger": "ADDRESS_CHANGE"}})
        accepted = events.ingest(T, [events.clean({"event_type": "ADDRESS_CHANGE", "party_id": p2, "payload": {"city": "Austin"}})[0]])
        enroll.enroll_journey(T, address)
        check("Attribute Change: Address Change enrols on the event C360 sends", accepted[0]["status"] == "ACCEPTED" and enrolled(address) == {p2},
              str(enrolled(address)))

        preference = make_journey("preference", entry={"entry_type": "SEGMENT_CHANGE", "rule_definition": {"change_trigger": "PREFERENCE_UPDATE"}})
        preferences_public._preference_event(T, p3, {"channels_off": ["EMAIL"]}, False)
        check("a preference-centre save that changed nothing raises nothing", event_types(p3, "PREFERENCE_UPDATE") == [])
        preferences_public._preference_event(T, p3, {"channels_off": ["EMAIL"]}, True)
        enroll.enroll_journey(T, preference)
        check("Attribute Change: Preference Update enrols on the preference centre's event", enrolled(preference) == {p3}, str(enrolled(preference)))
        check("the entry reads in words", "a loyalty tier change triggered" in publish._entry_summary(JourneyVersion.objects.get(journey=tier_journey)))

        # ---- No Response
        lapsed = sql("""SELECT cm.party_id, lower(cm.emails -> 0 ->> 'address') FROM customer_master cm
                         WHERE cm.tenant_id = %s AND jsonb_array_length(cm.emails) > 0 AND cm.party_id <> ALL(%s)
                           AND NOT EXISTS (SELECT 1 FROM tracking_event t WHERE t.tenant_id = cm.tenant_id AND t.party_id = cm.party_id
                                              AND t.event_type IN ('OPEN', 'CLICK') AND t.occurred_at >= now() - interval '30 days')
                         ORDER BY cm.party_id LIMIT 2""", [T, [p1, p2, p3]])
        (quiet, quiet_email), (engaged, engaged_email) = lapsed
        run = sql("""SELECT r.id::text, r.campaign_id::text FROM campaign_run r JOIN campaign c ON c.id = r.campaign_id
                      WHERE r.tenant_id = %s AND c.solicitation_type = 'MARKETING' AND c.campaign_type <> 'E_RECEIPT' ORDER BY r.created_at LIMIT 1""", [T])[0]
        sent = {}
        for party, email in ((quiet, quiet_email), (engaged, engaged_email)):
            for _ in range(3):
                sent[party] = sql("""INSERT INTO mailer_execution (tenant_id, campaign_id, campaign_run_id, party_id, email_address, idempotency_key, status, delivered_at)
                                     VALUES (%s, %s, %s, %s, %s, %s, 'DELIVERED', now() - interval '2 days') RETURNING id""",
                                  [T, run[1], run[0], party, email, f"zj-{uuid.uuid4().hex}"])[0][0]
        sql("""INSERT INTO tracking_event (tenant_id, party_id, event_type, channel, campaign_id, campaign_run_id, mailer_execution_id, is_bot)
               VALUES (%s, %s, 'OPEN', 'EMAIL', %s, %s, %s, FALSE)""", [T, engaged, run[1], run[0], sent[engaged]], fetch=False)
        sunset = make_journey("sunset", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "NO_RESPONSE"}})
        enroll._raise_no_response(T, [sunset])
        enroll._raise_no_response(T, [sunset])
        check("three marketing emails, no open or click: one No Response event, not two", event_types(quiet, "NO_RESPONSE") == ["NO_RESPONSE"])
        check("a customer who opened one is not lapsed", event_types(engaged, "NO_RESPONSE") == [])
        with session.tx():
            raised_again = events.raise_no_response(T)
        check("a customer with a No Response in the last 30 days gets no second one", event_types(quiet, "NO_RESPONSE") == ["NO_RESPONSE"], str(raised_again))
        enroll.enroll_journey(T, sunset)
        check("a journey starting from No Response enrols the lapsed customer", quiet in enrolled(sunset) and engaged not in enrolled(sunset))

        # ---- Date / Time
        chicago = ZoneInfo("America/Chicago")
        weekly = {"schedule": "WEEKLY", "time": "09:00", "weekdays": ["MON", "THU"], "contact_list_id": str(uuid.uuid4())}
        wed = datetime(2026, 10, 7, 12, 0, tzinfo=chicago)
        check("Weekly: the latest moment is Monday 9:00, the next Thursday 9:00",
              schedule.latest_moment(weekly, chicago, wed) == datetime(2026, 10, 5, 9, 0, tzinfo=chicago)
              and schedule.next_moment(weekly, chicago, wed) == datetime(2026, 10, 8, 9, 0, tzinfo=chicago))
        monthly = {"schedule": "MONTHLY", "time": "18:30", "day_of_month": "LAST", "segment_id": str(uuid.uuid4())}
        check("Monthly on the last day reads in words and fires on Sep 30", schedule.latest_moment(monthly, chicago, wed) == datetime(2026, 9, 30, 18, 30, tzinfo=chicago)
              and schedule.describe(monthly, "Gold") == "On the last day of every month at 6:30 PM, customers in Gold")
        check("a rule missing its audience, weekday or time says what it needs",
              schedule.problem({"schedule": "WEEKLY", "time": "09:00", "weekdays": []}) == "Choose at least one weekday."
              and schedule.problem({"schedule": "DAILY", "time": "09:00"}) == "Choose who enters: a customer list or a segment."
              and schedule.problem({"schedule": "DATE_ATTRIBUTE", "time": "x", "attribute": "birth_date"}) == "Choose a time.")
        check("the busy case in words", schedule.describe({"schedule": "DATE_ATTRIBUTE", "time": "10:00", "attribute": "birth_date", "offset_days": -7, "yearly": True,
                                                           "segment_id": "s"}, "Gold and Platinum")
              == "Every year, 7 days before each customer’s Birth Date, at 10:00 AM, customers in Gold and Platinum")

        zone = schedule.tenant_zone(T)
        local_now = timezone.now().astimezone(zone)
        at = (local_now - timedelta(minutes=1)).strftime("%H:%M")
        rule = {"schedule": "DATE_ATTRIBUTE", "time": at, "attribute": "zj_birth_date", "offset_days": -7, "yearly": True}
        moment = schedule.latest_moment(rule, zone, timezone.now())
        birthday = (moment.astimezone(zone).date() + timedelta(days=7)).replace(year=1990)
        sql("UPDATE customer_master SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb) || jsonb_build_object('zj_birth_date', %s::text) "
            "WHERE tenant_id = %s AND party_id = %s", [birthday.isoformat(), T, p1], fetch=False)
        sql("UPDATE customer_master SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb) || jsonb_build_object('zj_birth_date', '1990-01-01x') "
            "WHERE tenant_id = %s AND party_id = %s", [T, p2], fetch=False)
        birthday_journey = make_journey("birthday", entry={"entry_type": "DATE_TIME", "rule_definition": rule}, published_ago=timedelta(minutes=5))
        enroll.enroll_journey(T, birthday_journey)
        fired = JourneyVersion.objects.get(journey=birthday_journey).last_fired_at
        check("On a Date Attribute: the customer whose birthday is 7 days away enters at the moment, once", p1 in enrolled(birthday_journey) and fired == moment,
              f"{enrolled(birthday_journey)} {fired} {moment}")
        enroll.enroll_journey(T, birthday_journey)
        check("the same moment does not fire twice", JourneyEnrollment.objects.filter(journey=birthday_journey, party_id=p1).count() == 1)
        late = make_journey("too late", entry={"entry_type": "DATE_TIME", "rule_definition": rule}, published_ago=timedelta(seconds=1))
        enroll.enroll_journey(T, late)
        check("a moment before the version went live waits for the next one", enrolled(late) == set()
              and JourneyVersion.objects.get(journey=late).last_fired_at is None)
        check("readiness: a complete Date / Time rule passes the entry check, an incomplete one does not",
              publish._entry_ok(JourneyVersion.objects.get(journey=birthday_journey))
              and not publish._entry_ok(JourneyVersion.objects.get(journey=make_journey("incomplete", entry={"entry_type": "DATE_TIME", "rule_definition": {"schedule": "DAILY"}}))))
        listed = APIClient()
        listed.force_authenticate(user)
        attributes = listed.get("/api/v1/journeys/date-attributes/", HTTP_X_TENANT="NWA")
        check("the dates on customer records, with how many customers have each", attributes.status_code == 200
              and any(row["key"] == "zj_birth_date" and row["label"] == "Zj Birth Date" and row["customers"] >= 1 for row in attributes.json()), attributes.content[:200])

        # ---- a new version of a live journey (Start -> Exit sends nothing, so readiness's template check is set aside)
        monkeypatch.setattr(publish, "readiness", lambda journey, version: {"ready": True, "items": []})
        live = make_journey("live v2", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_LIVE"}})
        Journey.objects.filter(pk=live.pk).update(reentry_policy="NEVER")
        live.refresh_from_db()
        v1 = JourneyVersion.objects.get(journey=live)
        events.ingest(T, [events.clean({"event_type": "ZJ_LIVE", "party_id": p2})[0]])
        v2 = graph.new_version(live, None)
        result = publish.run_test(live, v2, {"mode": "RANDOM", "sample_size": 5}, None)
        live.refresh_from_db()
        v2.refresh_from_db()
        test_rows = JourneyEnrollment.objects.filter(journey=live, journey_version=v2)
        check("Test Publish of a live journey's new version: the journey stays Active, the version is tested, no test customer is left inside",
              result["sent_to"] >= 1 and live.status == "ACTIVE" and v2.status == "TEST_PUBLISHED" and not test_rows.filter(status="ACTIVE").exists(), str(result))
        enroll.enroll_journey(T, live)
        check("a Test Publish customer still enters the live journey for real (re-entry Never)",
              JourneyEnrollment.objects.filter(journey=live, journey_version=v1, party_id=p2).exists())

        later = timezone.now() + timedelta(days=2)
        scheduled = publish.approve(live, v2, later, user.pk)
        check("approving it for later keeps the live version running", scheduled.status == "ACTIVE" and scheduled.scheduled_activate_at == later
              and enroll.live_version(scheduled).pk == v1.pk)
        cancelled = lifecycle.cancel_schedule(scheduled, user.pk)
        check("Cancel Schedule leaves the live version live and the new one tested", cancelled.status == "ACTIVE" and cancelled.scheduled_activate_at is None
              and cancelled.current_version_id == v1.pk and JourneyVersion.objects.get(pk=v2.pk).status == "TEST_PUBLISHED")
        publish.approve(cancelled, v2, later, user.pk)
        Journey.objects.filter(pk=live.pk).update(scheduled_activate_at=timezone.now() - timedelta(minutes=1))
        monkeypatch.setattr("apps.journeys.engine.tenants", lambda query: [T])          # its own connection cannot see this test's rows
        publish.activate_due()
        live.refresh_from_db()
        check("when the time comes the new version goes live and the old one retires; the journey stays Active",
              live.status == "ACTIVE" and live.scheduled_activate_at is None
              and dict(JourneyVersion.objects.filter(journey=live).values_list("version_number", "status")) == {1: "RETIRED", 2: "ACTIVE"})

        paused = make_journey("paused v2", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_PAUSED"}})
        lifecycle.pause(paused, user.pk)
        events.ingest(T, [events.clean({"event_type": "ZJ_PAUSED", "party_id": p3})[0]])
        pv2 = graph.new_version(paused, None)
        publish.run_test(Journey.objects.get(pk=paused.pk), pv2, {"mode": "RANDOM", "sample_size": 5}, None)
        now_live = publish.approve(Journey.objects.get(pk=paused.pk), pv2, None, user.pk)
        check("approving a paused journey's new version now replaces the version and keeps it paused",
              now_live.status == "PAUSED" and JourneyVersion.objects.get(pk=pv2.pk).status == "ACTIVE")

        web = APIClient()
        web.force_authenticate(user)
        Journey.objects.filter(pk=paused.pk).update(status="ACTIVE")
        check("Cancel Schedule is refused when nothing is scheduled",
              web.post(f"/api/v1/journeys/{paused.pk}/cancel-schedule/", HTTP_X_TENANT="NWA").status_code == 409)
    check.done()
