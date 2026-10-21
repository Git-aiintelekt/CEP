"""Engine Health (patch 0069): the checks of each sending engine, the job that stores them, the Sending Engines API, the alerts and
the back-office page. Against the local DB, rolled back; the table is a session-temporary copy until the patch is applied."""
import json
import re
import uuid
from datetime import timedelta
from unittest import mock

import pytest
from django.conf import settings
from django.contrib.auth.signals import user_logged_in
from django.contrib.auth.models import update_last_login
from django.db import connection, connections
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.delivery import health
from apps.delivery.engine import session
from apps.delivery.models import DeliveryProvider
from apps.delivery.providers import registry
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.platform_ops import alerts, crypto, jobs

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS
T = {"silence_minutes": 60, "rejection_pct": 1.0, "p95_ms": 5000, "hard_bounce_pct": 2.0, "complaint_pct": 0.1, "sms_failure_pct": 5.0,
     "receipt_wait_minutes": 15, "missing_receipt_pct": 1.0, "min_sample": 50}


class Engine:
    def __init__(self, provider_type="POSTAL", channel="EMAIL", checked_ok=True):
        self.pk, self.tenant_id = uuid.uuid4(), uuid.uuid4()
        self.provider_type, self.channel, self.name = provider_type, channel, provider_type.title()
        self.last_checked_at = timezone.now() - timedelta(hours=3) if checked_ok is not None else None
        self.last_check_ok, self.last_check_error = checked_ok, None if checked_ok else "401 Unauthorized"


def figures(now, **over):
    base = {"integration": True, "calls_1h": 200, "failed_1h": 0, "timed_1h": 200, "p95_ms": 420, "last_refused_at": None, "first_refused_at": None,
            "refused_count": 0, "last_ok_at": now - timedelta(minutes=1), "calls_24h": 3000, "breaker_until": None,
            "last_callback_at": now - timedelta(minutes=2), "callbacks_24h": 3400, "sent_1h": 1240, "awaiting_callback": 0, "sent_24h": 9860,
            "hard_bounces": 40, "complaints": 1, "delivered": 0, "failed_receipts": 0, "no_receipt_24h": 0, "receipt_due": 0, "receipt_missing": 0}
    return {**base, **over}


def by_key(result):
    return {c["key"]: c for c in result["checks"]}


def test_the_checks(check):
    now = timezone.now()
    email, texts = Engine(), Engine("DIGIVIZE", "SMS")

    ok = health.judge(email, figures(now), now, T)
    check("a busy engine with callbacks, quick answers and few bounces is Healthy", ok["status"] == "HEALTHY" and not ok["summary"]
          and {c["state"] for c in ok["checks"]} == {"ok"}, json.dumps(ok)[:400])

    silent = health.judge(email, figures(now, last_callback_at=now - timedelta(minutes=130), awaiting_callback=1240), now, T)
    check("messages waiting and no callback for over an hour is Failing, said in words", silent["status"] == "FAILING"
          and by_key(silent)["callbacks"]["state"] == "failing" and silent["summary"].startswith("No callback for 2 h 10 min while 1,240 messages went out"), silent["summary"])
    never = health.judge(email, figures(now, last_callback_at=None, callbacks_24h=0, awaiting_callback=12), now, T)
    check("an email engine that has never called back while sending is Failing", never["status"] == "FAILING" and "No callback has ever arrived" in never["summary"], never["summary"])
    recent = health.judge(email, figures(now, last_callback_at=now - timedelta(minutes=20), awaiting_callback=300), now, T)
    check("a callback 20 minutes ago is not silence", by_key(recent)["callbacks"]["state"] == "ok")

    refused = health.judge(email, figures(now, last_refused_at=now - timedelta(minutes=3), first_refused_at=now - timedelta(minutes=40), refused_count=14,
                                          last_ok_at=now - timedelta(minutes=50)), now, T)
    check("a 401 after the last good call is Failing: the key was refused", refused["status"] == "FAILING" and refused["summary"].startswith("Key refused: 14 calls answered 401 or 403"),
          refused["summary"])
    fixed = health.judge(email, figures(now, last_refused_at=now - timedelta(minutes=30), first_refused_at=now - timedelta(minutes=40), refused_count=14,
                                        last_ok_at=now - timedelta(minutes=2)), now, T)
    check("a good call after the refusals clears it (a new key, then Check)", by_key(fixed)["refused"]["state"] == "ok", by_key(fixed)["refused"]["summary"])
    breaker = health.judge(email, figures(now, breaker_until=now + timedelta(minutes=2)), now, T)
    check("an open circuit breaker is Failing", by_key(breaker)["refused"]["state"] == "failing" and by_key(breaker)["refused"]["value"] == "Breaker open")
    rate = health.judge(email, figures(now, failed_1h=3, calls_1h=100), now, T)
    check("3% of 100 calls refused or failed needs attention", rate["status"] == "ATTENTION" and by_key(rate)["refused"]["value"] == "3%", by_key(rate)["refused"])
    few = health.judge(email, figures(now, failed_1h=3, calls_1h=40), now, T)
    check("below the minimum sample a rate is not judged", by_key(few)["refused"]["state"] == "ok")

    slow = health.judge(email, figures(now, p95_ms=6800), now, T)
    check("a p95 above 5 s needs attention", by_key(slow)["speed"]["state"] == "attention" and by_key(slow)["speed"]["value"] == "6.8 s", by_key(slow)["speed"])
    hardly = health.judge(email, figures(now, p95_ms=6800, timed_1h=5), now, T)
    check("five timed calls are too few to judge", by_key(hardly)["speed"]["state"] == "quiet")
    tuned = health.judge(email, figures(now, p95_ms=6800), now, {**T, "p95_ms": 10000})
    check("the line comes from the parameters", by_key(tuned)["speed"]["state"] == "ok")

    bounces = health.judge(email, figures(now, sent_24h=18200, hard_bounces=619), now, T)
    check("hard bounces 3.4% need attention", by_key(bounces)["bounces"]["state"] == "attention" and by_key(bounces)["bounces"]["value"].startswith("3.4%")
          and "Hard bounces 3.4% of 18,200" in by_key(bounces)["bounces"]["summary"], by_key(bounces)["bounces"])
    worse = health.judge(email, figures(now, sent_24h=1000, hard_bounces=50), now, T)
    check("at twice the line it is Failing", by_key(worse)["bounces"]["state"] == "failing")
    complaints = health.judge(email, figures(now, sent_24h=2000, hard_bounces=0, complaints=3), now, T)
    check("complaints above 0.1% need attention", by_key(complaints)["bounces"]["state"] == "attention" and "Complaints 0.15%" in by_key(complaints)["bounces"]["summary"],
          by_key(complaints)["bounces"]["summary"])
    small = health.judge(email, figures(now, sent_24h=30, hard_bounces=10), now, T)
    check("ten bounces in thirty test sends are not judged", by_key(small)["bounces"]["state"] == "quiet")

    nothing = health.judge(email, figures(now, calls_1h=0, timed_1h=0, p95_ms=None, calls_24h=0, sent_1h=0, sent_24h=0, hard_bounces=0, complaints=0,
                                          callbacks_24h=0, last_callback_at=now - timedelta(days=2)), now, T)
    check("an engine with nothing sent in a day is Quiet, not Failing", nothing["status"] == "QUIET" and nothing["summary"] == "Nothing sent in the last day.", nothing["summary"])
    check_failed = health.judge(Engine(checked_ok=False), figures(now), now, T)
    check("a failed Check is Failing with its reason", check_failed["status"] == "FAILING" and "failed: 401 Unauthorized" in check_failed["summary"], check_failed["summary"])
    unchecked = health.judge(Engine(checked_ok=None), figures(now), now, T)
    check("an engine never checked is not a problem", unchecked["status"] == "HEALTHY" and by_key(unchecked)["daily_check"]["value"] == "Not yet")

    digivize = health.judge(texts, figures(now, last_callback_at=None, callbacks_24h=0, awaiting_callback=318, sent_24h=318, no_receipt_24h=318), now, T)
    check("a text engine that never sent a receipt gets one standing warning, not a Callbacks failure", digivize["status"] == "ATTENTION" and digivize["standing"]
          and by_key(digivize)["callbacks"]["state"] == "off" and by_key(digivize)["receipts"]["standing"]
          and digivize["summary"].startswith("Digivize has not sent delivery receipts yet, so texts show Sent, not Delivered (318 in the last day)"), digivize["summary"])
    seen = dict(last_callback_at=now - timedelta(minutes=5), delivered=95, failed_receipts=5, receipt_due=100)
    receipts_ok = health.judge(texts, figures(now, **seen, receipt_missing=0), now, T)
    check("once receipts arrive the real checks run, and a full set is Healthy", receipts_ok["status"] == "HEALTHY" and by_key(receipts_ok)["receipts"]["state"] == "ok",
          json.dumps(by_key(receipts_ok)["receipts"]))
    missing = health.judge(texts, figures(now, **seen, receipt_missing=3), now, T)
    check("3 of 100 texts without a receipt after 15 minutes need attention, and that is not standing", missing["status"] == "ATTENTION" and not missing["standing"]
          and "3 of 100 texts sent in the last 2 hours have had no delivery receipt for more than 15 min" in missing["summary"], missing["summary"])
    failing_texts = health.judge(texts, figures(now, last_callback_at=now - timedelta(minutes=5), delivered=88, failed_receipts=12, receipt_due=100), now, T)
    check("12% of receipts failed is Failing (twice the 5% line)", by_key(failing_texts)["bounces"]["state"] == "failing" and by_key(failing_texts)["bounces"]["label"] == "Failed Texts, 24 h")
    check("words: ages, rates and durations", (health.age(timedelta(minutes=130)), health.age(timedelta(seconds=20)), health.pct(0.01), health.pct(3.4), health.duration(420),
                                                health.duration(5000)) == ("2 h 10 min", "less than a minute", "0.01%", "3.4%", "420 ms", "5 s"))
    check.done()


def _temp_table():
    """The app's login has no DDL rights: the table becomes a session-temporary copy (no foreign keys, no policy), found first on the search path."""
    schema = open("../database/CEP_Database_Schema_Platform_Operations.sql", encoding="utf-8").read()
    table = re.search(r"CREATE TABLE IF NOT EXISTS delivery_provider_health \((?:.|\n)*?\n\);", schema).group(0)
    table = re.sub(r" REFERENCES \w+\(id\)( ON DELETE (?:CASCADE|SET NULL))?", "", table).replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE")
    with connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('delivery_provider_health') IS NOT NULL")
        if not cursor.fetchone()[0]:
            cursor.execute(table)


def _log(tenant_id, integration_id, direction, started_at, outcome="OK", status=200, duration=400):
    with connection.cursor() as cursor:
        cursor.execute("""INSERT INTO integration_log (tenant_id, integration_id, direction, kind, system, correlation_id, method, url, response_status, outcome, duration_ms, started_at)
                          VALUES (%s, %s, %s, 'PROVIDER', 'POSTAL', %s, 'POST', '/api/v1/send/message', %s, %s, %s, %s)""",
                       [tenant_id, integration_id, direction, uuid.uuid4().hex, status, outcome, duration, started_at])


def _mail(tenant_id, provider_id, submitted_at, bounce=None):
    with connection.cursor() as cursor:
        cursor.execute("""INSERT INTO mailer_execution (tenant_id, campaign_id, campaign_run_id, party_id, email_address, idempotency_key, status, provider_message_id,
                                                        submitted_at, delivery_provider_id, bounce_type, created_at)
                          VALUES (%s, %s, %s, 'P-HEALTH', 'health@example.com', %s, %s, 'm', %s, %s, %s, %s)""",
                       [tenant_id, str(uuid.uuid4()), str(uuid.uuid4()), uuid.uuid4().hex, "BOUNCED" if bounce else "SUBMITTED", submitted_at, provider_id, bounce, submitted_at])


def test_job_api_alerts_and_page(check, admin_email):
    staff = AppUser.objects.using(P).select_related("tenant").get(email=admin_email)
    tenant = staff.tenant
    tid = str(tenant.id)
    now = timezone.now()
    _temp_table()
    with mock.patch.object(health, "P", "default"), mock.patch.object(logbook, "P", "default"):
        # ---- two engines of the workspace's own: Postal whose webhook went quiet, and a text engine that has never sent a receipt
        with session.tenant_scope(tid), session.tx():
            postal = DeliveryProvider.objects.create(tenant_id=tid, provider_type="POSTAL", channel="EMAIL", name="Health Test Postal",
                                                     config={"endpoint": "https://postal.test"}, secret_enc=crypto.encrypt("good-key"))
            texts = DeliveryProvider.objects.create(tenant_id=tid, provider_type="DIGIVIZE", channel="SMS", name="Health Test Texts",
                                                    config={"endpoint": "https://digivize.test"}, secret_enc=crypto.encrypt("k"))
            integration = logbook.integration_for(tid, kind=logbook.KIND_PROVIDER, system="POSTAL", provider=postal)
            for minute in range(60):
                _log(tid, integration["id"], "OUT", now - timedelta(minutes=minute, seconds=5), duration=300 + minute)
            _log(tid, integration["id"], "IN", now - timedelta(minutes=130))
            for i in range(60):
                _mail(tid, str(postal.pk), now - timedelta(minutes=30, seconds=i))
            for i in range(40):
                _mail(tid, str(postal.pk), now - timedelta(hours=5, seconds=i), bounce="HARD" if i == 0 else None)

        result = health.run(now=now, tenants=[tid])
        check("the job checks every active engine of the workspace", result["engines"] >= 2 and not result["errors"], json.dumps(result, default=str))
        with session.tenant_scope(tid), session.tx():
            stored = health.for_tenant(tid)
        mine = stored.get(str(postal.pk)) or {}
        check("Postal is Failing on Callbacks: 60 messages waiting and the last callback 2 h 10 min ago", mine.get("status") == "FAILING"
              and mine["summary"].startswith("No callback for 2 h 10 min while 60 messages went out"), json.dumps(mine, default=str)[:400])
        figures_postal = {c["key"]: c for c in mine.get("checks", [])}
        check("its figures come from the log and the messages: 60 calls, none refused, 1 hard bounce in 100", figures_postal.get("refused", {}).get("value") == "0%"
              and figures_postal.get("bounces", {}).get("value", "").startswith("1%"), json.dumps(figures_postal.get("bounces")))
        check("the text engine shows the standing receipts warning", (stored.get(str(texts.pk)) or {}).get("standing") is True)

        # ---- the workspace's Sending Engines page
        client = Client()
        jwt = {"HTTP_X_TENANT": tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(staff))}
        listed = {row["id"]: row for row in client.get("/api/v1/delivery-providers/", **jwt).json()}
        shown = (listed.get(str(postal.pk)) or {}).get("health") or {}
        check("the API gives each engine its health with the checks in words", shown.get("status") == "FAILING" and len(shown.get("checks", [])) == 5
              and shown["checks"][0]["label"] == "Callbacks" and "summary" in shown["checks"][0], json.dumps(shown, default=str)[:300])
        check("the text engine's health says No Receipts Yet through the standing flag", (listed.get(str(texts.pk)) or {}).get("health", {}).get("standing") is True)

        # ---- Check: a refused key shows at once as the Daily Check, and a good one clears it
        class Refused:
            detected_config = None

            def check(self):
                return False, "Postal answered 401: the API key was not accepted."
        with mock.patch.object(registry, "for_provider", lambda provider: Refused()):
            answer = client.post(f"/api/v1/delivery-providers/{postal.pk}/check/", **jwt).json()
        listed = {row["id"]: row for row in client.get("/api/v1/delivery-providers/", **jwt).json()}
        daily = {c["key"]: c for c in listed[str(postal.pk)]["health"]["checks"]}["daily_check"]
        check("a failed Check is stored and the engine's health shows it at once", answer == {"ok": False, "detail": "Postal answered 401: the API key was not accepted."}
              and daily["state"] == "failing" and "401" in daily["summary"], json.dumps(daily))

        class Accepted(Refused):
            def check(self):
                return True, ""
        with mock.patch.object(registry, "for_provider", lambda provider: Accepted()):
            done = health.check_all(tenants=[tid])
        with session.tenant_scope(tid), session.tx():
            refreshed = DeliveryProvider.objects.get(pk=postal.pk)
            daily = {c["key"]: c for c in health.for_tenant(tid)[str(postal.pk)]["checks"]}["daily_check"]
        check("the daily job runs every engine's Check and the health follows", done["checked"] >= 2 and not done["failed"] and refreshed.last_check_ok is True
              and daily["state"] == "ok", json.dumps(done))

        # ---- alerts: one per engine and check; the standing one is emailed once and not repeated
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [tid])            # the cross-tenant read runs on this connection here
        found = health.problems()
        name = f"Engine · {tenant.code} · Health Test Postal · Callbacks"
        check("the evaluator gets a Failing alert for Postal's callbacks", found.get(name, ("",))[0] == "FAIL" and found[name][3] is False, str(sorted(found))[:300])
        standing_name = f"Engine · {tenant.code} · Health Test Texts · Receipts"
        check("and a standing warning for the text engine", found.get(standing_name, ("", "", "", False))[0] == "WARN" and found[standing_name][3] is True)

        sent = []
        quick = {"alerts.renotify_minutes": 0, "alerts.recipients": ["ops@example.com"], "alerts.webhook_url": ""}
        with mock.patch.object(alerts, "_problems", lambda: {name: found[name], standing_name: found[standing_name]}), \
                mock.patch.object(alerts.params, "get", lambda key, default=None: quick.get(key, default)), \
                mock.patch.object(alerts.mail, "send", lambda *a, **k: sent.append(a) or True):
            alerts.evaluate()
            alerts.evaluate()
        with connections[P].cursor() as cursor:
            cursor.execute("SELECT check_name, notifications, acknowledged_at IS NOT NULL FROM platform_alert WHERE resolved_at IS NULL AND check_name = ANY(%s)",
                           [[name, standing_name]])
            rows = {row[0]: row[1:] for row in cursor.fetchall()}
        check("the failing alert is repeated while it lasts; the standing one opens acknowledged and is notified once",
              rows.get(name) == (2, False) and rows.get(standing_name) == (1, True) and len(sent) == 2, str(rows))

        # ---- the back-office page
        superuser = AppUser.objects.using(P).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
        if superuser is None:
            pytest.skip("no back-office superuser in this database")
        user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
        try:
            office = Client()
            office.force_login(superuser)
            page = office.get("/admin/delivery/deliveryproviderhealth/")
            body = page.content.decode()
            check("the Engine Health page lists the engines worst first with their reasons", page.status_code == 200 and "Engine Health" in body
                  and f"{tenant.code} · Health Test Postal" in body and "No Receipts Yet" in body and body.index("Health Test Postal") < body.index("Health Test Texts")
                  and "2 h 10 min" in body, f"{page.status_code} {body[:200]}")
            ran = office.post("/admin/delivery/deliveryproviderhealth/run/")
            check("Run Checks Now runs the job and comes back to the page", ran.status_code == 302)
        finally:
            user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    check.done()


def test_before_the_patch_and_the_jobs(check):
    with mock.patch.object(health, "present", lambda alias=None: False):
        check("before patch 0069 the job skips instead of failing", "skipped" in health.run())
        check("and the back-office and the alerts see nothing", health.overview() is None and health.problems() == {})
    from workers import platform as workers
    check("both jobs are registered, monitored and scheduled", {"check-engine-health", "check-engines-daily"} <= set(jobs.JOBS) & set(workers.RUNNABLE)
          and {"check-engine-health", "check-engines-daily"} <= set(settings.CELERY_BEAT_SCHEDULE))
    check.done()
