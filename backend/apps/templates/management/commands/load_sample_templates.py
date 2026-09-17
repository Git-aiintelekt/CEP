"""Create one DRAFT template per starter in a tenant, so the Templates section is not empty on day one.

    python manage.py load_sample_templates NWA
    python manage.py load_sample_templates NWA --only welcome store_receipt --activate

Safe to re-run: a starter whose name already exists in the tenant is skipped.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from apps.templates import design, starters
from apps.templates.models import TemplateMaster


class Command(BaseCommand):
    help = "Load the starter templates (email marketing, e-receipts, SMS, MMS) into a tenant as editable samples."

    def add_arguments(self, parser):
        parser.add_argument("tenant_code")
        parser.add_argument("--only", nargs="+", metavar="KEY", help=f"starter keys: {', '.join(starters.BY_KEY)}")
        parser.add_argument("--activate", action="store_true", help="activate the samples that are ready to send (MMS needs a picture first)")

    def handle(self, *args, tenant_code, only, activate, **options):
        unknown = set(only or []) - set(starters.BY_KEY)
        if unknown:
            raise CommandError(f"Unknown starter: {', '.join(sorted(unknown))}")
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("SELECT id FROM fn_resolve_tenant('code', %s)", [tenant_code])
            row = cursor.fetchone()
            if row is None:
                raise CommandError(f"No active tenant with code {tenant_code}")
            tenant_id = row[0]
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])      # RLS + audit context

            added = starters.ensure_tags(tenant_id)
            if added:
                self.stdout.write(f"added {added} personalization tags used by the e-receipt samples")
            for starter in starters.STARTERS:
                if only and starter["key"] not in only:
                    continue
                if TemplateMaster.objects.filter(name__iexact=starter["name"], deleted_at__isnull=True).exists():
                    self.stdout.write(f"  skip     {starter['name']} (already exists)")
                    continue
                template = TemplateMaster.objects.create(tenant_id=tenant_id, name=starter["name"], channel=starter["channel"],
                                                         description=f"Sample: {starter['description']}")
                starters.apply(template, None, starter["key"])
                state = "draft"
                if activate and not design.activation_blockers(template):
                    template.status = TemplateMaster.Status.ACTIVE
                    template.save(update_fields=["status"])
                    state = "active"
                self.stdout.write(self.style.SUCCESS(f"  created  {starter['name']} [{starter['channel']}] ({state})"))
