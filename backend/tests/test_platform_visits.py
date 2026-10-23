"""Switch Workspace (docs/mockups/switch-workspace.html, option B): a platform administrator enters NWA as themselves, giving a
reason; the visit's tokens work in NWA only while the visit is open, with every permission; the visit is recorded and listed
for NWA's administrators; Back to Platform and signing out end it. Rolled back."""
import json

import pytest
from django.conf import settings
from django.db import connections
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.identity.models import AppUser
from apps.platform_ops import visits
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

P = settings.PLATFORM_ALIAS


def _present() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.platform_visit') IS NOT NULL")
        return cursor.fetchone()[0]


def _platform_admin():
    home = Tenant.objects.using(P).create(name="Platform Test", code="PLTTEST")
    with connections[P].cursor() as cursor:                                       # its partitions, as onboarding makes them
        cursor.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [str(home.pk)])
    return AppUser.objects.using(P).create(email="platform.test@example.com", display_name="Platform Tester", tenant_id=home.pk, is_platform_admin=True, is_active=True)


def test_a_visit(check, admin_email):
    if not _present():
        pytest.skip("patch 0077 has not been applied to this database")
    visits.cache.delete("cep:platform-visit-present")
    staff = _platform_admin()
    token = context.set_platform(True)
    nwa_admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    # someone of NWA who is not a platform administrator (on a local copy the scenarios' administrator is the platform operator)
    ordinary = AppUser.objects.filter(tenant_id=nwa_admin.tenant_id, is_active=True, is_platform_admin=False).first()
    context.reset_platform(token)
    nwa = nwa_admin.tenant.code

    listed = visits.workspaces(staff, "")
    check("the list offers every workspace but the administrator's own", any(w["code"] == nwa for w in listed) and all(w["code"] != "PLTTEST" for w in listed), [w["code"] for w in listed])
    check("and searches by code or name", [w["code"] for w in visits.workspaces(staff, nwa.lower())][:1] == [nwa])
    for reason, words in (("", "few words"), ("hi", "few words")):
        try:
            visits.start(staff, nwa, reason, None)
            check(f"a reason of {reason!r} is refused", False)
        except Exception as exc:                                                   # noqa: BLE001
            check(f"a reason of {reason!r} is refused", words in json.dumps(getattr(exc, "detail", str(exc)), default=str))
    try:
        visits.start(ordinary, "PLTTEST", "Looking at the platform workspace", None)
        check("someone who is not a platform administrator cannot switch", False)
    except Exception as exc:                                                       # noqa: BLE001
        check("someone who is not a platform administrator cannot switch", "Only platform administrators" in str(exc))

    tokens = visits.start(staff, nwa, "Checking the demo before the customer call", "10.0.0.9")
    check("the visit gives tokens for the workspace, in the administrator's own name", tokens["tenant"] == nwa and AccessToken(tokens["access"])["sub"] == str(staff.pk)
          and AccessToken(tokens["access"])["visit"] == tokens["visit"])
    inside = Client(HTTP_X_TENANT=nwa, HTTP_AUTHORIZATION="Bearer " + tokens["access"])
    me = inside.get("/api/v1/me/")
    body = me.json()
    check("inside NWA the administrator is themselves, with every permission, and /me says it is a visit",
          me.status_code == 200 and body["principal"]["email"] == "platform.test@example.com" and body["tenant"]["code"] == nwa and "user.admin" in body["principal"]["permissions"]
          and body["platform_visit"]["home"] == "PLTTEST" and body["platform_visit"]["reason"] == "Checking the demo before the customer call", json.dumps(body)[:400])
    listed = inside.get("/api/v1/workspace/platform-visits/").json()
    check("the visit is listed for the workspace's administrators, open, with the reason", listed and listed[0]["who"] == "Platform Tester" and listed[0]["open"]
          and listed[0]["reason"] == "Checking the demo before the customer call", listed)
    check("a visit's token is refused for another workspace", visits.open_visit(tokens["visit"], staff.pk, staff.tenant_id) is None)
    check("switching again from inside a visit is refused: go back first", inside.get("/api/v1/platform/workspaces/").status_code == 403)
    nwa_client = Client(HTTP_X_TENANT=nwa, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(nwa_admin)))
    ordinary_client = Client(HTTP_X_TENANT=nwa, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(ordinary)))
    check("someone who is not a platform administrator cannot switch over the API", ordinary_client.post("/api/v1/platform/visits/", json.dumps({"workspace": "PLTTEST", "reason": "Just looking"}),
                                                                       content_type="application/json").status_code == 403)
    check("and reads their workspace's visits", nwa_client.get("/api/v1/workspace/platform-visits/").json()[0]["who"] == "Platform Tester")

    refreshed = Client(HTTP_X_TENANT=nwa).post("/api/v1/auth/token/refresh/", json.dumps({"refresh": tokens["refresh"]}), content_type="application/json")
    check("the visit's refresh works inside NWA while the visit is open", refreshed.status_code == 200 and AccessToken(refreshed.json()["access"])["visit"] == tokens["visit"],
          str(refreshed.content[:300]))
    ended = inside.post("/api/v1/auth/visit/end/")
    check("Back to Platform ends the visit", ended.status_code == 204)
    check("after which its tokens are refused", inside.get("/api/v1/me/").status_code == 401
          and Client(HTTP_X_TENANT=nwa).post("/api/v1/auth/token/refresh/", json.dumps({"refresh": refreshed.json()["refresh"]}), content_type="application/json").status_code == 401)
    check("and the list shows it ended", nwa_client.get("/api/v1/workspace/platform-visits/").json()[0]["open"] is False)

    again = visits.start(staff, nwa, "A second look after the call", None)
    Client(HTTP_X_TENANT=nwa).post("/api/v1/auth/token/revoke/", json.dumps({"refresh": again["refresh"]}), content_type="application/json")
    check("signing out of a visit ends it too", visits.open_visit(again["visit"], staff.pk) is None)
    check.done()
