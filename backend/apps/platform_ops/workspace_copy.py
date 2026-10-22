"""Copy a workspace into another installation's database: EXPORT_FOR_COPY writes one file on the source, `import_workspace`
loads it on the target (database/production/load_demo_data.sh). The demo workspace reaches production this way.

    export_workspace(conn, tenant_id, code, book) -> {"archive", "sha256", "tables", "rows", "files"}
    import_workspace(conn, archive, code=, name=, plan_code=) -> {"tenant_id", "code", "rows", "people", "relinked", "cleared", ...}

The file (<CODE>-<stamp>.c360ws.zip) holds every table of the workspace in PostgreSQL's own COPY format, its uploaded files
(media/t/<id>/), and manifest.json: the workspace row, each table's columns, row count and SHA-256, the months its partitions
cover, the shared rows its links point at (by their natural key), and the patches the source database has.

Left out: the platform's records about the workspace (CONTROL_PLANE: subscription, invoices, routing, support sessions,
operations), the logs (LOG_TABLES and anything found only through them), and every secret: those columns are exported blank,
because the target has its own encryption key and the keys are entered again there.

The load checks before it changes anything (the file's checksums, the target's tables and columns, the code, the id, the
people's new addresses), then in one transaction: the workspace row under the new code and name, its partitions, every table
copied with triggers off (an exact copy), the people disabled with placeholder addresses, the links to shared rows re-pointed
by natural key (or cleared when the target has no such row), the sequences moved past the copied ids, and the row counts
compared with the manifest table by table. Any difference rolls the whole load back. Needs the owner login on both sides.
"""
import hashlib
import json
import re
import zipfile
from pathlib import Path

from django.conf import settings
from django.db import connections
from django.utils import timezone

from .tenant_ops import CONTROL_PLANE, OperationError, count_rows, discover

FORMAT = "c360-workspace/1"
P = settings.PLATFORM_ALIAS
# exported blank: the target has its own encryption key, so these could never be read there; people enter them again
SECRET_COLUMNS = {"password_hash", "mfa_secret_enc", "mfa_recovery_hashes", "key_hash", "api_key_enc", "secret_enc", "transactional_secret_enc",
                  "token_hash", "password_enc", "client_secret_enc"}
# what happened on the source server, not part of the workspace: request timings, integration calls, provider callbacks, the change history
LOG_TABLES = {"request_metric", "integration_log", "integration_metric", "delivery_webhook_event", "definition_audit_log"}
# shared rows a workspace's rows may point at, whose ids differ between installations: matched on the target by this key
NATURAL_KEYS = {"platform_personalization_tag": "tag_key"}
CHUNK = 1 << 20


def copy_plan(conn, tenant_id: str) -> dict:
    """The tables to copy and how to find the workspace's rows in each (tenant_ops.discover), without the platform's records,
    the logs, and any table reached only through one of those."""
    plan = discover(conn, tenant_id)
    left_out = CONTROL_PLANE | LOG_TABLES
    return {name: spec for name, spec in plan.items()
            if name not in left_out and not any(f'FROM "{other}"' in spec["predicate"] for other in left_out)}


def _columns(conn, tables: list[str]) -> dict:
    """table -> [(column, type, not null)] in table order, generated columns left out (the target computes them)."""
    with conn.cursor() as cur:
        cur.execute("""SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull
                         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relname = ANY(%s) AND a.attnum > 0 AND NOT a.attisdropped
                          AND a.attidentity <> 'a' AND a.attgenerated = ''
                        ORDER BY c.relname, a.attnum""", [tables])
        out = {}
        for table, column, kind, not_null in cur.fetchall():
            out.setdefault(table, []).append((column, kind, not_null))
        return out


def blank(kind: str, not_null: bool) -> str:
    """The value a secret column is exported as: NULL where allowed, else an empty value of its type."""
    if not not_null:
        return f"NULL::{kind}"
    return f"'{{}}'::{kind}" if kind.endswith("[]") else f"''::{kind}"


def _links(conn) -> list[tuple[str, str, str, str, bool]]:
    """Every single-column foreign key: (child table, column, parent table, parent column, child column nullable)."""
    with conn.cursor() as cur:
        cur.execute("""SELECT child.relname, a.attname, parent.relname, pa.attname, NOT a.attnotnull
                         FROM pg_constraint k JOIN pg_class child ON child.oid = k.conrelid JOIN pg_class parent ON parent.oid = k.confrelid
                         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
                         JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
                        WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1 AND NOT child.relispartition""")
        return cur.fetchall()


# ------------------------------------------------------------------------------------------------------------ EXPORT
def export_workspace(conn, tenant_id: str, code: str, book, directory: Path | None = None) -> dict:
    directory = Path(directory or settings.TENANT_EXPORT_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    stamp = timezone.now().strftime("%Y%m%dT%H%M%SZ")
    archive = directory / f"{code}-{stamp}.c360ws.zip"
    plan = copy_plan(conn, tenant_id)
    tables = sorted(name for name in plan if name != "tenant")
    columns = _columns(conn, tables)
    with conn.cursor() as cur:
        cur.execute("SELECT row_to_json(t)::text, t.partition_seq FROM tenant t WHERE id = %s", [tenant_id])
        workspace, seq = cur.fetchone()
        cur.execute("SELECT relname FROM pg_class WHERE relispartition AND relkind = 'r' AND relname ~ %s", [f"_t{seq}_[0-9]{{4}}_[0-9]{{2}}$"])
        months = sorted({(m.group(1), m.group(2)) for m in (re.match(rf"(.+)_t{seq}_(\d{{4}}_\d{{2}})$", row[0]) for row in cur.fetchall()) if m})
        cur.execute("SELECT to_regclass('schema_patch') IS NOT NULL")
        patches = []
        if cur.fetchone()[0]:
            cur.execute("SELECT name FROM schema_patch ORDER BY name")
            patches = [row[0] for row in cur.fetchall()]
    manifest = {"format": FORMAT, "workspace": json.loads(workspace), "exported_at": timezone.now().isoformat(timespec="seconds"),
                "source": {"database": conn.info.dbname, "patches": patches}, "partitions": [list(m) for m in months], "tables": {}, "files": {},
                "natural_keys": {}, "left_out": {"platform_records": sorted(CONTROL_PLANE), "logs": sorted(LOG_TABLES), "secret_columns": sorted(SECRET_COLUMNS)}}

    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle, conn.cursor() as cur:
        for name in tables:
            spec = plan[name]
            cols = columns[name]
            select = ", ".join(blank(kind, not_null) if column in SECRET_COLUMNS else f'"{column}"' for column, kind, not_null in cols)
            digest, size = hashlib.sha256(), 0
            with bundle.open(f"tables/{name}.copy", "w") as out, cur.copy(f'COPY (SELECT {select} FROM "{name}" WHERE {spec["predicate"]}) TO STDOUT') as copy:
                for chunk in copy:
                    data = bytes(chunk)
                    out.write(data)
                    digest.update(data)
                    size += len(data)
            manifest["tables"][name] = {"columns": [c for c, _, _ in cols], "bytes": size, "sha256": digest.hexdigest()}
        for name, rows in count_rows(conn, {n: plan[n] for n in tables}).items():
            manifest["tables"][name]["rows"] = rows
        # the shared rows the workspace points at, by their natural key, so the target can find its own
        for child, column, parent, parent_column, _ in _links(conn):
            if child in manifest["tables"] and parent in NATURAL_KEYS:
                cur.execute(f'SELECT DISTINCT p."{parent_column}"::text, p."{NATURAL_KEYS[parent]}" FROM "{parent}" p WHERE p."{parent_column}" IN '
                            f'(SELECT "{column}" FROM "{child}" WHERE {plan[child]["predicate"]})')
                manifest["natural_keys"].setdefault(parent, {}).update(dict(cur.fetchall()))
        media = Path(settings.MEDIA_ROOT) / "t" / tenant_id
        if media.is_dir():
            for path in sorted(p for p in media.rglob("*") if p.is_file()):
                relative = path.relative_to(media).as_posix()
                data = path.read_bytes()
                bundle.writestr(f"media/{relative}", data)
                manifest["files"][relative] = hashlib.sha256(data).hexdigest()
        bundle.writestr("manifest.json", json.dumps(manifest, indent=2, default=str))
    conn.rollback()
    total = sum(item["rows"] for item in manifest["tables"].values())
    book.step("export", f"{len(tables)} tables, {total:,} rows, {len(manifest['files'])} files -> {archive.name}")
    return {"archive": str(archive), "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "bytes": archive.stat().st_size,
            "tables": len(tables), "rows": total, "files": len(manifest["files"])}


# ------------------------------------------------------------------------------------------------------------ IMPORT
def read_manifest(archive: Path) -> dict:
    """The manifest, after checking every table and file in the archive against its checksum."""
    with zipfile.ZipFile(archive) as bundle:
        try:
            manifest = json.loads(bundle.read("manifest.json"))
        except KeyError:
            raise OperationError(f"{archive.name} has no manifest.json: it is not a workspace export.") from None
        if manifest.get("format") != FORMAT:
            raise OperationError(f"{archive.name} is in format {manifest.get('format')!r}; this installation reads {FORMAT}.")
        damaged = []
        for name, spec in manifest["tables"].items():
            digest = hashlib.sha256()
            with bundle.open(f"tables/{name}.copy") as data:
                while chunk := data.read(CHUNK):
                    digest.update(chunk)
            if digest.hexdigest() != spec["sha256"]:
                damaged.append(name)
        for relative, checksum in manifest["files"].items():
            if hashlib.sha256(bundle.read(f"media/{relative}")).hexdigest() != checksum:
                damaged.append(f"media/{relative}")
        if damaged:
            raise OperationError(f"The file is damaged: {', '.join(damaged[:10])} do not match their checksums.")
    return manifest


def schema_differences(conn, manifest: dict) -> list[str]:
    """What stops the target from taking the file: a table or column it lacks, or a required column the file does not fill."""
    tables = list(manifest["tables"])
    with conn.cursor() as cur:
        cur.execute("""SELECT c.relname, a.attname, a.attnotnull AND d.adbin IS NULL AND a.attidentity = '' AND a.attgenerated = ''
                         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relname = ANY(%s)
                          AND a.attnum > 0 AND NOT a.attisdropped""", [tables])
        target = {}
        for table, column, required in cur.fetchall():
            target.setdefault(table, {})[column] = required
    problems = []
    for name, spec in manifest["tables"].items():
        if name not in target:
            problems.append(f"table {name} is missing")
            continue
        missing = [c for c in spec["columns"] if c not in target[name]]
        if missing:
            problems.append(f"{name} lacks {', '.join(missing)}")
        unfilled = [c for c, required in target[name].items() if required and c not in spec["columns"]]
        if unfilled:
            problems.append(f"{name} requires {', '.join(unfilled)}, which the file does not hold")
    return problems


def placeholder(code: str, number: int) -> str:
    return f"{code.lower()}-user-{number}@demo.invalid"


def import_workspace(conn, archive, *, code: str, name: str, plan_code: str = "INSIGHTS") -> dict:
    archive = Path(archive)
    manifest = read_manifest(archive)
    workspace = manifest["workspace"]
    tenant_id = workspace["id"]
    code = code.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,29}", code):
        raise OperationError(f"{code!r} is not a workspace code: capital letters, digits and _, starting with a letter.")
    steps = []

    with conn.cursor() as cur:
        cur.execute("SELECT code FROM tenant WHERE code = %s OR id = %s", [code, tenant_id])
        clash = cur.fetchone()
        if clash:
            raise OperationError(f"This database already has the workspace {clash[0]} " + ("(the same code)." if clash[0] == code else "(the same workspace: it was loaded before)."))
        cur.execute("SELECT id FROM subscription_plan WHERE code = %s", [plan_code])
        plan_row = cur.fetchone()
        if plan_row is None:
            raise OperationError(f"No plan {plan_code} in this database.")
        people = manifest["tables"].get("app_user", {}).get("rows", 0)
        cur.execute("SELECT email FROM app_user WHERE email = ANY(%s)", [[placeholder(code, n) for n in range(1, people + 1)]])
        taken = [row[0] for row in cur.fetchall()]
        if taken:
            raise OperationError(f"The addresses the copied people would get are taken: {', '.join(taken[:5])}")
    problems = schema_differences(conn, manifest)
    if problems:
        raise OperationError("This database's schema does not match the file (apply the same patches first): " + "; ".join(problems[:12]))
    conn.rollback()
    steps.append(("checks", f"file intact, schema matches, {code} is free"))

    try:
        with conn.cursor() as cur:
            # 1. the workspace row under its new code and name, and its partitions, with triggers on (the normal path)
            cur.execute("SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'tenant'::regclass AND attnum > 0 "
                        "AND NOT attisdropped AND attidentity <> 'a' AND attgenerated = ''")
            columns = [c for c in cur.fetchone()[0] if c in workspace]
            row = {**workspace, "code": code, "name": name, "subdomain": None, "custom_app_domain": None, "created_by": None, "updated_by": None,
                   "status": "ACTIVE", "isolation_mode": "SHARED", "deleted_at": None}
            listed = ", ".join(f'"{c}"' for c in columns)
            cur.execute(f"INSERT INTO tenant ({listed}) SELECT {listed} FROM json_populate_record(NULL::tenant, %s::json)", [json.dumps(row, default=str)])
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [tenant_id])
            cur.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [tenant_id])
            cur.execute("SELECT partition_seq FROM tenant WHERE id = %s", [tenant_id])
            seq = cur.fetchone()[0]
            past = 0
            for table, month in manifest["partitions"]:
                child, parent = f"{table}_t{seq}_{month}", f"{table}_t{seq}"
                cur.execute("SELECT to_regclass(%s) IS NOT NULL, to_regclass(%s) IS NOT NULL", [child, parent])
                exists, has_parent = cur.fetchone()
                if exists or not has_parent:
                    continue
                year, mon = (int(x) for x in month.split("_"))
                upper = f"{year + (mon == 12)}-{1 if mon == 12 else mon + 1:02d}-01"
                cur.execute(f"CREATE TABLE \"{child}\" PARTITION OF \"{parent}\" FOR VALUES FROM ('{year}-{mon:02d}-01 00:00:00+00') TO ('{upper} 00:00:00+00')")
                cur.execute(f'REVOKE ALL ON "{child}" FROM cep_app')
                past += 1
            steps.append(("workspace", f"{code} ({name}) created with its partitions (+{past} past months)"))

            # 2. every table, byte for byte, triggers and foreign-key checks off
            cur.execute("SET LOCAL session_replication_role = replica")
            with zipfile.ZipFile(archive) as bundle:
                for table, spec in manifest["tables"].items():
                    if not spec["rows"]:
                        continue
                    listed = ", ".join(f'"{c}"' for c in spec["columns"])
                    with bundle.open(f"tables/{table}.copy") as data, cur.copy(f'COPY "{table}" ({listed}) FROM STDIN') as into:
                        while chunk := data.read(CHUNK):
                            into.write(chunk)

            # 3. the people: nobody signs in as them; placeholder addresses keep the real ones free on this installation
            cur.execute("""WITH numbered AS (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM app_user WHERE tenant_id = %s)
                           UPDATE app_user u SET email = %s || '-user-' || numbered.n || '@demo.invalid', is_active = false, is_staff = false,
                                  is_platform_admin = false, mfa_enabled = false, mfa_secret_enc = NULL, mfa_recovery_hashes = '{}',
                                  external_subject_id = NULL, auth_provider = 'LOCAL', password_hash = '!' || encode(gen_random_bytes(20), 'hex')
                             FROM numbered WHERE u.id = numbered.id""", [tenant_id, code.lower()])
            disabled = cur.rowcount

            # 4. links to shared rows: re-pointed by natural key, cleared where this installation has no such row
            target_plan = {t: s for t, s in discover(conn, tenant_id).items() if t in manifest["tables"]}
            relinked, cleared, broken = {}, {}, []
            for child, column, parent, parent_column, nullable in _links(conn):
                if child not in target_plan or parent in target_plan or parent == "tenant":
                    continue
                where = target_plan[child]["predicate"]
                if parent in NATURAL_KEYS and manifest["natural_keys"].get(parent):
                    key = NATURAL_KEYS[parent]
                    for old, natural in manifest["natural_keys"][parent].items():
                        cur.execute(f'UPDATE "{child}" SET "{column}" = (SELECT "{parent_column}" FROM "{parent}" WHERE "{key}" = %s) '
                                    f'WHERE "{column}"::text = %s AND {where} AND EXISTS (SELECT 1 FROM "{parent}" WHERE "{key}" = %s)', [natural, old, natural])
                        relinked[f"{child}.{column}"] = relinked.get(f"{child}.{column}", 0) + cur.rowcount
                dangling = f'"{column}" IS NOT NULL AND {where} AND NOT EXISTS (SELECT 1 FROM "{parent}" p WHERE p."{parent_column}" = "{child}"."{column}")'
                cur.execute(f'SELECT count(*) FROM "{child}" WHERE {dangling}')
                count = cur.fetchone()[0]
                if not count:
                    continue
                if nullable:
                    cur.execute(f'UPDATE "{child}" SET "{column}" = NULL WHERE {dangling}')
                    cleared[f"{child}.{column}"] = count
                else:
                    broken.append(f"{child}.{column} -> {parent} ({count})")
            if broken:
                raise OperationError(f"Rows point at shared rows this database does not have: {', '.join(broken)}")

            # 5. sequences past the copied ids, so the next row inserted here does not collide
            moved = 0
            for table, spec in manifest["tables"].items():
                for column in spec["columns"]:
                    cur.execute("SELECT pg_get_serial_sequence(%s, %s)", [f'"{table}"', column])
                    sequence = cur.fetchone()[0]
                    if sequence:
                        cur.execute(f'SELECT setval(%s, GREATEST((SELECT COALESCE(max("{column}"), 0) FROM "{table}"), (SELECT last_value FROM {sequence})))', [sequence])
                        moved += 1

            # 6. the counts, table by table
            copied = count_rows(conn, target_plan)
            differences = {t: (spec["rows"], copied.get(t, 0)) for t, spec in manifest["tables"].items() if spec["rows"] != copied.get(t, 0)}
            if differences:
                raise OperationError(f"Row counts differ after the copy (file, database): {differences}")
            steps.append(("copy", f"{sum(copied.values()):,} rows in {len(copied)} tables copied and verified; {disabled} people disabled"))

            # 7. the platform's records for it: routing in the shared pool, and the plan
            cur.execute("SET LOCAL session_replication_role = origin")
            cur.execute("INSERT INTO tenant_database (tenant_id, isolation_mode, db_alias, status) VALUES (%s, 'SHARED', 'default', 'ACTIVE') "
                        "ON CONFLICT DO NOTHING", [tenant_id])
            cur.execute("INSERT INTO tenant_subscription (tenant_id, plan_id, status) VALUES (%s, %s, 'ACTIVE')", [tenant_id, plan_row[0]])
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    files = _place_files(archive, manifest, tenant_id)
    steps.append(("files", f"{files} uploaded files placed"))
    return {"tenant_id": tenant_id, "code": code, "name": name, "plan": plan_code, "rows": sum(copied.values()), "tables": len(copied),
            "people": disabled, "relinked": relinked, "cleared": cleared, "sequences": moved, "files": files, "steps": steps,
            "source": manifest["workspace"].get("code"), "exported_at": manifest["exported_at"]}


def _place_files(archive: Path, manifest: dict, tenant_id: str) -> int:
    root = (Path(settings.MEDIA_ROOT) / "t" / tenant_id).resolve()
    placed = 0
    with zipfile.ZipFile(archive) as bundle:
        for relative in manifest["files"]:
            target = (root / relative).resolve()
            if root not in target.parents:
                raise OperationError(f"A file in the export points outside the workspace's folder: {relative}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(bundle.read(f"media/{relative}"))
            placed += 1
    return placed


def record_import(result: dict, staff_user_id=None) -> None:
    """The load as a finished operation of the new workspace, beside its other operations in the back-office."""
    progress = [{"at": timezone.now().isoformat(timespec="seconds"), "step": step, "detail": detail} for step, detail in result["steps"]]
    with connections[P].cursor() as cur:
        cur.execute("""INSERT INTO tenant_operation (tenant_id, operation, status, parameters, progress, result, requested_by, started_at, finished_at)
                       VALUES (%s, 'IMPORT', 'SUCCEEDED', %s::jsonb, %s::jsonb, %s::jsonb, %s, now(), now())""",
                    [result["tenant_id"], json.dumps({"source": result["source"], "exported_at": result["exported_at"], "plan": result["plan"]}),
                     json.dumps(progress), json.dumps({k: v for k, v in result.items() if k != "steps"}, default=str), staff_user_id])
