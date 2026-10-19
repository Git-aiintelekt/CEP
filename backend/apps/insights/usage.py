"""Which reports and dashboards people open (insights_usage, patch 0061). The viewer records an opening (a person opening the
same item again within ten minutes is not counted twice); an embed records its openings without a person.

    POST  /insights/usage/                  {kind, id}: this person opened it
    GET   /insights/usage/?days=30          report administrators: the most opened, who opens them, and the reports nobody opened
"""
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.delivery.engine import session
from apps.tenants import context

from . import access
from .api import VIEW, _q

REPEAT_MINUTES = 10
DAYS = (7, 30, 90)


def record(tenant_id, kind: str, item_id: str, user_id, via: str = "app") -> None:
    """an opening, unless the same person opened the same item a moment ago"""
    if not access.present("insights_usage"):
        return
    with session.tx():
        if user_id is not None and _q("""SELECT 1 FROM insights_usage WHERE tenant_id = %s AND kind = %s AND item_id = %s AND user_id = %s
                                           AND opened_at > now() - make_interval(mins => %s) LIMIT 1""", [str(tenant_id), kind, str(item_id), str(user_id), REPEAT_MINUTES]):
            return
        _q("INSERT INTO insights_usage (tenant_id, kind, item_id, user_id, via) VALUES (%s, %s, %s, %s, %s)", [str(tenant_id), kind, str(item_id), str(user_id) if user_id else None, via])


class UsageView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={204: None})
    def post(self, request, version=None):
        from .api import _report_row
        from .dashboards import _dashboard_row
        body = request.data if isinstance(request.data, dict) else {}
        kind = body.get("kind")
        if kind not in ("report", "dashboard"):
            raise ValidationError({"kind": "report or dashboard."})
        row = (_report_row if kind == "report" else _dashboard_row)(body.get("id"), request)     # only what this person can open
        record(context.require().tenant_id, kind, row["id"], request.user.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        if not HasPermissionCode.for_("report.admin")().has_permission(request, None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Usage is for report administrators.")
        days = int(request.query_params.get("days") or 30)
        days = days if days in DAYS else 30
        tenant_id = str(context.require().tenant_id)
        if not access.present("insights_usage"):
            return Response({"days": days, "items": [], "unopened": [], "people": [], "daily": [], "ready": False})
        items = _q("""SELECT u.kind, u.item_id::text, count(*) AS opens, count(DISTINCT u.user_id) AS people, count(*) FILTER (WHERE u.via = 'embed') AS embedded,
                             max(u.opened_at) AS last_opened, COALESCE(r.name, d.name) AS name
                        FROM insights_usage u
                        LEFT JOIN report r ON u.kind = 'report' AND r.id = u.item_id AND r.deleted_at IS NULL
                        LEFT JOIN dashboard d ON u.kind = 'dashboard' AND d.id = u.item_id AND d.deleted_at IS NULL
                       WHERE u.tenant_id = %s AND u.opened_at >= now() - make_interval(days => %s)
                       GROUP BY u.kind, u.item_id, r.name, d.name ORDER BY opens DESC, last_opened DESC LIMIT 100""", [tenant_id, days])
        unopened = _q("""SELECT r.id::text, r.name, u.display_name AS owner_name, r.updated_at
                           FROM report r LEFT JOIN app_user u ON u.id = r.owner_user_id
                          WHERE r.tenant_id = %s AND r.deleted_at IS NULL
                            AND NOT EXISTS (SELECT 1 FROM insights_usage x WHERE x.tenant_id = r.tenant_id AND x.kind = 'report' AND x.item_id = r.id
                                                                          AND x.opened_at >= now() - make_interval(days => %s))
                          ORDER BY r.updated_at LIMIT 50""", [tenant_id, days])
        people = _q("""SELECT u.user_id::text, a.display_name AS name, count(*) AS opens, count(DISTINCT (u.kind, u.item_id)) AS items, max(u.opened_at) AS last_opened
                         FROM insights_usage u JOIN app_user a ON a.id = u.user_id
                        WHERE u.tenant_id = %s AND u.opened_at >= now() - make_interval(days => %s)
                        GROUP BY u.user_id, a.display_name ORDER BY opens DESC LIMIT 20""", [tenant_id, days])
        daily = _q("""SELECT (opened_at AT TIME ZONE 'UTC')::date AS day, count(*) AS opens FROM insights_usage
                       WHERE tenant_id = %s AND opened_at >= now() - make_interval(days => %s) GROUP BY 1 ORDER BY 1""", [tenant_id, days])
        return Response({"days": days, "ready": True,
                         "items": [{**i, "name": i["name"] or "Deleted"} for i in items],
                         "unopened": unopened, "people": people, "daily": [{"day": d["day"].isoformat(), "opens": d["opens"]} for d in daily]})

