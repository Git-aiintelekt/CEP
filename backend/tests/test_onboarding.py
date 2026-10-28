"""Onboard a tenant: the seven steps through the admin, the draft in the session, the validation, the finish and what it makes. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
import re
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.db import connections, transaction
from django.test import Client
from apps.identity.models import AppUser, UserRole
from apps.platform_ops import components
from apps.platform_ops.models import IndustryProfile
from apps.tenants import readiness
from apps.tenants.models import SubscriptionPlan, Tenant, TenantSubscription

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_onboarding(check):
    """Onboard a tenant: the seven steps through the admin, the draft in the session, the validation, the finish and what it makes. Rolled back."""
    P = settings.PLATFORM_ALIAS
    URL = "/admin/tenants/tenant/onboard/"
    staff = AppUser.objects.using(P).filter(is_staff=True, is_active=True).order_by("created_at").first()
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    client = Client()
    client.force_login(staff)
    growth = SubscriptionPlan.objects.using(P).get(code="GROWTH")
    retail = IndustryProfile.objects.using(P).filter(pk="RETAIL").first()
    CODE = "ZZONB"
    try:
        with transaction.atomic(using=P), transaction.atomic(using="default"):
            page = client.get(URL)
            body = page.content.decode()
            check("the flow opens on Workspace with the seven steps", page.status_code == 200 and 'data-step="workspace" data-state="on"' in body and "Review and Onboard" in body and "Components and Reports" in body, f"{page.status_code}")
            listing = client.get("/admin/tenants/tenant/")
            check("the Tenants list offers Onboard a Tenant", listing.status_code == 200 and "Onboard a Tenant" in listing.content.decode())

            bad = client.post(URL, {"step": "workspace", "continue": "1", "name": "Onboarding Test", "code": "nwa", "timezone": "UTC", "isolation_mode": "SHARED"})
            check("a taken code is refused on the step", bad.status_code == 200 and "This code is taken." in bad.content.decode())
            bad = client.post(URL, {"step": "workspace", "continue": "1", "name": "Onboarding Test", "code": "9x", "timezone": "UTC", "isolation_mode": "SHARED"})
            check("a bad code is refused", "starting with a letter" in bad.content.decode())
            ok = client.post(URL, {"step": "workspace", "continue": "1", "name": "Onboarding Test", "code": CODE.lower(), "subdomain": "ZZonb", "timezone": "America/New_York",
                                   "region": "us-east", "data_residency": "US", "isolation_mode": "SHARED"})
            check("the workspace step saves and moves to Plan", ok.status_code == 302 and ok["Location"].endswith("?step=plan"), f"{ok.status_code} {ok.get('Location')}")
            page = client.get(URL + "?step=workspace").content.decode()
            check("the draft holds the code upper-cased and the subdomain lower-cased", f'value="{CODE}"' in page and 'value="zzonb"' in page)
            page = client.get(URL + "?step=review")
            check("Review is not reachable yet: the flow falls back to the next open step", 'data-step="plan" data-state="on"' in page.content.decode())
            listing = client.get("/admin/tenants/tenant/")
            check("the list shows the waiting draft", "An onboarding draft is waiting: Onboarding Test (ZZONB)" in listing.content.decode())

            page = client.get(URL + "?step=plan")
            check("the plan step shows the feature table with the catalogue defaults", "data-feature-table" in page.content.decode() and 'data-feature="scoring"' in page.content.decode())
            ok = client.post(URL, {"step": "plan", "continue": "1", "plan": str(growth.pk), "trial_days": "30", "industry": retail.pk if retail else "", "feature_dynamic_codes": "on", "feature_scoring": "on"})
            check("the plan step saves and moves on to Components and Reports", ok.status_code == 302 and ok["Location"].endswith("?step=components"), f"{ok.status_code}")
            page = client.get(URL + "?step=plan").content.decode()
            row = page[page.find('data-feature="scoring"'):page.find('data-feature="scoring"') + 900]
            check("... and shows the overrides in the table: scoring on by override, judged by the plan", 'data-feature="scoring"' in page and ">on<" in row and ("Off: not in the plan" in row or ">On<" in row), row.replace(chr(10), " ")[-200:])

            page = client.get(URL + "?step=components").content.decode()
            ticked = lambda key: re.search(rf'<input[^>]*name="component_{key}"[^>]*checked', page) is not None      # noqa: E731
            check("the components step ticks the plan's components and lists the base report packs", 'data-group="components"' in page and 'data-group="packs"' in page
                  and ticked("cep") and ticked("insights") and 'name="pack_email-campaigns"' in page and "Needs Insights." in page, page[page.find('data-group'):][:300])
            bad = client.post(URL, {"step": "components", "continue": "1"})
            check("at least one component", bad.status_code == 200 and "Tick at least one component." in bad.content.decode())
            bad = client.post(URL, {"step": "components", "continue": "1", "component_cep": "on", "pack_email-campaigns": "on"})
            check("a pack whose component is left out is refused", bad.status_code == 200 and "Needs Insights: tick it above, or leave this pack out." in bad.content.decode())
            ok = client.post(URL, {"step": "components", "continue": "1", "component_insights": "on", "pack_email-campaigns": "on"})
            check("Insights alone with the Email Campaign pack saves and moves on", ok.status_code == 302 and ok["Location"].endswith("?step=admin"), f"{ok.status_code}")
            page = client.get(URL + "?step=components").content.decode()
            check("... and the step shows the choice again", not ticked("cep") and ticked("insights") and re.search(r'<input[^>]*name="pack_email-campaigns"[^>]*checked', page))

            bad = client.post(URL, {"step": "admin", "continue": "1", "display_name": "Pat Lee", "email": staff.email})
            check("an email that exists is refused", "already exists" in bad.content.decode())
            ok = client.post(URL, {"step": "admin", "continue": "1", "display_name": "Pat Lee", "email": "pat.lee@zzonb.example", "also_invite": "sam@zzonb.example\n\nSAM@zzonb.example\n"})
            page = client.get(URL + "?step=admin").content.decode()
            check("the admin step saves with the extra invite once", ok.status_code == 302 and page.count("sam@zzonb.example") == 1, f"{ok.status_code} {page.count('sam@zzonb.example')}")

            ok = client.post(URL, {"step": "policies", "continue": "1", "without_consent": "REFUSE", "approval_before_send": "on", "lifetime_months": "12"})
            check("the policies step saves", ok.status_code == 302 and ok["Location"].endswith("?step=handoff"))
            ok = client.post(URL, {"step": "handoff", "skip": "1"})
            check("hand-off can be skipped", ok.status_code == 302 and ok["Location"].endswith("?step=review"))

            page = client.get(URL + "?step=review").content.decode()
            check("Review sums it up", "Onboarding Test" in page and "Growth, trial for 30 days" in page and "Pat Lee, pat.lee@zzonb.example" in page and "refuse without consent" in page
                  and f"Onboard {CODE}" in page, page[page.find("Workspace</dt>"):page.find("Workspace</dt>") + 200].replace("\n", " ")[:200])
            review = page[page.find('data-review="components"'):page.find('data-review="packs"') + 200]
            check("... with the components and the base reports chosen", ">Insights · 1 plan component switched off<" in review
                  and "Email Campaign Reports: added in Insights once the workspace connects the database each reads" in review, review)

            done = client.post(URL, {"step": "review", "finish": "1"})
            tenant = Tenant.objects.using(P).filter(code=CODE).first()
            check("finishing creates the tenant and lands on its page", done.status_code == 302 and tenant is not None and done["Location"].endswith(f"/admin/tenants/tenant/{tenant.pk}/change/"), f"{done.status_code} {done.get('Location')}")
            check("the tenant row carries the workspace values and the settings", tenant.timezone == "America/New_York" and tenant.subdomain == "zzonb" and tenant.region == "us-east"
                  and tenant.settings.get("industry") == (retail.pk if retail else None) and tenant.settings["features"] == {"dynamic_codes": True, "scoring": True}
                  and tenant.settings["consent_policy"]["without_consent"] == "REFUSE" and tenant.settings["consent_policy"]["lifetime_months"] == 12 and tenant.onboarded_at is not None,
                  json.dumps(tenant.settings))
            check("Engagement is switched off for it, and the chosen pack is remembered for Insights to offer",
                  [c["key"] for c in components.for_tenant(tenant.pk)] == ["insights"] and tenant.settings.get("base_packs") == ["email-campaigns"],
                  f"{components.for_tenant(tenant.pk)} {tenant.settings.get('base_packs')}")
            sub = TenantSubscription.objects.using(P).filter(tenant=tenant).first()
            check("a trial subscription on Growth", sub is not None and sub.plan_id == growth.pk and sub.status == "TRIAL" and sub.trial_ends_at is not None)
            users = list(AppUser.objects.using(P).filter(tenant=tenant).order_by("created_at"))
            check("two users, no password, both Workspace Admin", [u.email for u in users] == ["pat.lee@zzonb.example", "sam@zzonb.example"] and all(not u.has_usable_password() for u in users)
                  and UserRole.objects.using(P).filter(user__in=users, role__name="Workspace Admin").count() == 2)
            state = readiness.readiness(tenant)
            by = {i["key"]: i["state"] for i in state["items"]}
            check("readiness straight after: provisioned, plan (billing reference missing), features, administrator (link not used), tags, consent all answered",
                  by["provisioned"] == "ok" and by["plan"] == "warn" and by["features"] == "ok" and by["administrator"] == "warn" and by["consent"] == "ok" and by["sending"] == "todo", json.dumps(by))
            page = client.get(done["Location"]).content.decode()
            check("the tenant's page shows the result message and the readiness panel", f"{CODE} onboarded" in page and 'id="cep-readiness"' in page)
            check("the draft is gone", f'value="{CODE}"' not in client.get(URL).content.decode())
            raise RuntimeError("roll back")
    except RuntimeError as exc:
        if str(exc) != "roll back":
            raise
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT count(*) FROM tenant WHERE code = %s", [CODE])
        check("nothing is left behind", cursor.fetchone()[0] == 0)
    check.done()
