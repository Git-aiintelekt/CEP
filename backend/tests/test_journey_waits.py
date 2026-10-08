"""Wait Until (apps.journeys.waits): a Wait step until a time of day in the customer's own time zone (custom_attributes.timezone,
else the workspace's) and until a date on the customer's record with an offset, with what happens when the date has passed or
is missing; their validation on save and in readiness."""
import json
from datetime import datetime, timedelta, timezone as utc
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.delivery.engine import session
from apps.journeys import graph, publish, waits
from apps.journeys.engine import steps
from apps.journeys.engine.outcome import Done, Finish, Hold
from apps.journeys.models import JourneyEnrollment, JourneyNode, JourneyVersion

from .test_journey_events import T, customers, make_journey, sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def set_attributes(party_id, **attributes):
    sql("UPDATE customer_master SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb) || %s::jsonb WHERE tenant_id = %s AND party_id = %s",
        [json.dumps(attributes), T, party_id], fetch=False)


def test_wait_rules(check):
    """What a timed wait may say, and the moments it computes."""
    check("a duration wait has no mode and no problem", waits.mode_of({"duration": 3}) == "DURATION" and waits.problem({"duration": 3}) is None)
    check("a time-of-day wait needs HH:MM", waits.problem({"mode": "TIME_OF_DAY", "time": "9"}) == "Choose a time of day, as HH:MM."
          and waits.problem({"mode": "TIME_OF_DAY", "time": "09:00", "weekdays": ["MON", "FRI"]}) is None)
    check("a date wait needs the attribute, an offset within a year and a known if_passed",
          "which date" in waits.problem({"mode": "DATE_ATTRIBUTE", "time": "10:00"})
          and "offset_days" in waits.problem({"mode": "DATE_ATTRIBUTE", "time": "10:00", "attribute": "renewal_date", "offset_days": 400})
          and "if_passed" in waits.problem({"mode": "DATE_ATTRIBUTE", "time": "10:00", "attribute": "renewal_date", "offset_days": -3, "if_passed": "MAYBE"})
          and waits.problem({"mode": "DATE_ATTRIBUTE", "time": "10:00", "attribute": "renewal_date", "offset_days": -3, "if_passed": "EXIT"}) is None)
    check("an unknown mode is refused", waits.problem({"mode": "SOON"}) is not None)
    chicago = ZoneInfo("America/Chicago")
    afternoon = datetime(2026, 10, 8, 19, 10, tzinfo=utc.utc)                         # Thursday 14:10 in Chicago
    check("14:10 waits for 09:00 the next morning, their time", waits.next_time_of_day(waits.schedule._time({"time": "09:00"}), [], chicago, afternoon).isoformat() == "2026-10-09T09:00:00-05:00")
    check("14:10 continues at 15:00 the same day", waits.next_time_of_day(waits.schedule._time({"time": "15:00"}), [], chicago, afternoon).isoformat() == "2026-10-08T15:00:00-05:00")
    check("weekdays are honoured: the next Monday", waits.next_time_of_day(waits.schedule._time({"time": "09:00"}), ["MON"], chicago, afternoon).isoformat() == "2026-10-12T09:00:00-05:00")
    check("a date three days before the renewal", waits.date_moment("2026-11-02", -3, waits.schedule._time({"time": "10:00"}), chicago).isoformat() == "2026-10-30T10:00:00-05:00"
          and waits.date_moment("soon", 0, waits.schedule._time({"time": "10:00"}), chicago) is None)
    check("an unknown time zone name falls back to the workspace's", waits.customer_zone({"timezone": "Mars/Olympus"}, chicago) == (chicago, False)
          and waits.customer_zone({"timezone": "Europe/Paris"}, chicago)[1])
    check("the wait reads in words", waits.describe({"mode": "TIME_OF_DAY", "time": "09:00", "weekdays": ["MON", "TUE"]}) == "until 9:00 AM on Monday, Tuesday, the customer's time"
          and waits.describe({"mode": "DATE_ATTRIBUTE", "time": "10:00", "attribute": "renewal_date", "offset_days": -3, "zone": "WORKSPACE"}).startswith("until 3 days before each customer"))
    check("readiness: a timed wait is configured when complete, a duration wait when it has a duration",
          publish._step_configured(SimpleNamespace(node_type="WAIT", config={"mode": "TIME_OF_DAY", "time": "09:00"}))
          and not publish._step_configured(SimpleNamespace(node_type="WAIT", config={"mode": "DATE_ATTRIBUTE", "time": "10:00"}))
          and not publish._step_configured(SimpleNamespace(node_type="WAIT", config={"duration": ""})))
    bad = {"entry_rules": [], "nodes": [{"key": "start", "type": "START", "config": {}}, {"key": "w", "type": "WAIT", "config": {"mode": "DATE_ATTRIBUTE", "time": "10:00", "offset_days": 999, "attribute": "x"}}],
           "connections": [{"from": "start", "to": "w"}]}
    with pytest.raises(ValidationError) as caught:
        graph.clean(bad)
    check("saving refuses a timed wait that is wrong", "offset_days" in json.dumps(caught.value.detail), json.dumps(caught.value.detail))


def test_wait_until_in_a_journey(check, fresh_cache):
    with session.tenant_scope(T):
        (p1, _e1), (p2, _e2), (p3, _e3) = customers(3)
        set_attributes(p1, timezone="Asia/Kolkata", zj_renewal=(timezone.now() + timedelta(days=10)).date().isoformat())
        set_attributes(p2, timezone="Mars/Olympus", zj_renewal=(timezone.now() - timedelta(days=10)).date().isoformat())
        set_attributes(p3, timezone="")
        journey = make_journey("waits", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_WAIT"}}, nodes=[("WAIT", {"duration": 1, "unit": "DAYS"})])
        version = JourneyVersion.objects.get(journey=journey)
        node = JourneyNode.objects.get(journey_version=version, node_key="wait-0")
        workspace_zone = waits.schedule.tenant_zone(T)
        now = timezone.now()
        state = SimpleNamespace(state_data={}, entered_node_at=now)

        def wait(party, **config):
            enrollment = JourneyEnrollment.objects.create(journey=journey, journey_version=version, tenant_id=T, party_id=party, status="ACTIVE")
            node.config = config
            try:
                return steps._wait(node, state, enrollment)
            finally:
                enrollment.delete()

        # ---- until a time of day
        held = wait(p1, mode="TIME_OF_DAY", time="09:00")
        kolkata = ZoneInfo("Asia/Kolkata")
        expected = waits.next_time_of_day(waits.schedule._time({"time": "09:00"}), [], kolkata, now)
        check("the customer waits until 9:00 in their own time zone", isinstance(held, Hold) and held.until == expected and held.until.astimezone(kolkata).hour == 9, str(held))
        held = wait(p2, mode="TIME_OF_DAY", time="09:00")
        check("a record with an unknown zone name uses the workspace's", isinstance(held, Hold) and held.until.astimezone(workspace_zone).hour == 9, str(held))
        held = wait(p3, mode="TIME_OF_DAY", time="09:00", zone="WORKSPACE", weekdays=["MON"])
        check("workspace time on Mondays only", isinstance(held, Hold) and held.until.astimezone(workspace_zone).weekday() == 0 and held.until.astimezone(workspace_zone).hour == 9, str(held))
        soon = (now + timedelta(minutes=2)).astimezone(kolkata)
        held = wait(p1, mode="TIME_OF_DAY", time=f"{soon.hour:02d}:{soon.minute:02d}")
        check("a time two minutes away is a short hold", isinstance(held, Hold) and timedelta(0) < held.until - now <= timedelta(minutes=3), str(held))
        done = wait(p1, mode="TIME_OF_DAY", time="25:00")
        check("a wait that cannot be read fails the step", isinstance(done, Done) and done.status == "FAILED", str(done))

        # ---- until a date on the record
        held = wait(p1, mode="DATE_ATTRIBUTE", attribute="zj_renewal", offset_days=-3, time="10:00")
        check("the customer waits until 10:00 three days before their renewal, their time",
              isinstance(held, Hold) and held.until.astimezone(kolkata).hour == 10 and (held.until.astimezone(kolkata).date() - now.astimezone(kolkata).date()).days in (6, 7, 8), str(held))
        done = wait(p2, mode="DATE_ATTRIBUTE", attribute="zj_renewal", offset_days=-3, time="10:00")
        check("a date that has passed continues at once, saying so", isinstance(done, Done) and done.result.get("reason") == waits.DATE_PASSED, str(done))
        finished = wait(p2, mode="DATE_ATTRIBUTE", attribute="zj_renewal", offset_days=-3, time="10:00", if_passed="EXIT")
        check("or leaves the journey when asked", isinstance(finished, Finish) and finished.status == "EXITED" and finished.reason == waits.DATE_PASSED, str(finished))
        finished = wait(p3, mode="DATE_ATTRIBUTE", attribute="zj_renewal", offset_days=0, time="10:00", if_passed="EXIT")
        check("no date on the record leaves the journey when asked", isinstance(finished, Finish) and finished.reason == waits.NO_DATE, str(finished))
        done = wait(p3, mode="DATE_ATTRIBUTE", attribute="zj_renewal", offset_days=0, time="10:00")
        check("or continues at once", isinstance(done, Done) and done.result.get("reason") == waits.NO_DATE, str(done))
        held = wait(p1, mode="DURATION", duration=2, unit="DAYS")
        check("a duration wait is unchanged", isinstance(held, Hold) and held.until == now + timedelta(days=2), str(held))
