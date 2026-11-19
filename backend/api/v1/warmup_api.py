"""Settings → Engagement · Sending → Delivery Warm-Up (apps/delivery/warmup.py).

    GET   warmup/            the warm-up (open or latest) with its days, today's figures and the workspace plan's contacts
    POST  warmup/            starts one: {sender_profile, ip_mode, plan_kind, window_start, window_end, advance_mode, list_ids, template_id}
    PATCH warmup/            {advance_mode?, window_start?, window_end?, extra_template_ids?}
    GET   warmup/plans/      the plans a new warm-up can choose, sized to the workspace plan (?window_start=&window_end=)
    POST  warmup/days/       today's and later days: {from_day, to_day, list_ids?, template_id?, hourly_limit?}
    POST  warmup/actions/    {action: approve | stay | back | pause | resume | stop}
"""
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.delivery import warmup
from apps.tenants import context

MANAGE = [IsAuthenticated, SameTenant, HasPermissionCode.for_("provider.edit")]


class Refused(APIException):
    status_code = 400
    default_detail = "The warm-up cannot do this"


def _user_id(request):
    user = request.user
    return None if hasattr(user, "has_scope") else str(user.pk)


def _guard(work):
    try:
        return work()
    except warmup.WarmupError as exc:
        raise Refused(str(exc)) from None


class WarmupView(APIView):
    permission_classes = MANAGE

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(warmup.overview(context.require().tenant_id))

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None):
        tenant = context.require().tenant_id
        _guard(lambda: warmup.start(tenant, _user_id(request), request.data))
        return Response(warmup.overview(tenant), status=201)

    @extend_schema(request=None, responses={200: None})
    def patch(self, request, version=None):
        tenant = context.require().tenant_id
        _guard(lambda: warmup.update(tenant, _user_id(request), request.data))
        return Response(warmup.overview(tenant))


class WarmupPlansView(APIView):
    permission_classes = MANAGE

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        params = request.query_params
        return Response(_guard(lambda: warmup.previews(context.require().tenant_id, params.get("window_start"), params.get("window_end"))))


class WarmupDaysView(APIView):
    permission_classes = MANAGE

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        tenant = context.require().tenant_id
        _guard(lambda: warmup.change_days(tenant, _user_id(request), request.data))
        return Response(warmup.overview(tenant))


class WarmupActionsView(APIView):
    permission_classes = MANAGE

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        tenant = context.require().tenant_id
        _guard(lambda: warmup.act(tenant, _user_id(request), str(request.data.get("action") or "")))
        return Response(warmup.overview(tenant))
