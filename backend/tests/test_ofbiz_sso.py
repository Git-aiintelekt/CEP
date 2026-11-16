"""Single sign-on and single logout from OFBiz: "Open CEP" signs the user in without MFA for at most 8 hours, each OFBiz
token works once and only for its own workspace, and signing out of OFBiz ends the sessions opened from it (and only those).
Rolled back."""
import json
import time
import uuid
from datetime import datetime, timezone
from unittest import mock
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from django.core.cache import cache
from django.db import connections
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from api.v1 import auth_api
from apps.identity.models import AppUser
from apps.platform_ops import crypto, ofbiz
from apps.platform_ops.models import TenantOfbizLink
from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

SECRET = "test-ofbiz-secret-0123456789-abcdefghijklmnop"


def _admin(admin_email):
    tok = context.set_platform(True)
    try:
        return AppUser.objects.select_related("tenant").get(email=admin_email)
    finally:
        context.reset_platform(tok)


def _link(tenant, secret=SECRET, *, active=True):
    """The workspace's tenant_ofbiz_link row, as the seed writes it: the secret in plain text."""
    with connections["default"].cursor() as cursor:                  # row-level security, within the test's transaction
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.id)])
    TenantOfbizLink.objects.using("default").update_or_create(tenant_id=tenant.id, defaults={"secret_enc": secret, "is_active": active})


def _ofbiz_token(email, tenant, *, audience="cep", secret=SECRET, **overrides):
    now = int(time.time())
    claims = {"iss": "ofbiz-icrm", "aud": audience, "iat": now, "exp": now + 60, "jti": uuid.uuid4().hex, "sub": "sharmila",
              "party_id": "10001", "email": email, "tenant": tenant, "next": "/campaigns", **overrides}
    return jwt.encode(claims, secret, algorithm="HS256")


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
    check("a secret seeded as plain text is encrypted on first use", stored.startswith(ofbiz.SEALED_PREFIX) and crypto.decrypt(stored) == SECRET)
    reused = _fragment(launch(token))
    check("the same OFBiz link a second time is refused", "already used" in (reused.get("sso_error") or [""])[0], reused)

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

    check("a logout token that is not OFBiz's is refused", logout(_ofbiz_token(admin.email, code, audience="cep-logout", secret="wrong" * 10)).status_code == 401)
    check("a launch token is not a logout token", logout(_ofbiz_token(admin.email, code)).status_code == 401)
    check("a logout for nobody still answers 204", logout(_ofbiz_token("nobody@example.invalid", code, audience="cep-logout")).status_code == 204)
    signed_out = logout(_ofbiz_token(admin.email, code, audience="cep-logout"))
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

    check("a token signed with another secret", "invalid or has expired" in error(_ofbiz_token(admin.email, code, secret="x" * 40)))
    check("an expired token", "invalid or has expired" in error(_ofbiz_token(admin.email, code, iat=int(time.time()) - 600, exp=int(time.time()) - 300)))
    check("a token for another workspace", "invalid or has expired" in error(_ofbiz_token(admin.email, "OTHER")))
    check("a logout token used as a launch", "invalid or has expired" in error(_ofbiz_token(admin.email, code, audience="cep-logout")))
    check("no token", "invalid or has expired" in error(""))
    check("an email with no CEP account", "No active CEP account" in error(_ofbiz_token("nobody@example.invalid", code)))
    _link(admin.tenant, active=False)
    check("switched off for the workspace", "not set up" in error(_ofbiz_token(admin.email, code)))
    TenantOfbizLink.objects.using("default").filter(tenant_id=admin.tenant.id).delete()
    check("not set up without a row", "not set up" in error(_ofbiz_token(admin.email, code)))
    check("a next that leaves the site falls back to Campaigns", ofbiz.safe_next("//evil.example") == "/campaigns" and ofbiz.safe_next("/journeys") == "/journeys")
    check.done()
