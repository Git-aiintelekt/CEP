"""Give a workspace's reports the standard filters: Campaign, Channel and Period (apps/insights/report_filters.py).

    python manage.py insights_report_filters --tenant NWA            # lists the reports that would change
    python manage.py insights_report_filters --tenant NWA --apply    # saves each as a new version, "Report filters added"
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections


class Command(BaseCommand):
    help = "Add the Campaign, Channel and Period filters to a workspace's reports."

    def add_arguments(self, parser):
        parser.add_argument("--tenant", required=True, help="the workspace's code")
        parser.add_argument("--apply", action="store_true", help="save the changes (without it, only list them)")

    def handle(self, *args, tenant, apply, **options):
        from apps.insights import report_filters
        with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
            cursor.execute("SELECT id FROM tenant WHERE code = %s", [tenant])
            row = cursor.fetchone()
        if row is None:
            raise CommandError(f"No tenant with code {tenant}")
        changed = report_filters.add_to_reports(row[0], apply=apply)
        for item in changed:
            self.stdout.write(f"{'added' if apply else 'would add'} {', '.join(item['added'])}: {item['name']}")
        self.stdout.write(self.style.SUCCESS(f"{len(changed)} report{'' if len(changed) == 1 else 's'} {'changed' if apply else 'to change'}."))
