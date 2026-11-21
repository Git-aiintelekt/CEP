"""Back-office → Consent and Governance → Platform Policies: frequency caps, gaps between messages (patch 0089), send windows
(patch 0092), blackout dates (patch 0093) and unengaged contacts (patch 0094) applied to
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
CAP, GAP, WINDOW, BLACKOUT, UNENGAGED = "CAP", "GAP", "WINDOW", "BLACKOUT", "UNENGAGED"
DAYS = [("1", "Mon"), ("2", "Tue"), ("3", "Wed"), ("4", "Thu"), ("5", "Fri"), ("6", "Sat"), ("7", "Sun")]
MAX_GAP_HOURS = 168


def _workspaces() -> list[tuple[str, str]]:
    from apps.tenants.models import Tenant
    return [(str(t.pk), f"{t.code} · {t.name}") for t in Tenant.objects.using(P).filter(status="ACTIVE").order_by("code")]


class PlatformPolicyForm(forms.ModelForm):
    kind = forms.ChoiceField(label="Kind", widget=UnfoldAdminRadioSelectWidget, initial=CAP, choices=[
        (CAP, "Frequency Cap: the most marketing messages one person receives in a number of days"),
        (GAP, "Gap Between Messages: the hours that must pass after one marketing message before the next (one channel)"),
        (WINDOW, "Send Window: the hours and days marketing of one channel may go out, in each workspace's time zone; outside them a send waits"),
        (BLACKOUT, "Blackout Date: a day, or up to 31 days, with no marketing on any channel, in each workspace's time zone; a send due then waits"),
        (UNENGAGED, "Unengaged Contacts: marketing email leaves out people with no click, purchase or preference visit in a number of days; a workspace may only be stricter")])
    days = forms.MultipleChoiceField(label="Window Days", required=False, choices=DAYS, widget=forms.CheckboxSelectMultiple, initial=[d for d, _ in DAYS],
                                     help_text="For a Send Window: the days it opens. A window past midnight (22:00 to 02:00) belongs to the day it opens.")
    reach = forms.ChoiceField(label="Applies To", widget=UnfoldAdminRadioSelectWidget, initial=ALL, choices=[
        (ALL, "All Workspaces: every workspace now and every workspace onboarded later"),
        (SELECTED, "Selected Workspaces: the workspaces chosen below; one added later is not included until chosen"),
        (ONE, "One Workspace: a single workspace")])
    workspaces = forms.MultipleChoiceField(label="Workspaces", required=False, widget=UnfoldAdminSelect2MultipleWidget,
                                           help_text="For Selected Workspaces. Type a code or a name to find a workspace.")
    workspace = forms.ChoiceField(label="Workspace", required=False, widget=UnfoldAdminSelect2Widget, help_text="For One Workspace.")

    class Meta:
        model = PlatformGovernancePolicy
        fields = ("name", "scope", "channel", "max_messages", "period_days", "gap_hours", "window_start", "window_end", "blackout_from", "blackout_to",
                  "blackout_yearly", "unengaged_days", "unengaged_min_emails", "priority", "is_active")
        labels = {"gap_hours": "Gap (Hours)", "window_start": "Window From", "window_end": "Window To", "blackout_from": "Blackout From",
                  "blackout_to": "Blackout To", "blackout_yearly": "Every Year", "unengaged_days": "Longest Allowed (Days)",
                  "unengaged_min_emails": "At Least (Emails)"}
        help_texts = {
            "name": "Shown to each workspace on its Governance page, locked.",
            "scope": "One Channel counts that channel's messages; All Channels Together counts every email, text and WhatsApp message.",
            "channel": "For One Channel. Text covers SMS and MMS.",
            "max_messages": "The most marketing messages one person may receive within the period. A message over it is skipped for that person (Frequency Capped); transactional messages and e-receipts are never capped.",
            "period_days": "The rolling window the messages are counted in, in days.",
            "gap_hours": "For a Gap Between Messages: 1 to 168. A person who received a marketing message of the channel in the last this many hours is skipped (Frequency Capped).",
            "window_start": "For a Send Window: when marketing may start going out, as HH:MM in each workspace's time zone.",
            "window_end": "For a Send Window: when it stops. Earlier than From runs past midnight (22:00 to 02:00).",
            "blackout_from": "For a Blackout Date: the first day with no marketing, in each workspace's time zone. The Name is shown as its label (Christmas).",
            "blackout_to": "For a Blackout Date: the last day; empty for one day. At most 31 days in all.",
            "blackout_yearly": "For a Blackout Date: repeat it on the same dates every year (25 December). Moving holidays are added each year.",
            "unengaged_days": "For Unengaged Contacts: 30 to 360. Marketing email leaves out a person with no engagement in this many days, once CEP has sent "
                              "to them that long. A workspace may set fewer days, never more. Opens are not counted.",
            "unengaged_min_emails": "For Unengaged Contacts: 1 to 20. Only a person sent at least this many marketing emails in those days is left out. "
                                    "A workspace may ask for fewer, never more.",
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
        self.fields["unengaged_days"].initial = 180
        self.fields["unengaged_min_emails"].initial = 5
        policy = self.instance
        if policy and policy.pk:
            self.fields["kind"].initial = UNENGAGED if policy.unengaged_days else BLACKOUT if policy.blackout_from else WINDOW if policy.window_start else GAP if policy.gap_hours else CAP
            if policy.window_days:
                self.fields["days"].initial = [str(day) for day in policy.window_days]
            chosen = [str(t) for t in policy.tenant_ids]
            self.fields["reach"].initial = ALL if policy.applies_all else ONE if len(chosen) == 1 else SELECTED
            self.fields["workspaces"].initial = chosen
            self.fields["workspace"].initial = chosen[0] if len(chosen) == 1 else ""

    def clean(self):
        data = super().clean()
        kind = data.get("kind")
        if kind == BLACKOUT:
            data["scope"], data["channel"] = PlatformGovernancePolicy.Scope.GLOBAL, None
        if kind == UNENGAGED:
            data["scope"], data["channel"] = PlatformGovernancePolicy.Scope.CHANNEL, "EMAIL"
        if data.get("scope") == PlatformGovernancePolicy.Scope.GLOBAL:
            data["channel"] = None
        elif not data.get("channel"):
            self.add_error("channel", "Choose the channel this cap counts.")
        if kind in (GAP, WINDOW) and data.get("scope") == PlatformGovernancePolicy.Scope.GLOBAL:
            self.add_error("scope", f"A {'gap' if kind == GAP else 'send window'} is for one channel: choose One Channel.")
        if kind == UNENGAGED:
            days, emails = data.get("unengaged_days"), data.get("unengaged_min_emails")
            if days is None or not 30 <= days <= 360:
                self.add_error("unengaged_days", "Between 30 and 360 days.")
            if emails is None or not 1 <= emails <= 20:
                self.add_error("unengaged_min_emails", "Between 1 and 20 emails.")
            data["max_messages"], data["period_days"], data["gap_hours"] = 1, 1, None
        else:
            data["unengaged_days"] = data["unengaged_min_emails"] = None
        if kind == BLACKOUT:
            start, end = data.get("blackout_from"), data.get("blackout_to") or data.get("blackout_from")
            if start is None:
                self.add_error("blackout_from", "Required for a blackout date.")
            elif end < start:
                self.add_error("blackout_to", "On or after the first day.")
            elif (end - start).days >= 31:
                self.add_error("blackout_to", "At most 31 days.")
            data["blackout_to"] = end
            data["max_messages"], data["period_days"], data["gap_hours"] = 1, 1, None
        elif kind == WINDOW:
            if data.get("window_start") is None:
                self.add_error("window_start", "Required for a send window.")
            if data.get("window_end") is None:
                self.add_error("window_end", "Required for a send window.")
            elif data.get("window_start") == data.get("window_end"):
                self.add_error("window_end", "It must end at a different time from its start.")
            if not data.get("days"):
                self.add_error("days", "Choose at least one day.")
            data["max_messages"], data["period_days"], data["gap_hours"] = 1, 1, None
        elif kind == GAP:
            hours = data.get("gap_hours")
            if hours is None or not 1 <= hours <= MAX_GAP_HOURS:
                self.add_error("gap_hours", f"Between 1 and {MAX_GAP_HOURS} hours.")
            data["max_messages"], data["period_days"] = 1, 1
        elif kind != UNENGAGED:
            data["gap_hours"] = None
        if kind != BLACKOUT:
            data["blackout_from"] = data["blackout_to"] = None
            data["blackout_yearly"] = False
        if kind != WINDOW:
            data["window_start"] = data["window_end"] = None
        if kind not in (WINDOW, BLACKOUT, UNENGAGED):
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
        window = self.cleaned_data.get("kind") == WINDOW
        policy.window_start = self.cleaned_data["window_start"] if window else None
        policy.window_end = self.cleaned_data["window_end"] if window else None
        policy.window_days = sorted(int(day) for day in self.cleaned_data.get("days") or []) if window else None
        policy.blackout_from, policy.blackout_to = self.cleaned_data.get("blackout_from"), self.cleaned_data.get("blackout_to")
        policy.blackout_yearly = bool(self.cleaned_data.get("blackout_yearly")) and policy.blackout_from is not None
        if policy.blackout_from is not None:
            policy.scope, policy.channel = PlatformGovernancePolicy.Scope.GLOBAL, None
        unengaged = self.cleaned_data.get("kind") == UNENGAGED
        policy.unengaged_days = self.cleaned_data.get("unengaged_days") if unengaged else None
        policy.unengaged_min_emails = self.cleaned_data.get("unengaged_min_emails") if unengaged else None
        if unengaged:
            policy.scope, policy.channel = PlatformGovernancePolicy.Scope.CHANNEL, "EMAIL"
        reach = self.cleaned_data["reach"]
        policy.applies_all = reach == ALL
        policy.tenant_ids = [] if reach == ALL else [self.cleaned_data["workspace"]] if reach == ONE else list(self.cleaned_data["workspaces"])
        if commit:
            policy.save()
        return policy


@admin.register(PlatformGovernancePolicy)
class PlatformGovernancePolicyAdmin(BaseAdmin):
    """Caps, gaps, send windows, blackout dates and unengaged contacts rules the platform sets for workspaces. A workspace sees its copy locked and adds stricter rules of its own."""
    form = PlatformPolicyForm
    list_display = ("name", "show_rule", "show_reach", "is_active")
    list_filter = ("is_active", "scope", "channel", "applies_all")
    search_fields = ("name",)
    ordering = ("priority", "name")
    readonly_fields = ("created_at", "updated_at")
    actions = ["push_again"]
    fieldsets = (
        ("The Rule", {"fields": ("name", "kind", "scope", "channel", "max_messages", "period_days", "gap_hours", "window_start", "window_end", "days",
                                 "blackout_from", "blackout_to", "blackout_yearly", "unengaged_days", "unengaged_min_emails", "priority", "is_active"),
                      "description": "A Frequency Cap uses Most and Days; a Gap Between Messages uses Gap (Hours); a Send Window uses Window From, Window To and "
                                     "Window Days; a Blackout Date uses Blackout From, Blackout To and Every Year, on every channel; Unengaged Contacts uses "
                                     "Longest Allowed and At Least, for email."}),
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
