"""The upgrade notice every signed-in person sees, in every workspace (apps.platform_ops.upgrade).

    python manage.py upgrade_notice schedule --at "2026-11-20 22:00" --zone Asia/Singapore --minutes 10 [--note "..."]
    python manage.py upgrade_notice start                  # just before the services restart: the app dims and reconnects by itself
    python manage.py upgrade_notice done --release v1.2.2  # after they are back: shown for an hour, the app offers Reload
    python manage.py upgrade_notice clear                  # nothing planned
    python manage.py upgrade_notice show

The install script runs start and done; Platform → Scheduled Upgrade in the back-office does the same by hand.
"""
import json

from django.core.management.base import BaseCommand, CommandError

from apps.platform_ops import upgrade


class Command(BaseCommand):
    help = "Schedule, start, finish or clear the upgrade notice people see in every workspace."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["schedule", "start", "done", "clear", "show"])
        parser.add_argument("--at", help="schedule: the start, e.g. '2026-11-20 22:00', in --zone")
        parser.add_argument("--zone", default="UTC", help="schedule: the time zone of --at (default UTC)")
        parser.add_argument("--minutes", type=int, default=10, help="schedule: about how long it takes (default 10)")
        parser.add_argument("--note", default="", help="schedule: a short note for people, optional")
        parser.add_argument("--release", default="", help="done: the release now installed, e.g. v1.2.2")

    def handle(self, *args, action, **options):
        try:
            if action == "schedule":
                if not options["at"]:
                    raise CommandError("schedule needs --at, e.g. --at '2026-11-20 22:00' --zone Asia/Singapore")
                upgrade.schedule(upgrade.local_start(options["at"], options["zone"]), options["minutes"], options["note"], options["zone"])
            elif action == "start":
                upgrade.start()
            elif action == "done":
                upgrade.done(options["release"])
            elif action == "clear":
                upgrade.clear()
        except upgrade.UpgradeError as error:
            raise CommandError(str(error)) from None
        self.stdout.write(json.dumps(upgrade.public()))
