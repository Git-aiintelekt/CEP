"""Dashboards (Phase C; docs/mockups/insights-dashboards.html, option 2): a page of rows of tiles, each tile a saved report
in one of its views or one of its figures, on one period applied to every tile through its dataset's time field.

    GET, POST          /insights/dashboards/                            the list; a new, empty, private dashboard
    GET, PUT, DELETE   /insights/dashboards/<id>/                       one dashboard: its rows, tiles, period, comparison
    POST               /insights/dashboards/<id>/tiles/<tile>/run/      one tile for a period: the rows in the view, or the figure
    POST               /insights/dashboards/<id>/tiles/preview/run/     the same for a tile given in the body (the editor, before Done)
    POST               /insights/dashboards/<id>/slicers/values/        the values a slicer offers over the period

A row holds one to four tiles of equal width, or a wide and a narrow one ("2-1"). A tile shows a report as a grid, chart,
hierarchy or pivot, or as a figure: one of its measures totalled over the period, with the previous period beside it when
the dashboard compares. A report with its own rule on the time field keeps it (`own_dates`).

Pages (`layout.pages`: [{id, title, rows}], up to 10) are tabs of rows; a one-page dashboard keeps `layout.rows`. Every
page's tiles run, export and deliver; the PDF names a tile's page before its title. Saved views
(`GET, POST /insights/dashboards/<id>/views/`, `PUT, DELETE .../views/<view>/`, table dashboard_view, patch 0061) keep a
period, slicer picks, cross-filters, the page and the tiles' drills under a name, a person's own or shared by an editor.

Slicers (`layout.slicers`: [{field, label, kind}]) are dimensions of the tiles' datasets (kind values), or ranges (kind
range) on a number field or a date other than the period's a viewer filters the whole dashboard by.
A tile run takes `slicers: {field: [values]}` and applies each as an IN rule on every tile whose dataset has that field
(`sliced` names the ones applied); a tile whose dataset lacks it runs unfiltered. Clicking a value on a tile (a bar, a
slice, a stage, a row) is the same request with that value: cross-filtering happens in the browser, through the same rule.
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

from apps.insights import access, catalog, drill, fiscal, runner
from apps.insights.api import VIEW, _can_see_pii, _has, _q, _report_row, _tenant, _visible_sql, favourite_sql
from apps.insights.definition import DefinitionError, validate
from apps.reporting import reports
from apps.delivery.engine import session
from apps.tenants import context

WIDTHS = {"1": 1, "2": 2, "3": 3, "4": 4, "2-1": 2}
SHOWS = ("grid", "chart", "hierarchy", "pivot", "figure", "summary", "text", "button")
REPORTLESS = ("text", "button")                                         # a tile of words, or a button: no report behind it
BUTTON_ACTIONS = ("view", "page", "report")
THEMES = ("default", "navy", "earth", "berry", "greyscale")
GRID_COLUMNS, MAX_CELL_ROW, MAX_CELL_HEIGHT = 12, 200, 12
MAX_TEXT, MAX_LABEL = 4000, 60
PRESETS = ("7d", "30d", "month", "quarter", "fquarter", "fyear", "custom")
MAX_ROWS, MAX_TILES = 20, 40
MAX_SLICERS, SLICER_VALUES = 6, 200
SLICER_TYPES = ("string", "boolean", "number")
RANGE_TYPES = ("number", "date", "datetime")
MAX_PAGES, MAX_VIEWS, MAX_VIEW_STATE = 10, 50, 20_000
TILE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
TILE_ROWS = 200


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


# ---------------------------------------------------------------------------------------------------- the period
def period_bounds(period: dict, today: date, fiscal_start: int = 1) -> dict:
    """The period's first and last day, and the period of the same length just before it. fquarter and fyear run from the start
    of the workspace's fiscal quarter or year to today."""
    preset = period.get("preset", "30d")
    if preset == "7d":
        start, end = today - timedelta(days=6), today
    elif preset == "30d":
        start, end = today - timedelta(days=29), today
    elif preset == "month":
        start, end = today.replace(day=1), today
    elif preset == "quarter":
        start, end = date(today.year, ((today.month - 1) // 3) * 3 + 1, 1), today
    elif preset == "fquarter":
        start, end = fiscal.quarter_start(today, fiscal_start), today
    elif preset == "fyear":
        start, end = fiscal.year_start(today, fiscal_start), today
    else:
        start, end = date.fromisoformat(period["from"]), date.fromisoformat(period["to"])
    days = (end - start).days + 1
    return {"from": start.isoformat(), "to": end.isoformat(),
            "previous_from": (start - timedelta(days=days)).isoformat(), "previous_to": (start - timedelta(days=1)).isoformat()}


def _period(raw) -> dict:
    if raw is None:
        return {"preset": "30d"}
    if not isinstance(raw, dict) or raw.get("preset") not in PRESETS:
        raise ValidationError({"period": "Use 7d, 30d, month, quarter, fquarter, fyear or custom."})
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


def _with_rules(raw: dict, rules: list[dict]) -> dict:
    """The definition with more rules and-ed onto whatever it already has."""
    filters = raw.get("filters") or {"combinator": "and", "rules": []}
    if filters.get("combinator", "and") == "and":
        filters = {**filters, "rules": [*filters.get("rules", []), *rules]}
    else:
        filters = {"combinator": "and", "rules": [filters, *rules]}
    return {**raw, "filters": filters}


def _with_period(raw: dict, field: str, start: str, end: str) -> dict:
    """The definition with the period as one more rule on its time field, and-ed with whatever it already has."""
    return _with_rules(raw, [{"field": field, "operator": "between", "value": [start, end]}])


# ---------------------------------------------------------------------------------------------------- slicers
def _slicers_body(raw) -> dict:
    """{field: [values]} from a tile run's body: up to MAX_SLICERS fields, up to SLICER_VALUES scalar values each; an empty list slices nothing"""
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, values in list(raw.items())[:MAX_SLICERS]:
        if isinstance(values, dict):                                   # a range: {from, to}, either may be empty
            ends = {end: values.get(end) for end in ("from", "to") if isinstance(values.get(end), (str, int, float)) and not isinstance(values.get(end), bool) and str(values.get(end)) != ""}
            if ends:
                out[str(key)] = ends
            continue
        kept = [v for v in values if isinstance(v, (str, int, float, bool))][:SLICER_VALUES] if isinstance(values, list) else []
        if kept:
            out[str(key)] = kept
    return out


def _slicer_rules(dataset: dict, slicers: dict | None) -> list[dict]:
    """The slicers as rules on this dataset: an IN rule per field the dataset has as a dimension; a field it lacks, or a measure, is skipped."""
    rules = []
    for key, values in (slicers or {}).items():
        if isinstance(values, dict):                                   # a range on a number or a date: between, or one end
            field = next((f for f in dataset["fields"] if f["key"] == key and f["type"] in RANGE_TYPES), None)
            if field is None:
                continue
            low, high = values.get("from"), values.get("to")
            if low is not None and high is not None:
                rules.append({"field": key, "operator": "between", "value": [low, high]})
            elif low is not None:
                rules.append({"field": key, "operator": ">=", "value": low})
            elif high is not None:
                rules.append({"field": key, "operator": "<=", "value": high})
            continue
        field = next((f for f in dataset["fields"] if f["key"] == key and f["role"] == "dimension"), None)
        if field is None or not values:
            continue
        if "in" in field["operators"]:
            rules.append({"field": key, "operator": "in", "value": list(values)})
        elif len(values) == 1:
            rules.append({"field": key, "operator": "=", "value": values[0]})
        else:
            rules.append({"combinator": "or", "rules": [{"field": key, "operator": "=", "value": v} for v in values]})
    return rules


def _slicer_field(datasets: list[dict], key: str, kind: str = "values") -> dict | None:
    for dataset in datasets:
        for field in dataset.get("fields", []):
            if field["key"] != key:
                continue
            if kind == "range" and field["type"] in RANGE_TYPES and (field["type"] == "number" or field["role"] == "dimension"):
                return field
            if kind == "values" and field["role"] == "dimension" and field["type"] in SLICER_TYPES:
                return field
    return None


def _slicers_layout(raw, datasets: list[dict]) -> list[dict]:
    """[{field, label}], each a text, yes/no or number dimension of one of the tiles' datasets, each field once."""
    if raw in (None, []):
        return []
    if not isinstance(raw, list) or len(raw) > MAX_SLICERS:
        raise ValidationError({"layout.slicers": f"Up to {MAX_SLICERS} slicers, each a dimension of the tiles' datasets."})
    out, seen = [], set()
    for i, item in enumerate(raw):
        where = f"layout.slicers[{i}]"
        key = str(item.get("field") or "") if isinstance(item, dict) else ""
        kind = item.get("kind", "values") if isinstance(item, dict) else "values"
        if kind not in ("values", "range"):
            raise ValidationError({where: "A slicer picks values, or a range."})
        field = _slicer_field(datasets, key, kind)
        if field is None:
            raise ValidationError({where: "A slicer is a text, yes/no or number dimension of one of the tiles' datasets, or a range on a number or a date."})
        if key in seen:
            raise ValidationError({where: "Each field slices once."})
        seen.add(key)
        out.append({"field": key, "label": " ".join(str(item.get("label") or field["label"]).split())[:100] or field["label"], **({"kind": "range", "type": field["type"]} if kind == "range" else {})})
    return out


# ---------------------------------------------------------------------------------------------------- the layout
def _layout(raw, request) -> dict:
    """Rows of tiles, checked: the widths, the tile ids, the shows, and that every report is one this person can open."""
    if raw is None:
        return {"rows": []}
    if not isinstance(raw, dict):
        raise ValidationError({"layout": "A layout is rows of tiles."})
    ids, wanted = set(), {}
    pages = raw.get("pages")
    if pages is not None:                                              # tabs of rows
        if not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES:
            raise ValidationError({"layout.pages": f"A dashboard has 1 to {MAX_PAGES} pages."})
        out_pages, page_ids = [], set()
        for p, page in enumerate(pages):
            at = f"layout.pages[{p}]"
            if not isinstance(page, dict) or not TILE_ID.match(str(page.get("id", ""))) or page["id"] in page_ids:
                raise ValidationError({at: "A page has an id of its own."})
            page_ids.add(page["id"])
            title = " ".join(str(page.get("title") or "").split())[:60] or f"Page {p + 1}"
            out_pages.append({"id": page["id"], "title": title, "rows": _checked_rows(page.get("rows", []), f"{at}.rows", ids, wanted), **_checked_canvas(page, at, ids, wanted)})
        layout = {"rows": [], "pages": out_pages}
    else:
        layout = {"rows": _checked_rows(raw.get("rows"), "layout.rows", ids, wanted), **_checked_canvas(raw, "layout", ids, wanted)}
    theme = raw.get("theme")
    if theme not in (None, "default"):
        if theme not in THEMES:
            raise ValidationError({"layout.theme": f"Use one of {', '.join(THEMES)}."})
        layout["theme"] = theme
    return _checked_reports(raw, request, layout, ids, wanted)


def _checked_canvas(raw: dict, base: str, ids: set, wanted: dict) -> dict:
    """a free canvas: tiles placed on a 12-column grid by column, row, width and height; tiles may overlap, the later on top"""
    if not raw.get("canvas"):
        return {}
    cells = raw.get("cells", [])
    if not isinstance(cells, list) or len(cells) > MAX_TILES:
        raise ValidationError({f"{base}.cells": f"A canvas holds {MAX_TILES} tiles at most."})
    out = []
    for i, cell in enumerate(cells):
        at = f"{base}.cells[{i}]"
        tile = _checked_tile(cell, at, ids, wanted)
        try:
            x, y, w, h = (int(cell.get(k)) for k in ("x", "y", "w", "h"))
        except (TypeError, ValueError):
            raise ValidationError({at: "A tile on the canvas has a column, a row, a width and a height."}) from None
        if not (0 <= x < GRID_COLUMNS and 1 <= w <= GRID_COLUMNS and x + w <= GRID_COLUMNS and 0 <= y <= MAX_CELL_ROW and 1 <= h <= MAX_CELL_HEIGHT):
            raise ValidationError({at: f"A tile fits the {GRID_COLUMNS} columns, starts within row {MAX_CELL_ROW} and is 1 to {MAX_CELL_HEIGHT} rows high."})
        out.append({**tile, "x": x, "y": y, "w": w, "h": h})
    return {"canvas": True, "cells": out}


def _checked_tile(tile, where: str, ids: set, wanted: dict) -> dict:
    """one tile: its id (unique across the pages), how it shows, its title; a report tile's report noted to check; a text tile's
    words; a button's label and what it does; whether it hides on a phone"""
    if not isinstance(tile, dict) or not TILE_ID.match(str(tile.get("id", ""))) or tile.get("show") not in SHOWS:
        raise ValidationError({where: "A tile has an id and how to show it (grid, chart, hierarchy, pivot, figure, summary, text or button)."})
    if tile["id"] in ids:
        raise ValidationError({where: "Tile ids are unique."})
    ids.add(tile["id"])
    title = str(tile.get("title") or "").strip()
    if len(title) > 100:
        raise ValidationError({f"{where}.title": "A title is text of up to 100 characters."})
    out = {"id": tile["id"], "show": tile["show"], **({"title": title} if title else {}), **({"hide_on_phone": True} if tile.get("hide_on_phone") is True else {})}
    if tile["show"] == "text":
        text = str(tile.get("text") or "").strip()
        if not text or len(text) > MAX_TEXT:
            raise ValidationError({f"{where}.text": f"A text tile has words, up to {MAX_TEXT} characters."})
        return {**out, "text": text}
    if tile["show"] == "button":
        label = " ".join(str(tile.get("label") or "").split())
        action = tile.get("action")
        if not label or len(label) > MAX_LABEL:
            raise ValidationError({f"{where}.label": f"A button has a label of up to {MAX_LABEL} characters."})
        if not isinstance(action, dict) or action.get("kind") not in BUTTON_ACTIONS or not str(action.get("id") or "").strip():
            raise ValidationError({f"{where}.action": "A button opens a saved view, a page or a report."})
        target = str(action["id"]).strip()[:40]
        if action["kind"] == "report":
            wanted.setdefault(target, []).append((f"{where}.action", {"show": "button"}))
        return {**out, "label": label, "action": {"kind": action["kind"], "id": target}}
    report_id = str(tile.get("report_id") or "")
    wanted.setdefault(report_id, []).append((where, tile))
    return {**out, "report_id": report_id, **({"measure": str(tile["measure"])} if tile["show"] == "figure" else {})}


def _checked_rows(rows, base: str, ids: set, wanted: dict) -> list[dict]:
    """one page's rows of tiles: the widths, the tile ids (unique across the pages), the shows; the reports wanted are noted"""
    if not isinstance(rows, list):
        raise ValidationError({base: "A layout is rows of tiles."})
    if len(rows) > MAX_ROWS:
        raise ValidationError({base: f"A page has {MAX_ROWS} rows at most."})
    out_rows = []
    for i, row in enumerate(rows):
        at = f"{base}[{i}]"
        if not isinstance(row, dict) or str(row.get("width", "2")) not in WIDTHS or not isinstance(row.get("tiles", []), list):
            raise ValidationError({at: "A row has a width (1, 2, 3, 4 or 2-1) and its tiles."})
        width = str(row.get("width", "2"))
        tiles = row.get("tiles", [])
        if len(tiles) > WIDTHS[width]:
            raise ValidationError({at: f"A row {width} across holds {WIDTHS[width]} tiles."})
        out_tiles = [_checked_tile(tile, f"{at}.tiles[{j}]", ids, wanted) for j, tile in enumerate(tiles)]
        out_rows.append({"width": width, "tiles": out_tiles})
    return out_rows


def _checked_reports(raw: dict, request, layout: dict, ids: set, wanted: dict) -> dict:
    """that every tile's report is one this person can open, a figure one of its totalled columns; and the slicers"""
    if len(ids) > MAX_TILES:
        raise ValidationError({"layout": f"A dashboard has {MAX_TILES} tiles at most."})
    found = {}
    if wanted:
        where_sql, args = _visible_sql(request)
        found = {r["id"]: r for r in _q(f"SELECT r.id::text, r.definition, r.dataset_key FROM report r WHERE r.id::text = ANY(%s) AND r.deleted_at IS NULL AND {where_sql}",
                                        [list(wanted), *args])}
        for report_id, places in wanted.items():
            for where, tile in places:
                if report_id not in found:
                    raise ValidationError({f"{where}.report_id": "Choose one of the reports you can open."})
                if tile.get("show") == "figure":
                    columns = _json(found[report_id]["definition"]).get("columns", [])
                    if not any(c.get("field") == tile.get("measure") and c.get("aggregate") for c in columns):
                        raise ValidationError({f"{where}.measure": "A figure is one of the report's totalled columns."})
    slicers = []
    if raw.get("slicers"):
        tenant_id = _tenant().pk
        datasets = [d for d in (catalog.dataset(tenant_id, key, True) for key in {r["dataset_key"] for r in found.values()}) if d]
        slicers = _slicers_layout(raw["slicers"], datasets)
    return {**layout, **({"slicers": slicers} if slicers else {})}


def _tiles(layout: dict) -> list[dict]:
    """every tile, page by page (rows, then a canvas top to bottom); a tile of a page carries the page's title for the PDF"""
    def of(container: dict) -> list[dict]:
        cells = sorted(container.get("cells", []), key=lambda c: (c.get("y", 0), c.get("x", 0))) if container.get("canvas") else []
        return [tile for row in container.get("rows", []) for tile in row.get("tiles", [])] + cells
    if layout.get("pages"):
        return [{**tile, "_page": page["title"]} for page in layout["pages"] for tile in of(page)]
    return of(layout)


def report_tiles(layout: dict) -> list[dict]:
    """the tiles that run a report"""
    return [tile for tile in _tiles(layout) if tile.get("show") not in REPORTLESS]


# ---------------------------------------------------------------------------------------------------- rows
def _dashboard_visible(request) -> tuple[str, list]:
    return access.visible_sql("dashboard", "d", str(request.user.pk), _has(request, "report.admin"))


def _dashboard_row(dashboard_id, request) -> dict:
    where, args = _dashboard_visible(request)
    edit, edit_args = access.shared_edit_sql("dashboard", "d", str(request.user.pk))
    shared = access.shared_any_sql("dashboard", "d")
    rows = _q(f"""SELECT d.id::text, d.name, d.description, d.visibility, d.period, d.compare, d.layout, d.version, d.row_version,
                         d.owner_user_id::text, u.display_name AS owner_name, d.created_at, d.updated_at, {edit} AS shared_edit, {shared} AS shared
                    FROM dashboard d LEFT JOIN app_user u ON u.id = d.owner_user_id
                   WHERE d.id = %s AND d.deleted_at IS NULL AND {where}""", [*edit_args, str(dashboard_id), *args])
    if not rows:
        raise NotFound("No such dashboard.")
    return rows[0]


def _may_edit(request, row: dict) -> bool:
    """report administrators; the owner, or someone it is shared with to edit, with report.edit"""
    return _has(request, "report.admin") or (_has(request, "report.edit") and (str(row.get("owner_user_id")) == str(request.user.pk) or bool(row.get("shared_edit"))))


def _serialize(row: dict, request, tenant) -> dict:
    period = _json(row["period"])
    return {"id": row["id"], "name": row["name"], "description": row["description"], "visibility": row["visibility"], "period": period, "compare": bool(row["compare"]),
            "layout": _json(row["layout"]), "version": row["version"], "row_version": row["row_version"], "owner_user_id": row["owner_user_id"],
            "owner_name": row["owner_name"], "created_at": row["created_at"], "updated_at": row["updated_at"], "can_edit": _may_edit(request, row),
            "can_share": _has(request, "report.admin") or str(row.get("owner_user_id")) == str(request.user.pk), "shared": bool(row.get("shared")),
            "bounds": bounds_for(tenant, period)}


def bounds_for(tenant, period: dict) -> dict:
    return period_bounds(period, _today(tenant), fiscal.settings_of(tenant)["start"])


def _today(tenant) -> date:
    return timezone.now().astimezone(reports.zone_of(tenant)).date()


class DashboardListView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        where, args = _dashboard_visible(request)
        starred, star_args = favourite_sql(str(request.user.pk), "dashboard", "d.id")
        edit, edit_args = access.shared_edit_sql("dashboard", "d", str(request.user.pk))
        shared = access.shared_any_sql("dashboard", "d")
        rows = _q(f"""SELECT d.id::text, d.name, d.description, d.visibility, d.layout, d.version, d.owner_user_id::text, u.display_name AS owner_name, d.updated_at,
                             {starred} AS favourite, {edit} AS shared_edit, {shared} AS shared
                        FROM dashboard d LEFT JOIN app_user u ON u.id = d.owner_user_id
                       WHERE d.deleted_at IS NULL AND {where} ORDER BY d.updated_at DESC""", [*star_args, *edit_args, *args])
        return Response({"dashboards": [{"id": r["id"], "name": r["name"], "description": r["description"], "visibility": r["visibility"], "tiles": len(_tiles(_json(r["layout"]))),
                                         "version": r["version"], "owner_user_id": r["owner_user_id"], "owner_name": r["owner_name"], "updated_at": r["updated_at"],
                                         "can_edit": _may_edit(request, r), "favourite": bool(r["favourite"]), "shared": bool(r["shared"])} for r in rows]})

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
        return Response(_serialize(_dashboard_row(dashboard_id, request), request, _tenant()), status=status.HTTP_201_CREATED)


class DashboardView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, dashboard_id=None):
        return Response(_serialize(_dashboard_row(dashboard_id, request), request, _tenant()))

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
        return Response(_serialize(_dashboard_row(dashboard_id, request), request, _tenant()))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, dashboard_id=None):
        row = _dashboard_row(dashboard_id, request)
        if not _may_edit(request, row):
            raise PermissionDenied("Only the dashboard's owner, or a report administrator, can delete it.")
        with session.tx():
            _q("UPDATE dashboard SET deleted_at = %s, updated_by = %s WHERE id = %s", [timezone.now(), str(request.user.pk), str(dashboard_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)


def tile_result(tenant, user, report: dict, tile: dict, period: dict, compare: bool, mask: bool, limit: int = TILE_ROWS, slicers: dict | None = None,
                drill_path: list | None = None, ai: bool = False) -> tuple[dict, int]:
    """One tile's payload and HTTP status, for the API, the PDF and a delivery: the figure with its previous period, or the
    rows in the tile's view; `slicers` ({field: [values]}) narrow it where the dataset has the field (`sliced` says which)."""
    dataset = catalog.dataset(tenant.pk, report["dataset_key"], True)
    if dataset is None:
        return {"kind": "missing", "detail": "The report's dataset is not available in this workspace."}, 200
    raw = _json(report["definition"])
    bounds = bounds_for(tenant, period)
    time_field = dataset.get("time_field")
    own_dates = bool(time_field) and _has_time_rule(raw.get("filters"), time_field)
    limits = catalog.engine_of(tenant.pk)["limits"]
    about = {"id": report["id"], "name": report["name"], "version": report["version"], "dataset": report["dataset_key"]}
    levels = None
    if tile["show"] == "chart":                                       # a chart tile drills: the levels for the browser, the level under the path to run
        try:
            base = validate(dataset, raw, max_limit=limits["run_rows"])
            levels = drill.info(dataset, base, drill_path or [])
            below = drill.drilled(dataset, base, drill_path or [])
            raw = below if below else raw
        except (DefinitionError, drill.DrillError) as exc:
            return {"kind": "refused", "detail": str(exc), "outcome": "FAILED"}, 422
    sliced_rules = _slicer_rules(dataset, slicers)
    sliced = [r["field"] for r in sliced_rules if "field" in r] + [r["rules"][0]["field"] for r in sliced_rules if "rules" in r]

    def prepared(start, end):
        shaped = raw if own_dates or not time_field else _with_period(raw, time_field, start, end)
        if sliced_rules:
            shaped = _with_rules(shaped, sliced_rules)
        if tile["show"] == "figure":
            shaped = {**shaped, "columns": [c for c in raw.get("columns", []) if c.get("field") == tile.get("measure") and c.get("aggregate")], "orderBy": [], "limit": 1}
            shaped.pop("view", None)
        try:
            return validate(dataset, shaped, max_limit=limits["run_rows"])
        except DefinitionError as exc:
            raise RunProblem(f"The report behind this tile no longer fits its dataset ({exc.field}: {exc}).") from None

    try:
        if tile["show"] == "figure":
            now = runner.run(tenant, user, dataset, prepared(bounds["from"], bounds["to"]), "run", limit=1, report_id=report["id"], report_version=report["version"], mask_pii=mask)
            previous = None
            if compare and time_field and not own_dates:
                previous = runner.run(tenant, user, dataset, prepared(bounds["previous_from"], bounds["previous_to"]), "run", limit=1, report_id=report["id"],
                                      report_version=report["version"], mask_pii=mask)
            return {"kind": "figure", "value": now["rows"][0][0] if now["rows"] else None, "previous": previous["rows"][0][0] if previous and previous["rows"] else None,
                    "compared": previous is not None, "column": now["columns"][0], "own_dates": own_dates, "bounds": bounds, "report": about, "cached": now["cached"], "sliced": sliced}, 200
        definition = prepared(bounds["from"], bounds["to"])
        if tile["show"] == "summary":
            return _summary_tile(tenant, user, report, definition, dataset, bounds, about, sliced, mask, ai), 200
        view = {**(definition.get("view") or {}), "type": tile["show"]}
        result = runner.run(tenant, user, dataset, definition, "run", limit=min(int(limit), limits["run_rows"]), report_id=report["id"], report_version=report["version"], mask_pii=mask, totals_view=view)
        return {"kind": "view", "view": view, "result": result, "own_dates": own_dates, "bounds": bounds, "report": about, "sliced": sliced, **({"drill": levels} if levels else {})}, 200
    except RunProblem as exc:
        return {"kind": "refused", "detail": str(exc), "outcome": "FAILED"}, 422
    except runner.RunRefused as exc:
        return {"kind": "refused", "detail": exc.reason, "outcome": exc.outcome}, 422


def _summary_tile(tenant, user, report: dict, definition: dict, dataset: dict, bounds: dict, about: dict, sliced: list, mask: bool, ai: bool) -> dict:
    """a few sentences from the AI on the tile's rows over the period, kept six hours per report version, period and slicers;
    written on screen only (ai), a PDF or a delivery shows the kept one when there is one"""
    from . import ai_report, analyze, assistant
    key = analyze.summary_key(tenant.pk, report, {**definition, "masked": mask}, bounds)
    kept = analyze.cached_summary(key)
    base = {"kind": "summary", "bounds": bounds, "report": about, "sliced": sliced}
    if kept:
        return {**base, **kept, "cached": True}
    if not ai:
        return {**base, "summary": None, "detail": "The written summary is made when the dashboard is opened in Insights."}
    try:
        chosen, provider = ai_report.default_choice(tenant)
        result = runner.run(tenant, user, dataset, definition, "run", limit=ai_report.EXPLAIN_ROWS, report_id=report["id"], report_version=report["version"], mask_pii=mask)
        written = ai_report.written(tenant, getattr(user, "pk", None), chosen, provider, report["name"], dataset["label"], result)
    except runner.RunRefused as exc:
        return {"kind": "refused", "detail": exc.reason, "outcome": exc.outcome}
    except assistant.AssistantError as exc:
        return {"kind": "refused", "detail": str(exc), "outcome": "REFUSED"}
    payload = {k: written[k] for k in ("summary", "points", "caution", "model", "rows_sent") if k in written}
    if written.get("counted"):
        analyze.keep_summary(key, payload)
    return {**base, **payload, "cached": False}


def _report_for(report_id: str, visible_where: str, args: list) -> dict | None:
    rows = _q(f"""SELECT r.id::text, r.name, r.dataset_key, r.definition, r.version FROM report r WHERE r.id = %s AND r.deleted_at IS NULL AND {visible_where}""", [str(report_id), *args])
    return rows[0] if rows else None


def tile_title(tile: dict, report: dict | None) -> str:
    return tile.get("title") or (report["name"] if report else "A report that is gone")


def _paged(tile: dict, title: str) -> str:
    return f"{tile['_page']} · {title}" if tile.get("_page") else title


def dashboard_pdf(tenant, user, row: dict, *, visible_where: str, visible_args: list, mask: bool) -> bytes:
    """Every tile on the dashboard's saved period, as one PDF (apps/insights/pdf.py)."""
    return dashboard_document(tenant, user, row, visible_where=visible_where, visible_args=visible_args, mask=mask, fmt="pdf")


def dashboard_document(tenant, user, row: dict, *, visible_where: str, visible_args: list, mask: bool, fmt: str = "pdf") -> bytes:
    """Every tile on the dashboard's saved period, as a PDF or a PowerPoint deck (apps/insights/slides.py)."""
    from apps.insights import pdf, slides
    layout, period, compare = _json(row["layout"]), _json(row["period"]), bool(row["compare"])
    tiles = []
    for tile in _tiles(layout):
        if tile["show"] == "button":
            continue
        if tile["show"] == "text":
            tiles.append({"title": _paged(tile, tile.get("title") or "Note"), "kind": "text", "text": tile["text"]})
            continue
        report = _report_for(tile["report_id"], visible_where, visible_args)
        if report is None:
            tiles.append({"title": _paged(tile, tile_title(tile, None)), "kind": "missing", "detail": "The report behind this tile is gone, or cannot be opened."})
            continue
        payload, _status = tile_result(tenant, user, report, tile, period, compare, mask, limit=TILE_ROWS)
        tiles.append({"title": _paged(tile, tile_title(tile, report)), **payload})
    bounds = bounds_for(tenant, period)
    start, end = date.fromisoformat(bounds["from"]), date.fromisoformat(bounds["to"])
    period_words = f"{start.strftime('%d %b %Y').lstrip('0')} – {end.strftime('%d %b %Y').lstrip('0')}"
    today = _today(tenant)
    build = slides.dashboard if fmt == "pptx" else pdf.dashboard
    return build(row["name"], row["description"], period_words, tiles, workspace=tenant.name, when=today.strftime("%d %b %Y").lstrip("0"))


class TileRunView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, dashboard_id=None, tile_id=None):
        tenant = _tenant()
        row = _dashboard_row(dashboard_id, request)
        body = request.data if isinstance(request.data, dict) else {}
        if tile_id == "preview":                                     # the editor: a tile as it is, saved or not
            tile = _layout({"rows": [{"width": "1", "tiles": [body.get("tile") or {}]}]}, request)["rows"][0]["tiles"][0]
            if tile["show"] in REPORTLESS:
                raise NotFound("A text or button tile does not run.")
        else:
            tile = next((t for t in _tiles(_json(row["layout"])) if t["id"] == tile_id), None)
        if tile is None or tile["show"] in REPORTLESS:
            raise NotFound("No such tile.")
        period = _period(body["period"]) if body.get("period") is not None else _json(row["period"])
        compare = bool(body.get("compare", row["compare"]))
        try:
            report = _report_row(tile["report_id"], request)
        except NotFound:
            return Response({"kind": "missing", "detail": "The report behind this tile is gone, or you cannot open it."})
        try:
            path = drill.path_body(body.get("drill"))
        except drill.DrillError as exc:
            raise ValidationError({"drill": str(exc)}) from None
        payload, status_code = tile_result(tenant, request.user, report, tile, period, compare, not _can_see_pii(request), limit=int(body.get("limit") or TILE_ROWS),
                                           slicers=_slicers_body(body.get("slicers")), drill_path=path, ai=True)
        return Response(payload, status=status_code)


class SlicerValuesView(APIView):
    """The values a slicer offers: the field's distinct values over the period, from every dataset behind the tiles that has it, as one sorted list."""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, dashboard_id=None):
        tenant = _tenant()
        row = _dashboard_row(dashboard_id, request)
        body = request.data if isinstance(request.data, dict) else {}
        key = str(body.get("field") or "")
        period = _period(body["period"]) if body.get("period") is not None else _json(row["period"])
        bounds = bounds_for(tenant, period)
        report_ids = list({t["report_id"] for t in report_tiles(_json(row["layout"]))})
        where_sql, args = _visible_sql(request)
        dataset_keys = [r["dataset_key"] for r in _q(f"SELECT DISTINCT r.dataset_key FROM report r WHERE r.id::text = ANY(%s) AND r.deleted_at IS NULL AND {where_sql}", [report_ids, *args])] if report_ids else []
        values, seen, label, searched = [], set(), None, 0
        for dataset_key in dataset_keys[:4]:
            dataset = catalog.dataset(tenant.pk, dataset_key, _can_see_pii(request))
            field = next((f for f in (dataset or {}).get("fields", []) if f["key"] == key and f["role"] == "dimension" and f["type"] in SLICER_TYPES), None)
            if field is None:
                continue
            label = label or field["label"]
            measure = next((f for f in dataset["fields"] if f["role"] == "measure" and f["aggregates"]), None)   # grouped by the field, so each value comes once
            raw = {"columns": [{"field": key}, *([{"field": measure["key"], "aggregate": measure["aggregates"][0]}] if measure else [])],
                   "filters": {"combinator": "and", "rules": []}, "orderBy": [{"field": key, "direction": "asc"}], "limit": SLICER_VALUES}
            if dataset.get("time_field"):
                raw = _with_period(raw, dataset["time_field"], bounds["from"], bounds["to"])
            try:
                result = runner.run(tenant, request.user, dataset, validate(dataset, raw), "run", limit=SLICER_VALUES)
            except (DefinitionError, runner.RunRefused):
                continue
            searched += 1
            for r in result["rows"]:
                if r[0] is not None and str(r[0]) not in seen:
                    seen.add(str(r[0]))
                    values.append(r[0])
        if label is None:
            raise NotFound("No tile has that field.")
        values.sort(key=lambda v: str(v).lower())
        return Response({"field": key, "label": label, "values": values[:SLICER_VALUES], "datasets": searched})


class DashboardExportPdfView(APIView):
    """The dashboard with its tiles on its saved period, as a PDF (or, DashboardExportPptxView, a PowerPoint deck)."""
    permission_classes = VIEW
    fmt, mime = "pdf", "application/pdf"

    @extend_schema(responses={200: None})
    def get(self, request, version=None, dashboard_id=None):
        from django.http import HttpResponse
        tenant = _tenant()
        row = _dashboard_row(dashboard_id, request)
        where, args = _visible_sql(request)
        body = dashboard_document(tenant, request.user, row, visible_where=where, visible_args=args, mask=not _can_see_pii(request), fmt=self.fmt)
        safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in row["name"])[:80] or "dashboard"
        response = HttpResponse(body, content_type=self.mime)
        response["Content-Disposition"] = f'attachment; filename="{safe}.{self.fmt}"'
        return response


class DashboardExportPptxView(DashboardExportPdfView):
    fmt, mime = "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"


class RunProblem(Exception):
    pass


# ---------------------------------------------------------------------------------------------------- saved views
VIEW_KEYS = ("period", "compare", "page", "selection", "extra", "drills")


def _view_state(raw) -> dict:
    """what a saved view keeps: the period and the comparison, the page, the slicer picks, the cross-filter chips, the tiles' drills"""
    if not isinstance(raw, dict):
        raise ValidationError({"state": "A view is the dashboard's period, slicers, page and drills."})
    state = {key: raw[key] for key in VIEW_KEYS if key in raw}
    if "period" in state:
        state["period"] = _period(state["period"])
    if len(json.dumps(state, default=str)) > MAX_VIEW_STATE:
        raise ValidationError({"state": "This view holds too much; clear some picks."})
    return state


def _views_present() -> bool:
    from apps.insights import access
    return access.present("dashboard_view")


def _view_row(dashboard_id, view_id, request) -> dict:
    rows = _q("""SELECT v.id::text, v.name, v.state, v.shared, v.owner_user_id::text, u.display_name AS owner_name, v.updated_at
                   FROM dashboard_view v LEFT JOIN app_user u ON u.id = v.owner_user_id
                  WHERE v.id = %s AND v.dashboard_id = %s AND (v.owner_user_id = %s OR v.shared)""", [str(view_id), str(dashboard_id), str(request.user.pk)])
    if not rows:
        raise NotFound("No such view.")
    return rows[0]


def _view_out(row: dict, request) -> dict:
    return {"id": row["id"], "name": row["name"], "state": _json(row["state"]), "shared": bool(row["shared"]), "owner_name": row["owner_name"],
            "mine": str(row["owner_user_id"]) == str(request.user.pk), "updated_at": row["updated_at"]}


class DashboardViewsView(APIView):
    """A dashboard's saved views: a person's own, and the ones its editors shared."""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, dashboard_id=None):
        _dashboard_row(dashboard_id, request)
        if not _views_present():
            return Response({"views": []})
        rows = _q("""SELECT v.id::text, v.name, v.state, v.shared, v.owner_user_id::text, u.display_name AS owner_name, v.updated_at
                       FROM dashboard_view v LEFT JOIN app_user u ON u.id = v.owner_user_id
                      WHERE v.dashboard_id = %s AND (v.owner_user_id = %s OR v.shared) ORDER BY v.shared DESC, v.name""", [str(dashboard_id), str(request.user.pk)])
        return Response({"views": [_view_out(r, request) for r in rows]})

    @extend_schema(responses={201: None})
    def post(self, request, version=None, dashboard_id=None):
        from api.exceptions import Conflict
        row = _dashboard_row(dashboard_id, request)
        if not _views_present():
            raise Conflict("Saved views need database patch 0061, which is not applied yet.")
        body = request.data if isinstance(request.data, dict) else {}
        name = " ".join(str(body.get("name") or "").split())[:80]
        if not name:
            raise ValidationError({"name": "Name the view."})
        shared = bool(body.get("shared"))
        if shared and not _may_edit(request, row):
            raise PermissionDenied("Only someone who can change the dashboard shares a view with everyone who opens it.")
        state = _view_state(body.get("state"))
        if (_q("SELECT count(*) AS n FROM dashboard_view WHERE dashboard_id = %s AND owner_user_id = %s", [str(dashboard_id), str(request.user.pk)])[0]["n"] or 0) >= MAX_VIEWS:
            raise ValidationError({"name": f"You have {MAX_VIEWS} views of this dashboard; remove one first."})
        tenant_id = context.require().tenant_id
        with session.tx():
            made = _q("""INSERT INTO dashboard_view (tenant_id, dashboard_id, owner_user_id, name, state, shared) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id::text""",
                      [tenant_id, str(dashboard_id), str(request.user.pk), name, json.dumps(state), shared])
        return Response(_view_out(_view_row(dashboard_id, made[0]["id"], request), request), status=status.HTTP_201_CREATED)


class DashboardViewView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def put(self, request, version=None, dashboard_id=None, view_id=None):
        row = _dashboard_row(dashboard_id, request)
        current = _view_row(dashboard_id, view_id, request)
        if str(current["owner_user_id"]) != str(request.user.pk):
            raise PermissionDenied("Only the view's owner changes it.")
        body = request.data if isinstance(request.data, dict) else {}
        name = " ".join(str(body.get("name") or current["name"]).split())[:80]
        shared = bool(body.get("shared", current["shared"]))
        if shared and not current["shared"] and not _may_edit(request, row):
            raise PermissionDenied("Only someone who can change the dashboard shares a view with everyone who opens it.")
        state = _view_state(body["state"]) if "state" in body else _json(current["state"])
        with session.tx():
            _q("UPDATE dashboard_view SET name = %s, state = %s, shared = %s, updated_at = now() WHERE id = %s", [name, json.dumps(state), shared, str(view_id)])
        return Response(_view_out(_view_row(dashboard_id, view_id, request), request))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, dashboard_id=None, view_id=None):
        row = _dashboard_row(dashboard_id, request)
        current = _view_row(dashboard_id, view_id, request)
        if str(current["owner_user_id"]) != str(request.user.pk) and not _may_edit(request, row):
            raise PermissionDenied("Only the view's owner, or someone who can change the dashboard, removes it.")
        with session.tx():
            _q("DELETE FROM dashboard_view WHERE id = %s", [str(view_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)
