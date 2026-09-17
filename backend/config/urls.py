from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

from api.health import healthz

urlpatterns = [
    path("", RedirectView.as_view(url="/api/v1/docs/", permanent=False)),   # no product UI here: that is the React app
    path("healthz", healthz),
    path("admin/", admin.site.urls),
    path("api/v1/", include(("api.v1.urls", "v1"), namespace="v1")),
    path("api/v1/schema/", SpectacularAPIView.as_view(api_version="v1"), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/v1/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

if settings.DEBUG and not settings.MEDIA_BUCKET:                     # production serves assets from the CDN
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
