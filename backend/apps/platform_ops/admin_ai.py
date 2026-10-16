"""Configuration -> AI Assistant (patch 0055; apps/insights/assistant.py): the platform's Claude and OpenAI keys, each stored
encrypted and never shown again, the two models each offers, a switch and Check Connection per provider; the default model,
whether Explain This Report may send totals; the plans' prompts a month; and this month's use by workspace and provider.
One page, mounted beside Mailgun Inspect under the mail server admin's address: /admin/platform_ops/mailserver/ai-assistant/.
"""
from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.core.cache import cache
from django.db import connections
from django.shortcuts import redirect, render
from django.urls import path
from django.utils import timezone
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextInputWidget, UnfoldBooleanSwitchWidget

from apps.insights import assistant

from . import billing, crypto

P = settings.PLATFORM_ALIAS


class ProviderForm(forms.Form):
    api_key = forms.CharField(label="API Key", required=False, max_length=500, widget=UnfoldAdminTextInputWidget(attrs={"type": "password", "autocomplete": "new-password"}),
                              help_text="Stored encrypted and never shown again. Leave empty to keep the saved key.")
    model_reports = forms.CharField(label="Model for Reports", max_length=80, widget=UnfoldAdminTextInputWidget, help_text="Offered as \"best for reports\".")
    model_fast = forms.CharField(label="Fast Model", max_length=80, widget=UnfoldAdminTextInputWidget, help_text="Offered as \"fastest\".")
    is_active = forms.BooleanField(label="Workspaces May Use This Provider", required=False, initial=True, widget=UnfoldBooleanSwitchWidget)

    def __init__(self, *args, saved_key=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.saved_key = saved_key

    def clean(self):
        data = super().clean()
        if not self.saved_key and not data.get("api_key"):
            self.add_error("api_key", "Enter the provider's API key.")
        for name in ("model_reports", "model_fast"):
            if data.get(name) and not all(ch.isalnum() or ch in "-._:" for ch in data[name]):
                self.add_error(name, "A model name: letters, digits, dots, dashes.")
        return data


class DefaultsForm(forms.Form):
    default_model = forms.ChoiceField(label="Default Model", required=False, widget=UnfoldAdminSelectWidget, help_text="Preselected for people who have not chosen.")
    explain_allowed = forms.BooleanField(label="Explain This Report May Send Totals", required=False, widget=UnfoldBooleanSwitchWidget,
                                         help_text="Totals only; personal-data fields are never sent. Each workspace has its own switch under this one.")

    def __init__(self, *args, models=(), **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["default_model"].choices = [("", "The first model offered")] + [(m["id"], f"{m['label']} · {m['provider_name']}") for m in models]


def _save_provider(provider: str, data: dict, row: dict | None, user_id) -> None:
    with connections[P].cursor() as cursor:
        if row is None:
            cursor.execute("""INSERT INTO ai_provider (provider, api_key_enc, model_reports, model_fast, is_active, created_by, updated_by)
                              VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                           [provider, crypto.encrypt(data["api_key"].strip()), data["model_reports"].strip(), data["model_fast"].strip(), data["is_active"], user_id, user_id])
            return
        sets, args = ["model_reports = %s", "model_fast = %s", "is_active = %s", "updated_by = %s", "updated_at = now()", "row_version = row_version + 1"], \
            [data["model_reports"].strip(), data["model_fast"].strip(), data["is_active"], user_id]
        if data.get("api_key"):
            sets += ["api_key_enc = %s", "last_checked_at = NULL", "last_check_ok = NULL", "last_check_error = NULL"]
            args.append(crypto.encrypt(data["api_key"].strip()))
        cursor.execute(f"UPDATE ai_provider SET {', '.join(sets)} WHERE provider = %s", [*args, provider])


def _set_param(key: str, value) -> None:
    import json
    with connections[P].cursor() as cursor:
        cursor.execute("UPDATE platform_setting SET value = %s::jsonb, updated_at = now() WHERE key = %s", [json.dumps(value), key])
    cache.delete("cep:params")


def _month_use() -> list[dict]:
    """This month's drafts by workspace and provider, with what each may ask for."""
    from apps.tenants.models import Tenant
    with connections[P].cursor() as cursor:
        cursor.execute("""SELECT tenant_id, provider, count(*) FROM ai_prompt WHERE counted AND created_at >= %s GROUP BY tenant_id, provider""", [billing.month_start()])
        counts = {}
        for tenant_id, provider, n in cursor.fetchall():
            counts.setdefault(tenant_id, {})[provider] = int(n)
    rows = []
    for tenant in Tenant.objects.using(P).filter(pk__in=counts.keys()).order_by("name"):
        plan = billing.plan_for(tenant.pk) or {}
        by = counts[tenant.pk]
        limit = plan.get("max_ai_prompts")
        rows.append({"tenant": tenant, "plan": plan.get("name") or "—", "anthropic": by.get("anthropic", 0), "openai": by.get("openai", 0),
                     "used": sum(by.values()), "limit": None if limit is None else int(limit)})
    return sorted(rows, key=lambda row: -row["used"])


def _plan_lines() -> list[dict]:
    from apps.tenants.models import SubscriptionPlan
    try:
        return [{"name": plan.name, "limit": plan.max_ai_prompts_per_month} for plan in SubscriptionPlan.objects.using(P).filter(is_active=True).order_by("monthly_price", "name")]
    except Exception:                                      # noqa: BLE001  before patch 0055 the column is not there
        return []


def ai_assistant_view(request):
    if not assistant.table_present():
        messages.error(request, "Patch 0055 has not been applied to this database: the AI Assistant tables are missing.")
        return render(request, "admin/platform_ops/ai_assistant.html", {**admin.site.each_context(request), "title": "AI Assistant", "providers": [], "defaults": None, "use": [], "plans": [], "month": billing.month_start()})
    rows = assistant.providers()
    action, _, which = (request.POST.get("action") or "").partition(":")
    if request.method == "POST" and action in ("check", "remove") and which in assistant.PROVIDERS:
        row = rows.get(which)
        if row is None or not row["api_key_enc"]:
            messages.error(request, "Save the provider first.")
        elif action == "remove":
            with connections[P].cursor() as cursor:
                cursor.execute("DELETE FROM ai_provider WHERE provider = %s", [which])
            messages.success(request, f"{assistant.PROVIDERS[which]['name']} was removed. Workspaces can no longer pick its models.")
        else:
            ok, detail = assistant.check(which, row)
            with connections[P].cursor() as cursor:
                cursor.execute("UPDATE ai_provider SET last_checked_at = %s, last_check_ok = %s, last_check_error = %s WHERE provider = %s",
                               [timezone.now(), ok, None if ok else detail[:300], which])
            (messages.success if ok else messages.error)(request, detail)
        return redirect("admin:platform_ops_ai_assistant")

    forms_ = {}
    for key, meta in assistant.PROVIDERS.items():
        row = rows.get(key)
        initial = ({"model_reports": row["model_reports"], "model_fast": row["model_fast"], "is_active": row["is_active"]} if row
                   else {"model_reports": assistant.DEFAULT_MODELS[key][0], "model_fast": assistant.DEFAULT_MODELS[key][1], "is_active": True})
        bound = request.method == "POST" and action == "save" and which == key
        forms_[key] = ProviderForm(request.POST if bound else None, initial=initial, prefix=key, saved_key=bool(row and row["api_key_enc"]))
        if bound and forms_[key].is_valid():
            _save_provider(key, forms_[key].cleaned_data, row, request.user.pk)
            messages.success(request, f"{meta['name']} saved. Check Connection to prove the key works.")
            return redirect("admin:platform_ops_ai_assistant")

    models = assistant.models_of(assistant.active_providers())
    defaults_bound = request.method == "POST" and action == "defaults"
    defaults = DefaultsForm(request.POST if defaults_bound else None, prefix="defaults", models=models,
                            initial={"default_model": str(assistant.params.get("ai.default_model", "") or ""), "explain_allowed": assistant.explain_allowed()})
    if defaults_bound and defaults.is_valid():
        _set_param("ai.default_model", defaults.cleaned_data.get("default_model") or "")
        _set_param("ai.explain_allowed", bool(defaults.cleaned_data.get("explain_allowed")))
        messages.success(request, "Saved.")
        return redirect("admin:platform_ops_ai_assistant")

    providers = [{"key": key, "name": meta["name"], "mark": meta["mark"], "keys": meta["keys"], "row": rows.get(key), "form": forms_[key]} for key, meta in assistant.PROVIDERS.items()]
    context = {**admin.site.each_context(request), "title": "AI Assistant", "providers": providers, "defaults": defaults, "use": _month_use(), "plans": _plan_lines(),
               "month": billing.month_start()}
    return render(request, "admin/platform_ops/ai_assistant.html", context)


def ai_urls(admin_site):
    """Mounted by the mail server admin, beside Mailgun Inspect under Configuration: /admin/platform_ops/mailserver/ai-assistant/."""
    return [path("ai-assistant/", admin_site.admin_view(ai_assistant_view), name="platform_ops_ai_assistant")]
