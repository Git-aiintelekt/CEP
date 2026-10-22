"""create_platform_admin: on a database without the sample data, the first platform administrator and the Platform workspace
they belong to (database/production/load_reference_data.sh runs it). Rolled back."""
from unittest import mock

import pytest
from django.conf import settings
from django.core.management import CommandError, call_command

from apps.identity.models import AppUser, Permission, RolePermission, UserRole
from apps.tenants.models import SubscriptionPlan, Tenant, TenantSubscription

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS
EMAIL = "platform.admin@c360-test.example"


def test_creates_the_platform_workspace_and_its_administrator(check):
    had_workspace = Tenant.objects.using(P).filter(code="PLATFORM").exists()
    call_command("create_platform_admin", EMAIL, "--name", "Platform Admin", "--no-password")

    tenant = Tenant.objects.using(P).get(code="PLATFORM")
    user = AppUser.objects.using(P).get(email=EMAIL)
    check("the user belongs to the Platform workspace, as staff and platform administrator, without a password yet",
          user.tenant_id == tenant.pk and user.is_staff and user.is_platform_admin and user.is_active and not user.has_usable_password())
    roles = UserRole.objects.using(P).filter(user=user).select_related("role")
    check("and is its Workspace Admin", [r.role.name for r in roles] == ["Workspace Admin"], str([r.role.name for r in roles]))
    if not had_workspace:
        admin_role = roles[0].role
        granted = RolePermission.objects.using(P).filter(role=admin_role).count()
        check("the workspace was onboarded: its Workspace Admin holds every permission", granted == Permission.objects.using(P).count() and granted >= 16,
              f"{granted} of {Permission.objects.using(P).count()}")
        plan = TenantSubscription.objects.using(P).get(tenant=tenant).plan
        insights = SubscriptionPlan.objects.using(P).filter(code="INSIGHTS").exists()
        check("on the Insights plan where the database has it (patch 0072)", plan.code == "INSIGHTS" or not insights, plan.code)

    with mock.patch("apps.identity.management.commands.create_platform_admin.getpass", side_effect=["Tidal-Harbour-Lantern-42", "Tidal-Harbour-Lantern-42"]):
        call_command("create_platform_admin", EMAIL)
    user.refresh_from_db(using=P)
    check("running it again keeps one user and one workspace, and sets the password typed twice",
          AppUser.objects.using(P).filter(email=EMAIL).count() == 1 and Tenant.objects.using(P).filter(code="PLATFORM").count() == 1
          and user.check_password("Tidal-Harbour-Lantern-42"))

    with mock.patch("apps.identity.management.commands.create_platform_admin.getpass", side_effect=["short", "short", "a", "b", "", ""]):
        call_command("create_platform_admin", EMAIL)
    user.refresh_from_db(using=P)
    check("a weak password or two that differ are asked again; an empty one keeps the password", user.check_password("Tidal-Harbour-Lantern-42"))
    check.done()


def test_an_email_of_another_workspace_is_refused(check, admin_email):
    with pytest.raises(CommandError) as refused:
        call_command("create_platform_admin", admin_email, "--no-password")
    check("an email that belongs to another workspace is refused, naming it", "already belongs to the workspace" in str(refused.value), str(refused.value))
    user = AppUser.objects.using(P).get(email=admin_email)
    check("and that user is left in its own workspace", Tenant.objects.using(P).get(pk=user.tenant_id).code != "PLATFORM")
    check.done()
