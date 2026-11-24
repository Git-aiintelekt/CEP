"""The same person in several workspaces (docs/mockups/same-user-workspaces.html, option A; patch 0098): an account is Workspace ID +
email. The same address has an account in a Staging and a Production workspace, each with its own password; logging in to one
never opens the other; the back-office finds staff only; an address is used once per workspace and once among staff; Deactivate
in Every Workspace closes every account of an address; a workspace says whether it is Staging. Rolled back."""
import pytest
from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.db import IntegrityError, connections, transaction
from django.test import Client

from apps.identity.admin import AppUserForm
from apps.identity.models import AppUser
from apps.platform_ops import params
from apps.tenants import context
from apps.tenants.models import Tenant
from apps.tenants.onboarding import AdminForm

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS
EMAIL = "ana.diaz@same-user.test"


def _patched() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.ux_app_user_tenant_email') IS NOT NULL")
        return cursor.fetchone()[0]


def _workspace(code: str, environment: str) -> Tenant:
    made = Tenant.objects.using(P).create(name=f"Same User {code}", code=code, environment=environment)
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [str(made.pk)])
    return made


def _account(tenant: Tenant, password: str, **extra) -> AppUser:
    user = AppUser(tenant=tenant, email=EMAIL, display_name="Ana Diaz", is_active=True, **extra)
    user.set_password(password)
    user.save(using=P)
    return user


def test_one_address_two_workspaces_two_passwords(check, monkeypatch):
    if not _patched():
        pytest.skip("patch 0098 has not been applied to this database")
    token = context.set_platform(True)
    try:
        staging, production = _workspace("ZZSAMESTG", "STAGING"), _workspace("ZZSAMEPRD", "PRODUCTION")
        in_staging, in_production = _account(staging, "staging-password-1"), _account(production, "production-password-2")
        check("the same address has an account in each workspace", AppUser.objects.using(P).filter(email=EMAIL).count() == 2)

        found = authenticate(None, email=EMAIL, password="staging-password-1", tenant_id=staging.pk)
        check("Staging's password logs in to Staging", found is not None and found.pk == in_staging.pk)
        check("Production's password does not log in to Staging", authenticate(None, email=EMAIL, password="production-password-2", tenant_id=staging.pk) is None)
        found = authenticate(None, email=EMAIL.upper(), password="production-password-2", tenant_id=production.pk)
        check("Production's password logs in to Production, whatever the case of the address", found is not None and found.pk == in_production.pk)
        check("the back-office (no workspace) does not let an ordinary account in", authenticate(None, username=EMAIL, password="production-password-2") is None)

        try:
            with transaction.atomic(using=P):
                _account(staging, "another-password-3")
            check("a second account for the address in the same workspace is refused", False)
        except IntegrityError:
            check("a second account for the address in the same workspace is refused", True)

        form = AppUserForm(data={"tenant": str(staging.pk), "email": EMAIL, "display_name": "Ana Again", "auth_provider": "LOCAL", "is_active": "on"})
        check("the back-office form says so instead of failing", not form.is_valid() and "already has an account in this workspace" in str(form.errors.get("email")), form.errors)
        other = _workspace("ZZSAMEOTH", "PRODUCTION")
        form = AppUserForm(data={"tenant": str(other.pk), "email": EMAIL, "display_name": "Ana Diaz", "auth_provider": "LOCAL", "is_active": "on"})
        check("and takes the address for another workspace", form.is_valid(), form.errors)

        in_production.is_staff = True
        in_production.save(using=P, update_fields=["is_staff"])
        found = authenticate(None, username=EMAIL, password="production-password-2")
        check("a staff account logs in to the back-office by its address alone", found is not None and found.pk == in_production.pk)
        form = AppUserForm(data={"tenant": str(other.pk), "email": EMAIL, "display_name": "Ana Diaz", "auth_provider": "LOCAL", "is_active": "on", "is_staff": "on"})
        check("staff keep one address across the platform", not form.is_valid() and "back-office account" in str(form.errors.get("is_staff")), form.errors)
        try:
            with transaction.atomic(using=P):
                AppUser.objects.using(P).filter(pk=in_staging.pk).update(is_staff=True)
            check("the database refuses a second staff account for the address", False)
        except IntegrityError:
            check("the database refuses a second staff account for the address", True)

        check("onboarding takes a first administrator whose address has an account elsewhere",
              AdminForm(data={"display_name": "Ana Diaz", "email": EMAIL, "also_invite": ""}).is_valid())

        def on_platform(sql, args=()):                # the workspaces made here are visible on this test's platform connection only
            with connections[P].cursor() as cursor:
                cursor.execute(sql, args)
                return cursor.fetchall()
        monkeypatch.setattr(params, "_rows", on_platform)
        params.invalidate(staging.pk)
        params.invalidate(production.pk)
        check("a workspace says it is Staging or Production", params.context_for(staging.pk)["workspace"]["environment"] == "STAGING"
              and params.context_for(production.pk)["workspace"]["environment"] == "PRODUCTION")

        # someone who leaves: every account of the address, in every workspace
        staff = AppUser.objects.using(P).filter(is_staff=True, is_active=True).exclude(email=EMAIL).order_by("created_at").first()
        user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
        admin = Client()
        admin.force_login(staff)
        page = admin.post("/admin/identity/appuser/", {"action": "deactivate_everywhere", "_selected_action": [str(in_staging.pk)]})
        left = list(AppUser.objects.using(P).filter(email=EMAIL).values_list("tenant__code", "is_active").order_by("tenant__code"))
        check("Deactivate in Every Workspace closes the Staging and the Production account", page.status_code == 302 and left == [("ZZSAMEPRD", False), ("ZZSAMESTG", False)], f"{page.status_code} {left}")
        listed = admin.get(f"/admin/identity/appuser/?q={EMAIL}").content.decode()
        check("searching the address lists both accounts, with what each workspace is used for", listed.count(EMAIL) >= 2 and "Staging" in listed and "Production" in listed)
    finally:
        context.reset_platform(token)
    check.done()
