"""Run a scheduled job once, now, in this process (recorded in job_run exactly as a Celery run would be).

    python manage.py run_job --list
    python manage.py run_job rollup-usage
"""
import json

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Run a platform job by name without Celery."

    def add_arguments(self, parser):
        parser.add_argument("name", nargs="?")
        parser.add_argument("--list", action="store_true")

    def handle(self, *args, name, list, **options):
        from apps.platform_ops import jobs
        from workers import maintenance, outbox, platform
        runnable = {**platform.RUNNABLE, "ensure-monthly-partitions": maintenance.ensure_monthly_partitions,
                    "apply-partition-retention": maintenance.apply_partition_retention, "outbox-relay": outbox.relay_pending_events}
        if list or not name:
            for report in jobs.status_report():
                last = report["last_success"].strftime("%Y-%m-%d %H:%M") if report["last_success"] else "never"
                self.stdout.write(f"{report['name']:<28} {report['state']:<8} last success {last:<17} {report['purpose']}")
            return
        if name not in runnable:
            raise CommandError(f"Unknown job. Known: {', '.join(sorted(runnable))}")
        result = runnable[name]()
        self.stdout.write(self.style.SUCCESS(f"{name}: {json.dumps(result, default=str)}"))
