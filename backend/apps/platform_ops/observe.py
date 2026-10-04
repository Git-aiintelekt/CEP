"""Observability: errors grouped by fingerprint, per-minute request figures per tenant, uptime probes.

  record_error(...)           an error from the API, a job or the browser -> error_group (counted) + error_event (sampled)
  ErrorCaptureHandler         a logging handler: every ERROR with an exception (Django's request errors, jobs, workers) is recorded
  RequestMetricsMiddleware    times every request; the figures are added up in memory and flushed to request_metric every 30 s
  probe_uptime()              the probe-uptime job: calls each uptime target, marks it UP / DOWN, alerts on a change
  check_errors(), check_uptime()   health checks, so the home page and the alerts pick them up
  tenant_performance(), tenant_detail()   what the back-office's Tenant performance page shows
  prune()                     the prune-observability job

Writes go through a connection of their own (autocommit, outside any request transaction), so an error is kept even when
the request that raised it is rolled back. Nothing here may raise into the work it observes.
"""
import hashlib
import json
import logging
import threading
import time
import traceback
from datetime import datetime, timedelta

from django.conf import settings
from django.utils import timezone

log = logging.getLogger("cep.observe")
NO_TENANT = "00000000-0000-0000-0000-000000000000"
BOUNDS_MS = (50, 100, 250, 500, 1000, 2500, 5000, 10000)          # the histogram's upper bounds; a ninth bucket holds the rest
SKIP_PREFIXES = ("/static/", "/media/", "/healthz", "/favicon", "/api/v1/client-errors/")
STACK_MAX = 16_000
EVENTS_PER_MINUTE = 10                                              # occurrences of one group stored per minute; the rest are only counted
FLUSH_EVERY_S = 30

_local = threading.local()
_lock = threading.Lock()
_buckets: dict = {}
_flusher: threading.Thread | None = None


# ---------------------------------------------------------------------------------------------------- the connection
def _cursor():
    """A connection of this thread's own, autocommit: independent of the request's transaction and of the ORM's.
    A broken one is dropped by _forget() and opened again on the next call."""
    from django.db import connections
    conn = getattr(_local, "conn", None)
    if conn is None or conn.connection is None or conn.connection.closed:
        conn = connections.create_connection(settings.PLATFORM_ALIAS)
        conn.ensure_connection()
        conn.set_autocommit(True)
        _local.conn = conn
    return conn.cursor()


def _forget():
    conn = getattr(_local, "conn", None)
    _local.conn = None
    if conn is not None:
        try:
            conn.close()
        except Exception:                                           # noqa: BLE001
            pass


# ---------------------------------------------------------------------------------------------------- errors
def _frames(tb) -> list[tuple[str, str]]:
    """(module, function) of the frames in our own code, innermost last; library frames are left out of the fingerprint."""
    root = str(settings.BASE_DIR)
    out = []
    for frame in traceback.extract_tb(tb) if tb else []:
        if frame.filename.startswith(root) and "site-packages" not in frame.filename:
            module = frame.filename[len(root):].lstrip("\\/").replace("\\", "/").removesuffix(".py").replace("/", ".")
            out.append((module, frame.name))
    return out


def fingerprint(source: str, kind: str, place: str, message: str = "") -> str:
    """The same error in the same place is one group; without a place the message (numbers taken out) decides."""
    import re
    basis = place or re.sub(r"\d+", "#", message)[:200]
    return hashlib.sha256(f"{source}|{kind}|{basis}".encode()).hexdigest()


def record_error(*, source: str, kind: str, message: str, place: str = "", culprit: str = "", stack: str = "", tenant_id=None, tenant_code=None,
                 user_id=None, method=None, path=None, status_code=None, release=None, context: dict | None = None) -> int | None:
    """Counts the occurrence on its group (reopening a resolved one as a regression) and stores the event, sampled."""
    if getattr(_local, "recording", False):
        return None
    _local.recording = True
    try:
        key = fingerprint(source, kind, place, message)
        with _cursor() as cursor:
            cursor.execute("""INSERT INTO error_group (fingerprint, source, kind, message, culprit, occurrences)
                              VALUES (%s, %s, %s, %s, %s, 1)
                              ON CONFLICT (fingerprint) DO UPDATE SET occurrences = error_group.occurrences + 1, last_seen = now(), message = EXCLUDED.message,
                                     regressed_at = CASE WHEN error_group.status = 'RESOLVED' THEN now() ELSE error_group.regressed_at END,
                                     status = CASE WHEN error_group.status = 'RESOLVED' THEN 'OPEN' ELSE error_group.status END,
                                     resolved_at = CASE WHEN error_group.status = 'RESOLVED' THEN NULL ELSE error_group.resolved_at END
                              RETURNING id""",
                           [key, source, kind[:200], message[:4000], (culprit or place)[:300] or None])
            group_id = cursor.fetchone()[0]
            cursor.execute("SELECT count(*) FROM error_event WHERE group_id = %s AND occurred_at > now() - interval '1 minute'", [group_id])
            if cursor.fetchone()[0] < EVENTS_PER_MINUTE:
                cursor.execute("""INSERT INTO error_event (group_id, tenant_id, tenant_code, user_id, method, path, status_code, release, stack, context)
                                  VALUES (%s, %s::uuid, %s, %s::uuid, %s, %s, %s, %s, %s, %s::jsonb)""",
                               [group_id, str(tenant_id) if tenant_id else None, (tenant_code or None) and str(tenant_code)[:50],
                                str(user_id) if user_id else None, (method or None) and method[:10], (path or None) and path[:500], status_code,
                                (release or None) and str(release)[:60], (stack or "")[-STACK_MAX:] or None, json.dumps(context or {}, default=str)[:20000]])
        return group_id
    except Exception as exc:                                        # never into the work it reports on
        _forget()
        log.warning("error not recorded: %s", exc)
        return None
    finally:
        _local.recording = False


class ErrorCaptureHandler(logging.Handler):
    """Records every ERROR that carries an exception: Django's 'Internal Server Error', a job that failed, a worker's
    log.exception. Errors without an exception are left to the log; they have no place to group by."""

    def __init__(self, level=logging.ERROR):
        super().__init__(level)

    def emit(self, record):
        if not record.exc_info or not record.exc_info[1] or record.name.startswith("cep.observe") or getattr(record.exc_info[1], "_cep_recorded", False):
            return
        try:
            exc_type, exc, tb = record.exc_info
            frames = _frames(tb)
            place = ".".join(frames[-1]) if frames else ""
            request = getattr(record, "request", None)
            tenant = getattr(request, "tenant", None) if request is not None else None
            user = getattr(request, "user", None) if request is not None else None
            job = getattr(record, "job", None) or (record.name == "cep.scheduler" and record.args and str(record.args[0])) or None
            source = "JOB" if job or record.name in ("cep.scheduler", "cep.jobs") else "BACKEND"
            route = route_of(getattr(request, "resolver_match", None)) if request is not None else None
            record_error(source=source, kind=f"{exc_type.__module__}.{exc_type.__name__}".removeprefix("builtins."), message=str(exc) or exc_type.__name__,
                         place=place, culprit=f"{request.method} {route}" if route else place,
                         stack="".join(traceback.format_exception(exc_type, exc, tb)),
                         tenant_id=(tenant or {}).get("id") if isinstance(tenant, dict) else None, tenant_code=(tenant or {}).get("code") if isinstance(tenant, dict) else None,
                         user_id=getattr(user, "id", None) if getattr(user, "is_authenticated", False) else None,
                         method=getattr(request, "method", None), path=getattr(request, "path", None), status_code=500 if request is not None else None,
                         release=release(),
                         context={k: v for k, v in {"logger": record.name, "job": job, "correlation_id": getattr(request, "correlation_id", None) if request is not None else None}.items() if v})
            exc._cep_recorded = True
        except Exception:                                           # noqa: BLE001
            pass


_release = None


def release() -> str:
    """CEP_RELEASE, or the short git commit the code was started from; read once."""
    global _release
    if _release is None:
        _release = getattr(settings, "CEP_RELEASE", "") or ""
        if not _release:
            try:
                import subprocess
                _release = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=settings.BASE_DIR, capture_output=True, text=True, timeout=3).stdout.strip()
            except Exception:                                       # noqa: BLE001
                _release = ""
    return _release


# ---------------------------------------------------------------------------------------------------- request figures
def route_of(match) -> str | None:
    """The URL pattern a request matched, readable: /api/v1/campaigns/:pk/runs/ whether it came from path() or a router's regex."""
    import re
    raw = getattr(match, "route", None) if match is not None else None
    if not raw:
        return None
    raw = re.sub(r"\(\?P<(\w+)>[^)]*\)", r":\1", raw)
    raw = re.sub(r"<(?:\w+:)?(\w+)>", r":\1", raw)
    raw = re.sub(r"\\?\.:format/\?", "", raw)
    raw = raw.replace("^", "").replace("$", "").replace("\\", "")
    return "/" + raw.lstrip("/")


def _bucket_index(ms: float) -> int:
    for index, bound in enumerate(BOUNDS_MS):
        if ms < bound:
            return index
    return len(BOUNDS_MS)


def add_request(tenant_id, method: str, route: str, status: int, ms: float, minute=None):
    minute = minute or timezone.now().replace(second=0, microsecond=0)
    key = (str(tenant_id or NO_TENANT), minute, method[:10], route[:300])
    with _lock:
        entry = _buckets.get(key)
        if entry is None:
            entry = _buckets[key] = [0, 0, 0, 0, 0, [0] * (len(BOUNDS_MS) + 1)]
        entry[0] += 1
        entry[1] += 1 if 400 <= status < 500 else 0
        entry[2] += 1 if status >= 500 else 0
        entry[3] += int(ms)
        entry[4] = max(entry[4], int(ms))
        entry[5][_bucket_index(ms)] += 1


def flush_metrics() -> int:
    """Adds this process's figures to request_metric in one statement; every process adds its own, so the table holds the sum."""
    with _lock:
        pending = list(_buckets.items())
        _buckets.clear()
    if not pending:
        return 0
    rows, args = [], []
    for (tenant, minute, method, route), (requests, c4, c5, total, top, hist) in pending:
        rows.append("(%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s::integer[])")
        args += [tenant, minute, method, route, requests, c4, c5, total, top, hist]
    try:
        with _cursor() as cursor:
            cursor.execute(f"""INSERT INTO request_metric (tenant_id, bucket_start, method, route, requests, client_errors, server_errors, total_ms, max_ms, histogram)
                                  VALUES {", ".join(rows)}
                                  ON CONFLICT (tenant_id, bucket_start, method, route) DO UPDATE SET
                                      requests = request_metric.requests + EXCLUDED.requests, client_errors = request_metric.client_errors + EXCLUDED.client_errors,
                                      server_errors = request_metric.server_errors + EXCLUDED.server_errors, total_ms = request_metric.total_ms + EXCLUDED.total_ms,
                                      max_ms = greatest(request_metric.max_ms, EXCLUDED.max_ms),
                                      histogram = ARRAY(SELECT a + b FROM unnest(request_metric.histogram, EXCLUDED.histogram) WITH ORDINALITY AS t(a, b, n) ORDER BY n)""", args)
    except Exception as exc:                                        # noqa: BLE001  figures are worth less than the requests they describe
        _forget()
        log.warning("request figures not flushed (%s rows lost): %s", len(pending), exc)
        return 0
    return len(pending)


def percentile(histogram: list[int], share: float = 0.95) -> int | None:
    """An estimate from the buckets: the bucket holding the given share, interpolated linearly inside it. Above the last
    bound it says the last bound (10 s), which reads as "10 s or more"."""
    total = sum(histogram or [])
    if not total:
        return None
    wanted = total * share
    seen = 0
    for index, count in enumerate(histogram):
        if count and seen + count >= wanted:
            if index >= len(BOUNDS_MS):
                return BOUNDS_MS[-1]
            low = BOUNDS_MS[index - 1] if index else 0
            return round(low + (BOUNDS_MS[index] - low) * (wanted - seen) / count)
        seen += count
    return BOUNDS_MS[-1]


def _flush_forever():
    while True:
        time.sleep(FLUSH_EVERY_S)
        flush_metrics()


def _start_flusher():
    """One background thread per process writes the figures, so no request waits for it. Started on the first request,
    after the server has forked its workers."""
    global _flusher
    if _flusher is None or not _flusher.is_alive():
        with _lock:
            if _flusher is None or not _flusher.is_alive():
                _flusher = threading.Thread(target=_flush_forever, name="cep-request-metrics", daemon=True)
                _flusher.start()


class RequestMetricsMiddleware:
    """Times every request and adds it to the figures of its tenant and route. Sits at the top of the stack."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith(SKIP_PREFIXES):
            return self.get_response(request)
        started = time.perf_counter()
        status = 500
        try:
            response = self.get_response(request)
            status = response.status_code
            return response
        finally:
            try:
                route = route_of(getattr(request, "resolver_match", None)) or ("/admin/…" if request.path.startswith("/admin/") else "(no route)")
                tenant = getattr(request, "tenant", None)
                add_request(tenant.get("id") if isinstance(tenant, dict) else None, request.method, route, status, (time.perf_counter() - started) * 1000)
                _start_flusher()
            except Exception:                                       # noqa: BLE001
                pass


# ---------------------------------------------------------------------------------------------------- uptime
def _setting(key, default):
    from apps.platform_ops import params
    try:
        return params.get(key, default)
    except Exception:                                               # noqa: BLE001
        return default


def default_targets() -> list[tuple[str, str, str | None]]:
    """The API's health address, the app's first page and the back-office sign-in, from the installation's public addresses."""
    from apps.platform_ops import params
    api = params.public_api_url()
    app = settings.FRONTEND_URL.rstrip("/")
    admin = settings.PLATFORM_ADMIN_URL.rstrip("/")
    return [(name, url, text) for name, url, text in (("API health", f"{api}/healthz", None), ("App", f"{app}/", 'id="root"'),
                                                       ("Back-office sign-in", f"{admin}/admin/login/", None)) if url.startswith("http")]


def probe_uptime(session=None) -> dict:
    """Calls every active target once. A target is DOWN after uptime.failures_before_alert failures in a row and UP on the
    first success; a change of state runs the alert evaluation at once, so the notice goes out within the minute."""
    import requests
    session = session or requests
    with _cursor() as cursor:
        cursor.execute("SELECT count(*) FROM uptime_target")
        if cursor.fetchone()[0] == 0:
            for name, url, text in default_targets():
                cursor.execute("INSERT INTO uptime_target (name, url, expect_text) VALUES (%s, %s, %s) ON CONFLICT (name) DO NOTHING", [name, url, text])
        cursor.execute("SELECT id, name, url, expect_status, expect_text, timeout_ms, state, consecutive_failures FROM uptime_target WHERE is_active ORDER BY id")
        targets = cursor.fetchall()
    threshold = max(1, int(_setting("uptime.failures_before_alert", 2)))
    changed, checked = [], 0
    for target_id, name, url, expect_status, expect_text, timeout_ms, state, failures in targets:
        started = time.perf_counter()
        status_code, error = None, None
        try:
            response = session.get(url, timeout=max(1, timeout_ms) / 1000, allow_redirects=False, headers={"User-Agent": "CEP-uptime/1"})
            status_code = response.status_code
            if status_code != expect_status:
                error = f"Answered {status_code}, expected {expect_status}"
            elif expect_text and expect_text not in (response.text or ""):
                error = f"The page does not contain {expect_text!r}"
        except Exception as exc:                                    # noqa: BLE001  a timeout, a refused connection, a DNS failure
            error = f"{exc.__class__.__name__}: {str(exc)[:300]}"
        ms = int((time.perf_counter() - started) * 1000)
        ok = error is None
        failures = 0 if ok else failures + 1
        new_state = "UP" if ok else ("DOWN" if failures >= threshold else state)
        with _cursor() as cursor:
            cursor.execute("INSERT INTO uptime_check (target_id, ok, status_code, duration_ms, error) VALUES (%s, %s, %s, %s, %s)", [target_id, ok, status_code, ms, error])
            cursor.execute("""UPDATE uptime_target SET consecutive_failures = %s, last_checked_at = now(), last_ms = %s, last_error = %s, updated_at = now(),
                                     state = %s, state_since = CASE WHEN state <> %s THEN now() ELSE state_since END WHERE id = %s""",
                           [failures, ms, error, new_state, new_state, target_id])
        checked += 1
        if new_state != state and not (state == "UNKNOWN" and new_state == "UP"):
            changed.append((name, new_state))
    if changed:
        try:
            from apps.platform_ops import alerts
            alerts.evaluate()
        except Exception as exc:                                    # noqa: BLE001
            log.warning("alert evaluation after an uptime change failed: %s", exc)
    return {"checked": checked, "changed": [f"{name} {state}" for name, state in changed]}


def availability(target_id: int, hours: int) -> dict:
    with _cursor() as cursor:
        cursor.execute("""SELECT count(*), count(*) FILTER (WHERE ok), percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE ok)
                            FROM uptime_check WHERE target_id = %s AND checked_at > now() - make_interval(hours => %s)""", [target_id, hours])
        total, good, p95 = cursor.fetchone()
    return {"checks": total, "percent": round(good * 100 / total, 2) if total else None, "p95_ms": int(p95) if p95 is not None else None}


# ---------------------------------------------------------------------------------------------------- health checks
def check_uptime():
    from apps.platform_health import FAIL, OFF, OK, _result
    with _cursor() as cursor:
        cursor.execute("SELECT name, state, last_error, state_since FROM uptime_target WHERE is_active ORDER BY name")
        rows = cursor.fetchall()
    if not rows:
        return _result("Uptime", OFF, "No uptime target yet", "Targets are made from the public addresses on the first probe, or add them under Overview, Uptime.")
    down = [(name, error) for name, state, error, _since in rows if state == "DOWN"]
    if down:
        return _result("Uptime", FAIL, f"Down: {', '.join(name for name, _ in down)}", "; ".join(f"{name}: {error}" for name, error in down)[:400])
    return _result("Uptime", OK, f"All {len(rows)} targets up")


def check_errors():
    from apps.platform_health import FAIL, OK, WARN, _result
    spike = int(_setting("errors.spike_per_15_minutes", 25))
    with _cursor() as cursor:
        cursor.execute("""SELECT g.kind, g.culprit, count(e.id) FROM error_group g JOIN error_event e ON e.group_id = g.id
                           WHERE g.status = 'OPEN' AND e.occurred_at > now() - interval '15 minutes' GROUP BY g.id HAVING count(e.id) >= %s ORDER BY 3 DESC LIMIT 3""",
                       [min(spike, EVENTS_PER_MINUTE * 15)])
        spiking = cursor.fetchall()
        cursor.execute("""SELECT count(*) FILTER (WHERE first_seen > now() - interval '1 hour' OR regressed_at > now() - interval '1 hour'),
                                 count(*) FILTER (WHERE last_seen > now() - interval '24 hours') FROM error_group WHERE status = 'OPEN'""")
        new, recent = cursor.fetchone()
    if spiking:
        return _result("Errors", FAIL, f"Error spike: {spiking[0][0]} ({spiking[0][2]}+ in 15 minutes)", "; ".join(f"{kind} at {where}" for kind, where, _ in spiking))
    if new:
        return _result("Errors", WARN, f"{new} new or returning error{'s' if new != 1 else ''} in the last hour", f"{recent} open errors seen in 24 hours. See Overview, Errors.")
    return _result("Errors", OK, f"No new errors in the last hour · {recent} open seen in 24 hours")


# ---------------------------------------------------------------------------------------------------- tenant performance
def _platform_rows(sql, args=()):
    from django.db import connections
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchall()


def _merge(histograms) -> list[int]:
    out = [0] * (len(BOUNDS_MS) + 1)
    for hist in histograms:
        for index, count in enumerate(hist or []):
            out[index] += count
    return out


def _grade(row) -> str:
    """bad / warn / ok by the worst of: server errors, p95, bounces, complaints, integration failures"""
    bad = (row["error_rate"] or 0) >= 2 or (row["p95_ms"] or 0) >= 2500 or (row["bounce_rate"] or 0) >= 5 or (row["complaint_rate"] or 0) >= 0.1 or (row["integration_failure_rate"] or 0) >= 10
    warn = (row["error_rate"] or 0) >= 0.5 or (row["p95_ms"] or 0) >= 1000 or (row["bounce_rate"] or 0) >= 2 or (row["complaint_rate"] or 0) >= 0.05 \
        or (row["integration_failure_rate"] or 0) >= 2 or row["open_errors"] > 0
    return "bad" if bad else "warn" if warn else "ok"


def tenant_performance(hours: int = 24) -> list[dict]:
    """One row per tenant for the last `hours`: requests and their speed, sends and their outcome, integrations, errors. Worst first.
    Kept for a minute: the list, a tenant's page and its panel all ask for it."""
    from django.core.cache import cache
    key = f"cep:observe:performance:{hours}"
    rows = cache.get(key)
    if rows is None:
        rows = _tenant_performance(hours)
        cache.set(key, rows, 60)
    return rows


def _tenant_performance(hours: int) -> list[dict]:
    since = timezone.now() - timedelta(hours=hours)
    tenants = _platform_rows("SELECT id, code, name, status FROM tenant WHERE deleted_at IS NULL AND status <> 'OFFBOARDED' ORDER BY code")
    requests = {}
    for tenant_id, total, c4, c5, ms, hist in _platform_rows(
            """SELECT tenant_id, sum(requests), sum(client_errors), sum(server_errors), sum(total_ms), array_agg(histogram) FROM request_metric
                WHERE bucket_start >= %s AND tenant_id <> %s::uuid GROUP BY tenant_id""", [since, NO_TENANT]):
        requests[str(tenant_id)] = (int(total), int(c4), int(c5), int(ms), percentile(_merge(hist)))
    slowest = {}
    for tenant_id, route, method, total, hist in _platform_rows(
            """SELECT tenant_id, route, method, sum(requests), array_agg(histogram) FROM request_metric WHERE bucket_start >= %s AND tenant_id <> %s::uuid
                GROUP BY tenant_id, route, method HAVING sum(requests) >= 20""", [since, NO_TENANT]):
        p95 = percentile(_merge(hist))
        if p95 and (str(tenant_id) not in slowest or p95 > slowest[str(tenant_id)][1]):
            slowest[str(tenant_id)] = (f"{method} {route}", p95)
    sends = {}
    for table in ("mailer_execution", "sms_execution"):
        for tenant_id, total, delivered, bounced, complained, failed in _platform_rows(
                f"""SELECT tenant_id, count(*), count(*) FILTER (WHERE status IN ('DELIVERED', 'OPENED', 'CLICKED', 'RESPONDED')),
                           count(*) FILTER (WHERE status = 'BOUNCED'), count(*) FILTER (WHERE status = 'COMPLAINED'), count(*) FILTER (WHERE status = 'FAILED')
                      FROM {table} WHERE created_at >= %s GROUP BY tenant_id""", [since]):
            entry = sends.setdefault(str(tenant_id), [0, 0, 0, 0, 0])
            for index, value in enumerate((total, delivered, bounced, complained, failed)):
                entry[index] += int(value)
    integrations = {str(t): (int(calls), int(bad)) for t, calls, bad in _platform_rows(
        "SELECT tenant_id, sum(calls), sum(errors + rejected) FROM integration_metric WHERE bucket_start >= %s GROUP BY tenant_id", [since])}
    errors = {str(t): (int(n), int(groups)) for t, n, groups in _platform_rows(
        """SELECT e.tenant_id, count(*), count(DISTINCT e.group_id) FILTER (WHERE g.status = 'OPEN') FROM error_event e JOIN error_group g ON g.id = e.group_id
            WHERE e.occurred_at >= %s AND e.tenant_id IS NOT NULL GROUP BY e.tenant_id""", [since])}
    out = []
    for tenant_id, code, name, status in tenants:
        key = str(tenant_id)
        total, c4, c5, ms, p95 = requests.get(key, (0, 0, 0, 0, None))
        sent, delivered, bounced, complained, failed = sends.get(key, (0, 0, 0, 0, 0))
        calls, bad_calls = integrations.get(key, (0, 0))
        events, open_groups = errors.get(key, (0, 0))
        row = {"id": key, "code": code, "name": name, "status": status, "requests": total, "client_errors": c4, "server_errors": c5,
               "error_rate": round(c5 * 100 / total, 2) if total else None, "avg_ms": int(ms / total) if total else None, "p95_ms": p95,
               "slowest": slowest.get(key), "sent": sent, "delivered": delivered, "delivery_rate": round(delivered * 100 / sent, 1) if sent else None,
               "bounce_rate": round(bounced * 100 / sent, 2) if sent else None, "complaint_rate": round(complained * 100 / sent, 3) if sent else None,
               "failed": failed, "integration_calls": calls, "integration_failure_rate": round(bad_calls * 100 / calls, 1) if calls else None,
               "error_events": events, "open_errors": open_groups}
        row["grade"] = _grade(row)
        out.append(row)
    order = {"bad": 0, "warn": 1, "ok": 2}
    out.sort(key=lambda row: (order[row["grade"]], -(row["requests"] + row["sent"])))
    return out


def tenant_detail(tenant_id, hours: int = 24) -> dict:
    """One tenant: requests over the period (hourly, or every 5 minutes for the last hour; empty slots included), its
    routes worst first, and its recent errors."""
    now = timezone.now()
    since = now - timedelta(hours=hours)
    step = 300 if hours <= 1 else 3600
    found = {}
    for slot, total, c5, hist in _platform_rows(
            """SELECT to_timestamp(floor(extract(epoch FROM bucket_start) / %s) * %s), sum(requests), sum(server_errors), array_agg(histogram) FROM request_metric
                WHERE tenant_id = %s::uuid AND bucket_start >= %s GROUP BY 1""", [step, step, str(tenant_id), since]):
        found[int(slot.timestamp())] = (int(total), int(c5), percentile(_merge(hist)))
    hourly = []
    first = int(since.timestamp()) // step * step
    for start in range(first, int(now.timestamp()) // step * step + 1, step):
        total, c5, p95 = found.get(start, (0, 0, None))
        hourly.append({"hour": datetime.fromtimestamp(start, tz=timezone.get_current_timezone()), "requests": total, "server_errors": c5, "p95_ms": p95})
    routes = []
    for route, method, total, c4, c5, ms, hist in _platform_rows(
            """SELECT route, method, sum(requests), sum(client_errors), sum(server_errors), sum(total_ms), array_agg(histogram) FROM request_metric
                WHERE tenant_id = %s::uuid AND bucket_start >= %s GROUP BY route, method""", [str(tenant_id), since]):
        routes.append({"route": route, "method": method, "requests": int(total), "client_errors": int(c4), "server_errors": int(c5),
                       "avg_ms": int(ms / total) if total else None, "p95_ms": percentile(_merge(hist))})
    routes.sort(key=lambda r: (-(r["server_errors"] > 0), -(r["p95_ms"] or 0), -r["requests"]))
    errors = [{"id": gid, "kind": kind, "message": message, "culprit": culprit, "status": status, "count": int(count), "last_seen": last}
              for gid, kind, message, culprit, status, count, last in _platform_rows(
                  """SELECT g.id, g.kind, g.message, g.culprit, g.status, count(e.id), max(e.occurred_at) FROM error_event e JOIN error_group g ON g.id = e.group_id
                      WHERE e.tenant_id = %s::uuid AND e.occurred_at >= %s GROUP BY g.id ORDER BY 7 DESC LIMIT 10""", [str(tenant_id), since])]
    peak = max((h["requests"] for h in hourly), default=0)
    for h in hourly:
        h["height"] = max(2, round(h["requests"] * 100 / peak)) if peak and h["requests"] else 0
        h["error_share"] = max(8, round(h["server_errors"] * 100 / h["requests"])) if h["server_errors"] else 0
    return {"hourly": hourly, "routes": routes[:15], "errors": errors, "peak": peak, "slot": "5 minutes" if step == 300 else "hour", "within": "in 5 minutes" if step == 300 else "in an hour",
            "first": hourly[0]["hour"] if hourly else None, "last": hourly[-1]["hour"] if hourly else None}


# ---------------------------------------------------------------------------------------------------- pruning
def prune() -> dict:
    errors_days = int(_setting("errors.retention_days", 30))
    metric_days = int(_setting("metrics.retention_days", 30))
    uptime_days = int(_setting("uptime.retention_days", 90))
    with _cursor() as cursor:
        cursor.execute("DELETE FROM error_event WHERE occurred_at < now() - make_interval(days => %s)", [errors_days])
        events = cursor.rowcount
        cursor.execute("DELETE FROM error_group WHERE status IN ('RESOLVED', 'IGNORED') AND last_seen < now() - make_interval(days => %s)", [errors_days])
        groups = cursor.rowcount
        cursor.execute("DELETE FROM request_metric WHERE bucket_start < now() - make_interval(days => %s)", [metric_days])
        metrics = cursor.rowcount
        cursor.execute("DELETE FROM uptime_check WHERE checked_at < now() - make_interval(days => %s)", [uptime_days])
        checks = cursor.rowcount
    return {"error_events": events, "error_groups": groups, "request_metrics": metrics, "uptime_checks": checks}
