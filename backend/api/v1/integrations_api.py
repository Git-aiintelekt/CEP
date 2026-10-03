"""Settings -> Integrations: the workspace's integrations with their last day's figures, the call log, and pause / resume.

    GET  /integrations/                          status per integration (health, calls, error rate, p95, throttled, last call)
    GET  /integrations/log/?integration=&direction=&outcome=&q=&before=   newest first, 100 at a time; q matches a correlation id or a reference
    GET  /integrations/log/{id}/                 one call with its request and response
    GET  /integrations/{id}/metrics/?hours=      buckets for a chart
    POST /integrations/{id}/pause/ | /resume/    the kill switch; a paused inbound integration answers 503, a paused engine waits
"""
import re

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode
from apps.integrations.bridge import logbook, metrics
from apps.integrations.bridge.outbound import Breaker
from apps.integrations.models import Integration, IntegrationLog
from apps.platform_ops import notifications
from apps.tenants import context

MANAGE = [IsAuthenticated, HasPermissionCode.for_("provider.edit")]
PAGE = 25                                                  # rows per page of the call log unless the viewer chose another size
PAGE_SIZES = (10, 25, 50, 100)


def _tenant_id():
    return context.require().tenant_id


class IntegrationLogRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = IntegrationLog
        fields = ("id", "integration_id", "direction", "kind", "system", "correlation_id", "related_ref", "method", "url", "response_status", "outcome",
                  "error_class", "error_message", "attempt", "duration_ms", "request_bytes", "response_bytes", "api_client_id", "started_at")


class IntegrationLogDetailSerializer(IntegrationLogRowSerializer):
    class Meta(IntegrationLogRowSerializer.Meta):
        fields = IntegrationLogRowSerializer.Meta.fields + ("request_headers", "request_body", "response_headers", "response_body", "worker")


class IntegrationListView(APIView):
    permission_classes = MANAGE

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant_id = _tenant_id()
        logbook.ensure_defaults(tenant_id)
        muted = notifications.settings_of(tenant_id)["muted_integrations"]
        return Response([{**row, "alerts_enabled": row["id"] not in muted} for row in metrics.status(tenant_id)])


class IntegrationLogListView(APIView):
    permission_classes = MANAGE

    @extend_schema(parameters=[OpenApiParameter("integration", str), OpenApiParameter("direction", str), OpenApiParameter("outcome", str),
                               OpenApiParameter("q", str, description="a correlation id or a related reference"),
                               OpenApiParameter("page", int, description="1-based"), OpenApiParameter("page_size", int, description=f"one of {', '.join(map(str, PAGE_SIZES))}; default {PAGE}")],
                   responses=IntegrationLogRowSerializer(many=True))
    def get(self, request, version=None):
        rows = IntegrationLog.objects.filter(tenant_id=_tenant_id()).order_by("-started_at", "-id")
        params = request.query_params
        if params.get("integration"):
            rows = rows.filter(integration_id=params["integration"])
        if params.get("direction") in ("IN", "OUT"):
            rows = rows.filter(direction=params["direction"])
        if params.get("outcome"):
            outcomes = [o for o in params["outcome"].split(",") if o in logbook.OUTCOMES]
            rows = rows.filter(outcome__in=outcomes) if outcomes else rows
        if params.get("failed") == "1":
            rows = rows.exclude(outcome="OK")
        if params.get("q"):
            q = params["q"].strip()[:200]
            rows = rows.filter(correlation_id=q) | rows.filter(related_ref=q)
        page, size = _page(params.get("page")), _page_size(params.get("page_size"))
        count = rows.count()
        start = (page - 1) * size
        return Response({"results": IntegrationLogRowSerializer(rows[start:start + size], many=True).data, "count": count, "page": page, "page_size": size})


def _page(raw) -> int:
    try:
        return max(1, int(raw or 1))
    except (TypeError, ValueError):
        raise ValidationError({"page": "Expected a page number."}) from None


def _page_size(raw) -> int:
    """one of the offered sizes; anything else is the default, so an old link still works"""
    try:
        size = int(raw)
    except (TypeError, ValueError):
        return PAGE
    return size if size in PAGE_SIZES else PAGE


class IntegrationAlertsView(APIView):
    """The Email Alerts switch on a card: whether a circuit opening on this integration notifies the workspace."""
    permission_classes = MANAGE

    @extend_schema(request=inline_serializer("IntegrationAlerts", {"enabled": serializers.BooleanField()}), responses={200: None})
    def post(self, request, pk, version=None):
        tenant_id = _tenant_id()
        if not Integration.objects.filter(tenant_id=tenant_id, pk=pk).exists():
            raise NotFound("No such integration.")
        enabled = bool(request.data.get("enabled", True))
        notifications.set_integration_alerts(tenant_id, pk, enabled)
        return Response({"id": str(pk), "alerts_enabled": enabled})


SEND_REF = re.compile(r"^(mailer_execution|sms_execution):(\d+)$")


class IntegrationLogRetryView(APIView):
    """Retry Send on a failed outbound row: the message is queued again and the dispatcher's next pass sends it."""
    permission_classes = MANAGE

    @staticmethod
    def _execution_of(row, tenant_id, alias):
        """(table, id) of the message a send row carried: from its reference, else from the idempotency key the log kept."""
        import json
        from django.db import connections
        found = SEND_REF.match(row.related_ref or "")
        if found:
            return found.group(1), int(found.group(2))
        try:
            key = (json.loads(row.request_body or "{}") or {}).get("idempotency_key")
        except ValueError:
            key = None
        if not key:
            return None, None
        with connections[alias].cursor() as cursor:
            for table in ("mailer_execution", "sms_execution"):
                cursor.execute(f"SELECT id FROM {table} WHERE tenant_id = %s AND idempotency_key = %s ORDER BY id DESC LIMIT 1", [str(tenant_id), key])
                hit = cursor.fetchone()
                if hit:
                    return table, int(hit[0])
        return None, None

    @extend_schema(request=None, responses={200: None})
    def post(self, request, pk, version=None):
        from django.db import connections, transaction
        from apps.campaigns import service
        from apps.tenants import context
        from . import views
        tenant_id = _tenant_id()
        row = IntegrationLog.objects.filter(tenant_id=tenant_id, pk=pk).first()
        if row is None:
            raise NotFound("No such call in the log.")
        if row.direction != "OUT" or row.kind != logbook.KIND_PROVIDER:
            raise Conflict("Only a send can be retried: this call is not one.")
        if row.outcome == "OK":
            raise Conflict("This send went through; there is nothing to retry.")
        alias = context.require().db_alias
        table, execution_id = self._execution_of(row, tenant_id, alias)
        if table is None:
            raise Conflict("The message behind this call could not be found: the send was not recorded as a message.")
        who = getattr(request.user, "display_name", None) or getattr(request.user, "email", None) or "an API client"
        with connections[alias].cursor() as cursor:
            cursor.execute(f"""UPDATE {table} SET status = 'QUEUED', submitted_at = NULL, send_after = NULL, status_reason = %s
                                WHERE tenant_id = %s AND id = %s AND status = 'FAILED' RETURNING campaign_run_id, campaign_id""",
                           [f"Retried by {who} from the integration log"[:200], str(tenant_id), execution_id])
            claimed = cursor.fetchone()
            if claimed is None:
                raise Conflict("That message is not in a failed state any more: it was retried already, or it went out.")
            run_id, campaign_id = claimed
            cursor.execute("UPDATE campaign_run SET status = 'SENDING', completed_at = NULL WHERE tenant_id = %s AND id = %s AND status IN ('COMPLETED', 'FAILED')",
                           [str(tenant_id), str(run_id)])
        service.record_run_event(tenant_id, campaign_id, run_id, "SEND_RETRIED", f"Message {execution_id} queued again by {who} from Settings → Integrations (log row {row.pk}).")
        transaction.on_commit(lambda: views._enqueue_run(str(tenant_id), str(run_id)), using=alias)
        return Response({"queued": True, "execution": execution_id, "run": str(run_id), "campaign": str(campaign_id),
                         "note": "It goes out on the dispatcher's next pass; the new attempt appears in the log."})


class IntegrationLogReplayView(APIView):
    """Replay Callback on an inbound provider row: its stored body is applied again, duplicate check skipped."""
    permission_classes = MANAGE

    @extend_schema(request=None, responses={200: None})
    def post(self, request, pk, version=None):
        import json
        from apps.delivery.models import DeliveryProvider
        from apps.delivery.providers import ProviderError, registry
        from . import delivery_public
        tenant_id = _tenant_id()
        row = IntegrationLog.objects.filter(tenant_id=tenant_id, pk=pk).first()
        if row is None:
            raise NotFound("No such call in the log.")
        if row.direction != "IN" or row.kind != logbook.KIND_PROVIDER:
            raise Conflict("Only a sending engine's callback can be replayed.")
        if not row.request_body:
            raise Conflict("The body of this callback was not kept, so it cannot be replayed.")
        try:
            payload = json.loads(row.request_body)
        except ValueError:
            raise Conflict("The stored body is not complete JSON (it was longer than the integration keeps), so it cannot be replayed.") from None
        integration = Integration.objects.filter(tenant_id=tenant_id, pk=row.integration_id).first() if row.integration_id else None
        provider = (DeliveryProvider.objects.filter(tenant_id=tenant_id, pk=integration.delivery_provider_id, deleted_at__isnull=True).first() if integration and integration.delivery_provider_id
                    else DeliveryProvider.objects.filter(tenant_id=tenant_id, provider_type=row.system, deleted_at__isnull=True).order_by("created_at").first())
        if provider is None:
            raise Conflict("The sending engine this callback came from is no longer set up.")
        try:
            adapter = registry.adapter_class(provider.provider_type)(config=provider.config or {}, secret=None, provider_id=str(provider.pk), tenant_id=tenant_id)
        except ProviderError as exc:
            raise Conflict(str(exc)) from None
        outcome, parsed = delivery_public.process_events(tenant_id, provider, adapter, payload, replay=True)
        who = getattr(request.user, "display_name", None) or getattr(request.user, "email", None) or "an API client"
        record = logbook.integration_for(tenant_id, kind=logbook.KIND_PROVIDER, system=provider.provider_type, provider=provider)
        logbook.record(tenant_id=tenant_id, integration=record, direction="IN", kind=logbook.KIND_PROVIDER, system=row.system, related_ref=row.related_ref,
                       method="REPLAY", url=row.url, request_headers=None, request_body=row.request_body, response_status=200, response_body=outcome,
                       outcome="OK" if not outcome.get("failed") else "ERROR",
                       error_message=(f"{outcome['failed']} events could not be applied; " if outcome.get("failed") else "") + f"replay of log row {row.pk} by {who}"[:500])
        return Response({**outcome, "replayed": row.pk})


class IntegrationLogDetailView(APIView):
    permission_classes = MANAGE

    @extend_schema(responses=IntegrationLogDetailSerializer)
    def get(self, request, pk, version=None):
        row = IntegrationLog.objects.filter(tenant_id=_tenant_id(), pk=pk).first()
        if row is None:
            raise NotFound("No such call in the log (rows are kept for the integration's retention period).")
        return Response(IntegrationLogDetailSerializer(row).data)


class IntegrationMetricsView(APIView):
    permission_classes = MANAGE

    @extend_schema(parameters=[OpenApiParameter("hours", int)], responses={200: None})
    def get(self, request, pk, version=None):
        hours = max(1, min(int(request.query_params.get("hours") or 24), 24 * 31))
        step = 15 if hours <= 48 else 60 if hours <= 24 * 7 else 24 * 60
        if not Integration.objects.filter(tenant_id=_tenant_id(), pk=pk).exists():
            raise NotFound("No such integration.")
        return Response({"hours": hours, "step_minutes": step, "buckets": metrics.series(_tenant_id(), str(pk), hours=hours, step_minutes=step)})


class IntegrationPauseView(APIView):
    permission_classes = MANAGE

    @extend_schema(request=None, responses={200: None})
    def post(self, request, pk, pause: bool, version=None):
        tenant_id = _tenant_id()
        integration = Integration.objects.filter(tenant_id=tenant_id, pk=pk).first()
        if integration is None:
            raise NotFound("No such integration.")
        integration.status = "PAUSED" if pause else "ACTIVE"
        integration.updated_by_id = getattr(request.user, "pk", None) if not hasattr(request.user, "has_scope") else None
        integration.updated_at = timezone.now()
        integration.save(update_fields=["status", "updated_by", "updated_at"])
        logbook.invalidate(tenant_id, integration.kind, integration.delivery_provider_id and str(integration.delivery_provider_id))
        if not pause:
            Breaker({"id": str(integration.pk), "tenant_id": str(tenant_id), "breaker_failures": integration.breaker_failures,
                     "breaker_cooldown_seconds": integration.breaker_cooldown_seconds}).reset()      # resuming also closes an open circuit
        return Response(next(row for row in metrics.status(tenant_id) if row["id"] == str(integration.pk)))
