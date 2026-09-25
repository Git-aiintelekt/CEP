"""The guard around an API endpoint an outside system calls.

    ApiKeyRateThrottle          every API-key call counts against api_client.rate_limit_per_minute (a global throttle class)
    WorkspaceInboundThrottle    an integration endpoint counts against the workspace's inbound limit as well
    InboundLogMixin             the view's dispatch is timed and written to the log, whatever the outcome

Refusals answer 429 with Retry-After and the X-RateLimit-* headers; every answer carries X-RateLimit-* when a limit
applies, so an integrator can pace itself before being refused.
"""
import json

from rest_framework import exceptions, throttling
from rest_framework.exceptions import APIException

from apps.tenants import context

from . import correlation, logbook, throttle

HEADERS = ("X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset")


class IntegrationPaused(APIException):
    status_code = 503
    default_detail = "This integration is paused in the workspace's settings."
    default_code = "integration_paused"


def _api_client(request):
    return getattr(getattr(request, "user", None), "client", None)


def _raw(request):
    """The Django request under DRF's wrapper: what the throttles note there is read back by the view's dispatch."""
    return getattr(request, "_request", request)


def _remember(request, decision: throttle.Decision) -> None:
    """The tightest of the limits that applied, for the response headers."""
    raw = _raw(request)
    current = getattr(raw, "_cep_rate", None)
    if current is None or (decision.limit is not None and (current.limit is None or decision.remaining < current.remaining)):
        raw._cep_rate = decision


class ApiKeyRateThrottle(throttling.BaseThrottle):
    """api_client.rate_limit_per_minute, enforced. A user session or a key with no limit passes straight through."""

    def allow_request(self, request, view):
        client = _api_client(request)
        if client is None or not client.rate_limit_per_minute:
            return True
        decision = throttle.take(f"apikey:{client.pk}", int(client.rate_limit_per_minute))
        _remember(request, decision)
        self.retry_after = decision.retry_after
        return decision.allowed

    def wait(self):
        return getattr(self, "retry_after", None) or 1


class WorkspaceInboundThrottle(throttling.BaseThrottle):
    """The workspace's inbound calls per minute for an integration kind (the view names it in `integration_kind`)."""

    def allow_request(self, request, view):
        ctx = context.current()
        if ctx is None:
            return True
        kind = getattr(view, "integration_kind", logbook.KIND_POS)
        system = getattr(view, "integration_system", "POS")
        integration = logbook.integration_for(ctx.tenant_id, kind=kind, system=system)
        _raw(request)._cep_integration = integration
        if integration and integration.get("status") == "PAUSED":
            raise IntegrationPaused()
        limit = logbook.inbound_limit(ctx.tenant_id, integration)
        if not limit:
            return True
        decision = throttle.take(f"inbound:{ctx.tenant_id}:{kind}", limit, (integration or {}).get("throttle_burst"))
        _remember(request, decision)
        self.retry_after = decision.retry_after
        return decision.allowed

    def wait(self):
        return getattr(self, "retry_after", None) or 1


def outcome_for(status: int) -> str:
    if status < 400:
        return "OK"
    if status == 429:
        return "THROTTLED"
    if status == 503:
        return "PAUSED"
    if status >= 500:
        return "ERROR"
    return "REJECTED"


class InboundLogMixin:
    """Wraps DRF's dispatch: the raw request and the answer, timed, go to the log whatever happened in between.
    `integration_kind`, `integration_system` name the record; `integration_ref(request, data)` gives the related reference.

    The tenant middleware rolls the request back on a 5xx answer. A workspace in the pool has its row written on the
    platform connection, so it survives; on a dedicated database the row goes with the rollback and the server log
    keeps the essentials instead."""
    integration_kind = logbook.KIND_POS
    integration_system = "POS"
    throttle_classes = [ApiKeyRateThrottle, WorkspaceInboundThrottle]

    def integration_ref(self, request, body: dict | None) -> str | None:
        return None

    def dispatch(self, request, *args, **kwargs):
        watch = logbook.Stopwatch()
        raw = request.body                                     # read before DRF parses it, so the log holds exactly what was sent
        response = super().dispatch(request, *args, **kwargs)
        ctx = context.current()
        if ctx is None:                                        # unknown tenant: the middleware answered before any of this
            return response
        try:
            parsed = json.loads(raw or b"null")
        except ValueError:
            parsed = None
        integration = getattr(request, "_cep_integration", None) or logbook.integration_for(ctx.tenant_id, kind=self.integration_kind, system=self.integration_system)
        client = _api_client(request)
        status = int(response.status_code)
        answer = getattr(response, "data", None)
        try:
            answer_text = json.dumps(answer, default=str) if answer is not None else None
        except (TypeError, ValueError):
            answer_text = str(answer)
        outcome = outcome_for(status)
        related_ref = self.integration_ref(request, parsed if isinstance(parsed, dict) else None)
        logbook.record(tenant_id=ctx.tenant_id, integration=integration, direction="IN", kind=self.integration_kind, system=self.integration_system,
                       related_ref=related_ref, method=request.method, url=request.get_full_path(), request_headers=dict(request.headers), request_body=raw,
                       response_status=status, response_headers={k: v for k, v in response.items()}, response_body=answer_text, outcome=outcome,
                       error_message=_detail(answer) if status >= 400 else None, duration_ms=watch.ms(), api_client_id=client.pk if client else None,
                       own_transaction=True)
        if status >= 500:
            logbook.log.warning("inbound %s %s answered %s (%s) for %s ref=%s correlation=%s", request.method, request.path, status, outcome,
                                ctx.tenant_id, related_ref, correlation.current())
        return response

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        decision = getattr(request, "_cep_rate", None)
        if decision is not None and decision.limit is not None:
            response["X-RateLimit-Limit"] = str(decision.limit)
            response["X-RateLimit-Remaining"] = str(decision.remaining)
            response["X-RateLimit-Reset"] = str(decision.reset_in)
            if not decision.allowed:
                response["Retry-After"] = str(decision.retry_after)
        return response


def _detail(answer) -> str | None:
    if isinstance(answer, dict):
        return str(answer.get("detail") or answer.get("title") or answer.get("errors") or "")[:500] or None
    return None


__all__ = ["ApiKeyRateThrottle", "WorkspaceInboundThrottle", "InboundLogMixin", "IntegrationPaused", "exceptions"]
