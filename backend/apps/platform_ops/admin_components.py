"""The suite's components in the back-office: the Component Registry (what exists, its release state), each plan's
components (an inline on the plan), and Tenant Administration → Components, where the platform team switches a
component on or off for one workspace with plan, trial or add-on access."""
from datetime import date

from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from django.utils import timezone

from apps.adminutils import BaseAdmin
from apps.platform_ops import components, params
from apps.platform_ops.models import PlanComponent, SuiteComponent, TenantComponent

P = settings.PLATFORM_ALIAS
ACCESS_WORDS = {"PLAN": "Plan", "TRIAL": "Trial", "ADDON": "Add-on", "OFF": "Off", "NONE": "Not on the plan"}


@admin.register(SuiteComponent)
class SuiteComponentAdmin(BaseAdmin):
    """Platform → Component Registry: every component the suite knows, its release state and what it depends on."""
    list_display = ("name", "key", "show_release", "show_needs", "js_budget_kb", "sort_order")
    list_editable = ("sort_order",)
    ordering = ("sort_order", "key")
    fields = ("key", "name", "tagline", "release", "needs", "js_budget_kb", "sort_order")

    def get_readonly_fields(self, request, obj=None):
        return ("key",) if obj else ()

    @admin.display(description="Release", ordering="release")
    def show_release(self, obj):
        return obj.get_release_display()

    @admin.display(description="Needs")
    def show_needs(self, obj):
        return ", ".join(obj.needs or []) or "—"

    def save_model(self, request, obj, form, change):
        obj.updated_by_id = request.user.pk
        obj.updated_at = timezone.now()
        super().save_model(request, obj, form, change)
        params.invalidate()

    def has_delete_permission(self, request, obj=None):
        return False


class PlanComponentInline(admin.TabularInline):
    """Plans → Components: what every workspace on the plan gets."""
    model = PlanComponent
    fk_name = "plan"
    extra = 0
    verbose_name = "component"
    verbose_name_plural = "Components included"
    fields = ("component",)

    def get_queryset(self, request):
        return super().get_queryset(request).using(P).select_related("component")

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "component":
            kwargs["queryset"] = SuiteComponent.objects.using(P).order_by("sort_order")
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


# ---------------------------------------------------------------------------------------------------- a workspace's components
def tenant_components(tenant) -> list[dict]:
    """One row per registry component for the tenant's page: release, how the workspace has it, on or off, until."""
    from apps.tenants.models import TenantSubscription
    sub = TenantSubscription.objects.using(P).filter(tenant=tenant).exclude(status="CANCELLED").order_by("-started_at").select_related("plan").first()
    plan = sub.plan if sub else None
    reg, plan_keys, own = components.inputs_for(tenant.pk, plan.pk if plan else None)
    resolved = {item["key"]: item for item in components.resolve(reg, plan_keys, own)}
    included = set(components.FALLBACK_PLAN if plan_keys is None else plan_keys)
    rows = []
    for spec in reg:
        key = spec["key"]
        entry = own.get(key) or {}
        offerable = spec["release"] in components.OFFERABLE
        access = (entry.get("access") or ("PLAN" if key in included else "NONE")).upper()
        rows.append({"key": key, "name": spec["name"], "tagline": spec["tagline"], "release": spec["release"],
                     "release_label": {"RELEASED": "Released", "BETA": "Beta", "PLANNED": "Coming soon"}[spec["release"]],
                     "offerable": offerable, "in_plan": key in included, "access": access, "access_label": ACCESS_WORDS.get(access, access),
                     "on": key in resolved, "until": entry.get("until"), "needs": spec.get("needs") or []})
    return rows, plan


class ComponentRowForm(forms.Form):
    """What the page posts for one component: on or off, the access when it is not the plan's, and a trial's end."""
    on = forms.BooleanField(required=False)
    access = forms.ChoiceField(choices=[("TRIAL", "Trial"), ("ADDON", "Add-on")], required=False)
    until = forms.DateField(required=False)


def tenant_components_view(request, tenant_id):
    """GET: the table; POST: saves every row (a plan component switched off becomes OFF; one switched on outside the plan
    becomes a trial or an add-on; a plan component switched on again loses its entry)."""
    from apps.tenants.models import Tenant
    tenant = get_object_or_404(Tenant.objects.using(P), pk=tenant_id)
    rows, plan = tenant_components(tenant)
    if request.method == "POST":
        problems = []
        for row in rows:
            if not row["offerable"]:
                continue
            form = ComponentRowForm({"on": request.POST.get(f"on_{row['key']}"), "access": request.POST.get(f"access_{row['key']}") or "TRIAL",
                                     "until": request.POST.get(f"until_{row['key']}") or None})
            if not form.is_valid():
                problems.append(f"{row['name']}: {'; '.join(f'{field} {err[0]}' for field, err in form.errors.items())}")
                continue
            on, access, until = form.cleaned_data["on"], form.cleaned_data["access"], form.cleaned_data["until"]
            if on and access == "TRIAL" and not row["in_plan"] and (not until or until < date.today()):
                problems.append(f"{row['name']}: a trial needs an end date in the future.")
                continue
            missing = [need for need in row["needs"] if on and not any(r["key"] == need and (r["on"] or request.POST.get(f"on_{need}")) for r in rows)]
            if missing:
                problems.append(f"{row['name']} can only be switched on with {', '.join(missing)}.")
                continue
            entries = TenantComponent.objects.using(P).filter(tenant=tenant, component_id=row["key"])
            if on and row["in_plan"]:
                entries.delete()                                                        # the plan gives it: no entry of its own
            elif on:
                entries.delete()
                TenantComponent.objects.using(P).create(tenant=tenant, component_id=row["key"], access=access, until=until if access == "TRIAL" else None, updated_by_id=request.user.pk)
            elif row["in_plan"]:
                entries.delete()
                TenantComponent.objects.using(P).create(tenant=tenant, component_id=row["key"], access="OFF", updated_by_id=request.user.pk)
            else:
                entries.delete()
        params.invalidate(tenant.pk)
        if problems:
            for problem in problems:
                messages.error(request, problem)
        else:
            messages.success(request, f"{tenant.code}: components saved. The workspace sees the change on its next page load.")
        return redirect(reverse("admin:tenants_tenant_components", args=[tenant.pk]))
    on_count = sum(1 for row in rows if row["on"])
    context = {**admin.site.each_context(request), "title": f"{tenant.name} · Components", "tenant": tenant, "plan": plan, "rows": rows,
               "on_count": on_count, "total": len(rows), "today": date.today().isoformat()}
    return render(request, "admin/tenants/components.html", context)


def tenant_panel(tenant) -> dict:
    """The summary on the tenant's own page: n of m on, and the names."""
    rows, plan = tenant_components(tenant)
    return {"on": [row["name"] for row in rows if row["on"]], "total": len(rows), "plan": plan}


def component_urls(admin_site):
    """Mounted by the tenant admin: /admin/tenants/tenant/<id>/components/"""
    return [path("<uuid:tenant_id>/components/", admin_site.admin_view(tenant_components_view), name="tenants_tenant_components")]
