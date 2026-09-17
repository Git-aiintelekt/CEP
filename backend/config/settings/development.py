from .base import *  # noqa: F401,F403

DEBUG = True
ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = True
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {"user": "100000/min", "anon": "1000/min"}  # noqa: F405

# Local development runs without Redis unless asked: tenant resolution and DRF throttling only need a cache.
# Set DEV_USE_REDIS=True in .env once `docker compose -f deploy/docker-compose.dev.yml up -d` (or another Redis) is running.
if not env.bool("DEV_USE_REDIS", default=False):  # noqa: F405
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "cep-dev"}}
