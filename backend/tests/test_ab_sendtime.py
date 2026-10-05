"""A/B subject lines and send-time optimisation (patch 0023) against the local database, rolled back. Postal is mocked at the HTTP layer,
texts go through the sandbox engine.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from unittest import mock
import requests
from django.db import connection, transaction
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery import engine
from apps.delivery.engine import abtest, runs, sendtime, session
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.platform_ops import notifications
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_ab_sendtime(check, admin_email):
    """A/B subject lines and send-time optimisation (patch 0023) against the local database, rolled back. Postal is mocked at the HTTP layer,"""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **H)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **H)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    posted = []

    def postal_post(self, url, **kwargs):
        body = kwargs.get("json") or {}
        posted.append({"url": url, "subject": body.get("subject"), "to": body.get("to")})
        r = requests.Response()
        r.status_code, r._content = 200, json.dumps({"status": "success", "time": 0.01, "flags": {}, "data": {"message_id": f"m{len(posted)}@postal.example",
                                                                                                              "messages": {(body.get("to") or ["x"])[0]: {"id": len(posted), "token": "t"}}}}).encode()
        return r

    sent_mail = []
    NO_QUIET = mock.patch.object(runs, "quiet_until", return_value=None)
    SUBJECT_A, SUBJECT_B = "Your fall reward is here", "A reward just landed for you"

    # ---- the rule in Python, no database
    check("zone rule: a state in the US or Canada, a one-zone country, a named zone in the attributes, and nothing for the unknown",
          sendtime.zone_for({"country": "US", "state": "GA"}) == "America/New_York" and sendtime.zone_for({"country": "USA", "state": "ca"}) == "America/Los_Angeles"
          and sendtime.zone_for({"country": "CA", "state": "BC"}) == "America/Vancouver" and sendtime.zone_for({"country": "GB"}) == "Europe/London"
          and sendtime.zone_for({"country": "US"}) is None and sendtime.zone_for({"country": "AU"}) is None
          and sendtime.zone_for({"country": "US", "state": "GA"}, {"timezone": "Asia/Kolkata"}) == "Asia/Kolkata" and sendtime.zone_for(None, {"timezone": "Mars/Olympus"}) is None)
    check("A/B setting validation speaks in words", abtest.validate({"enabled": True}) and "second subject" in abtest.validate({"enabled": True})
          and "10 to 50" in abtest.validate({"enabled": True, "subject_b": "x", "sample_pct": 70}) and abtest.validate({"enabled": False}) is None and abtest.validate(None) is None
          and abtest.validate({"enabled": True, "subject_b": "x", "metric": "REVENUE"}) and abtest.validate({"enabled": True, "subject_b": "x", "decide_after_minutes": 5}))

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(requests.Session, "post", postal_post), \
            mock.patch.object(notifications.mail, "send", side_effect=lambda t, to, ctx, *, subject, tenant_id=None: sent_mail.append({"to": sorted(to), "subject": subject, "lines": ctx.get("lines")}) or True):
        # ---- 30 people: 10 in Georgia, 10 in California, 10 with no address (one of them names a zone)
        people = []
        for n in range(30):
            party = f"ZB-P{n:02d}"
            address = {"city": "Atlanta", "state": "GA", "country": "US"} if n < 10 else {"city": "Los Angeles", "state": "CA", "country": "US"} if n < 20 else None
            attributes = {"timezone": "Asia/Kolkata"} if n == 29 else {}
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones, primary_address, custom_attributes) VALUES (%s, %s, %s, 'Test', %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb)",
                [party, TENANT, f"Person{n}", json.dumps([{"address": f"p{n}@zb.example", "is_primary": True}]), json.dumps([{"number": f"+1470555{2000 + n}", "type": "MOBILE", "is_primary": True}]),
                 json.dumps(address) if address else None, json.dumps(attributes)])
            for channel in ("EMAIL", "SMS"):
                sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, %s, 'OPTED_IN', TRUE, now())", [TENANT, party, channel])
            people.append(party)

        def make_list(name, parties):
            list_id = sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, %s, 'UPLOAD', 'PRODUCTION', %s, %s) RETURNING id",
                          [TENANT, name, len(parties), str(admin.pk)], True)[0][0]
            for party in parties:
                sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, TENANT, party])
            return str(list_id)

        everyone = make_list("ZB everyone", people)
        few = make_list("ZB a few", people[:10])

        # ---- engines: Postal for email (mocked), the sandbox for texts
        postal = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZB Postal", "secret": "postal-key", "config": {"endpoint": "https://postal.zb.example"}}).json()
        email_sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": postal["id"], "display_name": "ZB Shop", "from_address": "news@zb.example"}).json()
        api("post", f"/api/v1/delivery-senders/{email_sender['id']}/verify/", {"to": "me@zb.example"})
        sandbox = api("post", "/api/v1/delivery-providers/", {"provider_type": "SANDBOX_SMS", "name": "ZB sandbox texts", "config": {}}).json()
        text_sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": sandbox["id"], "display_name": "ZB Shop", "sender_id": "55179"}).json()
        api("post", f"/api/v1/delivery-senders/{text_sender['id']}/verify/", {"to": "+14705550100"})
        email_template = api("post", "/api/v1/templates/", {"name": "ZB email", "channel": "EMAIL"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 1, %s, %s, %s)",
            [email_template["id"], SUBJECT_A, "<p>Hi {{first_name}}. <a href=\"{{unsubscribe_url}}\">Unsubscribe</a></p>", "Hi {{first_name}}. {{unsubscribe_url}}"])
        text_template = api("post", "/api/v1/templates/", {"name": "ZB text", "channel": "SMS"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body) VALUES (%s, 1, %s)", [text_template["id"], "ZB Shop: Hi {{first_name}}. Reply STOP to opt out."])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id IN (%s, %s)", [email_template["id"], text_template["id"]])
        posted.clear()

        def new_email(name, lists, **extra):
            return api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": email_template["id"], "sender_profile": email_sender["id"],
                                                      "contact_lists": lists, **extra})

        def publish(cid):
            with mock.patch("api.v1.views._enqueue_run"):
                return api("post", f"/api/v1/campaigns/{cid}/publish/")

        # ---- 1. the setting through the API
        campaign = new_email("ZB Fall Launch", [everyone]).json()
        cid = campaign["id"]
        bad_b = api("patch", f"/api/v1/campaigns/{cid}/", {"ab_config": {"enabled": True}})
        bad_pct = api("patch", f"/api/v1/campaigns/{cid}/", {"ab_config": {"enabled": True, "subject_b": SUBJECT_B, "sample_pct": 70}})
        text_campaign = api("post", "/api/v1/campaigns/", {"name": "ZB text blast", "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "template": text_template["id"],
                                                            "sender_profile": text_sender["id"], "contact_lists": [everyone], "ab_config": {"enabled": True, "subject_b": "x"}})
        good = api("patch", f"/api/v1/campaigns/{cid}/", {"ab_config": {"enabled": True, "subject_b": SUBJECT_B, "sample_pct": 20, "metric": "OPEN_RATE", "decide_after_minutes": 30}})
        check("the subject line test is validated: a second subject is needed, the sample is 10-50%, texts cannot have one; a good setting is saved and logged",
              bad_b.status_code == 400 and "second subject" in str(bad_b.json()["errors"]["ab_config"]) and bad_pct.status_code == 400 and text_campaign.status_code == 400
              and "texts have no subject" in str(text_campaign.json()["errors"]["ab_config"]) and good.status_code == 200 and good.json()["ab_config"]["subject_b"] == SUBJECT_B
              and any("subject line test" in row["message"] for row in api("get", f"/api/v1/campaigns/{cid}/activity/").json()), f"{bad_b.content[:120]} {text_campaign.content[:160]}")

        # ---- 2. the split at the send
        published = publish(cid)
        run_id = published.json()["id"]
        with NO_QUIET:
            first = engine.process_run(TENANT, run_id)
        detail = api("get", f"/api/v1/campaigns/{cid}/runs/{run_id}/").json()
        variants = {v["variant_key"]: v for v in detail["variants"]}
        subjects = [p["subject"] for p in posted]
        check("30 people, a 20% sample: 3 get A, 3 get B, 24 wait; the run stays open; each variant shows its subject, share and figures",
              published.status_code == 201 and first["status"] is None and first["sent"] == 6 and first["queued"] == 24 and set(variants) == {"A", "B"}
              and variants["A"]["subject_line"] == SUBJECT_A and variants["B"]["subject_line"] == SUBJECT_B and variants["A"]["allocation_pct"] == 10.0 and variants["A"]["sent"] == 3
              and variants["B"]["sent"] == 3 and variants["A"]["waiting_for_winner"] == 24 and variants["A"]["decide_at"] and variants["A"]["is_winner"] is None, f"{first} {variants}")
        check("... and Postal was asked for exactly those subjects", subjects.count(SUBJECT_A) == 3 and subjects.count(SUBJECT_B) == 3 and len(posted) == 6, str(subjects))
        started = [row for row in api("get", f"/api/v1/campaigns/{cid}/activity/").json() if row["event_type"] == "SEND_STARTED"][0]["message"]
        check("the activity log says what the test does", "Subject line test: 3 get A, 3 get B, 24 wait for the winner by open rate" in started, started)
        with NO_QUIET:
            again = engine.process_run(TENANT, run_id)
        check("another pass before the decision sends nothing more and leaves the run open", again["status"] is None and again["sent"] == 6 and len(posted) == 6, str(again))

        # ---- 3. the decision
        sql("UPDATE mailer_execution SET status = 'OPENED', opened_at = now() WHERE tenant_id = %s AND campaign_run_id = %s AND variant_key = 'B' AND id IN "
            "(SELECT id FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s AND variant_key = 'B' ORDER BY id LIMIT 2)", [TENANT, run_id, TENANT, run_id])
        sent_mail.clear()
        with session.tenant_scope(TENANT):
            decided = abtest.decide(TENANT, run_id)
        held_now = sql("SELECT variant_key, subject_line, count(*) FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED' GROUP BY 1, 2", [TENANT, run_id], True)
        detail = api("get", f"/api/v1/campaigns/{cid}/runs/{run_id}/").json()
        variants = {v["variant_key"]: v for v in detail["variants"]}
        check("B opened more: B wins, the 24 held messages get subject B, the variants record the figures, the owner is told",
              decided["winner"] == "B" and decided["released"] == 24 and held_now == [("B", SUBJECT_B, 24)] and variants["B"]["is_winner"] is True and variants["A"]["is_winner"] is False
              and variants["B"]["metric_value"] == 66.7 and variants["A"]["metric_value"] == 0.0 and sent_mail and "subject line B won" in sent_mail[0]["subject"]
              and any(row["event_type"] == "AB_WINNER" and "B wins by open rate" in row["message"] for row in api("get", f"/api/v1/campaigns/{cid}/activity/").json()), f"{decided} {held_now} {sent_mail}")
        with NO_QUIET:
            rest = engine.process_run(TENANT, run_id)
        check("the next pass sends the rest with the winning subject and completes the run", rest["status"] == "COMPLETED" and rest["sent"] == 30 and [p["subject"] for p in posted][6:].count(SUBJECT_B) == 24, str(rest))
        twice = api("post", f"/api/v1/campaigns/{cid}/runs/{run_id}/choose-winner/", {"variant": "A"})
        check("choosing again is refused", twice.status_code == 409 and "already chosen" in twice.json()["detail"], twice.content[:160])

        # ---- 4. a person chooses; a tie goes to A; a small audience skips the test
        posted.clear()
        second = new_email("ZB Choose", [everyone], ab_config={"enabled": True, "subject_b": SUBJECT_B, "sample_pct": 40}).json()
        run2 = publish(second["id"]).json()["id"]
        with NO_QUIET:
            engine.process_run(TENANT, run2)
        chosen = api("post", f"/api/v1/campaigns/{second['id']}/runs/{run2}/choose-winner/", {"variant": "A"})
        with NO_QUIET:
            done2 = engine.process_run(TENANT, run2)
        check("a person can choose the winner instead of waiting: A goes to the rest", chosen.status_code == 200 and chosen.json()["winner"] == "A" and chosen.json()["released"] == 18
              and done2["status"] == "COMPLETED" and [p["subject"] for p in posted].count(SUBJECT_A) == 24, f"{chosen.content[:160]} {done2}")
        third = new_email("ZB Tie", [everyone], ab_config={"enabled": True, "subject_b": SUBJECT_B}).json()
        run3 = publish(third["id"]).json()["id"]
        with NO_QUIET:
            engine.process_run(TENANT, run3)
        with session.tenant_scope(TENANT):
            tie = abtest.decide(TENANT, run3)
        check("no difference between the two: A wins, and the log says a tie goes to A", tie["winner"] == "A" and any("a tie goes to A" in row["message"] for row in api("get", f"/api/v1/campaigns/{third['id']}/activity/").json()), str(tie))
        small = new_email("ZB Small", [few], ab_config={"enabled": True, "subject_b": SUBJECT_B}).json()
        run4 = publish(small["id"]).json()["id"]
        posted.clear()
        with NO_QUIET:
            done4 = engine.process_run(TENANT, run4)
        check("fewer than 20 people: no split, everyone gets A at once, and the log says why",
              done4["status"] == "COMPLETED" and done4["sent"] == 10 and [p["subject"] for p in posted].count(SUBJECT_A) == 10 and api("get", f"/api/v1/campaigns/{small['id']}/runs/{run4}/").json()["variants"] == []
              and any("Subject line test skipped" in row["message"] for row in api("get", f"/api/v1/campaigns/{small['id']}/activity/").json()), str(done4))

        # ---- 5. send-time optimisation on a scheduled text campaign
        when = (timezone.now() + timezone.timedelta(minutes=5)).isoformat()
        texts = api("post", "/api/v1/campaigns/", {"name": "ZB local time", "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "template": text_template["id"], "sender_profile": text_sender["id"],
                                                   "contact_lists": [everyone], "send_type": "SCHEDULED", "scheduled_at": when, "send_timezone": "America/New_York", "timezone_optimization": True})
        tid = texts.json()["id"]
        estimate = api("get", f"/api/v1/campaigns/{tid}/audience/").json()
        check("the audience estimate says for how many people the local time is known (addresses in Georgia and California, one named zone)",
              texts.status_code == 201 and estimate["local_time"] == {"people": 30, "local_time_known": 21}, f"{texts.status_code} {estimate.get('local_time')}")
        run5 = publish(tid).json()["id"]
        sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [run5])          # the moment arrives
        with NO_QUIET:
            local = engine.process_run(TENANT, run5)
        waiting = sql("SELECT count(*), min(send_after) - now(), max(send_after) - now() FROM sms_execution WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED'", [TENANT, run5], True)[0]
        started = [row for row in api("get", f"/api/v1/campaigns/{tid}/activity/").json() if row["event_type"] == "SEND_STARTED"][0]["message"]
        hours = waiting[1].total_seconds() / 3600 if waiting[1] else 0
        check("Georgia, the named zone and the unknown go now; California waits until the same wall-clock time three hours later; the run stays open",
              local["status"] is None and local["sent"] == 20 and local["queued"] == 10 and waiting[0] == 10 and 2.9 < hours < 3.1 and "Local send times: 21 people" in started and "9 with no known zone go now" in started,
              f"{local} {waiting} {started}")
        sql("UPDATE sms_execution SET send_after = now() - interval '1 second' WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED'", [TENANT, run5])
        with NO_QUIET:
            later = engine.process_run(TENANT, run5)
        check("when their time comes the rest go out and the run completes", later["status"] == "COMPLETED" and later["sent"] == 30, str(later))

        # ---- the setup's screens (2026-09-29): a test send carries both subjects; the local-time count before the setting is saved
        both = new_email("ZB test both", [everyone], ab_config={"enabled": True, "subject_b": SUBJECT_B}).json()
        posted.clear()
        tested = api("post", f"/api/v1/campaigns/{both['id']}/test-publish/", {"to": ["me@zb.example", "you@zb.example"]})
        answer = tested.json()
        check("with a subject line test, each test address gets [TEST A] and [TEST B], and the answer says which is which",
              tested.status_code == 200 and [(r["to"], r["variant"]) for r in answer["results"]] == [("me@zb.example", "A"), ("me@zb.example", "B"), ("you@zb.example", "A"), ("you@zb.example", "B")]
              and [p["subject"] for p in posted] == [f"[TEST A] {SUBJECT_A}", f"[TEST B] {SUBJECT_B}"] * 2 and answer["status"] == "TEST_PUBLISHED", f"{tested.status_code} {str(answer)[:300]} {posted}")
        plain = new_email("ZB no test", [few]).json()
        posted.clear()
        single = api("post", f"/api/v1/campaigns/{plain['id']}/test-publish/", {"to": ["me@zb.example"]}).json()
        check("without a test it is one [TEST] message, with no variant", [p["subject"] for p in posted] == [f"[TEST] {SUBJECT_A}"] and "variant" not in single["results"][0], str(single)[:200])
        unsaved = api("get", f"/api/v1/campaigns/{plain['id']}/audience/").json()
        counted = api("get", f"/api/v1/campaigns/{both['id']}/audience/?local_time=1").json()
        check("?local_time=1 counts the known zones before the setting is saved; without it, and without the setting, there is no count",
              "local_time" not in unsaved and counted.get("local_time") == {"people": 30, "local_time_known": 21}, f"{counted.get('local_time')}")

        transaction.set_rollback(True)
    check.done()
