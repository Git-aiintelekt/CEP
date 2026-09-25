"""Per-minute figures per integration, and the status a settings page shows. Runs on the platform connection: it reads
across tenants (the pool holds every shared workspace's log; a dedicated database is rolled up through its own alias)."""
import time
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import connections
from django.utils import timezone

from apps.platform_ops import params

from . import logbook

P = settings.PLATFORM_ALIAS
ROLLUP_SQL = """
    INSERT INTO integration_metric (tenant_id, integration_id, bucket_start, calls, ok, rejected, retried, errors, throttled,
                                    duration_p50_ms, duration_p95_ms, duration_max_ms, bytes_in, bytes_out, updated_at)
    SELECT tenant_id, integration_id, date_trunc('minute', started_at),
           count(*), count(*) FILTER (WHERE outcome = 'OK'), count(*) FILTER (WHERE outcome = 'REJECTED'), count(*) FILTER (WHERE outcome = 'RETRY'),
           count(*) FILTER (WHERE outcome IN ('ERROR', 'BREAKER', 'PAUSED')), count(*) FILTER (WHERE outcome = 'THROTTLED'),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int, max(duration_ms),
           sum(CASE WHEN direction = 'IN' THEN request_bytes ELSE response_bytes END), sum(CASE WHEN direction = 'IN' THEN response_bytes ELSE request_bytes END), now()
      FROM integration_log
     WHERE started_at >= %s AND started_at < %s AND integration_id IS NOT NULL
     GROUP BY 1, 2, 3
    ON CONFLICT (tenant_id, integration_id, bucket_start) DO UPDATE
       SET calls = EXCLUDED.calls, ok = EXCLUDED.ok, rejected = EXCLUDED.rejected, retried = EXCLUDED.retried, errors = EXCLUDED.errors,
           throttled = EXCLUDED.throttled, duration_p50_ms = EXCLUDED.duration_p50_ms, duration_p95_ms = EXCLUDED.duration_p95_ms,
           duration_max_ms = EXCLUDED.duration_max_ms, bytes_in = EXCLUDED.bytes_in, bytes_out = EXCLUDED.bytes_out, updated_at = now()
     WHERE integration_metric.calls IS DISTINCT FROM EXCLUDED.calls OR integration_metric.errors IS DISTINCT FROM EXCLUDED.errors
        OR integration_metric.throttled IS DISTINCT FROM EXCLUDED.throttled OR integration_metric.duration_p95_ms IS DISTINCT FROM EXCLUDED.duration_p95_ms"""


def _aliases() -> list[str]:
    """The pool, plus every dedicated database this process knows: each holds its own tenants' log."""
    from apps.tenants.models import TenantDatabase
    found = [P]
    for td in TenantDatabase.objects.using(settings.CONTROL_PLANE_ALIAS).filter(isolation_mode="DEDICATED", status="ACTIVE"):
        if td.db_alias in settings.DATABASES and td.db_alias not in found:
            found.append(td.db_alias)
    return found


def rollup(minutes_back: int = 15, now=None) -> dict:
    """Recomputes the last `minutes_back` minute buckets from the log (idempotent: a re-run converges), then prunes."""
    now = now or timezone.now()
    since = (now - timedelta(minutes=minutes_back)).replace(second=0, microsecond=0)
    until = now + timedelta(minutes=1)
    written = 0
    for alias in _aliases():
        with connections[alias].cursor() as cursor:
            cursor.execute(ROLLUP_SQL, [since, until])
            written += cursor.rowcount
    return {"since": since.isoformat(), "buckets": written, **prune(now)}


def prune(now=None) -> dict:
    """Retention, on the platform connection: buckets past integrations.metric_retention_months, log rows past a shorter per-integration retention."""
    now = now or timezone.now()
    months = int(params.get("integrations.metric_retention_months", 13))
    with connections[P].cursor() as cursor:
        cursor.execute("DELETE FROM integration_metric WHERE bucket_start < %s", [now - timedelta(days=31 * months)])
        pruned = cursor.rowcount
    return {"metrics_pruned": pruned, "log_rows_pruned": logbook.prune_logs(now)}


def _breaker_open(integration_id: str) -> int:
    until = cache.get(f"cep:breaker:{integration_id}:open")
    return max(0, int(float(until) - time.time())) if until else 0


def health_of(row: dict) -> str:
    """paused > circuit_open > degraded (error rate) > idle (no calls) > healthy"""
    if row["status"] == "PAUSED":
        return "paused"
    if row.get("breaker_open_seconds"):
        return "circuit_open"
    calls = row.get("calls_24h") or 0
    if calls == 0:
        return "idle"
    failures = (row.get("errors_24h") or 0) + (row.get("retried_24h") or 0)
    if calls >= 20 and failures * 100 / calls >= 5:
        return "degraded"
    return "healthy"


def status(tenant_id, hours: int = 24) -> list[dict]:
    """What the settings page and the back-office list show: one line per integration with the last day's figures."""
    from apps.tenants import context
    alias = context.current().db_alias if context.current() else P
    since = timezone.now() - timedelta(hours=hours)
    with connections[alias].cursor() as cursor:
        cursor.execute("""SELECT i.id, i.kind, i.name, i.direction, i.system, i.status, i.environment, i.delivery_provider_id, i.throttle_per_minute,
                                 i.throttle_burst, i.log_level, i.log_retention_days, i.last_call_at, i.last_outcome, i.last_error, i.breaker_failures,
                                 i.breaker_cooldown_seconds,
                                 COALESCE(sum(m.calls), 0), COALESCE(sum(m.ok), 0), COALESCE(sum(m.rejected), 0), COALESCE(sum(m.retried), 0),
                                 COALESCE(sum(m.errors), 0), COALESCE(sum(m.throttled), 0), max(m.duration_p95_ms), max(m.duration_max_ms),
                                 COALESCE(sum(m.bytes_in), 0), COALESCE(sum(m.bytes_out), 0)
                            FROM integration i
                            LEFT JOIN integration_metric m ON m.tenant_id = i.tenant_id AND m.integration_id = i.id AND m.bucket_start >= %s
                           WHERE i.tenant_id = %s
                           GROUP BY i.id ORDER BY i.direction, i.kind, i.name""", [since, str(tenant_id)])
        rows = cursor.fetchall()
    keys = ("id", "kind", "name", "direction", "system", "status", "environment", "delivery_provider_id", "throttle_per_minute", "throttle_burst", "log_level",
            "log_retention_days", "last_call_at", "last_outcome", "last_error", "breaker_failures", "breaker_cooldown_seconds",
            "calls_24h", "ok_24h", "rejected_24h", "retried_24h", "errors_24h", "throttled_24h", "p95_ms", "max_ms", "bytes_in_24h", "bytes_out_24h")
    out = []
    for values in rows:
        row = dict(zip(keys, values))
        row["id"] = str(row["id"])
        row["delivery_provider_id"] = str(row["delivery_provider_id"]) if row["delivery_provider_id"] else None
        for key in ("calls_24h", "ok_24h", "rejected_24h", "retried_24h", "errors_24h", "throttled_24h", "bytes_in_24h", "bytes_out_24h"):
            row[key] = int(row[key] or 0)
        row["breaker_open_seconds"] = _breaker_open(row["id"])
        row["error_rate_24h"] = round((row["errors_24h"] + row["retried_24h"]) * 100 / row["calls_24h"], 1) if row["calls_24h"] else 0.0
        if row["direction"] == "IN":
            row["effective_limit_per_minute"] = logbook.inbound_limit(tenant_id, {"throttle_per_minute": row["throttle_per_minute"]})
        row["health"] = health_of(row)
        out.append(row)
    return out


def series(tenant_id, integration_id: str, hours: int = 24, step_minutes: int = 15) -> list[dict]:
    """Buckets of `step_minutes` for a chart: calls, failures, throttled, p95."""
    from apps.tenants import context
    alias = context.current().db_alias if context.current() else P
    since = timezone.now() - timedelta(hours=hours)
    with connections[alias].cursor() as cursor:
        cursor.execute("""SELECT to_timestamp(floor(extract(epoch FROM bucket_start) / (%s * 60)) * %s * 60) AS b, sum(calls), sum(ok), sum(rejected),
                                 sum(retried) + sum(errors), sum(throttled), max(duration_p95_ms)
                            FROM integration_metric WHERE tenant_id = %s AND integration_id = %s AND bucket_start >= %s
                           GROUP BY 1 ORDER BY 1""", [step_minutes, step_minutes, str(tenant_id), integration_id, since])
        return [{"bucket": row[0], "calls": int(row[1]), "ok": int(row[2]), "rejected": int(row[3]), "failed": int(row[4]), "throttled": int(row[5]),
                 "p95_ms": row[6]} for row in cursor.fetchall()]


def platform_problems(minutes: int = 15) -> list[dict]:
    """For the health page and the alert evaluator: integrations failing hard right now, across tenants."""
    since = timezone.now() - timedelta(minutes=minutes)
    with connections[P].cursor() as cursor:
        cursor.execute("""SELECT t.code, i.name, i.system, sum(m.calls), sum(m.errors) + sum(m.retried), sum(m.throttled), i.id, i.status
                            FROM integration_metric m JOIN integration i ON i.id = m.integration_id JOIN tenant t ON t.id = i.tenant_id
                           WHERE m.bucket_start >= %s GROUP BY t.code, i.id, i.name, i.system, i.status""", [since])
        rows = cursor.fetchall()
    found = []
    for code, name, system, calls, failed, throttled, integration_id, status in rows:
        calls, failed, throttled = int(calls or 0), int(failed or 0), int(throttled or 0)
        if _breaker_open(str(integration_id)):
            found.append({"tenant": code, "integration": name, "system": system, "problem": "circuit open", "calls": calls, "failed": failed})
        elif calls >= 20 and failed * 100 / calls >= 25:
            found.append({"tenant": code, "integration": name, "system": system, "problem": f"{failed} of {calls} calls failed", "calls": calls, "failed": failed})
    return found
