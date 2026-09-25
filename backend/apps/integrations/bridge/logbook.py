"""The integration log: one row per call in either direction, and the integration record each call belongs to.

A log row never breaks the call it describes: every write is guarded, and a failure to log is a warning in the server
log, not an error to the caller. Rows are written on the workspace's own database. An inbound row of a workspace that
lives in the pool goes through the platform connection — its own transaction — so it survives the request being rolled
back on a server error, which is exactly when the row is wanted.
"""
import json
import logging
import socket
import time
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, connections, transaction
from django.utils import timezone

from apps.platform_ops import params
from apps.tenants import context

from . import correlation, redact

log = logging.getLogger("cep.integrations")

KIND_POS = "POS_RECEIPTS"
KIND_PROVIDER = "PROVIDER"
OUTCOMES = ("OK", "REJECTED", "RETRY", "ERROR", "THROTTLED", "BREAKER", "PAUSED")
FAILURES = {"RETRY", "ERROR", "THROTTLED", "BREAKER", "PAUSED"}
CACHE_TTL = 60
P = settings.PLATFORM_ALIAS                                  # the connection cross-tenant work uses; tests point it at "default"

COLUMNS = ("id", "tenant_id", "kind", "name", "direction", "system", "status", "environment", "delivery_provider_id", "throttle_per_minute", "throttle_burst",
           "retry_max_attempts", "breaker_failures", "breaker_cooldown_seconds", "log_level", "log_body_max_bytes", "log_retention_days")


def _cache_key(tenant_id, kind: str, provider_id) -> str:
    return f"cep:integration:{tenant_id}:{kind}:{provider_id or ''}"


def invalidate(tenant_id, kind: str | None = None, provider_id=None) -> None:
    if kind is None:
        cache.delete_many([_cache_key(tenant_id, KIND_POS, None)])   # provider records are re-read at their next call anyway (60 s)
        return
    cache.delete(_cache_key(tenant_id, kind, provider_id))


def _alias() -> str:
    ctx = context.current()
    return ctx.db_alias if ctx else settings.CONTROL_PLANE_ALIAS


def integration_for(tenant_id, *, kind: str, system: str, provider=None, create: bool = True) -> dict | None:
    """The record for this call, made on first use with the platform defaults, cached for a minute."""
    provider_id = str(provider.pk) if provider is not None else None
    key = _cache_key(tenant_id, kind, provider_id)
    found = cache.get(key)
    if found is not None:
        return found
    alias = _alias()
    # one transaction: the RLS setting is transaction-local, and a worker between its short transactions is in autocommit
    with transaction.atomic(using=alias), connections[alias].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])
        cursor.execute(f"SELECT {', '.join(COLUMNS)} FROM integration WHERE tenant_id = %s AND kind = %s AND delivery_provider_id IS NOT DISTINCT FROM %s::uuid",
                       [str(tenant_id), kind, provider_id])
        row = cursor.fetchone()
        if row is None and create:
            name = provider.name if provider is not None else "POS receipts"
            direction = "OUT" if kind == KIND_PROVIDER else "IN"
            try:
                with transaction.atomic(using=alias):       # a savepoint: an engine row that does not exist must not abort the caller
                    cursor.execute(f"""INSERT INTO integration (tenant_id, kind, name, direction, system, delivery_provider_id, log_body_max_bytes, log_retention_days)
                                       VALUES (%s, %s, %s, %s, %s, %s::uuid, %s, %s)
                                       ON CONFLICT DO NOTHING RETURNING {', '.join(COLUMNS)}""",
                                   [str(tenant_id), kind, name[:100], direction, system, provider_id,
                                    int(params.get("integrations.log_body_max_bytes", 65536)), int(params.get("integrations.log_retention_days", 90))])
                    row = cursor.fetchone()
            except IntegrityError as exc:                      # no such delivery_provider: the call is still logged, without a record
                log.warning("integration record not made for %s %s: %s", kind, provider_id, exc)
                return None
            if row is None:                                    # a parallel first call made it a moment ago
                cursor.execute(f"SELECT {', '.join(COLUMNS)} FROM integration WHERE tenant_id = %s AND kind = %s AND delivery_provider_id IS NOT DISTINCT FROM %s::uuid",
                               [str(tenant_id), kind, provider_id])
                row = cursor.fetchone()
    if row is None:
        return None
    found = dict(zip(COLUMNS, row))
    found["id"] = str(found["id"])
    found["tenant_id"] = str(found["tenant_id"])
    found["delivery_provider_id"] = str(found["delivery_provider_id"]) if found["delivery_provider_id"] else None
    cache.set(key, found, CACHE_TTL)
    return found


def ensure_defaults(tenant_id) -> int:
    """The records a workspace's settings page lists before any call was made: POS receipts, and one per sending engine."""
    from apps.delivery.models import DeliveryProvider
    made = 0
    made += integration_for(tenant_id, kind=KIND_POS, system="POS") is not None
    for provider in DeliveryProvider.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True):
        made += integration_for(tenant_id, kind=KIND_PROVIDER, system=provider.provider_type, provider=provider) is not None
    return made


def inbound_limit(tenant_id, integration: dict | None) -> int | None:
    """The workspace's inbound calls per minute: its own record, else the plan's default from the global parameter."""
    if integration and integration.get("throttle_per_minute"):
        return int(integration["throttle_per_minute"])
    table = params.get("integrations.inbound_per_minute", {}) or {}
    if isinstance(table, str):
        try:
            table = json.loads(table)
        except ValueError:
            table = {}
    from apps.platform_ops import billing
    plan = billing.plan_for(tenant_id)
    code = plan["code"] if plan else "default"
    value = table.get(code, table.get("default"))
    return int(value) if value else None


def _via_platform(alias: str) -> bool:
    """An inbound row written during a request transaction would vanish with a server-error rollback: the pool's
    platform connection is a different connection, so its write commits on its own."""
    return alias == settings.CONTROL_PLANE_ALIAS and P in settings.DATABASES and P != alias


def record(*, tenant_id, integration: dict | None, direction: str, kind: str, system: str, method: str, url: str, outcome: str,
           related_ref: str | None = None, request_headers: dict | None = None, request_body=None, response_status: int | None = None,
           response_headers: dict | None = None, response_body=None, error_class: str | None = None, error_message: str | None = None,
           attempt: int = 1, duration_ms: int | None = None, api_client_id=None, own_transaction: bool = False) -> int | None:
    """Writes one row. Returns its id, or None when the policy said not to log or the write failed (which is logged, not raised)."""
    level = (integration or {}).get("log_level", "FULL")
    if level == "NONE":
        _touch(tenant_id, integration, outcome, error_message)
        return None
    keep_bodies = level == "FULL" or outcome != "OK"
    cap = int((integration or {}).get("log_body_max_bytes") or params.get("integrations.log_body_max_bytes", 65536))
    req_text, req_bytes = redact.body(request_body, cap) if keep_bodies else (None, redact.body(request_body, 0)[1])
    res_text, res_bytes = redact.body(response_body, cap) if keep_bodies else (None, redact.body(response_body, 0)[1])
    row = [str(tenant_id), integration["id"] if integration else None, direction, kind, system, correlation.current(), (related_ref or None) and str(related_ref)[:200],
           method[:10], url[:2000], json.dumps(redact.headers(request_headers)) if request_headers is not None else None, req_text, req_bytes,
           response_status, json.dumps(redact.headers(response_headers)) if response_headers is not None else None, res_text, res_bytes,
           outcome if outcome in OUTCOMES else "ERROR", (error_class or None) and error_class[:100], (error_message or None) and error_message[:500],
           attempt, duration_ms, str(api_client_id) if api_client_id else None, socket.gethostname()[:200]]
    sql = """INSERT INTO integration_log (tenant_id, integration_id, direction, kind, system, correlation_id, related_ref, method, url, request_headers, request_body,
                                          request_bytes, response_status, response_headers, response_body, response_bytes, outcome, error_class, error_message,
                                          attempt, duration_ms, api_client_id, worker)
             VALUES (%s, %s::uuid, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s::uuid, %s) RETURNING id"""
    alias = _alias()
    try:
        if own_transaction and _via_platform(alias):
            with transaction.atomic(using=P), connections[P].cursor() as cursor:
                cursor.execute(sql, row)
                log_id = cursor.fetchone()[0]
        else:
            with transaction.atomic(using=alias), connections[alias].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])
                cursor.execute(sql, row)
                log_id = cursor.fetchone()[0]
    except Exception as exc:                                   # noqa: BLE001  logging never fails the call it describes
        log.warning("integration log row not written (%s %s %s): %s", direction, system, outcome, exc)
        return None
    _touch(tenant_id, integration, outcome, error_message)
    return log_id


def _touch(tenant_id, integration: dict | None, outcome: str, error_message: str | None) -> None:
    """last call / last outcome on the record, for the status card; never raised."""
    if not integration:
        return
    alias = _alias()
    try:
        with transaction.atomic(using=alias), connections[alias].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])
            cursor.execute("""UPDATE integration SET last_call_at = now(), last_outcome = %s, last_error = CASE WHEN %s IN ('OK', 'REJECTED') THEN last_error ELSE %s END
                               WHERE id = %s""", [outcome, outcome, (error_message or "")[:500] or None, integration["id"]])
    except Exception as exc:                                   # noqa: BLE001
        log.debug("integration last-call not updated: %s", exc)


class Stopwatch:
    def __init__(self):
        self.started = time.perf_counter()

    def ms(self) -> int:
        return int((time.perf_counter() - self.started) * 1000)


def prune_logs(now=None) -> int:
    """Rows past an integration's own retention when it is shorter than the partition policy's; the partition drop does the rest."""
    now = now or timezone.now()
    removed = 0
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT id, tenant_id, log_retention_days FROM integration WHERE log_retention_days < 90")
        for integration_id, tenant_id, days in cursor.fetchall():
            cursor.execute("DELETE FROM integration_log WHERE tenant_id = %s AND integration_id = %s AND started_at < %s",
                           [str(tenant_id), str(integration_id), now - timedelta(days=int(days))])
            removed += cursor.rowcount
    return removed
