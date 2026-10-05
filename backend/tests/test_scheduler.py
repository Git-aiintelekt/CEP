"""The no-broker scheduler and the run-activity fix, against the real local DB, rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import io
from datetime import timedelta
from unittest import mock
from django.conf import settings
from django.core.management import call_command
from django.db import connection, transaction
from django.utils import timezone
from apps.campaigns.models import Campaign, CampaignRun
from apps.delivery.engine import runs, session
from apps.identity.models import AppUser
from apps.platform_ops.management.commands import run_scheduler
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_scheduler(check):
    """The no-broker scheduler and the run-activity fix, against the real local DB, rolled back."""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email="aby.john@aiintelekt.com")
    context.reset_platform(tok)
    TENANT = str(admin.tenant_id)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    # ---------------------------------------------------------------------------------------------------- the schedule it follows
    runnable = run_scheduler._runnable()
    beat = set(settings.CELERY_BEAT_SCHEDULE)
    check("every beat job but the outbox relay has a way to run without a broker", beat - set(run_scheduler.SKIPPED) <= set(runnable) and "outbox-relay" in run_scheduler.SKIPPED,
          str(sorted(beat - set(runnable))))
    check("campaign runs are processed in-process, not handed to workers", runnable["dispatch-campaign-runs"].__name__ == "dispatch_here")

    # ---------------------------------------------------------------------------------------------------- one pass runs only what is due
    with transaction.atomic():
        calls = []
        fake = {name: (lambda n=name: calls.append(n) or {"ok": n}) for name in runnable}
        now = timezone.now()
        report = [{"name": "rollup-usage", "last_success": now - timedelta(seconds=10)},           # ran a moment ago: not due
                  {"name": "evaluate-alerts", "last_success": now - timedelta(hours=2)},           # overdue
                  {"name": "generate-invoices", "last_success": None}]                             # never ran: due
        out = io.StringIO()
        with mock.patch.object(run_scheduler, "_runnable", return_value=fake), mock.patch("apps.platform_ops.jobs.status_report", return_value=report):
            call_command("run_scheduler", once=True, stdout=out)
        check("a pass runs the overdue and the never-run jobs and leaves the fresh one alone; the relay stays out",
              "evaluate-alerts" in calls and "generate-invoices" in calls and "rollup-usage" not in calls and "outbox-relay" not in calls, str(calls))
        check("the pass says what ran", "evaluate-alerts: {'ok': 'evaluate-alerts'}" in out.getvalue() and "one pass" in out.getvalue(), out.getvalue()[:200])

        def boom():
            raise RuntimeError("provider down")
        fake["evaluate-alerts"] = boom
        out = io.StringIO()
        with mock.patch.object(run_scheduler, "_runnable", return_value=fake), mock.patch("apps.platform_ops.jobs.status_report", return_value=report):
            call_command("run_scheduler", once=True, stdout=out)
        check("one job's failure is reported and does not stop the others", "evaluate-alerts: FAILED RuntimeError: provider down" in out.getvalue() and "generate-invoices" in out.getvalue(), out.getvalue()[:200])

    # ---------------------------------------------------------------------------------------------------- a failed run start records its activity (the row-level policy refused it before)
    with transaction.atomic():
        with session.tenant_scope(TENANT):
            with session.tx():
                campaign = Campaign.objects.filter(tenant_id=TENANT, deleted_at__isnull=True).first()
                run = CampaignRun.objects.create(campaign=campaign, tenant_id=TENANT, run_type="ONE_TIME", status="SCHEDULED", run_number=999, test_mode=False)
            runs._fail(TENANT, run, "The campaign has no usable sender.")      # outside any transaction, as the scheduler and the worker call it
        rows = sql("SELECT event_type, severity, message FROM campaign_activity_log WHERE campaign_run_id = %s", [str(run.pk)], True)
        status = sql("SELECT status FROM campaign_run WHERE id = %s", [str(run.pk)], True)[0][0]
        check("a run that cannot start is FAILED and its activity entry is written under the tenant's transaction",
              status == "FAILED" and rows == [("SEND_FAILED", "ERROR", "Send could not start: The campaign has no usable sender.")], f"{status} {rows}")
        transaction.set_rollback(True)
    check.done()
