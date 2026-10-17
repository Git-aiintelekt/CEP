"""Settings -> Report Databases (Option 1 and Option A of docs/mockups/report-databases.html): a workspace's own MySQL or PostgreSQL
databases, connected read-only, and the datasets it maps from their tables and views. A mapped dataset joins the catalogue for this
workspace alone (catalog.for_tenant), so New Report, the editor, the views, exports, dashboards, schedules and Ask for a
Report see it like any dataset; the runner reads it through apps/insights/external.py.

    GET, POST       /workspace/report-databases/                       the connections with their datasets; a new connection
    POST            /workspace/report-databases/test/                  {host, port, ...} an unsaved connection tested
    GET, PUT, DELETE /workspace/report-databases/<id>/
    POST            /workspace/report-databases/<id>/test/             the saved connection tested, the outcome kept on it
    GET             /workspace/report-databases/<id>/sources/          the tables and views the account can read
    GET             /workspace/report-databases/<id>/sources/<name>/   its columns, typed, with a few rows
    POST            /workspace/report-databases/<id>/preview/          {source, joins, fields} the first rows with the labels applied
    POST            /workspace/report-databases/<id>/join-check/       {source, joins} what the last join does to the rows
    GET             /workspace/report-databases/targets/               the databases a report author may query (report.edit)
    POST            /workspace/report-databases/<id>/query/run/        {sql} the query window's Run: one SELECT checked, wrapped, the first rows typed
    POST            /workspace/report-databases/<id>/query/write/      {prompt, model} Write It for Me: SQL from the AI assistant, never run
    POST            /workspace/report-databases/<id>/query/dataset/    {label, sql, fields?} a dataset from the query (report.edit)
    POST            /workspace/report-databases/<id>/datasets/         a dataset mapped from a table or view
    GET, PUT, DELETE /workspace/report-databases/datasets/<id>/

Tables (patch 0056): report_connection and report_dataset_custom, the workspace's (RLS); the password encrypted.
"""
import json
import re
import uuid

from django.core.cache import cache
from django.utils import timezone
from django.utils.text import slugify
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.delivery.engine import session
from apps.insights import catalog, external
from apps.insights.api import _q, _tenant
from apps.platform_ops import crypto
from apps.reporting import reports
from apps.tenants import context

ADMIN = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]
BUILDER = [IsAuthenticated, SameTenant, HasPermissionCode.for_("report.edit") | HasPermissionCode.for_("user.admin")]   # the query window and the schema it reads
ENGINES = ("mysql57", "mysql80", "postgresql")
SSL_MODES = ("REQUIRED", "PREFERRED", "OFF")
TYPES = ("string", "number", "date", "datetime", "boolean")
AGGREGATES = ("sum", "count", "count_distinct", "avg", "min", "max")
FORMATS = ("integer", "decimal", "money", "percent", "date", "datetime")
SENSITIVITIES = ("NORMAL", "PII", "CONFIDENTIAL")
MAX_FIELDS = 60
MAX_JOINS = 5
JOIN_TYPES = ("left", "inner")
GRANT_EXAMPLES = {
    "mysql": "CREATE USER 'cep_reader'@'%' IDENTIFIED BY '…';\nGRANT SELECT ON your_db.* TO 'cep_reader'@'%';",
    "postgresql": "CREATE ROLE cep_reader LOGIN PASSWORD '…';\nGRANT CONNECT ON DATABASE your_db TO cep_reader;\nGRANT USAGE ON SCHEMA public TO cep_reader;\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO cep_reader;",
}
CONNECTION_COLUMNS = "id::text, name, engine, host, port, database_name, schema_name, username, password_enc, ssl_mode, status, last_tested_at, last_test_ok, last_test_error, read_only, server_version, server_timezone, created_at, updated_at, row_version"


# ---------------------------------------------------------------------------------------------------- rows
def _present() -> bool:
    return bool(_q("SELECT to_regclass('public.report_connection') IS NOT NULL AS present")[0]["present"])


def connections(tenant_id) -> list[dict]:
    return _q(f"SELECT {CONNECTION_COLUMNS} FROM report_connection WHERE tenant_id = %s ORDER BY name", [str(tenant_id)])


def connection(tenant_id, connection_id) -> dict:
    rows = _q(f"SELECT {CONNECTION_COLUMNS} FROM report_connection WHERE tenant_id = %s AND id = %s", [str(tenant_id), str(connection_id)])
    if not rows:
        raise NotFound("No such database.")
    return rows[0]


def datasets(tenant_id, connection_id=None) -> list[dict]:
    where, args = "tenant_id = %s", [str(tenant_id)]
    if connection_id:
        where += " AND connection_id = %s"; args.append(str(connection_id))
    rows = _q(f"""SELECT id::text, connection_id::text, key, label, description, component_key, source_name, primary_key, time_field, fields, joins, query_sql, status, created_by::text, created_at, updated_at, row_version
                    FROM report_dataset_custom WHERE {where} ORDER BY label""", args)
    for row in rows:
        row["fields"] = json.loads(row["fields"]) if isinstance(row["fields"], str) else (row["fields"] or [])
        row["joins"] = json.loads(row["joins"]) if isinstance(row["joins"], str) else (row["joins"] or [])
    return rows


def _report_counts(tenant_id) -> dict[str, int]:
    return {r["dataset_key"]: int(r["n"]) for r in _q("SELECT dataset_key, count(*) AS n FROM report WHERE tenant_id = %s AND deleted_at IS NULL GROUP BY dataset_key", [str(tenant_id)])}


def custom_datasets(tenant_id) -> list[dict]:
    """The workspace's mapped datasets in the catalogue's shape, with their connection, cached a minute (catalog.TTL)."""
    key = f"cep:insights:custom:{tenant_id}"
    data = cache.get(key)
    if data is not None:
        return data
    if context.current() is None or context.is_platform() or not _present():
        return []
    by_connection = {c["id"]: c for c in connections(tenant_id)}
    data = []
    for row in datasets(tenant_id):
        conn = by_connection.get(row["connection_id"])
        if row["status"] != "ACTIVE" or conn is None or conn["status"] != "ACTIVE":
            continue
        schema = external.schema_of(conn)
        joins = row["joins"] or []
        query = row.get("query_sql") or None
        fields = [{"key": f["key"], "label": f["label"], "column": f.get("column"), **({"table": f.get("table") or "t0"} if (joins or query) and f.get("column") else {}), "type": f["type"], "role": f["role"],
                   "aggregates": f.get("aggregates") or [], "operators": catalog.OPERATORS[f["type"]], "buckets": catalog.BUCKETS if f["type"] in ("date", "datetime") else [],
                   "format": f.get("format"), "sensitivity": f.get("sensitivity") or "NORMAL", **({"formula": f["formula"]} if f.get("formula") else {})} for f in row["fields"]]
        data.append({"key": row["key"], "label": row["label"], "description": row["description"], "component": {"key": row["component_key"], "name": "Engagement"},
                     "primary_key": row["primary_key"], "time_field": row["time_field"], "freshness": "LIVE", "source": f"{schema}.{row['source_name']}",
                     "joins": [{**j, "table": f"{schema}.{j['table']}"} for j in joins], **({"query": query, "kind": "query"} if query else {"kind": "table"}),
                     "workspace_field": None, "engine": "postgresql" if external.is_pg(conn) else "mysql", "external": True, "fields": fields,
                     "database": {"id": conn["id"], "name": conn["name"], "engine": conn["engine"], "engine_name": external.ENGINES.get(conn["engine"], conn["engine"])},
                     "connection": conn})
    cache.set(key, data, catalog.TTL)
    return data


def invalidate(tenant_id) -> None:
    cache.delete(f"cep:insights:custom:{tenant_id}")


# ---------------------------------------------------------------------------------------------------- words
def serialize_connection(row: dict, with_datasets: list[dict] | None = None, counts: dict | None = None) -> dict:
    out = {k: row[k] for k in ("id", "name", "engine", "host", "port", "database_name", "schema_name", "username", "ssl_mode", "status", "last_tested_at", "last_test_ok", "last_test_error", "read_only",
                               "server_version", "server_timezone", "created_at", "updated_at", "row_version")}
    out["engine_name"] = external.ENGINES.get(row["engine"], row["engine"])
    out["usable"] = bool(row["status"] == "ACTIVE" and row["password_enc"] and row["read_only"] is not False)
    if with_datasets is not None:
        out["datasets"] = [serialize_dataset(d, counts or {}) for d in with_datasets]
    return out


def serialize_dataset(row: dict, counts: dict | None = None) -> dict:
    fields = row["fields"]
    return {"id": row["id"], "connection_id": row["connection_id"], "key": row["key"], "label": row["label"], "description": row["description"], "source": row["source_name"],
            "joins": row.get("joins") or [], "kind": "query" if row.get("query_sql") else "table", "query_sql": row.get("query_sql"), "created_by": row.get("created_by"),
            "primary_key": row["primary_key"], "time_field": row["time_field"], "fields": fields, "field_count": len(fields), "pii_count": sum(1 for f in fields if f.get("sensitivity") == "PII"),
            "reports": (counts or {}).get(row["key"], 0), "status": row["status"], "updated_at": row["updated_at"], "row_version": row["row_version"]}


# ---------------------------------------------------------------------------------------------------- the connection's body
def _connection_body(body: dict, current: dict | None) -> dict:
    errors = {}
    name = " ".join(str(body.get("name") or (current or {}).get("name") or "").split())
    if not name or len(name) > 100:
        errors["name"] = "Give the database a name of up to 100 characters."
    engine = str(body.get("engine") or (current or {}).get("engine") or "mysql80")
    if engine not in ENGINES:
        errors["engine"] = "MySQL 5.7, MySQL 8.0 or PostgreSQL."
    host = str(body.get("host") or (current or {}).get("host") or "").strip()
    if not host or len(host) > 200 or any(ch.isspace() for ch in host):
        errors["host"] = "The server's host name or address."
    try:
        port = int(body.get("port") or (current or {}).get("port") or external.DEFAULT_PORT.get(engine, 3306))
        if not 1 <= port <= 65535:
            raise ValueError
    except (TypeError, ValueError):
        port = 3306
        errors["port"] = "A port from 1 to 65535."
    database = str(body.get("database") or body.get("database_name") or (current or {}).get("database_name") or "").strip()
    if not database or not external.IDENT.match(database):
        errors["database"] = "The database name: letters, digits and underscores."
    schema = str(body.get("schema") or body.get("schema_name") or (current or {}).get("schema_name") or "public").strip() if engine == "postgresql" else database
    if not external.IDENT.match(schema):
        errors["schema"] = "The schema name: letters, digits and underscores."
    username = str(body.get("username") or (current or {}).get("username") or "").strip()
    if not username or len(username) > 100:
        errors["username"] = "The account the engine connects as."
    ssl_mode = str(body.get("ssl") or body.get("ssl_mode") or (current or {}).get("ssl_mode") or "REQUIRED").upper()
    if ssl_mode not in SSL_MODES:
        errors["ssl"] = "Required, Preferred or Off."
    password = str(body.get("password") or "")
    if not password and not (current or {}).get("password_enc"):
        errors["password"] = "Give the account's password."
    if errors:
        raise ValidationError(errors)
    return {"name": name, "engine": engine, "host": host, "port": port, "database_name": database, "schema_name": schema, "username": username, "ssl_mode": ssl_mode,
            "password_enc": crypto.encrypt(password) if password else (current or {}).get("password_enc")}


def _record_test(tenant_id, connection_id, outcome: dict) -> None:
    with session.tx():
        _q("""UPDATE report_connection SET last_tested_at = %s, last_test_ok = %s, last_test_error = %s, read_only = %s, server_version = %s, server_timezone = %s, updated_at = now()
               WHERE tenant_id = %s AND id = %s""",
           [timezone.now(), outcome["ok"] and outcome.get("read_only", False), (outcome.get("error") or (None if outcome.get("read_only", True) else "The account can write: " + "; ".join(outcome.get("offending") or [])) or "")[:300] or None,
            outcome.get("read_only") if outcome["ok"] else None, (outcome.get("version") or "")[:40] or None, (outcome.get("timezone") or "")[:40] or None, str(tenant_id), str(connection_id)])
    invalidate(tenant_id)


def _usable(row: dict) -> None:
    if row["status"] != "ACTIVE":
        raise Conflict("This database is switched off.")
    if row["read_only"] is False:
        raise Conflict("The account can write. Give the engine a SELECT-only account and test the connection again.")


# ---------------------------------------------------------------------------------------------------- the dataset's body
def _unique_key(tenant_id, label: str, keep: str | None) -> str:
    base = ("x_" + slugify(label).replace("-", "_"))[:36].rstrip("_") or "x_dataset"
    taken = {r["key"] for r in _q("SELECT key FROM report_dataset_custom WHERE tenant_id = %s", [str(tenant_id)])} | {d["key"] for d in catalog._load("postgresql")}
    if keep and keep.startswith(base):
        return keep
    key, n = base, 2
    while key in taken:
        key, n = f"{base}_{n}", n + 1
    return key


def _dataset_body(body: dict, current: dict | None) -> dict:
    errors = {}
    label = " ".join(str(body.get("label") or (current or {}).get("label") or "").split())
    if not label or len(label) > 100:
        errors["label"] = "Give the dataset a name of up to 100 characters."
    description = " ".join(str(body.get("description") or "").split())[:300] or None if "description" in body else (current or {}).get("description")
    query_sql = None
    if "sql" in body or (current or {}).get("query_sql"):
        try:
            query_sql = external.check_sql(str(body.get("sql") if "sql" in body else (current or {}).get("query_sql") or ""))
        except external.ExternalError as exc:
            errors["sql"] = str(exc)
    source = "query" if query_sql or "sql" in body else str(body.get("source") or (current or {}).get("source_name") or "").strip()
    if source != "query" and not external.IDENT.match(source):
        errors["source"] = "A table or view named with letters, digits and underscores."
    joins = [] if source == "query" else _joins_body(body.get("joins") if "joins" in body else (current or {}).get("joins"), errors)
    aliases = {"t0", *(j["alias"] for j in joins)}
    raw = body.get("fields") if "fields" in body else (current or {}).get("fields")
    fields, keys = [], set()
    if not isinstance(raw, list) or not raw:
        errors["fields"] = "Keep at least one column."
    elif len(raw) > MAX_FIELDS:
        errors["fields"] = f"A dataset has {MAX_FIELDS} fields at most."
    else:
        calculated = []
        for i, item in enumerate(raw):
            at = f"fields[{i}]"
            if not isinstance(item, dict):
                errors[at] = "A field names a column and a label."; continue
            if item.get("formula") is not None:
                calculated.append((at, item)); continue                  # resolved once every column field is known
            column = str(item.get("column") or "").strip()
            if not external.IDENT.match(column):
                errors[f"{at}.column"] = "A column named with letters, digits and underscores."; continue
            table = str(item.get("table") or "t0")
            if table not in aliases:
                errors[f"{at}.table"] = "The field's table is the base or one of the joins."; continue
            flabel = " ".join(str(item.get("label") or column).split())[:100]
            fkey = (slugify(flabel).replace("-", "_") or column.lower())[:60]
            if not re.match(r"^[a-z][a-z0-9_]*$", fkey):
                fkey = re.sub(r"[^a-z0-9_]", "_", column.lower())[:60] or f"f{i}"
            if fkey in keys:
                errors[f"{at}.label"] = "Two fields have the same name."; continue
            keys.add(fkey)
            type_ = str(item.get("type") or "string")
            role = str(item.get("role") or "dimension")
            aggregates = [a for a in (item.get("aggregates") or []) if a in AGGREGATES] if role == "measure" else []
            format_ = item.get("format") if item.get("format") in FORMATS else None
            sensitivity = str(item.get("sensitivity") or "NORMAL").upper()
            if type_ not in TYPES:
                errors[f"{at}.type"] = "Text, Number, Date, Date and time or Yes/No."
            if role not in ("dimension", "measure"):
                errors[f"{at}.role"] = "Dimension or Measure."
            if role == "measure" and type_ != "number":
                errors[f"{at}.role"] = "Only a number can be a measure."
            if role == "measure" and not aggregates:
                errors[f"{at}.aggregates"] = "Pick at least one calculation."
            if sensitivity not in SENSITIVITIES:
                errors[f"{at}.sensitivity"] = "Normal, Personal or Confidential."
            fields.append({"key": fkey, "label": flabel, "column": column, **({"table": table} if joins or source == "query" else {}), "type": type_, "role": role, "aggregates": aggregates, "format": format_, "sensitivity": sensitivity})
        for at, item in calculated:
            flabel = " ".join(str(item.get("label") or "").split())[:100]
            if not flabel:
                errors[f"{at}.label"] = "Name the calculated measure."; continue
            fkey = (slugify(flabel).replace("-", "_") or "calculated")[:60]
            if not re.match(r"^[a-z][a-z0-9_]*$", fkey):
                fkey = "c_" + re.sub(r"[^a-z0-9_]", "_", fkey)[:58]
            if fkey in keys:
                errors[f"{at}.label"] = "Two fields have the same name."; continue
            formula = _formula_body(item["formula"], fields, errors, at)
            if formula is None:
                continue
            format_ = item.get("format") if item.get("format") in FORMATS else None
            sensitivity = str(item.get("sensitivity") or "NORMAL").upper()
            if sensitivity not in SENSITIVITIES:
                errors[f"{at}.sensitivity"] = "Normal, Personal or Confidential."; continue
            keys.add(fkey)
            fields.append({"key": fkey, "label": flabel, "column": None, "formula": formula, "type": "number", "role": "measure", "aggregates": [catalog.CALC], "format": format_, "sensitivity": sensitivity})
    primary_key = str(body.get("primary_key") or "").strip() or None if "primary_key" in body else (current or {}).get("primary_key")
    time_field = str(body.get("time_field") or "").strip() or None if "time_field" in body else (current or {}).get("time_field")
    if primary_key and primary_key not in keys:
        errors["primary_key"] = "The row key is one of the fields."
    if time_field and not any(f["key"] == time_field and f["type"] in ("date", "datetime") for f in fields):
        errors["time_field"] = "The time field is a date field."
    if errors:
        raise ValidationError(errors)
    return {"label": label, "description": description, "source_name": source, "fields": fields, "joins": joins, "query_sql": query_sql, "primary_key": primary_key, "time_field": time_field}


def _formula_body(raw, fields: list[dict], errors: dict, at: str) -> dict | None:
    """A calculated measure's formula from the request, each side a field of this dataset named by its column (and table) or
    its key, or a number; checked against the fields as the catalogue would."""
    if not isinstance(raw, dict):
        errors[f"{at}.formula"] = "A formula is a ratio, a difference, a sum or a product of two sides."; return None
    out = {"op": raw.get("op")}

    def side(part):
        if not isinstance(part, dict):
            return {}
        if "value" in part and "field" not in part and "column" not in part:
            return {"value": part["value"]}
        found = None
        if part.get("column"):
            found = next((f for f in fields if f.get("column") == part["column"] and (not part.get("table") or (f.get("table") or "t0") == part["table"])), None)
        elif part.get("field"):
            found = next((f for f in fields if f["key"] == part["field"]), None)
        return {"field": found["key"] if found else "?", "aggregate": part.get("aggregate")}

    out["left"], out["right"] = side(raw.get("left")), side(raw.get("right"))
    if raw.get("scale") not in (None, 1, "", "1"):
        try:
            out["scale"] = float(raw["scale"])
        except (TypeError, ValueError):
            out["scale"] = raw["scale"]
    message = catalog.formula_error(fields, out)
    if message:
        errors[f"{at}.formula"] = message; return None
    return out


def _fields_from_columns(columns: list[dict]) -> list[dict]:
    """the fields a query's result gives by default: every mappable column, labelled from its name, typed from its values"""
    def words(name: str) -> str:
        return " ".join(part.capitalize() for part in re.split(r"[_\s]+", name) if part)
    return [{"column": c["column"], "label": words(c["column"]), "type": c["type"], "role": c["role"], "aggregates": c["aggregates"], "format": c["format"], "sensitivity": "NORMAL", "table": "t0"}
            for c in columns if c.get("mappable")]


def _joins_body(raw, errors: dict) -> list[dict]:
    """[{alias, table, type, to, on: [[a, b], ...]}], aliases t1.. in order, each joined to the base or an earlier join"""
    if raw in (None, []):
        return []
    if not isinstance(raw, list):
        errors["joins"] = "Joins are a list."; return []
    if len(raw) > MAX_JOINS:
        errors["joins"] = f"A dataset has {MAX_JOINS} joins at most."; return []
    out, known = [], {"t0"}
    for i, item in enumerate(raw):
        at = f"joins[{i}]"
        if not isinstance(item, dict):
            errors[at] = "A join names a table, a type and its keys."; continue
        alias = f"t{i + 1}"
        table = str(item.get("table") or "").strip()
        kind = str(item.get("type") or "left").lower()
        to = str(item.get("to") or "t0")
        on = item.get("on")
        if not external.IDENT.match(table):
            errors[f"{at}.table"] = "A table named with letters, digits and underscores."
        if kind not in JOIN_TYPES:
            errors[f"{at}.type"] = "Left or Inner."
        if to not in known:
            errors[f"{at}.to"] = "Join to the base or to an earlier join."
        pairs = []
        if not isinstance(on, list) or not on:
            errors[f"{at}.on"] = "Give at least one pair of key columns."
        else:
            for pair in on[:4]:
                if not (isinstance(pair, (list, tuple)) and len(pair) == 2 and all(isinstance(p, str) and external.IDENT.match(p) for p in pair)):
                    errors[f"{at}.on"] = "Each key is a column of the table joined to and a column of the table."; break
                pairs.append([pair[0], pair[1]])
        known.add(alias)
        out.append({"alias": alias, "table": table, "type": kind, "to": to, "on": pairs})
    return out


# ---------------------------------------------------------------------------------------------------- the API
class DatabasesView(APIView):
    permission_classes = ADMIN

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant = _tenant()
        if not _present():
            return Response({"databases": [], "grant_examples": GRANT_EXAMPLES, "ready": False})
        rows, counts = connections(tenant.pk), _report_counts(tenant.pk)
        by_connection: dict[str, list] = {}
        for d in datasets(tenant.pk):
            by_connection.setdefault(d["connection_id"], []).append(d)
        return Response({"databases": [serialize_connection(r, by_connection.get(r["id"], []), counts) for r in rows], "grant_examples": GRANT_EXAMPLES, "ready": True})

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None):
        tenant = _tenant()
        data = _connection_body(request.data if isinstance(request.data, dict) else {}, None)
        connection_id = str(uuid.uuid4())
        with session.tx():
            _q("""INSERT INTO report_connection (id, tenant_id, name, engine, host, port, database_name, schema_name, username, password_enc, ssl_mode, created_by, updated_by)
                  VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
               [connection_id, str(tenant.pk), data["name"], data["engine"], data["host"], data["port"], data["database_name"], data["schema_name"], data["username"], data["password_enc"], data["ssl_mode"],
                str(request.user.pk), str(request.user.pk)])
        row = connection(tenant.pk, connection_id)
        outcome = external.test(row)
        _record_test(tenant.pk, connection_id, outcome)
        return Response({**serialize_connection(connection(tenant.pk, connection_id), []), "test": outcome}, status=status.HTTP_201_CREATED)


class DatabaseTestView(APIView):
    """An unsaved connection tested (the dialog, before Save), or a saved one by id."""
    permission_classes = ADMIN

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, connection_id=None):
        tenant = _tenant()
        if connection_id:
            row = connection(tenant.pk, connection_id)
            outcome = external.test(row)
            _record_test(tenant.pk, connection_id, outcome)
            return Response({"test": outcome, "database": serialize_connection(connection(tenant.pk, connection_id))})
        body = request.data if isinstance(request.data, dict) else {}
        current = connection(tenant.pk, body["id"]) if body.get("id") else None
        data = _connection_body(body, current)
        return Response({"test": external.test(data)})


class DatabaseView(APIView):
    permission_classes = ADMIN

    @extend_schema(responses={200: None})
    def get(self, request, version=None, connection_id=None):
        tenant = _tenant()
        return Response(serialize_connection(connection(tenant.pk, connection_id), datasets(tenant.pk, connection_id), _report_counts(tenant.pk)))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None, connection_id=None):
        tenant = _tenant()
        current = connection(tenant.pk, connection_id)
        body = request.data if isinstance(request.data, dict) else {}
        if body.get("row_version") is not None and int(body["row_version"]) != current["row_version"]:
            raise Conflict("The database changed since you opened it. Reload and try again.")
        if set(body) <= {"status", "row_version"}:
            new_status = str(body.get("status") or current["status"]).upper()
            if new_status not in ("ACTIVE", "DISABLED"):
                raise ValidationError({"status": "ACTIVE or DISABLED."})
            with session.tx():
                _q("UPDATE report_connection SET status = %s, updated_by = %s, updated_at = now(), row_version = row_version + 1 WHERE tenant_id = %s AND id = %s",
                   [new_status, str(request.user.pk), str(tenant.pk), str(connection_id)])
            invalidate(tenant.pk)
            return Response(serialize_connection(connection(tenant.pk, connection_id), datasets(tenant.pk, connection_id), _report_counts(tenant.pk)))
        data = _connection_body(body, current)
        changed = any(data[k] != current[k] for k in ("engine", "host", "port", "database_name", "schema_name", "username", "ssl_mode")) or bool(body.get("password"))
        with session.tx():
            _q("""UPDATE report_connection SET name = %s, engine = %s, host = %s, port = %s, database_name = %s, schema_name = %s, username = %s, password_enc = %s, ssl_mode = %s,
                         updated_by = %s, updated_at = now(), row_version = row_version + 1 WHERE tenant_id = %s AND id = %s""",
               [data["name"], data["engine"], data["host"], data["port"], data["database_name"], data["schema_name"], data["username"], data["password_enc"], data["ssl_mode"], str(request.user.pk),
                str(tenant.pk), str(connection_id)])
        outcome = external.test(connection(tenant.pk, connection_id)) if changed else None
        if outcome:
            _record_test(tenant.pk, connection_id, outcome)
        invalidate(tenant.pk)
        return Response({**serialize_connection(connection(tenant.pk, connection_id), datasets(tenant.pk, connection_id), _report_counts(tenant.pk)), "test": outcome})

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, connection_id=None):
        tenant = _tenant()
        connection(tenant.pk, connection_id)
        mapped = datasets(tenant.pk, connection_id)
        if mapped:
            raise Conflict(f"Remove its {len(mapped)} dataset{'' if len(mapped) == 1 else 's'} first: reports are built on them.")
        with session.tx():
            _q("DELETE FROM report_connection WHERE tenant_id = %s AND id = %s", [str(tenant.pk), str(connection_id)])
        invalidate(tenant.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SourcesView(APIView):
    permission_classes = BUILDER

    @extend_schema(responses={200: None})
    def get(self, request, version=None, connection_id=None, source=None):
        tenant = _tenant()
        row = connection(tenant.pk, connection_id)
        _usable(row)
        mapped = {d["source_name"]: d for d in datasets(tenant.pk, connection_id)}
        try:
            if source:
                cols = external.columns(row, source)
                names = [c["column"] for c in cols if c["mappable"]][:40]
                rows = external.sample(row, source, names, limit=5, zone=reports.zone_of(tenant).key) if names else []
                return Response({"source": source, "columns": cols, "sample": {"columns": names, "rows": [[_json_safe(v) for v in r] for r in rows]},
                                 "mapped_as": serialize_dataset(mapped[source]) if source in mapped else None})
            items = external.sources(row)
        except external.ExternalError as exc:
            raise Conflict(str(exc)) from None
        return Response({"sources": [{**s, "mapped_as": mapped[s["name"]]["label"] if s["name"] in mapped else None} for s in items]})


def _json_safe(value):
    from datetime import date, datetime
    from decimal import Decimal
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", "replace")
    return value


class PreviewView(APIView):
    """The first rows of a mapping as it is being made, with the labels applied."""
    permission_classes = ADMIN

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, connection_id=None):
        tenant = _tenant()
        row = connection(tenant.pk, connection_id)
        _usable(row)
        data = _dataset_body(request.data if isinstance(request.data, dict) else {}, None)
        shown = [f for f in data["fields"] if f.get("column")]           # a calculated measure has no column to sample; it shows once the dataset runs
        if not shown:
            raise ValidationError({"fields": "Keep at least one column."})
        try:
            names = [(f.get("table") or "t0", f["column"]) for f in shown] if data["joins"] else [f["column"] for f in shown]
            rows = external.sample(row, data["source_name"], names, limit=5, zone=reports.zone_of(tenant).key, joins=data["joins"] or None)
        except external.ExternalError as exc:
            raise Conflict(str(exc)) from None
        except RuntimeError as exc:
            raise Conflict(f"The preview did not run: {exc}") from None
        pii = {i for i, f in enumerate(shown) if f["sensitivity"] == "PII"}
        hidden = {i for i, f in enumerate(shown) if f["sensitivity"] == "CONFIDENTIAL"}
        keep = [i for i in range(len(shown)) if i not in hidden]
        return Response({"columns": [{"key": shown[i]["key"], "label": shown[i]["label"], "type": shown[i]["type"], "format": shown[i]["format"], "masked": i in pii} for i in keep],
                         "rows": [["•••••" if i in pii and r[i] is not None else _json_safe(r[i]) for i in keep] for r in rows]})


class QueryTargetsView(APIView):
    """The databases a report author may query: the usable ones, by name; nothing of the account."""
    permission_classes = BUILDER

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant = _tenant()
        if not _present():
            return Response({"databases": []})
        rows = [r for r in connections(tenant.pk) if r["status"] == "ACTIVE" and r["password_enc"] and r["read_only"] is not False]
        return Response({"databases": [{"id": r["id"], "name": r["name"], "engine": r["engine"], "engine_name": external.ENGINES.get(r["engine"], r["engine"]), "database_name": r["database_name"],
                                        "schema_name": r["schema_name"]} for r in rows]})


class QueryRunView(APIView):
    """The query window's Run."""
    permission_classes = BUILDER

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, connection_id=None):
        tenant = _tenant()
        row = connection(tenant.pk, connection_id)
        _usable(row)
        body = request.data if isinstance(request.data, dict) else {}
        sql = str(body.get("sql") or "")
        if len(sql) > 20_000:
            raise ValidationError({"sql": "A query of up to 20,000 characters."})
        limits = catalog.engine_of(tenant.pk)["limits"]
        try:
            out = external.run_sql(row, sql, limit=min(int(body.get("limit") or external.QUERY_ROWS), limits["preview_rows"]), timeout_ms=limits["statement_timeout_ms"], zone=reports.zone_of(tenant).key)
        except external.ExternalError as exc:
            raise ValidationError({"sql": str(exc)}) from None
        return Response({**out, "rows": [[_json_safe(v) for v in r] for r in out["rows"]], "fields": _fields_from_columns(out["columns"])})


class QueryWriteView(APIView):
    """Write It for Me: SQL from the AI assistant, put in the window and never run by itself."""
    permission_classes = BUILDER

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, connection_id=None):
        from apps.insights import assistant
        tenant = _tenant()
        row = connection(tenant.pk, connection_id)
        _usable(row)
        body = request.data if isinstance(request.data, dict) else {}
        prompt = " ".join(str(body.get("prompt") or "").split())
        if not prompt or len(prompt) > assistant.PROMPT_MAX:
            raise ValidationError({"prompt": f"Say what the query should give, in up to {assistant.PROMPT_MAX} characters."})
        try:
            schema = external.sources(row)
        except external.ExternalError as exc:
            raise Conflict(str(exc)) from None
        wanted = [s["name"] for s in schema if s["mappable"]][:60]
        described = []
        for name in wanted:
            try:
                cols = external.columns(row, name)
            except external.ExternalError:
                continue
            described.append(f"- {name}: " + ", ".join(f"{c['column']} {c['column_type']}" for c in cols[:60]))
        try:
            out = assistant.write_sql(tenant, request, prompt, str(body.get("model") or ""), dialect_name=external.ENGINES.get(row["engine"], row["engine"]), schema_text="\n".join(described))
        except assistant.AssistantError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(out)


class QueryDatasetView(APIView):
    """A dataset from the query: its fields from the result when none are given (New Report's Create Report), else as mapped."""
    permission_classes = BUILDER

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None, connection_id=None):
        tenant = _tenant()
        row = connection(tenant.pk, connection_id)
        _usable(row)
        body = dict(request.data) if isinstance(request.data, dict) else {}
        if not body.get("fields"):
            try:
                out = external.run_sql(row, str(body.get("sql") or ""), limit=20, timeout_ms=catalog.engine_of(tenant.pk)["limits"]["statement_timeout_ms"], zone=reports.zone_of(tenant).key)
            except external.ExternalError as exc:
                raise ValidationError({"sql": str(exc)}) from None
            body["fields"] = _fields_from_columns(out["columns"])
            if not body["fields"]:
                raise ValidationError({"sql": "The query gives no column that can be a field: name each column with letters, digits and underscores (AS total_sales)."})
        data = _dataset_body({**body, "sql": str(body.get("sql") or "")}, None)
        dataset_id, key = str(uuid.uuid4()), _unique_key(tenant.pk, data["label"], None)
        with session.tx():
            _q("""INSERT INTO report_dataset_custom (id, tenant_id, connection_id, key, label, description, source_name, primary_key, time_field, fields, joins, query_sql, created_by, updated_by)
                  VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
               [dataset_id, str(tenant.pk), str(connection_id), key, data["label"], data["description"], "query", data["primary_key"], data["time_field"], json.dumps(data["fields"]),
                "[]", data["query_sql"], str(request.user.pk), str(request.user.pk)])
        invalidate(tenant.pk)
        return Response(serialize_dataset(next(d for d in datasets(tenant.pk, connection_id) if d["id"] == dataset_id)), status=status.HTTP_201_CREATED)


class JoinCheckView(APIView):
    """What the last join in the list does to the rows, before it is added."""
    permission_classes = ADMIN

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, connection_id=None):
        tenant = _tenant()
        row = connection(tenant.pk, connection_id)
        _usable(row)
        body = request.data if isinstance(request.data, dict) else {}
        errors: dict = {}
        source = str(body.get("source") or "").strip()
        if not external.IDENT.match(source):
            errors["source"] = "A table or view named with letters, digits and underscores."
        joins = _joins_body(body.get("joins"), errors)
        if not joins and "joins" not in errors:
            errors["joins"] = "Give the join to check."
        if errors:
            raise ValidationError(errors)
        try:
            return Response(external.join_check(row, source, joins, zone=reports.zone_of(tenant).key))
        except external.ExternalError as exc:
            raise Conflict(str(exc)) from None
        except RuntimeError as exc:
            raise Conflict(f"The join could not be checked: {exc}") from None


class DatasetsView(APIView):
    permission_classes = ADMIN

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None, connection_id=None):
        tenant = _tenant()
        row = connection(tenant.pk, connection_id)
        _usable(row)
        data = _dataset_body(request.data if isinstance(request.data, dict) else {}, None)
        dataset_id, key = str(uuid.uuid4()), _unique_key(tenant.pk, data["label"], None)
        with session.tx():
            _q("""INSERT INTO report_dataset_custom (id, tenant_id, connection_id, key, label, description, source_name, primary_key, time_field, fields, joins, query_sql, created_by, updated_by)
                  VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
               [dataset_id, str(tenant.pk), str(connection_id), key, data["label"], data["description"], data["source_name"], data["primary_key"], data["time_field"], json.dumps(data["fields"]),
                json.dumps(data["joins"]), data["query_sql"], str(request.user.pk), str(request.user.pk)])
        invalidate(tenant.pk)
        return Response(serialize_dataset(next(d for d in datasets(tenant.pk, connection_id) if d["id"] == dataset_id)), status=status.HTTP_201_CREATED)


class DatasetView(APIView):
    permission_classes = ADMIN

    def _row(self, tenant_id, dataset_id) -> dict:
        found = [d for d in datasets(tenant_id) if d["id"] == str(dataset_id)]
        if not found:
            raise NotFound("No such dataset.")
        return found[0]

    @extend_schema(responses={200: None})
    def get(self, request, version=None, dataset_id=None):
        tenant = _tenant()
        return Response(serialize_dataset(self._row(tenant.pk, dataset_id), _report_counts(tenant.pk)))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None, dataset_id=None):
        tenant = _tenant()
        current = self._row(tenant.pk, dataset_id)
        body = request.data if isinstance(request.data, dict) else {}
        if body.get("row_version") is not None and int(body["row_version"]) != current["row_version"]:
            raise Conflict("The dataset changed since you opened it. Reload and try again.")
        data = _dataset_body(body, current)
        with session.tx():
            _q("""UPDATE report_dataset_custom SET label = %s, description = %s, source_name = %s, primary_key = %s, time_field = %s, fields = %s, joins = %s, query_sql = %s, updated_by = %s, updated_at = now(),
                         row_version = row_version + 1 WHERE tenant_id = %s AND id = %s""",
               [data["label"], data["description"], data["source_name"], data["primary_key"], data["time_field"], json.dumps(data["fields"]), json.dumps(data["joins"]), data["query_sql"], str(request.user.pk), str(tenant.pk), str(dataset_id)])
        invalidate(tenant.pk)
        return Response(serialize_dataset(self._row(tenant.pk, dataset_id), _report_counts(tenant.pk)))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, dataset_id=None):
        tenant = _tenant()
        current = self._row(tenant.pk, dataset_id)
        used = _report_counts(tenant.pk).get(current["key"], 0)
        if used:
            raise Conflict(f"{used} report{'' if used == 1 else 's'} {'is' if used == 1 else 'are'} built on this dataset. Delete {'it' if used == 1 else 'them'} first.")
        with session.tx():
            _q("DELETE FROM report_dataset_custom WHERE tenant_id = %s AND id = %s", [str(tenant.pk), str(dataset_id)])
        invalidate(tenant.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)
