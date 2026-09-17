"""Flag an existing user as internal staff / platform operator so they can sign in to /admin/.

    python manage.py make_platform_admin maria.chen@northwindapparel.example
    python manage.py changepassword maria.chen@northwindapparel.example --database platform

Runs on the BYPASSRLS `platform` connection because no tenant context exists on the command line.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.identity.models import AppUser


class Command(BaseCommand):
    help = "Grant (or revoke) Django Admin access: sets is_staff and is_platform_admin on an existing app_user."

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("--staff-only", action="store_true", help="is_staff without is_platform_admin (no model permissions)")
        parser.add_argument("--revoke", action="store_true", help="remove both flags")

    def handle(self, *args, email, staff_only, revoke, **options):
        users = AppUser.objects.using(settings.PLATFORM_ALIAS)
        try:
            user = users.get(email__iexact=email)
        except AppUser.DoesNotExist:
            raise CommandError(f"No app_user with email {email}") from None
        user.is_staff = not revoke
        user.is_platform_admin = not revoke and not staff_only
        user.save(using=settings.PLATFORM_ALIAS, update_fields=["is_staff", "is_platform_admin"])
        self.stdout.write(self.style.SUCCESS(
            f"{user.email}: is_staff={user.is_staff} is_platform_admin={user.is_platform_admin}"
            + ("" if user.password else "  (no password yet: run changepassword --database platform)")))
