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
AI = reverse_lazy("admin:platform_ops_ai_assistant")       # the AI providers, likewise
BASE_REPORTS = reverse_lazy("admin:insights_base_reports")   # the base report packs, under the report datasets admin's address
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
    "SITE_TITLE": "C360 Platform",
    "SITE_HEADER": "C360 Platform",
    "SITE_SUBHEADER": "Back-Office · All Tenants",
    "SITE_SYMBOL": "hub",
    "SITE_URL": None,                                      # there is no public site behind "view site"
    "DASHBOARD_CALLBACK": "apps.platform_health.dashboard_callback",   # home page: attention, quick actions, numbers, health
    "ENVIRONMENT": "apps.platform_ops.admin_ui.environment",
    "SHOW_HISTORY": False,                                 # the definition audit log (database triggers) is the record, for API and admin alike
    "SHOW_VIEW_ON_SITE": False,
    "SHOW_BACK_BUTTON": True,
    "BORDER_RADIUS": "12px",                               # boxes and menus; admin.css rounds cards to 16px and controls to pills
    "STYLES": [_versioned("cep_admin/admin.css")],
    "SCRIPTS": [_versioned("cep_admin/admin.js")],   # the menu button's first click and the list search (see the file)
    # The CEP design tokens (frontend/src/index.css), light theme. Unfold reads base-50 as the page, base-100 as hover and
    # fills, base-200 as hairlines, base-400 as placeholders and the font-* roles as text. admin.css swaps in the dark values.
    "COLORS": {
        "base": {"50": "#f9fafb", "100": "#eeeff5", "200": "#cfd2dc", "300": "#b4b7c2", "400": "#9ea2ad", "500": "#4b4f5b",
                 "600": "#4b4f5b", "700": "#33363f", "800": "#24262c", "900": "#17181c", "950": "#0e0f12"},
        "primary": {"50": "#f3f6fe", "100": "#dee9fc", "200": "#c3d5f9", "300": "#8faef3", "400": "#7a9df0", "500": "#3863db",
                    "600": "#3863db", "700": "#2b4dd0", "800": "#233c9e", "900": "#1c2e5a", "950": "#152447"},
        "font": {"subtle-light": "#4b4f5b", "default-light": "#17181c", "important-light": "#17181c",
                 "subtle-dark": "#bfc1c4", "default-dark": "#e2e3e4", "important-dark": "#e2e3e4"},
    },
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": False,
        "navigation": [
            {"title": "Overview", "separator": False, "items": [
                {"title": "Home", "icon": "space_dashboard", "link": reverse_lazy("admin:index"), "active": lambda request: request.path == str(reverse_lazy("admin:index"))},
                _link("Alerts", "notifications_active", "platform_ops_platformalert", badge="apps.platform_ops.admin_ui.open_alerts_badge", badge_variant="danger"),
                {"title": "Usage Against Limits", "icon": "monitoring", "link": USAGE, "active": _under(USAGE)},
                _link("Errors", "bug_report", "platform_ops_errorgroup", badge="apps.platform_ops.admin_ui.open_errors_badge", badge_variant="danger"),
                _link("Uptime", "monitor_heart", "platform_ops_uptimetarget", badge="apps.platform_ops.admin_ui.down_targets_badge", badge_variant="danger"),
                _link("Engine Health", "outgoing_mail", "delivery_deliveryproviderhealth", badge="apps.platform_ops.admin_ui.failing_engines_badge", badge_variant="danger"),
                _link("Security", "shield", "platform_ops_securityfinding", badge="apps.platform_ops.admin_ui.security_badge", badge_variant="danger"),
                {"title": "Tenant Performance", "icon": "speed", "link": PERFORMANCE, "active": _under(PERFORMANCE)},
                {"title": "Platform Guide", "icon": "menu_book", "link": GUIDE, "active": _under(GUIDE)},
            ]},
            {"title": "Tenants", "separator": True, "items": [
                _link("Tenants", "apartment", "tenants_tenant"),
                _link("Subscriptions", "receipt_long", "tenants_tenantsubscription"),
                _link("Plans", "sell", "tenants_subscriptionplan"),
                _link("Invoices", "request_quote", "platform_ops_tenantinvoice"),
                _link("Move and Offboard", "move_up", "platform_ops_tenantoperation"),
            ]},
            {"title": "People and Access", "separator": True, "items": [
                _link("Users", "group", "identity_appuser"),
                _link("Roles", "shield_person", "identity_role"),
                _link("API Keys", "vpn_key", "identity_apiclient"),
                _link("Single Sign-On", "passkey", "platform_ops_tenantidentityprovider"),
                _link("Support Access Log", "support_agent", "platform_ops_supportaccesslog"),
                _link("Platform Visits", "swap_horiz", "platform_ops_platformvisit"),
            ]},
            {"title": "Configuration", "separator": True, "items": [
                _link("Global Parameters", "tune", "platform_ops_platformsetting"),
                _link("Component Registry", "widgets", "platform_ops_suitecomponent"),
                _link("Report Datasets", "dataset", "insights_reportdataset"),
                {"title": "Base Reports", "icon": "library_books", "link": BASE_REPORTS, "active": _under(BASE_REPORTS)},
                _link("Dataset Links", "link", "insights_reportdatasetlink"),
                _link("Report Engines", "memory", "insights_reportenginesetting"),
                _link("Report Engine Connections", "cable", "insights_reportengineconnection"),
                _link("Mail Server", "outgoing_mail", "platform_ops_mailserver"),
                {"title": "Mailgun Inspect", "icon": "inbox", "link": INSPECT, "active": _under(INSPECT)},
                {"title": "AI Assistant", "icon": "smart_toy", "link": AI, "active": _under(AI)},
                _link("Industry Profiles", "category", "platform_ops_industryprofile"),
                _link("Personalization Tags", "sell", "platform_ops_platformpersonalizationtag"),
                _link("Permission Catalogue", "key", "identity_permission"),
            ]},
            {"title": "Operations", "separator": True, "items": [
                _link("Job Runs", "schedule", "platform_ops_jobrun"),
                _link("Change Audit Trail", "history", "audit_definitionauditlog"),
                _link("Database Routing", "dns", "tenants_tenantdatabase"),
                _link("Storage and CDN", "cloud", "tenants_tenantstorageconfig"),
                _link("Partition Retention", "inventory_2", "tenants_partitionretentionpolicy"),
            ]},
            # ---- the tenants' own data, for support: folded until opened ------------------------------------------------
            {"title": "Campaigns", "separator": True, "collapsible": True, "items": [
                _link("Campaigns", "campaign", "campaigns_campaign"),
                _link("Runs", "play_circle", "campaigns_campaignrun"),
                _link("Run Variants", "alt_route", "campaigns_campaignrunvariant"),
                _link("Audience Snapshots", "groups", "campaigns_campaignlist"),
                _link("Audience Members", "person_check", "campaigns_campaignlistmember"),
                _link("Targets", "flag", "campaigns_campaigntarget"),
                _link("Actuals", "insights", "campaigns_campaignactual"),
            ]},
            {"title": "Delivery", "separator": False, "collapsible": True, "items": [
                _link("Sending Engines", "send", "delivery_deliveryprovider"),
                _link("Senders", "alternate_email", "delivery_senderprofile"),
                _link("Emails Sent", "mail", "delivery_mailerexecution"),
                _link("Texts Sent", "sms", "delivery_smsexecution"),
                _link("Provider Callbacks", "webhook", "delivery_deliverywebhookevent"),
                _link("Dead Letters", "report", "delivery_deadlettermessage"),
                _link("Tracking Events", "ads_click", "tracking_trackingevent"),
                _link("Tracked Links", "link", "tracking_trackinglink"),
            ]},
            {"title": "Customers and Lists", "separator": False, "collapsible": True, "items": [
                _link("Customers", "person", "customers_customermaster"),
                _link("Segments", "pie_chart", "customers_segment"),
                _link("Contact Lists", "contacts", "contact_lists_contactlist"),
                _link("List Members", "recent_actors", "contact_lists_contactlistmember"),
                _link("Imports", "upload_file", "contact_lists_contactlistimport"),
                _link("Import Rows", "table_rows", "contact_lists_contactlistimportrow"),
            ]},
            {"title": "Content", "separator": False, "collapsible": True, "items": [
                _link("Templates", "draft", "templates_templatemaster"),
                _link("Design States", "design_services", "templates_templatedesignstate"),
                _link("Rendered Content", "html", "templates_renderedtemplatecontent"),
                _link("Personalization Tags", "data_object", "templates_personalizationtag"),
                _link("Receipt Fields", "receipt", "templates_receiptfieldconfiguration"),
                _link("Receipt Presentation", "view_quilt", "templates_receiptpresentationmodel"),
                _link("Media Library", "perm_media", "media_mediaasset"),
            ]},
            {"title": "Consent and Governance", "separator": False, "collapsible": True, "items": [
                _link("Consent Records", "fact_check", "governance_consentrecord"),
                _link("Suppressions", "do_not_disturb_on", "governance_consentsuppression"),
                _link("Contact Point Status", "contact_phone", "governance_contactpointstatus"),
                _link("Policies", "policy", "governance_communicationgovernancepolicy"),
                _link("Exemptions", "rule", "governance_governanceexemption"),
                _link("Evaluation Log", "checklist", "governance_governanceevaluationlog"),
            ]},
            {"title": "Journeys", "separator": False, "collapsible": True, "items": [
                _link("Journeys", "route", "journeys_journey"),
                _link("Versions", "layers", "journeys_journeyversion"),
                _link("Nodes", "account_tree", "journeys_journeynode"),
                _link("Connections", "timeline", "journeys_journeyconnection"),
                _link("Entry Rules", "login", "journeys_journeyentryrule"),
                _link("Enrollments", "how_to_reg", "journeys_journeyenrollment"),
                _link("Customer States", "person_pin", "journeys_journeycustomerstate"),
                _link("Node Executions", "bolt", "journeys_journeynodeexecution"),
                _link("Events", "event", "journeys_journeyevent"),
                _link("Generated Campaigns", "auto_awesome", "journeys_journeygeneratedcampaign"),
                _link("Generated Runs", "auto_mode", "journeys_journeygeneratedcampaignrun"),
            ]},
            {"title": "Integrations and Reporting", "separator": False, "collapsible": True, "items": [
                _link("Integrations", "hub", "integrations_integration"),
                _link("Integration Log", "receipt_long", "integrations_integrationlog"),
                _link("Webhook Subscriptions", "webhook", "integrations_webhooksubscription"),
                _link("Webhook Deliveries", "outbox", "integrations_outboundwebhookdelivery"),
                _link("Domain Events", "stream", "integrations_domainevent"),
                _link("Campaign Analytics", "bar_chart", "reporting_campaignmasteranalytical"),
                _link("Journey Analytics", "stacked_line_chart", "reporting_journeymasteranalytical"),
                _link("Journey Execution Analytics", "area_chart", "reporting_journeyexecutionmasteranalytical"),
                _link("Scoring Models", "model_training", "scoring_mlmodel"),
                _link("Groups (Django)", "groups_2", "auth_group"),
            ]},
        ],
    },
    # the same family of lists, one click apart
    "TABS": [
        _tabs(["tenants.tenant", "tenants.tenantsubscription", "tenants.subscriptionplan", "platform_ops.tenantinvoice"],
              ("Tenants", "tenants_tenant"), ("Subscriptions", "tenants_tenantsubscription"), ("Plans", "tenants_subscriptionplan"), ("Invoices", "platform_ops_tenantinvoice")),
        _tabs(["identity.appuser", "identity.role", "identity.apiclient", "platform_ops.tenantidentityprovider"],
              ("Users", "identity_appuser"), ("Roles", "identity_role"), ("API Keys", "identity_apiclient"), ("Single Sign-On", "platform_ops_tenantidentityprovider")),
        _tabs(["delivery.deliveryprovider", "delivery.senderprofile", "delivery.mailerexecution", "delivery.smsexecution"],
              ("Sending Engines", "delivery_deliveryprovider"), ("Senders", "delivery_senderprofile"), ("Emails Sent", "delivery_mailerexecution"), ("Texts Sent", "delivery_smsexecution")),
        _tabs(["campaigns.campaign", "campaigns.campaignrun", "campaigns.campaignlist"],
              ("Campaigns", "campaigns_campaign"), ("Runs", "campaigns_campaignrun"), ("Audience Snapshots", "campaigns_campaignlist")),
        _tabs(["platform_ops.platformalert", "platform_ops.jobrun"], ("Alerts", "platform_ops_platformalert"), ("Job Runs", "platform_ops_jobrun")),
    ],
}
