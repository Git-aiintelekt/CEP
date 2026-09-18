"""Process campaign runs without Celery: start what is due, send every batch, close the run.

    python manage.py send_campaign_runs                 # every run that is due, across tenants
    python manage.py send_campaign_runs --run <uuid>    # one run

The Celery workers do the same in parallel (queues `campaign` and `email`); this command is for development, for a
server without a broker, and for nudging a run by hand.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from apps.delivery import engine
from apps.delivery.engine import runs


class Command(BaseCommand):
    help = "Start and send campaign runs that are due (no Celery needed)."

    def add_arguments(self, parser):
        parser.add_argument("--run", help="id of one campaign run")

    def handle(self, *args, run=None, **options):
        if run:
            with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
                cursor.execute("SELECT tenant_id, id, status FROM campaign_run WHERE id = %s", [run])
                todo = [(str(a), str(b), c) for a, b, c in cursor.fetchall()]
            if not todo:
                raise CommandError("No such run.")
        else:
            todo = runs.due()
        if not todo:
            self.stdout.write("Nothing is due.")
        for tenant_id, run_id, status in todo:
            result = engine.process_run(tenant_id, run_id)
            self.stdout.write(f"{run_id} ({status}) -> {result}")
