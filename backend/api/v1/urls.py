from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import views

router = DefaultRouter()
router.register("me", views.MeViewSet, basename="me")
router.register("campaigns", views.CampaignViewSet, basename="campaign")
router.register("sender-profiles", views.SenderProfileViewSet, basename="sender-profile")
router.register("campaign-runs", views.CampaignRunViewSet, basename="campaign-run")
router.register("contact-lists", views.ContactListViewSet, basename="contact-list")
router.register("template-starters", views.TemplateStarterViewSet, basename="template-starter")
router.register("media-assets", views.MediaAssetViewSet, basename="media-asset")
router.register("templates", views.TemplateViewSet, basename="template")
router.register("personalization-tags", views.PersonalizationTagViewSet, basename="personalization-tag")
router.register("journeys", views.JourneyViewSet, basename="journey")

urlpatterns = [
    path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("", include(router.urls)),
]
