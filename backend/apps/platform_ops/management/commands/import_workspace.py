"""Load a workspace exported by EXPORT_FOR_COPY on another installation into this database.

    python manage.py import_workspace /path/NWA-20261022T120000Z.c360ws.zip --code DEMO --name "C360 Demo" [--plan INSIGHTS]
    python manage.py import_workspace <file> --check          # the checks only: nothing is changed

database/production/load_demo_data.sh runs it. Needs OWNER_DATABASE_URL (a superuser login of this database): the rows are
copied with triggers off. Everything is checked before anything changes, and the load is one transaction: any difference
rolls it back. The people come across disabled, with placeholder addresses; secrets are not in the file.
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Load a workspace exported on another installation (EXPORT_FOR_COPY) under a new code and name."

    def add_arguments(self, parser):
        parser.add_argument("archive")
        parser.add_argument("--code", required=True, help="the workspace code here, e.g. DEMO")
        parser.add_argument("--name", required=True, help="the workspace name here, e.g. \"C360 Demo\"")
        parser.add_argument("--plan", default="INSIGHTS", help="the plan it is on here (default INSIGHTS)")
        parser.add_argument("--check", action="store_true", help="run the checks and stop")

    def handle(self, *args, archive, code, name, plan, check, **options):
        from apps.platform_ops import tenant_ops, workspace_copy
        path = Path(archive)
        if not path.is_file():
            raise CommandError(f"No file {archive}")
        try:
            manifest = workspace_copy.read_manifest(path)
            rows = sum(spec["rows"] for spec in manifest["tables"].values())
            self.stdout.write(f"{path.name}: the workspace {manifest['workspace']['code']} exported {manifest['exported_at']}, "
                              f"{len(manifest['tables'])} tables, {rows:,} rows, {len(manifest['files'])} files; checksums match")
            conn = tenant_ops.owner_connection()
            try:
                if check:
                    problems = workspace_copy.schema_differences(conn, manifest)
                    if problems:
                        raise CommandError("The schema differs: " + "; ".join(problems))
                    self.stdout.write(self.style.SUCCESS("This database's schema takes the file. Nothing was changed."))
                    return
                result = workspace_copy.import_workspace(conn, path, code=code, name=name, plan_code=plan)
            finally:
                conn.close()
        except tenant_ops.OperationError as exc:
            raise CommandError(str(exc)) from exc
        workspace_copy.record_import(result)
        for step, detail in result["steps"]:
            self.stdout.write(f"  {step:<10} {detail}")
        summary = {k: result[k] for k in ("code", "name", "plan", "rows", "tables", "people", "relinked", "cleared", "sequences", "files")}
        self.stdout.write(self.style.SUCCESS(json.dumps(summary, indent=2, default=str)))
        self.stdout.write("Next: enter the workspace's keys again (sending engines, Report Databases, AI) if it uses them, and check its reports.")
