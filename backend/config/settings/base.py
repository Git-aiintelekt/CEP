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
# The back-office (session + CSRF) behind an HTTPS edge that proxies to plain HTTP: Django compares the browser's
# Origin with what it sees, so the public https origin has to be listed here or every admin form answers 403.
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# ---------------------------------------------------------------- apps
DOMAIN_APPS = [
    "apps.tenants", "apps.identity", "apps.customers", "apps.contact_lists", "apps.templates", "apps.campaigns",
    "apps.journeys", "apps.governance", "apps.delivery", "apps.media", "apps.reporting", "apps.audit",
    "apps.integrations", "apps.tracking", "apps.scoring", "apps.platform_ops", "apps.pos", "apps.insights",
    "apps.database",                                    # owns the RunSQL migration that applies the DDL
]
INSTALLED_APPS = [
    "unfold",                                             # Tailwind-based admin theme: must precede django.contrib.admin
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.humanize",                           # thousands separators on the back-office pages
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
    "apps.platform_ops.observe.RequestMetricsMiddleware",  # times every request per tenant and route (the back-office's Tenant performance)
    "django.middleware.security.SecurityMiddleware",
    "apps.integrations.bridge.correlation.CorrelationIdMiddleware",   # X-Correlation-Id in, the id used out; on every integration log row
    "apps.tenants.middleware.PlatformAdminMiddleware",    # /admin/ -> BYPASSRLS platform connection (before sessions/auth)
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.platform_ops.admin_mfa.AdminMfaMiddleware",     # staff who enrolled an authenticator must pass it for the back-office too
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
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:5173")      # where one-time password links point
API_PUBLIC_URL = env("API_PUBLIC_URL", default="http://localhost:8000")
CEP_RELEASE = env("CEP_RELEASE", default="")                                 # shown on each recorded error; empty = the git commit at start-up   # the address an identity provider redirects back to
PLATFORM_ADMIN_URL = env("PLATFORM_ADMIN_URL", default=API_PUBLIC_URL)    # linked from alert emails

# ---------------------------------------------------------------- email sent BY the platform (password links, alerts, notices)
# Set EMAIL_HOST to use SMTP. Without it messages are printed to the server log, so development needs no mail server.
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)        # STARTTLS on 587
EMAIL_USE_SSL = env.bool("EMAIL_USE_SSL", default=False)       # implicit TLS on 465 (use one or the other)
EMAIL_TIMEOUT = env.int("EMAIL_TIMEOUT", default=10)
PASSWORD_RESET_TIMEOUT = 14 * 24 * 3600        # hard ceiling for one-time password links; the effective lifetime is the
                                                # global parameter security.password_link_hours (apps/platform_ops/links.py)
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend" if EMAIL_HOST else "django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="C360 <no-reply@localhost>")
SERVER_EMAIL = DEFAULT_FROM_EMAIL
EMAIL_REPLY_TO = env("EMAIL_REPLY_TO", default="")
EMAIL_PRODUCT_NAME = env("EMAIL_PRODUCT_NAME", default="C360")

# ---------------------------------------------------------------- secrets at rest, tenant operations
FIELD_ENCRYPTION_KEY = env("FIELD_ENCRYPTION_KEY", default="")     # Fernet key(s), comma separated; see apps/platform_ops/crypto.py
OWNER_DATABASE_URL = env("OWNER_DATABASE_URL", default="")         # DDL-owner login: only tenant exports / moves / offboarding use it
TENANT_EXPORT_DIR = env("TENANT_EXPORT_DIR", default=str(BASE_DIR / "exports"))
# Insights' second engine (apps/insights/clickhouse.py): empty URL = no ClickHouse, every workspace reports on PostgreSQL
CLICKHOUSE_URL = env("CLICKHOUSE_URL", default="")
CLICKHOUSE_USER = env("CLICKHOUSE_USER", default="default")
CLICKHOUSE_PASSWORD = env("CLICKHOUSE_PASSWORD", default="")
CLICKHOUSE_DATABASE = env("CLICKHOUSE_DATABASE", default="cep_reporting")
DATABASE_ROUTERS = ["apps.tenants.router.TenantRouter"]
CONTROL_PLANE_ALIAS = "default"
CONTROL_PLANE_MODELS = {"tenant", "tenant_database", "subscription_plan", "tenant_subscription", "tenant_usage", "tenant_storage_config",
                        "tenant_invoice", "tenant_operation", "job_run", "platform_alert", "support_access_log", "tenant_identity_provider",
                        "platform_setting", "industry_profile", "mail_server", "platform_personalization_tag",
                        "error_group", "error_event", "request_metric", "uptime_target", "uptime_check", "tenant_quota_grant",
                        "suite_component", "plan_component", "tenant_component",
                        "report_dataset", "report_field", "report_dataset_source", "report_engine_setting", "report_engine_connection", "ai_provider", "report_dataset_link"}
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
        "api.auth.ApiKeyAuthentication",   # first: it only claims `Bearer cep_...`; JWT would reject such a key as a bad token
        "api.auth.CepJWTAuthentication",             # JWT + the rules for support sessions and pending MFA enrolment
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
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.UserRateThrottle", "rest_framework.throttling.AnonRateThrottle",
                                 "apps.integrations.bridge.inbound.ApiKeyRateThrottle"],       # api_client.rate_limit_per_minute, enforced
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
    "TITLE": "C360 API",
    "DESCRIPTION": "AI-InteleKt Customer Engagement Platform — API-first modular monolith (Django + DRF) with FastAPI hot-path services.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v[0-9]",
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {"ContactListStatusEnum": "apps.contact_lists.models.ContactList.Status"},   # several models have a `status`
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
    "workers.lists.*": {"queue": "imports"},               # list uploads: their own queue, so a big file never delays a send
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
    "rollup-usage": {"task": "workers.platform.rollup_usage", "schedule": 3600},
    "evaluate-alerts": {"task": "workers.platform.evaluate_alerts", "schedule": 300},
    "generate-invoices": {"task": "workers.platform.generate_invoices", "schedule": 24 * 3600},          # drafts last month; re-runs only refresh drafts
    "run-tenant-operations": {"task": "workers.platform.run_tenant_operations", "schedule": 600},
    "dispatch-campaign-runs": {"task": "workers.campaign.dispatch_due_runs", "schedule": 60},          # starts due runs, closes finished ones
    "plan-recurring-runs": {"task": "workers.campaign.plan_recurring_runs", "schedule": 300},          # recurring campaigns: one Run per occurrence
    "refresh-audience-lists": {"task": "workers.campaign.refresh_audience_lists", "schedule": 900},    # lists made from a BI / extraction audience
    "process-list-imports": {"task": "workers.lists.process_imports", "schedule": 30},                 # the net under the API's own hand-off
    "rollup-integration-metrics": {"task": "workers.platform.rollup_integration_metrics", "schedule": 300},  # per-minute integration figures from the log
    "decide-ab-winners": {"task": "workers.campaign.decide_ab_winners", "schedule": 60},                 # subject-line tests whose decision time has come
    "send-weekly-reports": {"task": "workers.reports.send_weekly_reports", "schedule": 900},              # the Monday report, in each workspace's own time
    "deliver-report-schedules": {"task": "workers.insights_delivery.deliver_report_schedules", "schedule": 300},  # Insights reports scheduled by email
    "check-report-alerts": {"task": "workers.insights_alerts.check_report_alerts", "schedule": 300},  # Insights threshold alerts
    "refresh-clickhouse-reporting": {"task": "workers.insights_clickhouse.refresh_clickhouse_reporting", "schedule": 900},  # the ClickHouse reporting tables' recent window
    "probe-uptime": {"task": "workers.platform.probe_uptime", "schedule": 60},                             # calls the uptime targets; alerts on a change
    "prune-observability": {"task": "workers.platform.prune_observability", "schedule": 24 * 3600},       # errors, request figures and probes past retention
    "attribute-orders": {"task": "workers.platform.attribute_orders", "schedule": 300},                    # orders -> campaigns -> campaign_actual
    "enroll-journey-customers": {"task": "workers.journey.enroll_customers", "schedule": 60},            # entry rules of live journeys
    "advance-journey-customers": {"task": "workers.journey.advance_customers", "schedule": 60},          # customers whose next step is due
    "rollup-journey-analytics": {"task": "workers.journey.rollup_analytics", "schedule": 24 * 3600},     # the journey Performance figures, nightly
    "activate-scheduled-journeys": {"task": "workers.journey.activate_scheduled", "schedule": 60},        # Approved · Scheduled journeys whose time has come
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
# Uploaded contact files wait here (private: NOT under MEDIA_ROOT, which the development server serves) until a worker has
# read them; with a MEDIA_BUCKET they go to the workspace's private object storage instead.
LIST_IMPORT_DIR = env("LIST_IMPORT_DIR", default=str(BASE_DIR / "imports"))
LIST_IMPORT_RUNNER = env("LIST_IMPORT_RUNNER", default="celery")     # celery | thread | none  (apps/contact_lists/jobs.py)
MEDIA_URL = "/media/"
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]                  # the back-office stylesheet (static/cep_admin)
CEP_ENVIRONMENT = env("CEP_ENVIRONMENT", default="")       # label in the back-office header: Production, Staging, ...; empty = Local / Production by DEBUG

# ---------------------------------------------------------------- i18n / misc
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"format": '{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}'}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"},
                 "errors": {"class": "apps.platform_ops.observe.ErrorCaptureHandler", "level": "ERROR"}},   # the back-office's Errors
    "root": {"handlers": ["console", "errors"], "level": env("LOG_LEVEL", default="INFO")},
}

# ---------------------------------------------------------------- platform back-office theme
from .unfold import UNFOLD  # noqa: E402,F401
