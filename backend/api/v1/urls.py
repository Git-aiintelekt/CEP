from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import (attribution_api, auth_api, campaigns_api, client_errors, codes_api, consent_api, contact_lists_api, deliverability_api, delivery_api, delivery_public, field_rules, integrations_api, journeys_api, pos_api, preferences_api,
               preferences_public,
               home_api, recipients_api, reports_api, search_api, settings_api, setup_api, suppressions_api, views, workspace_api)

router = DefaultRouter()
router.register("me", views.MeViewSet, basename="me")
router.register("campaigns", campaigns_api.CampaignViewSet, basename="campaign")
router.register("sender-profiles", views.SenderProfileViewSet, basename="sender-profile")
router.register("delivery-providers", delivery_api.DeliveryProviderViewSet, basename="delivery-provider")
router.register("delivery-senders", delivery_api.SenderProfileManageViewSet, basename="delivery-sender")
router.register("campaign-runs", views.CampaignRunViewSet, basename="campaign-run")
router.register("contact-lists", contact_lists_api.ContactListViewSet, basename="contact-list")
router.register("template-starters", views.TemplateStarterViewSet, basename="template-starter")
router.register("media-assets", views.MediaAssetViewSet, basename="media-asset")
router.register("templates", views.TemplateViewSet, basename="template")
router.register("personalization-tags", views.PersonalizationTagViewSet, basename="personalization-tag")
router.register("journeys", journeys_api.JourneyViewSet, basename="journey")
router.register("journey-starters", journeys_api.JourneyStarterViewSet, basename="journey-starter")
router.register("journey-templates", journeys_api.JourneyTemplateViewSet, basename="journey-template")
router.register("coupons", views.CouponViewSet, basename="coupon")
router.register("loyalty-tiers", views.LoyaltyTierViewSet, basename="loyalty-tier")
router.register("subscription-topics", preferences_api.SubscriptionTopicViewSet, basename="subscription-topic")
router.register("stores", pos_api.StoreViewSet, basename="store")
# tenant self-administration (permission user.admin)
router.register("users", settings_api.UserViewSet, basename="user")
router.register("roles", settings_api.RoleViewSet, basename="role")
router.register("api-clients", settings_api.ApiClientViewSet, basename="api-client")

urlpatterns = [
    path("auth/token/", auth_api.LoginView.as_view(), name="token_obtain_pair"),
    path("auth/mfa/verify/", auth_api.MfaVerifyView.as_view(), name="mfa_verify"),
    path("auth/mfa/", auth_api.MfaView.as_view(), name="mfa"),
    path("auth/options/", auth_api.AuthOptionsView.as_view(), name="auth_options"),
    path("auth/sso/start/", auth_api.SsoStartView.as_view(), name="sso_start"),
    path("auth/sso/callback/", auth_api.SsoCallbackView.as_view(), name="sso_callback"),
    path("auth/support-session/end/", auth_api.SupportSessionEndView.as_view(), name="support_session_end"),
    path("dashboard/summary/", views.DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("workspace/usage/", workspace_api.UsageView.as_view(), name="workspace_usage"),
    path("workspace/invoices/", workspace_api.InvoicesView.as_view(), name="workspace_invoices"),
    path("workspace/security/", workspace_api.SecurityView.as_view(), name="workspace_security"),
    path("workspace/support-access/", workspace_api.SupportAccessView.as_view(), name="workspace_support_access"),
    path("workspace/approvals/", workspace_api.ApprovalsView.as_view(), name="workspace_approvals"),
    path("workspace/notifications/", workspace_api.NotificationsView.as_view(), name="workspace_notifications"),
    path("workspace/notifications/test/", workspace_api.NotificationsTestView.as_view(), name="workspace_notifications_test"),
    path("workspace/mail-server/", workspace_api.MailServerView.as_view(), name="workspace-mail-server"),
    path("workspace/mail-server/test/", workspace_api.MailServerTestView.as_view(), name="workspace-mail-server-test"),
    path("campaigns/<uuid:pk>/send-test/", delivery_api.CampaignSendTestView.as_view(), name="campaign-send-test"),
    path("campaign-runs/<uuid:pk>/results/", delivery_api.CampaignRunResultsView.as_view(), name="campaign-run-results"),
    path("campaign-runs/<uuid:pk>/recipients/", recipients_api.RunRecipientsView.as_view(), name="campaign-run-recipients"),
    path("campaign-runs/<uuid:pk>/recipients/export.csv", recipients_api.RunRecipientsExportView.as_view(), name="campaign-run-recipients-export"),
    path("campaign-runs/<uuid:pk>/recipients/<int:execution_id>/", recipients_api.RunRecipientView.as_view(), name="campaign-run-recipient"),
    path("campaign-runs/<uuid:pk>/recipients/<int:execution_id>/check/", recipients_api.RunRecipientCheckView.as_view(), name="campaign-run-recipient-check"),
    path("campaigns/<uuid:pk>/suppressions/", recipients_api.CampaignSuppressionsView.as_view(), name="campaign-suppressions"),
    path("campaigns/<uuid:pk>/suppressions/export.csv", recipients_api.CampaignSuppressionsExportView.as_view(), name="campaign-suppressions-export"),
    path("webhooks/delivery/<str:tenant_code>/<uuid:provider_id>/<str:token>/", delivery_public.delivery_webhook, name="delivery-webhook"),
    path("public/unsubscribe/", delivery_public.unsubscribe_view, name="unsubscribe"),
    path("client-errors/", client_errors.client_error_view, name="client-errors"),   # browser errors, no sign-in
    path("orders/", attribution_api.OrdersIngestView.as_view(), name="orders-ingest"),                 # the shop's orders, for attribution
    path("attribution/settings/", attribution_api.AttributionSettingsView.as_view(), name="attribution-settings"),
    path("attribution/orders/", attribution_api.AttributionOrdersView.as_view(), name="attribution-orders"),
    path("attribution/recalculate/", attribution_api.AttributionRecalculateView.as_view(), name="attribution-recalculate"),
    path("public/preferences/", preferences_public.preferences_view, name="preferences"),
    path("workspace/preference-center/", preferences_api.PreferenceCenterView.as_view(), name="workspace-preference-center"),
    path("workspace/consent-policy/", consent_api.ConsentPolicyView.as_view(), name="workspace-consent-policy"),
    path("workspace/setup/", setup_api.WorkspaceSetupView.as_view(), name="workspace-setup"),
    path("public/barcode/<str:text>.png", delivery_public.barcode_view, name="barcode-image"),
    path("public/code/<str:token>.png", delivery_public.code_image_view, name="code-image"),
    path("codes/sample/", codes_api.CodeSampleView.as_view(), name="code-sample"),
    path("receipts/send/", delivery_api.ReceiptSendView.as_view(), name="receipt-send"),
    path("pos/transactions/", pos_api.PosTransactionView.as_view(), name="pos-transactions"),
    path("pos/sample/", pos_api.PosSampleView.as_view(), name="pos-sample"),
    path("workspace/pos/", pos_api.PosSettingsView.as_view(), name="workspace-pos"),
    path("workspace/pos/received/", pos_api.PosReceivedView.as_view(), name="workspace-pos-received"),
    path("integrations/", integrations_api.IntegrationListView.as_view(), name="integration-list"),
    path("integrations/log/", integrations_api.IntegrationLogListView.as_view(), name="integration-log"),
    path("integrations/log/<int:pk>/", integrations_api.IntegrationLogDetailView.as_view(), name="integration-log-detail"),
    path("integrations/log/<int:pk>/retry/", integrations_api.IntegrationLogRetryView.as_view(), name="integration-log-retry"),
    path("integrations/log/<int:pk>/replay/", integrations_api.IntegrationLogReplayView.as_view(), name="integration-log-replay"),
    path("integrations/<uuid:pk>/alerts/", integrations_api.IntegrationAlertsView.as_view(), name="integration-alerts"),
    path("search/", search_api.SearchView.as_view(), name="search"),
    path("integrations/<uuid:pk>/metrics/", integrations_api.IntegrationMetricsView.as_view(), name="integration-metrics"),
    path("integrations/<uuid:pk>/pause/", integrations_api.IntegrationPauseView.as_view(), {"pause": True}, name="integration-pause"),
    path("integrations/<uuid:pk>/resume/", integrations_api.IntegrationPauseView.as_view(), {"pause": False}, name="integration-resume"),
    path("sms-inbound/", delivery_api.SmsInboundView.as_view(), name="sms-inbound"),
    path("suppressions/", suppressions_api.SuppressionListView.as_view(), name="suppression-list"),
    path("suppressions/summary/", suppressions_api.SuppressionSummaryView.as_view(), name="suppression-summary"),
    path("suppressions/export.csv", suppressions_api.SuppressionExportView.as_view(), name="suppression-export"),
    path("suppressions/block/", suppressions_api.SuppressionBlockView.as_view(), name="suppression-block"),
    path("suppressions/<str:kind>/<str:pk>/unblock/", suppressions_api.SuppressionUnblockView.as_view(), name="suppression-unblock"),
    path("home/overview/", home_api.HomeOverviewView.as_view(), name="home-overview"),
    path("field-rules/", field_rules.FieldRulesView.as_view(), name="field-rules"),
    path("deliverability/service/", deliverability_api.ServiceView.as_view(), name="deliverability-service"),
    path("deliverability/service/check/", deliverability_api.ServiceCheckView.as_view(), name="deliverability-service-check"),
    path("deliverability/clients/", deliverability_api.ClientsView.as_view(), name="deliverability-clients"),
    path("deliverability/allowance/", deliverability_api.AllowanceView.as_view(), name="deliverability-allowance"),
    path("templates/<uuid:pk>/deliverability-tests/", deliverability_api.TemplateTestsView.as_view(), name="template-deliverability-tests"),
    path("deliverability-tests/<uuid:pk>/", deliverability_api.TestView.as_view(), name="deliverability-test"),
    path("reports/summary/", reports_api.ReportSummaryView.as_view(), name="report-summary"),
    path("reports/campaigns.csv", reports_api.ReportCsvView.as_view(), name="report-csv"),
    path("reports/compare/", reports_api.ReportCompareView.as_view(), name="report-compare"),
    path("reports/schedule/", reports_api.ReportScheduleView.as_view(), name="report-schedule"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/set-password/", settings_api.SetPasswordView.as_view(), name="set_password"),
    path("workspace/", settings_api.WorkspaceView.as_view(), name="workspace"),
    path("", include(router.urls)),
]
