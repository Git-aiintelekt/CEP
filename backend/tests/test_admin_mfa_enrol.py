"""The back-office's second factor: while security.mfa_required_for_staff is on, a staff member without an authenticator is
sent to set one up instead of being let in with the password alone; an enrolled one is asked for the code. Rolled back."""
from unittest import mock

import pytest
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.test import Client

from apps.identity.models import AppUser
from apps.platform_ops import params

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS


def _required(on: bool):
    real = params.get
    return mock.patch.object(params, "get", lambda key, default=None: on if key == "security.mfa_required_for_staff" else real(key, default))


def test_staff_without_an_authenticator_is_sent_to_set_one_up(check):
    staff = AppUser.objects.using(P).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
    if staff is None:
        pytest.skip("no platform superuser in this database")
    AppUser.objects.using(P).filter(pk=staff.pk).update(mfa_enabled=False)
    staff.refresh_from_db(using=P)
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        office = Client()
        office.force_login(staff)
        with _required(True):
            home = office.get("/admin/")
            check("required and not enrolled: every back-office page sends the staff member to set up", home.status_code == 302 and home["Location"] == "/admin/mfa/setup/",
                  f"{home.status_code} {home.get('Location')}")
            page = office.get("/admin/platform_ops/securityfinding/")
            check("deeper pages too", page.status_code == 302 and page["Location"] == "/admin/mfa/setup/")
            setup = office.get("/admin/mfa/setup/")
            body = setup.content.decode()
            check("the setup page says what to do and links to the app's Account Security", setup.status_code == 200 and "Set Up Two-Step Verification" in body
                  and settings.FRONTEND_URL.rstrip("/") + "/account/security" in body and "Sign Out" in body, f"{setup.status_code}")
        with _required(False):
            home = office.get("/admin/")
            check("not required: the back-office opens as before", home.status_code == 200, str(home.status_code))
            setup = office.get("/admin/mfa/setup/")
            check("and the setup page sends back to the back-office", setup.status_code == 302 and setup["Location"] == "/admin/", str(setup.status_code))

        AppUser.objects.using(P).filter(pk=staff.pk).update(mfa_enabled=True)
        enrolled = Client()
        enrolled.force_login(AppUser.objects.using(P).get(pk=staff.pk))
        with _required(True):
            home = enrolled.get("/admin/")
            check("enrolled: a new session is asked for the code, as before", home.status_code == 302 and home["Location"].startswith("/admin/mfa/?next="), home.get("Location"))
            setup = enrolled.get("/admin/mfa/setup/")
            check("an enrolled staff member is not sent to set up", setup.status_code == 302 and setup["Location"] == "/admin/", setup.get("Location"))
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    check.done()
