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
}
QUIET = {"outbox-relay"}                                   # runs every second: only failures and one success a minute are recorded
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
                raise
            _finish(name, run_id, started, "SUCCEEDED", result=result)
            return result
        run.job_name = name
        return run
    return wrap


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
