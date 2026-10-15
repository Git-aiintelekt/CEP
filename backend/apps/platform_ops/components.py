"""The suite's components: what exists, what each plan includes, and what a workspace has.

    components.resolve(plan_code, plan_features, tenant_settings)   -> the components a workspace can open, in suite order
    components.for_tenant(tenant_id)                                 -> the same, cached with the workspace's features (params.context_for)

A workspace gets a component when its plan includes it (subscription_plan.features["components"], else the plan's default
set below), when a trial or an add-on adds it in tenant.settings["components"], or loses it when that entry switches it
off. A component that is not released is never offered. The shell builds the launcher and the left navigation from the
list GET /me/ returns; nothing is fetched per click.
"""
from datetime import date, datetime

COMPONENTS = {
    "cep":       {"name": "Engagement", "tagline": "Customer Engagement",            "release": "RELEASED", "needs": []},
    "insights":  {"name": "Insights",   "tagline": "Reports, dashboards, datasets",  "release": "PLANNED",  "needs": []},
    "crm":       {"name": "CRM",        "tagline": "Accounts, leads, opportunities", "release": "PLANNED",  "needs": []},
    "sales":     {"name": "Sales",      "tagline": "Orders, quotes, pricing",        "release": "PLANNED",  "needs": ["crm", "pim"]},
    "pur":       {"name": "Purchasing", "tagline": "Suppliers, purchase orders",     "release": "PLANNED",  "needs": ["inv"]},
    "inv":       {"name": "Inventory",  "tagline": "Stock, locations, transfers",    "release": "PLANNED",  "needs": ["pim"]},
    "pim":       {"name": "PIM",        "tagline": "Product information",            "release": "PLANNED",  "needs": []},
}

# what a plan includes when subscription_plan.features carries no "components" list of its own (decided 2026-10-15:
# Insights is on every plan from the start)
PLAN_DEFAULTS = {
    "STARTER":    ["cep", "insights"],
    "GROWTH":     ["cep", "insights"],
    "ENTERPRISE": [key for key, spec in COMPONENTS.items() if spec["release"] == "RELEASED"] + ["insights"],
}
FALLBACK = ["cep"]


def _day(value) -> date | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def resolve(plan_code: str | None, plan_features: dict | None, tenant_settings: dict | None, today: date | None = None) -> list[dict]:
    """Pure resolution: the plan's set, then the workspace's own entries ({"insights": {"on": true, "access": "TRIAL",
    "until": "2026-10-31"}}), released components only, in suite order."""
    today = today or date.today()
    included = (plan_features or {}).get("components")
    if not isinstance(included, list):
        included = PLAN_DEFAULTS.get((plan_code or "").upper(), FALLBACK)
    overrides = (tenant_settings or {}).get("components") or {}
    out = []
    for key, spec in COMPONENTS.items():
        if spec["release"] != "RELEASED":
            continue
        entry = overrides.get(key) if isinstance(overrides.get(key), dict) else {}
        on, access, until = key in included, "PLAN" if key in included else "NONE", None
        if "on" in entry:
            on = bool(entry["on"])
            access = str(entry.get("access") or ("TRIAL" if on else "NONE")).upper()
            until = _day(entry.get("until"))
            if on and until and until < today:
                on = False
        if on:
            out.append({"key": key, "name": spec["name"], "tagline": spec["tagline"], "access": access, "until": until.isoformat() if until else None})
    return out


def coming() -> list[dict]:
    """The components that exist but are not released: the launcher's More Apps line."""
    return [{"key": key, "name": spec["name"], "tagline": spec["tagline"]} for key, spec in COMPONENTS.items() if spec["release"] != "RELEASED"]


def for_tenant(tenant_id) -> list[dict]:
    from apps.platform_ops import params
    return params.context_for(tenant_id)["components"]
