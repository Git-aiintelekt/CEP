"""Transactional email sent BY the platform (password links, alerts, support-access notices).

This is not campaign delivery: that goes through the tenant's delivery providers. SMTP comes from the environment
(EMAIL_HOST ...); without it Django's console backend prints the message, so nothing is ever silently lost in development.
"""
import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string

log = logging.getLogger("cep.mail")


def is_configured() -> bool:
    """True when a real SMTP server (or another delivering backend) is set, false for the console / file / dummy backends."""
    backend = settings.EMAIL_BACKEND.rsplit(".", 2)[-2]
    return backend not in ("console", "filebased", "dummy") and (backend != "smtp" or bool(settings.EMAIL_HOST))


def send(template: str, to: list[str] | str, context: dict, *, subject: str) -> bool:
    """Renders templates/email/<template>.txt and .html and sends both parts. Returns False instead of raising: the
    caller decides what a failed email means (a password link can still be copied, an alert stays open)."""
    recipients = [to] if isinstance(to, str) else [address for address in to if address]
    if not recipients:
        return False
    context = {"product": settings.EMAIL_PRODUCT_NAME, "frontend_url": settings.FRONTEND_URL.rstrip("/"), **context}
    text = render_to_string(f"email/{template}.txt", context)
    html = render_to_string(f"email/{template}.html", context)
    message = EmailMultiAlternatives(subject=subject, body=text, from_email=settings.DEFAULT_FROM_EMAIL, to=recipients,
                                     reply_to=[settings.EMAIL_REPLY_TO] if settings.EMAIL_REPLY_TO else None)
    message.attach_alternative(html, "text/html")
    try:
        message.send(fail_silently=False)
        return True
    except Exception as exc:                               # SMTP errors are many and varied; none may break the request
        log.error("email %s to %s failed: %s: %s", template, recipients, exc.__class__.__name__, exc)
        return False


def check() -> tuple[bool, str]:
    """Opens (and closes) a connection to the mail server: used by the health page."""
    if not is_configured():
        return False, "No mail server configured (EMAIL_HOST): messages are printed to the server log"
    try:
        connection = get_connection(timeout=5)
        connection.open()
        connection.close()
        return True, f"{settings.EMAIL_HOST}:{settings.EMAIL_PORT} accepted the connection"
    except Exception as exc:
        return False, f"{settings.EMAIL_HOST}:{settings.EMAIL_PORT} · {exc.__class__.__name__}: {str(exc)[:120]}"
