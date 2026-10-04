"""Attribution: orders in, and the workspace's view of what they earned.

    POST /orders/                   an order or refund, or {"orders": [...]} (at most 500): an API key with orders:ingest
    GET  /attribution/settings/     the switch, windows and costs, where to send orders, and the last 30 days (report.view)
    PUT  /attribution/settings/     change them (user.admin)
    GET  /attribution/orders/       the latest orders with the campaign each was credited to, or why not (report.view)
    POST /attribution/recalculate/  judge the last 400 days of orders again under the current rules (user.admin)
"""
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.integrations.bridge.inbound import InboundLogMixin
from apps.platform_ops import params
from apps.reporting import attribution
from apps.tenants import context
from apps.tenants.models import Tenant

ADMIN = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]
VIEW = [IsAuthenticated, SameTenant, HasPermissionCode.for_("report.view")]
MAX_ORDERS = attribution.MAX_BATCH


def _tenant():
    return Tenant.objects.get(pk=context.require().tenant_id)


def _currency(tenant) -> str:
    return str((tenant.settings or {}).get("currency") or "USD").upper()[:3]


class OrdersIngestView(InboundLogMixin, APIView):
    """POST /api/v1/orders/ — one order ({"order_id", "amount", ...}) or {"orders": [...]}, at most 500. Idempotent on order_id:
    an order sent twice is a duplicate and is not counted twice. Answers per order: ACCEPTED, DUPLICATE or REJECTED with the
    fields at fault. 409 while attribution is off in the workspace."""
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("orders.ingest")]
    integration_kind = "ORDERS"
    integration_system = "Shop"

    def integration_ref(self, request, body):
        if isinstance(body, dict) and body.get("order_id"):
            return f"order:{str(body['order_id'])[:100]}"
        if isinstance(body, dict) and isinstance(body.get("orders"), list):
            return f"orders:{len(body['orders'])}"
        return None

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        tenant = _tenant()
        if not attribution.settings_of(tenant)["enabled"]:
            return Response({"type": "about:blank", "title": "Attribution is off in this workspace", "status": 409,
                             "detail": "An administrator turns it on under Settings, Attribution."}, status=409)
        body = request.data
        batch = body.get("orders") if isinstance(body, dict) and "orders" in body else [body]
        if not isinstance(batch, list) or not batch:
            raise ValidationError({"orders": "An order object, or {\"orders\": [...]} with at least one."})
        if len(batch) > MAX_ORDERS:
            raise ValidationError({"orders": f"At most {MAX_ORDERS} orders a call."})
        results, good = [], []
        for index, raw in enumerate(batch):
            order, errors = attribution.clean(raw, currency=_currency(tenant))
            if errors:
                results.append({"index": index, "order_id": raw.get("order_id") if isinstance(raw, dict) else None, "status": "REJECTED", "errors": errors})
            else:
                good.append((index, order))
        stored = attribution.ingest(tenant.pk, [order for _, order in good]) if good else []
        for (index, _), outcome in zip(good, stored):
            results.append({"index": index, **outcome})
        results.sort(key=lambda item: item["index"])
        counts = {status: sum(1 for item in results if item["status"] == status) for status in ("ACCEPTED", "DUPLICATE", "REJECTED")}
        answer = {"accepted": counts["ACCEPTED"], "duplicates": counts["DUPLICATE"], "rejected": counts["REJECTED"], "results": results}
        return Response(answer, status=400 if counts["REJECTED"] == len(results) else 200)


class AttributionSettingsView(APIView):
    def get_permissions(self):
        return [permission() for permission in (ADMIN if self.request.method == "PUT" else VIEW)]

    def _payload(self, tenant):
        from apps.identity.models import ApiClient
        keys = ApiClient.objects.filter(tenant_id=tenant.pk, revoked_at__isnull=True, scopes__contains=["orders:ingest"]).count()
        return {**{key: value for key, value in attribution.settings_of(tenant).items() if key != "needs_full"},
                "choices": {"click_days": list(attribution.CLICK_DAYS), "open_days": list(attribution.OPEN_DAYS), "text_days": list(attribution.TEXT_DAYS)},
                "currency": _currency(tenant), "endpoint": f"{params.public_api_url()}/api/v1/orders/", "scope": "orders:ingest", "keys_with_scope": keys,
                "store_sales_available": params.enabled(str(tenant.pk), "ereceipt"), "summary": attribution.summary(tenant.pk)}

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(self._payload(_tenant()))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None):
        tenant = _tenant()
        try:
            attribution.save_settings(tenant, request.data if isinstance(request.data, dict) else {})
        except attribution.AttributionError as exc:
            raise ValidationError({exc.field: str(exc)}) from None
        return Response(self._payload(tenant))


class AttributionOrdersView(APIView):
    permission_classes = VIEW

    @extend_schema(parameters=[OpenApiParameter("status", str), OpenApiParameter("q", str)], responses={200: None})
    def get(self, request, version=None):
        status = (request.query_params.get("status") or "").upper() or None
        q = (request.query_params.get("q") or "").strip()[:100]
        return Response({"results": attribution.recent(context.require().tenant_id, status=status, q=q)})


class AttributionRecalculateView(APIView):
    permission_classes = ADMIN

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        tenant = _tenant()
        if not attribution.settings_of(tenant)["enabled"]:
            return Response({"type": "about:blank", "title": "Attribution is off in this workspace", "status": 409}, status=409)
        return Response(attribution.recalculate(tenant))
