from .base import *  # noqa: F401,F403

DEBUG = True
ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = True
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {"user": "100000/min", "anon": "1000/min"}  # noqa: F405

# Local development runs without Redis unless asked: tenant resolution and DRF throttling only need a cache.
# Set DEV_USE_REDIS=True in .env once `docker compose -f deploy/docker-compose.dev.yml up -d` (or another Redis) is running.
if not env.bool("DEV_USE_REDIS", default=False):  # noqa: F405
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "cep-dev"}}

# runserver starts a thread per request, and a persistent connection belongs to its thread: with CONN_MAX_AGE > 0 every
# request would leave an idle session behind until the database runs out of connections. Production (gunicorn / uvicorn
# with a fixed pool of workers) keeps the persistent connections configured in base.py.
for _alias in DATABASES:  # noqa: F405
    DATABASES[_alias]["CONN_MAX_AGE"] = 0  # noqa: F405
