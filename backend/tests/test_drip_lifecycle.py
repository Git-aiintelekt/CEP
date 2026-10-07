"""A running drip (phase B4): status and actions, Stop Remaining Messages, Resume after missed days, Retry a failed message and
progress. Postal is mocked at the HTTP layer (the `world` fixture, tests/conftest.py); every change is rolled back."""
from datetime import datetime, time, timedelta
from unittest import mock

import pytest
from django.db import connections
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.campaigns import drip_lifecycle, service
from apps.campaigns.models import Campaign, CampaignActivityLog, CampaignRun
from apps.delivery import engine
from apps.delivery.engine import runs
from apps.identity.models import AppUser
from apps.templates.models import TemplateMaster

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def _drip(world, name, days=(0, 3, 7), names=("Welcome", "Tips", "Reminder"), start_days=3):
    body = world.template(f"{name} email", "EMAIL", subject="Hi", html="<p>Hi</p>")
    messages = [(day, body, {"name": label}) for day, label in zip(days, names)]
    return world.drip(name, "EMAIL", messages, lists=[world.three], start=world.start(days=start_days, hour=9, minute=0), series_time="09:00")


def _campaign(world, cid):
    return world.api("get", f"/api/v1/campaigns/{cid}/").json()


def _post(world, cid, action, body=None):
    with mock.patch("api.v1.views._enqueue_run"):
        return world.api("post", f"/api/v1/campaigns/{cid}/{action}/", body)


def _names(world, cid, status):
    return {row["id"] for row in world.api("get", f"/api/v1/campaigns/?status={status}&type=DRIP&page_size=200").json()["results"]}


def _fail_message(world, cid, position):
    """Message `position` can't start: its template has no saved content (restored by the caller when needed)."""
    copy = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()[position - 1]["template"]["id"]
    saved = world.sql("SELECT version_number, subject_line, html_content, text_content FROM rendered_template_content WHERE template_id = %s", [copy], True)
    world.sql("DELETE FROM rendered_template_content WHERE template_id = %s", [copy])
    return copy, saved


def _restore(world, copy, saved):
    for version, subject, html, text in saved:
        world.sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, %s, %s, %s, %s)",
                  [copy, version, subject, html, text])


# ------------------------------------------------------------------------------------------------ status and actions
def test_status_is_scheduled_until_a_message_starts_then_active(world, check):
    cid = _drip(world, "ZL status")
    world.publish(cid)
    before = _campaign(world, cid)
    world.send(cid, 0)
    after = _campaign(world, cid)
    check("before message 1: SCHEDULED, with Cancel Schedule, Clone and Archive",
          before["display_status"] == "SCHEDULED" and before["actions"] == ["cancel_schedule", "clone", "archive"], (before["display_status"], before["actions"]))
    check("after message 1: ACTIVE, with Pause, Stop Remaining Messages, Clone, Results and Archive",
          after["display_status"] == "ACTIVE" and after["actions"] == ["pause", "stop", "clone", "results", "archive"], (after["display_status"], after["actions"]))
    failed = _drip(world, "ZL failed first")
    world.publish(failed)
    _fail_message(world, failed, 1)
    world.send(failed, 0)
    stuck = _campaign(world, failed)
    check("a drip whose message 1 failed at its start (still production published, a later message waiting) shows ACTIVE, not SCHEDULED",
          stuck["status"] == "PRODUCTION_PUBLISHED" and stuck["display_status"] == "ACTIVE" and "cancel_schedule" not in stuck["actions"], (stuck["status"], stuck["display_status"]))
    check("the list's status filter agrees: started drips are under Active, never Scheduled",
          {cid, failed} <= _names(world, cid, "ACTIVE") and not {cid, failed} & _names(world, cid, "SCHEDULED")
          and not {cid, failed} & _names(world, cid, "PRODUCTION_PUBLISHED"))
    waiting = _drip(world, "ZL waiting")
    world.publish(waiting)
    check("an unstarted drip stays under Scheduled", waiting in _names(world, cid, "SCHEDULED") and waiting not in _names(world, cid, "ACTIVE"))
    check.done()


def test_actions_when_paused_completed_and_stopped(world, check):
    cid = _drip(world, "ZL actions")
    world.publish(cid)
    world.send(cid, 0)
    paused = _post(world, cid, "pause").json()
    check("paused: Resume, Stop Remaining Messages, Clone, Results, Archive", paused["display_status"] == "PAUSED"
          and paused["actions"] == ["resume", "stop", "clone", "results", "archive"], paused["actions"])
    stopped = _post(world, cid, "stop").json()
    check("stopped: COMPLETED, with Clone, Results and Archive", stopped["display_status"] == "COMPLETED" and stopped["actions"] == ["clone", "results", "archive"], stopped["actions"])
    done = _drip(world, "ZL done", days=(0, 2))
    world.publish(done)
    world.send(done, 0)
    world.send(done, 2)
    finished = _campaign(world, done)
    check("completed after its last message: Clone, Results and Archive", finished["display_status"] == "COMPLETED" and finished["actions"] == ["clone", "results", "archive"]
          and finished["stopped_early"] is None, (finished["display_status"], finished["actions"]))
    check.done()


def test_a_drip_that_has_sent_never_becomes_a_draft_again(world, check):
    failed = _drip(world, "ZL no draft")
    world.publish(failed)
    _fail_message(world, failed, 1)
    world.send(failed, 0)
    refused = _post(world, failed, "cancel-schedule")
    check("Cancel Schedule after message 1 started is refused, and the drip is not a draft",
          refused.status_code == 409 and refused.json()["detail"] == "Messages have already gone out. Stop the remaining messages instead."
          and Campaign.objects.get(pk=failed).status != "DRAFT", refused.content[:200])
    sent = _drip(world, "ZL sent first")
    world.publish(sent)
    world.send(sent, 0)
    campaign = Campaign.objects.prefetch_related("campaign_runs").get(pk=sent)
    try:
        service.cancel_schedule(campaign)
        raised = None
    except service.ActionError as exc:
        raised = str(exc)
    check("the service refuses too, whatever the status", raised == "Messages have already gone out. Stop the remaining messages instead.", raised)
    fresh = _drip(world, "ZL take back")
    world.publish(fresh)
    back = _post(world, fresh, "cancel-schedule")
    replanned = world.publish(fresh)
    live = CampaignRun.objects.filter(campaign_id=fresh, test_mode=False).exclude(status="CANCELLED")
    check("before any start Cancel Schedule still returns it to a draft, and publishing again plans every message again",
          back.status_code == 200 and back.json()["status"] == "DRAFT" and replanned.status_code == 201 and sorted(run.sequence_label for run in live) == ["Day 0", "Day 3", "Day 7"],
          (back.status_code, [run.sequence_label for run in live]))
    check.done()


# ------------------------------------------------------------------------------------------------ stop
def test_stop_from_active(world, check):
    cid = _drip(world, "ZL stop")
    world.publish(cid)
    world.send(cid, 0)
    copy = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()[1]["template"]["id"]
    locked = world.api("patch", f"/api/v1/templates/{copy}/", {"description": "while live"})
    stopped = _post(world, cid, "stop")
    body = stopped.json()
    admin = AppUser.objects.get(pk=Campaign.objects.get(pk=cid).stopped_by_id)
    name = admin.display_name or admin.email
    left = {run.sequence_label: run.status for run in CampaignRun.objects.filter(campaign_id=cid, test_mode=False)}
    log = CampaignActivityLog.objects.filter(campaign_id=cid, event_type="STOPPED_EARLY").values_list("message", flat=True).first()
    check("the waiting messages are cancelled, the drip COMPLETED with who and when", stopped.status_code == 200 and left == {"Day 0": "COMPLETED", "Day 3": "CANCELLED", "Day 7": "CANCELLED"}
          and body["status"] == "COMPLETED" and body["completed_at"] and body["stopped_at"], (left, body.get("status")))
    check("stopped_early: when, by whom, how many were cancelled", body["stopped_early"] == {"at": body["stopped_at"], "by_name": name, "cancelled": 2}, body["stopped_early"])
    check("the log names them", log == f"Stopped early by {name}. 2 messages were cancelled: message 2 (Tips), message 3 (Reminder).", log)
    unlocked = world.api("patch", f"/api/v1/templates/{copy}/", {"description": "after the stop"})
    check("its templates were locked while it ran, and are free once it stopped", locked.status_code == 409 and unlocked.status_code == 200)
    again = _post(world, cid, "stop")
    regular = world.api("post", "/api/v1/campaigns/", {"name": "ZL regular", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL"}).json()
    not_drip = _post(world, regular["id"], "stop")
    check("refused for a completed drip and for a campaign that isn't a drip", again.status_code == 409 and not_drip.status_code == 409
          and again.json()["detail"] == "Only a running or paused drip can be stopped." and not_drip.json()["detail"] == "Only a drip's remaining messages can be stopped.",
          (again.content[:120], not_drip.content[:120]))
    check.done()


def test_stop_from_paused_ends_a_send_half_way(world, check):
    cid = _drip(world, "ZL stop paused")
    world.publish(cid)
    world.send(cid, 0)
    second = world.run_of(cid, 3)
    world.sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [str(second.pk)])
    with mock.patch.object(runs, "quiet_until", return_value=None), engine.session.tenant_scope(world.tenant):
        runs.start(world.tenant, str(second.pk))                     # the audience is queued; nothing sent yet
    _post(world, cid, "pause")
    half = CampaignRun.objects.get(pk=second.pk).status
    stopped = _post(world, cid, "stop")
    world.posted.clear()
    with mock.patch.object(runs, "quiet_until", return_value=None):
        engine.process_run(world.tenant, str(second.pk))
    queued = world.sql("SELECT status, count(*) FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s GROUP BY 1", [world.tenant, str(second.pk)], True)
    check("a send paused part-way is cancelled where it is, and nothing it queued goes out afterwards",
          half == "PAUSED" and stopped.status_code == 200 and CampaignRun.objects.get(pk=second.pk).status == "CANCELLED" and world.posted == []
          and queued == [("FAILED", 3)] and world.run_of(cid, 7).status == "CANCELLED", (half, queued, len(world.posted)))
    reason = world.sql("SELECT DISTINCT status_reason FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s", [world.tenant, str(second.pk)], True)
    check("their reason says so", reason == [("Not sent: the drip was stopped early.",)], reason)
    check.done()


# ------------------------------------------------------------------------------------------------ resume
def _paused_series(world, name):
    """Four messages on days 0, 2, 4 and 6 at 09:00, message 1 sent, paused. -> (campaign id, start date)."""
    body = world.template(f"{name} email", "EMAIL", subject="Hi", html="<p>Hi</p>")
    start = world.start(days=1, hour=9, minute=0)
    cid = world.drip(name, "EMAIL", [(0, body, {"name": "Welcome"}), (2, body, {"name": "Tips"}), (4, body, {"name": "First Reward"}), (6, body, {"name": "Reminder"})],
                     lists=[world.three], start=start, series_time="09:00")
    world.publish(cid)
    world.send(cid, 0)
    _post(world, cid, "pause")
    return cid, start.date()


def _at(day, hour, world):
    return datetime.combine(day, time(hour, 0), tzinfo=world.ny)


def test_resume_plan_moves_missed_messages_and_pushes_later_ones(world, check):
    cid, day = _paused_series(world, "ZL resume")
    campaign = Campaign.objects.select_related("tenant").get(pk=cid)
    early = drip_lifecycle.resume_plan(campaign, now=_at(day + timedelta(days=3), 7, world))
    check("one missed message whose time today is still ahead goes later today; the next keeps its day",
          [(m["position"], m["will_send"]) for m in early["missed"]] == [(2, _at(day + timedelta(days=3), 9, world))] and not early["moved"]
          and [(m["position"], m["sends"]) for m in early["unchanged"]] == [(3, _at(day + timedelta(days=4), 9, world)), (4, _at(day + timedelta(days=6), 9, world))], early)
    late = drip_lifecycle.resume_plan(campaign, now=_at(day + timedelta(days=3), 10, world))
    check("today's time has passed: tomorrow, and the message due that day moves a day to stay a day after it; the last keeps its day",
          [(m["position"], m["will_send"]) for m in late["missed"]] == [(2, _at(day + timedelta(days=4), 9, world))]
          and [(m["position"], m["will_send"]) for m in late["moved"]] == [(3, _at(day + timedelta(days=5), 9, world))]
          and [(m["position"], m["sends"]) for m in late["unchanged"]] == [(4, _at(day + timedelta(days=6), 9, world))], late)
    two = drip_lifecycle.resume_plan(campaign, now=_at(day + timedelta(days=4), 10, world))
    check("two missed messages go one per day, in order; the one after them is pushed",
          [(m["position"], m["will_send"]) for m in two["missed"]] == [(2, _at(day + timedelta(days=5), 9, world)), (3, _at(day + timedelta(days=6), 9, world))]
          and [(m["position"], m["will_send"]) for m in two["moved"]] == [(4, _at(day + timedelta(days=7), 9, world))] and not two["unchanged"], two)
    check.done()


def test_resume_does_what_its_plan_says(world, check):
    cid, _ = _paused_series(world, "ZL resume real")
    tips, reward = world.run_of(cid, 2), world.run_of(cid, 4)
    world.sql("UPDATE campaign_run SET scheduled_at = now() - interval '2 days' WHERE id = %s", [str(tips.pk)])
    world.sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 day' WHERE id = %s", [str(reward.pk)])
    plan = world.api("get", f"/api/v1/campaigns/{cid}/resume-plan/").json()
    resumed = _post(world, cid, "resume")
    after = {run.sequence_label: run.scheduled_at for run in CampaignRun.objects.filter(campaign_id=cid, test_mode=False, status="SCHEDULED")}
    planned = {f"Day {(2, 4, 6)[item['position'] - 2]}": datetime.fromisoformat(item.get("will_send") or item.get("sends"))
               for item in plan["missed"] + plan["moved"] + plan["unchanged"]}
    check("resume moves every run exactly as the plan said", resumed.status_code == 200 and after == planned and len(plan["missed"]) == 2, (plan, after))
    check("nothing is left that the dispatcher would start on the spot (a SCHEDULED run whose time has passed)",
          not CampaignRun.objects.filter(campaign_id=cid, test_mode=False, status="SCHEDULED", scheduled_at__lte=timezone.now()).exists())
    log = CampaignActivityLog.objects.filter(campaign_id=cid, event_type="RESUMED").values_list("message", flat=True).first()
    check("the log says where each missed message went", log.startswith("Resumed. Message 2 (Tips), due ") and "Message 3 (First Reward), due " in log and " sends " in log, log)
    not_paused = world.api("get", f"/api/v1/campaigns/{cid}/resume-plan/")
    check("only a paused drip has a resume plan", not_paused.status_code == 409)
    check.done()


# ------------------------------------------------------------------------------------------------ retry
def test_retry_a_failed_message(world, check):
    cid = _drip(world, "ZL retry", days=(0, 3))
    world.publish(cid)
    world.send(cid, 0)
    copy, saved = _fail_message(world, cid, 2)
    failed = world.send(cid, 3)
    _restore(world, copy, saved)
    world.add_member(world.three, "ZS-P09")                          # joined after Day 0: not on message 1's list
    step = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()[1]
    retried = _post(world, cid, f"steps/{step['id']}/retry")
    run = CampaignRun.objects.get(pk=retried.json()["id"])
    # the whole test is one transaction, whose now() is its start: due a moment earlier, as world.send does for any run
    world.sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 second' WHERE id = %s", [str(run.pk)])
    with mock.patch.object(runs, "quiet_until", return_value=None):
        engine.process_run(world.tenant, str(run.pk))
    shown = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()[1]["run"]
    check("a failed message nobody got: a new run for it, now, labelled as a retry, on message 1's audience",
          failed.status == "FAILED" and retried.status_code == 201 and run.sequence_label == "Day 3 (retry)" and str(run.drip_step_id) == step["id"]
          and abs((run.scheduled_at - timezone.now()).total_seconds()) < 60 and set(world.members(run)) == set(world.people[:3]), (retried.content[:200], world.members(run)))
    check("the steps show the retry as the message's run", shown["id"] == str(run.pk) and shown["status"] == "COMPLETED" and shown["sent"] == 3, shown)
    check("the retry is logged", CampaignActivityLog.objects.filter(campaign_id=cid, event_type="MESSAGE_RETRIED", campaign_run_id=run.pk).exists())
    check.done()


def test_retry_rules(world, check):
    cid = _drip(world, "ZL retry last", days=(0, 3))
    world.publish(cid)
    world.send(cid, 0)
    world.refuse.append("Hi")                                       # the provider refuses every message of message 2
    world.send(cid, 3)
    world.refuse.clear()
    completed = Campaign.objects.get(pk=cid).status
    step = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()[1]
    retried = _post(world, cid, f"steps/{step['id']}/retry")
    check("a drip completed only because its last message failed goes back to ACTIVE with the retry",
          completed == "COMPLETED" and retried.status_code == 201 and Campaign.objects.get(pk=cid).status == "ACTIVE", (completed, retried.content[:200]))

    partly = _drip(world, "ZL partly sent", days=(0, 3))
    world.publish(partly)
    world.send(partly, 0)
    world.refuse.append("Hi")
    run = world.send(partly, 3)
    world.refuse.clear()
    world.sql("UPDATE mailer_execution SET status = 'SUBMITTED' WHERE id = (SELECT min(id) FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s)", [world.tenant, str(run.pk)])
    step = world.api("get", f"/api/v1/campaigns/{partly}/steps/").json()[1]
    refused = _post(world, partly, f"steps/{step['id']}/retry")
    check("refused when part of it went out", refused.status_code == 409 and refused.json()["detail"] == "Part of message 2 (Tips) went out, so it can't be retried.", refused.content[:200])

    stopped = _drip(world, "ZL stopped retry", days=(0, 3, 7))
    world.publish(stopped)
    world.send(stopped, 0)
    copy, _ = _fail_message(world, stopped, 2)
    world.send(stopped, 3)
    _post(world, stopped, "stop")
    step = world.api("get", f"/api/v1/campaigns/{stopped}/steps/").json()[1]
    after_stop = _post(world, stopped, f"steps/{step['id']}/retry")
    check("refused once the drip was stopped early", after_stop.status_code == 409 and after_stop.json()["detail"] == "The drip was stopped early. Clone it to send its messages again.",
          after_stop.content[:200])

    paused = _drip(world, "ZL paused retry", days=(0, 3, 7))
    world.publish(paused)
    world.send(paused, 0)
    copy, saved = _fail_message(world, paused, 2)
    world.send(paused, 3)
    _restore(world, copy, saved)
    _post(world, paused, "pause")
    step = world.api("get", f"/api/v1/campaigns/{paused}/steps/").json()[1]
    waiting = _post(world, paused, f"steps/{step['id']}/retry").json()
    world.sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 second' WHERE id = %s", [waiting["id"]])      # due, so only the pause holds it
    with mock.patch.object(runs, "quiet_until", return_value=None):
        engine.process_run(world.tenant, waiting["id"])
    check("a paused drip's retry waits", CampaignRun.objects.get(pk=waiting["id"]).status == "SCHEDULED" and Campaign.objects.get(pk=paused).status == "PAUSED")
    check.done()


# ------------------------------------------------------------------------------------------------ progress
def test_progress_and_no_query_per_drip_in_the_list(world, check):
    cid = _drip(world, "ZL progress", days=(0, 3, 7))
    world.publish(cid)
    world.send(cid, 0)
    _fail_message(world, cid, 2)
    world.send(cid, 3)
    progress = _campaign(world, cid)["drip_progress"]
    third = world.run_of(cid, 7)
    check("progress: one sent, one failed, the next one waiting", progress == {"total": 3, "sent": 1, "failed": 1, "cancelled": 0,
                                                                              "next": {"position": 3, "name": "Reminder", "scheduled_at": progress["next"]["scheduled_at"]}}
          and datetime.fromisoformat(progress["next"]["scheduled_at"]) == third.scheduled_at, progress)
    _post(world, cid, "stop")
    check("after a stop: cancelled, and nothing next", _campaign(world, cid)["drip_progress"] == {"total": 3, "sent": 1, "failed": 1, "cancelled": 1, "next": None})

    def listed():
        with CaptureQueriesContext(connections["default"]) as caught:
            answer = world.api("get", "/api/v1/campaigns/?type=DRIP&page_size=200")
        return answer, len(caught)
    first, few = listed()
    for number in range(3):
        extra = _drip(world, f"ZL more {number}")
        world.publish(extra)
    second, many = listed()
    check("the list costs the same number of queries for one more drip or three", first.status_code == 200 and second.status_code == 200
          and len(second.json()["results"]) == len(first.json()["results"]) + 3 and many == few, (few, many))
    check.done()


# ------------------------------------------------------------------------------------------------ everything else unchanged
def test_a_regular_campaign_keeps_its_statuses_and_actions(world, check):
    body = world.template("ZL regular", "EMAIL", subject="Hi", html="<p>Hi</p>")
    made = world.api("post", "/api/v1/campaigns/", {"name": "ZL regular campaign", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": body,
                                                    "sender_profile": world.email_sender, "contact_lists": [world.three], "send_type": "SCHEDULED",
                                                    "scheduled_at": (timezone.now() + timedelta(days=2)).isoformat()}).json()
    _post(world, made["id"], "publish")
    scheduled = _campaign(world, made["id"])
    taken_back = _post(world, made["id"], "cancel-schedule").json()
    check("scheduled: Cancel Schedule, Clone, Archive; cancelling makes it a draft", scheduled["display_status"] == "SCHEDULED"
          and scheduled["actions"] == ["cancel_schedule", "clone", "archive"] and taken_back["status"] == "DRAFT", (scheduled["actions"], taken_back["status"]))
    world.sql("UPDATE campaign SET status = 'ACTIVE' WHERE id = %s", [made["id"]])
    active = _campaign(world, made["id"])
    paused = _post(world, made["id"], "pause").json()
    resumed = _post(world, made["id"], "resume").json()
    check("active, paused and resumed as before, never offered Stop", active["actions"] == ["pause", "clone", "results", "archive"]
          and paused["actions"] == ["resume", "clone", "results", "archive"] and resumed["status"] == "ACTIVE" and resumed["drip_progress"] is None
          and resumed["stopped_early"] is None, (active["actions"], paused["actions"], resumed["status"]))
    check.done()
