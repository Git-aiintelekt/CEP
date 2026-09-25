"""Settings -> Integrations: the workspace's integrations with their last day's figures, the call log, and pause / resume.

    GET  /integrations/                          status per integration (health, calls, error rate, p95, throttled, last call)
    GET  /integrations/log/?integration=&direction=&outcome=&q=&before=   newest first, 100 at a time; q matches a correlation id or a reference
    GET  /integrations/log/{id}/                 one call with its request and response
    GET  /integrations/{id}/metrics/?hours=      buckets for a chart
    POST /integrations/{id}/pause/ | /resume/    the kill switch; a paused inbound integration answers 503, a paused engine waits
"""
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.integrations.bridge import logbook, metrics
from apps.integrations.bridge.outbound import Breaker
from apps.integrations.models import Integration, IntegrationLog
from apps.tenants import context

MANAGE = [IsAuthenticated, HasPermissionCode.for_("provider.edit")]
PAGE = 100


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
        return Response(metrics.status(tenant_id))


class IntegrationLogListView(APIView):
    permission_classes = MANAGE

    @extend_schema(parameters=[OpenApiParameter("integration", str), OpenApiParameter("direction", str), OpenApiParameter("outcome", str),
                               OpenApiParameter("q", str, description="a correlation id or a related reference"),
                               OpenApiParameter("before", str, description="ISO time: rows started before it (the previous page's oldest)")],
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
        if params.get("before"):
            before = parse_datetime(params["before"])
            if before is None:
                raise ValidationError({"before": "Expected an ISO 8601 time."})
            rows = rows.filter(started_at__lt=before)
        page = list(rows[: PAGE + 1])
        more = len(page) > PAGE
        return Response({"results": IntegrationLogRowSerializer(page[:PAGE], many=True).data, "more": more,
                         "next_before": page[PAGE - 1].started_at if more else None})


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
