"""Removing or switching off a workspace's single sign-on never locks its people out: removing it turns its single sign-on users
into password users, and while it is off they can be sent a password link, which makes them password users. While it is on,
they still cannot get one. Rolled back."""
import json

import pytest
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.identity.models import AppUser
from apps.platform_ops import params, sso
from apps.platform_ops.models import TenantIdentityProvider
from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _sso_user(tenant_id, email, sub):
    return AppUser.objects.create(tenant_id=tenant_id, email=email, display_name="Single Sign-On Person", auth_provider="OIDC", external_subject_id=sub, is_active=True)


def test_single_sign_on_off_or_removed_never_locks_people_out(check, admin_email):
    token = context.set_platform(True)
    admin = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    context.reset_platform(token)
    tenant_id, code = str(admin.tenant_id), admin.tenant.code
    context.set_current(tenant_id, "default", str(admin.pk))
    office = Client(HTTP_X_TENANT=code, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(admin)))
    link = lambda user: office.post(f"/api/v1/users/{user.pk}/password-link/", json.dumps({}), content_type="application/json")  # noqa: E731
    with transaction.atomic(using="default"), transaction.atomic(using="platform"):
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [tenant_id])
            cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(admin.pk)])
        TenantIdentityProvider.objects.filter(tenant_id=tenant_id).delete()
        provider = TenantIdentityProvider.objects.create(tenant_id=tenant_id, issuer="https://login.example.com", client_id="cep-test", is_active=True)
        person = _sso_user(tenant_id, "sso.person@example.com", "sub-1")

        check("while single sign-on is on, its users get no password link", link(person).status_code == 409)

        TenantIdentityProvider.objects.filter(pk=provider.pk).update(is_active=False)
        given = link(person)
        check("switched off, an administrator can send them a password link", given.status_code == 200, given.content[:300])
        if given.status_code == 200:
            query = dict(part.split("=", 1) for part in given.json()["path"].split("?", 1)[1].split("&"))
            chosen = Client(HTTP_X_TENANT=code).post("/api/v1/auth/set-password/", json.dumps({"uid": query["uid"], "token": query["token"], "password": "A-long-new-password-2026"}),
                                                     content_type="application/json")
            check("the link works", chosen.status_code == 204, chosen.content[:300])
            person = AppUser.objects.get(pk=person.pk)
            check("and they are a password user from then on", person.auth_provider == "LOCAL" and person.external_subject_id is None and person.has_usable_password())

        TenantIdentityProvider.objects.filter(pk=provider.pk).update(is_active=True)
        other = _sso_user(tenant_id, "sso.other@example.com", "sub-2")
        if params.enabled(tenant_id, "sso"):
            removed = office.put("/api/v1/workspace/security/", json.dumps({"identity_provider": None}), content_type="application/json")
            check("Remove takes the workspace's single sign-on away", removed.status_code == 200 and not TenantIdentityProvider.objects.filter(tenant_id=tenant_id).exists(),
                  removed.content[:300])
        else:                                                                   # a workspace without the feature: the same step, directly
            TenantIdentityProvider.objects.filter(pk=provider.pk).delete()
            sso.release_users(tenant_id)
        other = AppUser.objects.get(pk=other.pk)
        check("after Remove its users are password users", other.auth_provider == "LOCAL" and other.external_subject_id is None)
        check("and can be sent a password link", link(other).status_code == 200)
        transaction.set_rollback(True, using="default")
        transaction.set_rollback(True, using="platform")
    check.done()
