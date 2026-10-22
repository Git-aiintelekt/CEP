"""Tenant lifecycle operations: EXPORT, MOVE_TO_DEDICATED, PURGE_SOURCE, OFFBOARD.

Run by `manage.py run_tenant_operation <id>` or the run-tenant-operations job; requested from the back-office.
Every operation is a tenant_operation row whose `progress` is appended while it runs, so the runbook writes itself.

How the tables are found: nothing is hard-coded. The catalog is read for every top-level table in `public`; a table
belongs to a tenant if it has tenant_id, or reaches such a table through a chain of single-column foreign keys
(journey_node -> journey_version -> journey). Tables that reach no tenant are global (permission, reference_code,
subscription_plan, ...) and are left alone.

Privileges: the data copy and the purge run with triggers and foreign-key checks off (session_replication_role =
replica), the way pg_restore --disable-triggers does: rows arrive exactly as they were (no touch trigger, no audit
noise, no ordering problems from circular audit references). That needs the DDL owner / a superuser:
OWNER_DATABASE_URL for the pool, and <SECRET>_OWNER_USER / <SECRET>_OWNER_PASSWORD for a dedicated target.
"""
import hashlib
import json
import os
import re
import time
import uuid
import zipfile
from datetime import timedelta
from pathlib import Path

import psycopg
from django.conf import settings
from django.db import connections
from django.utils import timezone

from . import params

P = settings.PLATFORM_ALIAS
# never leave the database in an export, never travel in clear
SECRET_COLUMNS = {"password_hash", "key_hash", "mfa_secret_enc", "mfa_recovery_hashes", "client_secret_enc", "password_enc", "secret_enc"}
# live in the pool (control plane) for every tenant, dedicated or not: not moved, not purged after a move
CONTROL_PLANE = {"tenant_database", "tenant_subscription", "tenant_usage", "tenant_storage_config", "tenant_invoice", "tenant_operation",
                 "support_access_log", "tenant_identity_provider", "mail_server"}
# financial records survive offboarding (retention law); the tenant row stays as a tombstone
KEEP_ON_OFFBOARD = {"tenant", "tenant_invoice", "tenant_operation"}
SKIP_PREFIXES = ("django_", "auth_")
# shared by every tenant: never exported as tenant data, never erased, whatever they happen to reference
GLOBAL_TABLES = {"permission", "reference_code", "subscription_plan", "partition_retention_policy", "platform_setting", "industry_profile",
                 "job_run", "platform_alert"}


class OperationError(Exception):
    pass


# ------------------------------------------------------------------------------------------------------------ catalog
def discover(conn, tenant_id: str) -> dict:
    """table -> {'predicate', 'columns', 'partitioned'} for every table holding this tenant's rows."""
    uuid.UUID(tenant_id)                                   # the id is inlined into COPY statements: it must be a UUID and nothing else
    with conn.cursor() as cur:
        cur.execute("""SELECT c.relname, c.relkind = 'p'
                         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition""")
        tables = {name: {"partitioned": part} for name, part in cur.fetchall() if not name.startswith(SKIP_PREFIXES)}
        cur.execute("""SELECT c.relname, a.attname, a.attidentity = 'a' OR a.attgenerated <> ''
                         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p') AND NOT c.relispartition
                        ORDER BY c.relname, a.attnum""")
        for name, column, generated in cur.fetchall():
            if name in tables:
                tables[name].setdefault("all_columns", []).append(column)
                if not generated:
                    tables[name].setdefault("columns", []).append(column)
        cur.execute("""SELECT child.relname, a.attname, parent.relname, pa.attname
                         FROM pg_constraint k
                         JOIN pg_class child ON child.oid = k.conrelid JOIN pg_class parent ON parent.oid = k.confrelid
                         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
                         JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
                        WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1 AND NOT child.relispartition
                          AND a.attnotnull""")           # ownership is mandatory; nullable references (created_by, updated_by) are not
        edges = [row for row in cur.fetchall() if row[0] in tables and row[2] in tables and row[0] != row[2] and row[0] not in GLOBAL_TABLES]

    predicate, depth = {"tenant": f"id = '{tenant_id}'"}, {"tenant": 0}
    for name, spec in tables.items():
        if name != "tenant" and name not in GLOBAL_TABLES and "tenant_id" in spec.get("all_columns", []):
            predicate[name], depth[name] = f"tenant_id = '{tenant_id}'", 0
    changed = True
    while changed:                                         # children of children of ... a tenant table
        changed = False
        for child, column, parent, parent_column in edges:
            if child not in predicate and parent in predicate and parent != "tenant":
                predicate[child] = f'"{column}" IN (SELECT "{parent_column}" FROM "{parent}" WHERE {predicate[parent]})'
                depth[child] = depth[parent] + 1           # found THROUGH the parent: must be erased before it
                changed = True
    return {name: {**tables[name], "predicate": where, "depth": depth[name]} for name, where in predicate.items()}


def count_rows(conn, plan: dict) -> dict:
    counts = {}
    with conn.cursor() as cur:
        for name, spec in sorted(plan.items()):
            cur.execute(f'SELECT count(*) FROM "{name}" WHERE {spec["predicate"]}')
            counts[name] = cur.fetchone()[0]
    return counts


# ------------------------------------------------------------------------------------------------------------ connections
def _url_to_kwargs(url: str) -> dict:
    import environ
    cfg = environ.Env.db_url_config(url)
    login = {"host": cfg["HOST"], "port": cfg["PORT"] or 5432, "dbname": cfg["NAME"], "user": cfg["USER"]}
    return {**login, "password": cfg["PASSWORD"]} if cfg["PASSWORD"] else login     # no password in the URL: PGPASSWORD or ~/.pgpass


def owner_connection(target: dict | None = None):
    """A psycopg connection with DDL-owner rights: the pool (OWNER_DATABASE_URL), or a dedicated target described by
    {'db_host', 'db_port', 'db_name', 'db_secret_ref'} whose owner login comes from the secret store."""
    if target is None:
        url = os.environ.get("OWNER_DATABASE_URL") or getattr(settings, "OWNER_DATABASE_URL", "")
        if not url:
            raise OperationError("OWNER_DATABASE_URL is not set: tenant operations copy and erase data with triggers off, which needs the DDL owner login.")
        kwargs = _url_to_kwargs(url)
    else:
        ref = str(target.get("db_secret_ref") or "")
        if not ref.startswith("env:"):
            raise OperationError("db_secret_ref must look like env:NAME (NAME_OWNER_USER / NAME_OWNER_PASSWORD hold the target's owner login).")
        name = ref[4:]
        try:
            kwargs = {"host": target["db_host"], "port": int(target.get("db_port") or 5432), "dbname": target["db_name"],
                      "user": os.environ[f"{name}_OWNER_USER"], "password": os.environ[f"{name}_OWNER_PASSWORD"]}
        except KeyError as missing:
            raise OperationError(f"Environment variable {missing} is not set.") from None
    conn = psycopg.connect(**kwargs, connect_timeout=15, autocommit=False)
    with conn.cursor() as cur:
        cur.execute("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
        if not cur.fetchone()[0]:
            conn.close()
            raise OperationError(f"{kwargs['user']} is not a superuser: it cannot switch triggers off for an exact copy.")
    conn.rollback()
    return conn


# ------------------------------------------------------------------------------------------------------------ bookkeeping
class Runbook:
    """Appends to tenant_operation.progress on the platform connection, outside the operation's own transactions."""

    def __init__(self, operation_id):
        self.id = str(operation_id)

    def _exec(self, sql, args):
        with connections[P].cursor() as cur:
            cur.execute(sql, args)

    def step(self, step: str, detail: str = ""):
        entry = json.dumps([{"at": timezone.now().isoformat(timespec="seconds"), "step": step, "detail": detail}])
        self._exec("UPDATE tenant_operation SET progress = progress || %s::jsonb WHERE id = %s", [entry, self.id])

    def finish(self, status: str, result: dict | None = None, error: str | None = None):
        self._exec("UPDATE tenant_operation SET status = %s, result = %s::jsonb, error = %s, finished_at = now() WHERE id = %s",
                   [status, json.dumps(result or {}, default=str), error, self.id])


# ------------------------------------------------------------------------------------------------------------ EXPORT
def export_tenant(conn, tenant_id: str, code: str, book: Runbook, directory: Path | None = None) -> dict:
    """One CSV per table (header row, secrets left out), a manifest with row counts and SHA-256 per file, zipped."""
    directory = Path(directory or settings.TENANT_EXPORT_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    stamp = timezone.now().strftime("%Y%m%dT%H%M%SZ")
    archive = directory / f"{code}-{stamp}.zip"
    plan = discover(conn, tenant_id)
    manifest = {"tenant": code, "tenant_id": tenant_id, "exported_at": timezone.now().isoformat(timespec="seconds"), "format": "csv, header row, UTF-8",
                "omitted_columns": sorted(SECRET_COLUMNS), "tables": {}}
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle, conn.cursor() as cur:
        for name, spec in sorted(plan.items()):
            columns = [c for c in spec["all_columns"] if c not in SECRET_COLUMNS]
            select = ", ".join(f'"{c}"' for c in columns)
            digest, size, rows = hashlib.sha256(), 0, -1                   # -1: the header line
            with bundle.open(f"{name}.csv", "w") as out, cur.copy(f'COPY (SELECT {select} FROM "{name}" WHERE {spec["predicate"]}) TO STDOUT WITH (FORMAT csv, HEADER true)') as copy:
                for chunk in copy:
                    data = bytes(chunk)
                    out.write(data)
                    digest.update(data)
                    size += len(data)
                    rows += data.count(b"\n")
            manifest["tables"][name] = {"rows": max(rows, 0), "bytes": size, "sha256": digest.hexdigest()}
        exact = count_rows(conn, plan)                     # CSV line counts over-count rows with embedded newlines: record the true numbers
        for name, value in exact.items():
            manifest["tables"][name]["rows"] = value
        bundle.writestr("manifest.json", json.dumps(manifest, indent=2))
    conn.rollback()
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    total = sum(item["rows"] for item in manifest["tables"].values())
    book.step("export", f"{len(manifest['tables'])} tables, {total:,} rows -> {archive.name}")
    return {"archive": str(archive), "sha256": checksum, "bytes": archive.stat().st_size, "tables": len(manifest["tables"]), "rows": total,
            "delete_after": (timezone.now() + timedelta(days=int(params.get("tenancy.offboarding_export_days", 30)))).date().isoformat()}


# ------------------------------------------------------------------------------------------------------------ MOVE
def _set_routing(tenant_id: str, **values):
    sets = ", ".join(f"{column} = %s" for column in values)
    with connections[P].cursor() as cur:
        cur.execute(f"UPDATE tenant_database SET {sets} WHERE tenant_id = %s", [*values.values(), tenant_id])


def _history_partitions(source, target, tenant_id: str) -> int:
    """fn_provision_tenant creates the coming months; the tenant's past months must exist on the target before rows arrive."""
    with source.cursor() as cur:
        cur.execute("SELECT partition_seq FROM tenant WHERE id = %s", [tenant_id])
        seq = cur.fetchone()[0]
        cur.execute("SELECT relname FROM pg_class WHERE relispartition AND relkind = 'r' AND relname ~ %s", [f"_t{seq}_[0-9]{{4}}_[0-9]{{2}}$"])
        months = {(m.group(1), m.group(2)) for m in (re.match(rf"(.+)_t{seq}_(\d{{4}}_\d{{2}})$", row[0]) for row in cur.fetchall()) if m}
    created = 0
    with target.cursor() as cur:
        cur.execute("SELECT partition_seq FROM tenant WHERE id = %s", [tenant_id])
        target_seq = cur.fetchone()[0]
        for table, month in sorted(months):
            child, parent = f"{table}_t{target_seq}_{month}", f"{table}_t{target_seq}"
            cur.execute("SELECT to_regclass(%s) IS NOT NULL, to_regclass(%s) IS NOT NULL", [child, parent])
            exists, has_parent = cur.fetchone()
            if exists or not has_parent:
                continue
            year, mon = (int(x) for x in month.split("_"))
            upper = f"{year + (mon == 12)}-{1 if mon == 12 else mon + 1:02d}-01"
            cur.execute(f"CREATE TABLE \"{child}\" PARTITION OF \"{parent}\" FOR VALUES FROM ('{year}-{mon:02d}-01 00:00:00+00') TO ('{upper} 00:00:00+00')")
            cur.execute(f'REVOKE ALL ON "{child}" FROM cep_app')
            created += 1
    return created


def move_to_dedicated(tenant_id: str, code: str, parameters: dict, book: Runbook) -> dict:
    required = ("db_alias", "db_host", "db_name", "db_secret_ref")
    missing = [key for key in required if not parameters.get(key)]
    if missing:
        raise OperationError(f"Missing parameters: {', '.join(missing)}")
    source, target = owner_connection(), owner_connection(parameters)
    try:
        with target.cursor() as cur:
            cur.execute("SELECT to_regclass('tenant') IS NOT NULL AND to_regprocedure('fn_provision_tenant(uuid,integer)') IS NOT NULL")
            if not cur.fetchone()[0]:
                raise OperationError("The target database does not have the CEP schema: apply the DDL layers there first.")
            cur.execute("SELECT count(*) FROM tenant WHERE id = %s", [tenant_id])
            if cur.fetchone()[0]:
                raise OperationError("The target already holds this tenant. Drop the target copy, or purge the source if the move already succeeded.")
        target.rollback()

        _set_routing(tenant_id, status="MIGRATING")        # the API answers 503 for this tenant from now on
        settle = int(parameters.get("settle_seconds", 70))
        book.step("freeze", f"routing set to MIGRATING; waiting {settle}s for tenant caches (60s) to expire")
        time.sleep(settle)

        plan = {name: spec for name, spec in discover(source, tenant_id).items() if name not in CONTROL_PLANE}
        counts = count_rows(source, plan)
        book.step("plan", f"{len(plan)} tables, {sum(counts.values()):,} rows")

        with target.cursor() as cur:                       # 1. the tenant row and its partitions, with triggers ON (normal DDL path)
            columns = ", ".join(f'"{c}"' for c in plan["tenant"]["columns"])
            with source.cursor() as read, read.copy(f'COPY (SELECT {columns} FROM tenant WHERE id = \'{tenant_id}\') TO STDOUT') as out, \
                    cur.copy(f"COPY tenant ({columns}) FROM STDIN") as into:
                for chunk in out:
                    into.write(chunk)
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tenant_id])
            cur.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [tenant_id])
        history = _history_partitions(source, target, tenant_id)
        book.step("provision", f"tenant row and partitions created on the target (+{history} past months)")

        with target.cursor() as cur:                       # 2. everything else, byte for byte, triggers and FK checks off
            cur.execute("SET LOCAL session_replication_role = replica")
            for name, spec in sorted(plan.items()):
                if name == "tenant" or not counts[name]:
                    continue
                columns = ", ".join(f'"{c}"' for c in spec["columns"])
                with source.cursor() as read, read.copy(f'COPY (SELECT {columns} FROM "{name}" WHERE {spec["predicate"]}) TO STDOUT') as out, \
                        cur.copy(f'COPY "{name}" ({columns}) FROM STDIN') as into:
                    for chunk in out:
                        into.write(chunk)
        copied = count_rows(target, {name: spec for name, spec in discover(target, tenant_id).items() if name in plan})
        differences = {name: (counts[name], copied.get(name, 0)) for name in plan if counts[name] != copied.get(name, 0)}
        if differences:
            raise OperationError(f"Row counts differ after the copy (source, target): {differences}")
        target.commit()
        source.rollback()
        book.step("copy", f"{sum(copied.values()):,} rows copied and verified table by table")

        _set_routing(tenant_id, isolation_mode="DEDICATED", db_alias=parameters["db_alias"], db_host=parameters["db_host"],
                     db_port=int(parameters.get("db_port") or 5432), db_name=parameters["db_name"], db_secret_ref=parameters["db_secret_ref"],
                     migrated_from_alias="default", migrated_at=timezone.now(), status="ACTIVE")
        with connections[P].cursor() as cur:
            cur.execute("UPDATE tenant SET isolation_mode = 'DEDICATED' WHERE id = %s", [tenant_id])
        book.step("switch", f"routing now points at {parameters['db_alias']}; the pool copy is untouched until PURGE_SOURCE is run")
        return {"rows": copied, "total_rows": sum(copied.values()), "target": parameters["db_alias"],
                "next": "Restart or reload the app servers so they register the new database alias, check the tenant, then request PURGE_SOURCE."}
    except Exception:
        target.rollback()
        _set_routing(tenant_id, status="ACTIVE")           # nothing changed for the tenant: bring it back online in the pool
        book.step("rollback", "the target transaction was rolled back and the tenant is ACTIVE in the pool again")
        raise
    finally:
        source.close()
        target.close()


# ------------------------------------------------------------------------------------------------------------ PURGE / OFFBOARD
def _erase(conn, tenant_id: str, keep: set[str], book: Runbook) -> dict:
    plan = {name: spec for name, spec in discover(conn, tenant_id).items() if name not in keep}
    counts = count_rows(conn, plan)
    with conn.cursor() as cur:
        cur.execute("SET LOCAL session_replication_role = replica")
        if "tenant_invoice" in keep:
            cur.execute("UPDATE tenant_invoice SET created_by = NULL, updated_by = NULL WHERE tenant_id = %s", [tenant_id])
        # deepest first, and before any partition goes: a table found through its parent is unreachable once the parent's rows are gone
        for name, spec in sorted(plan.items(), key=lambda item: -item[1]["depth"]):
            if not spec["partitioned"]:
                cur.execute(f'DELETE FROM "{name}" WHERE {spec["predicate"]}')
        cur.execute("SET LOCAL session_replication_role = origin")
        cur.execute("SELECT fn_detach_tenant(%s::uuid)", [tenant_id])          # partitioned tables: detach, then drop: instant, no row-by-row delete
        detached = cur.fetchone()[0] or []
        for name in detached:
            cur.execute(f'DROP TABLE IF EXISTS "{name}" CASCADE')
    remaining = {name: value for name, value in count_rows(conn, plan).items() if value}
    if remaining:
        raise OperationError(f"Rows remain after the erase: {remaining}")
    conn.commit()
    book.step("erase", f"{len(detached)} partitions dropped, {sum(counts.values()):,} rows removed from {len(plan)} tables")
    return {"tables": len(plan), "rows_removed": sum(counts.values()), "partitions_dropped": len(detached)}


def purge_source(tenant_id: str, book: Runbook) -> dict:
    with connections[P].cursor() as cur:
        cur.execute("SELECT isolation_mode, status, migrated_at FROM tenant_database WHERE tenant_id = %s", [tenant_id])
        row = cur.fetchone()
    if not row or row[0] != "DEDICATED" or row[1] != "ACTIVE" or row[2] is None:
        raise OperationError("Only a tenant that was moved and is ACTIVE on its dedicated database can have its pool copy purged.")
    conn = owner_connection()
    try:
        return _erase(conn, tenant_id, keep=CONTROL_PLANE | {"tenant"}, book=book)
    finally:
        conn.close()


def offboard(tenant_id: str, code: str, parameters: dict, book: Runbook) -> dict:
    if str(parameters.get("confirm", "")).strip().upper() != code.upper():
        raise OperationError(f"Offboarding erases the tenant's data. Confirm by setting the parameter confirm to the tenant code ({code}).")
    conn = owner_connection()
    try:
        export = export_tenant(conn, tenant_id, code, book)
        with connections[P].cursor() as cur:
            cur.execute("UPDATE tenant SET status = 'OFFBOARDED', deleted_at = COALESCE(deleted_at, now()) WHERE id = %s", [tenant_id])
            cur.execute("UPDATE tenant_subscription SET status = 'CANCELLED', ends_at = COALESCE(ends_at, now()) WHERE tenant_id = %s AND status <> 'CANCELLED'", [tenant_id])
        book.step("close", "tenant marked OFFBOARDED (sign-in and API refused), subscription cancelled")
        erased = _erase(conn, tenant_id, keep=KEEP_ON_OFFBOARD, book=book)
        return {"export": export, **erased, "kept": sorted(KEEP_ON_OFFBOARD)}
    finally:
        conn.close()


# ------------------------------------------------------------------------------------------------------------ runner
def run(operation_id) -> dict:
    """Claims a REQUESTED operation and runs it. Safe to call twice: the claim is a single UPDATE."""
    with connections[P].cursor() as cur:
        cur.execute("""UPDATE tenant_operation o SET status = 'RUNNING', started_at = now()
                         FROM tenant t WHERE o.id = %s AND o.status = 'REQUESTED' AND t.id = o.tenant_id
                    RETURNING o.operation, o.tenant_id, t.code, o.parameters""", [str(operation_id)])
        row = cur.fetchone()
    if row is None:
        raise OperationError("This operation is not waiting to run (already running, finished or cancelled).")
    operation, tenant_id, code, parameters = row[0], str(row[1]), row[2], row[3] if isinstance(row[3], dict) else json.loads(row[3] or "{}")
    book = Runbook(operation_id)
    book.step("start", f"{operation} for {code}")
    try:
        if operation in ("EXPORT", "EXPORT_FOR_COPY"):
            from .workspace_copy import export_workspace
            conn = owner_connection()
            try:
                result = (export_tenant if operation == "EXPORT" else export_workspace)(conn, tenant_id, code, book)
            finally:
                conn.close()
        elif operation == "MOVE_TO_DEDICATED":
            result = move_to_dedicated(tenant_id, code, parameters, book)
        elif operation == "PURGE_SOURCE":
            result = purge_source(tenant_id, book)
        elif operation == "OFFBOARD":
            result = offboard(tenant_id, code, parameters, book)
        else:
            raise OperationError(f"Unknown operation {operation}")
    except Exception as exc:
        book.finish("FAILED", error=f"{exc.__class__.__name__}: {exc}")
        raise
    book.finish("SUCCEEDED", result=result)
    return result


def run_requested(limit: int = 5) -> dict:
    with connections[P].cursor() as cur:
        cur.execute("SELECT id FROM tenant_operation WHERE status = 'REQUESTED' ORDER BY requested_at LIMIT %s", [limit])
        waiting = [row[0] for row in cur.fetchall()]
    outcome = {}
    for operation_id in waiting:
        try:
            run(operation_id)
            outcome[str(operation_id)] = "SUCCEEDED"
        except Exception as exc:
            outcome[str(operation_id)] = f"FAILED: {exc}"
    return outcome
