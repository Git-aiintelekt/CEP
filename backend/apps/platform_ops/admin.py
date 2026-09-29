import json
from datetime import timedelta

from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.shortcuts import render
from django.urls import path
from django.utils import timezone
from unfold.decorators import action, display
from unfold.widgets import (UnfoldAdminDecimalFieldWidget, UnfoldAdminIntegerFieldWidget, UnfoldAdminSelectMultipleWidget, UnfoldAdminSelectWidget,
                            UnfoldAdminTextInputWidget, UnfoldAdminTextareaWidget, UnfoldBooleanSwitchWidget)

from apps.adminutils import BaseAdmin, ReadOnlyAdmin, register_app_models

from . import billing, crypto, mail, params, tenant_ops, typed_values
from .models import (IndustryProfile, JobRun, MailServer, PlatformAlert, PlatformPersonalizationTag, PlatformSetting, SupportAccessLog, TenantIdentityProvider, TenantInvoice,
                     TenantOperation)

P = settings.PLATFORM_ALIAS


# ------------------------------------------------------------------------------------------------------------ billing
@admin.register(TenantInvoice)
class TenantInvoiceAdmin(BaseAdmin):
    """Drafts are produced by the generate-invoices job. Issue them here; mark them paid when the money arrives."""
    list_display = ("invoice_number", "tenant", "period_month", "plan_code", "total_amount", "currency", "show_status", "due_at")
    list_filter = ("status", "period_month", "tenant")
    search_fields = ("invoice_number",)
    ordering = ("-period_month", "invoice_number")
    actions = ("issue", "mark_paid", "void")
    readonly_fields = ("tenant", "invoice_number", "period_month", "plan_code", "currency", "base_amount", "overage_amount", "total_amount", "line_items",
                       "usage_snapshot", "issued_at", "paid_at", "created_at", "updated_at")
    fields = (*readonly_fields[:10], "status", "due_at", "external_ref", *readonly_fields[10:])

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @display(description="Status", label={"DRAFT": "info", "ISSUED": "warning", "PAID": "success", "VOID": "danger"})
    def show_status(self, obj):
        return obj.status

    @action(description="Issue: the tenant can see it, the due date starts")
    def issue(self, request, queryset):
        days = int(params.get("billing.invoice_due_days", 14))
        for invoice in queryset.filter(status="DRAFT"):
            self.set_fields(request, invoice, status="ISSUED", issued_at=timezone.now(), due_at=timezone.now() + timedelta(days=days))
        messages.success(request, f"Issued. Due in {days} days.")

    @action(description="Mark as paid")
    def mark_paid(self, request, queryset):
        for invoice in queryset.filter(status="ISSUED"):
            self.set_fields(request, invoice, status="PAID", paid_at=timezone.now())

    @action(description="Void")
    def void(self, request, queryset):
        for invoice in queryset.exclude(status="PAID"):
            self.set_fields(request, invoice, status="VOID")

    def get_urls(self):
        return [path("usage/", self.admin_site.admin_view(self.usage_view), name="platform_ops_usage"), *super().get_urls()]

    def usage_view(self, request):
        """Every tenant's month so far against its plan, worst first."""
        if request.method == "POST":
            result = billing.rollup_usage()
            messages.success(request, f"Usage recomputed for {result['month']}: {result['values']} values.")
        from apps.tenants.models import Tenant
        rows = []
        for tenant in Tenant.objects.using(P).exclude(status="OFFBOARDED").order_by("code"):
            quota = billing.quota(tenant.id)
            worst = max((m["percent"] or 0) for m in quota["meters"])
            rows.append({"tenant": tenant, "quota": quota, "worst": worst})
        rows.sort(key=lambda row: -row["worst"])
        context = {**self.admin_site.each_context(request), "title": "Usage against plan limits", "rows": rows, "month": billing.month_start()}
        return render(request, "admin/platform_ops/usage.html", context)


# ------------------------------------------------------------------------------------------------------------ tenant operations
class TenantOperationForm(forms.ModelForm):
    class Meta:
        model = TenantOperation
        fields = ("tenant", "operation", "parameters")
        help_texts = {"parameters": 'MOVE_TO_DEDICATED: {"db_alias": "acme", "db_host": "10.0.0.50", "db_port": 5432, "db_name": "cep_acme", "db_secret_ref": "env:ACME_DB"} '
                                    '· OFFBOARD: {"confirm": "<TENANT CODE>"} · EXPORT and PURGE_SOURCE need none.'}

    def clean(self):
        data = super().clean()
        operation, parameters, tenant = data.get("operation"), data.get("parameters") or {}, data.get("tenant")
        if operation == "MOVE_TO_DEDICATED":
            missing = [key for key in ("db_alias", "db_host", "db_name", "db_secret_ref") if not parameters.get(key)]
            if missing:
                self.add_error("parameters", f"Missing: {', '.join(missing)}")
        if operation == "OFFBOARD" and tenant and str(parameters.get("confirm", "")).upper() != tenant.code.upper():
            self.add_error("parameters", f'Offboarding erases the tenant\'s data. Confirm with {{"confirm": "{tenant.code}"}}.')
        if tenant and TenantOperation.objects.using(P).filter(tenant=tenant, status__in=["REQUESTED", "RUNNING"]).exists():
            self.add_error("tenant", "This tenant already has an operation waiting or running.")
        return data


@admin.register(TenantOperation)
class TenantOperationAdmin(BaseAdmin):
    """Request here; the run-tenant-operations job (or `manage.py run_tenant_operation <id>`) executes. Each step is logged below."""
    form = TenantOperationForm
    list_display = ("requested_at", "tenant", "operation", "show_status", "requested_by", "started_at", "finished_at")
    list_filter = ("status", "operation", "tenant")
    ordering = ("-requested_at",)
    autocomplete_fields = ("tenant",)
    actions = ("run_now", "cancel")
    readonly_fields = ("status", "show_progress", "show_result", "error", "requested_by", "requested_at", "started_at", "finished_at")

    def get_fields(self, request, obj=None):
        return ("tenant", "operation", "parameters") if obj is None else ("tenant", "operation", "parameters", *self.readonly_fields)

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields if obj is None else ("tenant", "operation", "parameters", *self.readonly_fields)

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        if not change:
            obj.requested_by_id = request.user.pk
        super().save_model(request, obj, form, change)
        if not change:
            messages.info(request, f"Requested. It runs with the next run-tenant-operations job, or now with: python manage.py run_tenant_operation {obj.pk}")

    @display(description="Status", label={"REQUESTED": "info", "RUNNING": "warning", "SUCCEEDED": "success", "FAILED": "danger", "CANCELLED": "info"})
    def show_status(self, obj):
        return obj.status

    @display(description="Steps")
    def show_progress(self, obj):
        return "\n".join(f"{step.get('at', '')}  {step.get('step', ''):<10} {step.get('detail', '')}" for step in obj.progress or []) or "—"

    @display(description="Result")
    def show_result(self, obj):
        return json.dumps(obj.result, indent=2) if obj.result else "—"

    @action(description="Run now, in this request (small tenants only; a move waits 70 s for caches)")
    def run_now(self, request, queryset):
        for operation in queryset.filter(status="REQUESTED"):
            try:
                tenant_ops.run(operation.pk)
                messages.success(request, f"{operation}: succeeded.")
            except Exception as exc:
                messages.error(request, f"{operation}: {exc}")

    @action(description="Cancel (only while still waiting)")
    def cancel(self, request, queryset):
        updated = queryset.filter(status="REQUESTED").update(status="CANCELLED", finished_at=timezone.now())
        messages.info(request, f"{updated} cancelled.")


# ------------------------------------------------------------------------------------------------------------ jobs and alerts
@admin.register(JobRun)
class JobRunAdmin(ReadOnlyAdmin):
    list_display = ("started_at", "job_name", "show_status", "duration_ms", "worker", "short_error")
    list_filter = ("status", "job_name")
    ordering = ("-started_at",)

    @display(description="Status", label={"SUCCEEDED": "success", "FAILED": "danger", "RUNNING": "warning"})
    def show_status(self, obj):
        return obj.status

    @display(description="Error")
    def short_error(self, obj):
        return (obj.error or "").splitlines()[0][:120] if obj.error else "—"


@admin.register(PlatformAlert)
class PlatformAlertAdmin(ReadOnlyAdmin):
    """Opened and closed by the evaluate-alerts job. Acknowledge one to stop its repeat notifications."""
    list_display = ("opened_at", "check_name", "show_severity", "summary", "notifications", "show_state")
    list_filter = ("severity", "check_name")
    ordering = ("-opened_at",)
    actions = ("acknowledge",)

    @display(description="Severity", label={"FAIL": "danger", "WARN": "warning"})
    def show_severity(self, obj):
        return obj.severity

    @display(description="State", label={"Open": "danger", "Acknowledged": "warning", "Resolved": "success"})
    def show_state(self, obj):
        return "Resolved" if obj.resolved_at else "Acknowledged" if obj.acknowledged_at else "Open"

    def has_change_permission(self, request, obj=None):
        return obj is None                                 # the list (for the action), never the form

    @action(description="Acknowledge: stop repeating the notification")
    def acknowledge(self, request, queryset):
        updated = queryset.filter(resolved_at__isnull=True, acknowledged_at__isnull=True).update(acknowledged_by_id=request.user.pk, acknowledged_at=timezone.now())
        messages.success(request, f"{updated} acknowledged.")


# ------------------------------------------------------------------------------------------------------------ support access, SSO
@admin.register(SupportAccessLog)
class SupportAccessLogAdmin(ReadOnlyAdmin):
    list_display = ("started_at", "tenant", "staff_name", "target_user", "access_mode", "reason", "writes", "show_state")
    list_filter = ("tenant", "access_mode")
    ordering = ("-started_at",)
    actions = ("end_now",)

    @display(description="State", label={"Active": "warning", "Ended": "success", "Expired": "info"})
    def show_state(self, obj):
        return "Ended" if obj.ended_at else "Active" if obj.expires_at > timezone.now() else "Expired"

    def has_change_permission(self, request, obj=None):
        return obj is None

    @action(description="End the session now")
    def end_now(self, request, queryset):
        updated = queryset.filter(ended_at__isnull=True, expires_at__gt=timezone.now()).update(ended_at=timezone.now())
        messages.success(request, f"{updated} ended.")


@admin.register(TenantIdentityProvider)
class TenantIdentityProviderAdmin(BaseAdmin):
    """Tenants configure their own identity provider in Settings. Here: see it, switch it off in an emergency."""
    list_display = ("tenant", "display_name", "issuer", "is_active", "enforce_sso", "jit_provisioning")
    list_filter = ("is_active", "enforce_sso")
    exclude = ("client_secret_enc",)
    readonly_fields = ("tenant", "protocol", "issuer", "client_id", "scopes", "allowed_email_domains", "jit_provisioning", "default_role",
                       "created_by", "updated_by", "created_at", "updated_at", "row_version")

    def has_add_permission(self, request):
        return False


# ------------------------------------------------------------------------------------------------------------ global parameters, industry profiles
MEMBER = "member__"                                     # an object's keys, one form field each
NEW_KEY, NEW_VALUE = "new_key", "new_value"


def typed_field(kind: str, value, label: str) -> forms.Field:
    """A form field a person can use for one value of the given kind, holding the current value."""
    if kind == "INTEGER":
        return forms.IntegerField(label=label, required=False, initial=value, widget=UnfoldAdminIntegerFieldWidget)
    if kind == "DECIMAL":
        return forms.FloatField(label=label, required=False, initial=value, widget=UnfoldAdminDecimalFieldWidget)
    if kind == "BOOLEAN":
        return forms.BooleanField(label=label, required=False, initial=bool(value), widget=UnfoldBooleanSwitchWidget)
    if kind == "LIST":
        return forms.CharField(label=label, required=False, initial="\n".join(str(item) for item in (value or [])),
                               widget=UnfoldAdminTextareaWidget, help_text="One per line.")
    return forms.CharField(label=label, required=False, initial="" if value is None else str(value), widget=UnfoldAdminTextInputWidget)


def value_fields(setting) -> dict[str, forms.Field]:
    """The fields the change form shows for one parameter: one for a plain value, one per key for an object plus room for a new key."""
    kind, value = setting.value_type, setting.value
    if kind != "OBJECT":
        return {"typed_value": typed_field(kind, value, "Value")}
    fields = {f"{MEMBER}{key}": typed_field(typed_values.kind_of(item), item, key) for key, item in (value or {}).items()}
    fields[NEW_KEY] = forms.CharField(label="Add a value: name", required=False, widget=UnfoldAdminTextInputWidget)
    fields[NEW_VALUE] = forms.CharField(label="Add a value: value", required=False, widget=UnfoldAdminTextInputWidget,
                                        help_text="Yes / no, a number, or text. Leave both empty to add nothing.")
    return fields


class PlatformSettingForm(forms.ModelForm):
    """The add form: the kind chosen beside one text box. The change form (built per parameter by the admin) adds the typed fields."""
    value_type = forms.ChoiceField(label="Kind", choices=typed_values.KINDS, widget=UnfoldAdminSelectWidget)
    raw = forms.CharField(label="Value", required=False, widget=UnfoldAdminTextareaWidget,
                          help_text="As it will be read: text, a number, yes / no; a list one entry per line; several values as key: value lines.")

    class Meta:
        model = PlatformSetting
        fields = ("key", "category", "description", "value_type")

    def clean(self):
        data = super().clean()
        kind = self.instance.value_type if self.instance.pk else data.get("value_type")
        try:
            self.assembled = self._assemble(kind, data)
        except typed_values.ValueProblem as problem:
            self.add_error("raw" if not self.instance.pk else self._value_field(kind), str(problem))
        return data

    def _value_field(self, kind):
        return "typed_value" if kind != "OBJECT" else NEW_VALUE

    def _assemble(self, kind, data):
        if not self.instance.pk:
            return typed_values.parse_typed(kind, data.get("raw"))
        if kind == "LIST":
            return typed_values.parse_lines(data.get("typed_value"))
        if kind in ("STRING", "INTEGER", "DECIMAL", "BOOLEAN"):
            value = data.get("typed_value")
            if kind == "STRING":
                return (value or "").strip()
            if kind == "BOOLEAN":
                return bool(value)
            if value is None:
                raise typed_values.ValueProblem("Type the value.")
            return value
        current = dict(self.instance.value or {})
        result = {}
        for key, item in current.items():
            typed = data.get(f"{MEMBER}{key}")
            member_kind = typed_values.kind_of(item)
            if member_kind == "STRING":
                result[key] = None if (typed is None or typed == "") and item is None else (typed or "")
            elif member_kind == "BOOLEAN":
                result[key] = bool(typed)
            elif member_kind in ("LIST", "OBJECT"):
                result[key] = item                                     # nested values are left as they are
            else:
                result[key] = typed if typed is not None else None
        name, value = (data.get(NEW_KEY) or "").strip(), data.get(NEW_VALUE) or ""
        if name:
            result[name] = typed_values.parse_loose(value)
        elif value.strip():
            raise typed_values.ValueProblem("Name the value to add.")
        return result


@admin.register(PlatformSetting)
class PlatformSettingAdmin(BaseAdmin):
    """Global parameters of this installation. They take effect within a minute, without a deployment. Never put a secret here."""
    form = PlatformSettingForm
    list_display = ("key", "category", "show_value", "description", "updated_at")
    list_filter = ("category",)
    search_fields = ("key", "description", "category")
    ordering = ("category", "key")

    def get_readonly_fields(self, request, obj=None):
        return ("key", "value_type") if obj else ()

    def get_form(self, request, obj=None, **kwargs):
        # the typed fields must be declared on the form class: the admin checks its fieldsets against them
        if obj is not None:
            declared = {"value_type": None, "raw": None, **value_fields(obj)}          # the add form's fields give way to the typed ones
            kwargs["form"] = type("PlatformSettingTypedForm", (PlatformSettingForm,), declared)
        return super().get_form(request, obj, **kwargs)

    def get_fieldsets(self, request, obj=None):
        if obj is None:
            return ((None, {"fields": ("key", "category", "description", "value_type", "raw")}),)
        return ((None, {"fields": ("key", "category", "description", "value_type")}),
                ("Value", {"fields": tuple(value_fields(obj)), "description": f"Kind: {typed_values.KIND_NAMES.get(obj.value_type, obj.value_type)}. Takes effect within a minute of saving."}))

    @display(description="Value")
    def show_value(self, obj):
        return typed_values.describe(obj.value_type, obj.value)[:80]

    def save_model(self, request, obj, form, change):
        obj.value = form.assembled
        obj.updated_by_id = request.user.pk
        obj.save()
        params.invalidate()

    def delete_model(self, request, obj):
        super().delete_model(request, obj)
        params.invalidate()


TRI_STATE = (("", "Feature default"), ("on", "On"), ("off", "Off"))


class FeatureChoicesMixin(forms.ModelForm):
    """One drop-down per product feature (default / on / off), stored as a JSON object on the model."""
    json_field = "features"

    # declared on the class, not added in __init__: the admin validates its fieldsets against the form CLASS
    for _code, _spec in params.FEATURES.items():
        vars()[f"feature_{_code}"] = forms.ChoiceField(
            label=_spec["name"], required=False, widget=UnfoldAdminSelectWidget,
            choices=((TRI_STATE[0][0], f"Default ({'on' if _spec['default'] else 'off'})"), *TRI_STATE[1:]))
    del _code, _spec

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        current = self._current_features()
        for code in params.FEATURES:
            self.fields[f"feature_{code}"].initial = "" if code not in current else ("on" if current[code] else "off")

    def _current_features(self) -> dict:
        return getattr(self.instance, self.json_field, None) or {}

    def chosen_features(self) -> dict:
        return {code: self.cleaned_data[f"feature_{code}"] == "on" for code in params.FEATURES if self.cleaned_data.get(f"feature_{code}")}


class IndustryProfileForm(FeatureChoicesMixin):
    class Meta:
        model = IndustryProfile
        fields = ("code", "name", "description", "terminology", "defaults", "is_active", "sort_order")

    def save(self, commit=True):
        self.instance.features = self.chosen_features()
        return super().save(commit)


@admin.register(IndustryProfile)
class IndustryProfileAdmin(BaseAdmin):
    """What a kind of business gets by default and what it calls things. A tenant picks its profile on its own page."""
    form = IndustryProfileForm
    list_display = ("name", "code", "show_features", "show_terms", "is_active", "sort_order")
    ordering = ("sort_order", "name")

    def get_fieldsets(self, request, obj=None):
        return ((None, {"fields": ("code", "name", "description", "is_active", "sort_order")}),
                ("Features for this kind of business", {"fields": tuple(f"feature_{code}" for code in params.FEATURES),
                                                       "description": "“Default” leaves the product default. A tenant can still override, and its plan always has the last word."}),
                ("Vocabulary and defaults", {"fields": ("terminology", "defaults"),
                                             "description": 'terminology renames customer / location / transaction, e.g. {"customer": "guest"}.'}))

    def get_readonly_fields(self, request, obj=None):
        return ("code",) if obj else ()

    @display(description="Switches")
    def show_features(self, obj):
        return ", ".join(f"{'+' if on else '−'}{code}" for code, on in (obj.features or {}).items()) or "defaults"

    @display(description="Vocabulary")
    def show_terms(self, obj):
        return ", ".join(f"{k} → {v}" for k, v in (obj.terminology or {}).items()) or "—"

    def save_model(self, request, obj, form, change):
        obj.updated_by_id = request.user.pk
        obj.save()
        params.invalidate()


# ------------------------------------------------------------------------------------------------------------ mail servers
class MailServerForm(forms.ModelForm):
    """The platform's own server (no tenant) and, read-only apart from switching off, every tenant's."""
    password = forms.CharField(required=False, widget=UnfoldAdminTextInputWidget(attrs={"type": "password", "autocomplete": "new-password"}),
                               help_text="Leave empty to keep the stored password. Stored encrypted, never shown.")

    class Meta:
        model = MailServer
        fields = ("host", "port", "security", "username", "from_email", "from_name", "reply_to", "is_active")

    def clean(self):
        data = super().clean()
        port, security = data.get("port") or 587, data.get("security")
        if security == "SSL" and port == 587 or security == "STARTTLS" and port == 465:
            self.add_error("port", "Port 587 goes with STARTTLS and port 465 with SSL/TLS.")
        if not data.get("host"):
            self.add_error("host", "Enter the SMTP server name.")
        return data

    def save(self, commit=True):
        if self.cleaned_data.get("password"):
            self.instance.password_enc = crypto.encrypt(self.cleaned_data["password"])
        return super().save(commit)


@admin.register(MailServer)
class MailServerAdmin(BaseAdmin):
    """The platform's outgoing mail server: the platform's own mail (alerts, password links, support notices), and the fallback
    for a tenant without a working server of its own. Never a tenant's sending engine. Tenants enter theirs under
    Settings -> Email server; they appear here for support, passwords never shown."""
    form = MailServerForm
    list_display = ("owner", "host", "port", "security", "from_email", "is_active", "show_test")
    ordering = ("tenant__code",)
    actions_detail = ("send_test",)
    readonly_fields = ("last_tested_at", "last_test_ok", "last_test_error", "created_at", "updated_at")

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("tenant")

    def has_add_permission(self, request):
        return not MailServer.objects.using(P).filter(tenant_id__isnull=True).exists()       # one platform row; tenants add their own

    def get_fieldsets(self, request, obj=None):
        own = obj is not None and obj.tenant_id is not None
        sets = [("Server", {"fields": ("host", "port", "security", "username", *(() if own else ("password",)))}),
                ("Sender", {"fields": ("from_email", "from_name", "reply_to", "is_active")})]
        if obj is not None:
            sets.append(("Last test", {"fields": ("last_tested_at", "last_test_ok", "last_test_error", "created_at", "updated_at")}))
        return sets

    def get_readonly_fields(self, request, obj=None):
        if obj is not None and obj.tenant_id is not None:                   # a tenant's server: staff may switch it off, not rewrite it
            return ("host", "port", "security", "username", "from_email", "from_name", "reply_to", *self.readonly_fields)
        return self.readonly_fields

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        if obj is not None and obj.tenant_id is not None:
            form.base_fields.pop("password", None)
        return form

    @display(description="Owner")
    def owner(self, obj):
        return obj.tenant.code if obj.tenant_id else "Platform"

    @display(description="Last test", label={"OK": "success", "Failed": "danger", "Never": "info"})
    def show_test(self, obj):
        return "Never" if obj.last_test_ok is None else "OK" if obj.last_test_ok else "Failed"

    @action(description="Send a test message to me", url_path="send-test")
    def send_test(self, request, object_id):
        from django.shortcuts import redirect
        server = MailServer.objects.using(P).get(pk=object_id)
        ok, error = mail.test(server, request.user.email, by=request.user.display_name)
        if ok:
            messages.success(request, f"Test message sent to {request.user.email}.")
        else:
            messages.error(request, f"The test failed: {error}")
        return redirect("admin:platform_ops_mailserver_change", object_id)




# ---------------------------------------------------------------- personalization tags (patch 0026)
from apps.templates import datapoints, inherit  # noqa: E402  the catalogue's data points and the push into workspaces

CHANNELS = (("EMAIL", "Email"), ("E_RECEIPT", "E-Receipt"), ("SMS", "SMS"), ("MMS", "MMS"))
DATA_TYPES = (("STRING", "Text"), ("NUMBER", "Number"), ("DATE", "Date"), ("BOOLEAN", "Yes / No"))
TAG_KINDS = (("STANDARD", "Standard"), ("CUSTOM", "Custom"), ("SYSTEM", "System"))


class PlatformPersonalizationTagForm(forms.ModelForm):
    """A tag is a key, a label and a data point: where the value comes from, chosen from what each source offers."""
    data_point = forms.ChoiceField(label="Data point", choices=datapoints.choices, widget=UnfoldAdminSelectWidget,
                                   help_text="Where the value comes from. For a customer attribute or a column from a list upload, pick the typed entry and complete the path below.")
    source_path = forms.CharField(label="Path", required=False, widget=UnfoldAdminTextInputWidget,
                                  help_text="Only for a typed data point: custom_attributes.<key> or custom_value_pairs.<column>.")
    applies_to_channels = forms.MultipleChoiceField(label="Offered in", choices=CHANNELS, widget=UnfoldAdminSelectMultipleWidget, initial=[c for c, _ in CHANNELS])
    data_type = forms.ChoiceField(choices=DATA_TYPES, widget=UnfoldAdminSelectWidget)
    tag_kind = forms.ChoiceField(label="Kind", choices=TAG_KINDS, widget=UnfoldAdminSelectWidget)

    class Meta:
        model = PlatformPersonalizationTag
        fields = ("tag_key", "label", "tag_kind", "data_point", "source_path", "static_value", "default_value", "format_spec", "data_type",
                  "applies_to_channels", "sample_value", "description", "is_active")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        tag = self.instance
        if tag and tag.pk:
            source, path = tag.resolution_source, tag.source_path or ""
            fixed = datapoints.data_type_of(source, path) is not None
            prefix = next((known for known, _, _ in datapoints.DATA_POINTS.get(source, []) if datapoints.is_prefix(known) and path.startswith(known)), None)
            self.fields["data_point"].initial = datapoints.STATIC_POINT if source == "STATIC" else datapoints.point_id(source, path if fixed else (prefix or path))
            self.fields["source_path"].initial = "" if fixed or source == "STATIC" else path

    def clean_tag_key(self):
        key = (self.cleaned_data["tag_key"] or "").strip().strip("{}").strip()
        if not key.replace("_", "").isalnum() or not key[:1].isalpha() or key != key.lower():
            raise forms.ValidationError("Lower-case letters, digits and underscores, starting with a letter: the word inside {{ }}.")
        return key

    def clean(self):
        data = super().clean()
        source, point = datapoints.split_point(data.get("data_point") or "")
        typed = (data.get("source_path") or "").strip()
        path = typed if datapoints.is_prefix(point) or (point == "" and source != "STATIC") else point
        if datapoints.is_prefix(point) and typed and not typed.startswith(point):
            path = point + typed                                       # they typed the key alone: complete it
        if source == "STATIC":
            path = ""
        found = datapoints.problem(source, path, data.get("static_value"))
        if found:
            self.add_error("source_path" if source != "STATIC" else "static_value", found)
        data["resolution_source"], data["source_path"] = source, path or None
        if source != "STATIC":
            data["static_value"] = None
        return data

    def save(self, commit=True):
        self.instance.resolution_source = self.cleaned_data["resolution_source"]
        self.instance.source_path = self.cleaned_data["source_path"]
        self.instance.static_value = self.cleaned_data.get("static_value")
        return super().save(commit)


@admin.register(PlatformPersonalizationTag)
class PlatformPersonalizationTagAdmin(BaseAdmin):
    """The installation's tag catalogue. Every workspace inherits a copy of each active tag; saving one pushes the change to all of them."""
    form = PlatformPersonalizationTagForm
    list_display = ("show_key", "label", "show_source", "data_type", "show_channels", "is_active", "show_workspaces", "updated_at")
    list_filter = ("resolution_source", "tag_kind", "is_active")
    search_fields = ("tag_key", "label", "source_path", "description")
    ordering = ("tag_key",)
    actions = ("push_to_workspaces",)
    fieldsets = (
        (None, {"fields": ("tag_key", "label", "tag_kind", "is_active")}),
        ("Where the value comes from", {"fields": ("data_point", "source_path", "static_value", "default_value", "data_type", "format_spec"),
                                        "description": "At send time: the data point, else the person's uploaded columns, else the customer's attributes, else the default value. format_spec is a date or number pattern."}),
        ("In the designer", {"fields": ("applies_to_channels", "sample_value", "description"),
                             "description": "The sample value is what previews and the SMS counter show; the description is the tag's help in the Tags panel."}),
    )

    def get_readonly_fields(self, request, obj=None):
        return ("tag_key",) if obj else ()

    @display(description="Tag")
    def show_key(self, obj):
        return "{{" + obj.tag_key + "}}"

    @display(description="Data point")
    def show_source(self, obj):
        name = datapoints.SOURCES.get(obj.resolution_source, obj.resolution_source)
        return f"{name}: {obj.static_value}" if obj.resolution_source == "STATIC" else f"{name}: {obj.source_path or ''}"

    @display(description="Offered in")
    def show_channels(self, obj):
        return ", ".join(dict(CHANNELS).get(c, c) for c in obj.applies_to_channels or [])

    @display(description="Workspaces")
    def show_workspaces(self, obj):
        return inherit.workspaces_using(obj.pk, using=settings.PLATFORM_ALIAS)

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        outcomes = inherit.push_platform_tag(obj, using=settings.PLATFORM_ALIAS, user_id=request.user.pk)
        messages.success(request, f"{{{{{obj.tag_key}}}}} saved and applied to every workspace: {inherit.summary(outcomes)}.")

    def delete_model(self, request, obj):
        released = inherit.workspaces_using(obj.pk, using=settings.PLATFORM_ALIAS)
        super().delete_model(request, obj)
        messages.warning(request, f"Deleted. {released} workspace copies are now the workspaces' own tags: switch a tag off instead when it should disappear everywhere.")

    @action(description="Apply to every workspace again")
    def push_to_workspaces(self, request, queryset):
        for tag in queryset:
            outcomes = inherit.push_platform_tag(tag, using=settings.PLATFORM_ALIAS, user_id=request.user.pk)
            messages.success(request, f"{{{{{tag.tag_key}}}}}: {inherit.summary(outcomes)}.")


register_app_models(__package__)
