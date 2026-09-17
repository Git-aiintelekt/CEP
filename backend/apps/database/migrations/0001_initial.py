"""Applies the CEP DDL — the source of truth for every table (all Django models are managed = False).

Order matters: MVP core → enterprise hardening → SaaS tenancy → hybrid services. Tenants are provisioned afterwards
with `SELECT fn_provision_tenant('<uuid>')` (see the `provision_tenant` management command).
"""
from pathlib import Path

from django.db import migrations

DDL_DIR = Path(__file__).resolve().parents[4] / "database"
DDL_FILES = (
    "CEP_Database_Schema.sql",
    "CEP_Database_Schema_Enterprise_Hardening.sql",
    "CEP_Database_Schema_SaaS_Tenancy.sql",
    "CEP_Database_Schema_Hybrid_Services.sql",
)


def _sql(name: str) -> str:
    return (DDL_DIR / name).read_text(encoding="utf-8")


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [migrations.RunSQL(_sql(f), reverse_sql=migrations.RunSQL.noop) for f in DDL_FILES]
