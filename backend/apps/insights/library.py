"""Favourites and folders (Phase C): a star on reports and dashboards, first in the lists; a workspace's reports filed in
folders (report_folder, patch 0049; report_favourite, patch 0051).

    PUT, DELETE  /insights/favourites/<kind>/<id>/   star or unstar a report or a dashboard, for this person
    GET, POST    /insights/folders/                   the workspace's folders with their report counts; a new folder
    PUT, DELETE  /insights/folders/<id>/              rename; delete (its reports stay, filed nowhere)
A report moves between folders through PUT /insights/reports/<id>/ with folder_id.
"""
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.delivery.engine import session
from apps.insights.api import VIEW, _has, _q, _report_row  # noqa: F401  favourite_sql is defined there
from apps.tenants import context

KINDS = ("report", "dashboard")




def _may_file(request) -> bool:
    return _has(request, "report.edit") or _has(request, "report.admin")


def _folder_row(folder_id) -> dict:
    rows = _q("""SELECT f.id::text, f.name, f.owner_user_id::text, f.row_version, f.updated_at, (SELECT count(*) FROM report r WHERE r.folder_id = f.id AND r.deleted_at IS NULL) AS reports
                   FROM report_folder f WHERE f.id = %s AND f.deleted_at IS NULL""", [str(folder_id)])
    if not rows:
        raise NotFound("No such folder.")
    return rows[0]


def _serialize(row: dict) -> dict:
    return {"id": row["id"], "name": row["name"], "owner_user_id": row["owner_user_id"], "reports": int(row["reports"]), "row_version": row["row_version"], "updated_at": row["updated_at"]}


class FavouriteView(APIView):
    permission_classes = VIEW

    def _check(self, request, kind, item_id):
        if kind not in KINDS:
            raise NotFound("Star a report or a dashboard.")
        if kind == "report":
            _report_row(item_id, request)
        else:
            from apps.insights.dashboards import _dashboard_row
            _dashboard_row(item_id, request)

    @extend_schema(responses={204: None})
    def put(self, request, version=None, kind=None, item_id=None):
        self._check(request, kind, item_id)
        with session.tx():
            _q("INSERT INTO report_favourite (tenant_id, user_id, kind, item_id) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
               [context.require().tenant_id, str(request.user.pk), kind, str(item_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, kind=None, item_id=None):
        if kind not in KINDS:
            raise NotFound("Star a report or a dashboard.")
        with session.tx():
            _q("DELETE FROM report_favourite WHERE user_id = %s AND kind = %s AND item_id = %s", [str(request.user.pk), kind, str(item_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)


class FolderListView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        rows = _q("""SELECT f.id::text, f.name, f.owner_user_id::text, f.row_version, f.updated_at, (SELECT count(*) FROM report r WHERE r.folder_id = f.id AND r.deleted_at IS NULL) AS reports
                       FROM report_folder f WHERE f.deleted_at IS NULL ORDER BY lower(f.name)""")
        return Response({"folders": [_serialize(r) for r in rows]})

    @extend_schema(responses={201: None})
    def post(self, request, version=None):
        if not _may_file(request):
            raise PermissionDenied("Making a folder needs the report.edit permission.")
        body = request.data if isinstance(request.data, dict) else {}
        name = str(body.get("name") or "").strip()
        if not name or len(name) > 120:
            raise ValidationError({"name": "Give the folder a name of up to 120 characters."})
        if _q("SELECT 1 FROM report_folder WHERE lower(name) = lower(%s) AND deleted_at IS NULL", [name]):
            raise ValidationError({"name": "There is a folder of that name already."})
        with session.tx():
            rows = _q("INSERT INTO report_folder (tenant_id, name, owner_user_id) VALUES (%s, %s, %s) RETURNING id::text", [context.require().tenant_id, name, str(request.user.pk)])
        return Response(_serialize(_folder_row(rows[0]["id"])), status=status.HTTP_201_CREATED)


class FolderView(APIView):
    permission_classes = VIEW

    def _may_change(self, request, row: dict) -> bool:
        return _has(request, "report.admin") or (_may_file(request) and str(row.get("owner_user_id")) == str(request.user.pk))

    @extend_schema(responses={200: None})
    def put(self, request, version=None, folder_id=None):
        row = _folder_row(folder_id)
        if not self._may_change(request, row):
            raise PermissionDenied("Only the folder's maker, or a report administrator, can rename it.")
        body = request.data if isinstance(request.data, dict) else {}
        name = str(body.get("name") or "").strip()
        if not name or len(name) > 120:
            raise ValidationError({"name": "Give the folder a name of up to 120 characters."})
        with session.tx():
            _q("UPDATE report_folder SET name = %s, updated_at = now(), row_version = row_version + 1 WHERE id = %s", [name, str(folder_id)])
        return Response(_serialize(_folder_row(folder_id)))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, folder_id=None):
        row = _folder_row(folder_id)
        if not self._may_change(request, row):
            raise PermissionDenied("Only the folder's maker, or a report administrator, can delete it.")
        with session.tx():
            _q("UPDATE report SET folder_id = NULL WHERE folder_id = %s", [str(folder_id)])
            _q("UPDATE report_folder SET deleted_at = %s WHERE id = %s", [timezone.now(), str(folder_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)
