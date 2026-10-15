"""Look and navigation of the platform back-office (django-unfold, Tailwind-based). Colours mirror the React app's
brand scale in frontend/src/index.css so the two surfaces read as one product; static/cep_admin/admin.css adds what the
home page and the custom pages need.

Navigation: the platform team's own work is always open at the top; the tenants' data (campaigns, deliveries, journeys,
...) is there for support, in groups that stay folded until used. Every registered model is reachable from here, so the
automatic per-application list is off."""
import hashlib
from pathlib import Path

from django.templatetags.static import static
from django.urls import reverse_lazy

STATIC_DIR = Path(__file__).resolve().parents[2] / "static"


def _versioned(path: str):
    """The file's own hash on its URL: a deploy changes the address, so no browser keeps yesterday's copy of our script."""
    digest = hashlib.md5((STATIC_DIR / path).read_bytes()).hexdigest()[:8]  # noqa: S324  a cache key, not a secret
    return lambda request: f"{static(path)}?v={digest}"


INSPECT = reverse_lazy("admin:platform_ops_inspect")       # the platform's Mailgun Inspect account, under the mail server admin's address
USAGE = reverse_lazy("admin:platform_ops_usage")          # lives under the invoice admin's address
GUIDE = reverse_lazy("admin:platform_ops_guide")          # the Platform Guide, under the global parameters admin's address
PERFORMANCE = reverse_lazy("admin:tenants_tenant_performance")   # under the tenant admin's address


def _is_performance(request):
    return request.path.startswith(str(PERFORMANCE)) or (request.path.startswith(str(reverse_lazy("admin:tenants_tenant_changelist")))
                                                         and request.path.endswith("/performance/"))


def _under(link):
    """Highlight a menu entry on its own pages only. (Unfold's default also lights up every entry that shares a tab bar
    with the current page: four entries at once on the tenant lists.) Usage and Tenant performance live under other
    admins' addresses, so those admins' entries stay dark there."""
    if link is PERFORMANCE:
        return _is_performance
    return lambda request: request.path.startswith(str(link)) and (str(link) == str(USAGE) or not request.path.startswith(str(USAGE)))         and not _is_performance(request)


def _link(title, icon, name, **extra):
    link = reverse_lazy(f"admin:{name}_changelist")
    return {"title": title, "icon": icon, "link": link, "active": _under(link), **extra}


def _tabs(models, *items):
    return {"models": models, "items": [{"title": title, "link": reverse_lazy(f"admin:{name}_changelist")} for title, name in items]}


UNFOLD = {
    "SITE_TITLE": "C360 platform",
    "SITE_HEADER": "C360 platform",
    "SITE_SUBHEADER": "Back-office · all tenants",
    "SITE_SYMBOL": "hub",
    "SITE_URL": None,                                      # there is no public site behind "view site"
    "DASHBOARD_CALLBACK": "apps.platform_health.dashboard_callback",   # home page: attention, quick actions, numbers, health
    "ENVIRONMENT": "apps.platform_ops.admin_ui.environment",
    "SHOW_HISTORY": False,                                 # the definition audit log (database triggers) is the record, for API and admin alike
    "SHOW_VIEW_ON_SITE": False,
    "SHOW_BACK_BUTTON": True,
    "BORDER_RADIUS": "10px",
    "STYLES": [_versioned("cep_admin/admin.css")],
    "SCRIPTS": [_versioned("cep_admin/admin.js")],   # the menu button's first click and the list search (see the file)
    "COLORS": {
        "base": {"50": "#f8fafc", "100": "#f1f5f9", "200": "#e2e8f0", "300": "#cbd5e1", "400": "#94a3b8", "500": "#64748b",
                 "600": "#475569", "700": "#334155", "800": "#1e293b", "900": "#0f172a", "950": "#020617"},
        "primary": {"50": "#eef4ff", "100": "#dbe6fe", "200": "#bfd3fe", "300": "#93b4fd", "400": "#608cfa", "500": "#3b6cf6",
                    "600": "#2753e4", "700": "#1f41c4", "800": "#1f389f", "900": "#1f347e", "950": "#17224d"},
    },
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": False,
        "navigation": [
            {"title": "Overview", "separator": False, "items": [
                {"title": "Home", "icon": "space_dashboard", "link": reverse_lazy("admin:index"), "active": lambda request: request.path == str(reverse_lazy("admin:index"))},
                _link("Alerts", "notifications_active", "platform_ops_platformalert", badge="apps.platform_ops.admin_ui.open_alerts_badge", badge_variant="danger"),
                {"title": "Usage against limits", "icon": "monitoring", "link": USAGE, "active": _under(USAGE)},
                _link("Errors", "bug_report", "platform_ops_errorgroup", badge="apps.platform_ops.admin_ui.open_errors_badge", badge_variant="danger"),
                _link("Uptime", "monitor_heart", "platform_ops_uptimetarget", badge="apps.platform_ops.admin_ui.down_targets_badge", badge_variant="danger"),
                {"title": "Tenant performance", "icon": "speed", "link": PERFORMANCE, "active": _under(PERFORMANCE)},
                {"title": "Platform Guide", "icon": "menu_book", "link": GUIDE, "active": _under(GUIDE)},
            ]},
            {"title": "Tenants", "separator": True, "items": [
                _link("Tenants", "apartment", "tenants_tenant"),
                _link("Subscriptions", "receipt_long", "tenants_tenantsubscription"),
                _link("Plans", "sell", "tenants_subscriptionplan"),
                _link("Invoices", "request_quote", "platform_ops_tenantinvoice"),
                _link("Move and offboard", "move_up", "platform_ops_tenantoperation"),
            ]},
            {"title": "People and access", "separator": True, "items": [
                _link("Users", "group", "identity_appuser"),
                _link("Roles", "shield_person", "identity_role"),
                _link("API keys", "vpn_key", "identity_apiclient"),
                _link("Single sign-on", "passkey", "platform_ops_tenantidentityprovider"),
                _link("Support access log", "support_agent", "platform_ops_supportaccesslog"),
            ]},
            {"title": "Configuration", "separator": True, "items": [
                _link("Global parameters", "tune", "platform_ops_platformsetting"),
                _link("Component Registry", "widgets", "platform_ops_suitecomponent"),
                _link("Mail server", "outgoing_mail", "platform_ops_mailserver"),
                {"title": "Mailgun Inspect", "icon": "inbox", "link": INSPECT, "active": _under(INSPECT)},
                _link("Industry profiles", "category", "platform_ops_industryprofile"),
                _link("Personalization tags", "sell", "platform_ops_platformpersonalizationtag"),
                _link("Permission catalogue", "key", "identity_permission"),
            ]},
            {"title": "Operations", "separator": True, "items": [
                _link("Job runs", "schedule", "platform_ops_jobrun"),
                _link("Change audit trail", "history", "audit_definitionauditlog"),
                _link("Database routing", "dns", "tenants_tenantdatabase"),
                _link("Storage and CDN", "cloud", "tenants_tenantstorageconfig"),
                _link("Partition retention", "inventory_2", "tenants_partitionretentionpolicy"),
            ]},
            # ---- the tenants' own data, for support: folded until opened ------------------------------------------------
            {"title": "Campaigns", "separator": True, "collapsible": True, "items": [
                _link("Campaigns", "campaign", "campaigns_campaign"),
                _link("Runs", "play_circle", "campaigns_campaignrun"),
                _link("Run variants", "alt_route", "campaigns_campaignrunvariant"),
                _link("Audience snapshots", "groups", "campaigns_campaignlist"),
                _link("Audience members", "person_check", "campaigns_campaignlistmember"),
                _link("Targets", "flag", "campaigns_campaigntarget"),
                _link("Actuals", "insights", "campaigns_campaignactual"),
            ]},
            {"title": "Delivery", "separator": False, "collapsible": True, "items": [
                _link("Sending engines", "send", "delivery_deliveryprovider"),
                _link("Senders", "alternate_email", "delivery_senderprofile"),
                _link("Emails sent", "mail", "delivery_mailerexecution"),
                _link("Texts sent", "sms", "delivery_smsexecution"),
                _link("Provider callbacks", "webhook", "delivery_deliverywebhookevent"),
                _link("Dead letters", "report", "delivery_deadlettermessage"),
                _link("Tracking events", "ads_click", "tracking_trackingevent"),
                _link("Tracked links", "link", "tracking_trackinglink"),
            ]},
            {"title": "Customers and lists", "separator": False, "collapsible": True, "items": [
                _link("Customers", "person", "customers_customermaster"),
                _link("Segments", "pie_chart", "customers_segment"),
                _link("Contact lists", "contacts", "contact_lists_contactlist"),
                _link("List members", "recent_actors", "contact_lists_contactlistmember"),
                _link("Imports", "upload_file", "contact_lists_contactlistimport"),
                _link("Import rows", "table_rows", "contact_lists_contactlistimportrow"),
            ]},
            {"title": "Content", "separator": False, "collapsible": True, "items": [
                _link("Templates", "draft", "templates_templatemaster"),
                _link("Design states", "design_services", "templates_templatedesignstate"),
                _link("Rendered content", "html", "templates_renderedtemplatecontent"),
                _link("Personalization tags", "data_object", "templates_personalizationtag"),
                _link("Receipt fields", "receipt", "templates_receiptfieldconfiguration"),
                _link("Receipt presentation", "view_quilt", "templates_receiptpresentationmodel"),
                _link("Media library", "perm_media", "media_mediaasset"),
            ]},
            {"title": "Consent and governance", "separator": False, "collapsible": True, "items": [
                _link("Consent records", "fact_check", "governance_consentrecord"),
                _link("Suppressions", "do_not_disturb_on", "governance_consentsuppression"),
                _link("Contact point status", "contact_phone", "governance_contactpointstatus"),
                _link("Policies", "policy", "governance_communicationgovernancepolicy"),
                _link("Exemptions", "rule", "governance_governanceexemption"),
                _link("Evaluation log", "checklist", "governance_governanceevaluationlog"),
            ]},
            {"title": "Journeys", "separator": False, "collapsible": True, "items": [
                _link("Journeys", "route", "journeys_journey"),
                _link("Versions", "layers", "journeys_journeyversion"),
                _link("Nodes", "account_tree", "journeys_journeynode"),
                _link("Connections", "timeline", "journeys_journeyconnection"),
                _link("Entry rules", "login", "journeys_journeyentryrule"),
                _link("Enrollments", "how_to_reg", "journeys_journeyenrollment"),
                _link("Customer states", "person_pin", "journeys_journeycustomerstate"),
                _link("Node executions", "bolt", "journeys_journeynodeexecution"),
                _link("Events", "event", "journeys_journeyevent"),
                _link("Generated campaigns", "auto_awesome", "journeys_journeygeneratedcampaign"),
                _link("Generated runs", "auto_mode", "journeys_journeygeneratedcampaignrun"),
            ]},
            {"title": "Integrations and reporting", "separator": False, "collapsible": True, "items": [
                _link("Integrations", "hub", "integrations_integration"),
                _link("Integration log", "receipt_long", "integrations_integrationlog"),
                _link("Webhook subscriptions", "webhook", "integrations_webhooksubscription"),
                _link("Webhook deliveries", "outbox", "integrations_outboundwebhookdelivery"),
                _link("Domain events", "stream", "integrations_domainevent"),
                _link("Campaign analytics", "bar_chart", "reporting_campaignmasteranalytical"),
                _link("Journey analytics", "stacked_line_chart", "reporting_journeymasteranalytical"),
                _link("Journey execution analytics", "area_chart", "reporting_journeyexecutionmasteranalytical"),
                _link("Scoring models", "model_training", "scoring_mlmodel"),
                _link("Groups (Django)", "groups_2", "auth_group"),
            ]},
        ],
    },
    # the same family of lists, one click apart
    "TABS": [
        _tabs(["tenants.tenant", "tenants.tenantsubscription", "tenants.subscriptionplan", "platform_ops.tenantinvoice"],
              ("Tenants", "tenants_tenant"), ("Subscriptions", "tenants_tenantsubscription"), ("Plans", "tenants_subscriptionplan"), ("Invoices", "platform_ops_tenantinvoice")),
        _tabs(["identity.appuser", "identity.role", "identity.apiclient", "platform_ops.tenantidentityprovider"],
              ("Users", "identity_appuser"), ("Roles", "identity_role"), ("API keys", "identity_apiclient"), ("Single sign-on", "platform_ops_tenantidentityprovider")),
        _tabs(["delivery.deliveryprovider", "delivery.senderprofile", "delivery.mailerexecution", "delivery.smsexecution"],
              ("Sending engines", "delivery_deliveryprovider"), ("Senders", "delivery_senderprofile"), ("Emails sent", "delivery_mailerexecution"), ("Texts sent", "delivery_smsexecution")),
        _tabs(["campaigns.campaign", "campaigns.campaignrun", "campaigns.campaignlist"],
              ("Campaigns", "campaigns_campaign"), ("Runs", "campaigns_campaignrun"), ("Audience snapshots", "campaigns_campaignlist")),
        _tabs(["platform_ops.platformalert", "platform_ops.jobrun"], ("Alerts", "platform_ops_platformalert"), ("Job runs", "platform_ops_jobrun")),
    ],
}
