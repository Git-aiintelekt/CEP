from django import forms
from django.conf import settings
from django.contrib import admin, messages
from unfold.decorators import action, display

from apps.adminutils import BaseAdmin, register_app_models
from apps.identity.models import AppUser

from apps.platform_ops import links, params
from apps.platform_ops.admin import FeatureChoicesMixin
from apps.platform_ops.models import IndustryProfile, TenantOperation
from unfold.widgets import UnfoldAdminSelectWidget

from django.utils.html import format_html

from django.shortcuts import redirect, render

from . import onboarding, readiness, services
from .models import Tenant


class TenantForm(FeatureChoicesMixin):
    """The industry profile and the per-tenant feature switches live in tenant.settings ({"industry": ..., "features": {...}})."""
    industry = forms.ChoiceField(required=False, widget=UnfoldAdminSelectWidget, label="Industry profile",
                                 help_text="Sets which features this workspace starts with and what it calls customers, locations and transactions.")

    class Meta:
        model = Tenant
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        profiles = IndustryProfile.objects.using(settings.PLATFORM_ALIAS).filter(is_active=True)
        self.fields["industry"].choices = [("", "Installation default")] + [(p.code, p.name) for p in profiles]
        self.fields["industry"].initial = (self.instance.settings or {}).get("industry", "")

    def _current_features(self):
        return (self.instance.settings or {}).get("features") or {}

    def clean(self):
        data = super().clean()
        merged = dict(data.get("settings") or self.instance.settings or {})
        merged.pop("industry", None)
        merged.pop("features", None)
        if data.get("industry"):
            merged["industry"] = data["industry"]
        if self.chosen_features():
            merged["features"] = self.chosen_features()
        data["settings"] = merged
        self.instance.settings = merged
        return data


@admin.register(Tenant)
class TenantAdmin(BaseAdmin):
    """Register, onboard, suspend. Saving a NEW tenant also creates its partitions, its routing row and its starting
    roles, so the next step is simply adding its first administrator under Users."""
    form = TenantForm
    list_display = ("code", "name", "show_status", "show_industry", "show_readiness", "isolation_mode", "region", "partition_seq", "show_users", "onboarded_at")
    change_form_before_template = "admin/tenants/readiness.html"
    list_filter = ("status", "isolation_mode", "region")
    search_fields = ("code", "name", "subdomain", "custom_app_domain")
    ordering = ("code",)
    readonly_fields = ("id", "partition_seq", "created_at", "updated_at", "row_version")
    actions = ("suspend", "reactivate", "provision", "request_export")
    actions_list = ("onboard_flow",)
    list_before_template = "admin/tenants/onboard_notice.html"
    fieldsets = (
        ("Workspace", {"fields": ("name", "code", "status", "timezone")}),
        ("Access", {"fields": ("subdomain", "custom_app_domain"), "description": "Users reach the app at <subdomain>.your-domain; the API also accepts the code in the X-Tenant header."}),
        ("Hosting", {"fields": ("isolation_mode", "region", "data_residency", "onboarded_at"),
                     "description": "SHARED tenants live in the pool database in their own partitions. Moving to DEDICATED is a migration, not a field change."}),
        ("Industry and features", {"fields": ("industry", *(f"feature_{code}" for code in params.FEATURES)),
                                   "description": "“Default” follows the industry profile. The subscription plan always has the last word: a feature the plan excludes stays off."}),
        ("Settings", {"fields": ("settings",), "classes": ("collapse",)}),
        ("System", {"fields": ("id", "partition_seq", "created_at", "updated_at", "row_version"), "classes": ("collapse",)}),
    )

    def get_readonly_fields(self, request, obj=None):
        fixed = ("code", "isolation_mode") if obj else ()          # the code names partitions and URLs; isolation is changed by migration
        return (*self.readonly_fields, *fixed)

    @display(description="Status", label={"ACTIVE": "success", "SUSPENDED": "danger"})
    def show_status(self, obj):
        return obj.status

    @display(description="Industry")
    def show_industry(self, obj):
        return (obj.settings or {}).get("industry") or "default"

    @display(description="Readiness")
    def show_readiness(self, obj):
        """done of the eight checks, with a meter: the same facts as the panel on the tenant's page."""
        state = readiness.readiness(obj)
        if state["done"] == 0 and state["state"] == readiness.TODO:
            return format_html('<span class="cep-pill" data-kind="danger">Not onboarded</span>')
        meter = "blocked" if state["state"] == readiness.TODO else ("warning" if state["state"] == readiness.WARN else "")
        return format_html('<span style="white-space:nowrap">{} of {}</span><div class="cep-meter" data-state="{}" style="max-width:6rem"><i style="width:{}%"></i></div>',
                           state["done"], state["total"], meter, state["percent"])

    def changelist_view(self, request, extra_context=None):
        draft = onboarding.draft_of(request)
        extra = {**(extra_context or {}), "onboarding_draft": draft if draft.get("data") else None}
        return super().changelist_view(request, extra)

    @action(description="Onboard a tenant", url_path="onboard", icon="rocket_launch")
    def onboard_flow(self, request):
        """The guided set-up: six steps kept as a draft in the session, written at Review (apps/tenants/onboarding.py)."""
        draft = onboarding.draft_of(request)
        step = request.POST.get("step") or request.GET.get("step") or "workspace"
        if step not in onboarding.STEP_KEYS or not onboarding.reachable(draft, step):
            step = next((key for key in onboarding.STEP_KEYS if not onboarding.reachable(draft, onboarding.next_step(key)) or key == "review"), "workspace")
        if request.method == "POST":
            if "discard" in request.POST:
                onboarding.clear_draft(request)
                messages.info(request, "The onboarding draft was discarded. Nothing was created.")
                return redirect("admin:tenants_tenant_changelist")
            if "back" in request.POST:
                return redirect(f"{request.path}?step={onboarding.previous_step(step)}")
            if "skip" in request.POST and step in onboarding.SKIPPABLE:
                draft["data"].pop(step, None)
                draft["skipped"] = sorted(set(draft.get("skipped", [])) | {step})
                onboarding.save_draft(request, draft)
                return redirect(f"{request.path}?step={onboarding.next_step(step)}")
            if "finish" in request.POST and step == "review":
                result = onboarding.finish(draft, staff_user_id=request.user.pk)
                onboarding.clear_draft(request)
                tenant = result["tenant"]
                words = (f"{tenant.code} onboarded: {result['provisioned']['partition_sets']} partition sets, roles {', '.join(result['provisioned']['roles']) or 'already present'}, "
                         f"{len(result['provisioned']['platform_tags'] or {})} platform tags, subscription {result['subscription']}, {len(result['users'])} user{'s' if len(result['users']) != 1 else ''}.")
                if result["sent"]:
                    words += f" Password links emailed to {', '.join(email for email, _ in result['sent'])}."
                messages.success(request, words)
                for email, link in result["links"]:
                    messages.warning(request, f"Email is not configured or failed, so send this one-time link to {email} yourself: {link}")
                return redirect("admin:tenants_tenant_change", tenant.pk)
            if step != "review":
                form = onboarding.FORMS[step](request.POST)
                if form.is_valid():
                    data = {key: value for key, value in form.cleaned_data.items() if not key.startswith("feature_")}
                    if step == "plan":
                        data["features"] = form.feature_overrides()
                    if step == "policies":
                        data = {"without_consent": data["without_consent"], "texts_need_date": data["texts_need_date"], "approval_before_send": data["approval_before_send"],
                                "lifetime_months": int(data["lifetime_months"])}
                    draft["data"][step] = data
                    draft["skipped"] = [key for key in draft.get("skipped", []) if key != step]
                    onboarding.save_draft(request, draft)
                    return redirect(f"{request.path}?step={onboarding.next_step(step)}")
            else:
                form = None
        else:
            initial = dict(draft["data"].get(step) or {})
            if step == "plan" and initial.get("features"):
                initial.update({f"feature_{code}": "on" if on else "off" for code, on in initial.pop("features").items()})
            if step == "policies" and initial:
                initial["lifetime_months"] = str(initial["lifetime_months"])
            if step == "admin" and isinstance(initial.get("also_invite"), list):
                initial["also_invite"] = "\n".join(initial["also_invite"])
            form = onboarding.FORMS[step](initial=initial) if step != "review" else None
        plan_data = draft["data"].get("plan") or {}
        if step == "plan" and form is not None and form.is_bound and form.is_valid():
            plan_data = {"plan": form.cleaned_data["plan"], "industry": form.cleaned_data["industry"], "features": form.feature_overrides()}
        context = {**self.admin_site.each_context(request), "title": "Onboard a tenant", "draft": draft, "step": step, "steps": onboarding.STEPS, "form": form,
                   "skippable": onboarding.SKIPPABLE,
                   "step_rows": [{"key": key, "label": label, "number": index + 1, "state": onboarding.step_state(draft, key, step), "reachable": onboarding.reachable(draft, key)}
                                 for index, (key, label) in enumerate(onboarding.STEPS)],
                   "feature_table": onboarding.feature_table(plan_data.get("plan"), plan_data.get("industry"), plan_data.get("features") or {}) if step == "plan" else None,
                   "policies_summary": onboarding.policies_summary(draft["data"].get("policies")) if step == "policies" else None,
                   "checklist": onboarding.HANDOFF_CHECKLIST, "review": onboarding.review_of(draft) if step == "review" else None, "hours": links.hours()}
        return render(request, "admin/tenants/onboard.html", context)

    def change_view(self, request, object_id, form_url="", extra_context=None):
        tenant = Tenant.objects.using(settings.PLATFORM_ALIAS).filter(pk=object_id).first()
        extra = {**(extra_context or {}), "readiness": readiness.readiness(tenant) if tenant else None}
        return super().change_view(request, object_id, form_url, extra)

    @display(description="Active users")
    def show_users(self, obj):
        return AppUser.objects.using(settings.PLATFORM_ALIAS).filter(tenant=obj, is_active=True, deleted_at__isnull=True).count()

    def save_model(self, request, obj, form, change):
        if change and form is not None and "settings" not in form.changed_data and form.instance.settings != form.initial.get("settings"):
            form.changed_data.append("settings")           # industry / feature drop-downs write into settings
        super().save_model(request, obj, form, change)
        params.invalidate(obj.pk)
        if not change:
            result = services.onboard_tenant(obj, using=settings.PLATFORM_ALIAS, user_id=request.user.pk)
            messages.success(request, f"{obj.code} onboarded: {result['partition_sets']} partition sets, roles {', '.join(result['roles']) or 'already present'}. "
                                      "Next: add its first administrator under Users and give them the Workspace Admin role.")

    def has_delete_permission(self, request, obj=None):
        return False                                       # tenants are suspended; removing one is an offboarding procedure (export, detach, drop)

    @action(description="Suspend: block sign-in and API access")
    def suspend(self, request, queryset):
        for tenant in queryset.filter(status="ACTIVE"):
            self.set_fields(request, tenant, status="SUSPENDED")
        messages.warning(request, "Suspended. Tenant resolution is cached for up to 60 seconds.")

    @action(description="Reactivate")
    def reactivate(self, request, queryset):
        for tenant in queryset.filter(status="SUSPENDED"):
            self.set_fields(request, tenant, status="ACTIVE")
        messages.success(request, "Reactivated.")

    @action(description="Request a data export (runs with the tenant-operations job)")
    def request_export(self, request, queryset):
        for tenant in queryset:
            if TenantOperation.objects.using(settings.PLATFORM_ALIAS).filter(tenant=tenant, status__in=["REQUESTED", "RUNNING"]).exists():
                messages.warning(request, f"{tenant.code} already has an operation waiting or running.")
                continue
            TenantOperation.objects.using(settings.PLATFORM_ALIAS).create(tenant=tenant, operation="EXPORT", requested_by_id=request.user.pk)
            messages.success(request, f"{tenant.code}: export requested. See Operations, Tenant operations.")

    @action(description="Repair onboarding (partitions, routing row, default roles)")
    def provision(self, request, queryset):
        for tenant in queryset:
            result = services.onboard_tenant(tenant, using=settings.PLATFORM_ALIAS, user_id=request.user.pk)
            months = services.ensure_partitions(tenant, using=settings.PLATFORM_ALIAS)
            messages.success(request, f"{tenant.code}: {result['partition_sets']} new partition sets, {months} monthly partitions added, roles added: {', '.join(result['roles']) or 'none'}.")


register_app_models(__package__)
