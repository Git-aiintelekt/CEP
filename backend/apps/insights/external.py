"""A workspace's own databases, MySQL 5.7 and 8.0 or PostgreSQL, read by the report engine and nothing else
(docs/mockups/report-databases.html): every session is opened read-only with the workspace's statement time limit and the
workspace's time zone; Test Connection reads the server's version, what the account may read and the account's rights, and
an account that could write or change the schema is refused. MySQL through pymysql, PostgreSQL through psycopg; the
password is decrypted here and never leaves the server.

    test(row) -> {"ok", "version", "timezone", "tables", "views", "read_only", "offending", "ms", "error"}
    sources(row) -> [{"name", "kind", "columns", "rows", "mappable"}]      the tables and views the account can read, views first
    columns(row, source) -> [{"column", "column_type", "key", "mappable", "type", "role", "aggregates", "format"}]
    sample(row, source, names, limit, zone) -> rows
    query(row, sql, params, timeout_ms, zone) -> rows                     the runner's path
"""
import re
import ssl
import time

import psycopg
import pymysql

from apps.platform_ops import crypto

ALLOWED_MYSQL = {"SELECT", "SHOW VIEW", "USAGE"}
ALLOWED_PG = {"SELECT", "REFERENCES"}
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
CONNECT_TIMEOUT_S = 8
NUMERIC = {"tinyint", "smallint", "mediumint", "int", "integer", "bigint", "decimal", "numeric", "float", "double", "real", "double precision", "money"}
ENGINES = {"mysql57": "MySQL 5.7", "mysql80": "MySQL 8.0", "postgresql": "PostgreSQL"}
DEFAULT_PORT = {"mysql57": 3306, "mysql80": 3306, "postgresql": 5432}
MAX_EXECUTION_ERROR = 3024
MONEY = re.compile(r"amount|price|sales|revenue|cost|total|fee|paid|value", re.I)


class ExternalError(Exception):
    """What went wrong, for the person, never with the password in it."""


def is_pg(row: dict) -> bool:
    return row.get("engine") == "postgresql"


def schema_of(row: dict) -> str:
    """where the sources live: the schema on PostgreSQL, the database itself on MySQL"""
    return (row.get("schema_name") or "public") if is_pg(row) else row["database_name"]


def quote(name: str, row: dict) -> str:
    assert IDENT.match(name), name
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
    return not offending, offending


# ---------------------------------------------------------------------------------------------------- what Test Connection proves
def test(row: dict) -> dict:
    started = time.monotonic()
    try:
        conn = connect(row, timeout_ms=10_000)
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
                cursor.execute("SELECT TABLE_TYPE, count(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s GROUP BY TABLE_TYPE", [schema])
                counts = {kind: int(n) for kind, n in cursor.fetchall()}
                read_only, offending = _grants(cursor)
    except _errors(row) as exc:
        return {"ok": False, "error": _message(exc), "ms": int((time.monotonic() - started) * 1000)}
    finally:
        conn.close()
    return {"ok": True, "version": str(version), "timezone": str(zone), "tables": counts.get("BASE TABLE", 0), "views": counts.get("VIEW", 0),
            "read_only": read_only, "offending": offending, "ms": int((time.monotonic() - started) * 1000), "error": None}


# ---------------------------------------------------------------------------------------------------- what can be mapped
def sources(row: dict) -> list[dict]:
    conn = connect(row, timeout_ms=10_000)
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
                cursor.execute("""SELECT t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_ROWS, (SELECT count(*) FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME)
                                    FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = %s ORDER BY t.TABLE_TYPE DESC, t.TABLE_NAME""", [schema])
            out = [{"name": name, "kind": "view" if kind == "VIEW" else "table", "rows": int(rows) if rows is not None and kind != "VIEW" and int(rows) >= 0 else None,
                    "columns": int(cols), "mappable": bool(IDENT.match(name))} for name, kind, rows, cols in cursor.fetchall()]
    except _errors(row) as exc:
        raise ExternalError(_message(exc)) from None
    finally:
        conn.close()
    return out


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
    conn = connect(row, timeout_ms=10_000)
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


def _from(row: dict, source: str, joins: list[dict] | None) -> str:
    """the FROM for a sample or a check: the base alone, or the base as t0 with its joins (compiler.join_clause)"""
    from apps.insights import compiler
    schema = schema_of(row)
    if not joins:
        return f"{quote(schema, row)}.{quote(source, row)}"
    dialect = "postgresql" if is_pg(row) else "mysql"
    return compiler.join_clause(f"{schema}.{source}", [{**j, "table": f"{schema}.{j['table']}"} for j in joins], dialect)


def sample(row: dict, source: str, names: list, *, limit: int = 5, zone: str | None = None, joins: list[dict] | None = None) -> list[list]:
    """The first rows: names are columns of the base, or (alias, column) pairs when the dataset joins tables."""
    pairs = [(n if isinstance(n, (list, tuple)) else ("t0" if joins else None, n)) for n in names]
    if not IDENT.match(source) or not names or not all(IDENT.match(c) and (a is None or IDENT.match(a)) for a, c in pairs):
        raise ExternalError("Only columns named with letters, digits and underscores can be read.")
    selected = ", ".join(f"{quote(a, row)}.{quote(c, row)}" if a else quote(c, row) for a, c in pairs)
    sql = f"SELECT {selected} FROM {_from(row, source, joins)} LIMIT %s"
    return query(row, sql, [int(limit)], timeout_ms=10_000, zone=zone)


def join_check(row: dict, source: str, joins: list[dict], *, zone: str | None = None) -> dict:
    """What a join does to the rows: the base's count, the joined count, the share of base rows that match the last join."""
    if not IDENT.match(source) or not joins:
        raise ExternalError("Only tables named with letters, digits and underscores can be joined.")
    last = joins[-1]
    with_last = _from(row, source, joins)
    without_last = _from(row, source, joins[:-1])
    probe = f"{quote(last['alias'], row)}.{quote(last['on'][0][1], row)}"
    sql = (f"SELECT (SELECT count(*) FROM {without_last}) AS base_rows, count(*) AS joined_rows, count({probe}) AS matched_rows FROM {with_last}")
    base_rows, joined_rows, matched_rows = query(row, sql, [], timeout_ms=10_000, zone=zone)[0]
    return {"base_rows": int(base_rows), "joined_rows": int(joined_rows), "matched_rows": int(matched_rows),
            "multiplies": int(joined_rows) > int(base_rows), "factor": round(int(joined_rows) / int(base_rows), 2) if int(base_rows) else None}


# ---------------------------------------------------------------------------------------------------- the runner's path
def query(row: dict, sql: str, params, *, timeout_ms: int, zone: str | None = None) -> list[list]:
    """One SELECT on a read-only session under the time limit; a stopped query reads as a statement timeout."""
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
