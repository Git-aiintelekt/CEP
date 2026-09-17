"""CEP — Django settings (base). Environment-driven; see .env.example at the repository root."""
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parents[2]          # backend/
REPO_DIR = BASE_DIR.parent                              # repository root (database/, deploy/, ...)

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(REPO_DIR / ".env")

SECRET_KEY = env("SECRET_KEY", default="change-me-in-.env")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# ---------------------------------------------------------------- apps
DOMAIN_APPS = [
    "apps.tenants", "apps.identity", "apps.customers", "apps.contact_lists", "apps.templates", "apps.campaigns",
    "apps.journeys", "apps.governance", "apps.delivery", "apps.media", "apps.reporting", "apps.audit",
    "apps.integrations", "apps.tracking", "apps.scoring",
    "apps.database",                                    # owns the RunSQL migration that applies the DDL
]
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "rest_framework_simplejwt",
    "drf_spectacular",
    "corsheaders",
    "django_filters",
    "storages",
    *DOMAIN_APPS,
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.tenants.middleware.PlatformAdminMiddleware",    # /admin/ -> BYPASSRLS platform connection (before sessions/auth)
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.tenants.middleware.TenantMiddleware",           # resolves the tenant, opens the request transaction, SET LOCAL app.current_tenant
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

# ---------------------------------------------------------------- database & tenancy
DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://cep:cep@127.0.0.1:5432/cep_pool"),  # shared pool = control plane
}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("CONN_MAX_AGE", default=60)
# Back-office connection: a BYPASSRLS login (member of cep_admin) used only by Django Admin and management commands.
DATABASES["platform"] = env.db("PLATFORM_DATABASE_URL", default=env("DATABASE_URL", default="postgres://cep:cep@127.0.0.1:5432/cep_pool"))
PLATFORM_ALIAS = "platform"
PLATFORM_PATH_PREFIXES = ("/admin/",)
DATABASE_ROUTERS = ["apps.tenants.router.TenantRouter"]
CONTROL_PLANE_ALIAS = "default"
CONTROL_PLANE_MODELS = {"tenant", "tenant_database", "subscription_plan", "tenant_subscription", "tenant_usage", "tenant_storage_config"}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------- auth
AUTH_USER_MODEL = "identity.AppUser"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------- REST framework (API-first)
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "api.auth.ApiKeyAuthentication",                    # api_client keys for integrations / services
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "api.pagination.DefaultCursorPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"] + (["rest_framework.renderers.BrowsableAPIRenderer"] if DEBUG else []),
    "EXCEPTION_HANDLER": "api.exceptions.problem_json_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.UserRateThrottle", "rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"user": "600/min", "anon": "30/min"},
    "DEFAULT_VERSIONING_CLASS": "rest_framework.versioning.URLPathVersioning",
    "DEFAULT_VERSION": "v1",
    "ALLOWED_VERSIONS": ["v1"],
}
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": False,
    "UPDATE_LAST_LOGIN": True,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "sub",
}
SPECTACULAR_SETTINGS = {
    "TITLE": "CEP API",
    "DESCRIPTION": "AI-InteleKt Customer Engagement Platform — API-first modular monolith (Django + DRF) with FastAPI hot-path services.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v[0-9]",
    "COMPONENT_SPLIT_REQUEST": True,
}
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5173"])  # Vite dev server
CORS_ALLOW_CREDENTIALS = True

# ---------------------------------------------------------------- Celery / Redis
REDIS_URL = env("REDIS_URL", default="redis://127.0.0.1:6379/0")
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_TASK_ROUTES = {                                   # queue isolation per the Framework doc
    "workers.audience.*": {"queue": "audience"},
    "workers.campaign.*": {"queue": "campaign"},
    "workers.email.*": {"queue": "email"},
    "workers.sms.*": {"queue": "sms"},
    "workers.journey.*": {"queue": "journey"},
    "workers.events.*": {"queue": "events"},
    "workers.analytics.*": {"queue": "analytics"},
    "workers.maintenance.*": {"queue": "maintenance"},
    "workers.outbox.*": {"queue": "events"},
}
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BEAT_SCHEDULE = {
    "outbox-relay": {"task": "workers.outbox.relay_pending_events", "schedule": 1.0},
    "ensure-monthly-partitions": {"task": "workers.maintenance.ensure_monthly_partitions", "schedule": 6 * 3600},
    "apply-partition-retention": {"task": "workers.maintenance.apply_partition_retention", "schedule": 24 * 3600},
}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}

# ---------------------------------------------------------------- media / CDN (see CEP_SaaS_Tenancy_and_CDN_Setup.md)
MEDIA_BUCKET = env("MEDIA_BUCKET", default="")
MEDIA_REGION = env("MEDIA_REGION", default="us-east-1")
CDN_BASE_URL = env("CDN_BASE_URL", default="")
AWS_S3_ENDPOINT_URL = env("S3_ENDPOINT_URL", default=None)
MEDIA_MAX_BYTES = 25 * 1024 * 1024
if MEDIA_BUCKET:
    STORAGES = {
        "default": {"BACKEND": "apps.media.storage.TenantPublicStorage"},
        "private": {"BACKEND": "apps.media.storage.TenantPrivateStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
else:                                                    # local development: plain filesystem
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
MEDIA_ROOT = BASE_DIR / "media"
MEDIA_URL = "/media/"
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# ---------------------------------------------------------------- i18n / misc
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"format": '{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}'}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}
