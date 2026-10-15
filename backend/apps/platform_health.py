"""Platform health for the back-office home page and GET /admin/health.json (staff only).

Each check answers one operational question and returns {name, status, summary, detail}; status is ok | warn | fail |
off (deliberately not running, e.g. Redis in local development). Checks never raise: a broken dependency is a result.
"""
import time
from datetime import timedelta

from django.conf import settings
from django.db import connections
from django.utils import timezone

OK, WARN, FAIL, OFF = "ok", "warn", "fail", "off"
LABEL = {OK: "success", WARN: "warning", FAIL: "danger", OFF: "info"}
WORD = {OK: "Healthy", WARN: "Attention", FAIL: "Failing", OFF: "Not Running"}
P = settings.PLATFORM_ALIAS


def _result(name, status, summary, detail=""):
    return {"name": name, "status": status, "label": LABEL[status], "word": WORD[status], "summary": summary, "detail": detail}


def _guard(name, fn):
    try:
        return fn()
    except Exception as exc:                               # a check must never take the dashboard down
        return _result(name, FAIL, f"{exc.__class__.__name__}: {str(exc)[:160]}")


def _rows(sql, params=None, alias=P):
    with connections[alias].cursor() as cursor:
        cursor.execute(sql, params or [])
        return cursor.fetchall()


def check_database():
    _rows("SELECT 1")                                        # open the connection first: measure a query, not the handshake
    started = time.perf_counter()
    version, size = _rows("SELECT current_setting('server_version'), pg_size_pretty(pg_database_size(current_database()))")[0]
    ms = (time.perf_counter() - started) * 1000
    used, limit = _rows("SELECT count(*), current_setting('max_connections')::int FROM pg_stat_activity")[0]
    busy = used >= limit * 0.8
    status = WARN if ms >= 500 or busy else OK          # the database is on another host: tens to low hundreds of ms is normal
    detail = f"{used} of {limit} connections in use" + (": close to the server limit; look for idle sessions in pg_stat_activity" if busy else "")
    return _result("Database", status, f"PostgreSQL {version.split()[0]} · {size} · {ms:.0f} ms", detail)


def check_app_role():
    """The API must run as a role that row-level security applies to. A superuser or BYPASSRLS login would make every
    tenant see every other tenant's data without a single error."""
    role, is_super, bypass = _rows("SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user", alias="default")[0]
    if is_super or bypass:
        return _result("Tenant isolation", FAIL, f"The API connects as {role}, which bypasses row-level security", "Point DATABASE_URL at a login that is a member of cep_app (see README, Database roles).")
    policies, forced = _rows("SELECT (SELECT count(*) FROM pg_policies), (SELECT count(*) FROM pg_class WHERE relforcerowsecurity)")[0]
    return _result("Tenant isolation", OK, f"API runs as {role}: row-level security enforced", f"{policies} policies on {forced} tables")


def check_migrations():
    from django.db.migrations.executor import MigrationExecutor
    plan = MigrationExecutor(connections[P]).migration_plan(MigrationExecutor(connections[P]).loader.graph.leaf_nodes())
    if plan:
        return _result("Migrations", WARN, f"{len(plan)} not applied", ", ".join(f"{m.app_label}.{m.name}" for m, _ in plan[:5]))
    return _result("Migrations", OK, "All applied")


def check_partitions():
    """Inserts fail outright when the month's partition is missing: every active tenant needs this month and next."""
    months = [timezone.now().date().replace(day=1)]
    months.append((months[0] + timedelta(days=32)).replace(day=1))
    rows = _rows("""
        SELECT t.code, p.table_name, to_char(m, 'YYYY_MM')
        FROM tenant t
        JOIN tenant_database d ON d.tenant_id = t.id AND d.isolation_mode = 'SHARED'
        CROSS JOIN partition_retention_policy p
        CROSS JOIN unnest(%s::date[]) AS m
        WHERE t.status = 'ACTIVE' AND t.deleted_at IS NULL AND p.is_active AND p.tenant_partitioned AND p.sub_method = 'RANGE_MONTHLY'
          AND to_regclass(format('%%s_t%%s_%%s', p.table_name, t.partition_seq, to_char(m, 'YYYY_MM'))) IS NULL
        ORDER BY 1, 2 LIMIT 200""", [months])
    total = _rows("SELECT count(*) FROM pg_class WHERE relispartition AND relkind IN ('r', 'p')")[0][0]
    if rows:
        this_month = months[0].strftime("%Y_%m")
        status = FAIL if any(r[2] == this_month for r in rows) else WARN
        tenants = sorted({r[0] for r in rows})
        return _result("Partitions", status, f"{len(rows)} monthly partitions missing for {', '.join(tenants[:5])}",
                       "Run the tenant action “Repair onboarding”, or check that the Celery beat job ensure-monthly-partitions is running.")
    return _result("Partitions", OK, f"{total} partitions · this month and next exist for every active tenant")


def check_outbox():
    pending, oldest = _rows("SELECT count(*), min(occurred_at) FROM domain_event WHERE status = 'PENDING'")[0]
    if not pending:
        return _result("Event outbox", OK, "Nothing waiting to be published")
    age = timezone.now() - oldest
    status = FAIL if age > timedelta(minutes=15) else WARN if age > timedelta(minutes=2) else OK
    if status == FAIL and settings.DEBUG:
        status = WARN                                      # development usually runs without the relay worker
    return _result("Event outbox", status, f"{pending} event{'' if pending == 1 else 's'} waiting, oldest {int(age.total_seconds() // 60)} min", "The outbox relay (Celery) publishes these to Redis Streams." if status != OK else "")


def check_dead_letters():
    open_count, recent = _rows("SELECT count(*) FILTER (WHERE resolved_at IS NULL), count(*) FILTER (WHERE first_failed_at > now() - interval '24 hours') FROM dead_letter_message")[0]
    status = OK if not open_count else WARN if open_count < 100 else FAIL
    return _result("Failed messages", status, f"{open_count} unresolved · {recent} in the last 24 hours")


def check_cache():
    from django.core.cache import cache
    backend = settings.CACHES["default"]["BACKEND"].rsplit(".", 1)[-1]
    cache.set("cep:health", "1", 10)
    if cache.get("cep:health") != "1":
        return _result("Cache", FAIL, f"{backend} did not return the value just written")
    if backend == "LocMemCache":
        return _result("Cache", OFF if settings.DEBUG else WARN, "In-process cache (no Redis)", "Fine for development. In production every worker would keep its own tenant cache and throttle counters.")
    return _result("Cache", OK, f"{backend} reachable")


def _broker_reachable(timeout: float = 0.4):
    """Raises quickly when nothing listens on the Celery broker's address."""
    import socket
    from urllib.parse import urlparse
    url = urlparse(settings.CELERY_BROKER_URL)
    if url.scheme in ("redis", "rediss", "amqp", "amqps") and url.hostname:
        socket.create_connection((url.hostname, url.port or (6379 if url.scheme.startswith("redis") else 5672)), timeout=timeout).close()


def check_workers():
    from config.celery import app
    try:
        _broker_reachable()                                # without this, an absent broker costs 6 s of connection retries per page view
        replies = app.control.inspect(timeout=1.0).ping() or {}
    except Exception as exc:
        replies, error = {}, exc
    else:
        error = None
    if replies:
        return _result("Background workers", OK, f"{len(replies)} Celery worker(s) responding", ", ".join(sorted(replies)))
    detail = "Campaign sends, the outbox relay and partition maintenance run in Celery. Start: celery -A config worker -B"
    return _result("Background workers", OFF if settings.DEBUG else FAIL, "No Celery worker is running" + (f" ({error.__class__.__name__})" if error else ""), detail)


def check_configuration():
    problems = []
    if settings.DEBUG:
        problems.append("DEBUG is on")
    if settings.SECRET_KEY.startswith("change-me") or len(settings.SECRET_KEY) < 40:
        problems.append("SECRET_KEY is weak or the default")
    if "*" in settings.ALLOWED_HOSTS:
        problems.append("ALLOWED_HOSTS accepts any host")
    if not settings.MEDIA_BUCKET:
        problems.append("uploads go to the local disk, not object storage / CDN")
    if not problems:
        return _result("Configuration", OK, "Production settings in place")
    return _result("Configuration", OFF if settings.DEBUG else FAIL, "; ".join(problems), "Expected in development. None of these may be true in production.")


def check_email():
    from apps.platform_ops import mail
    if not mail.is_configured():
        return _result("Email", OFF if settings.DEBUG else FAIL, "No mail server configured: messages are printed to the server log",
                       "Enter it under Configuration -> Mail server (or set EMAIL_HOST ... in .env), then use its 'Send a test message to me' action.")
    ok, message = mail.check()
    return _result("Email", OK if ok else FAIL, message, "" if ok else "Password links and alerts cannot be delivered.")


def check_secrets():
    from apps.platform_ops import crypto
    if crypto.uses_derived_key():
        return _result("Secrets at rest", OFF if settings.DEBUG else FAIL, "FIELD_ENCRYPTION_KEY is not set: MFA and SSO secrets use a key derived from SECRET_KEY",
                       "Generate a Fernet key per environment and keep it out of the database backups.")
    return _result("Secrets at rest", OK, "MFA and SSO secrets are encrypted with a dedicated key")


def check_jobs():
    from apps.platform_ops import jobs
    report = jobs.status_report()
    failed = [j["name"] for j in report if j["state"] == "failed"]
    overdue = [j["name"] for j in report if j["state"] == "overdue"]
    never = [j["name"] for j in report if j["state"] == "never"]
    healthy = len(report) - len(failed) - len(overdue) - len(never)
    if failed:
        return _result("Scheduled jobs", FAIL, f"Last run failed: {', '.join(failed)}", "See Operations, Job runs, for the error.")
    if overdue:
        return _result("Scheduled jobs", WARN, f"Overdue: {', '.join(overdue)}", "A job has not succeeded within its expected interval. Is Celery beat running?")
    if never and not healthy:
        return _result("Scheduled jobs", OFF if settings.DEBUG else FAIL, "No scheduled job has run yet", "Start Celery with beat, or run one by hand: python manage.py run_job --list")
    if never:
        return _result("Scheduled jobs", OFF if settings.DEBUG else WARN, f"{healthy} healthy; never run: {', '.join(never)}")
    return _result("Scheduled jobs", OK, f"All {len(report)} jobs succeeded within their expected interval")


def check_operations():
    failed, waiting = _rows("""SELECT count(*) FILTER (WHERE status = 'FAILED' AND finished_at > now() - interval '7 days'),
                                      count(*) FILTER (WHERE status IN ('REQUESTED', 'RUNNING') AND requested_at < now() - interval '2 hours') FROM tenant_operation""")[0]
    if failed or waiting:
        return _result("Tenant operations", WARN, f"{failed} failed in the last 7 days, {waiting} waiting for more than 2 hours", "See Operations, Tenant operations.")
    return _result("Tenant operations", OK, "No failed or stuck exports, moves or offboardings")


def check_errors():
    from apps.platform_ops import observe
    return observe.check_errors()


def check_uptime():
    from apps.platform_ops import observe
    return observe.check_uptime()


def check_integrations():
    """Integrations failing hard in the last 15 minutes: a circuit open, or a quarter of the calls failing."""
    from apps.integrations.bridge import metrics
    problems = metrics.platform_problems()
    if problems:
        shown = "; ".join(f"{p['tenant']} {p['integration']}: {p['problem']}" for p in problems[:4])
        return _result("Integrations", WARN, f"{len(problems)} integration{'s' if len(problems) != 1 else ''} failing", shown + ". See Integrations, Integration log.")
    return _result("Integrations", OK, "No integration is failing or has its circuit open")


CHECKS = (("Database", check_database), ("Tenant isolation", check_app_role), ("Migrations", check_migrations), ("Partitions", check_partitions),
          ("Event outbox", check_outbox), ("Failed messages", check_dead_letters), ("Cache", check_cache), ("Background workers", check_workers),
          ("Configuration", check_configuration), ("Email", check_email), ("Secrets at rest", check_secrets), ("Tenant operations", check_operations),
          ("Integrations", check_integrations), ("Errors", check_errors), ("Uptime", check_uptime))


def collect(include_jobs: bool = True) -> dict:
    """include_jobs=False is for the alert evaluator, which reports each job on its own line instead."""
    checks = [_guard(name, fn) for name, fn in CHECKS]
    if include_jobs:
        checks.append(_guard("Scheduled jobs", check_jobs))
    worst = FAIL if any(c["status"] == FAIL for c in checks) else WARN if any(c["status"] == WARN for c in checks) else OK
    return {"status": worst, "label": LABEL[worst], "word": WORD[worst], "checked_at": timezone.now(), "checks": checks}


def numbers() -> list[dict]:
    def one(sql):
        return _rows(sql)[0][0]
    return [
        {"title": "Active Tenants", "value": one("SELECT count(*) FROM tenant WHERE status = 'ACTIVE' AND deleted_at IS NULL"), "link": "admin:tenants_tenant_changelist"},
        {"title": "Suspended Tenants", "value": one("SELECT count(*) FROM tenant WHERE status = 'SUSPENDED' AND deleted_at IS NULL"), "link": "admin:tenants_tenant_changelist"},
        {"title": "Active Users", "value": one("SELECT count(*) FROM app_user WHERE is_active AND deleted_at IS NULL"), "link": "admin:identity_appuser_changelist"},
        {"title": "Active API Keys", "value": one("SELECT count(*) FROM api_client WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())"), "link": "admin:identity_apiclient_changelist"},
        {"title": "Campaigns Live", "value": one("SELECT count(*) FROM campaign WHERE status IN ('ACTIVE', 'PRODUCTION_PUBLISHED') AND deleted_at IS NULL"), "link": "admin:campaigns_campaign_changelist"},
        {"title": "Definition Changes, 24 h", "value": one("SELECT count(*) FROM definition_audit_log WHERE changed_at > now() - interval '24 hours'"), "link": "admin:audit_definitionauditlog_changelist"},
    ]


def dashboard_callback(request, context):
    """UNFOLD['DASHBOARD_CALLBACK']: adds the health report and headline numbers to the admin index context."""
    from apps.platform_ops import jobs
    from apps.platform_ops.models import PlatformAlert
    context.update({"health": collect(), "numbers": _guard("numbers", numbers)})
    try:
        context["jobs"] = jobs.status_report()
        context["alerts"] = list(PlatformAlert.objects.using(P).filter(resolved_at__isnull=True).order_by("severity", "opened_at")[:20])
    except Exception:                                      # the layer is not applied yet: the checks above already say so
        context["jobs"], context["alerts"] = [], []
    if isinstance(context["numbers"], dict):               # the guard returned a failure result instead of a list
        context["numbers"] = []
    from apps.platform_ops import admin_ui
    context["home"] = admin_ui.home(request, context["health"], context["numbers"], context["jobs"], context["alerts"])
    return context
