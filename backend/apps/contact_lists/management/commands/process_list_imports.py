"""Process contact list uploads without Celery.

    python manage.py process_list_imports            # what is queued now, then stop
    python manage.py process_list_imports --loop     # keep going: a worker for a server without a broker

Any number of these can run next to each other and next to Celery workers: a job is claimed by one of them only, and the
platform's limits (lists.import_max_parallel, one per workspace) hold across all of them.
"""
import time

from django.core.management.base import BaseCommand
from django.db import connections

from apps.contact_lists import jobs


class Command(BaseCommand):
    help = "Read, check and import the contact list files that are queued."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="keep running")
        parser.add_argument("--sleep", type=float, default=3.0, help="seconds between looks when --loop finds nothing")

    def handle(self, *args, loop=False, sleep=3.0, **options):
        while True:
            result = jobs.run_pending()
            if result["processed"] or result["failed"]:
                self.stdout.write(f"processed {result['processed']}, failed {result['failed']}")
            if not loop:
                break
            if not (result["processed"] or result["failed"]):
                connections.close_all()
                time.sleep(sleep)
