"""Everything Celery would do, in one process, for a server without a broker.

    python manage.py run_scheduler              # keep going: campaign runs, list imports, the outbox relay, every scheduled job on its interval
    python manage.py run_scheduler --once       # one pass, then exit (a cron line, or a look)

Each pass: campaign runs that are due are started, sent and closed in this process (what the `campaign` and `email`
workers do); pending list imports are processed; and every job of the Celery beat schedule whose
interval has passed since its last success runs, recorded in job_run exactly as a Celery run would be, so the health
page and the alerts see them. Intervals come from CELERY_BEAT_SCHEDULE, so the two ways of running never drift.

A development box or a single small server runs this as one service beside the API. It is not for a fleet: one
process, no parallel batches, no isolation between jobs. The outbox relay is left out: it publishes to Redis streams,
which such a server does not have.
"""
import logging
import time
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connections
from django.utils import timezone

log = logging.getLogger("cep.scheduler")
# the outbox relay publishes domain events to Redis streams: without a broker there is nothing to relay to, and nothing reads them
SKIPPED = ("outbox-relay",)


def _runnable() -> dict:
    """job name -> what runs it here, without a broker. The campaign dispatcher's own task hands batches to workers, so
    the runs are processed in this process instead (send_campaign_runs does the same by hand)."""
    from apps.delivery import engine
    from apps.delivery.engine import runs
    from apps.platform_ops import jobs
    from workers import journey, lists, maintenance, outbox, platform

    @jobs.monitored("dispatch-campaign-runs")
    def dispatch_here() -> dict:
        started = 0
        for tenant_id, run_id, _status in runs.due():
            engine.process_run(tenant_id, run_id)
            started += 1
        return {"processed": started}

    return {**platform.RUNNABLE, "dispatch-campaign-runs": dispatch_here, "plan-recurring-runs": _plan_recurring, "decide-ab-winners": _decide_ab_winners,
            "send-weekly-reports": _send_weekly_reports,
            "enroll-journey-customers": journey.enroll_customers, "advance-journey-customers": journey.advance_customers,
            "rollup-journey-analytics": journey.rollup_analytics, "activate-scheduled-journeys": journey.activate_scheduled,
            "process-list-imports": lists.process_imports, "outbox-relay": outbox.relay_pending_events,
            "ensure-monthly-partitions": maintenance.ensure_monthly_partitions, "apply-partition-retention": maintenance.apply_partition_retention}


def _plan_recurring() -> dict:
    from workers.campaign import plan_recurring_runs
    return plan_recurring_runs()


def _decide_ab_winners() -> dict:
    from workers.campaign import decide_ab_winners
    return decide_ab_winners()


def _send_weekly_reports() -> dict:
    from workers.reports import send_weekly_reports
    return send_weekly_reports()


class Command(BaseCommand):
    help = "Run campaign sends, list imports and every scheduled job in this process, on their intervals (no Celery needed)."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="one pass, then exit")
        parser.add_argument("--tick", type=float, default=15.0, help="seconds between passes (default 15)")

    def handle(self, *args, once=False, tick=15.0, **options):
        from apps.platform_ops import jobs
        runnable = _runnable()
        schedule = {name: float(entry["schedule"]) for name, entry in settings.CELERY_BEAT_SCHEDULE.items() if name in runnable and name not in SKIPPED}
        # start from the last success on record, so a restart does not re-run every job at once
        last = {report["name"]: report["last_success"] for report in jobs.status_report()}
        self.stdout.write(f"scheduler: {len(schedule)} jobs, a pass every {tick:g}s" + (" (one pass)" if once else ""))
        while True:
            now = timezone.now()
            ran = []
            for name, every in sorted(schedule.items(), key=lambda item: item[1]):
                previous = last.get(name)
                if previous is not None and now - previous < timedelta(seconds=every):
                    continue
                try:
                    result = runnable[name]()
                    last[name] = timezone.now()
                    ran.append(f"{name}: {result}")
                except Exception as exc:                    # noqa: BLE001  one job's failure must not stop the others; job_run holds the details
                    last[name] = timezone.now()
                    log.exception("scheduled job %s failed", name)
                    ran.append(f"{name}: FAILED {exc.__class__.__name__}: {exc}")
            if ran:
                self.stdout.write(f"{timezone.now():%Y-%m-%d %H:%M:%S}  " + " | ".join(ran))
            if once:
                return
            connections.close_all()                      # idle between passes: hold no connection open
            time.sleep(max(1.0, tick))
