"""manage.py provision_tenant <tenant-uuid> [--months-ahead 3] [--database alias] — creates the tenant's partitions."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connections


class Command(BaseCommand):
    help = "Create the per-tenant partitions for every partitioned table (calls fn_provision_tenant)."

    def add_arguments(self, parser):
        parser.add_argument("tenant_id")
        parser.add_argument("--months-ahead", type=int, default=3)
        parser.add_argument("--database", default="default")

    def handle(self, *args, **opts):
        with connections[opts["database"]].cursor() as cur:
            cur.execute("SET app.current_tenant = %s", [opts["tenant_id"]])
            cur.execute("SELECT fn_provision_tenant(%s::uuid, %s)", [opts["tenant_id"], opts["months_ahead"]])
            created = cur.fetchone()[0]
        if created is None:
            raise CommandError("fn_provision_tenant returned nothing — is the SaaS layer applied?")
        self.stdout.write(self.style.SUCCESS(f"provisioned tenant {opts['tenant_id']}: {created} partition set(s) created"))
