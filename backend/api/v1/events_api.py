"""Journey events in, and the coupon requests journeys make.

    POST  /events/                      an event, or {"events": [...]} (at most 500): an API key with events:ingest
    GET   /workspace/events/            Settings → Events: where to send, the scope, keys that may, the last 7 days (user.admin)
    GET   /workspace/events/recent/     the latest 50 events, filtered by type and search (user.admin)
    GET   /coupon-issuances/            coupon requests from journeys, for C360 to fulfil (an API key with coupons:issue)
    PATCH /coupon-issuances/<id>/       mark one ISSUED (with the customer's code) or FAILED (coupons:issue)
"""
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.delivery.engine import session
from apps.integrations.bridge.inbound import InboundLogMixin
from apps.journeys import events
from apps.platform_ops import params
from apps.tenants import context

ADMIN = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]


class EventsIngestView(InboundLogMixin, APIView):
    """POST /api/v1/events/ — one event ({"event_type", "party_id" | "email" | "phone", ...}) or {"events": [...]}, at most
    500. With an event_id, the same event sent twice is kept once. Answers per event: ACCEPTED, DUPLICATE, or REJECTED with
    the fields at fault (an email or phone that matches no customer is refused)."""
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("events.ingest"), params.RequiresFeature.for_("journeys")]
    integration_kind = "EVENTS"
    integration_system = "Events"

    def integration_ref(self, request, body):
        if isinstance(body, dict) and body.get("event_type"):
            return f"event:{str(body['event_type'])[:40]}:{str(body.get('event_id') or '')[:60]}"
        if isinstance(body, dict) and isinstance(body.get("events"), list):
            return f"events:{len(body['events'])}"
        return None

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        body = request.data
        batch = body.get("events") if isinstance(body, dict) and "events" in body else [body]
        if not isinstance(batch, list) or not batch:
            raise ValidationError({"events": "An event object, or {\"events\": [...]} with at least one."})
        if len(batch) > events.MAX_BATCH:
            raise ValidationError({"events": f"At most {events.MAX_BATCH} events a call."})
        results, good = [], []
        for index, raw in enumerate(batch):
            event, errors = events.clean(raw)
            if errors:
                results.append({"index": index, "event_id": raw.get("event_id") if isinstance(raw, dict) else None, "status": "REJECTED", "errors": errors})
            else:
                good.append((index, event))
        tenant_id = context.require().tenant_id
        stored = events.ingest(tenant_id, [event for _, event in good]) if good else []
        for (index, _), outcome in zip(good, stored):
            results.append({"index": index, **outcome})
        results.sort(key=lambda item: item["index"])
        counts = {status: sum(1 for item in results if item["status"] == status) for status in ("ACCEPTED", "DUPLICATE", "REJECTED")}
        answer = {"accepted": counts["ACCEPTED"], "duplicates": counts["DUPLICATE"], "rejected": counts["REJECTED"], "results": results}
        return Response(answer, status=400 if counts["REJECTED"] == len(results) else 200)


class EventsSettingsView(APIView):
    permission_classes = ADMIN

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        from apps.identity.models import ApiClient
        tenant_id = context.require().tenant_id
        keys = ApiClient.objects.filter(tenant_id=tenant_id, revoked_at__isnull=True, scopes__contains=["events:ingest"]).count()
        coupon_keys = ApiClient.objects.filter(tenant_id=tenant_id, revoked_at__isnull=True, scopes__contains=["coupons:issue"]).count()
        with session.tx(), session.connection().cursor() as cursor:
            cursor.execute("SELECT status, count(*) FROM coupon_issuance WHERE tenant_id = %s GROUP BY 1", [str(tenant_id)])
            coupons = dict(cursor.fetchall())
        return Response({"endpoint": f"{params.public_api_url()}/api/v1/events/", "scope": "events:ingest", "keys_with_scope": keys,
                         "journeys_enabled": params.enabled(str(tenant_id), "journeys"),
                         "types": [{"event_type": key, "label": label, "from_tracking": key in events.FROM_TRACKING} for key, label in events.KNOWN.items()],
                         "summary": events.summary(tenant_id),
                         "coupons": {"endpoint": f"{params.public_api_url()}/api/v1/coupon-issuances/", "scope": "coupons:issue", "keys_with_scope": coupon_keys,
                                     "requested": int(coupons.get("REQUESTED", 0)), "issued": int(coupons.get("ISSUED", 0)), "failed": int(coupons.get("FAILED", 0))}})


class EventsRecentView(APIView):
    permission_classes = ADMIN

    @extend_schema(parameters=[OpenApiParameter("type", str), OpenApiParameter("q", str)], responses={200: None})
    def get(self, request, version=None):
        event_type = (request.query_params.get("type") or "").strip().upper() or None
        q = (request.query_params.get("q") or "").strip()[:100]
        return Response({"results": events.recent(context.require().tenant_id, event_type=event_type, q=q)})


ISSUANCE_COLUMNS = ("id", "coupon_id", "coupon_code", "party_id", "journey_id", "journey_node_key", "status", "external_code", "note", "requested_at", "resolved_at")
ISSUANCE_SELECT = """SELECT i.id, i.coupon_id::text, c.code, i.party_id, i.journey_id::text, i.journey_node_key, i.status, i.external_code, i.note,
                            i.requested_at, i.resolved_at
                       FROM coupon_issuance i JOIN coupon c ON c.id = i.coupon_id"""


class CouponIssuanceListView(InboundLogMixin, APIView):
    """GET /api/v1/coupon-issuances/?status=REQUESTED&after=<id> — the coupon requests journeys made, oldest first, 200 a page.
    C360 (or whatever issues the coupons) reads them with an API key holding coupons:issue and marks each one done."""
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("coupons.issue")]
    integration_kind = "COUPONS"
    integration_system = "Coupons"

    @extend_schema(parameters=[OpenApiParameter("status", str), OpenApiParameter("after", int)], responses={200: None})
    def get(self, request, version=None):
        status = (request.query_params.get("status") or "REQUESTED").upper()
        if status not in ("REQUESTED", "ISSUED", "FAILED", "ALL"):
            raise ValidationError({"status": "REQUESTED, ISSUED, FAILED or ALL."})
        try:
            after = int(request.query_params.get("after") or 0)
        except ValueError:
            raise ValidationError({"after": "The id of the last request already read."}) from None
        where, args = ["i.tenant_id = %s", "i.id > %s"], [str(context.require().tenant_id), after]
        if status != "ALL":
            where.append("i.status = %s")
            args.append(status)
        with session.tx(), session.connection().cursor() as cursor:
            cursor.execute(f"{ISSUANCE_SELECT} WHERE {' AND '.join(where)} ORDER BY i.id LIMIT 200", args)
            rows = [dict(zip(ISSUANCE_COLUMNS, row)) for row in cursor.fetchall()]
        return Response({"results": rows, "next_after": rows[-1]["id"] if len(rows) == 200 else None})


class CouponIssuanceDetailView(InboundLogMixin, APIView):
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("coupons.issue")]
    integration_kind = "COUPONS"
    integration_system = "Coupons"

    def integration_ref(self, request, body):
        return f"coupon-issuance:{self.kwargs.get('pk')}"

    @extend_schema(request=None, responses={200: None})
    def patch(self, request, pk=None, version=None):
        body = request.data if isinstance(request.data, dict) else {}
        status = str(body.get("status") or "").upper()
        if status not in ("ISSUED", "FAILED"):
            raise ValidationError({"status": "ISSUED or FAILED."})
        code = str(body.get("external_code") or "").strip() or None
        note = str(body.get("note") or "").strip()[:300] or None
        if code and len(code) > 120:
            raise ValidationError({"external_code": "At most 120 characters."})
        tenant_id = str(context.require().tenant_id)
        with session.tx(), session.connection().cursor() as cursor:
            cursor.execute("""UPDATE coupon_issuance SET status = %s, external_code = COALESCE(%s, external_code), note = %s, resolved_at = now()
                               WHERE tenant_id = %s AND id = %s RETURNING id""", [status, code, note, tenant_id, int(pk)])
            if cursor.fetchone() is None:
                raise NotFound("No coupon request with this id.")
            cursor.execute(f"{ISSUANCE_SELECT} WHERE i.tenant_id = %s AND i.id = %s", [tenant_id, int(pk)])
            row = dict(zip(ISSUANCE_COLUMNS, cursor.fetchone()))
        return Response(row)
