"""Add the base report packs to one workspace or to every workspace on this installation.

    python manage.py load_base_packs --tenant NWA                      # what would happen, nothing written
    python manage.py load_base_packs --all-tenants                     # the same, for every active workspace
    python manage.py load_base_packs --all-tenants --apply --as me@x.y # add them, as this platform administrator
    python manage.py load_base_packs --tenant NWA --packs surveys,ereceipts --apply

Without --apply nothing is written: it prints what each workspace would get and why a pack would be left out,
which is the thing to read before running it on a server. With no --packs it takes the packs the workspace was
onboarded with, or every pack when it was onboarded with none.

A pack needs a connection and the databases on it holding its tables. One mapped in Settings -> Report Databases
is used; otherwise the workspace's connections are asked which of their databases hold them, and the answer is
used when exactly one connection has them. Anything else is reported, not guessed.

Re-runnable: a workspace that already has a pack is left alone.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

STATUS_STYLE = {"added": "SUCCESS", "refused": "ERROR", "already added": "HTTP_INFO"}


class Command(BaseCommand):
    help = "Add the base report packs to one workspace or to all of them."

    def add_arguments(self, parser):
        parser.add_argument("--tenant", action="append", dest="tenants", help="a workspace's code; repeatable")
        parser.add_argument("--all-tenants", action="store_true", help="every active workspace")
        parser.add_argument("--packs", help="pack keys, comma separated; the default is what each workspace was onboarded with")
        parser.add_argument("--as", dest="who", help="the platform administrator to add them as (email); needed with --apply")
        parser.add_argument("--apply", action="store_true", help="add them (without it, only say what would happen)")

    def handle(self, *args, tenants, all_tenants, packs, who, apply, **options):
        from apps.identity.models import AppUser
        from apps.insights import base_packs_loader as loader
        from apps.insights.base_packs import PACKS

        if not tenants and not all_tenants:
            raise CommandError("Name a workspace with --tenant, or take them all with --all-tenants.")
        if tenants and all_tenants:
            raise CommandError("Either --tenant or --all-tenants, not both.")

        pack_keys = [k.strip() for k in (packs or "").split(",") if k.strip()] or None
        unknown = [k for k in pack_keys or [] if k not in PACKS]
        if unknown:
            raise CommandError(f"No such pack: {', '.join(unknown)}. There is {', '.join(sorted(PACKS))}.")

        user = None
        if apply:
            if not who:
                raise CommandError("Adding needs --as EMAIL: the packs are recorded as added by that person.")
            user = AppUser.objects.using(settings.PLATFORM_ALIAS).filter(email__iexact=who).first()
            if user is None:
                raise CommandError(f"No user {who}.")
            if not getattr(user, "is_platform_admin", False):
                raise CommandError(f"{who} is not a platform administrator, so they cannot add packs to another workspace.")

        found = loader.workspaces(tenants)
        if tenants:
            missing = sorted(set(tenants) - {t.code for t in found})
            if missing:
                raise CommandError(f"No active workspace with code: {', '.join(missing)}")

        counts = {}
        for tenant in found:
            self.stdout.write(self.style.MIGRATE_HEADING(f"\n{tenant.code} - {tenant.name}"))
            try:
                steps = loader.load(tenant, user, pack_keys, apply=apply)
            except Exception as exc:                                     # one workspace's trouble is not the next one's
                counts["failed"] = counts.get("failed", 0) + 1
                self.stderr.write(self.style.ERROR(f"  could not be read: {exc}"))
                continue
            if not steps:
                self.stdout.write("  no packs to add")
            for step in steps:
                counts[step["status"]] = counts.get(step["status"], 0) + 1
                line = f"  {step['name']}: {step['status']}"
                if step.get("folder"):
                    line += f" -> folder {step['folder']!r}"
                if step.get("connection"):
                    line += f" ({step['connection']}: {', '.join(step.get('databases') or [])})"
                if step.get("made"):
                    line += "  " + ", ".join(f"{n} {k}" for k, n in step["made"].items())
                if step.get("why"):
                    line += f" - {step['why']}"
                style = getattr(self.style, STATUS_STYLE.get(step["status"], "NOTICE"))
                self.stdout.write(style(line))

        done = ", ".join(f"{n} {name}" for name, n in sorted(counts.items())) or "nothing"
        self.stdout.write(self.style.SUCCESS(
            f"\n{len(found)} workspace{'' if len(found) == 1 else 's'}: {done}."
            + ("" if apply else "  Nothing was written: add --apply.")))
