"""The back-office forms, like the workspaces' (docs/mockups/backoffice-forms.html, option B): each label above its field,
fields as wide as what they hold, "(Optional)" instead of asterisks, the unit beside a number, one Save, Save and Keep
Editing, the rarer saves under ⋯ and Delete as a red link. Read-only: pages are opened, nothing is saved."""
import pytest
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.test import Client, override_settings

from apps.identity.models import AppUser
from apps.platform_ops.models import PlatformSetting
from apps.platform_ops.templatetags.cep_forms import cep_title
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS


def test_labels_are_title_case_with_abbreviations_kept(check):
    check("words in Title Case, small words kept small", cep_title("Max messages per month") == "Max Messages per Month")
    check("abbreviations in capitals, Django's capitalised first word too", cep_title("Max ai prompts") == "Max AI Prompts" and cep_title("Id") == "ID"
          and cep_title("Max storage gb") == "Max Storage GB")
    check("words already holding a capital or a digit are left alone", cep_title("X-Tenant header") == "X-Tenant Header" and cep_title("Overage per 1k messages") == "Overage per 1k Messages")
    check.done()


def _office():
    staff = AppUser.objects.using(P).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
    if staff is None:
        pytest.skip("no platform administrator in this database")
    client = Client()
    client.force_login(staff)
    return client


def test_a_tenant_form_has_labels_above_and_the_new_save_bar(check):
    tenant = Tenant.objects.using(P).order_by("created_at").first()
    if tenant is None:
        pytest.skip("no tenant in this database")
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        with override_settings(ALLOWED_HOSTS=["*"]):
            page = _office().get(f"/admin/tenants/tenant/{tenant.pk}/change/")
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    body = page.content.decode()
    check("the page opens", page.status_code == 200, str(page.status_code))
    check("sections are cards with fields on the grid", 'class="module cep-section' in body and 'class="cep-form-grid"' in body)
    check("each field sized: the name full width, the status half", "cep-field cep-w-L field-name" in body and "cep-field cep-w-M field-status" in body)
    check("labels in Title Case, optional fields say so, no red asterisks", ">Custom App Domain<span class=\"cep-optional\">(Optional)</span>" in body and "text-red-600 dark:text-red-500\">*" not in body)
    check("the read-only code is a quiet field", '<div class="cep-readonly">' in body)
    check("one Save, then Save and Keep Editing; the old wording is gone", 'name="_save"' in body and "Save and Keep Editing" in body and "Save and Continue Editing" not in body)
    check("Save and Add Another sits under ⋯", 'class="cep-more-menu"' in body and 'name="_addanother" role="menuitem"' in body)
    check("Save comes first in the page, so Enter saves", body.index('name="_save"') < body.index('name="_continue"') < body.index('name="_addanother"'))
    check.done()


def test_a_global_parameter_reads_as_its_name_with_its_unit(check):
    setting = PlatformSetting.objects.using(P).filter(key="security.password_link_hours").first()
    if setting is None:
        pytest.skip("security.password_link_hours is not in this database")
    check("the parameter's name, not its key", str(setting) == "Password Link Hours", str(setting))
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        with override_settings(ALLOWED_HOSTS=["*"]):
            page = _office().get(f"/admin/platform_ops/platformsetting/{setting.pk}/change/")
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    body = page.content.decode()
    check("the page opens", page.status_code == 200, str(page.status_code))
    check("the value comes first, under the parameter's name", body.index("<h2>Password Link Hours</h2>") < body.index("<h2>About This Parameter</h2>"))
    check("the number carries its unit", '<span class="cep-unit" aria-hidden="true">hours</span>' in body)
    check("its description is the value's help", "Hours a one-time password link stays valid" in body.split("About This Parameter")[0])
    check("Delete is a red link on the left", 'class="cep-delete-link"' in body)
    check.done()


def test_every_readiness_link_to_a_section_has_somewhere_to_land(check):
    import re
    tenant = Tenant.objects.using(P).order_by("created_at").first()
    if tenant is None:
        pytest.skip("no tenant in this database")
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        with override_settings(ALLOWED_HOSTS=["*"]):
            body = _office().get(f"/admin/tenants/tenant/{tenant.pk}/change/").content.decode()
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    here = f"/admin/tenants/tenant/{tenant.pk}/change/#"
    anchors = sorted(set(re.findall(re.escape(here) + r"([a-z0-9-]+)", body)))
    check("Readiness links into the page (Industry and Features at least)", "industry-and-features" in anchors, str(anchors))
    missing = [a for a in anchors if f'<fieldset id="{a}"' not in body]
    check("each lands on a section of that name", not missing, str(missing))
    check("a folded section is a <details> the script opens", '<fieldset id="settings"' in body and "<details>" in body.split('<fieldset id="settings"', 1)[1][:400])

def test_cancel_goes_back_to_the_page_that_opened_the_form(check):
    tenant = Tenant.objects.using(P).order_by("created_at").first()
    if tenant is None:
        pytest.skip("no tenant in this database")
    change = f"/admin/tenants/tenant/{tenant.pk}/change/"
    add = "/admin/tenants/tenant/add/"

    def cancel(client, path, referer=None):
        extra = {"HTTP_REFERER": f"http://testserver{referer}"} if referer else {}
        body = client.get(path, **extra).content.decode()
        found = body.split('class="cep-cancel-link"')[0].rsplit('href="', 1)[-1].split('"')[0] if 'class="cep-cancel-link"' in body else None
        return found.replace("&amp;", "&") if found else None

    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        with override_settings(ALLOWED_HOSTS=["*"]):
            office = _office()
            check("from a filtered list, Cancel goes back to it", cancel(office, change, "/admin/tenants/tenant/?status__exact=ACTIVE&q=north") == "/admin/tenants/tenant/?status__exact=ACTIVE&q=north")
            check("after Save and Keep Editing (the form reloads itself) it still goes there",
                  cancel(office, change, change) == "/admin/tenants/tenant/?status__exact=ACTIVE&q=north")
            check("from the home page, Cancel goes home", cancel(office, change, "/admin/") == "/admin/")
            check("an add page opened from the home page, saved and kept editing: Cancel still goes home",
                  cancel(office, add, "/admin/") == "/admin/" and cancel(office, change, add) == "/admin/")
            fresh = _office()
            check("opened directly (no referring page), Cancel goes to the list", cancel(fresh, change) == "/admin/tenants/tenant/")
            check("another site is never a destination", cancel(fresh, add, None) == "/admin/tenants/tenant/"
                  and cancel(_office(), add, "//evil.example/admin/") == "/admin/tenants/tenant/")
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")

def test_a_link_to_another_record_is_typed_and_searched_not_an_id(check):
    import json

    from django.contrib import admin
    from django.test import RequestFactory

    from apps.tenants.models import SubscriptionPlan, TenantSubscription
    staff = AppUser.objects.using(P).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
    sub = TenantSubscription.objects.using(P).select_related("tenant", "plan").first()
    if staff is None or sub is None:
        pytest.skip("no platform administrator or subscription in this database")
    request = RequestFactory().get("/admin/")
    request.user = staff
    linked, searchable = 0, 0
    for model, model_admin in admin.site._registry.items():
        fields = set(model_admin.get_autocomplete_fields(request))
        for name in model_admin.raw_id_fields:
            linked += 1
            searchable += name in fields
    check("every link to another record in the back-office is type-to-search", linked and searchable == linked, f"{searchable} of {linked}")
    check("a plan's list can be searched (by code and name)", set(admin.site._registry[SubscriptionPlan].get_search_fields(request)) >= {"code", "name"})
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        with override_settings(ALLOWED_HOSTS=["*"]):
            client = _office()
            body = client.get(f"/admin/tenants/tenantsubscription/{sub.pk}/change/").content.decode()
            found = client.get("/admin/autocomplete/", {"term": sub.plan.name[:3], "app_label": "tenants", "model_name": "tenantsubscription", "field_name": "plan"})
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    check("a subscription's tenant and plan are searchable lists showing names, not id boxes",
          'name="tenant"' in body and "vForeignKeyRawIdAdminField" not in body and "admin-autocomplete" in body and sub.plan.name in body)
    check("typing part of the plan's name finds it", found.status_code == 200 and sub.plan.name in [row["text"] for row in json.loads(found.content)["results"]], found.content[:200])
    check.done()
