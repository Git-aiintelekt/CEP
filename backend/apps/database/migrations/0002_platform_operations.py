"""Layer 5: billing, tenant operations, job monitoring and alerts, support access, MFA / SSO, global parameters.
The file is idempotent, so applying it to a database that already has it (patch 0006) is harmless."""
from pathlib import Path

from django.db import migrations

DDL = Path(__file__).resolve().parents[4] / "database" / "CEP_Database_Schema_Platform_Operations.sql"


class Migration(migrations.Migration):
    dependencies = [("database", "0001_initial")]
    operations = [migrations.RunSQL(DDL.read_text(encoding="utf-8"), reverse_sql=migrations.RunSQL.noop)]
