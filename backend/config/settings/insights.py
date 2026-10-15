"""The report engine service: the app's settings with the Insights routes alone. Choose the base with CEP_SETTINGS_BASE
(development or production, as the app process runs), e.g. DJANGO_SETTINGS_MODULE=config.settings.insights CEP_SETTINGS_BASE=production.
A runaway report exhausts this process's connections and CPU share, never the app's."""
import importlib
import os

_base = importlib.import_module(f"config.settings.{os.environ.get('CEP_SETTINGS_BASE', 'development')}")
globals().update({name: getattr(_base, name) for name in dir(_base) if name.isupper()})

ROOT_URLCONF = "config.urls_insights"
