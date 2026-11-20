"""The back-office onboarding steps: the Onboard a Tenant flow moves on with Enter, and every Readiness action on a tenant
does what it says (Push Again pushes the missing platform tags into that workspace; Single Sign-On points to the
workspace's own Settings instead of a page the back-office does not allow). Rolled back."""
import pytest
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.test import Client, override_settings
from django.urls import reverse

from apps.identity.models import AppUser
from apps.platform_ops.models import PlatformPersonalizationTag
from apps.templates.models import PersonalizationTag
from apps.tenants import readiness
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS


@pytest.fixture
def office():
    staff = AppUser.objects.using(P).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
    if staff is None:
        pytest.skip("no platform administrator in this database")
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        with override_settings(ALLOWED_HOSTS=["*"]):
            client = Client()
            client.force_login(staff)
            yield client
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")


def test_enter_in_a_step_continues_instead_of_going_back(check, office):
    office.post("/admin/tenants/tenant/onboard/", {"step": "workspace", "discard": "1"})       # a clean draft
    first = office.get("/admin/tenants/tenant/onboard/?step=workspace").content.decode()
    check("the first step has Continue", 'name="continue"' in first)
    workspace = {"step": "workspace", "continue": "1", "name": "Steps Test", "code": "ZZSTEPS", "timezone": "UTC", "isolation_mode": "SHARED"}
    moved = office.post("/admin/tenants/tenant/onboard/?step=workspace", workspace)
    check("a filled first step moves on", moved.status_code == 302 and "step=plan" in moved["Location"], str(moved.status_code))
    plan = office.get("/admin/tenants/tenant/onboard/?step=plan").content.decode()
    form = plan.split('<form method="post" style', 1)[1]
    check("on later steps Continue comes before Back in the page, so Enter continues",
          'name="back"' in form and form.index('name="continue"') < form.index('name="back"'))
    office.post("/admin/tenants/tenant/onboard/", {"step": "plan", "discard": "1"})
    check.done()


def test_every_readiness_action_works(check, office):
    tenant = Tenant.objects.using(P).order_by("created_at").first()
    if tenant is None:
        pytest.skip("no tenant in this database")
    platform = set(PlatformPersonalizationTag.objects.using(P).filter(is_active=True).values_list("pk", flat=True))
    if not platform:
        pytest.skip("no platform tags in this database")
    PersonalizationTag.objects.using(P).filter(tenant_id=tenant.pk, platform_tag_id__in=list(platform)[:2]).update(deleted_at="2026-01-01T00:00:00Z")

    items = {item["key"]: item for item in readiness.readiness(tenant)["items"]}
    tags = items["tags"]
    check("with tags missing, Push Again goes to this workspace's push", tags["action"] == "Push Again"
          and tags["url"] == reverse("admin:tenants_tenant_push_platform_tags", args=[tenant.pk]), str(tags))
    pushed = office.get(tags["url"])
    check("pushing comes back to the tenant's page", pushed.status_code == 302 and pushed["Location"].endswith(f"/{tenant.pk}/change/"), str(pushed.status_code))
    after = {item["key"]: item for item in readiness.readiness(tenant)["items"]}["tags"]
    check("and the workspace has every platform tag again", after["state"] == readiness.OK, after["text"])

    sso = items["sso"]
    check("Single Sign-On sends no one to a page the back-office does not allow", not sso.get("url") and "Settings → Security" in sso["text"], str(sso))
    for key, item in items.items():
        if not item.get("url"):
            continue
        path = item["url"].split("#")[0]
        code = office.get(path).status_code
        check(f"Readiness → {item['label']} → {item['action']} opens", code in (200, 302), f"{path} {code}")
    check.done()
