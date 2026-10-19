"""Insights: the report engine's API, under /api/v1/insights/ (mounted by the app, and by the engine service alone).

    GET    /insights/catalog/                    the datasets this workspace can report on, with their fields
    GET    /insights/catalog/{dataset}/          one dataset
    GET    /insights/reports/                    ?dataset= &component= &q=     the reports this person may see
    POST   /insights/reports/                    {name, dataset, definition, view_type?, description?, visibility?, folder?}
    GET    /insights/reports/{id}/               the report with its definition
    PUT    /insights/reports/{id}/               a new version (row_version in the body)
    DELETE /insights/reports/{id}/               soft delete
    GET    /insights/reports/{id}/versions/
    POST   /insights/reports/preview/            {dataset, definition, limit?, offset?}   an unsaved draft, under the preview cap
    POST   /insights/reports/{id}/run/           {limit?, offset?}                         the saved report
    GET    /insights/reports/{id}/export.csv
    GET    /insights/engine/                     this workspace's engine, limits and freshness (read-only here)

report.view: see and run; report.edit: create and change what one may edit; report.admin: change and delete any,
and build on PII fields (a reader without the right gets them masked). The workspace needs the Insights component (an entitlement check, like the shell's).
"""
from django.http import StreamingHttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.delivery.engine import session
from apps.platform_ops import components
from apps.tenants import context
from apps.tenants.models import Tenant
from . import access, catalog, drill, runner
from .definition import DefinitionError, validate


def _tenant() -> Tenant:
    return Tenant.objects.get(pk=context.require().tenant_id)


def _has(request, code: str) -> bool:
    return HasPermissionCode.for_(code)().has_permission(request, None)


class HasInsights(BasePermission):
    """The workspace has the Insights component; otherwise 403 with a plain explanation."""
    message = "Insights is not part of this workspace. Ask the platform team to switch it on."

    def has_permission(self, request, view):
        tenant = getattr(request, "tenant", None)
        return bool(tenant) and any(c["key"] == "insights" for c in components.for_tenant(tenant["id"]))


VIEW = [IsAuthenticated, HasInsights, HasPermissionCode.for_("report.view")]


def _can_see_pii(request) -> bool:
    return _has(request, "report.admin") or _has(request, "user.admin")


def _q(sql, args=()):
    with session.connection().cursor() as cursor:
        cursor.execute(sql, args)
        if cursor.description:
            names = [c[0] for c in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]
        return cursor.rowcount


def _may_edit(request, row: dict) -> bool:
    """report administrators; the owner, or someone it is shared with to edit, with report.edit"""
    user_id = str(request.user.pk)
    return _has(request, "report.admin") or (_has(request, "report.edit") and (str(row.get("owner_user_id")) == user_id or bool(row.get("shared_edit"))))


def _may_share(request, row: dict) -> bool:
    return _has(request, "report.admin") or str(row.get("owner_user_id")) == str(request.user.pk)


def favourite_sql(user_id: str, kind: str, item: str) -> tuple[str, list]:
    """an EXISTS for a list query: whether this person starred the row (item: the row's id column, e.g. r.id)"""
    return f"EXISTS (SELECT 1 FROM report_favourite fav WHERE fav.user_id = %s AND fav.kind = '{kind}' AND fav.item_id = {item})", [user_id]


def _visible_sql(request) -> tuple[str, list]:
    """The workspace's reports, a person's own, and the ones shared with them or their roles; administrators see all."""
    return access.visible_sql("report", "r", str(request.user.pk), _has(request, "report.admin"))


def _report_row(report_id, request) -> dict:
    where, args = _visible_sql(request)
    edit, edit_args = access.shared_edit_sql("report", "r", str(request.user.pk))
    shared = access.shared_any_sql("report", "r")
    rows = _q(f"""SELECT r.id::text, r.name, r.description, r.dataset_key, r.view_type, r.definition, r.visibility, r.version, r.row_version,
                         r.owner_user_id::text, u.display_name AS owner_name, r.folder_id::text, r.last_run_at, r.created_at, r.updated_at,
                         {edit} AS shared_edit, {shared} AS shared
                    FROM report r LEFT JOIN app_user u ON u.id = r.owner_user_id
                   WHERE r.id = %s AND r.deleted_at IS NULL AND {where}""", [*edit_args, str(report_id), *args])
    if not rows:
        raise NotFound("No such report.")
    return rows[0]


def _serialize(row: dict) -> dict:
    import json
    definition = row["definition"]
    return {"id": row["id"], "name": row["name"], "description": row["description"], "dataset": row["dataset_key"], "view_type": row["view_type"],
            "definition": json.loads(definition) if isinstance(definition, str) else definition, "visibility": row["visibility"], "version": row["version"],
            "row_version": row["row_version"], "owner_user_id": row["owner_user_id"], "owner_name": row["owner_name"], "folder_id": row["folder_id"],
            "last_run_at": row["last_run_at"], "created_at": row["created_at"], "updated_at": row["updated_at"]}


def _validated(request, body: dict, *, max_limit: int, reading: bool = False):
    """Authoring (create, change, preview) is checked against the fields the person may see; reading a saved report (run,
    export) against the whole catalogue, with PII columns masked for a reader without the right."""
    dataset_key = body.get("dataset")
    dataset = catalog.dataset(context.require().tenant_id, str(dataset_key or ""), reading or _can_see_pii(request))
    if dataset is None:
        raise ValidationError({"dataset": "Choose one of the datasets this workspace can report on."})
    try:
        return dataset, validate(dataset, body.get("definition") or {}, max_limit=max_limit)
    except DefinitionError as exc:
        raise ValidationError({f"definition.{exc.field}": str(exc)}) from None


class CatalogView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, dataset=None):
        tenant_id = context.require().tenant_id
        if dataset:
            found = catalog.dataset(tenant_id, dataset, _can_see_pii(request))
            if found is None:
                raise NotFound("No such dataset.")
            return Response({k: v for k, v in found.items() if k not in ("source", "workspace_field", "connection", "query")})
        datasets = catalog.for_tenant(tenant_id, _can_see_pii(request))
        return Response({"datasets": [{k: v for k, v in d.items() if k not in ("source", "workspace_field", "connection", "query")} for d in datasets],
                         "engine": {k: v for k, v in catalog.engine_of(tenant_id).items() if k != "limits"} | {"limits": catalog.engine_of(tenant_id)["limits"]}})


class ReportListView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        where, args = _visible_sql(request)
        filters, params = [where], list(args)
        if request.query_params.get("dataset"):
            filters.append("r.dataset_key = %s"); params.append(request.query_params["dataset"])
        if request.query_params.get("detail_for"):                  # the detail reports another report can drill through to, by the field clicked
            filters.append("jsonb_exists(COALESCE(r.definition->'drillthrough', '[]'::jsonb), %s)"); params.append(request.query_params["detail_for"])
        if request.query_params.get("component"):
            filters.append("COALESCE(d.component_key, x.component_key, 'cep') = %s"); params.append(request.query_params["component"])
        if request.query_params.get("q", "").strip():
            filters.append("r.name ILIKE %s"); params.append(f"%{request.query_params['q'].strip()}%")
        folder = request.query_params.get("folder")
        if folder == "none":
            filters.append("r.folder_id IS NULL")
        elif folder:
            filters.append("r.folder_id = %s"); params.append(folder)
        starred, star_args = favourite_sql(str(request.user.pk), "report", "r.id")
        edit, edit_args = access.shared_edit_sql("report", "r", str(request.user.pk))
        shared = access.shared_any_sql("report", "r")
        star_args = [*star_args, *edit_args]
        rows = _q(f"""SELECT r.id::text, r.name, r.description, r.dataset_key, COALESCE(d.label, x.label, r.dataset_key) AS dataset_label, c.key AS component_key, c.name AS component_name, r.view_type,
                             r.visibility, r.version, r.owner_user_id::text, u.display_name AS owner_name, r.last_run_at, r.updated_at,
                             r.folder_id::text, f.name AS folder_name, {starred} AS favourite, x.id::text AS own_dataset_id, {edit} AS shared_edit, {shared} AS shared
                        FROM report r LEFT JOIN report_dataset d ON d.key = r.dataset_key
                        LEFT JOIN report_dataset_custom x ON x.key = r.dataset_key AND x.tenant_id = r.tenant_id
                        JOIN suite_component c ON c.key = COALESCE(d.component_key, x.component_key, 'cep')
                        LEFT JOIN app_user u ON u.id = r.owner_user_id LEFT JOIN report_folder f ON f.id = r.folder_id AND f.deleted_at IS NULL
                       WHERE r.deleted_at IS NULL AND {' AND '.join(filters)} ORDER BY c.sort_order, r.updated_at DESC LIMIT 500""", [*star_args, *params])
        return Response({"reports": [{"id": r["id"], "name": r["name"], "description": r["description"], "dataset": r["dataset_key"], "dataset_label": r["dataset_label"],
                                      "component": {"key": r["component_key"], "name": r["component_name"]}, "view_type": r["view_type"], "visibility": r["visibility"],
                                      "version": r["version"], "owner_user_id": r["owner_user_id"], "owner_name": r["owner_name"], "last_run_at": r["last_run_at"],
                                      "updated_at": r["updated_at"], "can_edit": _may_edit(request, r), "folder_id": r["folder_id"], "folder_name": r["folder_name"],
                                      "favourite": bool(r["favourite"]), "own_dataset": bool(r["own_dataset_id"]), "shared": bool(r["shared"])} for r in rows]})

    @extend_schema(responses={201: None})
    def post(self, request, version=None):
        if not _has(request, "report.edit") and not _has(request, "report.admin"):
            raise PermissionDenied("Creating a report needs the report.edit permission.")
        body = request.data if isinstance(request.data, dict) else {}
        name = str(body.get("name") or "").strip()
        errors = {}
        if not name or len(name) > 200:
            errors["name"] = "Give the report a name of up to 200 characters."
        visibility = str(body.get("visibility") or "PRIVATE").upper()
        if visibility not in ("PRIVATE", "WORKSPACE"):
            errors["visibility"] = "PRIVATE or WORKSPACE."
        if errors:
            raise ValidationError(errors)
        dataset, definition = _validated(request, body, max_limit=catalog.engine_of(context.require().tenant_id)["limits"]["run_rows"])
        view_type = (definition.get("view") or {}).get("type", "grid")
        import json
        tenant_id = context.require().tenant_id
        with session.tx():
            rows = _q("""INSERT INTO report (tenant_id, dataset_key, name, description, view_type, definition, owner_user_id, visibility, created_by, updated_by)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id::text""",
                      [tenant_id, dataset["key"], name, (body.get("description") or None), view_type, json.dumps(definition), str(request.user.pk), visibility,
                       str(request.user.pk), str(request.user.pk)])
            report_id = rows[0]["id"]
            _q("INSERT INTO report_version (tenant_id, report_id, version, definition, view_type, note, changed_by) VALUES (%s, %s, 1, %s, %s, %s, %s)",
               [tenant_id, report_id, json.dumps(definition), view_type, "Created", str(request.user.pk)])
        return Response(_serialize(_report_row(report_id, request)), status=status.HTTP_201_CREATED)


class ReportView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, report_id=None):
        row = _report_row(report_id, request)
        return Response({**_serialize(row), "can_edit": _may_edit(request, row), "can_share": _may_share(request, row), "shared": bool(row.get("shared"))})

    @extend_schema(responses={200: None})
    def put(self, request, version=None, report_id=None):
        row = _report_row(report_id, request)
        if not _may_edit(request, row):
            raise PermissionDenied("Only the report's owner, or a report administrator, can change it.")
        body = request.data if isinstance(request.data, dict) else {}
        if int(body.get("row_version") or 0) != row["row_version"]:
            return Response({"type": "about:blank", "title": "The report changed since you opened it", "status": 409, "detail": "Reload it and apply your change again."},
                            status=status.HTTP_409_CONFLICT)
        name = str(body.get("name") or row["name"]).strip()
        if not name or len(name) > 200:
            raise ValidationError({"name": "Give the report a name of up to 200 characters."})
        visibility = str(body.get("visibility") or row["visibility"]).upper()
        if visibility not in ("PRIVATE", "WORKSPACE"):
            raise ValidationError({"visibility": "PRIVATE or WORKSPACE."})
        folder_id = row["folder_id"]
        if "folder_id" in body:
            folder_id = body["folder_id"] or None
            if folder_id and not _q("SELECT 1 FROM report_folder WHERE id::text = %s AND deleted_at IS NULL", [str(folder_id)]):
                raise ValidationError({"folder_id": "Choose one of the workspace's folders."})
        definition_body = body.get("definition")
        import json
        if definition_body is not None:
            dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": definition_body},
                                             max_limit=catalog.engine_of(context.require().tenant_id)["limits"]["run_rows"])
        else:
            definition = json.loads(row["definition"]) if isinstance(row["definition"], str) else row["definition"]
        new_version = row["version"] + (1 if definition_body is not None else 0)
        view_type = (definition.get("view") or {}).get("type", row["view_type"])
        tenant_id = context.require().tenant_id
        with session.tx():
            _q("""UPDATE report SET name = %s, description = %s, visibility = %s, definition = %s, version = %s, view_type = %s, folder_id = %s, updated_by = %s, updated_at = now(),
                                    row_version = row_version + 1 WHERE id = %s AND row_version = %s""",
               [name, body.get("description", row["description"]) or None, visibility, json.dumps(definition), new_version, view_type, (str(folder_id) if folder_id else None),
                str(request.user.pk), str(report_id), row["row_version"]])
            if definition_body is not None:
                _q("INSERT INTO report_version (tenant_id, report_id, version, definition, view_type, note, changed_by) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                   [tenant_id, str(report_id), new_version, json.dumps(definition), view_type, (str(body.get("note") or "")[:300] or None), str(request.user.pk)])
        return Response(_serialize(_report_row(report_id, request)))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, report_id=None):
        row = _report_row(report_id, request)
        if not _may_edit(request, row):
            raise PermissionDenied("Only the report's owner, or a report administrator, can delete it.")
        with session.tx():
            _q("UPDATE report SET deleted_at = %s, updated_by = %s WHERE id = %s", [timezone.now(), str(request.user.pk), str(report_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReportVersionsView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, report_id=None):
        _report_row(report_id, request)
        rows = _q("""SELECT v.version, v.view_type, v.note, v.changed_at, u.display_name AS changed_by_name, v.definition FROM report_version v
                     LEFT JOIN app_user u ON u.id = v.changed_by WHERE v.report_id = %s ORDER BY v.version DESC""", [str(report_id)])
        import json
        return Response({"versions": [{**r, "definition": json.loads(r["definition"]) if isinstance(r["definition"], str) else r["definition"]} for r in rows]})


class ReportVersionRestoreView(APIView):
    """An earlier version becomes the current one again, as a new version, so nothing is lost. Its definition is checked
    against today's catalogue, as any save is."""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, report_id=None, number=None):
        row = _report_row(report_id, request)
        if not _may_edit(request, row):
            raise PermissionDenied("Only the report's owner, or a report administrator, can restore a version.")
        old = _q("SELECT definition, view_type FROM report_version WHERE report_id = %s AND version = %s", [str(report_id), int(number)])
        if not old:
            raise NotFound("No such version.")
        import json
        definition_raw = json.loads(old[0]["definition"]) if isinstance(old[0]["definition"], str) else old[0]["definition"]
        dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": definition_raw}, max_limit=catalog.engine_of(context.require().tenant_id)["limits"]["run_rows"])
        new_version = row["version"] + 1
        view_type = (definition.get("view") or {}).get("type", old[0]["view_type"])
        tenant_id = context.require().tenant_id
        with session.tx():
            _q("""UPDATE report SET definition = %s, version = %s, view_type = %s, updated_by = %s, updated_at = now(), row_version = row_version + 1 WHERE id = %s""",
               [json.dumps(definition), new_version, view_type, str(request.user.pk), str(report_id)])
            _q("INSERT INTO report_version (tenant_id, report_id, version, definition, view_type, note, changed_by) VALUES (%s, %s, %s, %s, %s, %s, %s)",
               [tenant_id, str(report_id), new_version, json.dumps(definition), view_type, f"Restored from version {int(number)}", str(request.user.pk)])
        return Response(_serialize(_report_row(report_id, request)))


def _run_body(request) -> tuple[int | None, int]:
    body = request.data if isinstance(request.data, dict) else {}
    limit = body.get("limit")
    offset = body.get("offset") or 0
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or limit < 1):
        raise ValidationError({"limit": "A whole number of rows."})
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValidationError({"offset": "A whole number of rows to skip."})
    return limit, offset


def _totals_view(request, definition: dict) -> dict | None:
    """The view the engine totals for: the body's `view` (the viewer switching views without saving), else the definition's own."""
    body = request.data if isinstance(request.data, dict) else {}
    view = body.get("view")
    if not isinstance(view, dict):
        return None
    dims = [c["field"] for c in definition["columns"] if "aggregate" not in c]
    across = view.get("across")
    return {"type": str(view.get("type") or "grid"), **({"across": across} if across in dims else {})}


class PreviewView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None):
        tenant = _tenant()
        limits = catalog.engine_of(tenant.pk)["limits"]
        body = request.data if isinstance(request.data, dict) else {}
        dataset, definition = _validated(request, body, max_limit=limits["preview_rows"])
        limit, offset = _run_body(request)
        try:
            return Response(runner.run(tenant, request.user, dataset, definition, "preview", limit=limit, offset=offset, totals_view=_totals_view(request, definition)))
        except runner.RunRefused as exc:
            return Response({"type": "about:blank", "title": "The preview did not run", "status": 422, "detail": exc.reason, "outcome": exc.outcome}, status=422)


def _through(dataset: dict, definition: dict, raw, max_limit: int) -> tuple[dict, list[dict]]:
    """Drill-through: the values another report was clicked on, each on a field this report takes (its `drillthrough`), and-ed
    onto its filters; the definition, and the values in words for the note above the rows."""
    if raw in (None, []):
        return definition, []
    if not isinstance(raw, list) or len(raw) > 5:
        raise ValidationError({"through": "Up to five values from another report."})
    taken = definition.get("drillthrough", [])
    rules, words = [], []
    for i, item in enumerate(raw):
        key = item.get("field") if isinstance(item, dict) else None
        if key not in taken:
            raise ValidationError({f"through[{i}]": "This report does not take that field from another report."})
        field = next((f for f in dataset["fields"] if f["key"] == key), None)
        if field is None:
            raise ValidationError({f"through[{i}]": "Not a field of this report's dataset."})
        value = item.get("value")
        rules.append({"field": key, "operator": "is_null"} if value is None else {"field": key, "operator": "=", "value": value})
        words.append({"field": key, "label": field["label"], "value": value})
    filters = definition.get("filters") or {"combinator": "and", "rules": []}
    combined = {**definition, "filters": {"combinator": "and", "rules": [filters, *rules]} if filters.get("rules") else {"combinator": "and", "rules": rules}}
    combined.pop("grouped", None)
    combined.pop("dataset", None)
    try:
        return validate(dataset, combined, max_limit=max_limit), words
    except DefinitionError as exc:
        raise ValidationError({"through": f"{exc.field}: {exc}"}) from None


class RunView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, report_id=None):
        tenant = _tenant()
        row = _report_row(report_id, request)
        run_rows = catalog.engine_of(tenant.pk)["limits"]["run_rows"]
        dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": row["definition"] if not isinstance(row["definition"], str) else __import__("json").loads(row["definition"])},
                                         max_limit=run_rows, reading=True)
        limit, offset = _run_body(request)
        body = request.data if isinstance(request.data, dict) else {}
        through, through_words = _through(dataset, definition, body.get("through"), run_rows)
        try:                                                          # a drill path: the level under it, filtered to the values clicked
            path = drill.path_body(body.get("drill"))
            below = drill.drilled(dataset, through, path, drill.keeps_rest(body.get("drill")))
            shown = validate(dataset, below, max_limit=run_rows) if below else through
        except (drill.DrillError, DefinitionError) as exc:
            raise ValidationError({"drill": str(exc)}) from None
        try:
            result = runner.run(tenant, request.user, dataset, shown, "run", limit=limit, offset=offset, report_id=report_id, report_version=row["version"],
                                mask_pii=not _can_see_pii(request), totals_view=_totals_view(request, shown))
        except runner.RunRefused as exc:
            return Response({"type": "about:blank", "title": "The report did not run", "status": 422, "detail": exc.reason, "outcome": exc.outcome}, status=422)
        with session.tx():
            runner.touch_last_run(report_id)
        levels = drill.info(dataset, through, path)
        return Response({**result, **({"drill": levels} if levels else {}), **({"through": through_words} if through_words else {})})


class ExportView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, report_id=None):
        tenant = _tenant()
        row = _report_row(report_id, request)
        import json
        definition_raw = json.loads(row["definition"]) if isinstance(row["definition"], str) else row["definition"]
        dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": definition_raw}, max_limit=catalog.engine_of(tenant.pk)["limits"]["export_rows"], reading=True)
        try:
            chunks = runner.stream_csv(tenant, request.user, dataset, definition, report_id=report_id, report_version=row["version"], mask_pii=not _can_see_pii(request))
            first = next(chunks)
        except runner.RunRefused as exc:
            return Response({"type": "about:blank", "title": "The export did not run", "status": 422, "detail": exc.reason}, status=422)
        except StopIteration:
            first, chunks = "", iter(())

        def body():
            yield first
            yield from chunks
        response = StreamingHttpResponse(body(), content_type="text/csv; charset=utf-8")
        safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in row["name"])[:80] or "report"
        response["Content-Disposition"] = f'attachment; filename="{safe}.csv"'
        return response


class ExportXlsxView(APIView):
    """The report in its saved view as an Excel workbook (apps/insights/excel.py): a pivot or a hierarchy with its totals first, the rows after."""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, report_id=None):
        from django.http import HttpResponse
        from . import excel
        tenant = _tenant()
        row = _report_row(report_id, request)
        import json
        definition_raw = json.loads(row["definition"]) if isinstance(row["definition"], str) else row["definition"]
        dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": definition_raw}, max_limit=catalog.engine_of(tenant.pk)["limits"]["export_rows"], reading=True)
        try:
            columns, rows, totals = runner.fetch_all(tenant, request.user, dataset, definition, report_id=report_id, report_version=row["version"], mask_pii=not _can_see_pii(request))
        except runner.RunRefused as exc:
            return Response({"type": "about:blank", "title": "The export did not run", "status": 422, "detail": exc.reason}, status=422)
        body = excel.build(row["name"], columns, rows, definition.get("view"), totals)
        safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in row["name"])[:80] or "report"
        response = HttpResponse(body, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        response["Content-Disposition"] = f'attachment; filename="{safe}.xlsx"'
        return response


class ExportPdfView(APIView):
    """The report in its saved view as a PDF (apps/insights/pdf.py): a pivot or a hierarchy with its totals, a chart as bars with its numbers."""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, report_id=None):
        from django.http import HttpResponse
        from . import pdf
        from apps.reporting import reports as reporting
        tenant = _tenant()
        row = _report_row(report_id, request)
        import json
        definition_raw = json.loads(row["definition"]) if isinstance(row["definition"], str) else row["definition"]
        dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": definition_raw}, max_limit=catalog.engine_of(tenant.pk)["limits"]["export_rows"], reading=True)
        try:
            columns, rows, totals = runner.fetch_all(tenant, request.user, dataset, definition, report_id=report_id, report_version=row["version"], mask_pii=not _can_see_pii(request))
        except runner.RunRefused as exc:
            return Response({"type": "about:blank", "title": "The export did not run", "status": 422, "detail": exc.reason}, status=422)
        today = timezone.now().astimezone(reporting.zone_of(tenant)).date()
        body = pdf.report(row["name"], columns, rows, definition.get("view"), totals, workspace=tenant.name, when=today.strftime("%d %b %Y").lstrip("0"))
        safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in row["name"])[:80] or "report"
        response = HttpResponse(body, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{safe}.pdf"'
        return response


class EngineView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(catalog.engine_of(context.require().tenant_id))
