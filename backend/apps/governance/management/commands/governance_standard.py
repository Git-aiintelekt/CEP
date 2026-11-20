"""Adds the standard governance to the platform and every active workspace (apps/governance/standard.py).

    manage.py governance_standard            what would be added (nothing is changed)
    manage.py governance_standard --apply    the platform standards (all workspaces, locked) and each workspace's own standard caps

Running it again changes nothing: a platform standard that exists is left as the platform team set it, and a workspace
keeps whatever it already caps on a channel."""
from django.conf import settings
from django.core.management.base import BaseCommand

from apps.governance import standard
from apps.tenants import context


class Command(BaseCommand):
    help = "Adds the standard governance (platform limits and each workspace's own caps)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Make the changes; without it, only say what would change.")

    def handle(self, *args, **options):
        token = context.set_platform(True)
        try:
            report = standard.apply(using=settings.PLATFORM_ALIAS, dry_run=not options["apply"])
        finally:
            context.reset_platform(token)
        self.stdout.write("Platform:" if options["apply"] else "Dry run. Platform:")
        for name, outcome in report["platform"].items():
            self.stdout.write(f"  {name}: {outcome}")
        self.stdout.write("Workspaces:")
        for code, added in report["workspaces"].items():
            self.stdout.write(f"  {code}: {', '.join(added) if added else 'already capped on every channel'}")
