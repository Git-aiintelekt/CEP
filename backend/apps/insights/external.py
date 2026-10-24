"""A workspace's own databases, MySQL 5.7 and 8.0, PostgreSQL or ClickHouse, read by the report engine and nothing else
(docs/mockups/report-databases.html, docs/mockups/new-report-sources.html): every session is opened read-only with the
workspace's statement time limit and the workspace's time zone; Test Connection reads the server's version, what the account
may read and the account's rights, and an account that could write or change the schema is refused. MySQL through pymysql,
PostgreSQL through psycopg, ClickHouse over its HTTP interface (apps/insights/clickhouse.py's wire, every query with
readonly = 2 where the account lets settings be sent); the password is decrypted here and never leaves the server.

    test(row) -> {"ok", "version", "timezone", "tables", "views", "read_only", "offending", "ms", "error"}
    sources(row) -> [{"name", "kind", "columns", "rows", "mappable"}]      the tables and views the account can read, views first
    columns(row, source) -> [{"column", "column_type", "key", "mappable", "type", "role", "aggregates", "format"}]
    sample(row, source, names, limit, zone) -> rows
    query(row, sql, params, timeout_ms, zone) -> rows                     the runner's path
"""
import json
import re
import ssl
import time

import psycopg
import pymysql

from apps.insights import clickhouse
from apps.platform_ops import crypto

ALLOWED_MYSQL = {"SELECT", "SHOW VIEW", "USAGE"}
ALLOWED_PG = {"SELECT", "REFERENCES"}
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# a database's (or a PostgreSQL schema's) own name may also hold hyphens (txpostalprod-server-7): always quoted when it reaches SQL
DB_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$")
CONNECT_TIMEOUT_S = 15                                              # a server behind a slow firewall takes a while to answer at all
# reading the database's own catalogue (the tables, their columns, the connection test): a big schema on MySQL 5.7 opens every
# table to answer information_schema, so this is longer than a report's limit; samples and join checks read data, so shorter
CATALOG_TIMEOUT_MS = 60_000
SAMPLE_TIMEOUT_MS = 30_000
JOIN_SAMPLE_ROWS = 10_000                                            # a join is checked on the base's first rows, never a whole table
MYSQL_TIMEOUT = 3024                                                # ER_QUERY_TIMEOUT: max_execution_time stopped the statement
NUMERIC = {"tinyint", "smallint", "mediumint", "int", "integer", "bigint", "decimal", "numeric", "float", "double", "real", "double precision", "money"}
ENGINES = {"mysql57": "MySQL 5.7", "mysql80": "MySQL 8.0", "postgresql": "PostgreSQL", "clickhouse": "ClickHouse"}
DEFAULT_PORT = {"mysql57": 3306, "mysql80": 3306, "postgresql": 5432, "clickhouse": 8443}
MAX_EXECUTION_ERROR = 3024
MONEY = re.compile(r"amount|price|sales|revenue|cost|total|fee|paid|value", re.I)
# the query window's guard: words that write, change the schema or the server, or move data out; and functions that read files or wait
FORBIDDEN_WORDS = re.compile(r"\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|call|set|lock|unlock|rename|merge|copy|execute|exec|prepare|handler|load|outfile|dumpfile|into"
                             r"|kill|shutdown|flush|reset|purge|install|uninstall|vacuum|cluster|reindex|listen|notify|refresh|discard|analyze|optimize|repair)\b", re.I)
FORBIDDEN_FUNCTIONS = re.compile(r"\b(load_file|sleep|benchmark|get_lock|release_lock|master_pos_wait|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_terminate_backend"
                                 r"|pg_cancel_backend|pg_reload_conf|dblink\w*|lo_import|lo_export|lo_unlink|xp_cmdshell|sys_eval|sys_exec|set_config|query_to_xml)\s*\(", re.I)
# ClickHouse's table functions that read other servers, files or programs, and the clause that changes a query's limits
CH_FORBIDDEN_FUNCTIONS = re.compile(r"\b(url|urlCluster|file|fileCluster|s3|s3Cluster|gcs|azureBlobStorage|azureBlobStorageCluster|hdfs|hdfsCluster|remote|remoteSecure|cluster"
                                    r"|clusterAllReplicas|mysql|postgresql|jdbc|odbc|sqlite|mongodb|redis|input|executable|deltaLake|hudi|iceberg|sleepEachRow)\s*\(", re.I)
CH_FORBIDDEN_WORDS = re.compile(r"\b(settings)\b", re.I)
ALLOWED_CH = {"SELECT", "SHOW", "SHOW TABLES", "SHOW COLUMNS", "SHOW DATABASES", "SHOW DICTIONARIES", "DICTGET"}
CH_VIEWS = ("View", "MaterializedView", "LiveView", "WindowView")
CH_COMPLEX = ("array", "map", "tuple", "nested", "json", "object", "variant", "dynamic", "aggregatefunction", "simpleaggregatefunction")
CH_READONLY, CH_UNKNOWN_SETTING, CH_TIMEOUT = 164, 115, 159
QUERY_ROWS = 200


class ExternalError(Exception):
    """What went wrong, for the person, never with the password in it."""


def is_pg(row: dict) -> bool:
    return row.get("engine") == "postgresql"


def is_ch(row: dict) -> bool:
    return row.get("engine") == "clickhouse"


def dialect_of(row: dict) -> str:
    """the compiler's dialect for a workspace's own database"""
    return "postgresql" if is_pg(row) else "clickhouse" if is_ch(row) else "mysql"


def schema_of(row: dict) -> str:
    """where the sources live: the schema on PostgreSQL, the database itself on MySQL"""
    return (row.get("schema_name") or "public") if is_pg(row) else row["database_name"]


def quote(name: str, row: dict) -> str:
    assert IDENT.match(name), name
    return f'"{name}"' if is_pg(row) else f"`{name}`"


def quote_schema(name: str, row: dict) -> str:
    """a database or schema name, which may hold hyphens"""
    assert DB_NAME.match(name), name
    return f'"{name}"' if is_pg(row) else f"`{name}`"


def _message(exc: Exception) -> str:
    if isinstance(exc, pymysql.err.OperationalError) and exc.args and isinstance(exc.args[0], int):
        code = exc.args[0]
        detail = str(exc.args[1]) if len(exc.args) > 1 else ""
        if code in (2003, 2005):
            return "The server did not answer: check the host, the port and whether CEP's server may reach it."
        if code == 1045:
            return "The server refused the user and password."
        if code == 1044:
            return "The account cannot use that database."
        if code == 1049:
            return "No database of that name on the server."
        if code in (MYSQL_TIMEOUT, 2013):                               # the server's time limit, or the read timeout behind it
            return "The database took too long to answer and the request was stopped. Try again; a large or busy database answers faster outside working hours."
        return f"The server answered {code}: {detail[:200]}"
    text = str(exc)
    if isinstance(exc, psycopg.OperationalError):
        low = text.lower()
        if "password authentication failed" in low or "no password supplied" in low:
            return "The server refused the user and password."
        if "does not exist" in low and "database" in low:
            return "No database of that name on the server."
        if "timeout" in low or "could not connect" in low or "connection refused" in low or "name or service not known" in low or "could not translate" in low:
            return "The server did not answer: check the host, the port and whether CEP's server may reach it."
        if "ssl" in low:
            return "The server did not accept the SSL setting: " + text.strip()[:160]
    return text.strip()[:300]


# ---------------------------------------------------------------------------------------------------- sessions
def connect(row: dict, *, timeout_ms: int = 15_000, zone: str | None = None):
    """A read-only session with the statement limit and the workspace's zone (on MySQL only when the server has the time-zone
    tables; otherwise the server's zone stands)."""
    password = crypto.decrypt(row["password_enc"]) or ""
    mode = row.get("ssl_mode") or "REQUIRED"
    if is_pg(row):
        options = f"-c default_transaction_read_only=on -c statement_timeout={int(timeout_ms)}" + (f" -c TimeZone={zone}" if zone else "")
        try:
            return psycopg.connect(host=row["host"], port=int(row["port"] or 5432), user=row["username"], password=password, dbname=row["database_name"],
                                   sslmode={"REQUIRED": "require", "PREFERRED": "prefer", "OFF": "disable"}[mode], connect_timeout=CONNECT_TIMEOUT_S, options=options, autocommit=True)
        except psycopg.Error as exc:
            raise ExternalError(_message(exc)) from None
    options = {"host": row["host"], "port": int(row["port"] or 3306), "user": row["username"], "password": password, "database": row["database_name"],
               "connect_timeout": CONNECT_TIMEOUT_S, "read_timeout": max(2, timeout_ms // 1000 + 2), "charset": "utf8mb4", "autocommit": True}
    secure = {"check_hostname": False, "verify_mode": ssl.CERT_NONE}
    try:
        if mode == "OFF":
            conn = pymysql.connect(**options, ssl_disabled=True)
        elif mode == "PREFERRED":
            try:
                conn = pymysql.connect(**options, ssl=secure)
            except pymysql.err.OperationalError:
                conn = pymysql.connect(**options, ssl_disabled=True)
        else:
            conn = pymysql.connect(**options, ssl=secure)
    except (pymysql.err.MySQLError, OSError) as exc:
        raise ExternalError(_message(exc)) from None
    with conn.cursor() as cursor:
        cursor.execute("SET SESSION TRANSACTION READ ONLY")
        for statement, args in (("SET SESSION max_execution_time = %s", [int(timeout_ms)]), ("SET SESSION time_zone = %s", [zone]) if zone else (None, None)):
            if statement:
                try:
                    cursor.execute(statement, args)
                except pymysql.err.MySQLError:
                    pass                                            # an older server, or no time-zone tables: the limit is the client's read timeout
    return conn


def _errors(row: dict):
    return (psycopg.Error,) if is_pg(row) else (pymysql.err.MySQLError,)


# ---------------------------------------------------------------------------------------------------- ClickHouse
def _ch_connection(row: dict) -> clickhouse.Connection:
    scheme = "http" if (row.get("ssl_mode") or "REQUIRED") == "OFF" else "https"
    return clickhouse.Connection(url=f"{scheme}://{row['host']}:{int(row['port'] or DEFAULT_PORT['clickhouse'])}", user=row["username"],
                                 password=crypto.decrypt(row["password_enc"]) or "", database=row["database_name"])


def _ch_code(exc: Exception) -> int | None:
    found = re.search(r"Code: (\d+)", str(exc))
    return int(found.group(1)) if found else None


def _ch_message(exc: Exception) -> str:
    code, text = _ch_code(exc), str(exc)
    if code in (192, 193, 516):
        return "The server refused the user and password."
    if code == 81:
        return "No database of that name on the server."
    if code == 60:
        return "No table or view of that name, or the account cannot read it."
    if code == 497:
        return "The account may not read that: " + (re.search(r"DB::Exception: (.+?)(?: \(ACCESS_DENIED\)|$)", text) or re.match(r"(.*)", text)).group(1)[:200]
    if "could not be reached" in text:
        if "CERTIFICATE_VERIFY_FAILED" in text or "SSL" in text:
            return "The server's HTTPS certificate was not accepted. Use a certificate the server's name matches, or switch encryption off on a private network."
        return "The server did not answer: check the host, the HTTP port (8443 with HTTPS, 8123 without) and whether C360's server may reach it."
    found = re.search(r"DB::Exception: (.+?)(?: \([A-Z_]+\))?(?: \(version|$)", text)
    return ("The server answered: " + found.group(1).strip())[:300] if found else text.strip()[:300]


def _ch(row: dict, sql: str, params: dict | None = None, *, timeout_ms: int = 15_000, zone: str | None = None, plain: bool = False) -> dict:
    """One query over HTTP, FORMAT JSONCompact: {"meta": [{name, type}], "data": rows}. Read-only (readonly = 2), the time limit, LEFT JOIN
    with NULLs and the workspace's zone go as settings; an account whose profile is already read-only (readonly = 1) refuses every setting,
    so the query is sent again with fewer, and an older server without session_timezone without that one. plain: no settings at all."""
    timeout_s = max(1, int(timeout_ms) // 1000)
    settings_ = {} if plain else {"readonly": 2, "max_execution_time": timeout_s, "join_use_nulls": 1, "output_format_json_quote_64bit_integers": 0, **({"session_timezone": zone} if zone else {})}
    conn = _ch_connection(row)
    while True:
        try:
            raw = clickhouse._request(f"{sql} FORMAT JSONCompact", conn, params=params, settings_={**settings_, "database": row["database_name"]}, timeout_s=timeout_s)
            return json.loads(raw.decode("utf-8"))
        except clickhouse.ClickHouseError as exc:
            code = _ch_code(exc)
            if code == CH_UNKNOWN_SETTING and "session_timezone" in settings_:
                settings_.pop("session_timezone")
                continue
            if code == CH_READONLY and settings_:
                settings_ = {k: v for k, v in settings_.items() if k != "readonly"} if "readonly" in settings_ else {}
                continue
            raise


def _ch_type(column_type: str) -> str:
    """a ClickHouse column type as the catalogue's typing reads it: wrappers removed, then bigint, double, decimal, date, datetime,
    boolean, complex (arrays, maps, tuples, JSON: not mappable) or varchar"""
    t = column_type.strip()
    while True:
        found = re.match(r"^(Nullable|LowCardinality)\((.*)\)$", t)
        if not found:
            break
        t = found.group(2).strip()
    low = t.lower()
    if low == "bool":
        return "boolean"
    if re.match(r"^u?int\d+$", low):
        return "bigint"
    if low.startswith("float"):
        return "double"
    if low.startswith("decimal"):
        return "decimal"
    if low in ("date", "date32"):
        return "date"
    if low.startswith("datetime"):
        return "datetime"
    if low.startswith(CH_COMPLEX):
        return "complex"
    return "varchar"


def _ch_grants(lines: list[str]) -> list[str]:
    """SHOW GRANTS read: what the account holds beyond reading"""
    offending = []
    for line in lines:
        match = re.match(r"GRANT (.+?) ON (.+?) TO ", line, re.I)
        if not match:
            if line.upper().startswith("GRANT ") and " ON " not in line.upper():
                offending.append("a role: " + line[6:].split(" TO ")[0].strip())
            continue
        privileges = [re.sub(r"\s*\(.*\)$", "", p.strip()).upper() for p in re.split(r",\s*(?![^()]*\))", match.group(1))]
        bad = [p for p in privileges if p not in ALLOWED_CH]
        if bad:
            offending.append(f"{', '.join(bad)} on {match.group(2)}")
        if re.search(r"WITH GRANT OPTION", line, re.I):
            offending.append(f"GRANT OPTION on {match.group(2)}")
    return offending


def _ch_test(row: dict) -> dict:
    """the version, the zone, the tables and views, and the rights: an account whose profile is read-only (readonly >= 1) cannot write
    whatever it was granted; otherwise it may hold nothing beyond SELECT and SHOW"""
    started = time.monotonic()
    try:
        version, zone, readonly = _ch(row, "SELECT version(), timezone(), toUInt8(getSetting('readonly'))", plain=True, timeout_ms=CATALOG_TIMEOUT_MS)["data"][0]
        counts = {bool(is_view): int(n) for is_view, n in _ch(row, f"SELECT engine IN {CH_VIEWS!r} AS is_view, count() FROM system.tables WHERE database = {{db:String}} GROUP BY is_view",
                                                                {"db": row["database_name"]}, timeout_ms=CATALOG_TIMEOUT_MS)["data"]}
        offending = [] if int(readonly) >= 1 else _ch_grants([str(r[0]) for r in _ch(row, "SHOW GRANTS", plain=True, timeout_ms=CATALOG_TIMEOUT_MS)["data"]])
    except clickhouse.ClickHouseError as exc:
        return {"ok": False, "error": _ch_message(exc), "ms": int((time.monotonic() - started) * 1000)}
    return {"ok": True, "version": str(version), "timezone": str(zone), "tables": counts.get(False, 0), "views": counts.get(True, 0), "read_only": not offending,
            "offending": offending, "ms": int((time.monotonic() - started) * 1000), "error": None}


def _ch_sources(row: dict) -> list[dict]:
    db = {"db": row["database_name"]}
    try:
        tables = _ch(row, "SELECT name, engine, total_rows FROM system.tables WHERE database = {db:String} AND NOT is_temporary ORDER BY name", db, timeout_ms=CATALOG_TIMEOUT_MS)["data"]
        counts = dict(_ch(row, "SELECT table, count() FROM system.columns WHERE database = {db:String} GROUP BY table", db, timeout_ms=CATALOG_TIMEOUT_MS)["data"])
    except clickhouse.ClickHouseError as exc:
        raise ExternalError(_ch_message(exc)) from None
    out = [{"name": name, "kind": "view" if engine in CH_VIEWS else "table", "rows": int(rows) if rows is not None and engine not in CH_VIEWS else None,
            "columns": int(counts.get(name, 0)), "mappable": bool(IDENT.match(name))} for name, engine, rows in tables]
    return sorted(out, key=lambda s: s["kind"] != "view")


def _ch_columns(row: dict, source: str) -> list[tuple]:
    try:
        found = _ch(row, "SELECT name, type, is_in_primary_key FROM system.columns WHERE database = {db:String} AND table = {t:String} ORDER BY position",
                    {"db": row["database_name"], "t": source}, timeout_ms=CATALOG_TIMEOUT_MS)["data"]
    except clickhouse.ClickHouseError as exc:
        raise ExternalError(_ch_message(exc)) from None
    return [(name, _ch_type(type_), type_, "PRI" if key else "") for name, type_, key in found]


def _ch_rows(row: dict, sql: str, params: dict | None, *, timeout_ms: int, zone: str | None) -> list[list]:
    """the runner's path on ClickHouse: rows, or RuntimeError as the other engines raise it"""
    try:
        return _ch(row, sql, params, timeout_ms=timeout_ms, zone=zone)["data"]
    except clickhouse.ClickHouseError as exc:
        if _ch_code(exc) == CH_TIMEOUT:
            raise RuntimeError("statement timeout: the query was stopped by the server's limit") from None
        raise RuntimeError(_ch_message(exc)) from None


# ---------------------------------------------------------------------------------------------------- the account's rights
def _grants(cursor) -> tuple[bool, list[str]]:
    """MySQL, SHOW GRANTS read: True when the account holds nothing beyond SELECT, SHOW VIEW and USAGE; else what it holds too."""
    cursor.execute("SHOW GRANTS FOR CURRENT_USER()")
    offending = []
    for (line,) in cursor.fetchall():
        line = str(line)
        match = re.match(r"GRANT (.+?) ON (.+?) TO ", line, re.I)
        if not match:
            if line.upper().startswith("GRANT ") and " ON " not in line.upper():
                offending.append("a role: " + line[6:].split(" TO ")[0].strip())      # MySQL 8.0 roles cannot be read here
            continue
        privileges = [p.strip().upper() for p in re.split(r",\s*(?![^()]*\))", match.group(1))]
        privileges = [re.sub(r"\s*\(.*\)$", "", p) for p in privileges]
        bad = [p for p in privileges if p not in ALLOWED_MYSQL]
        if bad:
            offending.append(f"{', '.join(bad)} on {match.group(2)}")
        if re.search(r"WITH GRANT OPTION", line, re.I):
            offending.append(f"GRANT OPTION on {match.group(2)}")
    return not offending, offending


def _grants_pg(cursor, schema: str) -> tuple[bool, list[str]]:
    """PostgreSQL: the role's attributes, its table privileges in the schema beyond SELECT, and CREATE on the schema."""
    offending = []
    cursor.execute("SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = current_user")
    found = cursor.fetchone()
    if found:
        for flag, name in zip(found, ("superuser", "can create roles", "can create databases", "bypasses row security")):
            if flag:
                offending.append(name)
    cursor.execute("""SELECT table_name, string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) FROM information_schema.role_table_grants
                       WHERE table_schema = %s AND grantee IN (SELECT rolname FROM pg_roles WHERE pg_has_role(current_user, oid, 'member')) AND privilege_type NOT IN ('SELECT', 'REFERENCES')
                       GROUP BY table_name ORDER BY table_name""", [schema])
    for table, privileges in cursor.fetchall():
        offending.append(f"{privileges} on {schema}.{table}")
    cursor.execute("SELECT has_schema_privilege(current_user, %s, 'CREATE')", [schema])
    if cursor.fetchone()[0]:
        offending.append(f"CREATE on schema {schema}")
    cursor.execute("""SELECT rolname FROM pg_roles WHERE rolname IN ('pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program')
                       AND pg_has_role(current_user, oid, 'member') ORDER BY rolname""")
    offending += [f"member of {name} (reads or runs files on the server)" for (name,) in cursor.fetchall()]
    cursor.execute("SELECT extname FROM pg_extension WHERE extname IN ('dblink', 'postgres_fdw', 'file_fdw', 'adminpack') ORDER BY extname")
    offending += [f"the {name} extension is installed (it reaches past the read-only session)" for (name,) in cursor.fetchall()]
    return not offending, offending


# ---------------------------------------------------------------------------------------------------- what Test Connection proves
def catalog_ms(row: dict) -> int:
    """Reading the database's catalogue: CATALOG_TIMEOUT_MS, or the connection's own time limit when that is longer."""
    from apps.insights import connection_limits
    return max(CATALOG_TIMEOUT_MS, connection_limits.own_timeout_s(row) * 1000)


def test(row: dict) -> dict:
    if is_ch(row):
        return _ch_test(row)
    started = time.monotonic()
    try:
        conn = connect(row, timeout_ms=catalog_ms(row))
    except ExternalError as exc:
        return {"ok": False, "error": str(exc), "ms": int((time.monotonic() - started) * 1000)}
    schema = schema_of(row)
    try:
        with conn.cursor() as cursor:
            if is_pg(row):
                cursor.execute("SELECT version(), current_setting('TimeZone')")
                version, zone = cursor.fetchone()
                version = re.sub(r"^PostgreSQL ([\d.]+).*$", r"\1", str(version))
                cursor.execute("SELECT table_type, count(*) FROM information_schema.tables WHERE table_schema = %s GROUP BY table_type", [schema])
                counts = {kind: int(n) for kind, n in cursor.fetchall()}
                read_only, offending = _grants_pg(cursor, schema)
            else:
                cursor.execute("SELECT VERSION(), @@session.time_zone, @@system_time_zone")
                version, zone, system_zone = cursor.fetchone()
                zone = system_zone if zone == "SYSTEM" else zone
                cursor.execute("SHOW FULL TABLES FROM `" + schema.replace("`", "``") + "`")             # names and kinds only: no table is opened
                counts = {}
                for _name, kind in cursor.fetchall():
                    counts[kind] = counts.get(kind, 0) + 1
                read_only, offending = _grants(cursor)
    except _errors(row) as exc:
        return {"ok": False, "error": _message(exc), "ms": int((time.monotonic() - started) * 1000)}
    finally:
        conn.close()
    return {"ok": True, "version": str(version), "timezone": str(zone), "tables": counts.get("BASE TABLE", 0), "views": counts.get("VIEW", 0),
            "read_only": read_only, "offending": offending, "ms": int((time.monotonic() - started) * 1000), "error": None}


# ---------------------------------------------------------------------------------------------------- what can be mapped
def sources(row: dict) -> list[dict]:
    if is_ch(row):
        return _ch_sources(row)
    conn = connect(row, timeout_ms=catalog_ms(row))
    schema = schema_of(row)
    try:
        with conn.cursor() as cursor:
            if is_pg(row):
                cursor.execute("""SELECT t.table_name, t.table_type, c.reltuples::bigint,
                                         (SELECT count(*) FROM information_schema.columns k WHERE k.table_schema = t.table_schema AND k.table_name = t.table_name)
                                    FROM information_schema.tables t
                                    LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.table_schema)
                                   WHERE t.table_schema = %s AND has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'SELECT')
                                   ORDER BY t.table_type DESC, t.table_name""", [schema])
            else:
                return _mysql_sources(conn, cursor, row, schema)
            out = [{"name": name, "kind": "view" if kind == "VIEW" else "table", "rows": int(rows) if rows is not None and kind != "VIEW" and int(rows) >= 0 else None,
                    "columns": int(cols), "mappable": bool(IDENT.match(name))} for name, kind, rows, cols in cursor.fetchall()]
    except _errors(row) as exc:
        raise ExternalError(_message(exc)) from None
    finally:
        conn.close()
    return out


def _mysql_sources(conn, cursor, row: dict, schema: str) -> list[dict]:
    """The tables and views by name and kind alone: SHOW FULL TABLES reads only the directory and opens no table, so a database of
    1,000+ tables answers in milliseconds (counting rows or columns makes MySQL 5.7 open every one). A table's row estimate and
    columns are read when it is chosen (table_rows, columns)."""
    cursor.execute("SHOW FULL TABLES FROM `" + schema.replace("`", "``") + "`")
    listed = sorted(cursor.fetchall(), key=lambda pair: (pair[1] != "VIEW", pair[0]))
    return [{"name": name, "kind": "view" if kind == "VIEW" else "table", "rows": None, "columns": None, "mappable": bool(IDENT.match(name))} for name, kind in listed]


def table_rows(row: dict, source: str) -> int | None:
    """One table's row estimate from the catalogue: MySQL opens that one table, PostgreSQL reads pg_class, ClickHouse system.tables.
    None for a view, or when the server does not say in time: the estimate is a courtesy, never needed."""
    if not IDENT.match(source):
        return None
    try:
        if is_ch(row):
            data = _ch(row, "SELECT total_rows FROM system.tables WHERE database = {db:String} AND name = {t:String}", {"db": row["database_name"], "t": source},
                       timeout_ms=catalog_ms(row))["data"]
            return int(data[0][0]) if data and data[0][0] is not None else None
        conn = connect(row, timeout_ms=catalog_ms(row))
        try:
            with conn.cursor() as cursor:
                if is_pg(row):
                    cursor.execute("SELECT c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = %s AND c.relname = %s AND c.relkind IN ('r', 'p', 'm')",
                                   [schema_of(row), source])
                else:
                    cursor.execute("SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND TABLE_TYPE = 'BASE TABLE'", [schema_of(row), source])
                found = cursor.fetchone()
        finally:
            conn.close()
    except Exception:                                                  # noqa: BLE001  an estimate the page can do without
        return None
    return int(found[0]) if found and found[0] is not None and int(found[0]) >= 0 else None


SYSTEM_SCHEMAS = {"information_schema", "mysql", "performance_schema", "sys", "pg_catalog", "pg_toast", "system", "INFORMATION_SCHEMA"}


def databases_of(row: dict) -> dict:
    """What Find Databases offers in the connection dialog: the databases the account can see (MySQL, ClickHouse) or the schemas of
    the database (PostgreSQL), by name, with their table counts when the server gives them without opening a table."""
    if is_ch(row):
        names = [str(r[0]) for r in _ch(row, "SHOW DATABASES", plain=True, timeout_ms=catalog_ms(row))["data"]]
        counts = {str(d): int(n) for d, n in _ch(row, "SELECT database, count() FROM system.tables GROUP BY database", plain=True, timeout_ms=catalog_ms(row))["data"]}
        return {"kind": "database", "found": [{"name": n, "tables": counts.get(n)} for n in names if n not in SYSTEM_SCHEMAS]}
    conn = connect(row, timeout_ms=catalog_ms(row))
    try:
        with conn.cursor() as cursor:
            if is_pg(row):
                cursor.execute("""SELECT n.nspname, count(c.oid) FROM pg_namespace n
                                    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'v', 'p', 'm')
                                   WHERE has_schema_privilege(n.nspname, 'USAGE') AND n.nspname NOT LIKE 'pg\\_%%' AND n.nspname <> 'information_schema'
                                   GROUP BY n.nspname ORDER BY n.nspname""")
                return {"kind": "schema", "found": [{"name": name, "tables": int(n)} for name, n in cursor.fetchall()]}
            cursor.execute("SHOW DATABASES")
            names = [str(r[0]) for r in cursor.fetchall() if str(r[0]) not in SYSTEM_SCHEMAS]
            counts = {}
            try:                                                           # names only from TABLES: no table is opened
                cursor.execute("SELECT TABLE_SCHEMA, count(*) FROM information_schema.TABLES GROUP BY TABLE_SCHEMA")
                counts = {str(s): int(n) for s, n in cursor.fetchall()}
            except _errors(row):
                pass
            return {"kind": "database", "found": [{"name": n, "tables": counts.get(n)} for n in names]}
    except _errors(row) as exc:
        raise ExternalError(_message(exc)) from None
    finally:
        conn.close()


def _typed(data_type: str, column_type: str, name: str) -> dict:
    """a column's catalogue type, role, calculations and format, from its declared type and its name"""
    data_type, column_type = data_type.lower(), column_type.lower()
    if column_type in ("tinyint(1)", "bit(1)") or data_type in ("bool", "boolean"):
        return {"type": "boolean", "role": "dimension", "aggregates": [], "format": None}
    if data_type in NUMERIC:
        decimal = data_type in ("decimal", "numeric", "float", "double", "real", "double precision", "money")
        if name.lower() == "id" or name.lower().endswith(("_id", "_no", "_code")):
            return {"type": "number", "role": "dimension", "aggregates": [], "format": "decimal" if decimal else "integer"}
        return {"type": "number", "role": "measure", "aggregates": ["sum", "avg", "min", "max"], "format": "money" if decimal and MONEY.search(name) else "decimal" if decimal else "integer"}
    if data_type == "date":
        return {"type": "date", "role": "dimension", "aggregates": [], "format": "date"}
    if data_type in ("datetime", "timestamp") or data_type.startswith("timestamp"):
        return {"type": "datetime", "role": "dimension", "aggregates": [], "format": "datetime"}
    return {"type": "string", "role": "dimension", "aggregates": [], "format": None}


def columns(row: dict, source: str) -> list[dict]:
    if not IDENT.match(source):
        raise ExternalError("Only a table or view named with letters, digits and underscores can be mapped.")
    if is_ch(row):
        rows = _ch_columns(row, source)
        if not rows:
            raise ExternalError("No table or view of that name, or the account cannot read it.")
        return [{"column": name, "column_type": column_type, "key": column_key == "PRI", "mappable": bool(IDENT.match(name)) and data_type != "complex", **_typed(data_type, column_type, name)}
                for name, data_type, column_type, column_key in rows]
    conn = connect(row, timeout_ms=catalog_ms(row))
    schema = schema_of(row)
    try:
        with conn.cursor() as cursor:
            if is_pg(row):
                cursor.execute("""SELECT c.column_name, c.data_type, c.data_type, EXISTS (
                                         SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints tc ON tc.constraint_name = k.constraint_name AND tc.constraint_schema = k.constraint_schema
                                          WHERE tc.constraint_type = 'PRIMARY KEY' AND k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = c.column_name)
                                    FROM information_schema.columns c WHERE c.table_schema = %s AND c.table_name = %s ORDER BY c.ordinal_position""", [schema, source])
                rows = [(name, data_type, column_type, "PRI" if key else "") for name, data_type, column_type, key in cursor.fetchall()]
            else:
                cursor.execute("""SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, COLUMN_KEY FROM information_schema.COLUMNS
                                   WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s ORDER BY ORDINAL_POSITION""", [schema, source])
                rows = cursor.fetchall()
    except _errors(row) as exc:
        raise ExternalError(_message(exc)) from None
    finally:
        conn.close()
    if not rows:
        raise ExternalError("No table or view of that name, or the account cannot read it.")
    return [{"column": name, "column_type": column_type, "key": column_key == "PRI", "mappable": bool(IDENT.match(name)), **_typed(data_type, column_type, name)} for name, data_type, column_type, column_key in rows]


def columns_of(row: dict, sources: list[str]) -> dict[str, list[dict]]:
    """The columns of several tables in one statement (Ask for a Report on tables not mapped yet), by table; a name the account
    cannot read is left out. Each column as columns() gives it."""
    names = [s for s in dict.fromkeys(sources) if IDENT.match(s)]
    if not names:
        return {}
    if is_ch(row):
        return {name: found for name in names if (found := _ch_columns_or_none(row, name))}
    conn = connect(row, timeout_ms=catalog_ms(row))
    schema = schema_of(row)
    marks = ", ".join(["%s"] * len(names))
    try:
        with conn.cursor() as cursor:
            if is_pg(row):
                cursor.execute(f"""SELECT c.table_name, c.column_name, c.data_type, c.data_type, EXISTS (
                                          SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints tc ON tc.constraint_name = k.constraint_name AND tc.constraint_schema = k.constraint_schema
                                           WHERE tc.constraint_type = 'PRIMARY KEY' AND k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = c.column_name)
                                     FROM information_schema.columns c WHERE c.table_schema = %s AND c.table_name IN ({marks}) ORDER BY c.table_name, c.ordinal_position""", [schema, *names])
                rows = [(table, name, data_type, column_type, "PRI" if key else "") for table, name, data_type, column_type, key in cursor.fetchall()]
            else:
                cursor.execute(f"""SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, COLUMN_KEY FROM information_schema.COLUMNS
                                    WHERE TABLE_SCHEMA = %s AND TABLE_NAME IN ({marks}) ORDER BY TABLE_NAME, ORDINAL_POSITION""", [schema, *names])
                rows = cursor.fetchall()
    except _errors(row) as exc:
        raise ExternalError(_message(exc)) from None
    finally:
        conn.close()
    out: dict[str, list[dict]] = {}
    for table, name, data_type, column_type, column_key in rows:
        out.setdefault(str(table), []).append({"column": name, "column_type": column_type, "key": column_key == "PRI", "mappable": bool(IDENT.match(name)), **_typed(data_type, column_type, name)})
    return out


def _ch_columns_or_none(row: dict, source: str) -> list[dict] | None:
    found = _ch_columns(row, source)
    return [{"column": name, "column_type": column_type, "key": column_key == "PRI", "mappable": bool(IDENT.match(name)) and data_type != "complex", **_typed(data_type, column_type, name)}
            for name, data_type, column_type, column_key in found] or None


def _from(row: dict, source: str, joins: list[dict] | None) -> str:
    """the FROM for a sample or a check: the base alone, or the base as t0 with its joins (compiler.join_clause)"""
    from apps.insights import compiler
    schema = schema_of(row)
    if not joins:
        return f"{quote_schema(schema, row)}.{quote(source, row)}"
    dialect = "postgresql" if is_pg(row) else "mysql"
    return compiler.join_clause(f"{schema}.{source}", [{**j, "table": f"{schema}.{j['table']}"} for j in joins], dialect_of(row))


def sample(row: dict, source: str, names: list, *, limit: int = 5, zone: str | None = None, joins: list[dict] | None = None) -> list[list]:
    """The first rows: names are columns of the base, or (alias, column) pairs when the dataset joins tables."""
    pairs = [(n if isinstance(n, (list, tuple)) else ("t0" if joins else None, n)) for n in names]
    if not IDENT.match(source) or not names or not all(IDENT.match(c) and (a is None or IDENT.match(a)) for a, c in pairs):
        raise ExternalError("Only columns named with letters, digits and underscores can be read.")
    selected = ", ".join(f"{quote(a, row)}.{quote(c, row)}" if a else quote(c, row) for a, c in pairs)
    if is_ch(row):
        return query(row, f"SELECT {selected} FROM {_from(row, source, joins)} LIMIT {int(limit)}", None, timeout_ms=SAMPLE_TIMEOUT_MS, zone=zone)
    sql = f"SELECT {selected} FROM {_from(row, source, joins)} LIMIT %s"
    return query(row, sql, [int(limit)], timeout_ms=SAMPLE_TIMEOUT_MS, zone=zone)


def join_check(row: dict, source: str, joins: list[dict], *, zone: str | None = None) -> dict:
    """What a join does to the rows: the base's count, the joined count, the share of base rows that match the last join."""
    if not IDENT.match(source) or not joins:
        raise ExternalError("Only tables named with letters, digits and underscores can be joined.")
    from apps.insights import compiler
    last = joins[-1]
    dialect = dialect_of(row)                                            # the same text _from builds, so the base can be swapped for its sample
    base = f"{compiler._source(f'{schema_of(row)}.{source}', dialect)} AS {compiler._ident('t0', dialect)}"
    sampled = f"(SELECT * FROM {compiler._source(f'{schema_of(row)}.{source}', dialect)} LIMIT {JOIN_SAMPLE_ROWS}) AS {compiler._ident('t0', dialect)}"
    with_last = _from(row, source, joins).replace(base, sampled, 1)
    without_last = _from(row, source, joins[:-1]).replace(base, sampled, 1) if joins[:-1] else sampled   # the base alone: its sample
    probe = f"{quote(last['alias'], row)}.{quote(last['on'][0][1], row)}"
    sql = (f"SELECT (SELECT count(*) FROM {without_last}) AS base_rows, count(*) AS joined_rows, count({probe}) AS matched_rows FROM {with_last}")
    base_rows, joined_rows, matched_rows = query(row, sql, [], timeout_ms=SAMPLE_TIMEOUT_MS, zone=zone)[0]
    return {"base_rows": int(base_rows), "joined_rows": int(joined_rows), "matched_rows": int(matched_rows), "sample": JOIN_SAMPLE_ROWS,
            "sampled": int(base_rows) >= JOIN_SAMPLE_ROWS,
            "multiplies": int(joined_rows) > int(base_rows), "factor": round(int(joined_rows) / int(base_rows), 2) if int(base_rows) else None}


# ---------------------------------------------------------------------------------------------------- the query window
DOLLAR_QUOTE = re.compile(r"\$([A-Za-z_][A-Za-z_0-9]*)?\$")
EXECUTABLE_COMMENT = re.compile(r"/\*\s*M?!", re.I)                    # MySQL and MariaDB run what such a comment holds


def _bare(sql: str, pg: bool) -> str:
    """the SQL as the server reads it, without its comments, strings and quoted names, for the guard to read: one pass from
    the left, so a comment marker inside a string (or a quote inside a comment) cannot hide what follows. PostgreSQL: -- and
    nested /* */ comments, '' strings without backslash escapes (E'' strings with them), $tag$ strings, "" names. MySQL:
    -- (followed by a space) and # comments, /* */, '' and "" strings with backslash escapes, `` names."""
    out, i, n = [], 0, len(sql)
    while i < n:
        c, nxt = sql[i], sql[i + 1:i + 2]
        if c == "-" and nxt == "-" and (pg or i + 2 >= n or sql[i + 2] <= " "):
            end = sql.find("\n", i)
            i = n if end < 0 else end
            out.append(" ")
            continue
        if c == "#" and not pg:
            end = sql.find("\n", i)
            i = n if end < 0 else end
            out.append(" ")
            continue
        if c == "/" and nxt == "*":
            depth, j = 1, i + 2
            while j < n and depth:
                if pg and sql.startswith("/*", j):
                    depth, j = depth + 1, j + 2
                elif sql.startswith("*/", j):
                    depth, j = depth - 1, j + 2
                else:
                    j += 1
            i = j
            out.append(" ")
            continue
        if pg and c == "$":
            tag = DOLLAR_QUOTE.match(sql, i)
            if tag and not (i and (sql[i - 1].isalnum() or sql[i - 1] == "_")):
                end = sql.find(tag.group(0), tag.end())
                i = n if end < 0 else end + len(tag.group(0))
                out.append("''")
                continue
        if c in "'\"" or (c == "`" and not pg):
            escapes = not pg or (c == "'" and i and sql[i - 1] in "eE" and not (i > 1 and (sql[i - 2].isalnum() or sql[i - 2] == "_")))
            j = i + 1
            while j < n:
                if escapes and sql[j] == "\\":
                    j += 2
                    continue
                if sql[j] == c:
                    if sql[j + 1:j + 2] == c:
                        j += 2
                        continue
                    break
                j += 1
            i = j + 1
            out.append(c * 2)
            continue
        out.append(c)
        i += 1
    return "".join(out)


def check_sql(sql: str, engine: str | None = None) -> str:
    """One SELECT and nothing else: the query trimmed, or ExternalError with the reason in plain words. On ClickHouse also no table
    function that reaches another server, a file or a program, and no SETTINGS clause (the engine sets the limits)."""
    text = (sql or "").strip()
    if text.endswith(";"):
        text = text[:-1].rstrip()
    if not text:
        raise ExternalError("Write a SELECT.")
    if EXECUTABLE_COMMENT.search(text):
        raise ExternalError("Comments that MySQL runs (/*! … */) are not allowed in a report query.")
    for bare in (_bare(text, pg=True), _bare(text, pg=False)):     # as PostgreSQL and as MySQL read it: refused when either shows a problem
        if ";" in bare:
            raise ExternalError("One statement at a time: a second statement after a semicolon is not allowed.")
        first = bare.split(None, 1)[0].lower() if bare.split() else ""
        if first not in ("select", "with"):
            raise ExternalError("The window takes one SELECT (or WITH … SELECT).")
        found = FORBIDDEN_WORDS.search(bare)
        if found:
            raise ExternalError(f"The word {found.group(1).upper()} is not allowed in a report query. The account could not write anyway, and the engine will not try.")
        found = FORBIDDEN_FUNCTIONS.search(bare)
        if found:
            raise ExternalError(f"{found.group(1)}() is not allowed in a report query: it reads the server's files or holds it up.")
        if engine == "clickhouse":
            found = CH_FORBIDDEN_FUNCTIONS.search(bare)
            if found:
                raise ExternalError(f"{found.group(1)}() is not allowed in a report query: it reaches another server, a file or a program.")
            found = CH_FORBIDDEN_WORDS.search(bare)
            if found:
                raise ExternalError("SETTINGS is not allowed in a report query: the engine sets the time limit and read-only mode itself.")
    return text


def _python_type(value) -> str:
    from datetime import date, datetime
    from decimal import Decimal
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "bigint"
    if isinstance(value, Decimal):
        return "decimal"
    if isinstance(value, float):
        return "double"
    if isinstance(value, datetime):
        return "datetime"
    if isinstance(value, date):
        return "date"
    return "varchar"


def run_sql(row: dict, sql: str, *, limit: int = QUERY_ROWS, timeout_ms: int = 15_000, zone: str | None = None) -> dict:
    """The query window's Run: the checked SELECT wrapped as SELECT * FROM (…) AS q LIMIT n on the read-only session; the result's
    columns typed from the values, the first rows, whether there were more, and the time."""
    clean = check_sql(sql, row.get("engine"))
    if is_ch(row):
        return _ch_run_sql(row, clean, limit=limit, timeout_ms=timeout_ms, zone=zone)
    # the limit written in and no parameters sent: with parameters the driver reads every % of the person's SQL (LIKE 'SMS%') as a mark
    wrapped = f"SELECT * FROM ({clean}) AS {quote('q', row)} LIMIT {int(limit) + 1}"
    started = time.monotonic()
    conn = connect(row, timeout_ms=timeout_ms, zone=zone)
    try:
        with conn.cursor() as cursor:
            cursor.execute(wrapped)
            names = [d[0] for d in cursor.description or []]
            rows = [list(r) for r in cursor.fetchall()]
    except psycopg.errors.QueryCanceled:
        raise ExternalError(f"Stopped after {timeout_ms // 1000} seconds: the query took longer than the workspace's limit. Narrow it with a WHERE, or put the heavy part in a view.") from None
    except pymysql.err.OperationalError as exc:
        code = exc.args[0] if exc.args and isinstance(exc.args[0], int) else None
        if code == MAX_EXECUTION_ERROR or "max_execution_time" in str(exc).lower():
            raise ExternalError(f"Stopped after {timeout_ms // 1000} seconds: the query took longer than the workspace's limit. Narrow it with a WHERE, or put the heavy part in a view.") from None
        raise ExternalError("The server did not accept the query: " + _message(exc)) from None
    except (pymysql.err.MySQLError, psycopg.Error) as exc:
        raise ExternalError("The server did not accept the query: " + _message(exc)) from None
    finally:
        conn.close()
    ms = int((time.monotonic() - started) * 1000)
    seen: dict[str, int] = {}
    columns = []
    for i, name in enumerate(names):
        sample = next((r[i] for r in rows if r[i] is not None), None)
        kind = _python_type(sample)
        seen[name] = seen.get(name, 0) + 1
        columns.append({"column": name, "column_type": kind, "key": False, "mappable": bool(IDENT.match(name)) and seen[name] == 1, **_typed(kind, kind, name)})
    for name, n in seen.items():
        if n > 1:
            for c in columns:
                if c["column"] == name:
                    c["mappable"] = False
    return {"columns": columns, "rows": rows[:limit], "truncated": len(rows) > limit, "ms": ms, "sql": clean}


def _ch_run_sql(row: dict, clean: str, *, limit: int, timeout_ms: int, zone: str | None) -> dict:
    """run_sql on ClickHouse: the columns typed from the server's own types rather than from the values"""
    started = time.monotonic()
    try:
        answer = _ch(row, f"SELECT * FROM ({clean}) AS q LIMIT {int(limit) + 1}", timeout_ms=timeout_ms, zone=zone)
    except clickhouse.ClickHouseError as exc:
        if _ch_code(exc) == CH_TIMEOUT:
            raise ExternalError(f"Stopped after {timeout_ms // 1000} seconds: the query took longer than the workspace's limit. Narrow it with a WHERE, or put the heavy part in a view.") from None
        raise ExternalError("The server did not accept the query: " + _ch_message(exc)) from None
    rows, seen, columns = answer["data"], {}, []
    for meta in answer["meta"]:
        seen[meta["name"]] = seen.get(meta["name"], 0) + 1
    for meta in answer["meta"]:
        kind = _ch_type(meta["type"])
        columns.append({"column": meta["name"], "column_type": meta["type"], "key": False, "mappable": bool(IDENT.match(meta["name"])) and seen[meta["name"]] == 1 and kind != "complex",
                        **_typed(kind, kind, meta["name"])})
    return {"columns": columns, "rows": rows[:limit], "truncated": len(rows) > limit, "ms": int((time.monotonic() - started) * 1000), "sql": clean}


# ---------------------------------------------------------------------------------------------------- the runner's path
def query(row: dict, sql: str, params, *, timeout_ms: int, zone: str | None = None) -> list[list]:
    """One SELECT on a read-only session under the time limit; a stopped query reads as a statement timeout. ClickHouse takes the
    compiler's {name:Type} parameters as a dict."""
    if is_ch(row):
        return _ch_rows(row, sql, params or None, timeout_ms=timeout_ms, zone=zone)
    conn = connect(row, timeout_ms=timeout_ms, zone=zone)
    try:
        with conn.cursor() as cursor:
            cursor.execute(sql, list(params) if params is not None else None)
            return [list(r) for r in cursor.fetchall()]
    except psycopg.errors.QueryCanceled as exc:
        raise RuntimeError("statement timeout: the query was stopped by the server's limit") from None
    except pymysql.err.OperationalError as exc:
        code = exc.args[0] if exc.args and isinstance(exc.args[0], int) else None
        if code == MAX_EXECUTION_ERROR or "max_execution_time" in str(exc).lower():
            raise RuntimeError("statement timeout: the query was stopped by the server's limit") from None
        raise RuntimeError(_message(exc)) from None
    except (pymysql.err.MySQLError, psycopg.Error) as exc:
        raise RuntimeError(_message(exc)) from None
    finally:
        conn.close()
