"""Base Reports (docs/mockups/base-reports.html, option 1): the platform's base packs (apps/insights/base_packs), added to a
workspace as its own copies. Adding one asks only what the pack needs from this workspace (a connection, the databases on it
holding the pack's tables, its options), checks it, test-runs each dataset, then makes the folder, the datasets, their shared
formulas, the reports and the dashboards through the same endpoints as by hand, in one transaction: all or nothing. Later
versions of a pack never change what a workspace has; adding it again makes new copies.

    GET   /insights/base-reports/                        the packs, what this workspace added, and the connections a pack can read
    POST  /insights/base-reports/<pack>/sources/         {connection_id}: the databases on it holding the pack's tables; campaign-name tables
    POST  /insights/base-reports/<pack>/check/           {connection_id, options}: the options checked and each dataset test-run
    POST  /insights/base-reports/<pack>/add/             {connection_id, options}: everything made; what was made

Adding needs report.admin or user.admin. Table report_base_install (patch 0079, row-level security) records each addition; without
it a pack is still added, only not remembered.
"""
import json
import time

from django.core.cache import cache
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode
from apps.delivery.engine import session
from apps.insights import catalog, connection_limits, dataset_formulas, databases, external
from apps.insights.api import VIEW, HasInsights, _has, _q, _tenant
from apps.insights.base_packs import PACKS
from apps.insights.base_packs.email_sql import OptionError
from apps.reporting import reports

ADD = [IsAuthenticated, HasInsights, HasPermissionCode.for_("report.admin") | HasPermissionCode.for_("user.admin")]
CHECK_DAYS = 90
NAME_TABLES = 6
SKIP_SCHEMAS = ("information_schema", "mysql", "performance_schema", "sys")


def present() -> bool:
    found = cache.get("cep:insights:base-install-present")
    if found is None:
        found = bool(_q("SELECT to_regclass('public.report_base_install') IS NOT NULL AS present")[0]["present"])
        cache.set("cep:insights:base-install-present", found, 300)
    return found


def _pack(key: str) -> dict:
    pack = PACKS.get(key)
    if pack is None:
        raise NotFound("No such base pack.")
    return pack


def _added(tenant_id) -> list[dict]:
    if not present():
        return []
    return _q("""SELECT i.pack_key, i.version, i.created_at, i.folder_id::text, f.name AS folder_name, u.display_name AS added_by
                   FROM report_base_install i LEFT JOIN report_folder f ON f.id = i.folder_id AND f.deleted_at IS NULL
                   LEFT JOIN app_user u ON u.id = i.created_by
                  WHERE i.tenant_id = %s ORDER BY i.created_at DESC""", [str(tenant_id)])


def _fits(pack: dict, row: dict) -> bool:
    return row["engine"].startswith(pack["needs"]["engine"])


def describe(pack: dict, added: list[dict] | None = None) -> dict:
    mine = [a for a in added or [] if a["pack_key"] == pack["key"]]
    return {"key": pack["key"], "version": pack["version"], "name": pack["name"], "summary": pack["summary"], "source": pack.get("source"),
            "needs": {"label": pack["needs"]["label"], "engine": pack["needs"]["engine"], "tables": pack["needs"]["tables"]},
            "contents": {"datasets": [d["label"] for d in pack["datasets"]], "reports": [r["name"] for r in pack["reports"]], "dashboards": [d["name"] for d in pack["dashboards"]]},
            "added": [{"version": a["version"], "at": a["created_at"], "folder_id": a["folder_id"], "folder_name": a["folder_name"], "by": a["added_by"]} for a in mine]}


def _connection(tenant, pack: dict, connection_id) -> dict:
    row = databases.connection(tenant.pk, connection_id)
    databases._usable(row)
    if not _fits(pack, row):
        raise ValidationError({"connection_id": f"{pack['name']} reads {pack['needs']['label']}: pick a MySQL connection."})
    return row


def _run(tenant, row: dict, sql: str, limit: int = 50) -> dict:
    timeout = connection_limits.effective(row, catalog.engine_of(tenant.pk)["limits"])["timeout_s"]
    return external.run_sql(row, sql, limit=limit, timeout_ms=timeout * 1000, zone=reports.zone_of(tenant).key)


def sources(tenant, pack: dict, row: dict) -> dict:
    """the databases on the connection holding every table the pack reads, largest first, with their marketing emails; and the
    tables that look like campaign names (a campaign id column beside a campaign name column)"""
    from apps.insights.base_packs.email_sql import IDENT, MARKETING
    tables = pack["needs"]["tables"]
    listed = ", ".join(f"'{t}'" for t in tables)
    skip = ", ".join(f"'{s}'" for s in SKIP_SCHEMAS)
    try:
        found = _run(tenant, row, f"""SELECT TABLE_SCHEMA AS name, COUNT(DISTINCT TABLE_NAME) AS tables_found,
                                             MAX(CASE WHEN TABLE_NAME = 'messages' THEN TABLE_ROWS END) AS messages
                                        FROM information_schema.TABLES WHERE TABLE_NAME IN ({listed}) AND TABLE_SCHEMA NOT IN ({skip})
                                       GROUP BY TABLE_SCHEMA HAVING COUNT(DISTINCT TABLE_NAME) = {len(tables)} ORDER BY messages DESC""", limit=100)
        names = _run(tenant, row, f"""SELECT CONCAT(a.TABLE_SCHEMA, '.', a.TABLE_NAME) AS table_name, a.COLUMN_NAME AS id_column, b.COLUMN_NAME AS name_column
                                        FROM information_schema.COLUMNS a JOIN information_schema.COLUMNS b ON b.TABLE_SCHEMA = a.TABLE_SCHEMA AND b.TABLE_NAME = a.TABLE_NAME
                                       WHERE LOWER(a.COLUMN_NAME) LIKE '%%campaign%%id' AND LOWER(b.COLUMN_NAME) LIKE '%%campaign%%name'
                                         AND a.TABLE_SCHEMA NOT IN ({skip}) ORDER BY a.TABLE_SCHEMA, a.TABLE_NAME""".replace("%%", "%"), limit=200)
    except external.ExternalError as exc:
        raise Conflict(str(exc)) from None
    out = []
    for name, _count, messages in found["rows"]:
        if not IDENT.match(str(name)):
            continue
        try:
            marketing = _run(tenant, row, f"SELECT COUNT(*) FROM `{name}`.messages m WHERE {MARKETING}", limit=1)["rows"][0][0]
        except external.ExternalError:
            marketing = None
        out.append({"name": name, "messages": int(messages or 0), "marketing": None if marketing is None else int(marketing)})
    return {"databases": out, "names": name_tables(names["rows"])}


NOT_THE_ID = ("type", "template", "purpose", "payload", "alternate", "parent", "status", "cassandra", "external")


def name_tables(rows) -> list[dict]:
    """the likely campaign-name tables, best first: a campaign's own id beside its own name (MARKETING_CAMPAIGN_ID and CAMPAIGN_NAME,
    not a template's, a type's or a parent's), in the campaigns' own table rather than a log of them; NAME_TABLES at most"""
    out, seen = [], set()
    for table, id_column, name_column in rows:
        low_id, low_name = id_column.lower(), name_column.lower()
        if any(w in low_id for w in NOT_THE_ID) or any(w in low_name for w in NOT_THE_ID) or (table, id_column) in seen:
            continue
        seen.add((table, id_column))
        master = table.lower().rsplit(".", 1)[-1].rstrip("s").endswith("campaign")             # marketing_campaign, not campaign_report_unsubscribed
        out.append(((low_name != "campaign_name", not master, not low_id.endswith("campaign_id"), table),
                    {"table": table, "id": id_column, "name": name_column}))
    return [entry for _rank, entry in sorted(out, key=lambda pair: pair[0])][:NAME_TABLES]


def _options(pack: dict, body: dict) -> dict:
    try:
        return pack["checked"](body.get("options") or {})
    except OptionError as exc:
        raise ValidationError({"options": str(exc)}) from None


def check(tenant, pack: dict, row: dict, options: dict) -> dict:
    """each dataset's SQL run for its first rows, its columns held to the pack's fields; the campaigns sent in the last CHECK_DAYS"""
    out, problems = [], []
    for dataset in pack["datasets"]:
        started = time.monotonic()
        try:
            result = _run(tenant, row, dataset["sql"](options), limit=5)
            columns = {c["column"] for c in result["columns"]}
            missing = [f["column"] for f in dataset["fields"] if f["column"] not in columns]
            if missing:
                problems.append(f"{dataset['label']} gives no {', '.join(missing)}.")
            out.append({"label": dataset["label"], "ok": not missing, "seconds": round(time.monotonic() - started, 1)})
        except external.ExternalError as exc:
            problems.append(f"{dataset['label']}: {exc}")
            out.append({"label": dataset["label"], "ok": False, "seconds": round(time.monotonic() - started, 1), "error": str(exc)})
    campaigns = None
    if not problems:
        first = next(d for d in pack["datasets"] if d["id"] == "campaigns")
        try:
            campaigns = int(_run(tenant, row, f"SELECT COUNT(*) FROM ({first['sql'](options)}) q WHERE q.send_start >= NOW() - INTERVAL {CHECK_DAYS} DAY", limit=1)["rows"][0][0])
        except external.ExternalError as exc:
            problems.append(str(exc))
    return {"ok": not problems, "datasets": out, "campaigns": campaigns, "days": CHECK_DAYS, "problems": problems}


# ---------------------------------------------------------------------------------------------------- adding a pack
class Refused(Exception):
    def __init__(self, what: str, detail):
        super().__init__(what)
        self.what, self.detail = what, detail

    def words(self) -> str:
        detail = self.detail
        if isinstance(detail, dict):
            detail = "; ".join(f"{k}: {v if isinstance(v, str) else ' '.join(map(str, v)) if isinstance(v, list) else v}" for k, v in detail.items())
        return f"Adding stopped at {self.what}: {detail}. Nothing was added."


FACTORY = APIRequestFactory()


def _call(request, view, method: str, what: str, data: dict | None = None, **kwargs) -> dict:
    """one of the app's own endpoints, as this person, inside the caller's transaction"""
    inner = getattr(FACTORY, method)("/", data or {}, format="json", HTTP_HOST=request.get_host(), secure=request.is_secure())
    force_authenticate(inner, user=request.user, token=getattr(request, "auth", None))
    inner.tenant = getattr(request, "tenant", None)                     # what the tenant middleware set on the outer request
    response = view.as_view()(inner, version="v1", **kwargs)
    if response.status_code >= 300:
        raise Refused(what, getattr(response, "data", None) or response.status_code)
    return response.data


def _folder_name(pack: dict) -> str:
    taken = {r["name"].lower() for r in _q("SELECT name FROM report_folder WHERE deleted_at IS NULL")}
    name, n = pack["name"], 2
    while name.lower() in taken:
        name, n = f"{pack['name']} ({n})", n + 1
    return name


def _layout(layout: dict, report_ids: dict) -> dict:
    def tile(t: dict) -> dict:
        out = {k: v for k, v in t.items() if k != "report"}
        return {**out, "report_id": report_ids[t["report"]]} if "report" in t else out
    return {**layout, "rows": [{**row, "tiles": [tile(t) for t in row["tiles"]]} for row in layout["rows"]]}


def add(request, tenant, pack: dict, row: dict, options: dict) -> dict:
    from apps.insights import api, dashboards, library
    made = {"datasets": [], "reports": [], "dashboards": []}
    try:
        with session.tx():
            folder = _call(request, library.FolderListView, "post", "the folder", {"name": _folder_name(pack)})
            keys = {}
            for dataset in pack["datasets"]:
                out = _call(request, databases.QueryDatasetView, "post", f"the dataset {dataset['label']}",
                            {"label": dataset["label"], "description": dataset["description"], "sql": dataset["sql"](options), "fields": dataset["fields"],
                             "time_field": dataset["time_field"], "primary_key": dataset["primary_key"]}, connection_id=row["id"])
                keys[dataset["id"]] = out["key"]
                made["datasets"].append({"key": out["key"], "label": out["label"]})
            for formula in pack["formulas"]:
                _call(request, dataset_formulas.FormulasView, "post", f"the formula {formula['label']}",
                      {k: formula[k] for k in ("label", "kind", "expression", "description", "format")}, dataset=keys[formula["dataset"]])
            report_ids = {}
            for report in pack["reports"]:
                out = _call(request, api.ReportListView, "post", f"the report {report['name']}",
                            {"name": report["name"], "dataset": keys[report["dataset"]], "definition": report["definition"], "description": report["description"], "visibility": "WORKSPACE"})
                _call(request, api.ReportView, "put", f"filing {report['name']}", {"row_version": out["row_version"], "folder_id": folder["id"]}, report_id=out["id"])
                report_ids[report["id"]] = out["id"]
                made["reports"].append({"id": out["id"], "name": out["name"]})
            for board in pack["dashboards"]:
                out = _call(request, dashboards.DashboardListView, "post", f"the dashboard {board['name']}",
                            {"name": board["name"], "description": board["description"], "visibility": "WORKSPACE", "period": board["period"], "compare": board["compare"],
                             "layout": _layout(board["layout"], report_ids)})
                made["dashboards"].append({"id": out["id"], "name": out["name"]})
            if present():
                _q("""INSERT INTO report_base_install (tenant_id, pack_key, version, connection_id, options, folder_id, made, created_by)
                      VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                   [str(tenant.pk), pack["key"], pack["version"], row["id"], json.dumps(options), folder["id"],
                    json.dumps({"datasets": [d["key"] for d in made["datasets"]], "reports": [r["id"] for r in made["reports"]], "dashboards": [d["id"] for d in made["dashboards"]]}),
                    str(request.user.pk)])
    except Refused as exc:
        raise ValidationError({"detail": exc.words()}) from None
    finally:                                                          # a rolled-back addition must not linger in the catalogue's cache
        databases.invalidate(tenant.pk)
        dataset_formulas.invalidate(tenant.pk)
    return {"version": pack["version"], "folder": {"id": folder["id"], "name": folder["name"]}, **made, "recorded": present()}


# ---------------------------------------------------------------------------------------------------- the API
class BaseReportsView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant = _tenant()
        added = _added(tenant.pk)
        rows = databases.connections(tenant.pk) if databases._present() else []
        may_add = _has(request, "report.admin") or _has(request, "user.admin")
        return Response({"packs": [describe(p, added) for p in PACKS.values()], "can_add": may_add, "recorded": present(),
                         "connections": [{"id": r["id"], "name": r["name"], "engine": r["engine"], "database": r["database_name"],
                                          "usable": r["status"] == "ACTIVE" and r["read_only"] is not None and (r["read_only"] is not False or not databases.read_only_required())}
                                         for r in rows] if may_add else []})


class _PackView(APIView):
    permission_classes = ADD

    def _given(self, request, pack_key):
        tenant = _tenant()
        pack = _pack(pack_key)
        body = request.data if isinstance(request.data, dict) else {}
        if not body.get("connection_id"):
            raise ValidationError({"connection_id": "Pick the connection that holds the pack's tables."})
        return tenant, pack, _connection(tenant, pack, body["connection_id"]), body


class SourcesView(_PackView):
    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, pack=None):
        tenant, found, row, _body = self._given(request, pack)
        return Response(sources(tenant, found, row))


class CheckView(_PackView):
    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, pack=None):
        tenant, found, row, body = self._given(request, pack)
        return Response(check(tenant, found, row, _options(found, body)))


class AddView(_PackView):
    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None, pack=None):
        tenant, found, row, body = self._given(request, pack)
        return Response(add(request, tenant, found, row, _options(found, body)), status=status.HTTP_201_CREATED)
