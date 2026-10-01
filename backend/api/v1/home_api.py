"""Home: GET /home/overview/  ?from=YYYY-MM-DD &to=YYYY-MM-DD &channel=EMAIL|SMS|MMS &campaigns=a,b

One request for the cockpit's alerts, Revenue vs. Cost, Governance and Active Journeys. A part the viewer may not read
is null: revenue and governance need report.view, journeys need the journeys feature and journey.view.
"""
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.platform_ops import params
from apps.reporting import home, reports

from .reports_api import _dates, _tenant


class HomeOverviewView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        start, end = _dates(request.query_params)
        campaign_ids = [item.strip() for item in request.query_params.get("campaigns", "").split(",") if item.strip()]
        tenant = _tenant()
        allowed = lambda code: HasPermissionCode.for_(code)().has_permission(request, self)                  # noqa: E731
        try:
            return Response(home.overview(tenant, start, end, channel=(request.query_params.get("channel") or "").upper() or None, campaign_ids=campaign_ids,
                                          reports_allowed=allowed("report.view"),
                                          journeys_allowed=params.enabled(tenant.pk, "journeys") and allowed("journey.edit")))
        except reports.ReportError as exc:
            raise ValidationError({exc.field: str(exc)}) from None
