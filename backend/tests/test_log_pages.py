"""The call log endpoint paged: count, page, page_size; sizes offered; filters still apply. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.integrations.models import IntegrationLog
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_log_pages(check):
    """The call log endpoint paged: count, page, page_size; sizes offered; filters still apply. Rolled back."""
    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email="aby.john@aiintelekt.com")
    context.reset_platform(ptok)
    context.set_current(str(tenant.id), "default", str(user.pk))
    T = str(tenant.id)
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
                cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(user.pk)])
            for index in range(30):                                                             # thirty calls of our own, a third of them failed
                logbook.record(tenant_id=T, integration=None, direction="OUT" if index % 2 else "IN", kind="PROVIDER", system="POSTAL", method="POST",
                               url=f"https://engine.test/send/{index}", outcome="OK" if index % 3 else "ERROR", response_status=200 if index % 3 else 500)
            total = IntegrationLog.objects.filter(tenant_id=T).count()
            check("thirty calls were written for the test", total >= 30, str(total))

            r = API.get("/api/v1/integrations/log/")
            body = r.json() if r.status_code == 200 else {}
            check("the first page by default: 25 rows at most, the count, page 1", r.status_code == 200 and body.get("page") == 1 and body.get("page_size") == 25
                  and body.get("count") == total and len(body.get("results", [])) == min(25, total), f"{r.status_code} count={body.get('count')} rows={len(body.get('results', []))} total={total}")
            r = API.get("/api/v1/integrations/log/?page_size=10")
            body = r.json()
            check("ten rows a page when asked", body["page_size"] == 10 and len(body["results"]) == min(10, total), f"{body['page_size']} {len(body['results'])}")
            r2 = API.get("/api/v1/integrations/log/?page_size=10&page=2").json()
            check("page 2 carries the next rows, none of page 1's", r2["page"] == 2 and (total <= 10 or (len(r2["results"]) == min(10, total - 10)
                  and not {row["id"] for row in r2["results"]} & {row["id"] for row in body["results"]})), f"{len(r2['results'])}")
            r = API.get("/api/v1/integrations/log/?page_size=7").json()
            check("a size not offered falls back to the default", r["page_size"] == 25)
            r = API.get("/api/v1/integrations/log/?page=0").json()
            check("page 0 reads as page 1", r["page"] == 1)
            r = API.get("/api/v1/integrations/log/?page=abc")
            check("a page that is not a number is refused (400)", r.status_code == 400, f"{r.status_code}")
            r = API.get("/api/v1/integrations/log/?failed=1&page_size=100").json()
            check("the filters still apply with the paging: Failures Only lists no OK call", all(row["outcome"] != "OK" for row in r["results"])
                  and r["count"] == IntegrationLog.objects.filter(tenant_id=T).exclude(outcome="OK").count(), f"{r['count']}")
            beyond = API.get(f"/api/v1/integrations/log/?page={total // 25 + 5}").json()
            check("a page past the end is empty, with the count", beyond["results"] == [] and beyond["count"] == total)
            raise RuntimeError("rollback")
    except RuntimeError as exc:
        if str(exc) != "rollback":
            raise
    check.done()
