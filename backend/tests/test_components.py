"""The suite's components: the registry, the plan's set, the workspace's own trials and add-ons, what GET /me/ hands the
shell, and the back-office pages that decide it (patch 0048)."""
from datetime import date

import pytest
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.db import connections
from django.test import Client

from apps.identity.models import AppUser
from apps.platform_ops import components

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

P = settings.PLATFORM_ALIAS
T = "a0000000-0000-4000-8000-000000000001"
REGISTRY = [
    {"key": "cep", "name": "Engagement", "tagline": "Customer Engagement", "release": "RELEASED", "needs": []},
    {"key": "insights", "name": "Insights", "tagline": "Reports", "release": "BETA", "needs": []},
    {"key": "crm", "name": "CRM", "tagline": "Accounts", "release": "PLANNED", "needs": []},
]


def test_resolution(check):
    today = date(2026, 10, 15)
    growth = components.resolve(REGISTRY, ["cep", "insights"], {}, today)
    check("a plan's components come through in suite order, released or beta, as PLAN access", [(c["key"], c["access"]) for c in growth] == [("cep", "PLAN"), ("insights", "PLAN")], str(growth))
    check("a component that is not released is never offered, even when the plan names it", "crm" not in [c["key"] for c in components.resolve(REGISTRY, ["cep", "crm"], {}, today)])
    check("no plan rows at all falls back to Engagement and Insights", [c["key"] for c in components.resolve(REGISTRY, None, None, today)] == ["cep", "insights"])
    trial = components.resolve(REGISTRY, ["cep"], {"insights": {"access": "TRIAL", "until": date(2026, 10, 31)}}, today)
    check("a trial adds a component the plan leaves out, until its date", [(c["key"], c["access"], c["until"]) for c in trial][1:] == [("insights", "TRIAL", "2026-10-31")], str(trial))
    lapsed = components.resolve(REGISTRY, ["cep"], {"insights": {"access": "TRIAL", "until": date(2026, 10, 1)}}, today)
    check("a lapsed trial no longer counts", [c["key"] for c in lapsed] == ["cep"])
    addon = components.resolve(REGISTRY, ["cep"], {"insights": {"access": "ADDON", "until": None}}, today)
    check("an add-on has no end date", [(c["key"], c["access"]) for c in addon][1:] == [("insights", "ADDON")])
    off = components.resolve(REGISTRY, ["cep", "insights"], {"insights": {"access": "OFF", "until": None}}, today)
    check("OFF hides a component the plan includes", [c["key"] for c in off] == ["cep"])
    check("an empty plan includes nothing", components.resolve(REGISTRY, [], {}, today) == [])
    check("the coming line names what exists but is not released", [c["key"] for c in components.coming(REGISTRY)] == ["crm"])
    check.done()


def test_me_hands_the_shell_its_components(check, world):
    me = world.api("get", "/api/v1/me/")
    body = me.json() if me.status_code == 200 else {}
    check("GET /me/ names the workspace and its plan", me.status_code == 200 and body.get("workspace", {}).get("name") and body["workspace"]["plan"]["code"], str(body.get("workspace")))
    check("GET /me/ lists the components the shell may show, Engagement first, and what is coming", [c["key"] for c in body.get("components", [])][:1] == ["cep"]
          and body["components"][0]["name"] == "Engagement" and any(c["key"] == "insights" for c in body.get("coming", [])), str(body.get("components")) + str(body.get("coming")))
    check.done()


def _tables_present() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('suite_component', 'plan_component', 'tenant_component')")
        return cursor.fetchone()[0] == 3


def test_back_office_decides(check, world):
    """Tenant Administration → Components switches Engagement off for NWA and the shell's list follows; the registry and the plan pages open."""
    if not _tables_present():
        pytest.skip("patch 0048 has not been applied to this database")
    staff = AppUser.objects.using(P).filter(is_staff=True, is_active=True).order_by("created_at").first()
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        admin = Client()
        admin.force_login(staff)
        registry = admin.get("/admin/platform_ops/suitecomponent/")
        check("the Component Registry lists every component with its release state", registry.status_code == 200 and "Engagement" in registry.content.decode() and "Coming soon" in registry.content.decode())
        page = admin.get(f"/admin/tenants/tenant/{T}/components/")
        body = page.content.decode()
        check("the tenant's Components page shows the table with the plan's components on", page.status_code == 200 and 'name="on_cep"' in body and "checked" in body and "of 7 components on" in body, body[:200] if page.status_code != 200 else "")
        with connections[P].cursor() as cursor:
            cursor.execute("SELECT id::text FROM subscription_plan ORDER BY code LIMIT 1")
            plan_id = cursor.fetchone()[0]
        plan = admin.get(f"/admin/tenants/subscriptionplan/{plan_id}/change/")
        check("a plan's page carries its components inline", plan.status_code == 200 and "Components Included" in plan.content.decode())

        before = [c["key"] for c in world.api("get", "/api/v1/me/").json()["components"]]
        saved = admin.post(f"/admin/tenants/tenant/{T}/components/", {"on_insights": "1", "access_insights": "TRIAL", "until_insights": "2099-01-01"})
        after = [c["key"] for c in world.api("get", "/api/v1/me/").json()["components"]]
        check("unticking Engagement switches it off for the workspace; Insights, coming soon, is ignored",
              saved.status_code == 302 and "cep" in before and "cep" not in after, f"{before} -> {after}")
        with connections[P].cursor() as cursor:
            cursor.execute("SELECT component_key, access FROM tenant_component WHERE tenant_id = %s ORDER BY 1", [T])
            rows = cursor.fetchall()
        check("the decision is one OFF entry for Engagement; a plan component ticked on keeps no entry of its own", rows == [("cep", "OFF")], str(rows))
        restored = admin.post(f"/admin/tenants/tenant/{T}/components/", {"on_cep": "1", "on_insights": "1"})
        with connections[P].cursor() as cursor:
            cursor.execute("SELECT count(*) FROM tenant_component WHERE tenant_id = %s", [T])
            left = cursor.fetchone()[0]
        check("ticking it again removes the entry", restored.status_code == 302 and left == 0)
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    check.done()
