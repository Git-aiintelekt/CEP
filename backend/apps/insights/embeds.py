"""Embed links (insights_embed, patch 0061): a report or a dashboard shown read-only on another site through a secret link.

    GET, POST   /insights/embeds/?kind=&item=      the item's links (its owner or a report administrator); a new one returns its
                                                   secret once, with the address and an iframe to paste
    DELETE      /insights/embeds/<id>/             revokes a link
    GET         /api/v1/public/embed/<code>/<secret>/     the page: the report's rows in its view, or the dashboard's layout
    POST        /api/v1/public/embed/<code>/<secret>/tiles/<tile>/run/      a dashboard's tile

Only the sha256 of the secret is kept. The address names the workspace by its code, as a delivery webhook does
(apps/tenants/resolver.py), so the public request runs in the workspace like any other. What an embed shows is what its maker may see: their row access rules
apply, personal data is always masked, a revoked or expired link answers 404, and a link is limited to 120 requests a minute.
"""
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, Throttled, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.delivery.engine import session
from apps.tenants import context

from . import access
from .api import VIEW, _has, _q

PER_MINUTE = 120
EXPIRY_DAYS = (7, 30, 90, 365)


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _item_of(kind: str, item_id, request) -> dict:
    """the item, which this person must own or administer to make or see its links"""
    from .api import _report_row
    from .dashboards import _dashboard_row
    row = (_report_row if kind == "report" else _dashboard_row)(item_id, request)
    if not (_has(request, "report.admin") or str(row.get("owner_user_id")) == str(request.user.pk)):
        raise PermissionDenied("Only the owner, or a report administrator, embeds it.")
    return row


def _out(row: dict) -> dict:
    return {"id": row["id"], "label": row["label"], "created_at": row["created_at"], "expires_at": row["expires_at"], "revoked_at": row["revoked_at"],
            "last_used_at": row["last_used_at"], "uses": row["uses"], "created_by_name": row.get("created_by_name")}


class EmbedsView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        kind = request.query_params.get("kind")
        if kind not in ("report", "dashboard"):
            raise ValidationError({"kind": "report or dashboard."})
        row = _item_of(kind, request.query_params.get("item"), request)
        if not access.present("insights_embed"):
            return Response({"embeds": [], "ready": False})
        rows = _q("""SELECT e.id::text, e.label, e.created_at, e.expires_at, e.revoked_at, e.last_used_at, e.uses, u.display_name AS created_by_name
                       FROM insights_embed e LEFT JOIN app_user u ON u.id = e.created_by
                      WHERE e.tenant_id = %s AND e.kind = %s AND e.item_id = %s ORDER BY e.created_at DESC""", [str(context.require().tenant_id), kind, row["id"]])
        return Response({"embeds": [_out(r) for r in rows], "ready": True})

    @extend_schema(responses={201: None})
    def post(self, request, version=None):
        from api.exceptions import Conflict
        body = request.data if isinstance(request.data, dict) else {}
        kind = body.get("kind")
        if kind not in ("report", "dashboard"):
            raise ValidationError({"kind": "report or dashboard."})
        row = _item_of(kind, body.get("item_id"), request)
        if not access.present("insights_embed"):
            raise Conflict("Embed links need database patch 0061, which is not applied yet.")
        days = body.get("days")
        if days is not None and days not in EXPIRY_DAYS:
            raise ValidationError({"days": "7, 30, 90 or 365 days, or never."})
        label = " ".join(str(body.get("label") or "").split())[:100] or None
        secret = secrets.token_urlsafe(32)
        expires = timezone.now() + timedelta(days=days) if days else None
        with session.tx():
            made = _q("""INSERT INTO insights_embed (tenant_id, kind, item_id, token_hash, label, created_by, expires_at) VALUES (%s, %s, %s, %s, %s, %s, %s)
                         RETURNING id::text, label, created_at, expires_at, revoked_at, last_used_at, uses""",
                      [str(context.require().tenant_id), kind, row["id"], digest(secret), label, str(request.user.pk), expires])
        return Response({**_out(made[0]), "secret": secret, "path": f"/embed/{request.tenant['code']}/{secret}"}, status=status.HTTP_201_CREATED)


class EmbedView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, embed_id=None):
        rows = _q("SELECT kind, item_id::text FROM insights_embed WHERE tenant_id = %s AND id = %s", [str(context.require().tenant_id), str(embed_id)])
        if not rows:
            raise NotFound("No such link.")
        _item_of(rows[0]["kind"], rows[0]["item_id"], request)
        with session.tx():
            _q("UPDATE insights_embed SET revoked_at = now() WHERE tenant_id = %s AND id = %s AND revoked_at IS NULL", [str(context.require().tenant_id), str(embed_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------------------------------- the public side
def _link(secret: str) -> dict:
    """the live link, counted and limited; its maker, who must still be active"""
    from apps.identity.models import AppUser
    key = f"cep:insights:embed:{digest(secret)[:24]}:{timezone.now().strftime('%Y%m%d%H%M')}"
    cache.add(key, 0, 90)
    try:
        if cache.incr(key) > PER_MINUTE:
            raise Throttled(detail="This embed is asked for too often; try again in a minute.")
    except ValueError:
        cache.set(key, 1, 90)
    rows = _q("""SELECT id::text, kind, item_id::text, created_by::text FROM insights_embed
                  WHERE tenant_id = %s AND token_hash = %s AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())""",
              [str(context.require().tenant_id), digest(secret)])
    if not rows:
        raise NotFound("This link was revoked or has expired.")
    link = rows[0]
    maker = AppUser.objects.filter(pk=link["created_by"], is_active=True, deleted_at__isnull=True).first()
    if maker is None:
        raise NotFound("This link no longer works.")
    link["maker"] = maker
    return link


def _used(link: dict) -> None:
    from .usage import record
    with session.tx():
        _q("UPDATE insights_embed SET uses = uses + 1, last_used_at = now() WHERE id = %s", [link["id"]])
    record(context.require().tenant_id, link["kind"], link["item_id"], None, via="embed")


class PublicEmbedView(APIView):
    """The embedded item, for anyone with the link: a report in its saved view, or a dashboard's layout (its tiles run one by one)."""
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(responses={200: None})
    def get(self, request, version=None, code=None, secret=None):
        from . import catalog, dashboards, runner
        from .definition import DefinitionError, validate
        link = _link(secret)
        tenant = context.require()
        from apps.tenants.models import Tenant
        workspace = Tenant.objects.using(settings.PLATFORM_ALIAS).get(pk=tenant.tenant_id)
        if link["kind"] == "report":
            rows = _q("SELECT id::text, name, dataset_key, definition, version FROM report WHERE id = %s AND deleted_at IS NULL", [link["item_id"]])
            if not rows:
                raise NotFound("The report behind this link is gone.")
            report = rows[0]
            raw = dashboards._json(report["definition"])
            dataset = catalog.dataset(tenant.tenant_id, report["dataset_key"], True)
            if dataset is None:
                raise NotFound("The report's data is not available.")
            try:
                definition = validate(dataset, raw, max_limit=catalog.engine_of(tenant.tenant_id)["limits"]["run_rows"])
            except DefinitionError:
                raise NotFound("The report no longer fits its data.") from None
            try:
                result = runner.run(workspace, link["maker"], dataset, definition, "run", report_id=report["id"], report_version=report["version"], mask_pii=True,
                                    totals_view=definition.get("view"))
            except runner.RunRefused as exc:
                return Response({"type": "about:blank", "title": "The report did not run", "status": 422, "detail": exc.reason}, status=422)
            _used(link)
            return Response({"kind": "report", "name": report["name"], "workspace": workspace.name, "view": definition.get("view") or {"type": "grid"}, "result": result})
        rows = _q("SELECT id::text, name, description, period, compare, layout FROM dashboard WHERE id = %s AND deleted_at IS NULL", [link["item_id"]])
        if not rows:
            raise NotFound("The dashboard behind this link is gone.")
        board = rows[0]
        period = dashboards._json(board["period"])
        layout = dashboards._json(board["layout"])
        _used(link)
        return Response({"kind": "dashboard", "name": board["name"], "description": board["description"], "workspace": workspace.name, "period": period,
                         "compare": bool(board["compare"]), "layout": {k: v for k, v in layout.items() if k in ("rows", "pages")},
                         "bounds": dashboards.period_bounds(period, dashboards._today(workspace))})


class PublicEmbedTileView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(responses={200: None})
    def post(self, request, version=None, code=None, secret=None, tile_id=None):
        from . import dashboards
        link = _link(secret)
        if link["kind"] != "dashboard":
            raise NotFound("No such tile.")
        tenant = context.require()
        from apps.tenants.models import Tenant
        workspace = Tenant.objects.using(settings.PLATFORM_ALIAS).get(pk=tenant.tenant_id)
        rows = _q("SELECT period, compare, layout FROM dashboard WHERE id = %s AND deleted_at IS NULL", [link["item_id"]])
        if not rows:
            raise NotFound("The dashboard behind this link is gone.")
        tile = next((t for t in dashboards._tiles(dashboards._json(rows[0]["layout"])) if t["id"] == tile_id), None)
        if tile is None:
            raise NotFound("No such tile.")
        report = dashboards._report_for(tile["report_id"], "TRUE", [])
        if report is None:
            return Response({"kind": "missing", "detail": "The report behind this tile is gone."})
        payload, status_code = dashboards.tile_result(workspace, link["maker"], report, tile, dashboards._json(rows[0]["period"]), bool(rows[0]["compare"]), True)
        return Response(payload, status=status_code)
