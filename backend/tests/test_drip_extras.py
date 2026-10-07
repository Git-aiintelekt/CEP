"""Phase B4b: the small backend additions the drip screens needed. The series time saved on its own, a text excerpt per
message, consume_source for a preset's throwaway Draft, stopped-early sends counted as not sent, who paused and when, text
figures per message, the skipped list of a run, the calendar's drip sends, Home's drip problems and clone with a name.
Postal is mocked at the HTTP layer and texts go to the sandbox (the `world` fixture, tests/conftest.py); everything is rolled back."""
import uuid
from datetime import timedelta
from unittest import mock

import pytest
from django.db import connections
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.campaigns.models import Campaign, CampaignRun
from apps.delivery import engine
from apps.delivery.engine import runs
from apps.templates.models import TemplateMaster

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]

LONG = "Hi {{first_name}}, earn points 3 ways this month: shop, review and refer a friend. " * 4 + "Reply STOP to unsubscribe."


def _email_drip(world, name, days=(0, 3, 7), names=("Welcome", "Tips", "Reminder"), lists=None, start_days=3):
    body = world.template(f"{name} email", "EMAIL", subject="Hi", html="<p>Hi</p>")
    return world.drip(name, "EMAIL", [(day, body, {"name": label}) for day, label in zip(days, names)], lists=lists or [world.three],
                      start=world.start(days=start_days, hour=9, minute=0), series_time="09:00")


def _text_drip(world, name, channel="SMS", count=2, start_days=3):
    body = world.template(f"{name} text", channel, body=LONG, **({"media": f"{name}.png"} if channel == "MMS" else {}))
    return world.drip(name, channel, [(day * 3, body, {"name": f"Text {day + 1}"}) for day in range(count)], lists=[world.three],
                      start=world.start(days=start_days, hour=9, minute=0), series_time="09:00")


def _steps(world, cid):
    return world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()


def _post(world, cid, action, body=None):
    with mock.patch("api.v1.views._enqueue_run"):
        return world.api("post", f"/api/v1/campaigns/{cid}/{action}/", body)


def _stop_half_way(world, cid):
    """Message 1 sent; message 2's audience queued, then paused and stopped: what it queued never goes. -> message 2's run."""
    world.send(cid, 0)
    second = world.run_of(cid, 3)
    world.sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [str(second.pk)])
    with mock.patch.object(runs, "quiet_until", return_value=None), engine.session.tenant_scope(world.tenant):
        runs.start(world.tenant, str(second.pk))
    _post(world, cid, "pause")
    _post(world, cid, "stop")
    return second


# ------------------------------------------------------------------------------------------------ 1. series time alone
def test_the_series_time_saves_on_its_own_and_the_messages_stay(world, check):
    cid = _email_drip(world, "ZX series time")
    before = [(row["id"], row["day"], row["name"], row["template"]["id"]) for row in _steps(world, cid)]
    version = world.api("get", f"/api/v1/campaigns/{cid}/").json()["row_version"]
    saved = world.api("patch", f"/api/v1/campaigns/{cid}/", {"drip_config": {"time": "18:30"}, "row_version": version})
    after = [(row["id"], row["day"], row["name"], row["template"]["id"]) for row in _steps(world, cid)]
    config = Campaign.objects.get(pk=cid).drip_config
    check("a drip_config with only the time is accepted", saved.status_code == 200, saved.content[:200])
    check("the time is stored and the steps mirror is the rows', unchanged", config["time"] == "18:30" and [step["day"] for step in config["steps"]] == [0, 3, 7], config)
    check("every message is the same: id, day, name and template copy", before == after, (before, after))
    check("their send time follows the series time", {row["effective_send_time"] for row in _steps(world, cid)} == {"18:30"})
    version = saved.json()["row_version"]
    bad = world.api("patch", f"/api/v1/campaigns/{cid}/", {"drip_config": {"time": "25:00"}, "row_version": version})
    extra = world.api("patch", f"/api/v1/campaigns/{cid}/", {"drip_config": {"time": "09:00", "weekdays": ["MO"]}, "row_version": version})
    check("an invalid time is refused", bad.status_code == 400 and "HH:MM" in str(bad.json()), bad.content[:200])
    check("anything but the time is refused: the messages are set on their steps", extra.status_code == 400, extra.content[:200])
    check.done()


# ------------------------------------------------------------------------------------------------ 2. text excerpt
def test_a_text_excerpt_per_message_without_a_query_each(world, check):
    sms = _text_drip(world, "ZX excerpt sms", count=2)
    mms = _text_drip(world, "ZX excerpt mms", channel="MMS", count=2)
    email = _email_drip(world, "ZX excerpt email")
    rows = _steps(world, sms)
    check("SMS: the first 140 characters, tags as written", rows[0]["text_excerpt"] == LONG.strip()[:140] and "{{first_name}}" in rows[0]["text_excerpt"], rows[0]["text_excerpt"])
    check("MMS too", _steps(world, mms)[1]["text_excerpt"] == LONG.strip()[:140])
    check("email: null", {row["text_excerpt"] for row in _steps(world, email)} == {None})
    many = _text_drip(world, "ZX excerpt many", count=5)
    with CaptureQueriesContext(connections["default"]) as two:
        world.api("get", f"/api/v1/campaigns/{sms}/steps/")
    with CaptureQueriesContext(connections["default"]) as five:
        world.api("get", f"/api/v1/campaigns/{many}/steps/")
    check("the same number of queries for two messages as for five", len(two) == len(five), (len(two), len(five)))
    check.done()


# ------------------------------------------------------------------------------------------------ 3. consume_source
def _draft(world, name, html=True):
    made = world.api("post", "/api/v1/templates/", {"name": name, "channel": "EMAIL"}).json()["id"]
    if html:
        world.sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 1, 'Hi', %s, 'Hi')",
                  [made, "<p>Hi</p>" + world.unsubscribe])
    return made


def test_consume_source_removes_only_an_unused_draft_of_your_own(world, check):
    cid = _email_drip(world, "ZX consume")
    gone = _draft(world, "ZX preset copy")
    added = world.api("post", f"/api/v1/campaigns/{cid}/steps/", {"start_from": "template", "template": gone, "day": 12, "consume_source": True})
    check("the message is added, with its own copy", added.status_code == 201 and added.json()["template"]["id"] != gone, added.content[:200])
    check("the preset's Draft is soft-deleted", TemplateMaster.objects.get(pk=gone).deleted_at is not None)

    used = _draft(world, "ZX used draft")
    world.api("post", "/api/v1/campaigns/", {"name": "ZX uses it", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": used})
    active = _draft(world, "ZX active one")
    world.sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [active])
    theirs = _draft(world, "ZX someone else's")
    other = world.sql("SELECT id FROM app_user WHERE tenant_id = %s AND email <> (SELECT email FROM app_user WHERE id = (SELECT created_by FROM template_master WHERE id = %s)) LIMIT 1",
                      [world.tenant, theirs], True)
    if other:
        world.sql("UPDATE template_master SET created_by = %s WHERE id = %s", [other[0][0], theirs])
    for day, template in ((15, used), (18, active), (21, theirs)):
        world.api("post", f"/api/v1/campaigns/{cid}/steps/", {"start_from": "template", "template": template, "day": day, "consume_source": True})
    check("a Draft a campaign uses is kept", TemplateMaster.objects.get(pk=used).deleted_at is None)
    check("an ACTIVE template is kept", TemplateMaster.objects.get(pk=active).deleted_at is None)
    check("someone else's Draft is kept", not other or TemplateMaster.objects.get(pk=theirs).deleted_at is None, bool(other))

    swap = _draft(world, "ZX swapped in")
    step = _steps(world, cid)[0]
    changed = world.api("patch", f"/api/v1/campaigns/{cid}/steps/{step['id']}/", {"template": swap, "consume_source": True, "row_version": step["row_version"]})
    check("changing a message's template can consume its source too", changed.status_code == 200 and TemplateMaster.objects.get(pk=swap).deleted_at is not None, changed.content[:200])
    plain = _draft(world, "ZX not consumed")
    world.api("post", f"/api/v1/campaigns/{cid}/steps/", {"start_from": "template", "template": plain, "day": 24})
    check("without consume_source the source stays", TemplateMaster.objects.get(pk=plain).deleted_at is None)
    check.done()


# ------------------------------------------------------------------------------------------------ 4. stopped early = not sent
def test_stopped_early_sends_count_as_not_sent(world, check):
    cid = _email_drip(world, "ZX not sent")
    world.publish(cid)
    second = _stop_half_way(world, cid)
    rows = world.sql("SELECT status, not_sent_reason, count(*) FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s GROUP BY 1, 2",
                     [world.tenant, str(second.pk)], True)
    check("the unsent rows keep FAILED and carry STOPPED_EARLY", rows == [("FAILED", "STOPPED_EARLY", 3)], rows)
    with engine.session.tenant_scope(world.tenant):
        figures = runs.stats(world.tenant, str(second.pk))["messages"]
    check("run stats: not_sent 3, failed 0, sent 0", figures["not_sent"] == 3 and figures["failed"] == 0 and figures["sent"] == 0, figures)
    block = _steps(world, cid)[1]["run"]
    check("the steps run block says not_sent too", block["not_sent"] == 3 and block["sent"] == 0, block)
    metrics = world.api("get", f"/api/v1/campaigns/{cid}/metrics/").json()["counts"]
    check("the campaign's totals: not_sent, not failed", metrics["not_sent"] == 3 and metrics["failed"] == 0, metrics)
    listed = world.api("get", f"/api/v1/campaign-runs/{second.pk}/recipients/").json()
    not_sent = world.api("get", f"/api/v1/campaign-runs/{second.pk}/recipients/?status=NOT_SENT").json()
    failed = world.api("get", f"/api/v1/campaign-runs/{second.pk}/recipients/?status=FAILED").json()
    check("recipients carry the reason code", {row["not_sent_reason"] for row in listed["results"]} == {"STOPPED_EARLY"}, listed["results"][:1])
    check("the NOT_SENT filter finds them and FAILED leaves them out", not_sent["count"] == 3 and failed["count"] == 0 and "NOT_SENT" in listed["statuses"],
          (not_sent["count"], failed["count"]))
    check("by_status says NOT_SENT", listed["by_status"].get("NOT_SENT") == 3 and "FAILED" not in listed["by_status"], listed["by_status"])
    check.done()


def test_old_stopped_rows_are_backfilled(world, check):
    cid = _email_drip(world, "ZX backfill")
    world.publish(cid)
    second = _stop_half_way(world, cid)
    world.sql("UPDATE mailer_execution SET not_sent_reason = NULL WHERE tenant_id = %s AND campaign_run_id = %s", [world.tenant, str(second.pk)])
    world.sql("""UPDATE mailer_execution SET not_sent_reason = 'STOPPED_EARLY'
                  WHERE not_sent_reason IS NULL AND status = 'FAILED' AND status_reason = 'Not sent: the drip was stopped early.'""")    # patch 0044's backfill
    rows = world.sql("SELECT DISTINCT not_sent_reason FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s", [world.tenant, str(second.pk)], True)
    check("rows written with the old text get the code", rows == [("STOPPED_EARLY",)], rows)
    check.done()


# ------------------------------------------------------------------------------------------------ 5. who paused
def test_who_paused_and_when_for_a_drip_and_a_regular_campaign(world, check):
    cid = _email_drip(world, "ZX paused")
    world.publish(cid)
    world.send(cid, 0)
    paused = _post(world, cid, "pause").json()
    check("pause records when and by whom", paused["paused"] and paused["paused"]["at"] and paused["paused"]["by_name"], paused.get("paused"))
    resumed = _post(world, cid, "resume").json()
    check("resume clears it", resumed["paused"] is None and Campaign.objects.get(pk=cid).paused_at is None, resumed.get("paused"))
    _post(world, cid, "pause")
    stopped = _post(world, cid, "stop").json()
    check("stop clears it", stopped["paused"] is None and Campaign.objects.get(pk=cid).paused_by_id is None)
    regular = world.api("post", "/api/v1/campaigns/", {"name": "ZX regular pause", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL"}).json()["id"]
    world.sql("UPDATE campaign SET status = 'ACTIVE' WHERE id = %s", [regular])
    paused_regular = _post(world, regular, "pause").json()
    check("a regular campaign records it too", paused_regular["status"] == "PAUSED" and paused_regular["paused"]["by_name"], paused_regular.get("paused"))
    check.done()


# ------------------------------------------------------------------------------------------------ 6. text figures
def test_replies_and_opt_outs_on_a_text_message(world, check):
    cid = _text_drip(world, "ZX replies")
    world.publish(cid)
    run = world.send(cid, 0)
    ids = [row[0] for row in world.sql("SELECT id FROM sms_execution WHERE tenant_id = %s AND campaign_run_id = %s ORDER BY id", [world.tenant, str(run.pk)], True)]
    world.sql("UPDATE sms_execution SET status = 'RESPONDED' WHERE id = %s", [ids[0]])
    world.sql("UPDATE sms_execution SET status = 'OPTED_OUT' WHERE id = %s", [ids[1]])
    block = _steps(world, cid)[0]["run"]
    check("the SMS step's run has replied (both answers) and opted_out", block["replied"] == 2 and block["opted_out"] == 1, block)
    email = _email_drip(world, "ZX email figures")
    world.publish(email)
    world.send(email, 0)
    check("email keeps today's fields", "replied" not in _steps(world, email)[0]["run"])
    check.done()


# ------------------------------------------------------------------------------------------------ 7. skipped list
def test_the_people_a_run_skipped(world, check):
    cid = _email_drip(world, "ZX skipped", lists=[world.everyone])
    for party in world.people[:3]:
        world.sql("UPDATE consent_suppression SET consent_status = 'OPTED_OUT', marketable = FALSE WHERE tenant_id = %s AND party_id = %s AND channel = 'EMAIL'", [world.tenant, party])
    world.publish(cid)
    run = world.send(cid, 0)
    everyone = world.api("get", f"/api/v1/campaign-runs/{run.pk}/skipped/").json()
    reasons = set(everyone["by_reason"])
    check("the skipped people of the run, with reason and address", everyone["count"] == 3 and {row["party_id"] for row in everyone["results"]} == set(world.people[:3])
          and all(row["address"] and row["reason"] for row in everyone["results"]), everyone)
    reason = next(iter(reasons))
    filtered = world.api("get", f"/api/v1/campaign-runs/{run.pk}/skipped/?reason={reason}").json()
    nobody = world.api("get", f"/api/v1/campaign-runs/{run.pk}/skipped/?reason=FREQUENCY_CAP").json()
    found = world.api("get", f"/api/v1/campaign-runs/{run.pk}/skipped/?q={world.people[1]}").json()
    page = world.api("get", f"/api/v1/campaign-runs/{run.pk}/skipped/?page=2&page_size=2").json()
    check("filtered by reason", filtered["count"] == 3 and nobody["count"] == 0, (filtered["count"], nobody["count"]))
    check("searched by party", found["count"] == 1 and found["results"][0]["party_id"] == world.people[1], found)
    check("paged", page["count"] == 3 and len(page["results"]) == 1 and page["page"] == 2, page)
    missing = world.api("get", f"/api/v1/campaign-runs/{uuid.uuid4()}/skipped/")
    check("another workspace's or an unknown run: 404", missing.status_code == 404)
    check.done()


# ------------------------------------------------------------------------------------------------ 8. calendar
def test_the_calendar_names_a_drips_messages(world, check):
    cid = _email_drip(world, "ZX calendar", start_days=1)
    world.publish(cid)
    world.send(cid, 0)
    first = world.run_of(cid, 0).started_at.astimezone(world.ny).date()
    window = world.api("get", f"/api/v1/campaigns/calendar/?date_from={first}&date_to={first + timedelta(days=4)}").json()
    span = next(item for item in window["spans"] if item["campaign"] == cid)
    labels = [(send["position"], send["count"], send["name"]) for send in span["sends"]]
    check("each send names its message, counted over the whole drip although the range shows two", labels == [(1, 3, "Welcome"), (2, 3, "Tips")]
          and all(send["step_id"] for send in span["sends"]), span["sends"])
    _post(world, cid, "pause")
    paused = world.api("get", f"/api/v1/campaigns/calendar/?date_from={first}&date_to={first + timedelta(days=30)}").json()
    span = next(item for item in paused["spans"] if item["campaign"] == cid)
    check("paused: the waiting messages are on hold, not on a day", [(item["position"], item["name"], item["state"]) for item in span.get("on_hold", [])]
          == [(2, "Tips", "ON_HOLD"), (3, "Reminder", "ON_HOLD")] and [send["position"] for send in span["sends"]] == [1], span)
    check.done()


# ------------------------------------------------------------------------------------------------ 9. Home
def test_home_lists_drip_problems(world, check):
    failed = _email_drip(world, "ZX home failed")
    world.publish(failed)
    copy = _steps(world, failed)[0]["template"]["id"]
    world.sql("DELETE FROM rendered_template_content WHERE template_id = %s", [copy])         # message 1 can't start: nobody gets it
    run = world.send(failed, 0)
    _post(world, failed, "pause")
    long = _email_drip(world, "ZX home paused long")
    short = _email_drip(world, "ZX home paused short")
    for cid, days in ((long, 3), (short, 2)):
        world.publish(cid)
        world.send(cid, 0)
        _post(world, cid, "pause")
        world.sql("UPDATE campaign SET paused_at = now() - make_interval(days => %s, mins => 5) WHERE id = %s", [days, cid])
    before = world.api("get", "/api/v1/home/overview/").json()["attention"]
    problems = before["drip_problems"]
    mine = [item for item in problems if item["campaign_id"] in (failed, long, short)]
    kinds = {(item["kind"], item["campaign_id"]) for item in mine}
    check("a failed message nobody got is listed, though the drip is paused", ("MESSAGE_FAILED", failed) in kinds and run.status == "FAILED", (run.status, mine))
    failed_row = next(item for item in mine if item["kind"] == "MESSAGE_FAILED")
    check("with its position, name and when", failed_row["position"] == 1 and failed_row["message_name"] == "Welcome" and failed_row["failed_at"], failed_row)
    check("paused 3 days: listed with who and what waits; 2 days: not", ("PAUSED_LONG", long) in kinds and ("PAUSED_LONG", short) not in kinds, kinds)
    long_row = next(item for item in mine if item["kind"] == "PAUSED_LONG")
    check("the waiting message", long_row["next"] and long_row["next"]["position"] == 2 and long_row["next"]["name"] == "Tips" and long_row["paused_by_name"], long_row)
    check("failed_ids and the rest are as they were", {"failed_ids", "awaiting_publish", "awaiting_approval"} <= set(before) and isinstance(before["failed_ids"], list))
    check.done()


# ------------------------------------------------------------------------------------------------ 10. clone with a name
def test_clone_with_a_name(world, check):
    cid = _email_drip(world, "ZX clone source")
    named = _post(world, cid, "clone", {"name": "ZX clone named"})
    taken = _post(world, cid, "clone", {"name": "ZX clone source"})
    plain = _post(world, cid, "clone")
    check("the copy takes the name given", named.status_code == 201 and named.json()["name"] == "ZX clone named", named.content[:200])
    check("a taken name is refused with the usual message", taken.status_code == 400 and "Another campaign already has this name." in str(taken.json()), taken.content[:200])
    check("without a name: Copy of …", plain.status_code == 201 and plain.json()["name"].startswith("Copy of"), plain.content[:200])
    check.done()
