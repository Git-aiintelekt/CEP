"""Sign-in hardening: a refresh token works once (two tabs racing within the grace both get through, a later reuse is
refused), signing out ends it; single sign-on hands the tokens only to the browser that started the sign-in. Rolled back."""
import json
from unittest import mock
from urllib.parse import parse_qs, urlparse

import pytest
from django.core.signing import TimestampSigner
from django.test import Client
from rest_framework_simplejwt.tokens import RefreshToken

from api.v1 import auth_api
from apps.identity.models import AppUser
from apps.platform_ops import sso
from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _admin(admin_email):
    tok = context.set_platform(True)
    try:
        return AppUser.objects.select_related("tenant").get(email=admin_email)
    finally:
        context.reset_platform(tok)


def test_refresh_once(check, admin_email):
    admin = _admin(admin_email)
    client = Client()

    def refresh(token):
        return client.post("/api/v1/auth/token/refresh/", json.dumps({"refresh": token}), content_type="application/json", HTTP_X_TENANT=admin.tenant.code)

    first = str(RefreshToken.for_user(admin))
    answer = refresh(first)
    check("a refresh token gives a new pair", answer.status_code == 200 and answer.json().get("refresh") not in (None, first), answer.content[:200])
    check("the same token again within the grace (a second tab) still works", refresh(first).status_code == 200)
    later = auth_api.time.time() + auth_api.REUSE_GRACE + 5
    with mock.patch.object(auth_api.time, "time", return_value=later):
        reused = refresh(first)
    check("reused after the grace it is refused", reused.status_code == 401, reused.content[:200])
    check("the token it was rotated into still works", refresh(answer.json()["refresh"]).status_code == 200)

    second = str(RefreshToken.for_user(admin))
    revoked = client.post("/api/v1/auth/token/revoke/", json.dumps({"refresh": second}), content_type="application/json", HTTP_X_TENANT=admin.tenant.code)
    check("signing out ends the refresh token at once", revoked.status_code == 204 and refresh(second).status_code == 401, revoked.status_code)
    junk = client.post("/api/v1/auth/token/revoke/", json.dumps({"refresh": "not-a-token"}), content_type="application/json", HTTP_X_TENANT=admin.tenant.code)
    check("revoking something unusable is quietly fine", junk.status_code == 204)
    check.done()


def test_sso_hand_off(check, admin_email):
    admin = _admin(admin_email)
    code = admin.tenant.code
    provider = mock.Mock(issuer="https://idp.example", client_id="cep", scopes="openid email")
    with mock.patch.object(sso, "discovery", return_value={"authorization_endpoint": "https://idp.example/authorize"}), \
            mock.patch.object(sso, "redirect_uri", return_value="https://api.example/api/v1/auth/sso/callback/"):
        url = sso.start(provider, code, "/reports", "browser-binding-0123456789")
    state = parse_qs(urlparse(url).query)["state"][0]
    nonce = TimestampSigner(salt="cep.sso.state").unsign(state).split(":", 1)[1]
    pending = sso.cache.get(f"cep:sso:{nonce}")
    check("start keeps a digest of the browser's binding, never the binding itself", pending and pending["binding"] == sso._digest("browser-binding-0123456789")
          and "browser-binding" not in json.dumps(pending), str(pending))

    tokens = {"access": "access-token", "refresh": "refresh-token"}
    identity = {"next": "/reports", "binding": sso._digest("browser-binding-0123456789")}
    stolen = sso.hand_off(tokens, code, identity)
    check("another browser (no binding, or a different one) gets nothing", sso.take(stolen, "", code) is None)
    stolen = sso.hand_off(tokens, code, identity)
    check("a different binding gets nothing, and the code is spent", sso.take(stolen, "other-browser-binding", code) is None
          and sso.take(stolen, "browser-binding-0123456789", code) is None)
    own = sso.hand_off(tokens, code, identity)
    check("the code is for its own workspace only", sso.take(own, "browser-binding-0123456789", "OTHER") is None)

    client = Client()

    def exchange(one_time, binding):
        return client.post("/api/v1/auth/sso/exchange/", json.dumps({"code": one_time, "binding": binding}), content_type="application/json", HTTP_X_TENANT=code)

    refused = exchange(sso.hand_off(tokens, code, identity), "someone-elses-binding")
    check("the exchange refuses a link started in another browser", refused.status_code == 401 and "this browser" in refused.json().get("detail", ""), refused.content[:200])
    taken = exchange(sso.hand_off(tokens, code, identity), "browser-binding-0123456789")
    check("the browser that started the sign-in gets its tokens and where to go", taken.status_code == 200
          and taken.json() == {"access": "access-token", "refresh": "refresh-token", "next": "/reports"}, taken.content[:200])
    check.done()
