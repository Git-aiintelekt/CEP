"""Global parameters (platform_setting) and per-tenant feature resolution (industry profile + plan + tenant overrides).

    from apps.platform_ops import params
    params.get("security.password_link_hours", 72)
    params.features_for(tenant_id)      -> {"journeys": True, "ereceipt": False, ...}
    params.RequiresFeature.for_("journeys")      # DRF permission

Both are cached for a minute: changing a parameter in the back-office takes effect without a deployment.
"""
from django.conf import settings
from django.core.cache import cache
from django.db import connections
from rest_framework.permissions import BasePermission

TTL = 60

# The product's switchable features. `default` applies when neither the industry profile nor the tenant says otherwise;
# `plan_key` names the subscription_plan.features entry that can switch the feature off for a whole plan.
FEATURES = {
    "email":         {"name": "Email campaigns",             "default": True,  "plan_key": None},
    "sms":           {"name": "SMS messages",                "default": True,  "plan_key": None},
    "mms":           {"name": "MMS picture messages",        "default": True,  "plan_key": None},
    "ereceipt":      {"name": "E-receipts",                  "default": False, "plan_key": "ereceipt"},
    "journeys":      {"name": "Journeys",                    "default": True,  "plan_key": "journeys"},
    "ab_testing":    {"name": "Subject-line A/B testing",    "default": True,  "plan_key": "ab_testing"},
    "loyalty":       {"name": "Loyalty tags and statements", "default": False, "plan_key": None},
    "api_access":    {"name": "API keys and integrations",   "default": True,  "plan_key": None},
    "webhooks":      {"name": "Outbound webhooks",           "default": True,  "plan_key": None},
    "sso":           {"name": "Single sign-on",              "default": True,  "plan_key": None},
    "custom_domain": {"name": "Custom sending domain",       "default": False, "plan_key": "custom_domain"},
    "scoring":       {"name": "AI scoring",                  "default": False, "plan_key": None},
    # off until tenant management switches it on for a workspace; a plan can still switch it off for all of its tenants
    "dynamic_codes": {"name": "Barcodes and QR codes",       "default": False, "plan_key": "dynamic_codes"},
    "deliverability_tests": {"name": "Deliverability tests (inbox previews)", "default": True, "plan_key": "deliverability_tests"},
}
CHANNEL_FEATURE = {"EMAIL": "email", "E_RECEIPT": "ereceipt", "SMS": "sms", "MMS": "mms"}
TERMS = ("customer", "location", "transaction")           # words an industry profile may rename


def _rows(sql, args=()):
    with connections[settings.CONTROL_PLANE_ALIAS].cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchall()


def all_settings() -> dict:
    values = cache.get("cep:params")
    if values is None:
        values = dict(_rows("SELECT key, value FROM platform_setting"))
        import json
        values = {key: json.loads(value) if isinstance(value, str) else value for key, value in values.items()}
        cache.set("cep:params", values, TTL)
    return values


def get(key: str, default=None):
    value = all_settings().get(key, default)
    return default if value in (None, "") else value


def public_api_url() -> str:
    """The address the outside world reaches this installation's API at: provider webhook callbacks, the unsubscribe link
    in marketing emails and the single sign-on redirect are built from it. The `platform.api_public_url` parameter wins;
    empty, the API_PUBLIC_URL environment variable applies (how a fresh installation bootstraps)."""
    return str(get("platform.api_public_url", settings.API_PUBLIC_URL)).rstrip("/")


def invalidate(tenant_id=None) -> None:
    cache.delete("cep:params")
    if tenant_id:
        cache.delete(f"cep:features:{tenant_id}")


def resolve(tenant_settings: dict, plan_features: dict | None, profile: dict | None) -> dict:
    """Pure resolution, in order: catalogue default -> industry profile -> tenant override, and finally the plan, which
    can only take a feature away (a tenant cannot switch on what its plan does not include)."""
    profile_features = (profile or {}).get("features") or {}
    overrides = (tenant_settings or {}).get("features") or {}
    plan_features = plan_features or {}
    result = {}
    for code, spec in FEATURES.items():
        enabled = spec["default"]
        if code in profile_features:
            enabled = bool(profile_features[code])
        if code in overrides:
            enabled = bool(overrides[code])
        if spec["plan_key"] and plan_features.get(spec["plan_key"]) is False:
            enabled = False
        result[code] = enabled
    return result


def context_for(tenant_id) -> dict:
    """{'industry', 'features', 'terminology', 'defaults'} for a tenant."""
    key = f"cep:features:{tenant_id}"
    data = cache.get(key)
    if data is not None:
        return data
    import json
    as_dict = lambda v: (json.loads(v) if isinstance(v, str) else v) or {}       # noqa: E731
    row = _rows("""SELECT t.settings, p.features
                     FROM tenant t
                     LEFT JOIN LATERAL (SELECT s.plan_id FROM tenant_subscription s WHERE s.tenant_id = t.id AND s.status <> 'CANCELLED'
                                        ORDER BY s.started_at DESC LIMIT 1) s ON TRUE
                     LEFT JOIN subscription_plan p ON p.id = s.plan_id
                    WHERE t.id = %s""", [str(tenant_id)])
    tenant_settings, plan_features = (as_dict(row[0][0]), as_dict(row[0][1])) if row else ({}, {})
    industry = tenant_settings.get("industry") or get("tenancy.default_industry", "GENERIC")
    found = _rows("SELECT code, features, terminology, defaults FROM industry_profile WHERE code = %s AND is_active", [industry])
    profile = {"features": as_dict(found[0][1]), "terminology": as_dict(found[0][2]), "defaults": as_dict(found[0][3])} if found else {}
    data = {
        "industry": found[0][0] if found else "GENERIC",
        "features": resolve(tenant_settings, plan_features, profile),
        "terminology": {term: profile.get("terminology", {}).get(term, term) for term in TERMS},
        "defaults": profile.get("defaults", {}),
    }
    cache.set(key, data, TTL)
    return data


def features_for(tenant_id) -> dict:
    return context_for(tenant_id)["features"]


def enabled(tenant_id, feature: str) -> bool:
    return bool(features_for(tenant_id).get(feature, False))


class RequiresFeature(BasePermission):
    """403 with a plain explanation when the workspace does not have the feature. Use: RequiresFeature.for_('journeys')"""
    feature = None

    @classmethod
    def for_(cls, feature: str):
        assert feature in FEATURES, feature
        return type(f"Requires_{feature}", (cls,), {"feature": feature, "message": f"{FEATURES[feature]['name']} is not part of this workspace. Ask the platform team to enable it."})

    def has_permission(self, request, view):
        tenant = getattr(request, "tenant", None)
        return bool(tenant) and enabled(tenant["id"], self.feature)
