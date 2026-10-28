"""Onboard a tenant: the guided flow in the back-office (Tenants -> Onboard a tenant).

Seven steps, kept in the staff user's session as a draft until Review; nothing is written before the last step:

    1 workspace   name, the fixed code, subdomain and custom domain, time zone, region and residency, hosting
    2 plan        the subscription plan (a trial unless a billing reference is given), the industry profile, the
                  per-workspace feature switches, and the resolved result: default -> profile -> override -> plan
    3 components  the suite components the workspace gets (the plan's ticked; one left out is switched off, one added is an
                  add-on), and the base report packs for them (apps/insights/base_packs), remembered in the tenant's settings
                  as base_packs: a pack is added in Insights once the workspace connects the database it reads
    4 admin       the first administrator: a user with the Workspace Admin role, sign-in by one-time password link
    5 policies    the consent policy for the workspace (platform defaults otherwise); the rest is shown, not asked
    6 hand-off    the set-up list the administrator receives with the password link, and a line from the platform team
    7 review      everything in one place, then finish: the tenant row, its subscription, settings, its components,
                  provisioning (services.onboard_tenant), the users with their role, and the mail

Steps 5 and 6 can be skipped. finish() writes in one transaction; the mail goes afterwards and never undoes it.
"""
import re
import zoneinfo
from datetime import timedelta

from django import forms
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from unfold.widgets import UnfoldAdminCheckboxSelectMultipleWidget  # noqa: F401  (the admin's widgets are what the page styles)
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget, UnfoldAdminTextInputWidget

from apps.contact_lists import consent as consent_policy
from apps.identity.models import AppUser, Role, UserRole
from apps.platform_ops import components, links, mail, params
from apps.platform_ops.models import IndustryProfile, MailServer, TenantComponent

from . import services
from .models import SubscriptionPlan, Tenant, TenantSubscription

P = settings.PLATFORM_ALIAS
SESSION_KEY = "tenant_onboarding"
STEPS = (("workspace", "Workspace"), ("plan", "Plan and Features"), ("components", "Components and Reports"), ("admin", "First Administrator"), ("policies", "Policies"), ("handoff", "Hand-Off"), ("review", "Review and Onboard"))
STEP_KEYS = [key for key, _ in STEPS]
SKIPPABLE = {"policies", "handoff"}
CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,19}$")
SUBDOMAIN_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
TRI_STATE = (("", "Follow the profile"), ("on", "On"), ("off", "Off"))
COMMON_ZONES = ("UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "Europe/London", "Europe/Paris", "Europe/Berlin",
                "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney")
HANDOFF_CHECKLIST = (
    ("Roles and users", "Settings → Roles, Users. Invite the team; at least one role with campaign.approve if Approvals will be on."),
    ("Email engine, text engine, senders", "Settings → Sending Engines. Postal, SendGrid or your mail server; Digivize or Sandbox texts; Verify each sender; register the callback address with the provider."),
    ("Suppressions and lists", "Import any do-not-contact addresses first; then upload lists, each with its consent basis."),
    ("Notifications, approvals, API keys", "Who is told about failed runs; a second person before a production publish; a receipts:send key for the point of sale."),
)


# ------------------------------------------------------------------------------------------------------------ the forms
class WorkspaceForm(forms.Form):
    name = forms.CharField(label="Workspace Name", max_length=200, widget=UnfoldAdminTextInputWidget)
    code = forms.CharField(label="Code", max_length=20, widget=UnfoldAdminTextInputWidget,
                           help_text="Short, upper case, fixed once created. The API's X-Tenant header, the callback addresses and the partition names carry it.")
    subdomain = forms.CharField(label="Subdomain", max_length=63, required=False, widget=UnfoldAdminTextInputWidget, help_text="Host-based sign-in: <subdomain>.your-domain. Optional.")
    custom_app_domain = forms.CharField(label="Custom App Domain", max_length=253, required=False, widget=UnfoldAdminTextInputWidget,
                                        help_text="Optional. Needs the DNS record and a certificate; the subdomain works meanwhile.")
    timezone = forms.ChoiceField(label="Time Zone", choices=[(zone, zone) for zone in COMMON_ZONES], initial="UTC", widget=UnfoldAdminSelectWidget,
                                 help_text="Schedules, quiet hours for texts and the reports read in this zone. Any IANA zone can be typed on the tenant's page afterwards.")
    region = forms.CharField(label="Region", max_length=40, required=False, widget=UnfoldAdminTextInputWidget, help_text="e.g. us-east. Optional.")
    data_residency = forms.CharField(label="Data Residency", max_length=40, required=False, widget=UnfoldAdminTextInputWidget, help_text="e.g. US, EU. Optional.")
    isolation_mode = forms.ChoiceField(label="Hosting", choices=(("SHARED", "Shared database: the pool, its own partitions and row-level security (the usual choice)"),
                                                                 ("DEDICATED", "Dedicated database: provisioned by a tenant operation after this flow (Enterprise plans)")),
                                       initial="SHARED", widget=UnfoldAdminSelectWidget)

    def clean_name(self):
        value = " ".join(self.cleaned_data["name"].split())
        if Tenant.objects.using(P).filter(name__iexact=value).exists():
            raise forms.ValidationError("Another tenant already has this name.")
        return value

    def clean_code(self):
        value = self.cleaned_data["code"].strip().upper()
        if not CODE_RE.match(value):
            raise forms.ValidationError("Letters, digits and underscores, starting with a letter: 2 to 20 characters.")
        if Tenant.objects.using(P).filter(code=value).exists():
            raise forms.ValidationError("This code is taken.")
        return value

    def clean_subdomain(self):
        value = self.cleaned_data["subdomain"].strip().lower()
        if value and not SUBDOMAIN_RE.match(value):
            raise forms.ValidationError("Lower-case letters, digits and hyphens.")
        if value and Tenant.objects.using(P).filter(subdomain=value).exists():
            raise forms.ValidationError("This subdomain is taken.")
        return value

    def clean_custom_app_domain(self):
        value = self.cleaned_data["custom_app_domain"].strip().lower()
        if value and Tenant.objects.using(P).filter(custom_app_domain=value).exists():
            raise forms.ValidationError("This domain is taken.")
        return value

    def clean_timezone(self):
        value = self.cleaned_data["timezone"]
        try:
            zoneinfo.ZoneInfo(value)
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):
            raise forms.ValidationError("Not a known time zone.") from None
        return value


class PlanForm(forms.Form):
    plan = forms.ChoiceField(label="Subscription Plan", widget=UnfoldAdminSelectWidget)
    trial_days = forms.IntegerField(label="Trial Days", initial=30, min_value=0, max_value=365, widget=UnfoldAdminTextInputWidget,
                                    help_text="0 with a billing reference starts the subscription active; otherwise it starts as a trial.")
    billing_customer_ref = forms.CharField(label="Billing Reference", max_length=100, required=False, widget=UnfoldAdminTextInputWidget,
                                           help_text="The customer at the billing provider (e.g. a Stripe customer id). No invoice is raised without it.")
    industry = forms.ChoiceField(label="Industry Profile", required=False, widget=UnfoldAdminSelectWidget,
                                 help_text="Sets the starting features and what the workspace calls customers, locations and transactions.")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        plans = SubscriptionPlan.objects.using(P).filter(is_active=True).order_by("monthly_price", "code")
        self.fields["plan"].choices = [(str(plan.pk), f"{plan.name}: {_plan_words(plan)}") for plan in plans]
        profiles = IndustryProfile.objects.using(P).filter(is_active=True).order_by("sort_order", "name")
        self.fields["industry"].choices = [("", "Installation default")] + [(p.code, f"{p.name}: {p.description or ''}".rstrip(": ")) for p in profiles]
        for code, spec in params.FEATURES.items():
            self.fields[f"feature_{code}"] = forms.ChoiceField(label=spec["name"], required=False, choices=TRI_STATE, widget=UnfoldAdminSelectWidget)

    def feature_overrides(self) -> dict:
        return {code: self.cleaned_data[f"feature_{code}"] == "on" for code in params.FEATURES if self.cleaned_data.get(f"feature_{code}")}


class ComponentsForm(forms.Form):
    """The components the workspace gets and the base report packs for them. Built for the plan chosen in the step before."""

    def __init__(self, *args, plan_id=None, saved=None, **kwargs):
        kwargs.pop("initial", None)
        super().__init__(*args, **kwargs)
        from apps.insights.base_packs import PACKS, needs
        self.registry = [spec for spec in components.registry() if spec["release"] in components.OFFERABLE]
        self.in_plan = set(components.plan_keys(plan_id)) if plan_id else set(components.FALLBACK_PLAN)
        self.names = {spec["key"]: spec["name"] for spec in components.registry()}
        self.packs = list(PACKS.values())
        self.needs = {pack["key"]: needs(pack) for pack in self.packs}
        on = set(saved["components"]) if saved else self.in_plan
        picked = set(saved.get("packs") or []) if saved else set()
        for spec in self.registry:
            where = "In the plan" if spec["key"] in self.in_plan else "Not in the plan: ticked, it is added as an add-on"
            self.fields[f"component_{spec['key']}"] = forms.BooleanField(label=spec["name"], required=False, initial=spec["key"] in on,
                                                                         help_text=f"{spec['tagline']} · {where}" if spec.get("tagline") else where)
        for pack in self.packs:
            self.fields[f"pack_{pack['key']}"] = forms.BooleanField(label=pack["name"], required=False, initial=pack["key"] in picked,
                                                                    help_text=f"{pack['summary']} Needs {', '.join(self.names.get(k, k) for k in self.needs[pack['key']])}.")

    def component_fields(self):
        return [self[f"component_{spec['key']}"] for spec in self.registry]

    def pack_fields(self):
        return [self[f"pack_{pack['key']}"] for pack in self.packs]

    def clean(self):
        data = super().clean()
        on = {spec["key"] for spec in self.registry if data.get(f"component_{spec['key']}")}
        if not on:
            raise forms.ValidationError("Tick at least one component.")
        for spec in self.registry:
            missing = [need for need in spec.get("needs") or [] if spec["key"] in on and need not in on]
            if missing:
                self.add_error(f"component_{spec['key']}", f"{spec['name']} needs {', '.join(self.names.get(k, k) for k in missing)}.")
        for pack in self.packs:
            missing = [k for k in self.needs[pack["key"]] if data.get(f"pack_{pack['key']}") and k not in on]
            if missing:
                self.add_error(f"pack_{pack['key']}", f"Needs {', '.join(self.names.get(k, k) for k in missing)}: tick it above, or leave this pack out.")
        return data

    def choices(self) -> dict:
        return {"components": [spec["key"] for spec in self.registry if self.cleaned_data.get(f"component_{spec['key']}")],
                "packs": [pack["key"] for pack in self.packs if self.cleaned_data.get(f"pack_{pack['key']}")]}


class AdminForm(forms.Form):
    display_name = forms.CharField(label="Full Name", max_length=200, widget=UnfoldAdminTextInputWidget)
    email = forms.EmailField(label="Email", widget=UnfoldAdminTextInputWidget, help_text="Their sign-in. Must not exist in another workspace.")
    also_invite = forms.CharField(label="Also Invite", required=False, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}),
                                  help_text="More administrators, one email per line. Optional. Each gets the Workspace Admin role and a password link.")

    def clean_email(self):
        value = self.cleaned_data["email"].strip().lower()
        if AppUser.objects.using(P).filter(email=value).exists():
            raise forms.ValidationError("A user with this email already exists.")
        return value

    def clean_also_invite(self):
        emails = []
        for line in self.cleaned_data["also_invite"].splitlines():
            value = line.strip().lower()
            if not value:
                continue
            forms.EmailField().clean(value)
            if AppUser.objects.using(P).filter(email=value).exists():
                raise forms.ValidationError(f"{value} already exists.")
            if value not in emails:
                emails.append(value)
        return emails

    def clean(self):
        data = super().clean()
        if data.get("email") and data.get("email") in (data.get("also_invite") or []):
            self.add_error("also_invite", "The first administrator is already invited.")
        return data


class PoliciesForm(forms.Form):
    without_consent = forms.ChoiceField(label="People Without Consent", choices=((consent_policy.HOLD_BACK, "Import and hold back until they confirm"), (consent_policy.REFUSE, "Refuse the row")),
                                        initial=consent_policy.HOLD_BACK, widget=UnfoldAdminSelectWidget, help_text="What an upload does with a new person who has no consent date in the file.")
    texts_need_date = forms.BooleanField(label="Texts Need a Consent Date", required=False, help_text="A Texts list cannot import a number without a text consent date.")
    approval_before_send = forms.BooleanField(label="Approval Before First Send", required=False, help_text="A new upload must be approved by someone with Consent · Edit before any campaign sends to it.")
    lifetime_months = forms.ChoiceField(label="Consent Lifetime", choices=[(str(m), f"{m // 12} year{'s' if m != 12 else ''}" if m % 12 == 0 else f"{m} months") for m in consent_policy.LIFETIMES],
                                        initial="24", widget=UnfoldAdminSelectWidget)


class HandoffForm(forms.Form):
    note = forms.CharField(label="A Line from You", max_length=500, required=False, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}),
                           help_text="Goes into the password-link email under the set-up list. Optional.")


FORMS = {"workspace": WorkspaceForm, "plan": PlanForm, "components": ComponentsForm, "admin": AdminForm, "policies": PoliciesForm, "handoff": HandoffForm}


def form_kwargs(draft: dict, step: str) -> dict:
    """what a step's form needs from the steps before it: the components step is built for the plan chosen"""
    if step != "components":
        return {}
    return {"plan_id": (draft["data"].get("plan") or {}).get("plan"), "saved": draft["data"].get("components")}


def _plan_words(plan) -> str:
    parts = []
    parts.append(f"{plan.max_contacts:,} contacts" if plan.max_contacts else "no contact limit")
    parts.append(f"{plan.max_messages_per_month:,} messages / month" if plan.max_messages_per_month else "no message limit")
    parts.append(f"{plan.max_users} users" if plan.max_users else "no user limit")
    parts.append("dedicated database" if plan.default_isolation_mode == "DEDICATED" else "shared database")
    return " · ".join(parts)


def component_groups(form: ComponentsForm) -> list[dict]:
    """the components step's two groups, as the page shows them"""
    return [{"key": "components", "title": "Components", "fields": form.component_fields(), "empty": "No component is released yet.",
             "text": "The plan's components are ticked. Untick one to switch it off for this workspace; tick one outside the plan to add it as an add-on."},
            {"key": "packs", "title": "Base Reports", "fields": form.pack_fields(), "empty": "No base report pack ships with this release.",
             "text": "Ready-made reports and dashboards for the components ticked above. Each reads a database the workspace connects, so it is added "
                     "in Insights → Reports → Add Base Reports afterwards, where the ones chosen here are marked. Insights offers only the packs its components fit."}]


# ------------------------------------------------------------------------------------------------------------ the draft
def draft_of(request) -> dict:
    return request.session.get(SESSION_KEY) or {"data": {}, "skipped": []}


def save_draft(request, draft: dict) -> None:
    request.session[SESSION_KEY] = draft
    request.session.modified = True


def clear_draft(request) -> None:
    request.session.pop(SESSION_KEY, None)
    request.session.modified = True


def next_step(current: str) -> str:
    return STEP_KEYS[min(STEP_KEYS.index(current) + 1, len(STEP_KEYS) - 1)]


def previous_step(current: str) -> str:
    return STEP_KEYS[max(STEP_KEYS.index(current) - 1, 0)]


def reachable(draft: dict, step: str) -> bool:
    """A step opens when every step before it is done or skipped."""
    done = set(draft["data"]) | set(draft.get("skipped", []))
    return all(key in done for key in STEP_KEYS[:STEP_KEYS.index(step)])


def step_state(draft: dict, step: str, current: str) -> str:
    if step == current:
        return "on"
    if step in draft["data"]:
        return "done"
    if step in draft.get("skipped", []):
        return "skipped"
    return ""


# ------------------------------------------------------------------------------------------------------------ what the pages show
def feature_table(plan_id: str | None, industry: str | None, overrides: dict) -> list[dict]:
    """Every feature with where its switch comes from: the catalogue, the profile, the override, the plan, and the result."""
    plan = SubscriptionPlan.objects.using(P).filter(pk=plan_id).first() if plan_id else None
    profile = IndustryProfile.objects.using(P).filter(pk=industry).first() if industry else None
    profile_features = (profile.features if profile else None) or {}
    plan_features = (plan.features if plan else None) or {}
    resolved = params.resolve({"features": overrides}, plan_features, {"features": profile_features})
    rows = []
    for code, spec in params.FEATURES.items():
        plan_word = "—" if not spec["plan_key"] else ("excluded" if plan_features.get(spec["plan_key"]) is False else ("allowed" if spec["plan_key"] in plan_features else "—"))
        rows.append({"code": code, "name": spec["name"], "default": "on" if spec["default"] else "off",
                     "profile": "—" if code not in profile_features else ("on" if profile_features[code] else "off"),
                     "override": "follow" if code not in overrides else ("on" if overrides[code] else "off"),
                     "plan": plan_word, "result": resolved[code], "excluded": spec["plan_key"] is not None and plan_features.get(spec["plan_key"]) is False})
    return rows


def policies_summary(data: dict | None) -> list[dict]:
    """The policies step as sentences: the consent policy chosen (or the defaults), and what the platform decides."""
    policy = {**consent_policy.DEFAULTS, **(data or {})}
    quiet = params.get("messaging.sms_quiet_hours", {}) or {}
    return [
        {"label": "Consent Policy", "text": f"People without consent: {'refuse' if policy['without_consent'] == consent_policy.REFUSE else 'hold back'} · "
                                            f"texts need a consent date: {'on' if policy['texts_need_date'] else 'off'} · approval before first send: {'on' if policy['approval_before_send'] else 'off'} · "
                                            f"lifetime {int(policy['lifetime_months'])} months" + ("" if data else " (platform defaults; the administrator can change it in Settings)")},
        {"label": "Quiet Hours for Marketing Texts", "text": (f"{quiet.get('start', '21:00')}–{quiet.get('end', '08:00')} in the workspace's time zone (global parameter messaging.sms_quiet_hours)"
                                                              if quiet else "Off (global parameter messaging.sms_quiet_hours is empty)")},
        {"label": "Security", "text": f"Idle timeout {params.get('security.idle_timeout_minutes', 120)} min with a {params.get('security.idle_warning_seconds', 60)} s warning · "
                                      f"password links valid {links.hours()} hours · support access {'notifies' if params.get('security.notify_user_on_support_access', True) else 'does not notify'} the user"},
        {"label": "Personalization Tags", "text": "Every active platform tag is copied into the workspace at onboarding; the three coupon tags are added for barcodes and QR codes."},
        {"label": "Single Sign-On", "text": "No identity provider yet: users sign in with a password. One can be registered later under Tenant identity providers."},
    ]


def components_of(draft: dict) -> dict:
    """the components step in words, and what finish() writes: which plan components go off, which others are add-ons"""
    from apps.insights.base_packs import PACKS
    data = draft["data"]
    plan_id = (data.get("plan") or {}).get("plan")
    in_plan = set(components.plan_keys(plan_id)) if plan_id else set(components.FALLBACK_PLAN)
    offerable = [spec for spec in components.registry() if spec["release"] in components.OFFERABLE]
    chosen = data.get("components")
    on = set(chosen["components"]) if chosen else in_plan
    return {"on": [spec["name"] for spec in offerable if spec["key"] in on],
            "off": [spec["key"] for spec in offerable if spec["key"] in in_plan and spec["key"] not in on],
            "addon": [spec["key"] for spec in offerable if spec["key"] not in in_plan and spec["key"] in on],
            "packs": [PACKS[k]["name"] for k in (chosen or {}).get("packs") or [] if k in PACKS], "pack_keys": [k for k in (chosen or {}).get("packs") or [] if k in PACKS]}


def mail_ready() -> tuple[bool, str]:
    if mail.is_configured(None):
        server = MailServer.objects.using(P).filter(tenant__isnull=True, is_active=True).first()
        return True, (f"the platform mail server {server.host}" if server else "the environment's mail settings")
    return False, "no platform mail server is configured: the password link cannot be emailed; copy it from the user's page afterwards, or configure Mail server first"


def review_of(draft: dict) -> dict:
    data = draft["data"]
    workspace, plan, admin = data.get("workspace", {}), data.get("plan", {}), data.get("admin", {})
    plan_row = SubscriptionPlan.objects.using(P).filter(pk=plan.get("plan")).first()
    profile = IndustryProfile.objects.using(P).filter(pk=plan.get("industry")).first() if plan.get("industry") else None
    table = feature_table(plan.get("plan"), plan.get("industry"), plan.get("features") or {})
    on = [row["name"] for row in table if row["result"]]
    overrides = [row["name"] for row in table if row["override"] != "follow"]
    trial = int(plan.get("trial_days") or 0)
    ready, mail_words = mail_ready()
    return {
        "workspace": workspace, "plan": plan_row, "profile": profile, "admin": admin, "policies": data.get("policies"), "handoff": data.get("handoff") or {},
        "features_on": on, "overrides": overrides, "components": components_of(draft),
        "subscription": (f"trial for {trial} days" if trial or not plan.get("billing_customer_ref") else "active") + (f" · billing reference {plan['billing_customer_ref']}" if plan.get("billing_customer_ref") else ""),
        "mail_ready": ready, "mail_words": mail_words, "checklist": HANDOFF_CHECKLIST,
        "invites": [admin.get("email")] + list(admin.get("also_invite") or []) if admin else [],
    }


# ------------------------------------------------------------------------------------------------------------ finishing
def finish(draft: dict, *, staff_user_id) -> dict:
    """The tenant and everything it needs, in one transaction; then the mail. Returns what was done, for the message."""
    data = draft["data"]
    workspace, plan, admin = data["workspace"], data["plan"], data["admin"]
    policies, handoff = data.get("policies"), data.get("handoff") or {}
    now = timezone.now()
    tenant_settings = {}
    if plan.get("industry"):
        tenant_settings["industry"] = plan["industry"]
    if plan.get("features"):
        tenant_settings["features"] = plan["features"]
    if policies:
        tenant_settings[consent_policy.KEY] = {**consent_policy.DEFAULTS, **{k: v for k, v in policies.items() if k in consent_policy.DEFAULTS}}
    chosen = components_of(draft)
    if chosen["pack_keys"]:
        tenant_settings["base_packs"] = chosen["pack_keys"]
    plan_row = SubscriptionPlan.objects.using(P).get(pk=plan["plan"])
    trial_days = int(plan.get("trial_days") or 0)
    with transaction.atomic(using=P):
        tenant = Tenant.objects.using(P).create(
            name=workspace["name"], code=workspace["code"], timezone=workspace["timezone"], status="ACTIVE",
            subdomain=workspace.get("subdomain") or None, custom_app_domain=workspace.get("custom_app_domain") or None,
            isolation_mode=workspace.get("isolation_mode") or "SHARED", region=workspace.get("region") or None, data_residency=workspace.get("data_residency") or None,
            settings=tenant_settings, onboarded_at=now, created_by_id=staff_user_id)
        for key in chosen["off"]:
            TenantComponent.objects.using(P).create(tenant=tenant, component_id=key, access="OFF", updated_by_id=staff_user_id)
        for key in chosen["addon"]:
            TenantComponent.objects.using(P).create(tenant=tenant, component_id=key, access="ADDON", updated_by_id=staff_user_id)
        params.invalidate(tenant.pk)
        provisioned = services.onboard_tenant(tenant, using=P, user_id=staff_user_id)
        TenantSubscription.objects.using(P).create(
            tenant=tenant, plan=plan_row, status="TRIAL" if trial_days or not plan.get("billing_customer_ref") else "ACTIVE",
            trial_ends_at=now + timedelta(days=trial_days) if trial_days else None, billing_customer_ref=plan.get("billing_customer_ref") or None, created_by_id=staff_user_id)
        role = Role.objects.using(P).filter(tenant=tenant, name="Workspace Admin", deleted_at__isnull=True).first()
        users = []
        for index, (email, name) in enumerate([(admin["email"], admin["display_name"])] + [(address, address.split("@")[0]) for address in admin.get("also_invite") or []]):
            user = AppUser.objects.db_manager(P).create_user(email, name, tenant, None, auth_provider="LOCAL", created_by_id=staff_user_id)
            if role is not None:
                UserRole.objects.using(P).create(user=user, role=role)
            users.append(user)
    sent, links_out = [], []
    for user in users:
        link = links.password_link(user)
        delivered = mail.is_configured(None) and mail.send("password_link", user.email, tenant_id=None, subject=f"Welcome to {tenant.code}: choose your password", context={
            "name": user.display_name, "workspace": tenant.code, "link": link, "hours": links.hours(), "invited": True, "invited_by": "The platform team",
            "checklist": HANDOFF_CHECKLIST, "note": handoff.get("note") or ""})
        (sent if delivered else links_out).append((user.email, link))
    return {"tenant": tenant, "provisioned": provisioned, "users": users, "sent": sent, "links": links_out, "subscription": "trial" if trial_days or not plan.get("billing_customer_ref") else "active"}
