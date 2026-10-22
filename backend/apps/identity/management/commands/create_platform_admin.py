"""The first platform administrator of a new installation, and the Platform workspace they belong to.

    python manage.py create_platform_admin platform@aiintelekt.com --name "Platform Admin"

Every user belongs to a workspace, and a database built without the sample data has none, so this makes the Platform
workspace (code PLATFORM, on the Insights plan, onboarded like any other) when it is missing, then the user in it as
Workspace Admin with is_staff and is_platform_admin, and asks for the password twice without showing it. Safe to run again:
what exists is kept, the flags are set, and the password changes only when one is typed (--no-password skips the
question; set it later with changepassword <email> --database platform). Runs on the BYPASSRLS `platform` connection.
"""
from getpass import getpass

from django.conf import settings
from django.contrib.auth.password_validation import ValidationError, validate_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.identity.models import AppUser, Role, UserRole
from apps.tenants import services
from apps.tenants.models import SubscriptionPlan, Tenant, TenantSubscription

P = settings.PLATFORM_ALIAS
CODE = "PLATFORM"
PLAN = "INSIGHTS"


class Command(BaseCommand):
    help = "Create the Platform workspace and a platform administrator in it (or bring an existing one up to date)."

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("--name", default="Platform Admin", help="the display name")
        parser.add_argument("--timezone", default="UTC", help="the Platform workspace's time zone, when it is created")
        parser.add_argument("--no-password", action="store_true", help="do not ask for a password now")

    def handle(self, *args, email, name, no_password, **options):
        elsewhere = AppUser.objects.using(P).filter(email__iexact=email).exclude(tenant__code=CODE).select_related("tenant").first()
        if elsewhere is not None:
            raise CommandError(f"{email} already belongs to the workspace {elsewhere.tenant.code}; an email can be in one workspace only.")
        password = None if no_password else self.ask_password(email)

        with transaction.atomic(using=P):
            tenant, created = self.platform_workspace(options["timezone"])
            user = AppUser.objects.using(P).filter(email__iexact=email).first()
            if user is None:
                user = AppUser.objects.db_manager(P).create_user(email, name, tenant, None, auth_provider="LOCAL")
            user.is_staff = user.is_platform_admin = user.is_active = True
            if password:
                user.set_password(password)
            user.save(using=P)
            role = Role.objects.using(P).filter(tenant=tenant, name="Workspace Admin", deleted_at__isnull=True).first()
            if role is not None:
                UserRole.objects.using(P).get_or_create(user=user, role=role)

        self.stdout.write(self.style.SUCCESS(
            f"{'Created' if created else 'Kept'} the workspace {CODE}; {user.email} is a platform administrator in it."))
        if not user.has_usable_password():
            self.stdout.write(f"No password yet: python manage.py changepassword {user.email} --database platform")
        self.stdout.write("Next: sign in at /admin/ and set up two-step verification (Account Security in the app, workspace PLATFORM).")

    def platform_workspace(self, zone: str) -> tuple[Tenant, bool]:
        tenant = Tenant.objects.using(P).filter(code=CODE).first()
        if tenant is not None:
            return tenant, False
        plan = SubscriptionPlan.objects.using(P).filter(code=PLAN).first() or SubscriptionPlan.objects.using(P).order_by("code").first()
        if plan is None:
            raise CommandError("No subscription plan in this database: was it built from the layers?")
        tenant = Tenant.objects.using(P).create(name="Platform", code=CODE, timezone=zone, status="ACTIVE", isolation_mode="SHARED",
                                                settings={}, onboarded_at=timezone.now())
        services.onboard_tenant(tenant, using=P)
        TenantSubscription.objects.using(P).create(tenant=tenant, plan=plan, status="ACTIVE")
        return tenant, True

    def ask_password(self, email: str) -> str:
        user = AppUser(email=email, display_name=email)
        for _ in range(3):
            first = getpass(f"Password for {email}: ")
            if not first:
                return ""                                                      # keep the password the user has (or none)
            if getpass("Again: ") != first:
                self.stderr.write("They differ; once more.")
                continue
            try:
                validate_password(first, user)
            except ValidationError as error:
                self.stderr.write(" ".join(error.messages))
                continue
            return first
        raise CommandError("No password set.")
