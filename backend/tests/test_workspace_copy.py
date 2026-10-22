"""The workspace copy (apps/platform_ops/workspace_copy.py): what an export takes and leaves out, and the checks a load makes
before it changes anything. The full export -> load round trip runs in CI, into a second database built from nothing
(.github/workflows/ci.yml, "Production database from nothing"). Read-only here."""
import hashlib
import json
import zipfile

import pytest
from django.conf import settings
from django.db import connections

from apps.platform_ops import workspace_copy
from apps.platform_ops.tenant_ops import CONTROL_PLANE, OperationError
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS


def _nwa():
    return str(Tenant.objects.using(P).get(code="NWA").pk)


def test_the_plan_leaves_out_the_platform_records_and_the_logs(check):
    connection = connections[P]
    connection.ensure_connection()
    plan = workspace_copy.copy_plan(connection.connection, _nwa())
    check("the workspace's own tables are in it", {"tenant", "app_user", "customer_master", "report", "report_upload_row"} <= set(plan), sorted(plan)[:10])
    check("the platform's records about it are not", not (set(plan) & CONTROL_PLANE), sorted(set(plan) & CONTROL_PLANE))
    check("the logs are not", not (set(plan) & workspace_copy.LOG_TABLES), sorted(set(plan) & workspace_copy.LOG_TABLES))
    found_through = [name for name, spec in plan.items() if any(f'FROM "{t}"' in spec["predicate"] for t in CONTROL_PLANE | workspace_copy.LOG_TABLES)]
    check("nor any table reached only through them", not found_through, found_through)
    check.done()


def test_secret_columns_are_exported_blank(check):
    check("a nullable secret becomes NULL", workspace_copy.blank("text", False) == "NULL::text")
    check("a required text secret becomes empty text", workspace_copy.blank("character(64)", True) == "''::character(64)")
    check("a required list becomes an empty list", workspace_copy.blank("text[]", True) == "'{}'::text[]")
    check("the passwords, two-step secrets, keys and tokens are all covered",
          {"password_hash", "mfa_secret_enc", "mfa_recovery_hashes", "key_hash", "api_key_enc", "secret_enc", "transactional_secret_enc", "token_hash",
           "password_enc", "client_secret_enc"} <= workspace_copy.SECRET_COLUMNS)
    check("the people get addresses nobody can own", workspace_copy.placeholder("DEMO", 3) == "demo-user-3@demo.invalid")
    check.done()


def _archive(tmp_path, manifest: dict, tables: dict[str, bytes]):
    path = tmp_path / "X.c360ws.zip"
    with zipfile.ZipFile(path, "w") as bundle:
        for name, data in tables.items():
            bundle.writestr(f"tables/{name}.copy", data)
        bundle.writestr("manifest.json", json.dumps(manifest))
    return path


def test_a_damaged_or_foreign_file_is_refused_before_anything_changes(check, tmp_path):
    data = b"a\tb\n"
    good = {"format": workspace_copy.FORMAT, "tables": {"report": {"columns": ["id"], "rows": 1, "sha256": hashlib.sha256(data).hexdigest()}}, "files": {}}
    check("an intact file is read", workspace_copy.read_manifest(_archive(tmp_path, good, {"report": data}))["format"] == workspace_copy.FORMAT)
    with pytest.raises(OperationError) as damaged:
        workspace_copy.read_manifest(_archive(tmp_path, good, {"report": b"changed\n"}))
    check("a table that does not match its checksum is named", "report" in str(damaged.value) and "damaged" in str(damaged.value), str(damaged.value))
    with pytest.raises(OperationError) as foreign:
        workspace_copy.read_manifest(_archive(tmp_path, {**good, "format": "something/9"}, {"report": data}))
    check("another format is refused", "format" in str(foreign.value), str(foreign.value))
    plain = tmp_path / "plain.zip"
    with zipfile.ZipFile(plain, "w") as bundle:
        bundle.writestr("report.csv", "id\n")
    with pytest.raises(OperationError) as export:
        workspace_copy.read_manifest(plain)
    check("an ordinary export (CSV) is not mistaken for one", "not a workspace export" in str(export.value), str(export.value))
    check.done()


def test_the_schema_check_names_what_the_target_lacks(check):
    connection = connections[P]
    connection.ensure_connection()
    manifest = {"tables": {"report": {"columns": ["id", "tenant_id", "name", "a_column_from_the_future"]},
                           "a_table_from_the_future": {"columns": ["id"]},
                           "customer_master": {"columns": ["tenant_id"]}}}
    problems = workspace_copy.schema_differences(connection.connection, manifest)
    check("a missing table is named", "table a_table_from_the_future is missing" in problems, problems)
    check("a missing column is named", any(p.startswith("report lacks a_column_from_the_future") for p in problems), problems)
    check("a required column the file does not fill is named", any(p.startswith("customer_master requires") for p in problems), problems)
    check.done()
