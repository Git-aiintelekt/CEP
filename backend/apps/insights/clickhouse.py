"""ClickHouse as the second engine (Phase E3): the connection over HTTP, the reporting tables in the shape of the
PostgreSQL reporting views, the loader that copies a workspace's rows into them, and the reconcile that counts both sides.

    settings: CLICKHOUSE_URL (http://host:8123), CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE (cep_reporting)
    configured() -> bool
    query(sql, params, *, timeout_s, readonly=True) -> rows      a SELECT with {name:Type} placeholders, FORMAT JSONCompact
    ensure_schema()                                              the database and the four tables, idempotent
    load(tenant_id, dataset_key, *, recent_days=None) -> rows loaded   from the PostgreSQL view, in the tenant scope
    backfill(tenant_id) -> {dataset: rows}
    reconcile(tenant_id) -> [{"dataset", "postgresql", "clickhouse"}]
The tables are ReplacingMergeTree keyed by the workspace and the dataset's primary key with a load version: a row loaded
again replaces itself; queries read them FINAL. Deletions are not propagated yet.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.db import connections

from apps.delivery.engine import session

TABLES = {
    "messages": {
        "view": "reporting.rpt_messages", "key": ("channel", "message_id"), "recent": "created_at",      # email and text ids come from two tables and can collide
        "columns": [("tenant_id", "UUID"), ("channel", "String"), ("message_id", "String"), ("campaign_id", "Nullable(String)"), ("campaign_name", "Nullable(String)"),
                    ("campaign_type", "Nullable(String)"), ("campaign_code", "Nullable(String)"), ("run_number", "Nullable(Int32)"), ("test_mode", "UInt8"),
                    ("party_id", "Nullable(String)"), ("status", "Nullable(String)"), ("status_reason", "Nullable(String)"), ("submitted_at", "Nullable(DateTime64(3, 'UTC'))"),
                    ("delivered_at", "Nullable(DateTime64(3, 'UTC'))"), ("opened_at", "Nullable(DateTime64(3, 'UTC'))"), ("clicked_at", "Nullable(DateTime64(3, 'UTC'))"),
                    ("bounced_at", "Nullable(DateTime64(3, 'UTC'))"), ("created_at", "DateTime64(3, 'UTC')"), ("sent_n", "Int32"), ("delivered_n", "Int32"), ("opened_n", "Int32"),
                    ("clicked_n", "Int32"), ("bounced_n", "Int32"), ("complained_n", "Int32"), ("failed_n", "Int32")],
    },
    "attributed_orders": {
        "view": "reporting.rpt_attributed_orders", "key": ("order_id",), "recent": "received_at",
        "columns": [("tenant_id", "UUID"), ("order_id", "String"), ("order_ref", "Nullable(String)"), ("kind", "Nullable(String)"), ("source", "Nullable(String)"),
                    ("amount", "Nullable(Float64)"), ("currency", "Nullable(String)"), ("ordered_at", "Nullable(DateTime64(3, 'UTC'))"), ("channel", "Nullable(String)"),
                    ("store_number", "Nullable(String)"), ("status", "Nullable(String)"), ("campaign_id", "Nullable(String)"), ("campaign_name", "Nullable(String)"),
                    ("touch_type", "Nullable(String)"), ("touch_at", "Nullable(DateTime64(3, 'UTC'))"), ("attributed_at", "Nullable(DateTime64(3, 'UTC'))"),
                    ("received_at", "Nullable(DateTime64(3, 'UTC'))"), ("items", "Nullable(String)"), ("attributed_n", "Int32")],
    },
    "contacts": {
        "view": "reporting.rpt_contacts", "key": ("party_id",), "recent": None,
        "columns": [("tenant_id", "UUID"), ("party_id", "String"), ("first_name", "Nullable(String)"), ("last_name", "Nullable(String)"), ("email", "Nullable(String)"),
                    ("phone", "Nullable(String)"), ("source_system", "Nullable(String)"), ("is_synced_copy", "Nullable(UInt8)"), ("synced_at", "Nullable(DateTime64(3, 'UTC'))"),
                    ("city", "Nullable(String)"), ("region", "Nullable(String)"), ("country", "Nullable(String)"), ("list_count", "Int64")],
    },
    "journey_enrollments": {
        "view": "reporting.rpt_journey_enrollments", "key": ("enrollment_id",), "recent": "enrolled_at",
        "columns": [("tenant_id", "UUID"), ("enrollment_id", "String"), ("journey_id", "Nullable(String)"), ("journey_name", "Nullable(String)"), ("journey_code", "Nullable(String)"),
                    ("journey_status", "Nullable(String)"), ("party_id", "Nullable(String)"), ("status", "Nullable(String)"), ("enrolled_at", "Nullable(DateTime64(3, 'UTC'))"),
                    ("exited_at", "Nullable(DateTime64(3, 'UTC'))"), ("exit_reason", "Nullable(String)"), ("converted_at", "Nullable(DateTime64(3, 'UTC'))"),
                    ("attributed_revenue", "Nullable(Float64)"), ("converted_n", "Int32"), ("active_n", "Int32")],
    },
}
BATCH = 5_000


class ClickHouseError(Exception):
    pass


def configured() -> bool:
    return bool(getattr(settings, "CLICKHOUSE_URL", ""))


def database() -> str:
    return getattr(settings, "CLICKHOUSE_DATABASE", "cep_reporting") or "cep_reporting"


def table(dataset_key: str) -> str:
    return f"{database()}.rpt_{dataset_key}"


def _auth_headers() -> dict:
    user = getattr(settings, "CLICKHOUSE_USER", "") or "default"
    password = getattr(settings, "CLICKHOUSE_PASSWORD", "") or ""
    return {"X-ClickHouse-User": user, "X-ClickHouse-Key": password}


def _request(sql: str, *, params: dict | None = None, body: bytes | None = None, settings_: dict | None = None, timeout_s: float = 30) -> bytes:
    """One HTTP call: the query in the URL (so the body can carry rows to insert), parameters as param_* and settings as query arguments."""
    if not configured():
        raise ClickHouseError("ClickHouse is not configured (CLICKHOUSE_URL).")
    query = {"query": sql, **{f"param_{k}": _param_text(v) for k, v in (params or {}).items()}, **{k: str(v) for k, v in (settings_ or {}).items()}}
    url = f"{settings.CLICKHOUSE_URL.rstrip('/')}/?{urllib.parse.urlencode(query)}"
    request = urllib.request.Request(url, data=body, headers={**_auth_headers(), "Content-Type": "application/octet-stream"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout_s + 5) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise ClickHouseError(f"ClickHouse answered {exc.code}: {detail}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ClickHouseError(f"ClickHouse could not be reached: {exc}") from None


def _param_text(value) -> str:
    """How a parameter travels in the URL: lists as ClickHouse array literals, booleans as 0/1, the rest as text."""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join("'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'" if isinstance(v, str) else str(v) for v in value) + "]"
    if value is None:
        return "\\N"
    return str(value)


def query(sql: str, params: dict | None = None, *, timeout_s: float = 15, readonly: bool = True) -> list[list]:
    """A SELECT: rows as lists, in the engine's own types turned into JSON-safe values."""
    raw = _request(sql + " FORMAT JSONCompact", params=params, settings_={"max_execution_time": int(timeout_s), **({"readonly": 1} if readonly else {}), "output_format_json_quote_64bit_integers": 0},
                   timeout_s=timeout_s)
    return json.loads(raw.decode("utf-8"))["data"]


def execute(sql: str, *, timeout_s: float = 60) -> None:
    _request(sql, settings_={"max_execution_time": int(timeout_s)}, timeout_s=timeout_s)


def ensure_schema() -> None:
    execute(f"CREATE DATABASE IF NOT EXISTS {database()}")
    for key, spec in TABLES.items():
        columns = ", ".join(f"{name} {type_}" for name, type_ in spec["columns"]) + ", _version UInt64"
        order = ", ".join(("tenant_id", *spec["key"]))
        execute(f"CREATE TABLE IF NOT EXISTS {table(key)} ({columns}) ENGINE = ReplacingMergeTree(_version) ORDER BY ({order})")


# ---------------------------------------------------------------------------------------------------- the loader
def _cell(value, type_: str = ""):
    """a value as JSONEachRow wants it for the column's type: ids and text as strings whatever PostgreSQL holds, booleans as 0/1"""
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if "String" in type_ or "UUID" in type_:
        return value if isinstance(value, str) else (json.dumps(value) if isinstance(value, (dict, list)) else str(value))
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] if value.tzinfo is None else value.astimezone(__import__("datetime").timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value) if not isinstance(value, (int, float, str)) else value


def load(tenant_id, dataset_key: str, *, recent_days: int | None = None) -> int:
    """Copies the workspace's rows of one dataset from the PostgreSQL view into ClickHouse, in batches. Must run inside
    session.tenant_scope(tenant_id). recent_days: only rows whose recent column is within that many days (the refresh)."""
    spec = TABLES[dataset_key]
    names = [name for name, _ in spec["columns"]]
    types = dict(spec["columns"])
    version = int(time.time())
    where, args = ["tenant_id = %s"], [str(tenant_id)]
    if recent_days and spec["recent"]:
        where.append(f"{spec['recent']} >= now() - make_interval(days => %s)"); args.append(int(recent_days))
    loaded = 0
    with session.tx(), session.connection().cursor() as cursor:           # the workspace setting is transaction-local: no transaction, no rows
        cursor.execute(f"SELECT {', '.join(names)} FROM {spec['view']} WHERE {' AND '.join(where)}", args)
        while True:
            rows = cursor.fetchmany(BATCH)
            if not rows:
                break
            lines = [json.dumps({**{name: _cell(value, types[name]) for name, value in zip(names, row)}, "_version": version}) for row in rows]
            _request(f"INSERT INTO {table(dataset_key)} FORMAT JSONEachRow", body=("\n".join(lines) + "\n").encode("utf-8"), timeout_s=120)
            loaded += len(rows)
    return loaded


def backfill(tenant_id) -> dict:
    ensure_schema()
    return {key: load(tenant_id, key) for key in TABLES}


def refresh(tenant_id, recent_days: int = 7) -> dict:
    """The recent window of every dataset, and contacts whole (they have no load column)."""
    return {key: load(tenant_id, key, recent_days=recent_days if spec["recent"] else None) for key, spec in TABLES.items()}


def reconcile(tenant_id) -> list[dict]:
    """Row counts of every dataset on both engines, in the tenant scope."""
    out = []
    for key, spec in TABLES.items():
        with session.tx(), session.connection().cursor() as cursor:
            cursor.execute(f"SELECT count(*) FROM {spec['view']} WHERE tenant_id = %s", [str(tenant_id)])
            pg = int(cursor.fetchone()[0])
        ch = int(query(f"SELECT count() FROM {table(key)} FINAL WHERE tenant_id = {{t:UUID}}", {"t": str(tenant_id)}, timeout_s=60)[0][0])
        out.append({"dataset": key, "postgresql": pg, "clickhouse": ch})
    return out


def workspaces_on_clickhouse() -> list[str]:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("SELECT tenant_id::text FROM report_engine_setting WHERE engine = 'clickhouse'")
        return [row[0] for row in cursor.fetchall()]
