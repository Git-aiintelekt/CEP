"""Comments and annotations on reports and dashboards (insights_comment, patch 0062): a note on the whole, on one tile of a
dashboard, or on one value of a chart (an annotation, drawn on the chart at that value). Whoever can open the item reads and
writes its comments; the author edits or deletes their own, the item's owner and report administrators delete any; anyone
who can open it marks a thread resolved.

    GET, POST          /insights/comments/?kind=&item=
    PUT, DELETE        /insights/comments/<id>/          {body?, resolved?}
"""
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.delivery.engine import session
from apps.tenants import context

from . import access
from .api import VIEW, _has, _q

MAX_BODY = 2000
MAX_LABEL = 120


def present() -> bool:
    return access.present("insights_comment")


def _item(kind, item_id, request) -> dict:
    from .api import _report_row
    from .dashboards import _dashboard_row
    if kind not in ("report", "dashboard"):
        raise ValidationError({"kind": "report or dashboard."})
    return (_report_row if kind == "report" else _dashboard_row)(item_id, request)


def _anchor(raw) -> dict | None:
    """what a comment is on: a tile, and or a value of a field (with the words it is shown as); None for the whole item"""
    if raw in (None, {}):
        return None
    if not isinstance(raw, dict):
        raise ValidationError({"anchor": "A tile, or a field and a value."})
    out = {}
    if raw.get("tile_id") is not None:
        out["tile_id"] = str(raw["tile_id"])[:40]
    if raw.get("field") is not None:
        out["field"] = str(raw["field"])[:60]
        value = raw.get("value")
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise ValidationError({"anchor": "A value is text, a number or a date."})
        out["value"] = value if not isinstance(value, str) else value[:200]
        out["label"] = str(raw.get("label") or value or "")[:MAX_LABEL]
    return out or None


def _out(row: dict, request) -> dict:
    mine = str(row["author_user_id"]) == str(request.user.pk)
    return {"id": row["id"], "body": row["body"], "anchor": row["anchor"], "author_name": row["author_name"] or "Someone who left", "mine": mine,
            "created_at": row["created_at"], "edited_at": row["edited_at"], "resolved_at": row["resolved_at"], "resolved_by_name": row["resolved_by_name"],
            "can_delete": mine or _has(request, "report.admin") or str(row.get("owner_user_id")) == str(request.user.pk)}


def _rows(where: str, args: list) -> list[dict]:
    return _q(f"""SELECT c.id::text, c.kind, c.item_id::text, c.body, c.anchor, c.author_user_id::text, a.display_name AS author_name, c.created_at, c.edited_at,
                         c.resolved_at, b.display_name AS resolved_by_name,
                         COALESCE(r.owner_user_id, d.owner_user_id)::text AS owner_user_id
                    FROM insights_comment c LEFT JOIN app_user a ON a.id = c.author_user_id LEFT JOIN app_user b ON b.id = c.resolved_by
                    LEFT JOIN report r ON c.kind = 'report' AND r.id = c.item_id LEFT JOIN dashboard d ON c.kind = 'dashboard' AND d.id = c.item_id
                   WHERE c.deleted_at IS NULL AND {where} ORDER BY c.created_at""", args)


class CommentsView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        kind, item_id = request.query_params.get("kind"), request.query_params.get("item")
        row = _item(kind, item_id, request)
        if not present():
            return Response({"comments": [], "ready": False})
        return Response({"comments": [_out(c, request) for c in _rows("c.kind = %s AND c.item_id = %s", [kind, row["id"]])], "ready": True})

    @extend_schema(responses={201: None})
    def post(self, request, version=None):
        body = request.data if isinstance(request.data, dict) else {}
        kind = body.get("kind")
        row = _item(kind, body.get("item_id"), request)
        if not present():
            from api.exceptions import Conflict
            raise Conflict("Comments need database patch 0062, which is not applied yet.")
        text = str(body.get("body") or "").strip()
        if not text or len(text) > MAX_BODY:
            raise ValidationError({"body": f"Write a comment of up to {MAX_BODY} characters."})
        import json
        anchor = _anchor(body.get("anchor"))
        with session.tx():
            made = _q("""INSERT INTO insights_comment (tenant_id, kind, item_id, author_user_id, body, anchor) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id::text""",
                      [str(context.require().tenant_id), kind, row["id"], str(request.user.pk), text, json.dumps(anchor) if anchor else None])
        return Response(_out(_rows("c.id = %s", [made[0]["id"]])[0], request), status=status.HTTP_201_CREATED)


class CommentView(APIView):
    permission_classes = VIEW

    def _one(self, request, comment_id) -> dict:
        if not present():
            raise NotFound("No such comment.")
        rows = _rows("c.id = %s", [str(comment_id)])
        if not rows:
            raise NotFound("No such comment.")
        _item(rows[0]["kind"], rows[0]["item_id"], request)                    # only on what this person can open
        return rows[0]

    @extend_schema(responses={200: None})
    def put(self, request, version=None, comment_id=None):
        row = self._one(request, comment_id)
        body = request.data if isinstance(request.data, dict) else {}
        sets, args = [], []
        if "body" in body:
            if str(row["author_user_id"]) != str(request.user.pk):
                raise PermissionDenied("Only its author changes a comment.")
            text = str(body.get("body") or "").strip()
            if not text or len(text) > MAX_BODY:
                raise ValidationError({"body": f"Write a comment of up to {MAX_BODY} characters."})
            sets += ["body = %s", "edited_at = %s"]
            args += [text, timezone.now()]
        if "resolved" in body:
            if not isinstance(body["resolved"], bool):
                raise ValidationError({"resolved": "Resolved or not."})
            sets += ["resolved_at = %s", "resolved_by = %s"]
            args += [timezone.now() if body["resolved"] else None, str(request.user.pk) if body["resolved"] else None]
        if not sets:
            raise ValidationError({"body": "Nothing to change."})
        with session.tx():
            _q(f"UPDATE insights_comment SET {', '.join(sets)} WHERE id = %s", [*args, row["id"]])
        return Response(_out(_rows("c.id = %s", [row["id"]])[0], request))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, comment_id=None):
        row = self._one(request, comment_id)
        if not _out(row, request)["can_delete"]:
            raise PermissionDenied("Only its author, the owner or a report administrator deletes a comment.")
        with session.tx():
            _q("UPDATE insights_comment SET deleted_at = now() WHERE id = %s", [row["id"]])
        return Response(status=status.HTTP_204_NO_CONTENT)
