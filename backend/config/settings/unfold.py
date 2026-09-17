"""Look and navigation of the platform back-office (django-unfold, Tailwind-based). Colours mirror the React app's
brand scale in frontend/src/index.css so the two surfaces read as one product."""
from django.urls import reverse_lazy


def _link(title, icon, name):
    return {"title": title, "icon": icon, "link": reverse_lazy(f"admin:{name}_changelist")}


UNFOLD = {
    "SITE_TITLE": "CEP platform",
    "SITE_HEADER": "CEP platform",
    "SITE_SUBHEADER": "Back-office · all tenants",
    "SITE_SYMBOL": "hub",
    "DASHBOARD_CALLBACK": "apps.platform_health.dashboard_callback",   # home page = platform health
    "SHOW_HISTORY": False,                                 # the definition audit log (database triggers) is the record, for API and admin alike
    "SHOW_VIEW_ON_SITE": False,
    "BORDER_RADIUS": "8px",
    "COLORS": {
        "primary": {"50": "#eef4ff", "100": "#dbe6fe", "200": "#bfd3fe", "300": "#93b4fd", "400": "#608cfa", "500": "#3b6cf6",
                    "600": "#2753e4", "700": "#1f41c4", "800": "#1f389f", "900": "#1f347e", "950": "#17224d"},
    },
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": True,                     # everything else stays reachable, grouped by app
        "navigation": [
            {"title": "Tenants", "separator": False, "items": [
                _link("Tenants", "apartment", "tenants_tenant"),
                _link("Subscriptions", "receipt_long", "tenants_tenantsubscription"),
                _link("Plans", "sell", "tenants_subscriptionplan"),
                _link("Database routing", "dns", "tenants_tenantdatabase"),
                _link("Storage and CDN", "cloud", "tenants_tenantstorageconfig"),
            ]},
            {"title": "People and access", "separator": True, "items": [
                _link("Users", "group", "identity_appuser"),
                _link("Roles", "shield_person", "identity_role"),
                _link("Permission catalogue", "key", "identity_permission"),
                _link("API keys", "vpn_key", "identity_apiclient"),
            ]},
            {"title": "Operations", "separator": True, "items": [
                _link("Change audit trail", "history", "audit_definitionauditlog"),
                _link("Partition retention", "inventory_2", "tenants_partitionretentionpolicy"),
            ]},
        ],
    },
}
