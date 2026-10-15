"""Only the Insights routes, for the engine service (config/urls_insights.py)."""
from api.v1.urls import urlpatterns as _all

urlpatterns = [pattern for pattern in _all if str(getattr(pattern, "pattern", "")).startswith("insights/")]
