from .base import *  # noqa: F401,F403

DEBUG = True
ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = True
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {"user": "100000/min", "anon": "1000/min"}  # noqa: F405

# Local development runs without Redis unless asked: tenant resolution and DRF throttling only need a cache.
# Set DEV_USE_REDIS=True in .env once `docker compose -f deploy/docker-compose.dev.yml up -d` (or another Redis) is running.
if not env.bool("DEV_USE_REDIS", default=False):  # noqa: F405
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "cep-dev"}}

# No Redis in local development: list uploads are processed by a background thread of the web process.
LIST_IMPORT_RUNNER = env("LIST_IMPORT_RUNNER", default="celery" if env.bool("DEV_USE_REDIS", default=False) else "thread")  # noqa: F405

# runserver starts a thread per request, and a persistent connection belongs to its thread: with CONN_MAX_AGE > 0 every
# request would leave an idle session behind until the database runs out of connections. Production (gunicorn / uvicorn
# with a fixed pool of workers) keeps the persistent connections configured in base.py.
#
# Opening a connection costs five or more network round trips. Against a database that is far away (a VPN, another
# region) that is well over a second per request, so development shares a small psycopg pool between the request threads
# instead. Tenant and platform context are set per transaction (set_config(..., true)), so a pooled connection carries
# nothing from one request to the next. DEV_DB_POOL=False goes back to a connection per request.
for _alias in DATABASES:  # noqa: F405
    DATABASES[_alias]["CONN_MAX_AGE"] = 0  # noqa: F405
    if env.bool("DEV_DB_POOL", default=True):  # noqa: F405
        DATABASES[_alias].setdefault("OPTIONS", {})["pool"] = {"min_size": 1, "max_size": 8, "timeout": 30, "max_idle": 600}  # noqa: F405
