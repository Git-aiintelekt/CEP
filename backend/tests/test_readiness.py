"""Readiness: the eight checks on NWA (local copy), the panel on the tenant's page and the column on the list. Read-only.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from django.conf import settings
from django.test import Client
from apps.identity.models import AppUser
from apps.tenants import readiness
from apps.tenants.models import Tenant
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_readiness(check):
    """Readiness: the eight checks on NWA (local copy), the panel on the tenant's page and the column on the list. Read-only."""
    P = settings.PLATFORM_ALIAS
    tenant = Tenant.objects.using(P).get(code="NWA")
    state = readiness.readiness(tenant)
    for item in state["items"]:
        print(f"  {item['state']:4} {item['label']}: {item['text'][:150]}" + (f"  -> {item['action']} {item['url']}" if item["url"] else ""))
    check("eight checks in order", [i["key"] for i in state["items"]] == ["provisioned", "plan", "features", "administrator", "tags", "consent", "sending", "sso"])
    check("every check has a state and a sentence", all(i["state"] in ("ok", "warn", "todo") and i["text"] for i in state["items"]))
    states = {i["key"]: i["state"] for i in state["items"]}
    check("NWA is provisioned and has its administrator (signed in or not yet)", states["provisioned"] == "ok" and states["administrator"] in ("ok", "warn"), str(states))
    check("the summary adds up", state["done"] == sum(1 for i in state["items"] if i["state"] == "ok") and state["total"] == 8 and 0 <= state["percent"] <= 100, json.dumps({k: v for k, v in state.items() if k != "items"}))

    staff = AppUser.objects.using(P).filter(is_staff=True, is_active=True).order_by("created_at").first()
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")          # the user row lives on the platform alias; the default connection cannot stamp last_login
    client = Client()
    client.force_login(staff)
    page = client.get(f"/admin/tenants/tenant/{tenant.pk}/change/")
    body = page.content.decode()
    check("the tenant's page renders with the Readiness panel above the form", page.status_code == 200 and 'id="cep-readiness"' in body and 'data-check="provisioned"' in body, f"{page.status_code}")
    check(f"... saying {state['done']} of {state['total']}", f"{state['done']} of {state['total']}" in body)
    listing = client.get("/admin/tenants/tenant/")
    check("the list has the Readiness column with the meter", listing.status_code == 200 and "Readiness" in listing.content.decode() and "cep-meter" in listing.content.decode(), f"{listing.status_code}")
    check.done()
