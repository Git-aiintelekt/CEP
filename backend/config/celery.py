import os

from celery import Celery
from celery.signals import after_setup_logger

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("cep")
app.config_from_object("django.conf:settings", namespace="CELERY")
# every module of the workers package, imported when a worker starts: autodiscover_tasks(["workers"]) looked for a
# workers.tasks module, which does not exist, so workers knew none of CEP's tasks ("Received unregistered task", .51 rehearsal)
WORKER_MODULES = ("campaign", "email", "insights_alerts", "insights_clickhouse", "insights_delivery", "journey", "lists", "maintenance",
                  "outbox", "platform", "reports", "sms", "tenant_task")
app.conf.imports = tuple(f"workers.{name}" for name in WORKER_MODULES)


@after_setup_logger.connect
def keep_error_capture(logger, **kwargs):
    """Celery replaces the root logger's handlers in the worker; errors logged by tasks still go to the back-office's Errors."""
    from apps.platform_ops.observe import ErrorCaptureHandler
    if not any(isinstance(handler, ErrorCaptureHandler) for handler in logger.handlers):
        logger.addHandler(ErrorCaptureHandler())
