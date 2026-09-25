"""The guard around a provider adapter.

    guarded_send(adapter, message, related_ref)   what the engine calls instead of adapter.send()
    LoggedSession                                 the requests session an HTTP adapter uses: every call timed and logged
    Breaker                                       consecutive provider failures open the circuit for a cooldown

Order of a guarded send: is the integration paused → is the circuit open → wait for the throttle → send → note the
outcome for the breaker. An adapter without HTTP (SMTP, the sandbox) gets one synthetic log row per send so the log is
complete for every engine.
"""
import logging
import time

import requests
from django.core.cache import cache
from django.utils import timezone

from . import logbook, throttle

log = logging.getLogger("cep.integrations")


class Breaker:
    """Consecutive-failure counter in the cache, shared by every worker. Open = no calls until the cooldown passes."""

    def __init__(self, integration: dict | None):
        self.integration = integration
        self.id = integration["id"] if integration else None
        self.threshold = int((integration or {}).get("breaker_failures") or 0)
        self.cooldown = int((integration or {}).get("breaker_cooldown_seconds") or 60)

    @property
    def enabled(self) -> bool:
        return bool(self.id) and self.threshold > 0

    def open_until(self) -> float | None:
        if not self.enabled:
            return None
        until = cache.get(f"cep:breaker:{self.id}:open")
        return float(until) if until and float(until) > time.time() else None

    def failure(self) -> bool:
        """Counts one failure; True when this one opened the circuit."""
        if not self.enabled:
            return False
        key = f"cep:breaker:{self.id}:failures"
        count = 1 if cache.add(key, 1, self.cooldown * 4) else cache.incr(key)
        if count >= self.threshold:
            cache.set(f"cep:breaker:{self.id}:open", time.time() + self.cooldown, self.cooldown)
            cache.delete(key)
            self._mirror(timezone.now() + timezone.timedelta(seconds=self.cooldown))
            return True
        return False

    def success(self) -> None:
        if self.enabled:
            cache.delete(f"cep:breaker:{self.id}:failures")

    def reset(self) -> None:
        if self.enabled:
            cache.delete_many([f"cep:breaker:{self.id}:failures", f"cep:breaker:{self.id}:open"])
            self._mirror(None)

    def _mirror(self, until) -> None:
        from django.db import connections, transaction
        try:
            alias = logbook._alias()
            with transaction.atomic(using=alias), connections[alias].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [self.integration["tenant_id"]])
                cursor.execute("UPDATE integration SET breaker_open_until = %s WHERE id = %s", [until, self.id])
        except Exception as exc:                               # noqa: BLE001
            log.debug("breaker state not mirrored: %s", exc)


class Guard:
    """What an adapter carries while it is used: the integration record, the breaker, and the reference of the send in progress."""

    def __init__(self, adapter):
        self.adapter = adapter
        self.tenant_id = adapter.tenant_id or None
        self.integration = None
        if self.tenant_id and adapter.provider_id:
            provider = _provider_stub(adapter)
            self.integration = logbook.integration_for(self.tenant_id, kind=logbook.KIND_PROVIDER, system=adapter.provider_type, provider=provider)
        self.breaker = Breaker(self.integration)
        self.related_ref: str | None = None
        self.attempt = 1
        self.calls = 0

    @property
    def system(self) -> str:
        return self.adapter.provider_type or "PROVIDER"

    def scope(self, message=None) -> str:
        """The throttle lane: an engine with a second credential gives transactional traffic its own, so receipts never wait behind a campaign."""
        base = f"provider:{self.adapter.provider_id or self.system}"
        carries = getattr(self.adapter, "carries_transactional", None)
        return f"{base}:transactional" if message is not None and carries and carries(message) else base

    def rate(self) -> tuple[int | None, int | None]:
        """The engine's rate: the integration record's figure when set, else the provider row's own rate_limit_per_minute."""
        if self.integration and self.integration.get("throttle_per_minute"):
            return int(self.integration["throttle_per_minute"]), self.integration.get("throttle_burst")
        return getattr(self.adapter, "rate_limit_per_minute", None), (self.integration or {}).get("throttle_burst")

    def log(self, **fields) -> None:
        if not self.tenant_id:
            return
        logbook.record(tenant_id=self.tenant_id, integration=self.integration, direction="OUT", kind=logbook.KIND_PROVIDER, system=self.system,
                       related_ref=self.related_ref, attempt=self.attempt, **fields)


class _ProviderStub:
    def __init__(self, pk, name):
        self.pk, self.name = pk, name


def _provider_stub(adapter):
    return _ProviderStub(adapter.provider_id, getattr(adapter, "provider_name", None) or adapter.label or adapter.provider_type)


def outcome_for_status(status: int) -> str:
    if status < 400:
        return "OK"
    if status == 429 or status >= 500:
        return "RETRY"
    return "REJECTED"


class LoggedSession(requests.Session):
    """A requests session whose every call is timed and written to the integration log, redacted and capped."""

    def __init__(self, guard: Guard):
        super().__init__()
        self.guard = guard

    def request(self, method, url, **kwargs):               # noqa: A003
        watch = logbook.Stopwatch()
        body = kwargs.get("json") if kwargs.get("json") is not None else kwargs.get("data")
        merged_headers = {**self.headers, **(kwargs.get("headers") or {})}
        self.guard.calls += 1
        try:
            response = super().request(method, url, **kwargs)
        except requests.RequestException as exc:
            self.guard.log(method=method, url=url, request_headers=merged_headers, request_body=body, outcome="ERROR",
                           error_class=exc.__class__.__name__, error_message=str(exc), duration_ms=watch.ms())
            raise
        self.guard.log(method=method, url=url, request_headers=merged_headers, request_body=body, response_status=response.status_code,
                       response_headers=dict(response.headers), response_body=response.content, outcome=outcome_for_status(response.status_code),
                       duration_ms=watch.ms())
        return response


def guarded_send(adapter, message, related_ref: str | None = None):
    """adapter.send(message) with the integration's pause, circuit breaker and throttle in front of it, and a log row behind it."""
    from apps.delivery.providers.base import Outcome, ProviderError

    guard = getattr(adapter, "guard", None)
    if guard is None:
        guard = adapter.guard = Guard(adapter)
    guard.related_ref = related_ref
    integration = guard.integration
    synthetic_url = f"{guard.system.lower()}://{adapter.provider_id or 'engine'}"
    summary = {"to": getattr(message, "to_email", None) or getattr(message, "to_number", None), "subject": getattr(message, "subject", None),
               "idempotency_key": getattr(message, "idempotency_key", None), "tag": getattr(message, "tag", None), "traffic": getattr(message, "traffic", None)}

    if integration and integration.get("status") == "PAUSED":
        guard.log(method="SEND", url=synthetic_url, request_body=summary, outcome="PAUSED", error_message="The integration is paused")
        raise ProviderError(f"{guard.system}: this sending engine is paused in Settings → Integrations.", retryable=True)
    until = guard.breaker.open_until()
    if until:
        guard.log(method="SEND", url=synthetic_url, request_body=summary, outcome="BREAKER", error_message=f"circuit open for {int(until - time.time())}s more")
        raise ProviderError(f"{guard.system}: the circuit is open after repeated failures; retried in {int(until - time.time())}s.", retryable=True)
    per_minute, burst = guard.rate()
    try:
        throttle.wait(guard.scope(message), per_minute, burst)
    except throttle.Throttled as exc:
        guard.log(method="SEND", url=synthetic_url, request_body=summary, outcome="THROTTLED", error_message=str(exc))
        raise ProviderError(f"{guard.system}: {exc}", retryable=True) from None

    before = guard.calls
    watch = logbook.Stopwatch()
    try:
        result = adapter.send(message)
    except ProviderError as exc:
        opened = guard.breaker.failure()
        if guard.calls == before:
            guard.log(method="SEND", url=synthetic_url, request_body=summary, outcome="ERROR", error_class=exc.__class__.__name__, error_message=str(exc),
                      duration_ms=watch.ms())
        if opened:
            log.warning("circuit opened for %s (%s)", guard.system, integration and integration["id"])
        raise
    if guard.calls == before:                                  # no HTTP call was logged: SMTP, the sandbox, a stub
        outcome = {Outcome.ACCEPTED: "OK", Outcome.REJECTED: "REJECTED"}.get(result.outcome, "RETRY")
        guard.log(method="SEND", url=synthetic_url, request_body=summary, response_body={"outcome": result.outcome.value, "reason": result.reason,
                  "provider_message_id": result.provider_message_id}, outcome=outcome, error_message=result.reason if outcome != "OK" else None,
                  duration_ms=watch.ms())
    if result.outcome is Outcome.RETRY:
        guard.breaker.failure()
    else:
        guard.breaker.success()
    return result
