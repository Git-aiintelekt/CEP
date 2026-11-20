"""Back-office → Consent and Governance → Platform Policies: frequency caps and gaps between messages (patch 0089) applied to
every workspace, to chosen ones, or to one (patch 0088). Saving pushes the policy into the workspaces (apps/governance/platform.py)."""
from django import forms
from django.conf import settings
from django.contrib import admin, messages
from unfold.decorators import action, display
from unfold.widgets import UnfoldAdminRadioSelectWidget, UnfoldAdminSelect2MultipleWidget, UnfoldAdminSelect2Widget

from apps.adminutils import BaseAdmin
from apps.governance import platform

from .models import PlatformGovernancePolicy

P = settings.PLATFORM_ALIAS
ALL, SELECTED, ONE = "ALL", "SELECTED", "ONE"
CAP, GAP = "CAP", "GAP"
MAX_GAP_HOURS = 168


def _workspaces() -> list[tuple[str, str]]:
    from apps.tenants.models import Tenant
    return [(str(t.pk), f"{t.code} · {t.name}") for t in Tenant.objects.using(P).filter(status="ACTIVE").order_by("code")]


class PlatformPolicyForm(forms.ModelForm):
    kind = forms.ChoiceField(label="Kind", widget=UnfoldAdminRadioSelectWidget, initial=CAP, choices=[
        (CAP, "Frequency Cap: the most marketing messages one person receives in a number of days"),
        (GAP, "Gap Between Messages: the hours that must pass after one marketing message before the next (one channel)")])
    reach = forms.ChoiceField(label="Applies To", widget=UnfoldAdminRadioSelectWidget, initial=ALL, choices=[
        (ALL, "All Workspaces: every workspace now and every workspace onboarded later"),
        (SELECTED, "Selected Workspaces: the workspaces chosen below; one added later is not included until chosen"),
        (ONE, "One Workspace: a single workspace")])
    workspaces = forms.MultipleChoiceField(label="Workspaces", required=False, widget=UnfoldAdminSelect2MultipleWidget,
                                           help_text="For Selected Workspaces. Type a code or a name to find a workspace.")
    workspace = forms.ChoiceField(label="Workspace", required=False, widget=UnfoldAdminSelect2Widget, help_text="For One Workspace.")

    class Meta:
        model = PlatformGovernancePolicy
        fields = ("name", "scope", "channel", "max_messages", "period_days", "gap_hours", "priority", "is_active")
        labels = {"gap_hours": "Gap (Hours)"}
        help_texts = {
            "name": "Shown to each workspace on its Governance page, locked.",
            "scope": "One Channel counts that channel's messages; All Channels Together counts every email, text and WhatsApp message.",
            "channel": "For One Channel. Text covers SMS and MMS.",
            "max_messages": "The most marketing messages one person may receive within the period. A message over it is skipped for that person (Frequency Capped); transactional messages and e-receipts are never capped.",
            "period_days": "The rolling window the messages are counted in, in days.",
            "gap_hours": "For a Gap Between Messages: 1 to 168. A person who received a marketing message of the channel in the last this many hours is skipped (Frequency Capped).",
            "priority": "Lower comes first when the send log names the cap that held a person back.",
            "is_active": "Off: the workspaces keep a copy that does not apply, so it can be switched on again in one place.",
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        choices = _workspaces()
        self.fields["workspaces"].choices = choices
        self.fields["workspace"].choices = [("", "Choose a Workspace"), *choices]
        for field in ("max_messages", "period_days"):
            self.fields[field].required = False
        policy = self.instance
        if policy and policy.pk:
            self.fields["kind"].initial = GAP if policy.gap_hours else CAP
            chosen = [str(t) for t in policy.tenant_ids]
            self.fields["reach"].initial = ALL if policy.applies_all else ONE if len(chosen) == 1 else SELECTED
            self.fields["workspaces"].initial = chosen
            self.fields["workspace"].initial = chosen[0] if len(chosen) == 1 else ""

    def clean(self):
        data = super().clean()
        if data.get("scope") == PlatformGovernancePolicy.Scope.GLOBAL:
            data["channel"] = None
        elif not data.get("channel"):
            self.add_error("channel", "Choose the channel this cap counts.")
        if data.get("kind") == GAP:
            if data.get("scope") == PlatformGovernancePolicy.Scope.GLOBAL:
                self.add_error("scope", "A gap is for one channel: choose One Channel.")
            hours = data.get("gap_hours")
            if hours is None or not 1 <= hours <= MAX_GAP_HOURS:
                self.add_error("gap_hours", f"Between 1 and {MAX_GAP_HOURS} hours.")
            data["max_messages"], data["period_days"] = 1, 1
        else:
            data["gap_hours"] = None
            for field in ("max_messages", "period_days"):
                if data.get(field) is None:
                    self.add_error(field, "Required for a frequency cap.")
                elif data[field] < 1:
                    self.add_error(field, "At least 1.")
        reach = data.get("reach")
        if reach == SELECTED and not data.get("workspaces"):
            self.add_error("workspaces", "Choose at least one workspace, or apply it to all.")
        if reach == ONE and not data.get("workspace"):
            self.add_error("workspace", "Choose the workspace.")
        return data

    def save(self, commit=True):
        policy = super().save(commit=False)
        policy.max_messages, policy.period_days, policy.gap_hours = (self.cleaned_data["max_messages"], self.cleaned_data["period_days"],
                                                                     self.cleaned_data["gap_hours"])
        reach = self.cleaned_data["reach"]
        policy.applies_all = reach == ALL
        policy.tenant_ids = [] if reach == ALL else [self.cleaned_data["workspace"]] if reach == ONE else list(self.cleaned_data["workspaces"])
        if commit:
            policy.save()
        return policy


@admin.register(PlatformGovernancePolicy)
class PlatformGovernancePolicyAdmin(BaseAdmin):
    """Frequency caps and gaps the platform sets for workspaces. A workspace sees its copy locked and adds stricter rules of its own."""
    form = PlatformPolicyForm
    list_display = ("name", "show_rule", "show_reach", "is_active")
    list_filter = ("is_active", "scope", "channel", "applies_all")
    search_fields = ("name",)
    ordering = ("priority", "name")
    readonly_fields = ("created_at", "updated_at")
    actions = ["push_again"]
    fieldsets = (
        ("The Rule", {"fields": ("name", "kind", "scope", "channel", "max_messages", "period_days", "gap_hours", "priority", "is_active"),
                      "description": "A Frequency Cap uses Most and Days; a Gap Between Messages uses Gap (Hours)."}),
        ("Applies To", {"fields": ("reach", "workspaces", "workspace"),
                        "description": "Each workspace it applies to gets a locked copy on its Governance page. Taking a workspace off removes its copy."}),
    )

    @display(description="Rule")
    def show_rule(self, obj):
        return obj.rule()

    @display(description="Applies To")
    def show_reach(self, obj):
        if obj.applies_all:
            return "All Workspaces"
        from apps.tenants.models import Tenant
        codes = list(Tenant.objects.using(P).filter(pk__in=obj.tenant_ids).order_by("code").values_list("code", flat=True))
        return ", ".join(codes) if len(codes) <= 3 else f"{len(codes)} Workspaces"

    def save_model(self, request, obj, form, change):
        obj.updated_by_id = request.user.pk
        if not change:
            obj.created_by_id = request.user.pk
        super().save_model(request, obj, form, change)
        outcomes = platform.push(obj, using=P, user_id=request.user.pk)
        messages.success(request, f"{obj.name} saved: {platform.summary(outcomes)}.")

    def delete_model(self, request, obj):
        removed = platform.remove_everywhere(obj, using=P, user_id=request.user.pk)
        super().delete_model(request, obj)
        messages.success(request, f"Deleted, and removed from {', '.join(removed) or 'no workspace'}.")

    def delete_queryset(self, request, queryset):
        for policy in queryset:
            self.delete_model(request, policy)

    @action(description="Apply to the Workspaces Again")
    def push_again(self, request, queryset):
        for policy in queryset:
            messages.success(request, f"{policy.name}: {platform.summary(platform.push(policy, using=P, user_id=request.user.pk))}.")
