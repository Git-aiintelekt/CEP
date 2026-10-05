"""Tags: ${STORE_NAME} renders as {{store_name}}; the workspace API lists data points, makes and checks a tag, refuses to change an inherited one. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import uuid
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery.engine import render
from apps.identity.models import AppUser
from apps.templates import design
from apps.templates.models import PersonalizationTag
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_tags(check):
    """Tags: ${STORE_NAME} renders as {{store_name}}; the workspace API lists data points, makes and checks a tag, refuses to change an inherited one. Rolled back."""
    check("${STORE_NAME} and ${Trans_Id} read as {{store_name}} and {{trans_id}}; {{first_name}} is untouched",
          render.modern_tags("Hi {{first_name}}, ${STORE_NAME} ${ Trans_Id }") == "Hi {{first_name}}, {{store_name}} {{trans_id}}", render.modern_tags("Hi {{first_name}}, ${STORE_NAME} ${ Trans_Id }"))
    check("the designer's tag extraction sees them too", design.extract_tags("${STORE_NAME} and {{x}}") == ["store_name", "x"], str(design.extract_tags("${STORE_NAME} and {{x}}")))
    check("a JavaScript ${expr} with no tag shape is left alone", render.modern_tags("${1+1} ${}") == "${1+1} ${}")

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email="aby.john@aiintelekt.com")
    context.reset_platform(ptok)
    context.set_current(str(tenant.id), "default", str(user.pk))
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
            points = API.get("/api/v1/personalization-tags/data-points/").json()
            check("GET data-points: every source with its points, Transaction among them, Static apart",
                  {"sources", "static"} <= set(points) and any(s["key"] == "TRANSACTION" and any(p["path"] == "grand_total" for p in s["points"]) for s in points["sources"])
                  and any(p["prefix"] for s in points["sources"] if s["key"] == "CUSTOMER_MASTER" for p in s["points"]) and points["static"]["key"] == "STATIC",
                  str([s["key"] for s in points["sources"]]))
            key = f"t_{uuid.uuid4().hex[:6]}"
            made = API.post("/api/v1/personalization-tags/", {"tag_key": key, "label": "Test total", "resolution_source": "TRANSACTION", "source_path": "grand_total",
                                                               "data_type": "NUMBER", "applies_to_channels": ["E_RECEIPT"], "sample_value": "144.11"}, content_type="application/json")
            check("POST a workspace tag reading a transaction data point: CUSTOM / CEP by default, no platform link", made.status_code == 201 and made.json()["tag_kind"] == "CUSTOM"
                  and made.json()["source_system"] == "CEP" and not made.json().get("platform_tag_id"), f"{made.status_code} {str(made.json())[:160]}")
            bad = API.post("/api/v1/personalization-tags/", {"tag_key": "Bad Key", "label": "x", "resolution_source": "STORE", "source_path": "name", "applies_to_channels": ["EMAIL"]}, content_type="application/json")
            check("a key with capitals or spaces is refused on its field", bad.status_code == 400 and "tag_key" in bad.json().get("errors", {}), f"{bad.status_code} {bad.json()}")
            bad = API.post("/api/v1/personalization-tags/", {"tag_key": "nope_path", "label": "x", "resolution_source": "STORE", "source_path": "colour", "applies_to_channels": ["EMAIL"]}, content_type="application/json")
            check("a path the source does not offer is refused on source_path", bad.status_code == 400 and "source_path" in bad.json().get("errors", {}), f"{bad.status_code} {bad.json()}")
            dup = API.post("/api/v1/personalization-tags/", {"tag_key": key, "label": "again", "resolution_source": "STORE", "source_path": "name", "applies_to_channels": ["EMAIL"]}, content_type="application/json")
            check("the same key twice is refused", dup.status_code == 400 and "tag_key" in dup.json().get("errors", {}), str(dup.status_code))
            static = API.post("/api/v1/personalization-tags/", {"tag_key": f"s_{uuid.uuid4().hex[:6]}", "label": "Brand", "resolution_source": "STATIC", "static_value": "Northwind", "applies_to_channels": ["EMAIL"]}, content_type="application/json")
            check("a static tag needs no path and keeps its value", static.status_code == 201 and static.json()["static_value"] == "Northwind" and static.json()["source_path"] is None, f"{static.status_code}")
            changed = API.patch(f"/api/v1/personalization-tags/{made.json()['id']}/", {"label": "Store total"}, content_type="application/json")
            check("PATCH a workspace tag's label", changed.status_code == 200 and changed.json()["label"] == "Store total", str(changed.status_code))
            inherited = PersonalizationTag.objects.filter(tenant_id=tenant.id, platform_tag_id__isnull=False, is_active=True).first()
            if inherited is None:
                print("SKIP no inherited tag on NWA")
            else:
                refused = API.patch(f"/api/v1/personalization-tags/{inherited.pk}/", {"label": "x"}, content_type="application/json")
                check("an inherited tag is refused with the back-office message", refused.status_code == 403, f"{refused.status_code} {str(refused.json())[:120]}")
            gone = API.delete(f"/api/v1/personalization-tags/{made.json()['id']}/")
            check("DELETE a workspace tag", gone.status_code == 204, str(gone.status_code))
            raise RuntimeError("roll back")
    except RuntimeError as exc:
        if str(exc) != "roll back":
            raise
    check.done()
