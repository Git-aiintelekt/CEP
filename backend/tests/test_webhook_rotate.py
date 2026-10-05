"""Rotate Callback Address: the old address stops working at once, the new one is what the engine card shows. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from api.v1.delivery_api import WEBHOOK_KEY, webhook_token
from apps.delivery.models import DeliveryProvider
from apps.identity.models import AppUser
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_webhook_rotate(check):
    """Rotate Callback Address: the old address stops working at once, the new one is what the engine card shows. Rolled back."""
    class Roll(Exception):
        pass

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email="aby.john@aiintelekt.com")
    context.reset_platform(ptok)
    tok = context.set_current(str(tenant.id), "default", str(user.pk))
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    PUBLIC = Client()
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
            provider = DeliveryProvider.objects.get(tenant_id=tenant.id, provider_type="POSTAL", deleted_at__isnull=True)
            before = API.get(f"/api/v1/delivery-providers/{provider.pk}/").json()["webhook_url"]
            old_token = webhook_token(provider)
            check("the first address is the id-only token (older engines keep their address)", before.endswith(f"/{old_token}/") and not (provider.config or {}).get(WEBHOOK_KEY))
            path = before.split("/api/v1", 1)[1]
            answer = PUBLIC.post(f"/api/v1{path}", data="{}", content_type="application/json")
            check("the current address is accepted (an empty body is counted, nothing applied)", answer.status_code == 200 and answer.json().get("received") == 0, f"{answer.status_code} {answer.content[:80]}")

            rotated = API.post(f"/api/v1/delivery-providers/{provider.pk}/rotate-webhook/")
            after = rotated.json().get("webhook_url")
            provider.refresh_from_db()
            check("rotating answers the engine with a new address, stored as a rotation key in its config",
                  rotated.status_code == 200 and after and after != before and (provider.config or {}).get(WEBHOOK_KEY) and after.endswith(f"/{webhook_token(provider)}/"), f"{rotated.status_code} {str(rotated.content)[:100]}")
            check("the old address answers 404 from now on", PUBLIC.post(f"/api/v1{path}", data="{}", content_type="application/json").status_code == 404)
            new_path = after.split("/api/v1", 1)[1]
            check("the new address is accepted", PUBLIC.post(f"/api/v1{new_path}", data="{}", content_type="application/json").status_code == 200)
            again = API.post(f"/api/v1/delivery-providers/{provider.pk}/rotate-webhook/").json()["webhook_url"]
            check("rotating again changes it again", again != after and again != before)
            check("the card lists the same address the rotation answered", API.get(f"/api/v1/delivery-providers/{provider.pk}/").json()["webhook_url"] == again)
            smtp = DeliveryProvider.objects.filter(tenant_id=tenant.id, provider_type="SMTP", deleted_at__isnull=True).first()
            if smtp:
                refused = API.post(f"/api/v1/delivery-providers/{smtp.pk}/rotate-webhook/")
                check("an engine without callbacks cannot be rotated", refused.status_code == 400 and "no callbacks" in str(refused.json()))
            raise Roll
    except Roll:
        pass
    finally:
        context.reset(tok)
    check.done()
