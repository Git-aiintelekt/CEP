"""Observability on the local copy: errors grouped and reopened, the logging handler, job failures, request figures,
the browser endpoint, uptime with alerts, the health checks, tenant performance and the back-office pages.
observe writes on its own autocommit connection, so every row this test makes is deleted at the end.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
import logging
import uuid
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.core.cache import cache
from django.db import connections
from django.test import Client
from django.utils import timezone
from apps.identity.models import AppUser
from apps.platform_ops import alerts, jobs, observe
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_observability(check):
    """Observability on the local copy: errors grouped and reopened, the logging handler, job failures, request figures,"""
    P = settings.PLATFORM_ALIAS

    def one(sql, args=()):
        with connections[P].cursor() as cursor:
            cursor.execute(sql, args)
            return cursor.fetchone()

    started = timezone.now()
    max_group = one("SELECT coalesce(max(id), 0) FROM error_group")[0]
    paused = []
    max_target = one("SELECT coalesce(max(id), 0) FROM uptime_target")[0]
    tenant = Tenant.objects.using(P).filter(code="NWA").first() or Tenant.objects.using(P).first()
    marker = f"probe-{uuid.uuid4().hex[:8]}"
    evaluations = []
    real_evaluate = alerts.evaluate
    alerts.evaluate = lambda notify=True: evaluations.append(1) or {}
    try:
        # ---- grouping, regression
        first = observe.record_error(source="BACKEND", kind="ValueError", message=f"{marker} bad value 12", place="apps.x.y")
        second = observe.record_error(source="BACKEND", kind="ValueError", message=f"{marker} bad value 13", place="apps.x.y", tenant_id=tenant.id, tenant_code=tenant.code)
        row = one("SELECT occurrences, status, message FROM error_group WHERE id = %s", [first])
        check("the same error in the same place is one group, counted twice, the latest message kept", first == second and row[0] == 2 and row[1] == "OPEN" and row[2].endswith("13"), str(row))
        one("UPDATE error_group SET status = 'RESOLVED', resolved_at = now() WHERE id = %s RETURNING id", [first])
        observe.record_error(source="BACKEND", kind="ValueError", message=f"{marker} again", place="apps.x.y")
        row = one("SELECT status, regressed_at IS NOT NULL, resolved_at FROM error_group WHERE id = %s", [first])
        check("a resolved error that comes back reopens as a regression", row[0] == "OPEN" and row[1] and row[2] is None, str(row))
        other = observe.record_error(source="BACKEND", kind="ValueError", message=f"{marker} no place 41")
        again = observe.record_error(source="BACKEND", kind="ValueError", message=f"{marker} no place 97")
        check("without a place, messages differing only in numbers are one group", other == again and other != first)
        for _ in range(14):
            observe.record_error(source="BACKEND", kind="ValueError", message=f"{marker} burst", place="apps.burst")
        burst = one("SELECT g.occurrences, count(e.id) FROM error_group g JOIN error_event e ON e.group_id = g.id WHERE g.message LIKE %s GROUP BY g.id", [f"{marker} burst"])
        check("every occurrence is counted, at most ten a minute are stored", burst == (14, 10), str(burst))

        # ---- the logging handler and jobs
        workspace = {"id": str(tenant.id), "code": tenant.code}

        class FakeRequest:
            method, path = "POST", "/api/v1/campaigns/"
            tenant = workspace
            user = None
            resolver_match = type("M", (), {"route": "campaigns/"})()
        try:
            raise KeyError(f"{marker} handler")
        except KeyError:
            logging.getLogger("django.request").error("Internal Server Error: %s", "/api/v1/campaigns/", exc_info=True, extra={"request": FakeRequest()})
        row = one("""SELECT g.source, g.kind, g.culprit, e.tenant_code, e.method, e.status_code, e.stack LIKE '%%KeyError%%' FROM error_group g JOIN error_event e ON e.group_id = g.id
                  WHERE g.message LIKE %s ORDER BY e.id DESC LIMIT 1""", [f"%{marker} handler%"])
        check("an ERROR log with an exception is recorded with its request, tenant and stack", row and row[0] == "BACKEND" and row[1] == "KeyError" and row[2] == "POST /campaigns/"
              and row[3] == tenant.code and row[4] == "POST" and row[5] == 500 and row[6], str(row))
        logging.getLogger("apps.something").error(f"{marker} no exception here")
        check("an ERROR without an exception stays in the log only", one("SELECT count(*) FROM error_group WHERE message LIKE %s", [f"%{marker} no exception%"])[0] == 0)

        @jobs.monitored("prune-observability")
        def failing_job():
            raise RuntimeError(f"{marker} job broke")
        caught = None
        try:
            failing_job()
        except RuntimeError as exc:
            caught = exc
        row = one("SELECT source, culprit, occurrences FROM error_group WHERE message = %s", [f"{marker} job broke"])
        check("a failing job is recorded once as a job error and marked so the worker's log line is not counted again",
              row == ("JOB", "Job prune-observability", 1) and getattr(caught, "_cep_recorded", False), str(row))
        logging.getLogger("celery.app.trace").error("Task failed", exc_info=(type(caught), caught, caught.__traceback__))
        check("the worker's own log line of it adds nothing", one("SELECT sum(occurrences) FROM error_group WHERE message = %s", [f"{marker} job broke"])[0] == 1)
        one("DELETE FROM job_run WHERE job_name = 'prune-observability' AND started_at >= %s RETURNING 1", [started])

        # ---- request figures
        check("p95 from the buckets, interpolated inside the bucket", observe.percentile([90, 5, 3, 2, 0, 0, 0, 0, 0]) == 100 and observe.percentile([0] * 9) is None
              and observe.percentile([0, 0, 0, 0, 0, 0, 0, 0, 4]) == 10000 and observe.percentile([0, 0, 0, 0, 0, 100, 0, 0, 0]) == 2425,
              str([observe.percentile([0, 0, 0, 0, 0, 100, 0, 0, 0])]))
        fake = str(uuid.uuid4())
        minute = timezone.now().replace(second=0, microsecond=0)
        for ms, status in ((30, 200), (80, 200), (700, 404), (3000, 500)):
            observe.add_request(fake, "GET", "/probe/", status, ms, minute)
        observe.flush_metrics()
        observe.add_request(fake, "GET", "/probe/", 200, 20, minute)
        observe.flush_metrics()
        row = one("SELECT requests, client_errors, server_errors, max_ms, histogram FROM request_metric WHERE tenant_id = %s", [fake])
        check("figures from two flushes add up in one row, histogram included", row == (5, 1, 1, 3000, [2, 1, 0, 0, 1, 0, 1, 0, 0]), str(row))
        one("DELETE FROM request_metric WHERE tenant_id = %s RETURNING 1", [fake])

        client = Client()
        client.get("/api/v1/campaigns/", HTTP_X_TENANT=tenant.code)
        client.get("/healthz")
        observe.flush_metrics()
        row = one("SELECT route, requests, client_errors FROM request_metric WHERE tenant_id = %s AND bucket_start >= date_trunc('minute', %s::timestamptz) AND route LIKE '%%/campaigns/'",
                  [str(tenant.id), started])
        check("a real request is counted under its tenant and its route pattern; health checks are not", row is not None and row[1] >= 1 and row[2] >= 1
              and one("SELECT count(*) FROM request_metric WHERE route LIKE '%%healthz%%' AND bucket_start >= date_trunc('minute', %s::timestamptz)", [started])[0] == 0, str(row))

        # ---- the browser endpoint
        cache.clear()
        report = {"kind": "TypeError", "message": f"{marker} cannot read x of undefined", "stack": "TypeError: boom\n    at renderRow (https://app/assets/index-abc.js:1:2)",
                  "page": "/campaigns/0b9a3f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/edit?tab=1", "how": "boundary", "component_stack": "\n    at Row\n    at Table", "release": "abc123"}
        response = client.post("/api/v1/client-errors/", json.dumps(report), content_type="application/json", HTTP_X_TENANT=tenant.code)
        row = one("""SELECT g.source, g.culprit, e.tenant_code, e.release, e.context->>'how', e.stack LIKE '%%Component stack%%' FROM error_group g JOIN error_event e ON e.group_id = g.id
                  WHERE g.message = %s""", [report["message"]])
        check("a browser report is recorded with its page as a pattern, tenant, release and component stack", response.status_code == 204
              and row == ("BROWSER", "Page /campaigns/:id/edit", tenant.code, "abc123", "boundary", True), f"{response.status_code} {row}")
        report["page"] = "/campaigns/11111111-2222-4333-8444-555555555555/edit"
        client.post("/api/v1/client-errors/", json.dumps(report), content_type="application/json")
        check("the same crash on another campaign is the same error", one("SELECT occurrences FROM error_group WHERE message = %s", [report["message"]])[0] == 2)
        check("a report without a message is refused", client.post("/api/v1/client-errors/", "{}", content_type="application/json").status_code == 400)
        check("a report that is not JSON is refused", client.post("/api/v1/client-errors/", "nope", content_type="application/json").status_code == 400)
        check("a report over 16 KB is refused", client.post("/api/v1/client-errors/", json.dumps({"message": "x" * 17000}), content_type="application/json").status_code == 413)
        check("GET is not allowed", client.get("/api/v1/client-errors/").status_code == 405)
        codes = [client.post("/api/v1/client-errors/", json.dumps({"message": f"{marker} flood"}), content_type="application/json").status_code for _ in range(30)]
        check("more than 30 reports a minute from one address are refused", 429 in codes and codes.count(204) < 30, str(codes[-3:]))
        cache.clear()

        # ---- the Errors check
        status = observe.check_errors()
        check("new errors in the last hour make the Errors check ask for attention", status["status"] in ("warn", "fail") and status["name"] == "Errors", status["summary"])

        # ---- uptime
        one("INSERT INTO uptime_target (name, url, expect_text) VALUES (%s, 'https://probe.test/', 'ready') RETURNING id", [marker])
        target = one("SELECT id FROM uptime_target WHERE name = %s", [marker])[0]
        with connections[P].cursor() as cursor:
            cursor.execute("UPDATE uptime_target SET is_active = false WHERE id <> %s AND id <= %s AND is_active RETURNING id", [target, max_target])
            paused = [r[0] for r in cursor.fetchall()]

        class Answer:
            def __init__(self, status, text):
                self.status_code, self.text = status, text

        class Session:
            def __init__(self, answers):
                self.answers = list(answers)

            def get(self, url, **kwargs):
                answer = self.answers.pop(0)
                if isinstance(answer, Exception):
                    raise answer
                return answer

        observe.probe_uptime(Session([Answer(200, "all ready")]))
        row = one("SELECT state, consecutive_failures FROM uptime_target WHERE id = %s", [target])
        check("a first success marks the target up without an alert run", row == ("UP", 0) and not evaluations, str(row))
        observe.probe_uptime(Session([Answer(200, "maintenance")]))
        row = one("SELECT state, consecutive_failures, last_error FROM uptime_target WHERE id = %s", [target])
        check("one failure (missing text) is counted but not yet down", row[0] == "UP" and row[1] == 1 and "does not contain" in row[2] and not evaluations, str(row))
        observe.probe_uptime(Session([ConnectionError("refused")]))
        row = one("SELECT state, consecutive_failures FROM uptime_target WHERE id = %s", [target])
        check("the second failure in a row marks it down and runs the alert evaluation", row == ("DOWN", 2) and len(evaluations) == 1, str(row))
        status = observe.check_uptime()
        check("the Uptime check fails and names the target", status["status"] == "fail" and marker in status["summary"], status["summary"])
        observe.probe_uptime(Session([Answer(503, "")]))
        check("a further failure while down runs no new evaluation", len(evaluations) == 1)
        observe.probe_uptime(Session([Answer(200, "ready")]))
        row = one("SELECT state FROM uptime_target WHERE id = %s", [target])
        check("the first success brings it back up and runs the evaluation again", row == ("UP",) and len(evaluations) == 2)
        figures = observe.availability(target, 24)
        check("availability: 2 of 5 probes succeeded", figures["checks"] == 5 and figures["percent"] == 40.0, str(figures))
        check("the Uptime check passes again", observe.check_uptime()["status"] == "ok")

        # ---- tenant performance
        cache.clear()
        rows = observe.tenant_performance(24)
        mine = next((r for r in rows if r["code"] == tenant.code), None)
        check("tenant performance has a row per tenant with requests, sends and errors", mine is not None and mine["requests"] >= 1 and mine["error_events"] >= 1
              and mine["grade"] in ("ok", "warn", "bad") and {"p95_ms", "bounce_rate", "integration_failure_rate", "slowest"} <= set(mine), str(mine)[:300])
        detail = observe.tenant_detail(tenant.id, 24)
        check("a tenant's detail has hourly figures, its routes and its errors", detail["hourly"] and detail["routes"] and detail["errors"], str(detail["routes"][:1]))

        # ---- health collect includes both checks
        from apps import platform_health
        names = [c["name"] for c in platform_health.collect(include_jobs=False)["checks"]]
        check("the health page and the alerts run the Errors and Uptime checks", "Errors" in names and "Uptime" in names)

        # ---- back-office pages
        staff = AppUser.objects.using(P).filter(is_staff=True, is_active=True).order_by("created_at").first()
        user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
        admin = Client()
        admin.force_login(staff)
        page = admin.get("/admin/platform_ops/errorgroup/")
        body = page.content.decode()
        check("Errors lists open errors by default, with the sidebar entries", page.status_code == 200 and f"{marker} cannot read" in body and "Tenant performance" in body
              and "monitor_heart" in body, str(page.status_code))
        page = admin.get(f"/admin/platform_ops/errorgroup/?state=resolved&q={marker}")
        check("the state filter shows resolved errors only", page.status_code == 200 and f"{marker} cannot read" not in page.content.decode())
        gid = one("SELECT id FROM error_group WHERE message = %s", [report["message"]])[0]
        page = admin.get(f"/admin/platform_ops/errorgroup/{gid}/change/")
        body = page.content.decode()
        check("an error's page shows the occurrences, the stack and the tenant", page.status_code == 200 and "Recent occurrences" in body and "renderRow" in body and tenant.code in body)
        page = admin.post(f"/admin/platform_ops/errorgroup/{gid}/change/", {"do": "resolve", "note": "fixed in PR"})
        row = one("SELECT status, note, resolved_by IS NOT NULL FROM error_group WHERE id = %s", [gid])
        check("Resolve with a note from the error's page", page.status_code == 302 and row == ("RESOLVED", "fixed in PR", True), str(row))
        page = admin.get("/admin/platform_ops/uptimetarget/")
        check("Uptime lists the targets with availability", page.status_code == 200 and marker in page.content.decode() and "30 days" in page.content.decode())
        page = admin.get(f"/admin/platform_ops/uptimetarget/{target}/change/")
        check("a target's page shows availability and recent probes", page.status_code == 200 and "Availability" in page.content.decode() and "probe.test" in page.content.decode())
        page = admin.get("/admin/tenants/tenant/performance/?window=7d")
        body = page.content.decode()
        check("Tenant performance lists the tenants for the chosen period", page.status_code == 200 and tenant.name in body and 'aria-current="page">Last 7 days' in body, str(page.status_code))
        page = admin.get(f"/admin/tenants/tenant/{tenant.id}/performance/")
        body = page.content.decode()
        check("a tenant's performance page has requests per hour, endpoints and errors", page.status_code == 200 and "Requests per hour" in body and "Endpoints" in body and "/campaigns" in body)
        page = admin.get(f"/admin/tenants/tenant/{tenant.id}/change/")
        check("the tenant's page carries the performance panel", page.status_code == 200 and "Open performance" in page.content.decode())
        check("an unknown tenant's performance is a 404", admin.get(f"/admin/tenants/tenant/{uuid.uuid4()}/performance/").status_code == 404)
        check("pages are staff only", Client().get("/admin/tenants/tenant/performance/").status_code == 302)

        # ---- prune
        result = observe.prune()
        check("prune reports what it removed", set(result) == {"error_events", "error_groups", "request_metrics", "uptime_checks"}, str(result))
    finally:
        alerts.evaluate = real_evaluate
        with connections[P].cursor() as cursor:
            cursor.execute("DELETE FROM error_group WHERE id > %s", [max_group])
            cursor.execute("DELETE FROM uptime_target WHERE id > %s", [max_target])
            if paused:
                cursor.execute("UPDATE uptime_target SET is_active = true WHERE id = ANY(%s)", [paused])
            cursor.execute("DELETE FROM request_metric WHERE bucket_start >= date_trunc('minute', %s::timestamptz)", [started])
            cursor.execute("DELETE FROM job_run WHERE job_name = 'prune-observability' AND started_at >= %s", [started])
    check.done()
