import os

from celery import Celery
from celery.signals import after_setup_logger

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("cep")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks(["workers"])


@after_setup_logger.connect
def keep_error_capture(logger, **kwargs):
    """Celery replaces the root logger's handlers in the worker; errors logged by tasks still go to the back-office's Errors."""
    from apps.platform_ops.observe import ErrorCaptureHandler
    if not any(isinstance(handler, ErrorCaptureHandler) for handler in logger.handlers):
        logger.addHandler(ErrorCaptureHandler())
