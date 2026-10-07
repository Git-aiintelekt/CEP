"""Drip sending (patch 0042): each message's run sends its own template, subject, preheader, picture and A/B test, at its own
time, to the people of the first message's Campaign List under the governance of its own moment. Postal is mocked at the
HTTP layer, texts go through the sandbox engine; every change is rolled back (tests/conftest.py)."""
import json
from datetime import datetime, time, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

import pytest

from apps.campaigns import service
from apps.campaigns.models import Campaign, CampaignRun, CampaignRunVariant
from apps.delivery import engine
from apps.delivery.engine import runs

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]

NY = ZoneInfo("America/New_York")      # the drips' send_timezone (the `world` fixture, tests/conftest.py)


# ------------------------------------------------------------------------------------------------ planning
def test_planning_puts_each_message_on_its_day_and_time(world, check):
    body = world.template("ZS plan email", "EMAIL", subject="Hi", html="<p>Hi</p>")
    start = world.start()
    timed = world.drip("ZS timed", "EMAIL", [(0, body, {}), (2, body, {"send_time": "18:15"}), (5, body, {})], lists=[world.three], start=start, series_time="10:00")
    plain = world.drip("ZS start time", "EMAIL", [(0, body, {}), (4, body, {})], lists=[world.three], start=start)
    world.publish(timed)
    world.publish(plain)
    timed_runs = list(CampaignRun.objects.filter(campaign_id=timed, test_mode=False).order_by("run_number"))
    plain_runs = list(CampaignRun.objects.filter(campaign_id=plain, test_mode=False).order_by("run_number"))
    day = start.date()
    check("each message is planned on start date + day: its own time, else the series time, Day 0 included",
          [run.scheduled_at for run in timed_runs] == [datetime.combine(day, time(10, 0), tzinfo=NY), datetime.combine(day + timedelta(days=2), time(18, 15), tzinfo=NY),
                                                       datetime.combine(day + timedelta(days=5), time(10, 0), tzinfo=NY)],
          [run.scheduled_at.astimezone(NY) for run in timed_runs])
    check("without a series time every message goes at the start's own time of day",
          [run.scheduled_at for run in plain_runs] == [start, datetime.combine(day + timedelta(days=4), time(14, 30), tzinfo=NY)], [run.scheduled_at.astimezone(NY) for run in plain_runs])
    steps = world.api("get", f"/api/v1/campaigns/{timed}/steps/").json()
    check("every run carries its message, keeps its 'Day N' label, and scheduled_for in the API is the planned moment",
          [str(run.drip_step_id) for run in timed_runs] == [step["id"] for step in steps] and [run.sequence_label for run in timed_runs] == ["Day 0", "Day 2", "Day 5"]
          and [datetime.fromisoformat(step["scheduled_for"]) for step in steps] == [run.scheduled_at for run in timed_runs]
          and [step["run"]["scheduled_at"] is not None for step in steps] == [True] * 3, [step["scheduled_for"] for step in steps])
    campaign = Campaign.objects.select_related("tenant").get(pk=timed)
    again = service.create_runs(campaign)
    check("planning again plans nothing: a message that has its run is never re-planned",
          again == [] and CampaignRun.objects.filter(campaign_id=timed, test_mode=False).count() == 3
          and [run.scheduled_at for run in CampaignRun.objects.filter(campaign_id=timed, test_mode=False).order_by("run_number")] == [run.scheduled_at for run in timed_runs])
    now_drip = world.drip("ZS no start", "EMAIL", [(0, body, {}), (1, body, {})], lists=[world.three])
    planned = service.create_runs(Campaign.objects.select_related("tenant").get(pk=now_drip))     # publish needs a start date since B3; the planner still copes without one
    check("without a start date Day 0 is planned for now", planned[0].scheduled_at is None and planned[1].scheduled_at is not None)
    check.done()


# ------------------------------------------------------------------------------------------------ content
def test_each_email_message_sends_its_own_content(world, check):
    first = world.template("ZS first email", "EMAIL", subject="First subject", preheader="First preheader", html="<p>Body one</p>")
    second = world.template("ZS second email", "EMAIL", subject="Second subject", preheader="Second preheader", html="<p>Body two</p>")
    cid = world.drip("ZS content", "EMAIL", [(0, first, {}), (2, second, {"subject_line": "Own subject two", "preheader": "Own preheader two"})], lists=[world.three])
    world.sql("UPDATE campaign SET subject_line = 'CAMPAIGN SUBJECT', preheader = 'CAMPAIGN PREHEADER' WHERE id = %s", [cid])      # saved before B2: never used by a message
    world.publish(cid)
    world.send(cid, 0)
    one = list(world.posted)
    world.posted.clear()
    world.send(cid, 2)
    two = list(world.posted)
    check("message 1 sends its template's subject, preheader and body, not the campaign's override",
          len(one) == 3 and {item["subject"] for item in one} == {"First subject"} and all("First preheader" in item["html"] and "Body one" in item["html"] for item in one)
          and not any("CAMPAIGN" in item["subject"] + item["html"] for item in one), one[:1])
    check("message 2 sends its own template with its own subject and preheader",
          len(two) == 3 and {item["subject"] for item in two} == {"Own subject two"} and all("Own preheader two" in item["html"] and "Body two" in item["html"] for item in two)
          and not any("Body one" in item["html"] or "CAMPAIGN" in item["subject"] + item["html"] for item in two), two[:1])
    stored = world.sql("SELECT DISTINCT subject_line FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s", [world.tenant, str(world.run_of(cid, 2).pk)], True)
    check("the queued executions carry message 2's subject", stored == [("Own subject two",)], stored)
    check.done()


def test_text_messages_send_their_own_body_and_picture(world, check):
    one = world.template("ZS text one", "SMS", body="ZS: first text. Reply STOP to opt out.")
    two = world.template("ZS text two", "SMS", body="ZS: second text. Reply STOP to opt out.")
    cid = world.drip("ZS texts", "SMS", [(0, one, {}), (3, two, {})], lists=[world.three])
    world.publish(cid)
    world.send(cid, 0)
    world.send(cid, 3)
    texts = world.sql("SELECT r.sequence_label, x.rendered_text FROM sms_execution x JOIN campaign_run r ON r.id = x.campaign_run_id WHERE x.tenant_id = %s AND r.campaign_id = %s",
                      [world.tenant, cid], True)
    check("SMS: each message's run sends its own template's body",
          {label for label, text in texts if "first text" in text} == {"Day 0"} and {label for label, text in texts if "second text" in text} == {"Day 3"} and len(texts) == 6, texts)
    pic_one = world.template("ZS mms one", "MMS", body="ZS: look one. Reply STOP to opt out.", media="one.png")
    pic_two = world.template("ZS mms two", "MMS", body="ZS: look two. Reply STOP to opt out.", media="two.png")
    mid = world.drip("ZS pictures", "MMS", [(0, pic_one, {}), (2, pic_two, {})], lists=[world.three])
    world.publish(mid)
    world.send(mid, 0)
    world.send(mid, 2)
    media = world.sql("SELECT DISTINCT r.sequence_label, x.media_url, x.message_type FROM sms_execution x JOIN campaign_run r ON r.id = x.campaign_run_id WHERE x.tenant_id = %s AND r.campaign_id = %s ORDER BY 1",
                      [world.tenant, mid], True)
    check("MMS: message 2's run sends message 2's picture", media == [("Day 0", "https://cdn.zs.example/one.png", "MMS"), ("Day 2", "https://cdn.zs.example/two.png", "MMS")], media)
    check.done()


def test_a_message_without_content_fails_by_name(world, check):
    good = world.template("ZS good email", "EMAIL", subject="Hi", html="<p>Hi</p>")
    cid = world.drip("ZS empty second", "EMAIL", [(0, good, {}), (2, good, {"name": "How Points Work"})], lists=[world.three])
    world.publish(cid)
    copy = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()[1]["template"]["id"]
    world.sql("DELETE FROM rendered_template_content WHERE template_id = %s", [copy])
    world.send(cid, 0)
    failed = world.send(cid, 2)
    check("message 2's run fails, naming the message", failed.status == "FAILED"
          and "Message 2 (How Points Work) has no saved content." in world.activity(failed, "SEND_FAILED"), (failed.status, world.activity(failed, "SEND_FAILED")))
    check.done()


# ------------------------------------------------------------------------------------------------ the audience
def test_later_messages_go_to_message_one_audience_under_todays_governance(world, check):
    body = world.template("ZS audience email", "EMAIL", subject="Hi", html="<p>Hi</p>")
    cid = world.drip("ZS fixed audience", "EMAIL", [(0, body, {}), (2, body, {}), (4, body, {})], lists=[world.three])
    world.publish(cid)
    first = world.send(cid, 0)
    p1, p2, p3 = world.people[:3]
    world.add_member(world.three, "ZS-P04")                                                  # joins the list after Day 0
    world.sql("UPDATE consent_suppression SET consent_status = 'OPTED_OUT', marketable = FALSE WHERE tenant_id = %s AND party_id = %s AND channel = 'EMAIL'", [world.tenant, p2])
    blocked = world.make_list("ZS keep out", [p3])
    world.sql("INSERT INTO contact_list_campaign (campaign_id, contact_list_id, tenant_id, role) VALUES (%s, %s, %s, 'EXCLUDE')", [cid, blocked, world.tenant])
    policy = str(world.sql("""INSERT INTO communication_governance_policy (tenant_id, name, scope, max_messages, period_days, applies_to, priority)
                              VALUES (%s, 'ZS one a day', 'GLOBAL', 1, 1, 'MARKETING', 1) RETURNING id""", [world.tenant], True)[0][0])
    second = world.send(cid, 2)
    check("message 1 went to the contact list's three people", world.members(first) == {p1: "ELIGIBLE", p2: "ELIGIBLE", p3: "ELIGIBLE"}, world.members(first))
    check("message 2: only message 1's people; the unsubscribe, the exclusion list added later and the frequency limit apply at its own send",
          world.members(second) == {p1: "FREQUENCY_CAP", p2: "UNSUBSCRIBED", p3: "EXCLUDED_LIST"}, world.members(second))
    check("the run says where its audience came from",
          any("Built from message 1's audience (3 people); 3 left out by governance." in line for line in world.activity(second)), world.activity(second))
    world.sql("UPDATE communication_governance_policy SET is_active = FALSE WHERE id = %s", [policy])
    third = world.send(cid, 4)
    check("someone held back by a frequency limit on message 2 is still a candidate for message 3; the latecomer never is",
          world.members(third) == {p1: "ELIGIBLE", p2: "UNSUBSCRIBED", p3: "EXCLUDED_LIST"}, world.members(third))
    check.done()


def test_when_message_one_built_no_list_the_next_one_becomes_the_base(world, check):
    body = world.template("ZS base email", "EMAIL", subject="Hi", html="<p>Hi</p>")
    cid = world.drip("ZS lost first", "EMAIL", [(0, body, {}), (2, body, {}), (4, body, {})], lists=[world.three])
    world.publish(cid)
    copy = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()[0]["template"]["id"]
    world.sql("DELETE FROM rendered_template_content WHERE template_id = %s", [copy])         # message 1 fails before it builds a list
    first = world.send(cid, 0)
    world.add_member(world.three, "ZS-P04")
    second = world.send(cid, 2)
    world.add_member(world.three, "ZS-P05")
    third = world.send(cid, 4)
    check("message 1 failed without a list", first.status == "FAILED" and not world.members(first))
    check("message 2 builds from the contact lists as they are now", set(world.members(second)) == {*world.people[:3], "ZS-P04"}
          and not any("Built from" in line for line in world.activity(second)), world.members(second))
    check("message 3 builds from message 2's list: the later newcomer gets nothing", set(world.members(third)) == {*world.people[:3], "ZS-P04"}
          and any("Built from message 2's audience (4 people)" in line for line in world.activity(third)), (world.members(third), world.activity(third)))
    check.done()


# ------------------------------------------------------------------------------------------------ A/B
def test_only_the_tested_message_splits(world, check):
    body = world.template("ZS ab email", "EMAIL", subject="Plain subject", html="<p>Hi</p>")
    test = {"enabled": True, "subject_b": "Subject B", "sample_pct": 20, "metric": "OPEN_RATE", "decide_after_minutes": 60}
    cid = world.drip("ZS ab drip", "EMAIL", [(0, body, {}), (2, body, {"subject_line": "Subject A", "ab_config": test})], lists=[world.everyone])
    world.sql("UPDATE campaign SET ab_config = %s::jsonb WHERE id = %s", [json.dumps({**test, "subject_b": "CAMPAIGN B"}), cid])      # ignored on a drip
    world.publish(cid)
    first = world.send(cid, 0)
    second = world.send(cid, 2)
    variants = {v.variant_key: v.subject_line for v in CampaignRunVariant.objects.filter(campaign_run=second)}
    check("message 1 (no test of its own) does not split, whatever the campaign says",
          not CampaignRunVariant.objects.filter(campaign_run=first).exists() and first.ab_decide_at is None
          and world.sql("SELECT count(*) FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s AND variant_key IS NOT NULL", [world.tenant, str(first.pk)], True)[0][0] == 0)
    check("message 2 splits on its own subjects", variants == {"A": "Subject A", "B": "Subject B"} and second.ab_decide_at is not None, variants)
    chosen = world.api("post", f"/api/v1/campaigns/{cid}/runs/{second.pk}/choose-winner/", {"variant": "B"})
    check("a person can choose the winner of a drip message's test", chosen.status_code == 200 and chosen.json()["winner"] == "B", chosen.content[:200])
    check.done()


# ------------------------------------------------------------------------------------------------ preview
def test_preview_shows_one_message(world, check):
    first = world.template("ZS preview one", "EMAIL", subject="Preview one", html="<p>One</p>")
    second = world.template("ZS preview two", "EMAIL", subject="Preview two", html="<p>Two</p>")
    cid = world.drip("ZS preview", "EMAIL", [(0, first, {}), (3, second, {"subject_line": "Own two", "preheader": "Pre two"})], lists=[world.three])
    steps = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()
    default = world.api("get", f"/api/v1/campaigns/{cid}/preview/").json()
    chosen = world.api("get", f"/api/v1/campaigns/{cid}/preview/?step={steps[1]['id']}&party_id=ZS-P01").json()
    missing = world.api("get", f"/api/v1/campaigns/{cid}/preview/?step=00000000-0000-4000-8000-000000000000")
    check("without step a drip previews its first message", default["subject"] == "Preview one" and "One" in default["html"] and default["step"] == steps[0]["id"], default.get("subject"))
    check("?step= previews that message: its template, its subject and preheader, as a customer", chosen["subject"] == "Own two" and chosen["preheader"] == "Pre two"
          and "Two" in chosen["html"] and chosen["template_id"] == steps[1]["template"]["id"] and chosen["customer"] == "ZS-P01", chosen.get("subject"))
    check("an unknown message is 404", missing.status_code == 404)
    check.done()


# ------------------------------------------------------------------------------------------------ results per message
def test_steps_show_each_message_run_and_results(world, check):
    body = world.template("ZS results email", "EMAIL", subject="Hi", html="<p>Hi</p>")
    world.sql("INSERT INTO customer_master (party_id, tenant_id, first_name, emails) VALUES ('ZS-NOC', %s, 'No', %s::jsonb)",
              [world.tenant, json.dumps([{"address": "noc@zs.example", "is_primary": True}])])
    world.add_member(world.three, "ZS-NOC")                                                   # no consent: skipped
    cid = world.drip("ZS results", "EMAIL", [(0, body, {}), (2, body, {})], lists=[world.three])
    draft = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()
    world.publish(cid)
    run = world.send(cid, 0)
    rows = world.sql("SELECT id, party_id FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s ORDER BY party_id", [world.tenant, str(run.pk)], True)
    world.sql("UPDATE mailer_execution SET status = 'CLICKED' WHERE tenant_id = %s AND id = %s", [world.tenant, rows[0][0]])
    world.sql("UPDATE mailer_execution SET status = 'OPENED' WHERE tenant_id = %s AND id = %s", [world.tenant, rows[1][0]])
    world.sql("UPDATE mailer_execution SET status = 'DELIVERED' WHERE tenant_id = %s AND id = %s", [world.tenant, rows[2][0]])
    world.sql("""INSERT INTO consent_record (tenant_id, party_id, channel, action, source, campaign_id, campaign_run_id, occurred_at)
                 VALUES (%s, %s, 'EMAIL', 'OPT_OUT', 'UNSUBSCRIBE_LINK', %s, %s, now())""", [world.tenant, rows[2][1], cid, str(run.pk)])
    steps = world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()
    block = steps[0]["run"]
    check("before publishing no message has a run", [step["run"] for step in draft] == [None, None])
    check("a sent message: its run with counts, rates to one decimal and the people skipped by reason",
          block["id"] == str(run.pk) and block["status"] == "COMPLETED" and (block["sent"], block["delivered"], block["opened"], block["clicked"], block["unsubscribed"]) == (3, 3, 2, 1, 1)
          and (block["open_rate"], block["click_rate"], block["unsubscribe_rate"]) == (66.7, 33.3, 33.3)
          and block["skipped"] == {"total": 1, "by_reason": [{"reason": "NO_CONSENT", "count": 1}]} and block["ab"] is None, block)
    check("a message still waiting: its planned run, nothing counted yet", steps[1]["run"]["status"] == "SCHEDULED" and steps[1]["run"]["sent"] == 0
          and steps[1]["run"]["skipped"] == {"total": 0, "by_reason": []}, steps[1]["run"])
    check.done()


# ------------------------------------------------------------------------------------------------ the two B1 fixes
def test_renaming_renumbers_and_campaign_level_content_is_refused(world, check):
    body = world.template("ZS rename email", "EMAIL", subject="Hi", html="<p>Hi</p>")
    cid = world.drip("ZS old name", "EMAIL", [(0, body, {}), (2, body, {})], lists=[world.three])
    renamed = world.api("patch", f"/api/v1/campaigns/{cid}/", {"name": "ZS new name"})
    names = [step["template"]["name"] for step in world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()]
    check("renaming a draft drip renames its copies", renamed.status_code == 200 and names == ["ZS new name · 1 of 2", "ZS new name · 2 of 2"], names)
    refused = [world.api("patch", f"/api/v1/campaigns/{cid}/", {"subject_line": "Hello"}), world.api("patch", f"/api/v1/campaigns/{cid}/", {"preheader": "Hello"}),
               world.api("patch", f"/api/v1/campaigns/{cid}/", {"ab_config": {"enabled": True, "subject_b": "B"}})]
    accepted = world.api("patch", f"/api/v1/campaigns/{cid}/", {"subject_line": None, "preheader": "", "ab_config": None, "description": "saved with the whole form"})
    check("subject line, preheader and A/B on the campaign are refused on a drip; empty values are accepted",
          [r.status_code for r in refused] == [400] * 3
          and [next(iter(r.json()["errors"].values()))[0] for r in refused] == ["On a drip, set this on each message."] * 3 and accepted.status_code == 200,
          [(r.status_code, r.json().get("errors")) for r in refused] + [accepted.status_code])
    check.done()


# ------------------------------------------------------------------------------------------------ everything else unchanged
def test_a_regular_campaign_still_sends_as_before(world, check):
    body = world.template("ZS regular email", "EMAIL", subject="Template subject", preheader="Template preheader", html="<p>Regular</p>")
    made = world.api("post", "/api/v1/campaigns/", {"name": "ZS regular", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": body,
                                                    "sender_profile": world.email_sender,
                                                    "contact_lists": [world.everyone], "subject_line": "Campaign subject", "preheader": "Campaign preheader",
                                                    "ab_config": {"enabled": True, "subject_b": "Campaign B", "sample_pct": 20, "metric": "OPEN_RATE", "decide_after_minutes": 60}}).json()
    world.publish(made["id"])
    run = CampaignRun.objects.get(campaign_id=made["id"], test_mode=False)
    world.sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [str(run.pk)])
    with mock.patch.object(runs, "quiet_until", return_value=None):
        engine.process_run(world.tenant, str(run.pk))
    variants = {v.variant_key: v.subject_line for v in CampaignRunVariant.objects.filter(campaign_run=run)}
    sent = [item for item in world.posted if item["subject"] in ("Campaign subject", "Campaign B")]
    check("a regular campaign's run has no message, builds from its lists, uses the campaign's own subject and preheader and splits on its own test",
          run.drip_step_id is None and run.run_type == "ONE_TIME" and len(world.members(run)) == 22 and variants == {"A": "Campaign subject", "B": "Campaign B"}
          and sent and all("Campaign preheader" in item["html"] for item in sent), (variants, len(world.members(run)), world.posted[:1]))
    check.done()
