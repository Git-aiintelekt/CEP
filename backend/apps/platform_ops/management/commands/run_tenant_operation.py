"""Request and / or run a tenant operation from the command line.

    python manage.py run_tenant_operation --tenant NWA --operation EXPORT
    python manage.py run_tenant_operation --tenant ACME --operation MOVE_TO_DEDICATED --param db_alias=acme --param db_host=10.0.0.50 \\
           --param db_name=cep_acme --param db_secret_ref=env:ACME_DB
    python manage.py run_tenant_operation --tenant ACME --operation OFFBOARD --param confirm=ACME
    python manage.py run_tenant_operation <operation-id>          # run one that was requested in the back-office

Needs OWNER_DATABASE_URL (the DDL-owner login): data is copied and erased with triggers off.
"""
import json

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections


class Command(BaseCommand):
    help = "Export a tenant, move it to a dedicated database, purge the pool copy after a move, or offboard it."

    def add_arguments(self, parser):
        parser.add_argument("operation_id", nargs="?")
        parser.add_argument("--tenant")
        parser.add_argument("--operation", choices=["EXPORT", "MOVE_TO_DEDICATED", "PURGE_SOURCE", "OFFBOARD"])
        parser.add_argument("--param", action="append", default=[], metavar="KEY=VALUE")

    def handle(self, *args, operation_id, tenant, operation, param, **options):
        from apps.platform_ops import tenant_ops
        if not operation_id:
            if not (tenant and operation):
                raise CommandError("Give an operation id, or --tenant and --operation.")
            parameters = dict(item.split("=", 1) for item in param)
            with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
                cursor.execute("SELECT id FROM tenant WHERE code = %s", [tenant])
                row = cursor.fetchone()
                if row is None:
                    raise CommandError(f"No tenant with code {tenant}")
                cursor.execute("INSERT INTO tenant_operation (tenant_id, operation, parameters) VALUES (%s, %s, %s::jsonb) RETURNING id",
                               [row[0], operation, json.dumps(parameters)])
                operation_id = cursor.fetchone()[0]
            self.stdout.write(f"requested {operation} for {tenant}: {operation_id}")
        try:
            result = tenant_ops.run(operation_id)
        except Exception as exc:
            raise CommandError(f"{exc.__class__.__name__}: {exc}") from exc
        self.stdout.write(self.style.SUCCESS(json.dumps(result, indent=2, default=str)))
