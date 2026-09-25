from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import auth_api, campaigns_api, contact_lists_api, delivery_api, delivery_public, integrations_api, settings_api, views, workspace_api

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
router.register("journeys", views.JourneyViewSet, basename="journey")
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
    path("workspace/mail-server/", workspace_api.MailServerView.as_view(), name="workspace-mail-server"),
    path("workspace/mail-server/test/", workspace_api.MailServerTestView.as_view(), name="workspace-mail-server-test"),
    path("campaigns/<uuid:pk>/send-test/", delivery_api.CampaignSendTestView.as_view(), name="campaign-send-test"),
    path("campaign-runs/<uuid:pk>/results/", delivery_api.CampaignRunResultsView.as_view(), name="campaign-run-results"),
    path("webhooks/delivery/<str:tenant_code>/<uuid:provider_id>/<str:token>/", delivery_public.delivery_webhook, name="delivery-webhook"),
    path("public/unsubscribe/", delivery_public.unsubscribe_view, name="unsubscribe"),
    path("receipts/send/", delivery_api.ReceiptSendView.as_view(), name="receipt-send"),
    path("integrations/", integrations_api.IntegrationListView.as_view(), name="integration-list"),
    path("integrations/log/", integrations_api.IntegrationLogListView.as_view(), name="integration-log"),
    path("integrations/log/<int:pk>/", integrations_api.IntegrationLogDetailView.as_view(), name="integration-log-detail"),
    path("integrations/<uuid:pk>/metrics/", integrations_api.IntegrationMetricsView.as_view(), name="integration-metrics"),
    path("integrations/<uuid:pk>/pause/", integrations_api.IntegrationPauseView.as_view(), {"pause": True}, name="integration-pause"),
    path("integrations/<uuid:pk>/resume/", integrations_api.IntegrationPauseView.as_view(), {"pause": False}, name="integration-resume"),
    path("sms-inbound/", delivery_api.SmsInboundView.as_view(), name="sms-inbound"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/set-password/", settings_api.SetPasswordView.as_view(), name="set_password"),
    path("workspace/", settings_api.WorkspaceView.as_view(), name="workspace"),
    path("", include(router.urls)),
]
