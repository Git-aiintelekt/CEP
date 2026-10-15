"""Dashboards (Phase C; docs/mockups/insights-dashboards.html, option 2): a page of rows of tiles, each tile a saved report
in one of its views or one of its figures, on one period applied to every tile through its dataset's time field.

    GET, POST          /insights/dashboards/                            the list; a new, empty, private dashboard
    GET, PUT, DELETE   /insights/dashboards/<id>/                       one dashboard: its rows, tiles, period, comparison
    POST               /insights/dashboards/<id>/tiles/<tile>/run/      one tile for a period: the rows in the view, or the figure
    POST               /insights/dashboards/<id>/tiles/preview/run/     the same for a tile given in the body (the editor, before Done)

A row holds one to four tiles of equal width, or a wide and a narrow one ("2-1"). A tile shows a report as a grid, chart,
hierarchy or pivot, or as a figure: one of its measures totalled over the period, with the previous period beside it when
the dashboard compares. A report with its own rule on the time field keeps it (`own_dates`).
"""
import json
import re
from datetime import date, timedelta

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.insights import catalog, runner
from apps.insights.api import VIEW, _can_see_pii, _has, _q, _report_row, _tenant, _visible_sql, favourite_sql
from apps.insights.definition import DefinitionError, validate
from apps.reporting import reports
from apps.delivery.engine import session
from apps.tenants import context

WIDTHS = {"1": 1, "2": 2, "3": 3, "4": 4, "2-1": 2}
SHOWS = ("grid", "chart", "hierarchy", "pivot", "figure")
PRESETS = ("7d", "30d", "month", "quarter", "custom")
MAX_ROWS, MAX_TILES = 20, 40
TILE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
TILE_ROWS = 200


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


# ---------------------------------------------------------------------------------------------------- the period
def period_bounds(period: dict, today: date) -> dict:
    """The period's first and last day, and the period of the same length just before it."""
    preset = period.get("preset", "30d")
    if preset == "7d":
        start, end = today - timedelta(days=6), today
    elif preset == "30d":
        start, end = today - timedelta(days=29), today
    elif preset == "month":
        start, end = today.replace(day=1), today
    elif preset == "quarter":
        start, end = date(today.year, ((today.month - 1) // 3) * 3 + 1, 1), today
    else:
        start, end = date.fromisoformat(period["from"]), date.fromisoformat(period["to"])
    days = (end - start).days + 1
    return {"from": start.isoformat(), "to": end.isoformat(),
            "previous_from": (start - timedelta(days=days)).isoformat(), "previous_to": (start - timedelta(days=1)).isoformat()}


def _period(raw) -> dict:
    if raw is None:
        return {"preset": "30d"}
    if not isinstance(raw, dict) or raw.get("preset") not in PRESETS:
        raise ValidationError({"period": "Use 7d, 30d, month, quarter or custom."})
    out = {"preset": raw["preset"]}
    if raw["preset"] == "custom":
        try:
            start, end = date.fromisoformat(str(raw.get("from"))), date.fromisoformat(str(raw.get("to")))
        except ValueError:
            raise ValidationError({"period": "A custom period gives two dates, from and to."}) from None
        if end < start or (end - start).days > 3660:
            raise ValidationError({"period": "From comes before to, within ten years."})
        out.update({"from": start.isoformat(), "to": end.isoformat()})
    return out


def _has_time_rule(node, field: str) -> bool:
    for rule in (node or {}).get("rules", []) if isinstance(node, dict) else []:
        if "rules" in rule and _has_time_rule(rule, field):
            return True
        if rule.get("field") == field:
            return True
    return False


def _with_period(raw: dict, field: str, start: str, end: str) -> dict:
    """The definition with the period as one more rule on its time field, and-ed with whatever it already has."""
    rule = {"field": field, "operator": "between", "value": [start, end]}
    filters = raw.get("filters") or {"combinator": "and", "rules": []}
    if filters.get("combinator", "and") == "and":
        filters = {**filters, "rules": [*filters.get("rules", []), rule]}
    else:
        filters = {"combinator": "and", "rules": [filters, rule]}
    return {**raw, "filters": filters}


# ---------------------------------------------------------------------------------------------------- the layout
def _layout(raw, request) -> dict:
    """Rows of tiles, checked: the widths, the tile ids, the shows, and that every report is one this person can open."""
    if raw is None:
        return {"rows": []}
    rows = raw.get("rows") if isinstance(raw, dict) else None
    if not isinstance(rows, list):
        raise ValidationError({"layout": "A layout is rows of tiles."})
    if len(rows) > MAX_ROWS:
        raise ValidationError({"layout": f"A dashboard has {MAX_ROWS} rows at most."})
    out_rows, ids, wanted = [], set(), {}
    for i, row in enumerate(rows):
        at = f"layout.rows[{i}]"
        if not isinstance(row, dict) or str(row.get("width", "2")) not in WIDTHS or not isinstance(row.get("tiles", []), list):
            raise ValidationError({at: "A row has a width (1, 2, 3, 4 or 2-1) and its tiles."})
        width = str(row.get("width", "2"))
        tiles = row.get("tiles", [])
        if len(tiles) > WIDTHS[width]:
            raise ValidationError({at: f"A row {width} across holds {WIDTHS[width]} tiles."})
        out_tiles = []
        for j, tile in enumerate(tiles):
            where = f"{at}.tiles[{j}]"
            if not isinstance(tile, dict) or not TILE_ID.match(str(tile.get("id", ""))) or tile.get("show") not in SHOWS:
                raise ValidationError({where: "A tile has an id, a report and how to show it (grid, chart, hierarchy, pivot or figure)."})
            if tile["id"] in ids:
                raise ValidationError({where: "Tile ids are unique."})
            ids.add(tile["id"])
            title = str(tile.get("title") or "").strip()
            if len(title) > 100:
                raise ValidationError({f"{where}.title": "A title is text of up to 100 characters."})
            report_id = str(tile.get("report_id") or "")
            wanted.setdefault(report_id, []).append((where, tile))
            out_tiles.append({"id": tile["id"], "report_id": report_id, "show": tile["show"], **({"title": title} if title else {}),
                              **({"measure": str(tile["measure"])} if tile["show"] == "figure" else {})})
        out_rows.append({"width": width, "tiles": out_tiles})
    if len(ids) > MAX_TILES:
        raise ValidationError({"layout": f"A dashboard has {MAX_TILES} tiles at most."})
    if wanted:
        where_sql, args = _visible_sql(request)
        found = {r["id"]: r for r in _q(f"SELECT r.id::text, r.definition FROM report r WHERE r.id::text = ANY(%s) AND r.deleted_at IS NULL AND {where_sql}",
                                        [list(wanted), *args])}
        for report_id, places in wanted.items():
            for where, tile in places:
                if report_id not in found:
                    raise ValidationError({f"{where}.report_id": "Choose one of the reports you can open."})
                if tile["show"] == "figure":
                    columns = _json(found[report_id]["definition"]).get("columns", [])
                    if not any(c.get("field") == tile.get("measure") and c.get("aggregate") for c in columns):
                        raise ValidationError({f"{where}.measure": "A figure is one of the report's totalled columns."})
    return {"rows": out_rows}


def _tiles(layout: dict) -> list[dict]:
    return [tile for row in layout.get("rows", []) for tile in row.get("tiles", [])]


# ---------------------------------------------------------------------------------------------------- rows
def _dashboard_row(dashboard_id, request) -> dict:
    where, args = _visible_sql(request)
    rows = _q(f"""SELECT d.id::text, d.name, d.description, d.visibility, d.period, d.compare, d.layout, d.version, d.row_version,
                         d.owner_user_id::text, u.display_name AS owner_name, d.created_at, d.updated_at
                    FROM dashboard d LEFT JOIN app_user u ON u.id = d.owner_user_id
                   WHERE d.id = %s AND d.deleted_at IS NULL AND {where.replace('r.', 'd.')}""", [str(dashboard_id), *args])
    if not rows:
        raise NotFound("No such dashboard.")
    return rows[0]


def _may_edit(request, row: dict) -> bool:
    return _has(request, "report.admin") or (_has(request, "report.edit") and str(row.get("owner_user_id")) == str(request.user.pk))


def _serialize(row: dict, request, today: date) -> dict:
    period = _json(row["period"])
    return {"id": row["id"], "name": row["name"], "description": row["description"], "visibility": row["visibility"], "period": period, "compare": bool(row["compare"]),
            "layout": _json(row["layout"]), "version": row["version"], "row_version": row["row_version"], "owner_user_id": row["owner_user_id"],
            "owner_name": row["owner_name"], "created_at": row["created_at"], "updated_at": row["updated_at"], "can_edit": _may_edit(request, row),
            "bounds": period_bounds(period, today)}


def _today(tenant) -> date:
    return timezone.now().astimezone(reports.zone_of(tenant)).date()


class DashboardListView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        where, args = _visible_sql(request)
        starred, star_args = favourite_sql(str(request.user.pk), "dashboard", "d.id")
        rows = _q(f"""SELECT d.id::text, d.name, d.description, d.visibility, d.layout, d.version, d.owner_user_id::text, u.display_name AS owner_name, d.updated_at,
                             {starred} AS favourite
                        FROM dashboard d LEFT JOIN app_user u ON u.id = d.owner_user_id
                       WHERE d.deleted_at IS NULL AND {where.replace('r.', 'd.')} ORDER BY d.updated_at DESC""", [*star_args, *args])
        return Response({"dashboards": [{"id": r["id"], "name": r["name"], "description": r["description"], "visibility": r["visibility"], "tiles": len(_tiles(_json(r["layout"]))),
                                         "version": r["version"], "owner_user_id": r["owner_user_id"], "owner_name": r["owner_name"], "updated_at": r["updated_at"],
                                         "can_edit": _may_edit(request, r), "favourite": bool(r["favourite"])} for r in rows]})

    @extend_schema(responses={201: None})
    def post(self, request, version=None):
        if not _has(request, "report.edit") and not _has(request, "report.admin"):
            raise PermissionDenied("Creating a dashboard needs the report.edit permission.")
        body = request.data if isinstance(request.data, dict) else {}
        name = str(body.get("name") or "Untitled Dashboard").strip()
        if not name or len(name) > 200:
            raise ValidationError({"name": "Give the dashboard a name of up to 200 characters."})
        visibility = str(body.get("visibility") or "PRIVATE").upper()
        if visibility not in ("PRIVATE", "WORKSPACE"):
            raise ValidationError({"visibility": "PRIVATE or WORKSPACE."})
        period, layout = _period(body.get("period")), _layout(body.get("layout"), request)
        tenant_id, user_id = context.require().tenant_id, str(request.user.pk)
        with session.tx():
            rows = _q("""INSERT INTO dashboard (tenant_id, name, description, visibility, period, compare, layout, owner_user_id, created_by, updated_by)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id::text""",
                      [tenant_id, name, body.get("description") or None, visibility, json.dumps(period), bool(body.get("compare", False)), json.dumps(layout), user_id, user_id, user_id])
            dashboard_id = rows[0]["id"]
            _q("INSERT INTO dashboard_version (tenant_id, dashboard_id, version, layout, period, note, changed_by) VALUES (%s, %s, 1, %s, %s, %s, %s)",
               [tenant_id, dashboard_id, json.dumps(layout), json.dumps(period), "Created", user_id])
        return Response(_serialize(_dashboard_row(dashboard_id, request), request, _today(_tenant())), status=status.HTTP_201_CREATED)


class DashboardView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, dashboard_id=None):
        return Response(_serialize(_dashboard_row(dashboard_id, request), request, _today(_tenant())))

    @extend_schema(responses={200: None})
    def put(self, request, version=None, dashboard_id=None):
        row = _dashboard_row(dashboard_id, request)
        if not _may_edit(request, row):
            raise PermissionDenied("Only the dashboard's owner, or a report administrator, can change it.")
        body = request.data if isinstance(request.data, dict) else {}
        if int(body.get("row_version") or 0) != row["row_version"]:
            return Response({"type": "about:blank", "title": "The dashboard changed since you opened it", "status": 409, "detail": "Reload it and apply your change again."},
                            status=status.HTTP_409_CONFLICT)
        name = str(body.get("name") or row["name"]).strip()
        if not name or len(name) > 200:
            raise ValidationError({"name": "Give the dashboard a name of up to 200 characters."})
        visibility = str(body.get("visibility") or row["visibility"]).upper()
        if visibility not in ("PRIVATE", "WORKSPACE"):
            raise ValidationError({"visibility": "PRIVATE or WORKSPACE."})
        period = _period(body["period"]) if body.get("period") is not None else _json(row["period"])
        layout = _layout(body["layout"], request) if body.get("layout") is not None else _json(row["layout"])
        compare = bool(body.get("compare", row["compare"]))
        changed = body.get("layout") is not None or body.get("period") is not None
        new_version = row["version"] + (1 if changed else 0)
        tenant_id, user_id = context.require().tenant_id, str(request.user.pk)
        with session.tx():
            _q("""UPDATE dashboard SET name = %s, description = %s, visibility = %s, period = %s, compare = %s, layout = %s, version = %s, updated_by = %s,
                                       updated_at = now(), row_version = row_version + 1 WHERE id = %s AND row_version = %s""",
               [name, body.get("description", row["description"]) or None, visibility, json.dumps(period), compare, json.dumps(layout), new_version, user_id,
                str(dashboard_id), row["row_version"]])
            if changed:
                _q("INSERT INTO dashboard_version (tenant_id, dashboard_id, version, layout, period, note, changed_by) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                   [tenant_id, str(dashboard_id), new_version, json.dumps(layout), json.dumps(period), (str(body.get("note") or "")[:300] or None), user_id])
        return Response(_serialize(_dashboard_row(dashboard_id, request), request, _today(_tenant())))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, dashboard_id=None):
        row = _dashboard_row(dashboard_id, request)
        if not _may_edit(request, row):
            raise PermissionDenied("Only the dashboard's owner, or a report administrator, can delete it.")
        with session.tx():
            _q("UPDATE dashboard SET deleted_at = %s, updated_by = %s WHERE id = %s", [timezone.now(), str(request.user.pk), str(dashboard_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)


class TileRunView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, dashboard_id=None, tile_id=None):
        tenant = _tenant()
        row = _dashboard_row(dashboard_id, request)
        body = request.data if isinstance(request.data, dict) else {}
        if tile_id == "preview":                                     # the editor: a tile as it is, saved or not
            tile = _layout({"rows": [{"width": "1", "tiles": [body.get("tile") or {}]}]}, request)["rows"][0]["tiles"][0]
        else:
            tile = next((t for t in _tiles(_json(row["layout"])) if t["id"] == tile_id), None)
        if tile is None:
            raise NotFound("No such tile.")
        period = _period(body["period"]) if body.get("period") is not None else _json(row["period"])
        compare = bool(body.get("compare", row["compare"]))
        try:
            report = _report_row(tile["report_id"], request)
        except NotFound:
            return Response({"kind": "missing", "detail": "The report behind this tile is gone, or you cannot open it."})
        dataset = catalog.dataset(tenant.pk, report["dataset_key"], True)
        if dataset is None:
            return Response({"kind": "missing", "detail": "The report's dataset is not available in this workspace."})
        raw = _json(report["definition"])
        bounds = period_bounds(period, _today(tenant))
        time_field = dataset.get("time_field")
        own_dates = bool(time_field) and _has_time_rule(raw.get("filters"), time_field)
        limits = catalog.engine_of(tenant.pk)["limits"]
        about = {"id": report["id"], "name": report["name"], "version": report["version"]}

        def prepared(start, end):
            shaped = raw if own_dates or not time_field else _with_period(raw, time_field, start, end)
            if tile["show"] == "figure":
                shaped = {**shaped, "columns": [c for c in raw.get("columns", []) if c.get("field") == tile.get("measure") and c.get("aggregate")], "orderBy": [], "limit": 1}
                shaped.pop("view", None)
            try:
                return validate(dataset, shaped, max_limit=limits["run_rows"])
            except DefinitionError as exc:
                raise RunProblem(f"The report behind this tile no longer fits its dataset ({exc.field}: {exc}).") from None

        mask = not _can_see_pii(request)
        try:
            if tile["show"] == "figure":
                now = runner.run(tenant, request.user, dataset, prepared(bounds["from"], bounds["to"]), "run", limit=1, report_id=report["id"], report_version=report["version"], mask_pii=mask)
                previous = None
                if compare and time_field and not own_dates:
                    previous = runner.run(tenant, request.user, dataset, prepared(bounds["previous_from"], bounds["previous_to"]), "run", limit=1, report_id=report["id"],
                                          report_version=report["version"], mask_pii=mask)
                return Response({"kind": "figure", "value": now["rows"][0][0] if now["rows"] else None, "previous": previous["rows"][0][0] if previous and previous["rows"] else None,
                                 "compared": previous is not None, "column": now["columns"][0], "own_dates": own_dates, "bounds": bounds, "report": about, "cached": now["cached"]})
            definition = prepared(bounds["from"], bounds["to"])
            result = runner.run(tenant, request.user, dataset, definition, "run", limit=min(int(body.get("limit") or TILE_ROWS), limits["run_rows"]), report_id=report["id"],
                                report_version=report["version"], mask_pii=mask)
            view = {**(definition.get("view") or {}), "type": tile["show"]}
            return Response({"kind": "view", "view": view, "result": result, "own_dates": own_dates, "bounds": bounds, "report": about})
        except RunProblem as exc:
            return Response({"kind": "refused", "detail": str(exc), "outcome": "FAILED"}, status=422)
        except runner.RunRefused as exc:
            return Response({"kind": "refused", "detail": exc.reason, "outcome": exc.outcome}, status=422)


class RunProblem(Exception):
    pass
