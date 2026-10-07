"""Drip steps (patch 0040): each message of a drip has its own row and its own template copy, managed under
/campaigns/{id}/steps/, mirrored into drip_config and campaign.template_id so publish and the send engine work as before.
Every change is rolled back (tests/conftest.py)."""
import json
import re
from datetime import datetime, time, timedelta
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.db import connection
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.campaigns.models import Campaign, CampaignDripStep
from apps.identity.models import AppUser
from apps.templates import starters
from apps.templates.models import TemplateMaster
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]

SCHEMA = Path(__file__).resolve().parents[2] / "database" / "CEP_Database_Schema_Platform_Operations.sql"


def test_drip_steps(check, admin_email):
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    analyst = AppUser.objects.get(email="priya.natarajan@northwindapparel.example")
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}
    HA = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(analyst))}

    def api(method, path, body=None, h=H):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **h)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **h)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    def said(response, field=None):
        body = response.json()
        if field is None:
            return body.get("detail", "")
        value = body.get("errors", {}).get(field, "")
        return " ".join(value) if isinstance(value, list) else str(value)

    def steps(campaign_id):
        return api("get", f"/api/v1/campaigns/{campaign_id}/steps/").json()

    def mirror(campaign_id):
        row = Campaign.objects.get(pk=campaign_id)
        return [step["day"] for step in (row.drip_config or {}).get("steps", [])], str(row.template_id) if row.template_id else None

    def names(campaign_id):
        return [step["template"]["name"] if step["template"] else None for step in steps(campaign_id)]

    def template(name, channel, subject=None, body=None):
        made = api("post", "/api/v1/templates/", {"name": name, "channel": channel}).json()
        if subject is not None or body is not None:
            sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, sms_body) VALUES (%s, 1, %s, %s, %s)",
                [made["id"], subject, "<p>Hi {{unsubscribe_url}}</p>" if channel == "EMAIL" else None, body])
        return made

    def status(campaign_id, value):
        sql("UPDATE campaign SET status = %s WHERE id = %s", [value, campaign_id])

    # ------------------------------------------------------------ set-up: a sandbox text sender, a list, templates
    provider = api("post", "/api/v1/delivery-providers/", {"provider_type": "SANDBOX_SMS", "name": "ZD sandbox texts", "config": {}}).json()
    sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": provider["id"], "display_name": "ZD Shop", "sender_id": "55178"}).json()
    api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "+14705550100"})
    sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, phones) VALUES ('ZD-P01', %s, 'Ana', 'Test', %s::jsonb)",
        [TENANT, json.dumps([{"number": "+14705551201", "type": "MOBILE", "is_primary": True}])])
    list_id = str(sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, 'ZD list', 'UPLOAD', 'PRODUCTION', 1, %s) RETURNING id",
                      [TENANT, str(admin.pk)], True)[0][0])
    sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, 'ZD-P01')", [list_id, TENANT])
    shared = template("ZD shared texts", "SMS", body="ZD Shop: hi {{first_name}}. Reply STOP to opt out.")
    sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [shared["id"]])
    email_source = template("ZD welcome email", "EMAIL", subject="Welcome in")

    # ------------------------------------------------------------ an existing drip: backfilled, publishes as before
    old = api("post", "/api/v1/campaigns/", {"name": "ZD old series", "campaign_type": "DRIP", "channel": "SMS", "template": shared["id"], "sender_profile": sender["id"],
                                             "contact_lists": [list_id], "drip_config": {"steps": [{"day": 0, "label": "Hello"}, {"day": 3}, {"day": 7}], "time": "10:00"}}).json()
    sql("DELETE FROM campaign_drip_step WHERE campaign_id = %s", [old["id"]])        # as it was before patch 0040
    backfill = re.search(r"INSERT INTO campaign_drip_step .*?;", SCHEMA.read_text(), re.S).group(0)
    sql(backfill)
    sql(backfill)
    rows = list(CampaignDripStep.objects.filter(campaign_id=old["id"]).order_by("day"))
    check("backfill: one row per drip_config step with its label as the name, on the campaign's own template (not a copy); running it again adds nothing",
          [(row.day, row.name, str(row.template_id), row.template_owned) for row in rows] == [(0, "Hello", shared["id"], False), (3, "", shared["id"], False), (7, "", shared["id"], False)],
          str([(row.day, row.name, row.template_id, row.template_owned) for row in rows]))
    before = Campaign.objects.get(pk=old["id"])
    # since B3 a drip publishes with a start date ahead and every message tested
    sql("UPDATE campaign SET scheduled_at = now() + interval '1 day' WHERE id = %s", [old["id"]])
    sql("UPDATE campaign_drip_step SET content_changed_at = now() - interval '1 minute', tested_at = now() WHERE campaign_id = %s", [old["id"]])
    before_queued = len(connection.run_on_commit)
    with mock.patch("api.v1.views._enqueue_run"):
        published = api("post", f"/api/v1/campaigns/{old['id']}/publish/")
    runs = sorted(api("get", f"/api/v1/campaigns/{old['id']}/").json()["runs"], key=lambda run: run["run_number"])
    check("a backfilled drip publishes: a Run per step on its day at the series time, on the shared template; nothing renamed",
          published.status_code == 201 and [run["sequence_label"] for run in runs] == ["Day 0", "Day 3", "Day 7"] and None not in [run["scheduled_at"] for run in runs]
          and len(connection.run_on_commit) - before_queued == 0 and before.drip_config == {"steps": [{"day": 0, "label": "Hello"}, {"day": 3}, {"day": 7}], "time": "10:00"}
          and str(before.template_id) == shared["id"] and TemplateMaster.objects.get(pk=shared["id"]).name == "ZD shared texts",
          f"{published.status_code} {[(run['sequence_label'], run['scheduled_at']) for run in runs]} {before.drip_config}")

    # ------------------------------------------------------------ a live drip locks its templates
    edit = api("patch", f"/api/v1/templates/{shared['id']}/", {"description": "changed"})
    message = api("post", f"/api/v1/templates/{shared['id']}/message/", {"sms_body": "New text. Reply STOP to opt out.", "subject_line": "", "media_asset": None, "base_version": 1})
    delete = api("delete", f"/api/v1/templates/{shared['id']}/")
    archive = api("post", f"/api/v1/templates/{shared['id']}/archive/")
    used = api("get", f"/api/v1/templates/{shared['id']}/").json()["used_in_drip"]
    check("live drip: its template can't be edited, saved, deleted or archived, each refusal in words; used_in_drip says where and that it is locked",
          [edit.status_code, message.status_code, delete.status_code, archive.status_code] == [409] * 4
          and said(edit) == "Used by a live drip (ZD old series, message 1). It can't be changed until the drip finishes or is stopped." and said(message) == said(edit)
          and said(delete) == "This template can't be deleted. ZD old series uses it for message 1, and the drip is still running."
          and said(archive) == "This template can't be archived. ZD old series uses it for message 1, and the drip is still running."
          and used == {"campaign_id": old["id"], "campaign_name": "ZD old series", "position": 1, "count": 3, "locked": True},
          f"{[edit.status_code, message.status_code, delete.status_code, archive.status_code]} {said(edit)} | {said(delete)} | {used}")
    status(old["id"], "TEST_PUBLISHED")
    edit = api("patch", f"/api/v1/templates/{shared['id']}/", {"description": "changed while test published"})
    archive = api("post", f"/api/v1/templates/{shared['id']}/archive/")
    check("test published drip: the template can be edited, but not deleted or archived", edit.status_code == 200 and archive.status_code == 409, f"{edit.status_code} {archive.status_code}")
    status(old["id"], "DRAFT")
    edit = api("patch", f"/api/v1/templates/{shared['id']}/", {"description": "changed while a draft"})
    message = api("post", f"/api/v1/templates/{shared['id']}/message/", {"sms_body": "New text. Reply STOP to opt out.", "subject_line": "", "media_asset": None, "base_version": 1})
    used = api("get", f"/api/v1/templates/{shared['id']}/").json()["used_in_drip"]
    unused = api("get", f"/api/v1/templates/{email_source['id']}/").json()
    check("a draft drip locks nothing; a template no drip uses has used_in_drip null",
          edit.status_code == 200 and message.status_code == 201 and used["locked"] is False and unused["used_in_drip"] is None, f"{edit.status_code} {message.status_code} {used}")

    # ------------------------------------------------------------ a new drip starts with a Day-0 message
    made = api("post", "/api/v1/campaigns/", {"name": "ZD welcome", "campaign_type": "DRIP", "channel": "EMAIL"})
    drip = made.json()
    did = drip["id"]
    first = steps(did)
    check("new drip: one Day-0 message without a template, already in drip_config; drip_summary says it is not ready",
          made.status_code == 201 and len(first) == 1 and first[0]["day"] == 0 and first[0]["position"] == 1 and first[0]["template"] is None and first[0]["problems"] == ["NEEDS_TEMPLATE"]
          and mirror(did) == ([0], None) and drip["drip_summary"] == {"count": 1, "last_day": 0, "first_send_at": None, "last_send_at": None, "ready": False},
          f"{made.status_code} {first} {mirror(did)} {drip.get('drip_summary')}")
    permission = api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "blank"}, h=HA)
    check("the steps need the same permission as editing the campaign", permission.status_code == 403, str(permission.status_code))

    # ------------------------------------------------------------ changing a message's template makes a copy
    chosen = api("patch", f"/api/v1/campaigns/{did}/steps/{first[0]['id']}/", {"template": email_source["id"], "row_version": first[0]["row_version"]})
    one = chosen.json()
    check("choosing a template copies it for the message: the original is untouched, the copy is named for the drip, and campaign.template_id follows",
          chosen.status_code == 200 and one["template"]["id"] != email_source["id"] and one["template"]["name"] == "ZD welcome · 1 of 1" and one["problems"] == []
          and mirror(did) == ([0], one["template"]["id"]) and TemplateMaster.objects.get(pk=email_source["id"]).name == "ZD welcome email",
          f"{chosen.status_code} {one}")
    rechosen = api("patch", f"/api/v1/campaigns/{did}/steps/{first[0]['id']}/", {"template": email_source["id"]}).json()
    check("choosing again makes another copy and the message's old copy, used nowhere else, is soft-deleted",
          rechosen["template"]["id"] != one["template"]["id"] and TemplateMaster.objects.get(pk=one["template"]["id"]).deleted_at is not None, str(rechosen["template"]))
    stale = api("patch", f"/api/v1/campaigns/{did}/steps/{first[0]['id']}/", {"name": "Hello", "row_version": first[0]["row_version"]})
    check("a stale row_version is refused (409)", stale.status_code == 409 and said(stale) == "Someone else changed this message after you opened it. Reload to see their changes.", said(stale))

    # ------------------------------------------------------------ adding: from a template, blank, the gallery, a copy
    from_template = api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "template", "template": email_source["id"], "name": "Tips"})
    blank = api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "blank"})
    key = next(item["key"] for item in starters.STARTERS if item["channel"] == "EMAIL")
    gallery = api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "template", "starter": key})
    copied = api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "copy"})
    added = [from_template.json(), blank.json(), gallery.json(), copied.json()]
    blank_template = TemplateMaster.objects.get(pk=added[1]["template"]["id"])
    check("add: from a template (copied), blank (an empty template of the drip's channel), a gallery starter and a copy of the last message; each 3 days after the last",
          [r.status_code for r in (from_template, blank, gallery, copied)] == [201] * 4 and [item["day"] for item in added] == [3, 6, 9, 12]
          and added[0]["template"]["id"] != email_source["id"] and added[0]["name"] == "Tips" and (blank_template.channel, blank_template.status) == ("EMAIL", "DRAFT")
          and added[1]["problems"] == ["NEEDS_SUBJECT"] and added[2]["problems"] == [] and added[3]["template"]["id"] != added[2]["template"]["id"] and added[3]["problems"] == [],
          str([(r.status_code, r.json().get("day"), r.json().get("problems"), r.json().get("errors")) for r in (from_template, blank, gallery, copied)]))
    check("every copy is named '{campaign} · n of N' and the earlier ones were renumbered; drip_config and template_id follow the rows",
          names(did) == [f"ZD welcome · {n} of 5" for n in range(1, 6)] and mirror(did) == ([0, 3, 6, 9, 12], rechosen["template"]["id"]), f"{names(did)} {mirror(did)}")
    next_one = api("post", f"/api/v1/campaigns/{did}/steps/{added[0]['id']}/copy-as-next/").json()
    check("copy-as-next: a copy of that message, after the last one", next_one["day"] == 15 and next_one["template"]["id"] != added[0]["template"]["id"] and next_one["name"] == "",
          str(next_one))
    subject = api("patch", f"/api/v1/campaigns/{did}/steps/{added[1]['id']}/", {"subject_line": "  Our   tips  ", "preheader": ""}).json()
    check("a subject line override answers NEEDS_SUBJECT; blank overrides are stored as none", subject["problems"] == [] and subject["subject_line"] == "Our tips" and subject["preheader"] is None,
          str(subject))

    # ------------------------------------------------------------ days: default cap, same day, more than 30
    late = api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "blank", "day": 364}).json()
    capped = api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "blank"})
    full = api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "blank"})
    same = api("patch", f"/api/v1/campaigns/{did}/steps/{added[0]['id']}/", {"day": 6})
    check("the default day stops at 365; a second message on a day is refused, adding or moving",
          late["day"] == 364 and capped.status_code == 201 and capped.json()["day"] == 365 and full.status_code == 400 and said(full, "day") == "Another message is already on this day."
          and same.status_code == 400 and said(same, "day") == "Another message is already on this day.", f"{capped.status_code} {said(full, 'day')} {said(same, 'day')}")

    # ------------------------------------------------------------ remove and reorder renumber the copies
    gone_template = added[0]["template"]["id"]
    removed = api("delete", f"/api/v1/campaigns/{did}/steps/{added[0]['id']}/")
    after = steps(did)
    check("remove: the row goes, its own copy is soft-deleted, the others are renumbered and drip_config follows",
          removed.status_code == 204 and TemplateMaster.objects.get(pk=gone_template).deleted_at is not None and [step["day"] for step in after] == [0, 6, 9, 12, 15, 364, 365]
          and names(did)[1] == "ZD welcome · 2 of 7" and mirror(did)[0] == [0, 6, 9, 12, 15, 364, 365], f"{removed.status_code} {names(did)} {mirror(did)}")
    moved_template = after[3]["template"]["id"]                       # Day 12, message 4
    moved = api("patch", f"/api/v1/campaigns/{did}/steps/{after[3]['id']}/", {"day": 1}).json()
    check("moving a message to another day reorders the messages and renames the copies",
          moved["position"] == 2 and TemplateMaster.objects.get(pk=moved_template).name == "ZD welcome · 2 of 7" and mirror(did)[0] == [0, 1, 6, 9, 15, 364, 365], f"{moved} {names(did)}")
    sql("INSERT INTO campaign_drip_step (tenant_id, campaign_id, day) SELECT %s, %s, d FROM generate_series(100, 122) d", [TENANT, did])
    too_many = api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "blank", "day": 200})
    check("a drip has at most 30 messages", too_many.status_code == 400 and said(too_many, "day") == "A drip has at most 30 messages.", f"{too_many.status_code} {said(too_many, 'day')}")
    sql("DELETE FROM campaign_drip_step WHERE campaign_id = %s AND day BETWEEN 100 AND 122", [did])

    # ------------------------------------------------------------ A/B: one message, email only, never on the campaign
    current = steps(did)
    ab = {"enabled": True, "subject_b": "Hello again", "sample_pct": 20, "metric": "OPEN_RATE", "decide_after_minutes": 240}
    first_ab = api("patch", f"/api/v1/campaigns/{did}/steps/{current[0]['id']}/", {"ab_config": ab})
    second_ab = api("patch", f"/api/v1/campaigns/{did}/steps/{current[1]['id']}/", {"ab_config": ab})
    campaign_ab = api("patch", f"/api/v1/campaigns/{did}/", {"ab_config": ab})
    created_ab = api("post", "/api/v1/campaigns/", {"name": "ZD ab drip", "campaign_type": "DRIP", "channel": "EMAIL", "ab_config": ab})
    check("A/B: one message per drip; a second is refused in words; the campaign-level test is refused on a drip, on create and on update",
          first_ab.status_code == 200 and first_ab.json()["ab_config"]["enabled"] is True and second_ab.status_code == 400
          and said(second_ab, "ab_config") == "Message 1 is already being tested. One message per drip can have an A/B test."
          and campaign_ab.status_code == 400 and said(campaign_ab, "ab_config") == "On a drip, set this on each message."
          and created_ab.status_code == 400 and said(created_ab, "ab_config") == "On a drip, set this on each message.",
          f"{first_ab.status_code} {said(second_ab, 'ab_config')} {campaign_ab.status_code} {created_ab.status_code}")

    # ------------------------------------------------------------ DRIP + MULTI
    multi = api("post", "/api/v1/campaigns/", {"name": "ZD multi drip", "campaign_type": "DRIP", "channel": "MULTI"})
    multi_update = api("patch", f"/api/v1/campaigns/{did}/", {"channel": "MULTI"})
    check("a drip can't use several channels, on create or on update", multi.status_code == 400 and said(multi, "channel") == "A drip uses one channel. Use a journey to mix channels."
          and multi_update.status_code == 400 and said(multi_update, "channel") == "A drip uses one channel. Use a journey to mix channels.",
          f"{multi.status_code} {multi_update.status_code} {said(multi_update, 'channel')}")

    # ------------------------------------------------------------ the timetable
    start = timezone.now() + timedelta(days=2)
    api("patch", f"/api/v1/campaigns/{did}/", {"scheduled_at": start.isoformat(), "send_timezone": "America/New_York", "drip_config": {**Campaign.objects.get(pk=did).drip_config, "time": "10:00"}})
    timed = api("patch", f"/api/v1/campaigns/{did}/steps/{current[1]['id']}/", {"send_time": "18:30"}).json()
    listed = steps(did)
    ny = ZoneInfo("America/New_York")
    day0 = datetime.combine(start.astimezone(ny).date(), time(10, 0), tzinfo=ny)
    summary = api("get", f"/api/v1/campaigns/{did}/").json()["drip_summary"]
    check("scheduled_for: the start date plus the day, at the message's own time or the series time, in the campaign's zone; drip_summary spans them",
          datetime.fromisoformat(listed[0]["scheduled_for"]) == day0 and listed[0]["effective_send_time"] == "10:00" and timed["send_time"] == "18:30"
          and datetime.fromisoformat(timed["scheduled_for"]) == datetime.combine(day0.date() + timedelta(days=timed["day"]), time(18, 30), tzinfo=ny)
          and summary["count"] == 7 and summary["last_day"] == 365 and datetime.fromisoformat(summary["first_send_at"]) == day0
          and datetime.fromisoformat(summary["last_send_at"]) == datetime.combine(day0.date() + timedelta(days=365), time(10, 0), tzinfo=ny) and summary["ready"] is False,
          f"{listed[0]} {timed} {summary}")

    # ------------------------------------------------------------ clone: every message with a new copy, no start date
    clone = api("post", f"/api/v1/campaigns/{did}/clone/").json()
    clone_steps, source_steps = steps(clone["id"]), steps(did)
    source_templates = {step["template"]["id"] for step in source_steps if step["template"]}
    check("clone: a draft with every message (day, name, time, overrides, A/B), each on a new template copy named for the copy; no start date",
          clone["status"] == "DRAFT" and clone["scheduled_at"] is None and [(s["day"], s["name"], s["send_time"], s["subject_line"], s["ab_config"]) for s in clone_steps]
          == [(s["day"], s["name"], s["send_time"], s["subject_line"], s["ab_config"]) for s in source_steps]
          and not source_templates & {step["template"]["id"] for step in clone_steps if step["template"]}
          and names(clone["id"])[0] == f"{clone['name']} · 1 of 7" and mirror(clone["id"])[1] == clone_steps[0]["template"]["id"],
          f"{clone.get('status')} {clone.get('scheduled_at')} {names(clone['id'])}")
    later = timezone.now() + timedelta(days=9)
    dated = api("post", f"/api/v1/campaigns/{did}/clone/", {"scheduled_at": later.isoformat()})
    past = api("post", f"/api/v1/campaigns/{did}/clone/", {"scheduled_at": (timezone.now() - timedelta(days=1)).isoformat()})
    check("clone takes a new start date when given; one in the past is refused",
          dated.status_code == 201 and datetime.fromisoformat(dated.json()["scheduled_at"]) == later and past.status_code == 400,
          f"{dated.status_code} {dated.json().get('scheduled_at')} {past.status_code}")

    # ------------------------------------------------------------ once published, the messages are fixed and their copies locked
    status(did, "PRODUCTION_PUBLISHED")
    live = steps(did)
    refused = [api("post", f"/api/v1/campaigns/{did}/steps/", {"start_from": "blank"}), api("patch", f"/api/v1/campaigns/{did}/steps/{live[1]['id']}/", {"name": "x"}),
               api("delete", f"/api/v1/campaigns/{did}/steps/{live[1]['id']}/"), api("post", f"/api/v1/campaigns/{did}/steps/{live[1]['id']}/copy-as-next/")]
    own_copy = live[2]["template"]["id"]
    design = api("post", f"/api/v1/templates/{own_copy}/design/", {"editor_state": {}, "mjml_source": "<mjml><mj-body></mj-body></mjml>", "subject_line": "x", "preheader": "",
                                                                  "base_version": 1})
    check("published: adding, editing, removing and copying messages are refused (409), and saving a message's own design too",
          [r.status_code for r in refused] == [409] * 4 and said(refused[0]) == "A production published campaign can no longer be edited."
          and design.status_code == 409 and said(design) == "Used by a live drip (ZD welcome, message 3). It can't be changed until the drip finishes or is stopped.",
          f"{[r.status_code for r in refused]} {said(refused[0])} {design.status_code} {said(design)}")
    status(did, "DRAFT")

    # ------------------------------------------------------------ texts: problems, no subject, no A/B
    texts = api("post", "/api/v1/campaigns/", {"name": "ZD text series", "campaign_type": "DRIP", "channel": "SMS"}).json()
    tid = texts["id"]
    blank_text = api("patch", f"/api/v1/campaigns/{tid}/steps/{steps(tid)[0]['id']}/", {"template": shared["id"]}).json()
    empty = api("post", f"/api/v1/campaigns/{tid}/steps/", {"start_from": "blank"}).json()
    wrong = api("post", f"/api/v1/campaigns/{tid}/steps/", {"start_from": "template", "template": email_source["id"]})
    text_ab = api("patch", f"/api/v1/campaigns/{tid}/steps/{empty['id']}/", {"ab_config": ab})
    text_subject = api("patch", f"/api/v1/campaigns/{tid}/steps/{empty['id']}/", {"subject_line": "Hi"})
    check("texts: an empty message needs its text, a written one needs nothing; an email template, a subject line and an A/B test are refused",
          blank_text["problems"] == [] and empty["problems"] == ["NEEDS_TEXT"] and wrong.status_code == 400 and said(wrong, "template") == "Choose an SMS template. This drip sends texts."
          and text_ab.status_code == 400 and said(text_ab, "ab_config") == "A subject line test is for email: texts have no subject."
          and text_subject.status_code == 400, f"{blank_text['problems']} {empty['problems']} {said(wrong, 'template')} {said(text_ab, 'ab_config')} {text_subject.status_code}")
    last = api("delete", f"/api/v1/campaigns/{tid}/steps/{empty['id']}/")
    only = api("delete", f"/api/v1/campaigns/{tid}/steps/{blank_text['id']}/")
    check("the last remaining message can't be removed", last.status_code == 204 and only.status_code == 409
          and said(only) == "A drip needs at least one message. Add another message before removing this one.", f"{last.status_code} {only.status_code}")

    # ------------------------------------------------------------ a backfilled drip's shared template is never removed or renamed
    shared_two = template("ZD shared two", "SMS", body="Two. Reply STOP to opt out.")
    pair = api("post", "/api/v1/campaigns/", {"name": "ZD pair", "campaign_type": "DRIP", "channel": "SMS", "template": shared_two["id"],
                                              "drip_config": {"steps": [{"day": 0}, {"day": 2}], "time": "09:00"}}).json()
    pair_steps = steps(pair["id"])
    library = template("ZD library text", "SMS", body="Library. Reply STOP to opt out.")
    sql("UPDATE campaign_drip_step SET template_id = %s WHERE id = %s", [library["id"], pair_steps[1]["id"]])      # shared, and used by nothing else
    removed_shared = api("delete", f"/api/v1/campaigns/{pair['id']}/steps/{pair_steps[1]['id']}/")
    kept, kept_library = TemplateMaster.objects.get(pk=shared_two["id"]), TemplateMaster.objects.get(pk=library["id"])
    check("removing a message on a template it doesn't own leaves the template alone (not deleted, not renamed), even when nothing else uses it",
          [step["template"]["id"] for step in pair_steps] == [shared_two["id"]] * 2 and removed_shared.status_code == 204 and kept.deleted_at is None
          and kept_library.deleted_at is None and kept.name == "ZD shared two" and mirror(pair["id"]) == ([0], shared_two["id"]),
          f"{removed_shared.status_code} {kept_library.deleted_at} {kept.name}")

    # ------------------------------------------------------------ the setup's old way (drip_config on the campaign) still works
    followed = api("patch", f"/api/v1/campaigns/{pair['id']}/", {"drip_config": {"steps": [{"day": 0}, {"day": 4, "label": "Reminder"}, {"day": 9}], "time": "09:00"}})
    rows = [(step["day"], step["name"], step["template"]["id"] if step["template"] else None) for step in steps(pair["id"])]
    check("saving drip_config on the campaign adds and removes rows to match, on the campaign's template",
          followed.status_code == 200 and rows == [(0, "", shared_two["id"]), (4, "Reminder", shared_two["id"]), (9, "", shared_two["id"])]
          and mirror(pair["id"]) == ([0, 4, 9], shared_two["id"]), f"{followed.status_code} {rows}")

    check.done()
