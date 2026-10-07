"""Testing and publishing a drip (phase B3): test every message at once, know when a test is out of date, the drip's checklist
and publish rules, activating the drip's own template copies, and the review timeline. Postal is mocked at the HTTP layer,
texts go through the sandbox engine (the `world` fixture, tests/conftest.py); every change is rolled back."""
from datetime import timedelta
from unittest import mock

import pytest
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.campaigns import drip_publish
from apps.campaigns.models import Campaign, CampaignActivityLog, CampaignDripStep, CampaignRun
from apps.templates.models import TemplateMaster

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]

QA = "qa@zs.example"
AB = {"enabled": True, "subject_b": "Subject B", "sample_pct": 20, "metric": "OPEN_RATE", "decide_after_minutes": 60}


def _series(world, name="ZS series", start=True, **extra):
    """Three email messages on days 0, 2 and 5 at 09:00 New York; message 2 has an A/B subject test."""
    one = world.template(f"{name} one", "EMAIL", subject="First subject", html="<p>Body one</p>")
    two = world.template(f"{name} two", "EMAIL", subject="Second subject", html="<p>Body two</p>")
    three = world.template(f"{name} three", "EMAIL", subject="Third subject", html="<p>Body three</p>")
    return world.drip(name, "EMAIL", [(0, one, {"name": "Welcome"}), (2, two, {"subject_line": "Subject A", "ab_config": AB}), (5, three, {"name": "Reminder"})],
                      lists=[world.three], start=world.start(days=4, hour=9, minute=0) if start else None, series_time="09:00", **extra)


def _steps(world, cid):
    return world.api("get", f"/api/v1/campaigns/{cid}/steps/").json()


def _test_all(world, cid, to=(QA,)):
    return world.api("post", f"/api/v1/campaigns/{cid}/test-publish/", {"to": list(to)})


def _checklist(world, cid):
    return world.api("get", f"/api/v1/campaigns/{cid}/checklist/").json()


def _publish(world, cid):
    with mock.patch("api.v1.views._enqueue_run"):
        return world.api("post", f"/api/v1/campaigns/{cid}/publish/")


def _errors(response) -> dict:
    return {key: value if isinstance(value, str) else " ".join(value) for key, value in response.json().get("errors", {}).items()}


# ------------------------------------------------------------------------------------------------ test all
def test_test_all_sends_every_message_in_order_with_its_label(world, check):
    cid = _series(world)
    answer = _test_all(world, cid)
    body = answer.json()
    runs = list(CampaignRun.objects.filter(campaign_id=cid, test_mode=True).order_by("run_number"))
    steps = _steps(world, cid)
    subjects = [item["subject"] for item in world.posted]
    check("one test run per message, in day order, each on its message and labelled with its place",
          answer.status_code == 200 and [run.sequence_label for run in runs] == ["Test 1 of 3", "Test 2 of 3", "Test 3 of 3"]
          and [str(run.drip_step_id) for run in runs] == [step["id"] for step in steps] and {run.status for run in runs} == {"COMPLETED"}
          and [item["status"] for item in body["messages"]] == ["SENT"] * 3, [(run.sequence_label, run.status) for run in runs])
    check("each message's own content, with the subject prefix; the tested message sends both subjects",
          subjects == ["[Test 1 of 3 · would send Day 0] First subject", "[Test 2 of 3 · would send Day 2 · A] Subject A", "[Test 2 of 3 · would send Day 2 · B] Subject B",
                       "[Test 3 of 3 · would send Day 5] Third subject"]
          and ["Body one" in item["html"] for item in world.posted] == [True, False, False, False] and "Body three" in world.posted[3]["html"], subjects)
    first = world.start(days=4, hour=9, minute=0)
    banner = f"Test · Message 1 of 3 · Would send {first:%a} {first.day} {first:%b %Y}, 09:00 {first:%Z} to about 3 contacts"
    check("the body opens with the test banner: the message's place, when it would go and to about how many",
          banner in world.posted[0]["html"] and world.posted[0]["html"].index(banner) < world.posted[0]["html"].index("Body one")
          and world.posted[0]["text"].startswith(banner), world.posted[0]["html"][:400])
    check("every message counts as tested, the drip is test published, and the steps say SENT",
          CampaignDripStep.objects.filter(campaign_id=cid, tested_at__isnull=True).count() == 0 and body["status"] == "TEST_PUBLISHED"
          and [step["test"]["status"] for step in steps] == ["SENT"] * 3 and all(step["test"]["sent_at"] for step in steps), [step["test"] for step in steps])
    world.posted.clear()
    world.publish(cid)
    world.send(cid, 0)
    check("nothing of the test reaches a production send", world.posted and not any("[Test" in item["subject"] or "Test ·" in item["html"] for item in world.posted),
          world.posted[:1])
    check.done()


def test_banner_without_a_start_date_and_the_text_prefix(world, check):
    cid = _series(world, "ZS undated", start=False)
    _test_all(world, cid)
    check("without a start date the banner gives the day", "Test · Message 2 of 3 · Would send Day 2 after the start date" in world.posted[1]["html"], world.posted[1]["html"][:300])
    one = world.template("ZS text one", "SMS", body="ZS: hello. Reply STOP to opt out.")
    two = world.template("ZS text two", "SMS", body="ZS: points. Reply STOP to opt out.")
    tid = world.drip("ZS text series", "SMS", [(0, one, {}), (3, two, {})], lists=[world.three], start=world.start())
    answer = world.api("post", f"/api/v1/campaigns/{tid}/test-publish/", {"to": ["+14705550111"]}).json()
    texts = [item["results"][0]["text"] for item in answer["messages"]]
    check("texts carry the short prefix and their own body", texts == ["[Test 1/2 · Day 0] ZS: hello. Reply STOP to opt out.", "[Test 2/2 · Day 3] ZS: points. Reply STOP to opt out."],
          texts)
    check.done()


def test_one_message_failing_leaves_the_others_sent(world, check):
    cid = _series(world)
    world.refuse.append("Test 2 of 3")
    answer = _test_all(world, cid).json()
    steps = _steps(world, cid)
    failed = CampaignDripStep.objects.get(pk=steps[1]["id"])
    check("message 2 fails with the provider's error; messages 1 and 3 are sent",
          [item["status"] for item in answer["messages"]] == ["SENT", "FAILED", "SENT"] and [step["test"]["status"] for step in steps] == ["SENT", "FAILED", "SENT"]
          and steps[1]["test"]["error"] == f"{QA}: InvalidRecipient: The address is not valid" and failed.tested_at is None
          and CampaignRun.objects.get(pk=steps[1]["test"]["run_id"]).status == "FAILED", [step["test"] for step in steps])
    world.refuse.clear()
    world.posted.clear()
    resent = world.api("post", f"/api/v1/campaigns/{cid}/steps/{steps[1]['id']}/test/", {"to": [QA]})
    check("resending one message sends that one only, and it is SENT again",
          resent.status_code == 200 and [item["subject"][:22] for item in world.posted] == ["[Test 2 of 3 · would s"] * 2 and _steps(world, cid)[1]["test"]["status"] == "SENT",
          [item["subject"] for item in world.posted])
    check.done()


# ------------------------------------------------------------------------------------------------ out of date
def test_a_content_change_makes_the_test_out_of_date(world, check):
    cid = _series(world)
    _test_all(world, cid)
    steps = _steps(world, cid)
    world.api("patch", f"/api/v1/campaigns/{cid}/steps/{steps[0]['id']}/", {"subject_line": "A new subject"})
    copy = steps[1]["template"]["id"]
    saved = world.api("post", f"/api/v1/templates/{copy}/design/", {"editor_state": {}, "mjml_source": "<mjml><mj-body><mj-section><mj-column><mj-text>New {{unsubscribe_url}}</mj-text></mj-column></mj-section></mj-body></mjml>",
                                                                    "subject_line": "Second subject", "preheader": "", "base_version": 1})
    world.api("patch", f"/api/v1/campaigns/{cid}/steps/{steps[2]['id']}/", {"day": 6, "send_time": "11:00", "name": "Last call"})
    after = [step["test"]["status"] for step in _steps(world, cid)]
    check("a new subject and a saved template make their messages CHANGED; a new day, time or name does not",
          saved.status_code == 201 and after == ["CHANGED", "CHANGED", "SENT"], (saved.status_code, after))
    world.api("post", f"/api/v1/campaigns/{cid}/steps/{steps[0]['id']}/test/", {"to": [QA]})
    check("resending a changed message makes it SENT again", [step["test"]["status"] for step in _steps(world, cid)] == ["SENT", "CHANGED", "SENT"])
    check.done()


def test_a_content_edit_withdraws_the_approval(world, check):
    cid = _series(world)
    world.sql("UPDATE campaign SET approval_status = 'APPROVED' WHERE id = %s", [cid])
    step = _steps(world, cid)[0]
    world.api("patch", f"/api/v1/campaigns/{cid}/steps/{step['id']}/", {"preheader": "A new preheader"})
    check("the approval is withdrawn and the log says so", Campaign.objects.get(pk=cid).approval_status is None
          and CampaignActivityLog.objects.filter(campaign_id=cid, event_type="APPROVAL_WITHDRAWN").exists())
    world.sql("UPDATE campaign SET approval_status = 'APPROVED' WHERE id = %s", [cid])
    copy = _steps(world, cid)[1]["template"]["id"]
    world.api("post", f"/api/v1/templates/{copy}/design/", {"editor_state": {}, "mjml_source": "<mjml><mj-body><mj-section><mj-column><mj-text>x {{unsubscribe_url}}</mj-text></mj-column></mj-section></mj-body></mjml>",
                                                           "subject_line": "Second subject", "preheader": "", "base_version": 1})
    check("so does saving a message's template", Campaign.objects.get(pk=cid).approval_status is None)
    check.done()


# ------------------------------------------------------------------------------------------------ checklist and publish
def test_the_drip_checklist_and_publish_agree(world, check):
    plain = world.template("ZS no unsubscribe", "EMAIL", subject="Hi", html="<p>Hi</p>")
    world.sql("UPDATE rendered_template_content SET html_content = '<p>Hi</p>' WHERE template_id = %s", [plain])        # no unsubscribe link
    cid = world.drip("ZS not ready", "EMAIL", [(0, plain, {}), (3, plain, {"name": "Reminder"})], lists=[world.three])
    world.sql("UPDATE campaign_drip_step SET template_id = NULL, template_owned = FALSE WHERE campaign_id = %s AND day = 0", [cid])
    listed = _checklist(world, cid)
    items = {item["key"]: item for item in listed["items"]}
    check("not ready: every drip item with its problem, in order; the old template / series items are gone; the test item is required, not advisory",
          [item["key"] for item in listed["items"]] == ["messages_ready", "messages_content", "messages_tested", "start_date", "contact_lists", "sender_profile"]
          and listed["ready"] is False and items["messages_ready"]["label"] == "All 2 messages ready" and items["messages_ready"]["problem"] == "Message 1 needs a template."
          and items["messages_content"]["problem"] == "Message 2: Marketing email must contain the {{unsubscribe_url}} link."
          and items["messages_tested"]["problem"] == "Send the test to all 2 messages." and items["start_date"]["problem"] == "Choose a start date."
          and items["contact_lists"]["ok"] and items["sender_profile"]["ok"] and not any(item.get("advisory") for item in listed["items"]), listed["items"])
    refused = _publish(world, cid)
    check("publish refuses with exactly the checklist's problems", refused.status_code == 400 and _errors(refused) == listed["problems"], (_errors(refused), listed["problems"]))

    ready = _series(world, "ZS ready")
    _test_all(world, ready)
    good = _checklist(world, ready)
    check("ready: every item ok", good["ready"] is True and all(item["ok"] for item in good["items"]) and good["problems"] == {}, good["problems"])
    check("and publish goes through", _publish(world, ready).status_code == 201)
    check.done()


def test_publish_is_refused_for_each_drip_rule(world, check):
    cid = _series(world)
    untested = _publish(world, cid)
    _test_all(world, cid)
    step = _steps(world, cid)[1]
    world.api("patch", f"/api/v1/campaigns/{cid}/steps/{step['id']}/", {"subject_line": "Changed subject"})
    changed = _publish(world, cid)
    world.api("post", f"/api/v1/campaigns/{cid}/steps/{step['id']}/test/", {"to": [QA]})
    past = timezone.now() - timedelta(days=2)
    world.sql("UPDATE campaign SET scheduled_at = %s WHERE id = %s", [past, cid])
    passed = _publish(world, cid)
    world.sql("UPDATE campaign SET scheduled_at = NULL WHERE id = %s", [cid])
    undated = _publish(world, cid)
    world.sql("UPDATE campaign SET scheduled_at = now() + interval '1 hour', drip_config = drip_config - 'time' WHERE id = %s", [cid])
    world.sql("UPDATE campaign_drip_step SET send_time = NULL WHERE campaign_id = %s", [cid])
    soon = _checklist(world, cid)
    copy = _steps(world, cid)[2]["template"]["id"]
    world.sql("UPDATE rendered_template_content SET html_content = '<p>No link</p>' WHERE template_id = %s", [copy])
    unsendable = _publish(world, cid)
    day = past.astimezone(world.ny)
    check("refused: an untested drip, a message changed after its test, a start date that has passed, no start date, an unsendable template",
          [r.status_code for r in (untested, changed, passed, undated, unsendable)] == [400] * 5
          and _errors(untested)["messages_tested"] == "Send the test to all 3 messages."
          and _errors(changed)["messages_tested"] == "Message 2 changed after its test. Resend it."
          and _errors(passed)["start_date"] == f"The start date, {day:%a} {day.day} {day:%b}, has passed. Choose a new one."
          and _errors(undated)["start_date"] == "Choose a start date."
          and _errors(unsendable)["messages_content"] == "Message 3: Marketing email must contain the {{unsubscribe_url}} link.",
          [_errors(r) for r in (untested, changed, passed, undated, unsendable)])
    check("a start later today, whose first message is still ahead, is fine", "start_date" not in soon["problems"], soon["problems"])
    check("nothing was published along the way", Campaign.objects.get(pk=cid).status == "TEST_PUBLISHED" and not CampaignRun.objects.filter(campaign_id=cid, test_mode=False).exists())
    check.done()


def test_publish_activates_the_drips_own_copies(world, check):
    cid = _series(world)
    _test_all(world, cid)
    copies = [step["template"]["id"] for step in _steps(world, cid)]
    world.sql("UPDATE template_master SET status = 'DRAFT' WHERE id = ANY(%s::uuid[])", [copies])
    published = _publish(world, cid)
    check("the copies were drafts and the publish made them active", published.status_code == 201
          and set(TemplateMaster.objects.filter(pk__in=copies).values_list("status", flat=True)) == {"ACTIVE"})

    other = _series(world, "ZS bad copy")
    _test_all(world, other)
    copies = [step["template"]["id"] for step in _steps(world, other)]
    world.sql("UPDATE template_master SET status = 'DRAFT' WHERE id = ANY(%s::uuid[])", [copies])
    world.sql("UPDATE rendered_template_content SET subject_line = NULL WHERE template_id = %s", [copies[2]])      # the copy can't be activated
    refused = _publish(world, other)
    check("a copy that can't be activated is named, and nothing is published or activated",
          refused.status_code == 400 and _errors(refused).get("messages_content") == "Message 3: Add a subject line."
          and Campaign.objects.get(pk=other).status == "TEST_PUBLISHED" and set(TemplateMaster.objects.filter(pk__in=copies).values_list("status", flat=True)) == {"DRAFT"},
          _errors(refused))
    campaign = Campaign.objects.get(pk=other)
    try:
        with transaction.atomic():
            drip_publish.activate_copies(campaign)
        raised = False
    except ValidationError as exc:
        raised = "Message 3: Add a subject line." in str(exc.detail)
    check("activating inside the publish's savepoint undoes the copies already activated when a later one fails",
          raised and set(TemplateMaster.objects.filter(pk__in=copies).values_list("status", flat=True)) == {"DRAFT"})
    shared = world.template("ZS shared draft", "EMAIL", subject="Hi", html="<p>Hi</p>")
    world.sql("UPDATE template_master SET status = 'DRAFT' WHERE id = %s", [shared])
    world.sql("UPDATE campaign_drip_step SET template_id = %s, template_owned = FALSE WHERE campaign_id = %s AND day = 5", [shared, other])
    world.sql("UPDATE rendered_template_content SET subject_line = 'Back' WHERE template_id = %s", [copies[2]])
    check("a shared template the drip doesn't own must already be active",
          _checklist(world, other)["problems"].get("messages_content") == "Message 3: its template is still a draft. Publish the template first.")
    check.done()


def test_a_messages_own_subject_counts_for_its_copy(world, check):
    """A message started from a blank template has no subject in its copy; its own subject line (set on the Sequence step,
    read-only in the editor) is what it sends, so the copy needs none to be activated."""
    cid = _series(world, "ZS own subject")
    _test_all(world, cid)
    copies = [step["template"]["id"] for step in _steps(world, cid)]
    world.sql("UPDATE template_master SET status = 'DRAFT' WHERE id = ANY(%s::uuid[])", [copies])
    world.sql("UPDATE rendered_template_content SET subject_line = NULL WHERE template_id = %s", [copies[2]])
    world.sql("UPDATE campaign_drip_step SET subject_line = 'Last call for your reward' WHERE campaign_id = %s AND day = 5", [cid])
    check("the checklist doesn't ask the copy for a subject", "messages_content" not in _checklist(world, cid)["problems"], _checklist(world, cid)["problems"])
    published = _publish(world, cid)
    check("publish activates it", published.status_code == 201 and TemplateMaster.objects.get(pk=copies[2]).status == "ACTIVE", published.content[:200])
    check.done()


# ------------------------------------------------------------------------------------------------ review
def test_review_timeline_and_warnings(world, check):
    body = world.template("ZS review email", "EMAIL", subject="Review subject", html="<p>Hi</p>")
    cid = world.drip("ZS review", "EMAIL", [(0, body, {}), (1, body, {"subject_line": "Own subject"}), (3, body, {})], lists=[world.three],
                     start=world.start(days=4, hour=9, minute=0), series_time="09:00")
    world.sql("""INSERT INTO communication_governance_policy (tenant_id, name, scope, channel, max_messages, period_days, applies_to, priority)
                 VALUES (%s, 'ZS two emails a week', 'CHANNEL', 'EMAIL', 2, 7, 'MARKETING', 1)""", [world.tenant])
    review = world.api("get", f"/api/v1/campaigns/{cid}/steps/review/").json()
    rows = review["messages"]
    check("each message: place, day, time, subject by the sending rule and the fixed audience's estimate",
          [(row["position"], row["day"], row["subject"], row["estimated_recipients"]) for row in rows] == [(1, 0, "Review subject", 3), (2, 1, "Own subject", 3), (3, 3, "Review subject", 3)]
          and rows[0]["scheduled_for"] and review["summary"] == {"count": 3, "first_send_at": rows[0]["scheduled_for"], "last_send_at": rows[2]["scheduled_for"], "estimated_recipients": 3},
          review)
    check("TOO_CLOSE: a day after the previous message", rows[1]["warnings"][0] == {"code": "TOO_CLOSE", "message": "Only 1 day after message 1."}, rows[1]["warnings"])
    check("FREQUENCY: the third email within 7 days under a cap of 2",
          rows[2]["warnings"] == [{"code": "FREQUENCY", "message": "This drip sends 3 emails within 7 days; the limit is 2, so this message will skip people."}]
          and not any(item["code"] == "FREQUENCY" for row in rows[:2] for item in row["warnings"]), rows[2]["warnings"])
    world.sql("UPDATE campaign SET respect_governance = FALSE WHERE id = %s", [cid])
    check("no FREQUENCY warning when the drip doesn't respect the caps",
          not any(item["code"] == "FREQUENCY" for row in world.api("get", f"/api/v1/campaigns/{cid}/steps/review/").json()["messages"] for item in row["warnings"]))
    text = world.template("ZS late text", "SMS", body="ZS: tonight only. Reply STOP to opt out.")
    tid = world.drip("ZS late texts", "SMS", [(0, text, {}), (4, text, {"send_time": "12:00"})], lists=[world.three], start=world.start(days=4, hour=21, minute=30), series_time="21:30")
    late = world.api("get", f"/api/v1/campaigns/{tid}/steps/review/").json()["messages"]
    zone = world.start(days=4).strftime("%Z")
    check("QUIET_HOURS: a marketing text at 21:30 waits until 08:00; one at noon doesn't",
          late[0]["warnings"] == [{"code": "QUIET_HOURS", "message": f"Sends at 21:30 {zone}, inside quiet hours for texts. It will wait until 08:00."}]
          and late[1]["warnings"] == [] and late[0]["subject"] == "ZS: tonight only. Reply STOP to opt out.", late)
    check.done()


# ------------------------------------------------------------------------------------------------ everything else unchanged
def test_a_regular_campaign_tests_and_publishes_as_before(world, check):
    body = world.template("ZS regular", "EMAIL", subject="Regular subject", html="<p>Regular</p>")
    made = world.api("post", "/api/v1/campaigns/", {"name": "ZS regular campaign", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": body,
                                                    "sender_profile": world.email_sender, "contact_lists": [world.three]}).json()
    listed = _checklist(world, made["id"])
    test_item = next(item for item in listed["items"] if item["key"] == "test")
    check("checklist: today's items, the test item advisory", [item["key"] for item in listed["items"]] == ["template", "contact_lists", "sender_profile", "test"]
          and test_item["advisory"] is True and test_item["ok"] is False and listed["ready"] is True, listed["items"])
    tested = world.api("post", f"/api/v1/campaigns/{made['id']}/test-publish/", {"to": [QA]})
    check("test publish: one [TEST] message, one test run, the same answer as before",
          tested.status_code == 200 and set(tested.json()) == {"run", "results", "status"} and tested.json()["status"] == "TEST_PUBLISHED"
          and [item["subject"] for item in world.posted] == ["[TEST] Regular subject"] and "Test ·" not in world.posted[0]["html"]
          and set(tested.json()["results"][0]) == {"to", "ok", "detail"}, tested.content[:300])
    check("publish goes through without the drip rules", _publish(world, made["id"]).status_code == 201)
    check.done()
