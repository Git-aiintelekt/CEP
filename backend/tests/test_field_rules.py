"""GET /field-rules/: every registered resource builds, the lengths match the tables, and the server still refuses what the client would. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
import uuid
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from api.v1 import field_rules
from apps.identity.models import AppUser
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_field_rules(check):
    """GET /field-rules/: every registered resource builds, the lengths match the tables, and the server still refuses what the client would. Rolled back."""
    built = {}
    for name, cls in field_rules.RESOURCES.items():
        try:
            built[name] = field_rules.rules_for(cls)
        except Exception as exc:  # noqa: BLE001
            print("  build error", name, repr(exc)[:200])
    check("every registered resource builds its rules", set(built) == set(field_rules.RESOURCES), str(sorted(set(field_rules.RESOURCES) - set(built))))
    campaign = built.get("campaign", {})
    check("campaign.name: string, max 200, required, from the campaign table", campaign.get("name", {}).get("max") == 200 and campaign["name"]["required"] and campaign["name"]["column"]["table"] == "campaign",
          json.dumps(campaign.get("name"))[:200])
    check("campaign.code: max 40", campaign.get("code", {}).get("max") == 40, json.dumps(campaign.get("code"))[:160])
    check("campaign.description: text column, no limit", "description" in campaign and campaign["description"].get("max") is None, json.dumps(campaign.get("description"))[:160])
    check("campaign.preheader: max 300", campaign.get("preheader", {}).get("max") == 300, json.dumps(campaign.get("preheader"))[:120])
    check("a choice field lists its choices", any(rule.get("type") == "choice" and rule.get("choices") for rule in campaign.values()), str([k for k, r in campaign.items() if r.get("type") == "choice"]))
    check("a plain Serializer resource (not model-backed) reports its fields too", "name" in built.get("new_contact_list", {}), str(sorted(built.get("new_contact_list", {})))[:160])
    template = built.get("template", {})
    check("template.name: max 200", template.get("name", {}).get("max") == 200, json.dumps(template.get("name"))[:120])
    tag = built.get("personalization_tag", {})
    check("personalization_tag has tag_key and label with limits", tag.get("tag_key", {}).get("max") and tag.get("label", {}).get("max"), f"{tag.get('tag_key', {}).get('max')} / {tag.get('label', {}).get('max')}")
    check("read-only fields and the primary key are left out", "id" not in campaign and "created_at" not in campaign and not any("id" in r for r in built.values()))
    check("every rule names a type", all("type" in r for res in built.values() for r in res.values()))

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
            got = API.get("/api/v1/field-rules/")
            check("GET /field-rules/ answers 200 with the resources and a private one-hour cache", got.status_code == 200 and "campaign" in got.json()["resources"] and "max-age=3600" in got["Cache-Control"],
                  f"{got.status_code} {got.get('Cache-Control')}")
            anon = Client(HTTP_X_TENANT=tenant.code).get("/api/v1/field-rules/")
            check("and needs a login", anon.status_code == 401, str(anon.status_code))
            too_long = API.post("/api/v1/campaigns/", {"name": "x" * 201, "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "code": f"T{uuid.uuid4().hex[:8].upper()}"}, content_type="application/json")
            body = too_long.json() if too_long.status_code == 400 else {}
            check("the server refuses a 201-character campaign name on the field", too_long.status_code == 400 and "name" in (body.get("errors") or {}), f"{too_long.status_code} {str(too_long.content)[:160]}")
            bad_code = API.post("/api/v1/campaigns/", {"name": "Length check", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "code": "x" * 41}, content_type="application/json")
            body = bad_code.json() if bad_code.status_code == 400 else {}
            check("and a 41-character code", bad_code.status_code == 400 and "code" in (body.get("errors") or {}), f"{bad_code.status_code} {str(bad_code.content)[:160]}")
            raise RuntimeError("roll back")
    except RuntimeError as exc:
        if str(exc) != "roll back":
            raise
    check.done()
