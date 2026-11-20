"""Delivery Warm-Up: the plan sized to the workspace plan, the hour's warm-up sends picked from the list in order, round after
round with a template each person has not had, the workspace's own campaigns let out first within the hourly limit, the day
judged at midnight (Automatic, Approve Each Step, two bad days), and the warm-up campaigns in Campaigns. Rolled back; Postal
is mocked by the `world` fixture."""
from datetime import time, timedelta
from unittest import mock

import pytest

from apps.campaigns.models import CampaignRun
from apps.delivery import engine, warmup
from apps.delivery.engine import runs, session
from apps.platform_ops import jobs
from django.conf import settings

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_the_plan_and_the_template_rule(check):
    daily = warmup.plan("DEDICATED", "DAILY", time(8), time(21), 25_000)
    check("a dedicated IP on a daily plan for 25,000 contacts: 15 days, from 20 an hour (260 a day) until the day 25,000 fit",
          len(daily) == 15 and daily[0] == {"day": 1, "age": 0, "hourly": 20, "daily": 260} and daily[-1]["daily"] >= 25_000 and daily[-2]["daily"] < 25_000
          and daily[-1]["hourly"] == 1924, daily[-2:])
    hourly = warmup.plan("DEDICATED", "HOURLY", time(8), time(21), 25_000)
    check("the hourly plan counts 24 hours: 14 days, the last hour cut to just enough", len(hourly) == 14 and hourly[-1]["hourly"] == 1042 and hourly[0]["daily"] == 480, hourly[-1])
    shared = warmup.plan("SHARED", "DAILY", time(8), time(21), 25_000)
    check("the shared pool starts at warm-up age 7", shared[0]["age"] == 7 and len(shared) == 8)
    check("without a contact limit the whole schedule, day 0 to 41", len(warmup.plan("DEDICATED", "HOURLY", time(8), time(21), None)) == 42)
    choice = warmup.assign(["A", "B", "C"], {"p1": {"A"}, "p2": {"A", "B", "C"}}, ["p1", "p2", "p3"])
    check("each person gets the first template they have not had; someone who had them all gets none", choice == {"p1": "B", "p2": None, "p3": "A"}, choice)
    check("the limit is spread over the hour", warmup.paced(60, 0) == 1 and warmup.paced(60, 59) == 60 and warmup.paced(5, 0) == 1)
    check("the job is registered, monitored and scheduled every minute",
          "run-delivery-warm-ups" in jobs.JOBS and settings.CELERY_BEAT_SCHEDULE["run-delivery-warm-ups"]["schedule"] == 60)
    check.done()


def test_warm_up_end_to_end(world, check):
    welcome = world.template("ZS welcome", "EMAIL", subject="Welcome", html="<p>Welcome</p>")
    offer = world.template("ZS offer", "EMAIL", subject="Offer", html="<p>Offer</p>")
    regular_body = world.template("ZS regular", "EMAIL", subject="Own campaign", html="<p>Own</p>")
    api, sql, tenant = world.api, world.sql, world.tenant

    def overview():
        return api("get", "/api/v1/warmup/").json()

    def tick():
        with session.tenant_scope(tenant):
            return warmup.tick(tenant)

    def send_all(campaign_id):
        """Starts and sends every run of the campaign that is waiting or open."""
        for run in CampaignRun.objects.filter(campaign_id=campaign_id, status__in=["SCHEDULED", "SENDING"]):
            sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [str(run.pk)])
            with mock.patch.object(runs, "quiet_until", return_value=None):
                engine.process_run(tenant, str(run.pk))

    def warm_up_campaigns():
        return sql("""SELECT l.day_no, c.id::text, c.name, c.campaign_type FROM delivery_warmup_campaign l JOIN campaign c ON c.id = l.campaign_id
                       ORDER BY l.day_no, c.name""", fetch=True)        # by day: inside the test's one transaction every created_at is the same

    def next_day():
        """Midnight passes: what went out today counts as yesterday's."""
        sql("""UPDATE mailer_execution SET submitted_at = submitted_at - interval '1 day',
                      send_after = CASE WHEN send_after IS NULL OR send_after = 'infinity' THEN send_after ELSE send_after - interval '1 day' END
                WHERE tenant_id = %s AND submitted_at > now() - interval '1 hour'""", [tenant])
        sql("UPDATE delivery_warmup_send SET sent_on = sent_on - 1 WHERE tenant_id = %s", [tenant])
        sql("UPDATE delivery_warmup_campaign SET sent_on = sent_on - 1 WHERE tenant_id = %s", [tenant])
        sql("UPDATE delivery_warmup SET day_started_on = day_started_on - 1 WHERE tenant_id = %s AND status IN ('WARMING', 'PAUSED')", [tenant])
        return tick()

    with mock.patch.object(warmup, "contacts_target", return_value=(None, "Test")), mock.patch.object(warmup, "paced", lambda limit, minute: limit):
        before = overview()
        check("before: no warm-up, and the four plans to choose from", before["present"] is True and before["warmup"] is None
              and set(api("get", "/api/v1/warmup/plans/?window_start=08:00&window_end=21:00").json()["plans"]) == {"DEDICATED_HOURLY", "DEDICATED_DAILY", "SHARED_HOURLY", "SHARED_DAILY"})
        refused = api("post", "/api/v1/warmup/", {"sender_profile": world.email_sender, "ip_mode": "DEDICATED", "plan_kind": "HOURLY", "list_ids": [], "template_id": welcome})
        check("a warm-up needs a list", refused.status_code == 400 and "list" in refused.json().get("detail", ""), refused.content[:200])
        started = api("post", "/api/v1/warmup/", {"sender_profile": world.email_sender, "ip_mode": "DEDICATED", "plan_kind": "HOURLY", "advance_mode": "AUTO",
                                                  "list_ids": [world.three], "template_id": welcome})
        body = started.json()
        check("started: 42 days on the whole schedule, day 1 in force with the list and template", started.status_code == 201 and body["warmup"]["days_total"] == 42
              and body["warmup"]["current_day"] == 1 and body["days"][0]["lists"][0]["id"] == world.three and body["days"][0]["template"]["id"] == welcome
              and body["days"][0]["state"] == "TODAY" and body["days"][0]["hourly_limit"] == 20, started.content[:300])
        again = api("post", "/api/v1/warmup/", {"sender_profile": world.email_sender, "list_ids": [world.three], "template_id": welcome})
        check("one warm-up at a time", again.status_code == 400)
        changed = api("post", "/api/v1/warmup/days/", {"from_day": 1, "to_day": 3, "hourly_limit": 4})
        check("days 1 to 3 get 4 an hour", changed.status_code == 200 and [d["hourly_limit"] for d in changed.json()["days"][:4]] == [4, 4, 4, 55], changed.content[:200])

        # ---- the workspace's own campaign first: 3 people wait for the hour, then the warm-up takes what is left
        own = api("post", "/api/v1/campaigns/", {"name": "ZS own during warm-up", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": regular_body,
                                                 "sender_profile": world.email_sender, "contact_lists": [world.three]}).json()
        world.publish(own["id"])
        send_all(own["id"])
        own_run = CampaignRun.objects.get(campaign_id=own["id"], test_mode=False)
        check("the own campaign's 3 messages were held and let out within the hour's 4", len([p for p in world.posted if p["subject"] == "Own campaign"]) == 3, world.posted)
        first = tick()
        check("the hour leaves 1 for the warm-up: the first person of the list", first["hour"].get("budget") == 1 and first["hour"].get("queued") == 1, first)
        made = warm_up_campaigns()
        check("a Warm-Up campaign for day 1 and its template", len(made) == 1 and made[0][0] == 1 and made[0][2] == "Day 1 · ZS welcome" and made[0][3] == "WARM_UP", made)
        send_all(made[0][1])
        sent = [p["to"] for p in world.posted if p["subject"] == "Welcome"]
        check("the warm-up email went to the first person of the list", sent == ["zs-p01@zs.example"], sent)
        check("the own run is closed", CampaignRun.objects.get(pk=own_run.pk).status == "COMPLETED")
        second = tick()
        check("the same hour is not picked twice", not second.get("hour"), second)

        # ---- the next day: healthy, so day 2 automatically; the round goes on in list order
        moved = next_day()
        state = overview()
        check("midnight: day 1 judged healthy (4 sent), day 2 in force", moved["day"]["outcome"] == "DONE" and state["warmup"]["current_day"] == 2
              and state["days"][0]["state"] == "DONE" and state["days"][0]["health"]["sent"] == 4, (moved, state["warmup"]["current_day"]))
        for _, cid, _, _ in warm_up_campaigns():
            send_all(cid)
        sent = [p["to"] for p in world.posted if p["subject"] == "Welcome"]
        check("day 2 continues down the list: the two people the round had not reached, then the next round begins with the first",
              sorted(sent[1:]) == ["zs-p02@zs.example", "zs-p03@zs.example"], sent)
        offers = [p["to"] for p in world.posted if p["subject"] == "Offer"]
        rounds = dict(sql("SELECT party_id, max(round) FROM delivery_warmup_send WHERE tenant_id = %s GROUP BY 1", [tenant], True))
        check("someone who already had the welcome in round 1 gets no second welcome; without another template they are counted, not sent",
              "zs-p01@zs.example" not in sent[1:] and not offers, (sent, rounds))

        # ---- another template for people who had the day's: the next round uses it
        api("patch", "/api/v1/warmup/", {"extra_template_ids": [offer]})
        moved = next_day()
        made = warm_up_campaigns()
        for _, cid, _, _ in made:
            send_all(cid)
        offers = sorted(p["to"] for p in world.posted if p["subject"] == "Offer")
        welcomes = [p["to"] for p in world.posted if p["subject"] == "Welcome"]
        check("day 3: everyone had the welcome, so the second round gets the extra template, and nobody gets the welcome twice",
              offers and set(offers) <= {"zs-p01@zs.example", "zs-p02@zs.example", "zs-p03@zs.example"} and len(welcomes) == len(set(welcomes)), (offers, welcomes))
        names = [name for _, _, name, _ in warm_up_campaigns()]
        check("the offer's sends are a campaign of their own for the day", any(name == "Day 3 · ZS offer" for name in names), names)

        # ---- Campaigns: marked, read-only, filtered
        cid = made[0][1]
        detail = api("get", f"/api/v1/campaigns/{cid}/").json()
        check("a warm-up campaign says it was sent by the warm-up, on which day, and can only be looked at",
              detail["triggered_by"] == "WARM_UP" and detail["campaign_type"] == "WARM_UP" and detail["warm_up"]["day"] >= 1 and set(detail["actions"]) <= {"results"}, detail.get("warm_up"))
        refused = api("patch", f"/api/v1/campaigns/{cid}/", {"name": "Mine now"})
        check("it cannot be edited", refused.status_code == 409 and "Delivery Warm-Up" in refused.json().get("detail", ""))
        listed = api("get", "/api/v1/campaigns/?triggered_by=warm_up&page_size=100").json()
        rows = listed.get("results", listed)
        check("the Warm-Up filter shows only warm-up campaigns", rows and all(row["campaign_type"] == "WARM_UP" for row in rows), [row["name"] for row in rows][:5])
        others = api("get", "/api/v1/campaigns/?triggered_by=not_warm_up&page_size=200").json()
        check("and Not Warm-Up hides them", all(row["campaign_type"] != "WARM_UP" for row in others.get("results", others)))

        # ---- Approve Each Step: a healthy day offers the next one; approve moves on
        api("patch", "/api/v1/warmup/", {"advance_mode": "APPROVE"})
        day_before = overview()["warmup"]["current_day"]
        next_day()
        offered = overview()["warmup"]
        check("approve each step: the next day is offered, not taken", offered["offered_day"] == day_before + 1 and offered["current_day"] == day_before, offered)
        approved = api("post", "/api/v1/warmup/actions/", {"action": "approve"}).json()["warmup"]
        check("approved: the plan moves on at once", approved["current_day"] == day_before + 1 and approved["offered_day"] is None)

        # ---- two days over a limit: back a day and paused
        api("patch", "/api/v1/warmup/", {"advance_mode": "AUTO"})
        for number in range(2):
            bounced = api("post", "/api/v1/campaigns/", {"name": f"ZS bounced {number}", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": regular_body,
                                                         "sender_profile": world.email_sender, "contact_lists": [world.three]}).json()
            world.publish(bounced["id"])
            send_all(bounced["id"])
            sql("""UPDATE mailer_execution SET bounced_at = now(), status = 'BOUNCED' WHERE tenant_id = %s AND submitted_at > now() - interval '1 hour'""", [tenant])
            result = next_day()
        state = overview()["warmup"]
        check("two days over the bounce limit: paused, back a day, and it says why", state["status"] == "PAUSED" and "two days" in (state["status_note"] or "").lower(), (result, state))
        resumed = api("post", "/api/v1/warmup/actions/", {"action": "resume"}).json()["warmup"]
        check("resume", resumed["status"] == "WARMING")

        # ---- the Set-Up step and stopping
        steps = api("get", "/api/v1/workspace/setup/").json()["steps"]
        step = next(s for s in steps if s["key"] == "warmup")
        check("Set-Up shows the warm-up's day", step["state"] == "todo" and step["tag"].startswith("Day ") and step["links"][0]["to"] == "/settings/delivery-warmup", step)
        held_before = sql("SELECT count(*) FROM mailer_execution WHERE tenant_id = %s AND send_after = 'infinity'", [tenant], True)[0][0]
        stopped = api("post", "/api/v1/warmup/actions/", {"action": "stop"}).json()["warmup"]
        held_after = sql("SELECT count(*) FROM mailer_execution WHERE tenant_id = %s AND send_after = 'infinity'", [tenant], True)[0][0]
        check("stop: the warm-up ends and nothing waits for it any more", stopped["status"] == "STOPPED" and held_after == 0, (held_before, held_after))
        check("Set-Up counts a stopped warm-up as done", next(s for s in api("get", "/api/v1/workspace/setup/").json()["steps"] if s["key"] == "warmup")["state"] == "done")
    check.done()
