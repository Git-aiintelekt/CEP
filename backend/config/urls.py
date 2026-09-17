from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.admin.views.decorators import staff_member_required
from django.http import JsonResponse
from django.urls import include, path
from django.views.generic import RedirectView
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

from api.health import healthz

def admin_health_json(request):
    """Machine-readable copy of the back-office health page (staff session required): 503 when any check is failing."""
    from apps import platform_health
    report = platform_health.collect()
    return JsonResponse(report, status=503 if report["status"] == "fail" else 200)


urlpatterns = [
    path("", RedirectView.as_view(url="/api/v1/docs/", permanent=False)),   # no product UI here: that is the React app
    path("healthz", healthz),
    path("admin/health.json", staff_member_required(admin_health_json), name="admin_health_json"),
    path("admin/", admin.site.urls),
    path("api/v1/", include(("api.v1.urls", "v1"), namespace="v1")),
    path("api/v1/schema/", SpectacularAPIView.as_view(api_version="v1"), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/v1/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

if settings.DEBUG and not settings.MEDIA_BUCKET:                     # production serves assets from the CDN
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
