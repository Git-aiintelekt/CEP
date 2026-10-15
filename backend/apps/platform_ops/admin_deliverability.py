"""Back-office pages for deliverability tests (patch 0039; docs/DELIVERABILITY_TESTS.md):

    Configuration -> Mailgun Inspect      the platform's own account (the deliverability_service row without a tenant), which every
                                          workspace without an account of its own runs its inbox previews through; this month's use
    a tenant's page -> Deliverability Tests -> Add Tests
                                          tests added to one workspace for the month (tenant_quota_grant), on top of its plan; they
                                          end with the month; each change goes into the tenant's history

The account row has no tenant, so it is read and written on the platform connection (like the platform's mail server).
"""
from datetime import datetime, time

from django import forms
from django.contrib import admin, messages
from django.core.cache import cache
from django.db.models import Count
from django.http import Http404
from django.shortcuts import redirect, render
from django.urls import path
from django.utils import timezone
from unfold.widgets import UnfoldAdminSelectMultipleWidget, UnfoldAdminSelectWidget, UnfoldAdminTextInputWidget, UnfoldBooleanSwitchWidget

from apps.delivery import deliverability
from apps.delivery.inspect import PROVIDER_TYPE
from apps.delivery.models import DeliverabilityService, DeliverabilityTest
from apps.delivery.providers.base import ProviderError

from . import billing, crypto

P = deliverability.P
CLIENTS_KEY = "cep:inspect-clients:platform"


# ---------------------------------------------------------------- the platform's account
class InspectAccountForm(forms.Form):
    region = forms.ChoiceField(label="Region", choices=(("US", "US"), ("EU", "EU")), widget=UnfoldAdminSelectWidget,
                               help_text="Where the Mailgun account lives: api.mailgun.net (US) or api.eu.mailgun.net (EU).")
    username = forms.CharField(label="Account Username", max_length=200, widget=UnfoldAdminTextInputWidget,
                               help_text="Mailgun → Inspect → Settings → API.")
    api_key = forms.CharField(label="API Key", required=False, max_length=500,
                              widget=UnfoldAdminTextInputWidget(attrs={"type": "password", "autocomplete": "new-password"}),
                              help_text="Stored encrypted and never shown again. Leave empty to keep the saved key.")
    default_clients = forms.MultipleChoiceField(label="Default Clients", required=False, widget=UnfoldAdminSelectMultipleWidget,
                                                help_text="What a workspace's test renders in unless the workspace picks its own. None: Mailgun's default set.")
    image_blocking = forms.BooleanField(label="Render with Images Blocked", required=False, widget=UnfoldBooleanSwitchWidget)
    is_active = forms.BooleanField(label="Workspaces May Use This Account", required=False, initial=True, widget=UnfoldBooleanSwitchWidget)

    def __init__(self, *args, clients=(), saved_key=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["default_clients"].choices = [(row["id"], f"{row['client']} · {row['os']}" + (f" · {row['browser']}" if row.get("browser") else "")) for row in clients]
        if not clients:
            self.fields["default_clients"].help_text = "The list appears once the account is saved and its connection checked. None: Mailgun's default set."
        self.saved_key = saved_key

    def clean(self):
        data = super().clean()
        if not self.saved_key and not data.get("api_key"):
            self.add_error("api_key", "Enter the Mailgun Inspect API key.")
        return data


def _platform_clients(service) -> list[dict]:
    if not deliverability.usable(service):
        return []
    cached = cache.get(CLIENTS_KEY)
    if cached is not None:
        return cached
    client = deliverability.client_for(service)
    try:
        rows = client.clients()
    except ProviderError:
        return []
    finally:
        client.close()
    cache.set(CLIENTS_KEY, rows, 24 * 3600)
    return rows


def _month_use() -> list[dict]:
    """This month's tests through the platform's account, by workspace, with what each may run."""
    from apps.tenants.models import Tenant
    since = timezone.make_aware(datetime.combine(billing.month_start(), time.min))
    counts = dict(DeliverabilityTest.objects.using(P).filter(account=deliverability.PLATFORM, requested_at__gte=since)
                  .values_list("tenant_id").annotate(n=Count("id")).values_list("tenant_id", "n"))
    rows = []
    for tenant in Tenant.objects.using(P).filter(pk__in=counts.keys()).order_by("name"):
        plan = billing.plan_for(tenant.pk) or {}
        plan_limit, added = plan.get("max_deliverability_tests"), billing.added_tests(tenant.pk)
        rows.append({"tenant": tenant, "plan": plan.get("name") or "—", "used": counts[tenant.pk], "added": added,
                     "limit": None if plan_limit is None else int(plan_limit) + added})
    return sorted(rows, key=lambda row: -row["used"])


def inspect_account_view(request):
    service = deliverability.platform_service()
    if request.method == "POST" and request.POST.get("action") == "check":
        if not deliverability.usable(service):
            messages.error(request, "Save the account first.")
        else:
            ok, detail = deliverability.check_service(service)
            cache.delete(CLIENTS_KEY)
            (messages.success if ok else messages.error)(request, "The account works." if ok else f"The check failed: {detail}")
        return redirect("admin:platform_ops_inspect")
    if request.method == "POST" and request.POST.get("action") == "remove" and service is not None:
        service.delete(using=P)
        cache.delete(CLIENTS_KEY)
        messages.success(request, "The platform's Mailgun Inspect account was removed. Only workspaces with their own account can run inbox previews now.")
        return redirect("admin:platform_ops_inspect")

    clients = _platform_clients(service)
    initial = {"region": service.region, "username": service.username, "default_clients": list(service.default_clients or []),
               "image_blocking": service.image_blocking, "is_active": service.is_active} if service else {"region": "US", "is_active": True}
    form = InspectAccountForm(request.POST or None, initial=initial, clients=clients, saved_key=bool(service and service.api_key_enc))
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        service = service or DeliverabilityService(tenant_id=None, provider=PROVIDER_TYPE, created_by_id=request.user.pk)
        service.region, service.username = data["region"], data["username"].strip()
        service.default_clients, service.image_blocking, service.is_active = list(data.get("default_clients") or []), data["image_blocking"], data["is_active"]
        service.updated_by_id = request.user.pk
        if data.get("api_key"):
            service.api_key_enc = crypto.encrypt(data["api_key"].strip())
            service.last_checked_at, service.last_check_ok, service.last_check_error = None, None, None
            cache.delete(CLIENTS_KEY)
        service.save(using=P)
        messages.success(request, "Saved. Check Connection to prove the key works.")
        return redirect("admin:platform_ops_inspect")

    context = {**admin.site.each_context(request), "title": "Mailgun Inspect", "service": service, "form": form, "use": _month_use(),
               "month": billing.month_start()}
    return render(request, "admin/platform_ops/inspect_account.html", context)


# ---------------------------------------------------------------- tests added to one workspace
class AddTestsForm(forms.Form):
    amount = forms.IntegerField(label="Tests to Add", min_value=1, max_value=100000, widget=UnfoldAdminTextInputWidget(attrs={"inputmode": "numeric"}))
    note = forms.CharField(label="Note", max_length=300, required=False, widget=UnfoldAdminTextInputWidget,
                           help_text="Why, for the history: e.g. Black Friday campaign checks.")


def tenant_summary(tenant) -> dict:
    """What the tenant's page shows: this month's allowance and use, and the month's additions."""
    from apps.tenants.models import TenantQuotaGrant
    state = deliverability.allowance(tenant.pk)
    month = billing.month_start()
    grants = list(TenantQuotaGrant.objects.using(P).filter(tenant=tenant, metric="DELIVERABILITY_TESTS")
                  .select_related("granted_by").order_by("-period_month", "-granted_at")[:20])
    return {**state, "month_date": month, "grants": grants, "percent": None if not state["limit"] else min(100, round(100 * state["used"] / state["limit"]))}


def tenant_tests_view(request, tenant_id):
    from apps.tenants.models import Tenant, TenantQuotaGrant
    tenant = Tenant.objects.using(P).filter(pk=tenant_id).first()
    if tenant is None:
        raise Http404
    tenant_admin = admin.site._registry.get(Tenant)
    month = billing.month_start()
    if request.method == "POST" and request.POST.get("remove"):
        grant = TenantQuotaGrant.objects.using(P).filter(pk=request.POST["remove"], tenant=tenant, period_month=month, removed_at__isnull=True).first()
        if grant is None:
            messages.error(request, "Only this month's additions can be removed.")
        else:
            TenantQuotaGrant.objects.using(P).filter(pk=grant.pk).update(removed_at=timezone.now(), removed_by_id=request.user.pk)
            if tenant_admin:
                tenant_admin.log_change(request, tenant, f"Removed {grant.amount} deliverability tests added for {month:%B %Y}.")
            messages.success(request, f"{grant.amount} added tests removed from {month:%B}.")
        return redirect("admin:tenants_tenant_deliverability_tests", tenant.pk)
    form = AddTestsForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        amount, note = form.cleaned_data["amount"], (form.cleaned_data.get("note") or "").strip() or None
        TenantQuotaGrant.objects.using(P).create(tenant=tenant, metric="DELIVERABILITY_TESTS", period_month=month, amount=amount, note=note,
                                                 granted_by_id=request.user.pk)
        if tenant_admin:
            tenant_admin.log_change(request, tenant, f"Added {amount} deliverability tests for {month:%B %Y}" + (f": {note}" if note else "."))
        last = deliverability._month_end(month)
        messages.success(request, f"{tenant.name} can run {amount} more tests until {last:%b} {last.day}.")
        return redirect("admin:tenants_tenant_deliverability_tests", tenant.pk)
    context = {**admin.site.each_context(request), "title": f"Deliverability tests · {tenant.name}", "tenant": tenant, "form": form,
               "summary": tenant_summary(tenant), "month": month}
    return render(request, "admin/tenants/deliverability_tests.html", context)


def tenant_urls(admin_site):
    """Mounted by the tenant admin: /admin/tenants/tenant/<id>/deliverability-tests/."""
    return [path("<uuid:tenant_id>/deliverability-tests/", admin_site.admin_view(tenant_tests_view), name="tenants_tenant_deliverability_tests")]


def inspect_urls(admin_site):
    """Mounted by the mail server admin, beside it under Configuration: /admin/platform_ops/mailserver/inspect/."""
    return [path("inspect/", admin_site.admin_view(inspect_account_view), name="platform_ops_inspect")]
