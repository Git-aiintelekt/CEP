"""Campaign module (BRD v0.9 6.3, 7, 15) end to end against the real (local) database, inside one rolled-back transaction.
Sends go through the sandbox text engine, so nothing leaves the machine.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo
from django.db import connection, transaction
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from apps.campaigns import service
from apps.campaigns.models import Campaign
from apps.delivery import engine
from apps.delivery.engine import runs, session
from apps.identity.models import AppUser
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_campaign_module(check, admin_email):
    """Campaign module (BRD v0.9 6.3, 7, 15) end to end against the real (local) database, inside one rolled-back transaction."""
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

    # ---- schedule arithmetic: no database needed
    ny = ZoneInfo("America/New_York")
    mon = datetime(2026, 9, 21, 10, 0, tzinfo=ny)                 # a Monday
    daily = service.next_occurrence({"frequency": "DAILY", "time": "09:00"}, mon, ny)
    weekly = service.next_occurrence({"frequency": "WEEKLY", "weekdays": ["WE", "FR"], "time": "08:30"}, mon, ny)
    monthly = service.next_occurrence({"frequency": "MONTHLY", "day_of_month": 31, "time": "07:00"}, datetime(2026, 2, 1, tzinfo=ny), ny)
    ended = service.next_occurrence({"frequency": "DAILY", "time": "09:00", "end_date": "2026-09-21"}, mon, ny)
    first = service.next_occurrence({"frequency": "DAILY", "time": "10:00"}, mon, ny, first=True)
    check("recurrence: daily is tomorrow at the set time, weekly the next chosen weekday, the 31st becomes the last day of a short month, an end date ends it, the first send may be now",
          daily == datetime(2026, 9, 22, 9, 0, tzinfo=ny) and weekly == datetime(2026, 9, 23, 8, 30, tzinfo=ny) and monthly == datetime(2026, 2, 28, 7, 0, tzinfo=ny)
          and ended is None and first == mon, f"{daily} | {weekly} | {monthly}")
    check("recurrence and series are validated in words", service.validate_recurring({"frequency": "HOURLY"}) == "Choose daily, weekly or monthly."
          and service.validate_recurring({"frequency": "WEEKLY", "weekdays": ["XX"]}) and service.validate_recurring({"frequency": "DAILY", "interval": 2, "time": "09:00"}) is None
          and service.validate_drip({"steps": []}) and service.validate_drip({"steps": [{"day": 0}, {"day": 0}]}) == "Two steps are on the same day."
          and service.validate_drip({"steps": [{"day": 0}, {"day": 3}, {"day": 7}]}) is None)

    PEOPLE = [("ZC-P01", "Ana", "+14705551101", "OPTED_IN"), ("ZC-P02", "Ben", "+14705551102", "OPTED_IN"), ("ZC-P03", "Cy", "+14705551103", "OPTED_IN"),
              ("ZC-P04", "Di", "+14705551104", "OPTED_OUT"), ("ZC-P05", "Ed", "+14705551105", None), ("ZC-P06", "Fay", "+14705551106", "OPTED_IN")]
    NO_QUIET = mock.patch.object(runs, "quiet_until", return_value=None)

    with transaction.atomic():
        for party, name, phone, consent in PEOPLE:
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Test', %s::jsonb, %s::jsonb)",
                [party, TENANT, name, json.dumps([{"address": f"{name.lower()}@zc.example", "is_primary": True}]), json.dumps([{"number": phone, "type": "MOBILE", "is_primary": True}])])
            for channel in ("SMS", "EMAIL"):
                if consent:
                    sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, %s, %s, %s, now())",
                        [TENANT, party, channel, consent, consent == "OPTED_IN"])
        sql("INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, blocked, block_reason, blocked_at) VALUES (%s, 'EMAIL', 'fay@zc.example', 'ZC-P06', TRUE, 'HARD_BOUNCE', now())", [TENANT])

        def make_list(name, parties, environment="PRODUCTION"):
            list_id = sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, %s, 'UPLOAD', %s, %s, %s) RETURNING id",
                          [TENANT, name, environment, len(parties), str(admin.pk)], True)[0][0]
            for party in parties:
                sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, TENANT, party])
            return str(list_id)

        list_a = make_list("ZC list A", ["ZC-P01", "ZC-P02", "ZC-P03", "ZC-P04"])
        list_b = make_list("ZC list B", ["ZC-P03", "ZC-P04", "ZC-P05", "ZC-P06"])
        list_x = make_list("ZC do not contact", ["ZC-P02"])
        list_test = make_list("ZC internal test", ["ZC-P01"], "TEST")

        provider = api("post", "/api/v1/delivery-providers/", {"provider_type": "SANDBOX_SMS", "name": "ZC sandbox texts", "config": {}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": provider["id"], "display_name": "ZC Shop", "sender_id": "55177"}).json()
        api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "+14705550100"})
        template = api("post", "/api/v1/templates/", {"name": "ZC text template", "channel": "SMS"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body) VALUES (%s, 1, %s)", [template["id"], "ZC Shop: Hi {{first_name}}. Reply STOP to opt out."])
        draft_template = api("post", "/api/v1/templates/", {"name": "ZC unpublished template", "channel": "SMS"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body) VALUES (%s, 1, %s)", [draft_template["id"], "Hi. Reply STOP to opt out."])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])

        def new(name, **extra):
            return api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "template": template["id"], "sender_profile": sender["id"],
                                                      "contact_lists": [list_a], **extra})

        def publish(campaign_id):
            """-> the response and how many runs were handed to the engine (after the commit: inside this rolled-back test they wait in the connection's list)."""
            before = len(connection.run_on_commit)
            with mock.patch("api.v1.views._enqueue_run"):
                r = api("post", f"/api/v1/campaigns/{campaign_id}/publish/")
            return r, len(connection.run_on_commit) - before

        def get(campaign_id):
            return api("get", f"/api/v1/campaigns/{campaign_id}/").json()

        # ------------------------------------------------------------ create: basics, owner, tags, targets, lists
        r = new("  ZC   Fall   texts ", description="Autumn offer", tags=["Fall", "vip", "Fall"], contact_lists=[list_a, list_b], excluded_lists=[list_x],
                targets={"target_revenue": "25000.00", "target_opens": 0, "target_clicks": 40, "target_conversions": 12, "planned_cost": "900.50", "planned_offer_cost": "150", "notes": "Q4 plan"},
                respect_governance=True, rate_limit_per_hour=5000, timezone_optimization=True, send_timezone="America/Chicago")
        d = r.json()
        check("create: a draft with its owner defaulted, name tidied, tags de-duplicated, targets and economics (BRD 15), attached and excluded lists, delivery settings",
              r.status_code == 201 and d["status"] == "DRAFT" and d["display_status"] == "DRAFT" and d["name"] == "ZC Fall texts" and d["owner_user"] == str(admin.pk) and d["owner_name"]
              and d["tags"] == ["Fall", "vip"] and d["targets"]["target_revenue"] == "25000.00" and d["targets"]["planned_offer_cost"] == "150.00" and d["targets"]["notes"] == "Q4 plan"
              and sorted(d["contact_lists"]) == sorted([list_a, list_b]) and d["excluded_lists"] == [list_x] and d["list_count"] == 2 and d["audience_size"] == 8
              and d["rate_limit_per_hour"] == 5000 and d["timezone_optimization"] is True and d["send_timezone"] == "America/Chicago" and d["triggered_by"] == "MANUAL"
              and set(d["actions"]) == {"edit", "clone", "test_publish", "publish", "archive"}, f"{r.status_code} {d.get('errors', '')}")
        cid = d["id"]
        bad = [new("zc fall TEXTS"), new("ZC bad tags", tags=["ok", "x" * 41]), new("ZC both", excluded_lists=[list_a]), new("ZC zone", send_timezone="Mars/Olympus"),
               new("ZC series", send_type="DRIP"), new("ZC owner", owner_user="00000000-0000-4000-8000-000000000000"),
               new("ZC recur", send_type="RECURRING", recurring_config={"frequency": "HOURLY"})]
        check("server-side validation, by field: duplicate name (any case), tag, a list both attached and excluded, time zone, a series on a non-drip campaign, owner, recurrence",
              [x.status_code for x in bad] == [400] * 7 and [next(iter(x.json()["errors"])) for x in bad] == ["name", "tags", "excluded_lists", "send_timezone", "send_type", "owner_user", "recurring_config"],
              str([(x.status_code, list(x.json().get("errors", {}))) for x in bad]))

        wip = new("ZC half way", setup_step=1).json()
        step3 = api("patch", f"/api/v1/campaigns/{wip['id']}/", {"setup_step": 3, "row_version": wip["row_version"]}).json()
        back = api("patch", f"/api/v1/campaigns/{wip['id']}/", {"setup_step": 1, "description": "went back to step 1", "row_version": step3["row_version"]}).json()
        done_ = api("patch", f"/api/v1/campaigns/{wip['id']}/", {"setup_step": 6, "row_version": back["row_version"]}).json()
        check("setup progress: the setup says how far it got, it only moves forward, six steps make it complete; a campaign made without the setup (an integration) counts as complete",
              (wip["setup_step"], wip["setup_complete"]) == (1, False) and step3["setup_step"] == 3 and (back["setup_step"], back["description"]) == (3, "went back to step 1")
              and (done_["setup_step"], done_["setup_complete"]) == (6, True) and (d["setup_step"], d["setup_complete"]) == (6, True)
              and new("ZC too far", setup_step=9).status_code == 400, f"{wip.get('setup_step')} {step3.get('setup_step')} {back.get('setup_step')} {done_.get('setup_step')}")

        EMPTY = {name: None for name in ("target_revenue", "target_opens", "target_clicks", "target_conversions", "target_redemptions", "planned_cost", "planned_offer_cost", "notes")}
        quiet = new("ZC quiet log", targets=EMPTY).json()
        same = api("patch", f"/api/v1/campaigns/{quiet['id']}/", {"targets": EMPTY, "setup_step": 6, "row_version": quiet["row_version"]}).json()
        set_ = api("patch", f"/api/v1/campaigns/{quiet['id']}/", {"targets": {**EMPTY, "target_clicks": 5}, "row_version": same["row_version"]}).json()
        again = api("patch", f"/api/v1/campaigns/{quiet['id']}/", {"targets": {**EMPTY, "target_clicks": 5}, "row_version": set_["row_version"]})
        logged = [x["message"] for x in api("get", f"/api/v1/campaigns/{quiet['id']}/activity/").json() if x["event_type"] == "MODIFIED"]
        check("the setup sends the targets with every save: empty targets create nothing, and the log says 'targets' only when they changed",
              quiet["targets"] is None and same["targets"] is None and set_["targets"]["target_clicks"] == 5 and again.status_code == 200 and logged == ["Changed: targets."], str(logged))

        # ------------------------------------------------------------ audience: merged, de-duplicated, exclusions, governance
        a = api("get", f"/api/v1/campaigns/{cid}/audience/").json()
        by = {x["code"]: x["count"] for x in a["statuses"]}
        check("audience (BRD 6.3): lists merged and de-duplicated so a party appears once, the excluded list taken out, then today's governance picture and a sample",
              a["gross"] == 8 and a["unique"] == 6 and a["duplicates_removed"] == 2 and a["excluded_by_list"] == 1 and a["after_exclusions"] == 5 and by["MARKETABLE"] == 3
              and by["UNSUBSCRIBED"] == 1 and by["NO_CONSENT"] == 1 and a["estimated_recipients"] == 3 and a["excluded_by_governance"] == 2 and len(a["sample"]) == 5
              and {x["role"] for x in a["lists"]} == {"INCLUDE", "EXCLUDE"}, json.dumps({k: a[k] for k in ("gross", "unique", "excluded_by_list", "after_exclusions", "estimated_recipients")}))
        e = api("get", f"/api/v1/campaigns/audience-estimate/?include={list_a},{list_b}&channel=EMAIL").json()
        eby = {x["code"]: x["count"] for x in e["statuses"]}
        check("the same estimate for lists that are not saved yet (the form asks while the operator picks), with email governance: a hard bounce is caught",
              e["unique"] == 6 and eby["HARD_BOUNCE"] == 1 and eby["UNSUBSCRIBED"] == 1 and eby["NO_CONSENT"] == 1 and eby["MARKETABLE"] == 3
              and api("get", "/api/v1/campaigns/audience-estimate/?include=nonsense").status_code == 400, str(eby))
        r1 = api("post", f"/api/v1/campaigns/{cid}/lists/", {"contact_list": list_test})
        r2 = api("delete", f"/api/v1/campaigns/{cid}/lists/{list_test}/")
        check("a list can be attached and detached on its own", r1.status_code == 200 and any(x["id"] == list_test for x in r1.json()) and r2.status_code == 204
              and api("delete", f"/api/v1/campaigns/{cid}/lists/{list_test}/").status_code == 404)

        # ------------------------------------------------------------ checklist, test publish, preview
        draft = new("ZC unpublished content", template=draft_template["id"], contact_lists=[list_test]).json()
        ck = api("get", f"/api/v1/campaigns/{draft['id']}/checklist/").json()
        pub, _ = publish(draft["id"])
        check("production publish validates everything: an unpublished template and a Test list are refused, with the reason on the field; the checklist says so beforehand",
              ck["ready"] is False and "template" in ck["problems"] and pub.status_code == 400 and "draft" in pub.json()["errors"]["template"], str(ck["problems"]))
        with NO_QUIET:
            t_bad = api("post", f"/api/v1/campaigns/{cid}/test-publish/", {"to": ["not-a-number"]})
            t_none = api("post", f"/api/v1/campaigns/{cid}/test-publish/", {})
            t_ok = api("post", f"/api/v1/campaigns/{cid}/test-publish/", {"to": ["+14705550100", "+14705550199"]})
        after_test = get(cid)
        check("test publish: internal recipients only, a test Run is created, the status becomes Test Published, and nothing is recorded as a message",
              t_bad.status_code == 400 and t_none.status_code == 400 and t_ok.status_code == 200 and all(x["ok"] for x in t_ok.json()["results"]) and after_test["status"] == "TEST_PUBLISHED"
              and [run["test_mode"] for run in after_test["runs"]] == [True] and after_test["runs"][0]["status"] == "COMPLETED"
              and sql("SELECT count(*) FROM sms_execution WHERE tenant_id = %s AND campaign_id = %s", [TENANT, cid], True)[0][0] == 0, f"{t_ok.status_code} {after_test['status']}")
        p_sample = api("get", f"/api/v1/campaigns/{cid}/preview/").json()
        p_person = api("get", f"/api/v1/campaigns/{cid}/preview/?party_id=ZC-P01").json()
        people = api("get", f"/api/v1/campaigns/{cid}/sample-customers/").json()
        check("preview: with the catalogue's sample values, or as one customer of the audience would get it; the personalization tags used are listed",
              "Hi" in p_sample["text"] and "Hi Ana." in p_person["text"] and "first_name" in " ".join(p_person["tags_used"]) and any(x["party_id"] == "ZC-P01" for x in people)
              and api("get", f"/api/v1/campaigns/{cid}/preview/?party_id=NOBODY").status_code == 404, p_person["text"])

        p_other = api("get", f"/api/v1/campaigns/{cid}/preview/?template={draft_template['id']}")
        check("preview of a template that is chosen in the form but not saved on the campaign yet (the Template step); a bad id is refused",
              p_other.status_code == 200 and p_other.json()["template"] == "ZC unpublished template" and p_other.json()["status"] == "DRAFT" and p_other.json()["text"].startswith("Hi.")
              and api("get", f"/api/v1/campaigns/{cid}/preview/?template=nonsense").status_code == 400
              and api("get", f"/api/v1/campaigns/{cid}/preview/?template=00000000-0000-4000-8000-000000000000").status_code == 404, p_other.json().get("text"))

        # ------------------------------------------------------------ production publish -> send -> results
        pub, queued = publish(cid)
        live = get(cid)
        check("production publish, send immediately: one Run, handed to the engine after the commit, the campaign is locked for editing", pub.status_code == 201 and queued == 1 and pub.json()["run_type"] == "ONE_TIME"
              and live["status"] == "PRODUCTION_PUBLISHED" and live["published_at"] and set(live["actions"]) == {"pause", "clone", "results", "archive"}
              and api("patch", f"/api/v1/campaigns/{cid}/", {"name": "Too late"}).status_code == 409, f"{pub.status_code} {live['status']}")
        with NO_QUIET:
            sent = engine.process_run(TENANT, pub.json()["id"])
        done = get(cid)
        m = api("get", f"/api/v1/campaigns/{cid}/metrics/").json()
        ts = api("get", f"/api/v1/campaigns/{cid}/metrics/timeseries/?bucket=day").json()
        frozen = api("get", f"/api/v1/campaigns/{cid}/audience/").json()["frozen"]
        check("the send: the Campaign List is frozen when the Run starts, the excluded list and governance are honoured, the campaign completes; the test Run counts for nothing",
              sent["status"] == "COMPLETED" and done["status"] == "COMPLETED" and done["completed_at"] and frozen["members"] == 6 and frozen["eligible"] == 3
              and frozen["suppressed"].get("EXCLUDED_LIST") == 1 and frozen["suppressed"].get("UNSUBSCRIBED", 0) + frozen["suppressed"].get("NO_CONSENT", 0) == 2
              and m["counts"]["sent"] == 3 and m["runs"] == 1 and m["test_runs"] == 1 and done["audience_size"] == 6, json.dumps(frozen))
        check("results: counts, rates, progress against the targets, a time series for the chart", m["rates"]["delivery"] >= 0 and {x["measure"] for x in m["targets"]} == {"Clicks", "Conversions", "Revenue"}
              and m["breakdown"]["by"] == "carrier" and len(ts["points"]) == 1 and ts["points"][0]["sent"] == 3 and ts["bucket"] == "day", json.dumps(m["counts"]))
        log_ = api("get", f"/api/v1/campaigns/{cid}/activity/").json()
        events = [x["event_type"] for x in log_][::-1]
        check("activity log: every step in order, in words, with who did it (the engine's entries are the system's)",
              events == ["CREATED", "LIST_ATTACHED", "LIST_DETACHED", "TEST_PUBLISHED", "PUBLISHED", "SEND_STARTED", "SEND_COMPLETED"]
              and log_[-1]["actor_name"] and [x["actor_name"] for x in log_ if x["event_type"] == "SEND_STARTED"] == ["System"] and "frozen with 6 people" in " ".join(x["message"] for x in log_), str(events))
        export = api("get", f"/api/v1/campaigns/{cid}/audience/export/")
        lines = b"".join(export.streaming_content).decode("utf-8-sig").splitlines()
        check("audience export: the frozen Campaign List with who was left out and why", export.status_code == 200 and len(lines) == 7 and lines[0].startswith("customer_id,first_name")
              and any("EXCLUDED_LIST" in line for line in lines) and "'" not in "".join(lines), f"{len(lines)} lines")

        # ------------------------------------------------------------ scheduled: the derived status, cancel
        later = (timezone.now() + timedelta(days=3)).isoformat()
        sched = new("ZC scheduled texts", send_type="SCHEDULED", scheduled_at=later).json()
        past = new("ZC scheduled in the past", send_type="SCHEDULED").json()
        pub, queued = publish(sched["id"])
        shown = get(sched["id"])
        listed = {x["id"]: x for x in api("get", "/api/v1/campaigns/?status=SCHEDULED").json()["results"]}
        check("scheduled: stored as production published, shown as Scheduled, not handed to the engine yet; a schedule without a future time is refused",
              pub.status_code == 201 and queued == 0 and shown["status"] == "PRODUCTION_PUBLISHED" and shown["display_status"] == "SCHEDULED" and shown["display_status_label"] == "Scheduled"
              and shown["next_run_at"] and set(shown["actions"]) == {"cancel_schedule", "clone", "archive"} and sched["id"] in listed
              and publish(past["id"])[0].json()["errors"].get("scheduled_at"), f"{shown['display_status']}")
        r = api("post", f"/api/v1/campaigns/{sched['id']}/cancel-schedule/")
        check("cancel schedule: the waiting send is cancelled and the campaign is an editable draft again", r.status_code == 200 and r.json()["status"] == "DRAFT"
              and [run["status"] for run in r.json()["runs"]] == ["CANCELLED"] and api("patch", f"/api/v1/campaigns/{sched['id']}/", {"description": "edited"}).status_code == 200
              and api("post", f"/api/v1/campaigns/{sched['id']}/cancel-schedule/").status_code == 409)

        # ------------------------------------------------------------ pause / resume
        big = new("ZC pause me", contact_lists=[list_a, list_b]).json()
        pub, _ = publish(big["id"])
        run_id = pub.json()["id"]
        with NO_QUIET, session.tenant_scope(TENANT):
            started = runs.start(TENANT, run_id)
        paused = api("post", f"/api/v1/campaigns/{big['id']}/pause/")
        with NO_QUIET:
            while_paused = engine.process_run(TENANT, run_id)
        counts_paused = api("get", f"/api/v1/campaigns/{big['id']}/metrics/").json()["counts"]
        with mock.patch("api.v1.views._enqueue_run") as queued:
            resumed = api("post", f"/api/v1/campaigns/{big['id']}/resume/")
        with NO_QUIET:
            finished = engine.process_run(TENANT, run_id)
        from django.core.cache import cache
        cache.clear()                                            # campaign metrics are cached 30 s: the paused figures must not be read back as the final ones
        check("pause stops a send in progress (nothing more goes out, nothing is lost); resume continues where it stopped and the campaign completes",
              paused.status_code == 200 and paused.json()["status"] == "PAUSED" and paused.json()["actions"] == ["resume", "clone", "results", "archive"] and counts_paused["sent"] == 0
              and counts_paused["queued"] == 4 and while_paused["status"] is None and resumed.json()["status"] == "ACTIVE" and finished["status"] == "COMPLETED"
              and api("get", f"/api/v1/campaigns/{big['id']}/metrics/").json()["counts"]["sent"] == 4 and api("post", f"/api/v1/campaigns/{big['id']}/pause/").status_code == 409,
              f"paused actions: {paused.json().get('actions')} status: {paused.json().get('status')} | while_paused: {while_paused.get('status')} | resumed: {resumed.json().get('status')} | finished: {finished['status']} | final sent: {api('get', f'/api/v1/campaigns/{big['id']}/metrics/').json()['counts']['sent']} | second pause: {api('post', f'/api/v1/campaigns/{big['id']}/pause/').status_code}")

        waiting = new("ZC paused before its time", send_type="SCHEDULED", scheduled_at=(timezone.now() + timedelta(hours=1)).isoformat()).json()
        pub, _ = publish(waiting["id"])
        sql("UPDATE campaign SET status = 'PAUSED', previous_status = 'PRODUCTION_PUBLISHED' WHERE id = %s", [waiting["id"]])
        sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [pub.json()["id"]])
        with NO_QUIET:
            held = engine.process_run(TENANT, pub.json()["id"])
        with mock.patch("api.v1.views._enqueue_run"):
            api("post", f"/api/v1/campaigns/{waiting['id']}/resume/")
        with NO_QUIET:
            released = engine.process_run(TENANT, pub.json()["id"])
        check("a send that comes due while its campaign is paused waits, and goes out once the campaign is resumed", held["status"] is None and "paused" in str(held).lower()
              and released["status"] == "COMPLETED", f"{held} -> {released['status']}")

        # ------------------------------------------------------------ recurring and drip: one campaign, several runs
        rec = new("ZC weekly texts", send_type="RECURRING", recurring_config={"frequency": "DAILY", "time": "09:00", "max_runs": 2}).json()
        pub, _ = publish(rec["id"])
        first_run = pub.json()
        sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [first_run["id"]])
        with NO_QUIET:
            engine.process_run(TENANT, first_run["id"])
        obj = Campaign.objects.prefetch_related("campaign_runs").select_related("tenant").get(pk=rec["id"])
        second = service.schedule_next_occurrence(obj)
        again = service.schedule_next_occurrence(Campaign.objects.prefetch_related("campaign_runs").select_related("tenant").get(pk=rec["id"]))
        check("recurring: a Run per occurrence under ONE campaign; the campaign stays active after a send, the next occurrence is created once, never twice",
              first_run["run_type"] == "RECURRING_INSTANCE" and first_run["sequence_label"] == "Occurrence 1" and get(rec["id"])["status"] == "ACTIVE" and second is not None
              and second.sequence_label == "Occurrence 2" and second.scheduled_at > timezone.now() and again is None, f"{first_run['run_type']} second={getattr(second, 'scheduled_at', None)}")
        sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [str(second.pk)])
        with NO_QUIET:
            engine.process_run(TENANT, str(second.pk))
        ended_ = service.schedule_next_occurrence(Campaign.objects.prefetch_related("campaign_runs").select_related("tenant").get(pk=rec["id"]))
        check("the recurrence ends after its number of sends, and the campaign completes", ended_ is None and get(rec["id"])["status"] == "COMPLETED")
        drip = api("post", "/api/v1/campaigns/", {"name": "ZC welcome series", "campaign_type": "DRIP", "channel": "SMS", "template": template["id"], "sender_profile": sender["id"],
                                                  "contact_lists": [list_a], "drip_config": {"steps": [{"day": 0}, {"day": 3}, {"day": 7}], "time": "10:00"},
                                                  "scheduled_at": (timezone.now() + timedelta(days=1)).isoformat()}).json()
        tested_drip = api("post", f"/api/v1/campaigns/{drip['id']}/test-publish/", {"to": ["+14705550100"]})      # a drip publishes once every message is tested
        pub, queued = publish(drip["id"])
        steps = sorted((x for x in get(drip["id"])["runs"] if not x["test_mode"]), key=lambda x: x["run_number"])
        check("drip: the send type follows the campaign type; once every message is tested, publishing plans a Run per step on its day from the start date, at the set time",
              drip["send_type"] == "DRIP" and tested_drip.status_code == 200 and pub.status_code == 201 and [x["sequence_label"] for x in steps] == ["Day 0", "Day 3", "Day 7"]
              and {x["run_type"] for x in steps} == {"DRIP_INSTANCE"} and steps[0]["scheduled_at"] is not None and steps[2]["scheduled_at"] > steps[1]["scheduled_at"] > steps[0]["scheduled_at"]
              and queued == 0, str([drip.get('send_type'), tested_drip.status_code, pub.status_code, [(x['sequence_label'], x['run_type'], x['scheduled_at']) for x in steps], queued]))

        # ------------------------------------------------------------ calendar
        daily = new("ZC daily texts", send_type="RECURRING", recurring_config={"frequency": "DAILY", "time": "09:00"}).json()
        publish(daily["id"])
        today = timezone.localdate()
        cal = api("get", f"/api/v1/campaigns/calendar/?date_from={today.isoformat()}&date_to={(today + timedelta(days=20)).isoformat()}&channel=SMS")
        spans = {x["name"]: x for x in cal.json()["spans"]}
        series, sent_, plan, every_day = spans.get("ZC welcome series", {}), spans.get("ZC Fall texts", {}), spans.get("ZC scheduled texts", {}), spans.get("ZC daily texts", {})
        check("calendar: one span per campaign with its sends: a drip series over its days, a finished send on its day, a draft that plans a date, a recurrence projected ahead and marked as going on",
              cal.status_code == 200 and [x["label"] for x in series["sends"]] == ["Day 0", "Day 3", "Day 7"] and series["end"] > series["start"] and series["ongoing"] is False
              and sent_["display_status"] == "COMPLETED" and [x["state"] for x in sent_["sends"]] == ["SENT"]
              and [x["state"] for x in plan["sends"]] == ["PLANNED"] and plan["display_status"] == "DRAFT"
              and every_day["ongoing"] is True and every_day["end"] is None and sum(1 for x in every_day["sends"] if x["state"] == "PROJECTED") >= 18
              and "ZC half way" not in spans and cal.json()["timezone"], f"{sorted(spans)}")
        check("calendar: the list's filters apply, the window is limited and its dates are checked",
              not [x for x in api("get", f"/api/v1/campaigns/calendar/?date_from={today.isoformat()}&date_to={today.isoformat()}&channel=EMAIL").json()["spans"] if x["name"].startswith("ZC ")]
              and api("get", f"/api/v1/campaigns/calendar/?date_from={today.isoformat()}&date_to={(today + timedelta(days=90)).isoformat()}").status_code == 400
              and api("get", "/api/v1/campaigns/calendar/?date_from=soon&date_to=later").status_code == 400
              and api("get", f"/api/v1/campaigns/calendar/?date_from={today.isoformat()}&date_to={today.isoformat()}", h=HA).status_code == 200)

        # ------------------------------------------------------------ clone, archive, bulk
        r = api("post", f"/api/v1/campaigns/{cid}/clone/")
        copy = r.json()
        check("clone: 'Copy of ...', a draft, with the settings, lists, exclusions and targets; never the runs, results or status",
              r.status_code == 201 and copy["name"] == "Copy of ZC Fall texts" and copy["status"] == "DRAFT" and copy["runs"] == [] and copy["code"] != done["code"]
              and sorted(copy["contact_lists"]) == sorted(done["contact_lists"]) and copy["excluded_lists"] == [list_x] and copy["targets"]["target_clicks"] == 40 and copy["tags"] == ["Fall", "vip"] and copy["setup_complete"] is True
              and api("post", f"/api/v1/campaigns/{cid}/clone/").json()["name"] == "Copy of ZC Fall texts (2)", copy.get("name"))
        r = api("delete", f"/api/v1/campaigns/{copy['id']}/")
        hidden = copy["id"] not in [x["id"] for x in api("get", "/api/v1/campaigns/?page_size=200").json()["results"]]
        shown_ = copy["id"] in [x["id"] for x in api("get", "/api/v1/campaigns/?status=ARCHIVED").json()["results"]]
        un = api("post", f"/api/v1/campaigns/{copy['id']}/unarchive/")
        un_sent = api("post", f"/api/v1/campaigns/{cid}/archive/").status_code, api("post", f"/api/v1/campaigns/{cid}/unarchive/").json()["status"]
        check("archive replaces delete: hidden from the everyday list, kept for reporting; a campaign that never sent is restored as a draft, one that sent stays read-only",
              r.status_code == 204 and hidden and shown_ and un.status_code == 200 and un.json()["status"] == "DRAFT" and un_sent == (200, "COMPLETED"), f"{r.status_code} {un_sent}")
        r = api("post", "/api/v1/campaigns/bulk/", {"action": "clone", "ids": [cid, sched["id"]]})
        r2 = api("post", "/api/v1/campaigns/bulk/", {"action": "archive", "ids": [x["id"] for x in r.json()["done"]]})
        check("bulk: clone several, archive several; each one reports for itself", r.status_code == 200 and len(r.json()["done"]) == 2 and len(r2.json()["done"]) == 2 and r2.json()["skipped"] == [])

        # ------------------------------------------------------------ list view
        base = "/api/v1/campaigns/?search=ZC&page_size=200"
        names = lambda url: [x["name"] for x in api("get", url).json()["results"]]          # noqa: E731
        page = api("get", "/api/v1/campaigns/?search=ZC&page_size=3&page=2").json()
        found = names(base)
        check("list: sorted by name either way", names(base + "&ordering=name") == sorted(found, key=str.lower) and names(base + "&ordering=-name") == sorted(found, key=str.lower, reverse=True),
              str(names(base + "&ordering=name")))
        check("list: filtered by type and channel", names(base + "&type=DRIP") == ["ZC welcome series"] and names(base + "&channel=EMAIL") == [],
              f"{names(base + '&type=DRIP')} {names(base + '&channel=EMAIL')}")
        check("list: filtered by tag, status and trigger", "ZC Fall texts" in names(base + "&tag=vip") and names(base + "&status=PAUSED") == []
              and set(names(base + "&status=COMPLETED")) >= {"ZC Fall texts", "ZC pause me"} and names(base + "&triggered_by=journey") == [],
              f"{names(base + '&tag=vip')} {names(base + '&status=PAUSED')} {names(base + '&status=COMPLETED')} {names(base + '&triggered_by=journey')}")
        check("list: filtered by date range", names(base + f"&date_from={timezone.now().date().isoformat()}") == found and names(base + "&date_to=2020-01-01") == [],
              f"{len(names(base + f'&date_from={timezone.now().date().isoformat()}'))} of {len(found)}; before 2020: {names(base + '&date_to=2020-01-01')}")
        check("list: pages of the asked size, archived hidden, bad filters refused", page["count"] == len(found) and len(page["results"]) == 3 and page["previous"]
              and api("get", base + "&status=NOPE").status_code == 400 and api("get", base + "&date_from=yesterday").status_code == 400, f"{page['count']} vs {len(found)}")
        opts = api("get", "/api/v1/campaigns/form-options/").json()
        check("form options: owners, the tags in use, time zones", any(x["id"] == str(admin.pk) for x in opts["owners"]) and {"Fall", "vip"} <= set(opts["tags"]) and "America/New_York" in opts["timezones"])

        # ------------------------------------------------------------ governance switch, runs, permissions
        service_msg = api("post", "/api/v1/campaigns/", {"name": "ZC order update", "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "solicitation_type": "SERVICE", "template": template["id"],
                                                         "sender_profile": sender["id"], "contact_lists": [list_b]}).json()
        pub, _ = publish(service_msg["id"])
        with NO_QUIET:
            engine.process_run(TENANT, pub.json()["id"])
        sm = api("get", f"/api/v1/campaigns/{service_msg['id']}/audience/").json()
        loud = new("ZC no caps", respect_governance=False).json()
        publish(loud["id"])
        warned = [x for x in api("get", f"/api/v1/campaigns/{loud['id']}/activity/").json() if x["severity"] == "WARNING"]
        check("governance: a service message does not need marketing consent (BRD 12) but an opt-out of texts still holds; switching the frequency limits off is logged as a warning",
              sm["frozen"]["eligible"] == 3 and sm["frozen"]["suppressed"] == {"UNSUBSCRIBED": 1} and sm["marketing"] is False and len(warned) == 1 and "frequency limits are switched off" in warned[0]["message"], json.dumps(sm["frozen"]))
        rd = api("get", f"/api/v1/campaigns/{cid}/runs/").json()
        one = api("get", f"/api/v1/campaigns/{cid}/runs/{rd[0]['id']}/").json()
        check("runs: listed newest first, each with its results and its subject-line variants (none yet: the model does not assume one subject per run, BRD TD-04)",
              [x["run_number"] for x in rd] == sorted([x["run_number"] for x in rd], reverse=True) and one["variants"] == [] and "messages" in one["results"])
        codes = analyst.permission_codes()
        check("permissions: campaign.view reads, campaign.edit writes and clones, campaign.publish publishes and pauses", "campaign.edit" not in codes
              and api("get", f"/api/v1/campaigns/{cid}/metrics/", h=HA).status_code == 200 and api("post", f"/api/v1/campaigns/{cid}/clone/", h=HA).status_code == 403
              and api("post", f"/api/v1/campaigns/{big['id']}/pause/", h=HA).status_code == 403, str(sorted(x for x in codes if x.startswith("campaign"))))

        transaction.set_rollback(True)
    check.done()
