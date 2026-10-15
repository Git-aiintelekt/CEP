"""The report engine service's URLs (DJANGO_SETTINGS_MODULE=config.settings.insights): the Insights API and the health check,
nothing else. nginx sends /api/v1/insights/ here when insights.engine_url is set; the app process keeps the same routes, so a
single-process installation needs no second service."""
from django.urls import include, path

from config.urls import healthz

urlpatterns = [
    path("healthz", healthz),
    path("api/v1/", include(("api.v1.urls_insights", "v1"), namespace="v1")),
]
