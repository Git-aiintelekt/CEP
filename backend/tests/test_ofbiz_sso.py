"""Single sign-on and single logout from OFBiz: "Open CEP" signs the user in without MFA for at most 8 hours, each OFBiz
token works once and only for its own workspace, and signing out of OFBiz ends the sessions opened from it (and only those).
iCRM owns the login and the role: the first launch creates the CEP user (no password), every launch sets their role.
Rolled back."""
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest import mock
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.db import connections
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from api.v1 import auth_api
from apps.identity.models import AppUser, Role, UserRole
from apps.platform_ops import crypto, ofbiz
from apps.platform_ops.multipass import MultipassTokenEncode
from apps.platform_ops.models import TenantOfbizLink
from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

KEYS = {"site_key": "test-site-key-0123456789", "api_key": "test-api-key-abcdefghij"}
ICRM_TIME_ZONE = "Asia/Kolkata"
ROLES = {"ANALYST": "OFBiz Test Analyst", "CAMPAIGN_MANAGER": "OFBiz Test Manager"}
STORED_KEYS = json.dumps({**KEYS, "time_zone": ICRM_TIME_ZONE, "roles": ROLES})


def _admin(admin_email):
    tok = context.set_platform(True)
    try:
        return AppUser.objects.select_related("tenant").get(email=admin_email)
    finally:
        context.reset_platform(tok)


def _link(tenant, stored=STORED_KEYS, *, active=True):
    """The workspace's tenant_ofbiz_link row, as the seed writes it: the keys in plain text; and the roles it maps to."""
    with connections["default"].cursor() as cursor:                  # row-level security, within the test's transaction
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.id)])
    for name in ROLES.values():
        Role.objects.using("default").get_or_create(tenant_id=tenant.id, name=name)
    TenantOfbizLink.objects.using("default").update_or_create(tenant_id=tenant.id, defaults={"secret_enc": stored, "is_active": active})


def _expires(minutes, zone=ICRM_TIME_ZONE):
    return (datetime.now(ZoneInfo(zone)) + timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M")


def _ofbiz_token(email, tenant="default", *, keys=KEYS, minutes=5, **overrides):
    """What iCRM's UtilCommon.getCepSSOToken sends (getSSOToken plus cep_role and display_name): expiry in iCRM's time zone,
    no jti, no audience. The logout sends the same."""
    data = {"user_login_id": "sharmila", "version": "1.0", "tenant_id": tenant, "expires": _expires(minutes), "email": email,
            "cep_role": "ANALYST", "display_name": "Sharmila K", **overrides}
    return MultipassTokenEncode(keys["site_key"], keys["api_key"]).encode(data)


def _fragment(response):
    return parse_qs(urlparse(response["Location"]).fragment)


def test_ofbiz_launch_and_logout(check, admin_email):
    cache.clear()
    admin = _admin(admin_email)
    _link(admin.tenant)
    code = admin.tenant.code
    client = Client()

    def launch(token):
        return client.get("/api/v1/auth/sso/ofbiz/", {"tenant": code, "token": token})

    def exchange(one_time):
        return client.post("/api/v1/auth/sso/ofbiz/exchange/", json.dumps({"code": one_time}), content_type="application/json", HTTP_X_TENANT=code)

    def me(access):
        return client.get("/api/v1/me/", HTTP_X_TENANT=code, HTTP_AUTHORIZATION=f"Bearer {access}")

    def refresh(token):
        return client.post("/api/v1/auth/token/refresh/", json.dumps({"refresh": token}), content_type="application/json", HTTP_X_TENANT=code)

    def logout(token):
        return client.post(f"/api/v1/auth/sso/ofbiz/logout/?tenant={code}", json.dumps({"token": token}), content_type="application/json")

    token = _ofbiz_token(admin.email.upper() + " ", code)
    landed = launch(token)
    fragment = _fragment(landed)
    check("a good OFBiz link lands on /launch with a one-time code", landed.status_code == 302 and "/launch#" in landed["Location"]
          and fragment.get("tenant") == [code] and fragment.get("code"), landed.get("Location"))
    stored = TenantOfbizLink.objects.using("default").get(tenant_id=admin.tenant.id).secret_enc
    check("keys seeded as plain text are encrypted on first use", stored.startswith(ofbiz.SEALED_PREFIX) and crypto.decrypt(stored) == STORED_KEYS)
    reused = _fragment(launch(token))
    check("getSSOToken has no jti: the same link works again until it expires", "/launch#" in landed["Location"] and reused.get("code"), reused)

    tokens = exchange(fragment["code"][0])
    check("the code gives the tokens and Campaigns", tokens.status_code == 200 and tokens.json().get("next") == "/campaigns", tokens.content[:200])
    check("the code works once", exchange(fragment["code"][0]).status_code == 401)
    pair = tokens.json()
    access, refresh_token = AccessToken(pair["access"]), RefreshToken(pair["refresh"])
    check("no MFA restriction on an OFBiz session", "mfa_setup" not in access.payload and "mfa_setup" not in refresh_token.payload)
    check("the session lasts 8 hours, not 7 days", abs(refresh_token["exp"] - (refresh_token["ofbiz"] + 8 * 3600)) <= 5, refresh_token.payload)
    check("the access token carries the launch", access.get("ofbiz") == refresh_token["ofbiz"])
    check("the session works", me(pair["access"]).status_code == 200)

    later = time.time() + 7 * 3600
    with mock.patch.object(auth_api.time, "time", return_value=later), \
            mock.patch("rest_framework_simplejwt.tokens.aware_utcnow", return_value=datetime.fromtimestamp(later, timezone.utc)):
        rotated = refresh(pair["refresh"])
    check("a refresh 7 hours in still works", rotated.status_code == 200, rotated.content[:200])
    if rotated.status_code == 200:
        capped = RefreshToken(rotated.json()["refresh"], verify=False)
        check("rotation keeps the end at 8 hours after the launch", capped["exp"] <= refresh_token["ofbiz"] + 8 * 3600 + 1, capped.payload)

    password = auth_api.issue_tokens(admin)
    check("OpenID Connect and password sessions carry no OFBiz claim", "ofbiz" not in AccessToken(password["access"]).payload)

    check("a logout token that is not OFBiz's is refused", logout(_ofbiz_token(admin.email, code, keys={**KEYS, "api_key": "wrong"})).status_code == 401)
    check("a logout for nobody still answers 204", logout(_ofbiz_token("nobody@example.invalid", code)).status_code == 204)
    signed_out = logout(_ofbiz_token(admin.email, code))
    check("OFBiz's logout is accepted", signed_out.status_code == 204, signed_out.content[:200])

    ended = me(pair["access"])
    check("the OFBiz session ends at once, titled for the frontend", ended.status_code == 401 and ended.json().get("title") == "Ofbiz Signed Out", ended.content[:200])
    refused = refresh(pair["refresh"])
    check("and cannot be refreshed back", refused.status_code == 401 and refused.json().get("title") == "Ofbiz Signed Out", refused.content[:200])
    check("a password session of the same user goes on", me(password["access"]).status_code == 200)

    again = _fragment(launch(_ofbiz_token(admin.email, code)))
    fresh = exchange(again["code"][0]).json()
    check("opening CEP from OFBiz again after the logout works", me(fresh["access"]).status_code == 200)
    check.done()


def test_ofbiz_launch_refusals(check, admin_email):
    cache.clear()
    admin = _admin(admin_email)
    _link(admin.tenant)
    code = admin.tenant.code
    client = Client()

    def error(token, tenant=code):
        response = client.get("/api/v1/auth/sso/ofbiz/", {"tenant": tenant, "token": token})
        return response.status_code == 302 and "/login#" in response["Location"] and (_fragment(response).get("sso_error") or [""])[0]

    check("a token sealed with other keys", "invalid or has expired" in error(_ofbiz_token(admin.email, code, keys={**KEYS, "site_key": "x" * 20})))
    check("a damaged token", "invalid or has expired" in error(_ofbiz_token(admin.email, code)[:-6]))
    check("an expired token", "invalid or has expired" in error(_ofbiz_token(admin.email, code, minutes=-5)))
    check("expiry is read in iCRM's time zone, not CEP's", "invalid or has expired" in error(_ofbiz_token(admin.email, code, expires=_expires(5, "UTC"))))
    check("a logout token used as a launch", "invalid or has expired" in error(_ofbiz_token(admin.email, code, aud="cep-logout")))
    check("no token", "invalid or has expired" in error(""))
    check("a token without an email", "invalid or has expired" in error(_ofbiz_token(admin.email, code, email="")))
    once = _ofbiz_token(admin.email, code, jti=str(uuid.uuid4()))
    check("a token that carries a jti works once", "sso_error" not in (error(once) or "") and "already used" in error(once))
    check("a token without a CEP role", "don't have a CEP role" in error(_ofbiz_token(admin.email, code, cep_role="")))
    check("a CEP role the workspace does not have", "no matching role" in error(_ofbiz_token(admin.email, code, cep_role="OWNER")))
    _link(admin.tenant, "a-secret-from-before-the-multipass-tokens-0123456789")
    check("a stored value that is not the keys and time zone", "not set up" in error(_ofbiz_token(admin.email, code)))
    _link(admin.tenant, json.dumps(KEYS))
    check("keys without the iCRM time zone", "not set up" in error(_ofbiz_token(admin.email, code)))
    _link(admin.tenant, active=False)
    check("switched off for the workspace", "not set up" in error(_ofbiz_token(admin.email, code)))
    TenantOfbizLink.objects.using("default").filter(tenant_id=admin.tenant.id).delete()
    check("not set up without a row", "not set up" in error(_ofbiz_token(admin.email, code)))
    check("a next that leaves the site falls back to Campaigns", ofbiz.safe_next("//evil.example") == "/campaigns" and ofbiz.safe_next("/journeys") == "/journeys")
    check.done()


def _platform_user(email):
    tok = context.set_platform(True)
    try:
        user = AppUser.objects.filter(email__iexact=email).first()
        roles = sorted(UserRole.objects.filter(user=user).values_list("role__name", flat=True)) if user else []
        return user, roles
    finally:
        context.reset_platform(tok)


def test_ofbiz_launch_creates_the_user_and_sets_the_role(check, admin_email):
    cache.clear()
    admin = _admin(admin_email)
    _link(admin.tenant)
    code = admin.tenant.code
    client = Client()
    email = f"icrm-{uuid.uuid4().hex[:8]}@example.invalid"

    def launch(token):
        return client.get("/api/v1/auth/sso/ofbiz/", {"tenant": code, "token": token})

    def error(token):
        response = launch(token)
        return "/login#" in response["Location"] and (_fragment(response).get("sso_error") or [""])[0]

    check("an iCRM user with no CEP role is refused and not created", "don't have a CEP role" in error(_ofbiz_token(email, code, cep_role=""))
          and _platform_user(email)[0] is None)

    first = launch(_ofbiz_token(email.upper(), code, display_name="  New   Person "))
    check("the first Open CEP of an iCRM user signs them in", first.status_code == 302 and "/launch#" in first["Location"], first.get("Location"))
    user, roles = _platform_user(email)
    check("the CEP user is created with the email and name only", user is not None and user.email == email and user.display_name == "New Person"
          and user.tenant_id == admin.tenant.id and user.is_active, user and (user.email, user.display_name))
    check("CEP keeps no password for them", user is not None and not user.password and not user.has_usable_password())
    check("with the role iCRM sent", roles == [ROLES["ANALYST"]], roles)

    again = launch(_ofbiz_token(email, code, cep_role="campaign_manager"))
    user_again, roles = _platform_user(email)
    check("the next Open CEP signs in the same user", "/launch#" in again["Location"] and user_again.pk == user.pk)
    check("and replaces the role with iCRM's current one", roles == [ROLES["CAMPAIGN_MANAGER"]], roles)

    check("a refused role leaves the user's role as it was", "no matching role" in error(_ofbiz_token(email, code, cep_role="OWNER"))
          and _platform_user(email)[1] == [ROLES["CAMPAIGN_MANAGER"]])

    tok = context.set_platform(True)
    try:
        AppUser.objects.filter(pk=user.pk).update(is_active=False)
    finally:
        context.reset_platform(tok)
    check("a user deactivated in CEP stays out", "deactivated" in error(_ofbiz_token(email, code)))

    stranger = f"icrm-{uuid.uuid4().hex[:8]}@example.invalid"
    signed_out = client.post(f"/api/v1/auth/sso/ofbiz/logout/?tenant={code}", json.dumps({"token": _ofbiz_token(stranger, code)}),
                             content_type="application/json")
    check("an iCRM logout never creates a user", signed_out.status_code == 204 and _platform_user(stranger)[0] is None)
    check.done()
