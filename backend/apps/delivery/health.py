"""Engine Health: is each sending engine answering, calling back and delivering?

    run()                     the check-engine-health job: every active engine of every active workspace, every 10 minutes
    evaluate(provider)        the six checks of one engine, from the integration log and the message records
    run_check(provider)       one engine's Check (key and address, nothing sent), as the Check link and the daily job do it
    check_all()               the check-engines-daily job
    for_tenant(tenant_id)     the stored results of a workspace, for its Sending Engines page
    overview() / problems()   every engine across workspaces, for the back-office page and the alert evaluator

The checks: Callbacks (messages went out but the engine has not called back for engine_health.callback_silence_minutes),
Refused Calls (a key refused, the circuit breaker open, or more than engine_health.rejection_rate_pct of calls refused or
failed), API Speed (p95 above engine_health.p95_ms), Bounces and Complaints (email) or Failed Texts, Receipts (texts) and the
Daily Check. A rate is judged only from engine_health.min_sample messages or calls. A text engine that has never called back
gets one standing warning instead of a Callbacks and a Receipts alert: Digivize accepts texts but has not posted a receipt yet.
"""
import json
import logging
from datetime import timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.db import connections
from django.utils import timezone

from apps.platform_ops import params

from .engine import session

log = logging.getLogger("cep.delivery.health")
P = settings.PLATFORM_ALIAS

OK, ATTENTION, FAILING, QUIET, OFF = "ok", "attention", "failing", "quiet", "off"
STATUS = {FAILING: "FAILING", ATTENTION: "ATTENTION"}
GRACE_MINUTES = 10                                         # an engine has this long to call back about a message before its silence counts
MIN_TIMED_CALLS = 10                                       # fewer calls in the hour than this: their p95 says nothing
RECEIPT_WINDOW_HOURS = 2


def thresholds() -> dict:
    return {"silence_minutes": int(params.get("engine_health.callback_silence_minutes", 60)),
            "rejection_pct": float(params.get("engine_health.rejection_rate_pct", 1)),
            "p95_ms": int(params.get("engine_health.p95_ms", 5000)),
            "hard_bounce_pct": float(params.get("engine_health.hard_bounce_pct", 2)),
            "complaint_pct": float(params.get("engine_health.complaint_pct", 0.1)),
            "sms_failure_pct": float(params.get("engine_health.sms_failure_pct", 5)),
            "receipt_wait_minutes": int(params.get("engine_health.receipt_wait_minutes", 15)),
            "missing_receipt_pct": float(params.get("engine_health.missing_receipt_pct", 1)),
            "min_sample": int(params.get("engine_health.min_sample", 50))}


# ---------------------------------------------------------------------------------------------------- words
def age(delta: timedelta) -> str:
    minutes = int(delta.total_seconds() // 60)
    if minutes < 1:
        return "less than a minute"
    if minutes < 60:
        return f"{minutes} min"
    hours, rest = divmod(minutes, 60)
    if hours < 48:
        return f"{hours} h {rest} min" if rest else f"{hours} h"
    return f"{hours // 24} days"


def pct(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".") if value < 1 else f"{value:.1f}".rstrip("0").rstrip(".")
    return f"{text}%"


def duration(ms) -> str:
    if ms is None:
        return "—"
    return f"{round(ms)} ms" if ms < 1000 else f"{ms / 1000:.1f} s".replace(".0 s", " s")


def _rate(part: int, whole: int) -> float:
    return part * 100 / whole if whole else 0.0


def _check(key, label, state, value, summary, line="", standing=False) -> dict:
    return {"key": key, "label": label, "state": state, "value": value, "summary": summary, "line": line, "standing": standing}


# ---------------------------------------------------------------------------------------------------- figures
def _figures(cursor, provider, now) -> dict:
    """The counts behind the checks, on the workspace's own connection inside its row-level-security scope."""
    tenant_id, hour, day = str(provider.tenant_id), now - timedelta(hours=1), now - timedelta(hours=24)
    t = thresholds()
    found = {"integration": False, "calls_1h": 0, "failed_1h": 0, "timed_1h": 0, "p95_ms": None, "last_refused_at": None, "first_refused_at": None,
             "refused_count": 0, "last_ok_at": None, "calls_24h": 0, "breaker_until": None, "last_callback_at": None, "callbacks_24h": 0}
    cursor.execute("SELECT id, breaker_open_until FROM integration WHERE tenant_id = %s AND kind = 'PROVIDER' AND delivery_provider_id = %s",
                   [tenant_id, str(provider.pk)])
    row = cursor.fetchone()
    if row is not None:
        integration_id, found["breaker_until"] = str(row[0]), row[1]
        found["integration"] = True
        cursor.execute("""SELECT count(*) FILTER (WHERE started_at >= %s AND outcome NOT IN ('THROTTLED', 'PAUSED', 'BREAKER')),
                                 count(*) FILTER (WHERE started_at >= %s AND outcome IN ('REJECTED', 'RETRY', 'ERROR')),
                                 count(*) FILTER (WHERE started_at >= %s AND duration_ms IS NOT NULL AND outcome NOT IN ('THROTTLED', 'PAUSED', 'BREAKER')),
                                 percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE started_at >= %s AND outcome NOT IN ('THROTTLED', 'PAUSED', 'BREAKER')),
                                 max(started_at) FILTER (WHERE started_at >= %s AND response_status IN (401, 403)),
                                 min(started_at) FILTER (WHERE started_at >= %s AND response_status IN (401, 403)),
                                 count(*) FILTER (WHERE started_at >= %s AND response_status IN (401, 403)),
                                 max(started_at) FILTER (WHERE started_at >= %s AND outcome = 'OK'),
                                 count(*) FILTER (WHERE outcome NOT IN ('THROTTLED', 'PAUSED', 'BREAKER'))
                            FROM integration_log WHERE tenant_id = %s AND integration_id = %s AND direction = 'OUT' AND started_at >= %s""",
                       [hour] * 8 + [tenant_id, integration_id, day])
        (found["calls_1h"], found["failed_1h"], found["timed_1h"], p95, found["last_refused_at"], found["first_refused_at"], found["refused_count"],
         found["last_ok_at"], found["calls_24h"]) = cursor.fetchone()
        found["p95_ms"] = round(p95) if p95 is not None else None
        cursor.execute("SELECT max(started_at), count(*) FILTER (WHERE started_at >= %s) FROM integration_log WHERE tenant_id = %s AND integration_id = %s AND direction = 'IN'",
                       [day, tenant_id, integration_id])
        found["last_callback_at"], found["callbacks_24h"] = cursor.fetchone()

    quiet_until = now - timedelta(minutes=GRACE_MINUTES)
    after = max(found["last_callback_at"], day) if found["last_callback_at"] else day          # sent since the last callback: still waiting for news
    if provider.channel == "EMAIL":
        cursor.execute("""SELECT count(*) FILTER (WHERE submitted_at >= %s), count(*) FILTER (WHERE submitted_at > %s AND submitted_at < %s), count(*),
                                 count(*) FILTER (WHERE bounce_type = 'HARD'), count(*) FILTER (WHERE complained_at IS NOT NULL OR status = 'COMPLAINED')
                            FROM mailer_execution
                           WHERE tenant_id = %s AND delivery_provider_id = %s AND created_at >= %s AND submitted_at >= %s""",
                       [hour, after, quiet_until, tenant_id, str(provider.pk), day - timedelta(days=2), day])
        found["sent_1h"], found["awaiting_callback"], found["sent_24h"], found["hard_bounces"], found["complaints"] = cursor.fetchone()
    else:
        wait_until, window_from = now - timedelta(minutes=t["receipt_wait_minutes"]), now - timedelta(hours=RECEIPT_WINDOW_HOURS)
        cursor.execute("""SELECT count(*) FILTER (WHERE s.submitted_at >= %s), count(*) FILTER (WHERE s.submitted_at > %s AND s.submitted_at < %s), count(*),
                                 count(*) FILTER (WHERE s.status IN ('DELIVERED', 'RESPONDED', 'OPTED_OUT') OR s.delivered_at IS NOT NULL),
                                 count(*) FILTER (WHERE s.status = 'FAILED' AND s.failed_at IS NOT NULL),
                                 count(*) FILTER (WHERE s.status = 'SUBMITTED'),
                                 count(*) FILTER (WHERE s.submitted_at >= %s AND s.submitted_at < %s),
                                 count(*) FILTER (WHERE s.submitted_at >= %s AND s.submitted_at < %s AND s.status = 'SUBMITTED')
                            FROM sms_execution s
                            JOIN campaign c ON c.id = s.campaign_id AND c.tenant_id = s.tenant_id
                            JOIN sender_profile sp ON sp.id = c.sender_profile_id
                           WHERE s.tenant_id = %s AND sp.delivery_provider_id = %s AND s.created_at >= %s AND s.submitted_at >= %s""",
                       [hour, after, quiet_until, window_from, wait_until, window_from, wait_until, tenant_id, str(provider.pk), day - timedelta(days=2), day])
        (found["sent_1h"], found["awaiting_callback"], found["sent_24h"], found["delivered"], found["failed_receipts"], found["no_receipt_24h"],
         found["receipt_due"], found["receipt_missing"]) = cursor.fetchone()
    return found


# ---------------------------------------------------------------------------------------------------- the checks
def judge(provider, f: dict, now, t: dict | None = None) -> dict:
    """The checks of one engine from its figures, and the status they add up to."""
    from .providers import registry
    t = t or thresholds()
    try:
        cls = registry.adapter_class(provider.provider_type)
        callbacks_expected, label = cls.supports_webhooks, cls.label
    except Exception:                                      # noqa: BLE001  an engine whose adapter is gone still gets its other checks
        callbacks_expected, label = False, provider.provider_type.title()
    texts = provider.channel != "EMAIL"
    never_called_back = f["last_callback_at"] is None
    no_receipts_yet = texts and callbacks_expected and never_called_back
    checks = []

    # callbacks
    silence = timedelta(minutes=t["silence_minutes"])
    since = f"{age(now - f['last_callback_at'])} ago" if f["last_callback_at"] else "Never"
    if not callbacks_expected:
        checks.append(_check("callbacks", "Callbacks", OFF, "—", f"{label} sends no callbacks."))
    elif no_receipts_yet:
        checks.append(_check("callbacks", "Callbacks", OFF, "Never", "See Receipts."))
    elif f["awaiting_callback"] and (never_called_back or now - f["last_callback_at"] > silence):
        what = "No callback has ever arrived" if never_called_back else f"No callback for {age(now - f['last_callback_at'])}"
        waiting = f["awaiting_callback"]
        checks.append(_check("callbacks", "Callbacks", FAILING, since,
                             f"{what} while {waiting:,} message{'' if waiting == 1 else 's'} went out. Check that the engine still has its C360 callback "
                             f"address (Copy Webhook URL) and that it is switched on.",
                             f"Failing after {t['silence_minutes']} min without a callback while messages go out"))
    elif not f["sent_24h"] and not f["callbacks_24h"]:
        checks.append(_check("callbacks", "Callbacks", QUIET, since, "Nothing sent in the last day."))
    else:
        checks.append(_check("callbacks", "Callbacks", OK, since, f"{f['callbacks_24h']:,} in the last day.",
                             f"Failing after {t['silence_minutes']} min without a callback while messages go out"))

    # refused calls
    rate = _rate(f["failed_1h"], f["calls_1h"])
    refused_now = f["last_refused_at"] is not None and (f["last_ok_at"] is None or f["last_refused_at"] > f["last_ok_at"])
    line = f"Attention above {pct(t['rejection_pct'])}; Failing at once if the key is refused"
    if f["breaker_until"] and f["breaker_until"] > now:
        checks.append(_check("refused", "Refused Calls, 1 h", FAILING, "Breaker open",
                             f"Too many calls failed in a row, so calls to {label} are paused until {timezone.localtime(f['breaker_until']):%H:%M}.", line))
    elif refused_now:
        checks.append(_check("refused", "Refused Calls, 1 h", FAILING, f"{f['refused_count']} refused",
                             f"Key refused: {f['refused_count']} call{'' if f['refused_count'] == 1 else 's'} answered 401 or 403 since "
                             f"{timezone.localtime(f['first_refused_at']):%H:%M}. Enter the engine's current key (Edit), then press Check.", line))
    elif not f["calls_1h"]:
        checks.append(_check("refused", "Refused Calls, 1 h", QUIET, "—", "No calls in the last hour.", line))
    elif f["calls_1h"] < t["min_sample"]:
        checks.append(_check("refused", "Refused Calls, 1 h", QUIET, f"{f['failed_1h']:,} of {f['calls_1h']:,}",
                             f"Only {f['calls_1h']:,} call{'' if f['calls_1h'] == 1 else 's'} in the last hour: too few to judge.", line))
    elif rate > t["rejection_pct"]:
        checks.append(_check("refused", "Refused Calls, 1 h", ATTENTION, pct(rate),
                             f"{f['failed_1h']:,} of {f['calls_1h']:,} calls in the last hour were refused or failed.", line))
    else:
        checks.append(_check("refused", "Refused Calls, 1 h", OK, pct(rate), f"{f['failed_1h']:,} of {f['calls_1h']:,} calls.", line))

    # API speed
    line = f"Attention above {duration(t['p95_ms'])}"
    if f["timed_1h"] < MIN_TIMED_CALLS:
        checks.append(_check("speed", "API Speed, 1 h", QUIET, duration(f["p95_ms"]), "Too few calls in the last hour to judge.", line))
    elif f["p95_ms"] > t["p95_ms"]:
        checks.append(_check("speed", "API Speed, 1 h", ATTENTION, duration(f["p95_ms"]),
                             f"Slow: 1 call in 20 took longer than {duration(f['p95_ms'])} in the last hour.", line))
    else:
        checks.append(_check("speed", "API Speed, 1 h", OK, duration(f["p95_ms"]), "95% of calls were answered faster than this.", line))

    # bounces and complaints, or failed texts
    if texts:
        receipts = f["delivered"] + f["failed_receipts"]
        failed = _rate(f["failed_receipts"], receipts)
        line = f"Attention above {pct(t['sms_failure_pct'])} of receipts"
        if no_receipts_yet or receipts < t["min_sample"]:
            checks.append(_check("bounces", "Failed Texts, 24 h", QUIET, f"{f['failed_receipts']:,} of {receipts:,}" if receipts else "—",
                                 "No delivery receipts to judge." if not receipts else f"Only {receipts:,} receipts in the last day: too few to judge.", line))
        else:
            state = FAILING if failed > 2 * t["sms_failure_pct"] else ATTENTION if failed > t["sms_failure_pct"] else OK
            checks.append(_check("bounces", "Failed Texts, 24 h", state, pct(failed), f"{f['failed_receipts']:,} of {receipts:,} receipts said the text failed.", line))
    else:
        hard, complaints = _rate(f["hard_bounces"], f["sent_24h"]), _rate(f["complaints"], f["sent_24h"])
        line = f"Attention above {pct(t['hard_bounce_pct'])} hard bounces or {pct(t['complaint_pct'])} complaints"
        value = f"{pct(hard)} · {pct(complaints)}"
        if f["sent_24h"] < t["min_sample"]:
            checks.append(_check("bounces", "Bounces · Complaints, 24 h", QUIET,
                                 f"{f['hard_bounces']:,} · {f['complaints']:,} of {f['sent_24h']:,}" if f["sent_24h"] else "—",
                                 "Nothing sent in the last day." if not f["sent_24h"] else f"Only {f['sent_24h']:,} sent in the last day: too few to judge.", line))
        else:
            over = max(hard / t["hard_bounce_pct"] if t["hard_bounce_pct"] else 0, complaints / t["complaint_pct"] if t["complaint_pct"] else 0)
            state = FAILING if over > 2 else ATTENTION if over > 1 else OK
            said = []
            if hard > t["hard_bounce_pct"]:
                said.append(f"hard bounces {pct(hard)}")
            if complaints > t["complaint_pct"]:
                said.append(f"complaints {pct(complaints)}")
            summary = (f"{' and '.join(said).capitalize()} of {f['sent_24h']:,} sent in the last day. Look for a list with old or bought addresses."
                       if said else f"Of {f['sent_24h']:,} sent in the last day.")
            checks.append(_check("bounces", "Bounces · Complaints, 24 h", state, value, summary, line))

    # receipts (texts)
    if texts:
        line = f"Attention when more than {pct(t['missing_receipt_pct'])} of texts have no receipt after {t['receipt_wait_minutes']} min"
        if not callbacks_expected:
            checks.append(_check("receipts", "Receipts", OFF, "—", f"{label} sends no delivery receipts."))
        elif no_receipts_yet:
            waiting = f" ({f['no_receipt_24h']:,} in the last day)" if f["no_receipt_24h"] else ""
            checks.append(_check("receipts", "Receipts", ATTENTION, "None yet",
                                 f"{label} has not sent delivery receipts yet, so texts show Sent, not Delivered{waiting}. "
                                 "This clears by itself with the first receipt.", line, standing=True))
        elif not f["receipt_due"]:
            checks.append(_check("receipts", "Receipts", QUIET, "—", f"No texts sent in the last {RECEIPT_WINDOW_HOURS} hours.", line))
        else:
            missing = _rate(f["receipt_missing"], f["receipt_due"])
            if missing > t["missing_receipt_pct"]:
                checks.append(_check("receipts", "Receipts", ATTENTION, f"{f['receipt_missing']:,} missing",
                                     f"{f['receipt_missing']:,} of {f['receipt_due']:,} texts sent in the last {RECEIPT_WINDOW_HOURS} hours have had no delivery receipt "
                                     f"for more than {t['receipt_wait_minutes']} min.", line))
            else:
                checks.append(_check("receipts", "Receipts", OK, f"{f['receipt_missing']:,} missing", f"Of {f['receipt_due']:,} texts in the last {RECEIPT_WINDOW_HOURS} hours.", line))

    # the daily Check
    when = timezone.localtime(provider.last_checked_at) if provider.last_checked_at else None
    stamp = (f"{when:%H:%M}" if when and now - provider.last_checked_at < timedelta(hours=20) else f"{when:%d %b, %H:%M}") if when else ""
    if provider.last_check_ok is False:
        checks.append(_check("daily_check", "Daily Check", FAILING, "Failed", f"The Check at {stamp} failed: {(provider.last_check_error or 'no reason given')[:160]}",
                             "Runs once a day: key and address, nothing sent"))
    elif when is None:
        checks.append(_check("daily_check", "Daily Check", QUIET, "Not yet", "Not checked yet. Press Check, or wait for the daily Check.", "Runs once a day: key and address, nothing sent"))
    else:
        checks.append(_check("daily_check", "Daily Check", OK, "Passed", f"{stamp}: the key and address were accepted. Nothing was sent.", "Runs once a day: key and address, nothing sent"))

    failing = [c for c in checks if c["state"] == FAILING]
    attention = [c for c in checks if c["state"] == ATTENTION]
    if failing:
        status, summary = "FAILING", failing[0]["summary"]
    elif attention:
        status, summary = "ATTENTION", attention[0]["summary"]
    elif not f["sent_24h"] and not f["calls_24h"]:
        status, summary = "QUIET", "Nothing sent in the last day."
    else:
        status, summary = "HEALTHY", ""
    standing = status == "ATTENTION" and all(c["standing"] for c in attention)
    return {"status": status, "summary": summary[:300], "standing": standing, "checks": checks}


def evaluate(provider, now=None) -> dict:
    """One engine's checks, read and judged inside the workspace's scope (a tenant_scope must be open)."""
    now = now or timezone.now()
    with session.tx(), session.connection().cursor() as cursor:
        figures = _figures(cursor, provider, now)
    result = judge(provider, figures, now)
    result["figures"] = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in figures.items()}
    return result


def _save(provider, result: dict, now) -> None:
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""INSERT INTO delivery_provider_health (delivery_provider_id, tenant_id, status, summary, checks, figures, checked_at, status_since)
                          VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
                          ON CONFLICT (delivery_provider_id) DO UPDATE
                             SET status = EXCLUDED.status, summary = EXCLUDED.summary, checks = EXCLUDED.checks, figures = EXCLUDED.figures, checked_at = EXCLUDED.checked_at,
                                 status_since = CASE WHEN delivery_provider_health.status = EXCLUDED.status THEN delivery_provider_health.status_since ELSE EXCLUDED.checked_at END""",
                       [str(provider.pk), str(provider.tenant_id), result["status"], result["summary"], json.dumps(result["checks"]), json.dumps(result["figures"]), now, now])


def present(alias: str | None = None) -> bool:
    """False until patch 0069 is applied."""
    with connections[alias or P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('delivery_provider_health') IS NOT NULL")
        return bool(cursor.fetchone()[0])


def _tenants() -> list[str]:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT id FROM tenant WHERE status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code")
        return [str(row[0]) for row in cursor.fetchall()]


def _active_providers(tenant_id) -> list:
    from .models import DeliveryProvider
    with session.tx():
        return list(DeliveryProvider.objects.filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True).order_by("channel", "name"))


def refresh(provider, now=None) -> dict | None:
    """Re-checks one engine and stores the result (after its Check, so a fixed key shows at once). None before patch 0069."""
    now = now or timezone.now()
    with session.tenant_scope(provider.tenant_id) as scope:
        if not present(scope.db_alias):
            return None
        result = evaluate(provider, now)
        _save(provider, result, now)
    return result


def run(now=None, tenants=None) -> dict:
    """The check-engine-health job."""
    now = now or timezone.now()
    if not present():
        return {"skipped": "delivery_provider_health is missing: apply patch 0069"}
    counts = {"engines": 0, "HEALTHY": 0, "ATTENTION": 0, "FAILING": 0, "QUIET": 0, "errors": []}
    for tenant_id in tenants if tenants is not None else _tenants():
        try:
            with session.tenant_scope(tenant_id):
                for provider in _active_providers(tenant_id):
                    result = evaluate(provider, now)
                    _save(provider, result, now)
                    counts["engines"] += 1
                    counts[result["status"]] += 1
        except Exception as exc:                           # noqa: BLE001  one workspace's problem must not stop the others' checks
            log.exception("engine health of tenant %s failed", tenant_id)
            counts["errors"].append(f"{tenant_id}: {exc.__class__.__name__}: {str(exc)[:200]}")
    if counts["errors"] and not counts["engines"]:
        raise RuntimeError("; ".join(counts["errors"][:3]))
    return counts


# ---------------------------------------------------------------------------------------------------- the Check
def run_check(provider) -> dict:
    """Validates the engine's key and address with it, without sending, and stores the outcome on the engine.
    What the check learned about the engine (Digivize's signature form) is kept in its settings."""
    from .models import DeliveryProvider
    from .providers import ProviderError, registry
    learned = {}
    try:
        adapter = registry.for_provider(provider)
        ok, detail = adapter.check()
        learned = getattr(adapter, "detected_config", None) or {}
    except ProviderError as exc:
        ok, detail = False, str(exc)
    except Exception as exc:                               # noqa: BLE001  a timeout or a refused connection is a failed check, not a crash
        ok, detail = False, f"{exc.__class__.__name__}: {str(exc)[:300]}"
    fields = {"last_checked_at": timezone.now(), "last_check_ok": ok, "last_check_error": detail or None}
    if ok and learned and any((provider.config or {}).get(key) != value for key, value in learned.items()):
        fields["config"] = {**(provider.config or {}), **learned}
    with session.tx():                                     # after the call: no transaction is held open while the engine answers
        DeliveryProvider.objects.filter(pk=provider.pk).update(**fields)
    for key, value in fields.items():
        setattr(provider, key, value)
    return {"ok": ok, "detail": detail or None, **({"config": fields["config"]} if "config" in fields else {})}


def check_all(tenants=None) -> dict:
    """The check-engines-daily job: every active engine's Check. A failed Check shows as the engine's Daily Check."""
    done = {"checked": 0, "failed": [], "errors": []}
    for tenant_id in tenants if tenants is not None else _tenants():
        try:
            with session.tenant_scope(tenant_id):
                for provider in _active_providers(tenant_id):
                    result = run_check(provider)
                    done["checked"] += 1
                    if not result["ok"]:
                        done["failed"].append(f"{provider.name}: {(result['detail'] or '')[:120]}")
                    refresh(provider)
        except Exception as exc:                           # noqa: BLE001
            log.exception("daily engine check of tenant %s failed", tenant_id)
            done["errors"].append(f"{tenant_id}: {exc.__class__.__name__}: {str(exc)[:200]}")
    if done["errors"] and not done["checked"]:
        raise RuntimeError("; ".join(done["errors"][:3]))
    return done


# ---------------------------------------------------------------------------------------------------- reading
def for_tenant(tenant_id) -> dict[str, dict]:
    """provider id -> its stored result, on the current workspace connection. Empty before patch 0069."""
    connection = session.connection()
    if not present(connection.alias):
        return {}
    with connection.cursor() as cursor:
        cursor.execute("SELECT delivery_provider_id, status, summary, checks, checked_at, status_since FROM delivery_provider_health WHERE tenant_id = %s",
                       [str(tenant_id)])
        rows = cursor.fetchall()
    out = {}
    for provider_id, status, summary, checks, checked_at, since in rows:
        checks = checks if isinstance(checks, list) else json.loads(checks or "[]")
        attention = [c for c in checks if c["state"] == ATTENTION]
        out[str(provider_id)] = {"status": status, "summary": summary or "", "checks": checks, "checked_at": checked_at, "status_since": since,
                                 "standing": status == "ATTENTION" and bool(attention) and all(c.get("standing") for c in attention)}
    return out


ORDER = {"FAILING": 0, "ATTENTION": 1, "HEALTHY": 2, "QUIET": 3}


def overview() -> dict | None:
    """Every active engine of every workspace with its stored result, worst first; None before patch 0069."""
    if not present():
        return None
    with connections[P].cursor() as cursor:
        cursor.execute("""SELECT t.code, t.name, p.id, p.name, p.provider_type, p.channel, p.config, h.status, h.summary, h.checks, h.figures, h.checked_at, h.status_since
                            FROM delivery_provider p
                            JOIN tenant t ON t.id = p.tenant_id
                            LEFT JOIN delivery_provider_health h ON h.delivery_provider_id = p.id
                           WHERE p.is_active AND p.deleted_at IS NULL AND t.deleted_at IS NULL AND t.status = 'ACTIVE'""")
        rows = cursor.fetchall()
    engines = []
    for code, tenant_name, pk, name, provider_type, channel, config, status, summary, checks, figures, checked_at, since in rows:
        checks = checks if isinstance(checks, list) else json.loads(checks or "[]")
        attention = [c for c in checks if c["state"] == ATTENTION]
        config = config if isinstance(config, dict) else json.loads(config or "{}")
        figures = figures if isinstance(figures, dict) else json.loads(figures or "{}")
        engines.append({"tenant": code, "tenant_name": tenant_name, "id": str(pk), "name": name, "provider_type": provider_type, "channel": channel,
                        "host": urlparse(config.get("endpoint") or "").hostname or config.get("host") or "", "status": status or "", "summary": summary or "",
                        "checks": {c["key"]: c for c in checks}, "figures": figures, "checked_at": checked_at, "status_since": since,
                        "standing": status == "ATTENTION" and bool(attention) and all(c.get("standing") for c in attention)})
    engines.sort(key=lambda e: (ORDER.get(e["status"], 4), e["tenant"], e["name"]))
    counts = {key: sum(1 for e in engines if e["status"] == key) for key in ORDER}
    last = max((e["checked_at"] for e in engines if e["checked_at"]), default=None)
    return {"engines": engines, "counts": counts, "total": len(engines), "checked_at": last, "thresholds": thresholds()}


def failing_count() -> int:
    """Engines failing now, for the number on the back-office menu; 0 before patch 0069."""
    if not present():
        return 0
    with connections[P].cursor() as cursor:
        cursor.execute("""SELECT count(*) FROM delivery_provider_health h JOIN delivery_provider p ON p.id = h.delivery_provider_id
                           WHERE h.status = 'FAILING' AND p.is_active AND p.deleted_at IS NULL""")
        return cursor.fetchone()[0]


def problems() -> dict:
    """For the alert evaluator: one entry per engine and failing check, name -> (severity, summary, detail, standing)."""
    data = overview()
    found = {}
    for engine in (data or {}).get("engines", []):
        for check in engine["checks"].values():
            if check["state"] not in (FAILING, ATTENTION):
                continue
            name = f"Engine · {engine['tenant']} · {engine['name']} · {check['label'].split(',')[0]}"[:100]
            found[name] = ("FAIL" if check["state"] == FAILING else "WARN", check["summary"],
                           "Back-office → Engine Health; the workspace's Settings → Sending Engines.", bool(check.get("standing")))
    return found
