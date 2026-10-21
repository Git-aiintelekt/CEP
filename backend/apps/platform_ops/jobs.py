"""Job monitoring: every scheduled job records its runs in job_run, and the health page knows how often each should succeed.

    @monitored("rollup-usage")
    def rollup_usage(): ...

The decorator never changes what the job returns or raises; it only records. Recording failures are swallowed: a
monitoring problem must not stop the job it monitors.
"""
import functools
import logging
import socket
import time
import traceback

from django.conf import settings
from django.db import connections
from django.utils import timezone

log = logging.getLogger("cep.jobs")
P = settings.PLATFORM_ALIAS

# name -> (what it does, the longest healthy gap between two successes in seconds). Keep in step with CELERY_BEAT_SCHEDULE.
JOBS = {
    "outbox-relay": ("Publishes domain events to the stream", 5 * 60),
    "ensure-monthly-partitions": ("Creates next months' partitions for every tenant", 13 * 3600),
    "apply-partition-retention": ("Drops or detaches expired partitions", 49 * 3600),
    "rollup-usage": ("Meters messages, contacts and storage per tenant", 3 * 3600),
    "evaluate-alerts": ("Runs the health checks and notifies on changes", 20 * 60),
    "generate-invoices": ("Drafts last month's invoices", 32 * 24 * 3600),
    "run-tenant-operations": ("Executes requested exports, moves and offboardings", 30 * 60),
    "dispatch-campaign-runs": ("Starts campaign runs that are due and closes finished ones", 10 * 60),
    "plan-recurring-runs": ("Plans the next send of recurring campaigns", 30 * 60),
    "refresh-audience-lists": ("Brings contact lists that follow an audience in line with it", 3 * 3600),
    "process-list-imports": ("Reads, checks and imports uploaded contact list files", 10 * 60),
    "rollup-integration-metrics": ("Rolls the integration log up into per-minute figures and prunes both", 20 * 60),
    "check-engine-health": ("Checks every sending engine's callbacks, refused calls, speed, bounces and receipts (Engine Health)", 30 * 60),
    "check-engines-daily": ("Runs every active sending engine's Check: key and address, nothing sent", 26 * 3600),
    "decide-ab-winners": ("Chooses the subject-line winner of runs whose decision time has come", 10 * 60),
    "send-weekly-reports": ("Emails the weekly report to workspaces that asked for one", 3 * 3600),
    "probe-uptime": ("Calls the uptime targets and alerts when one goes down or comes back", 10 * 60),
    "check-security": ("Looks up this server's packages in OSV.dev and checks its settings and headers (back-office Security)", 49 * 3600),
    "prune-observability": ("Removes errors, request figures and uptime probes past their retention", 49 * 3600),
    "attribute-orders": ("Credits received orders to campaigns and writes each campaign's revenue and ROI", 30 * 60),
    "enroll-journey-customers": ("Enrolls customers who meet a live journey's entry rules", 10 * 60),
    "advance-journey-customers": ("Moves journey customers whose next step is due", 10 * 60),
    "rollup-journey-analytics": ("Rolls journey enrollments and steps up into the reporting tables", 49 * 3600),
    "activate-scheduled-journeys": ("Goes live with journeys approved and scheduled once their time comes", 10 * 60),
    "deliver-report-schedules": ("Emails the Insights reports whose scheduled time has come", 20 * 60),
    "check-report-alerts": ("Checks the Insights alerts that are due and emails the ones that cross their threshold", 20 * 60),
    "refresh-clickhouse-reporting": ("Loads the recent rows into the ClickHouse reporting tables for workspaces on ClickHouse", 2 * 3600),
}
QUIET = {"outbox-relay", "process-list-imports"}                                   # runs every second: only failures and one success a minute are recorded
_last_recorded: dict[str, float] = {}


def _execute(sql, args):
    with connections[P].cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchone() if cursor.description else None


def monitored(name: str):
    assert name in JOBS, f"register {name} in apps.platform_ops.jobs.JOBS"

    def wrap(fn):
        @functools.wraps(fn)
        def run(*args, **kwargs):
            started = time.perf_counter()
            quiet = name in QUIET and time.time() - _last_recorded.get(name, 0) < 60
            run_id = None
            if not quiet:
                try:
                    run_id = _execute("INSERT INTO job_run (job_name, worker) VALUES (%s, %s) RETURNING id", [name, socket.gethostname()[:200]])[0]
                    _last_recorded[name] = time.time()
                except Exception as exc:
                    log.warning("job_run not recorded for %s: %s", name, exc)
            try:
                result = fn(*args, **kwargs)
            except Exception as exc:
                _finish(name, run_id, started, "FAILED", error=f"{exc.__class__.__name__}: {exc}\n{traceback.format_exc()[-1500:]}")
                _record_failure(name, exc)
                raise
            _finish(name, run_id, started, "SUCCEEDED", result=result)
            return result
        run.job_name = name
        return run
    return wrap


def _record_failure(name, exc):
    """The failure goes to the back-office's Errors as a job error; the worker's own log line of it is then not counted twice."""
    try:
        from apps.platform_ops import observe
        frames = observe._frames(exc.__traceback__)
        observe.record_error(source="JOB", kind=f"{type(exc).__module__}.{type(exc).__name__}".removeprefix("builtins."), message=str(exc) or type(exc).__name__,
                             place=f"{name}:{'.'.join(frames[-1])}" if frames else name, culprit=f"Job {name}",
                             stack="".join(traceback.format_exception(type(exc), exc, exc.__traceback__)), context={"job": name})
        exc._cep_recorded = True
    except Exception:                                      # noqa: BLE001
        pass


def _finish(name, run_id, started, status, result=None, error=None):
    import json
    duration = int((time.perf_counter() - started) * 1000)
    try:
        payload = json.dumps(result, default=str)[:4000] if result is not None else None
        if run_id is None:
            if status == "FAILED":                         # a quiet job still records its failures
                _execute("INSERT INTO job_run (job_name, status, finished_at, duration_ms, error, worker) VALUES (%s, 'FAILED', now(), %s, %s, %s)",
                         [name, duration, error, socket.gethostname()[:200]])
            return
        _execute("UPDATE job_run SET status = %s, finished_at = now(), duration_ms = %s, result = %s::jsonb, error = %s WHERE id = %s",
                 [status, duration, payload, error, run_id])
    except Exception as exc:
        log.warning("job_run not completed for %s: %s", name, exc)


def status_report() -> list[dict]:
    """Per known job: last run, last success, and whether it is overdue."""
    with connections[P].cursor() as cursor:
        cursor.execute("""SELECT job_name, max(started_at) FILTER (WHERE status = 'SUCCEEDED'), max(started_at),
                                 (array_agg(status ORDER BY started_at DESC))[1], (array_agg(error ORDER BY started_at DESC))[1],
                                 (array_agg(duration_ms ORDER BY started_at DESC))[1],
                                 count(*) FILTER (WHERE status = 'FAILED' AND started_at > now() - interval '24 hours')
                            FROM job_run WHERE started_at > now() - interval '40 days' GROUP BY 1""")
        seen = {row[0]: row[1:] for row in cursor.fetchall()}
    now = timezone.now()
    report = []
    for name, (purpose, max_gap) in JOBS.items():
        last_ok, last_run, last_status, last_error, duration, failures = seen.get(name, (None, None, None, None, None, 0))
        if last_run is None:
            state = "never"
        elif last_status == "FAILED":
            state = "failed"
        elif last_ok is None or (now - last_ok).total_seconds() > max_gap:
            state = "overdue"
        else:
            state = "ok"
        report.append({"name": name, "purpose": purpose, "state": state, "last_success": last_ok, "last_run": last_run, "last_status": last_status,
                       "last_error": (last_error or "").splitlines()[0][:200] if last_error else None, "duration_ms": duration,
                       "failures_24h": failures, "expected_every_s": max_gap})
    return report


def prune(days: int = 60) -> int:
    with connections[P].cursor() as cursor:
        cursor.execute("DELETE FROM job_run WHERE started_at < now() - make_interval(days => %s)", [days])
        return cursor.rowcount
