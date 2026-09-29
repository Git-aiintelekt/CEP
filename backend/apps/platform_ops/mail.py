"""Transactional email sent BY the platform (password links, alerts, support-access notices).

This is not campaign delivery: that goes through the tenant's delivery providers. Where a message goes out from is
resolved per message, first match wins:

  1. the tenant's own mail server (Settings -> Email server), when the message is for one of its users
  2. the platform's mail server (back-office -> Configuration -> Mail server): the platform's own mail, and the fallback for a
     tenant that has no working server of its own
  3. SMTP from the environment (EMAIL_HOST ...)
  4. Django's console backend: the message is printed to the server log, so nothing is ever silently lost in development

The platform's server is never a tenant's sending engine: campaigns and e-receipts go through the tenant's own server or its
delivery providers.

Mail servers entered in the product live in `mail_server`; passwords are encrypted with FIELD_ENCRYPTION_KEY.
"""
import logging
from dataclasses import dataclass

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string
from django.utils import timezone

from . import crypto

log = logging.getLogger("cep.mail")
P = settings.PLATFORM_ALIAS
SMTP = "django.core.mail.backends.smtp.EmailBackend"


@dataclass
class Resolved:
    source: str                                            # tenant | platform | environment | console
    connection_kwargs: dict
    from_email: str
    reply_to: str | None = None
    server_id: str | None = None

    @property
    def delivers(self) -> bool:
        return self.source != "console"

    def connection(self, timeout: int | None = None):
        return get_connection(**self.connection_kwargs, timeout=timeout or settings.EMAIL_TIMEOUT)


# ------------------------------------------------------------------------------------------------------------ resolution
def _rows(sql, args=()):
    from django.db import connections
    with connections[P].cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchall()


def platform_server():
    from .models import MailServer
    return MailServer.objects.using(P).filter(tenant_id__isnull=True).first()


def tenant_server(tenant_id):
    from .models import MailServer
    return MailServer.objects.using(P).filter(tenant_id=tenant_id).first()


def _kwargs(server) -> dict:
    return {"backend": SMTP, "host": server.host, "port": server.port, "username": server.username or None,
            "password": crypto.decrypt(server.password_enc) if server.password_enc else None,
            "use_tls": server.security == "STARTTLS", "use_ssl": server.security == "SSL"}


def _from(server) -> str:
    return f"{server.from_name} <{server.from_email}>" if server.from_name else server.from_email


def resolve(tenant_id=None, own=None) -> Resolved:
    """own: the tenant's row when the caller already holds it (inside the request that just saved it, the platform
    connection cannot see it yet)."""
    if tenant_id is not None:
        own = own or tenant_server(tenant_id)
        if own and own.is_active:
            return Resolved("tenant", _kwargs(own), _from(own), own.reply_to or None, str(own.pk))
    platform = platform_server()
    if platform and platform.is_active:
        return Resolved("platform", _kwargs(platform), _from(platform), platform.reply_to or None, str(platform.pk))
    backend = settings.EMAIL_BACKEND.rsplit(".", 2)[-2]
    if backend not in ("console", "filebased", "dummy") and (backend != "smtp" or settings.EMAIL_HOST):
        return Resolved("environment", {}, settings.DEFAULT_FROM_EMAIL, settings.EMAIL_REPLY_TO or None)
    return Resolved("console", {"backend": "django.core.mail.backends.console.EmailBackend"}, settings.DEFAULT_FROM_EMAIL)


def is_configured(tenant_id=None) -> bool:
    """True when a message for this tenant (or the platform) would really be delivered somewhere."""
    return resolve(tenant_id).delivers


# ------------------------------------------------------------------------------------------------------------ sending
def send(template: str, to: list[str] | str, context: dict, *, subject: str, tenant_id=None) -> bool:
    """Renders templates/email/<template>.txt and .html and sends both parts. Returns False instead of raising: the
    caller decides what a failed email means (a password link can still be copied, an alert stays open)."""
    recipients = [to] if isinstance(to, str) else [address for address in to if address]
    if not recipients:
        return False
    context = {"product": settings.EMAIL_PRODUCT_NAME, "frontend_url": settings.FRONTEND_URL.rstrip("/"), **context}
    text = render_to_string(f"email/{template}.txt", context)
    html = render_to_string(f"email/{template}.html", context)
    try:
        route = resolve(tenant_id)
        message = EmailMultiAlternatives(subject=subject, body=text, from_email=route.from_email, to=recipients,
                                         reply_to=[route.reply_to] if route.reply_to else None, connection=route.connection())
        message.attach_alternative(html, "text/html")
        message.send(fail_silently=False)
        return True
    except Exception as exc:                               # SMTP errors are many and varied; none may break the request
        log.error("email %s to %s failed: %s: %s", template, recipients, exc.__class__.__name__, exc)
        return False


def check(tenant_id=None) -> tuple[bool, str]:
    """Opens (and closes) a connection to the resolved mail server: used by the health page."""
    route = resolve(tenant_id)
    if not route.delivers:
        return False, "No mail server configured (back-office -> Mail server, or EMAIL_HOST): messages are printed to the server log"
    where = f"{route.connection_kwargs.get('host', settings.EMAIL_HOST)}:{route.connection_kwargs.get('port', settings.EMAIL_PORT)}"
    try:
        connection = route.connection(timeout=5)
        connection.open()
        connection.close()
        return True, f"{where} accepted the connection ({route.source})"
    except Exception as exc:
        return False, f"{where} · {exc.__class__.__name__}: {str(exc)[:120]}"


def test(server, to: str, *, by: str = "") -> tuple[bool, str]:
    """Sends a real test message through one mail_server row and records the outcome on it."""
    kwargs, sender = _kwargs(server), _from(server)
    try:
        connection = get_connection(**kwargs, timeout=settings.EMAIL_TIMEOUT)
        message = EmailMultiAlternatives(subject=f"[{settings.EMAIL_PRODUCT_NAME}] Test message", to=[to], from_email=sender, connection=connection,
                                         reply_to=[server.reply_to] if server.reply_to else None,
                                         body=f"This is a test message from {settings.EMAIL_PRODUCT_NAME}.\n\nIt was sent through {kwargs['host']}:{kwargs['port']}"
                                              f" as {sender}{f' by {by}' if by else ''}. If you can read this, the mail server works.\n")
        message.send(fail_silently=False)
        outcome = (True, "")
    except Exception as exc:
        outcome = (False, f"{exc.__class__.__name__}: {str(exc)[:300]}")
    _record(server, outcome)
    return outcome


def _record(server, outcome):
    from django.db import connections
    ok, error = outcome
    with connections[P].cursor() as cursor:                # a plain UPDATE: no form stamping, no audit noise for a test
        cursor.execute("UPDATE mail_server SET last_tested_at = %s, last_test_ok = %s, last_test_error = %s WHERE id = %s",
                       [timezone.now(), ok, error or None, str(server.pk)])
    server.last_tested_at, server.last_test_ok, server.last_test_error = timezone.now(), ok, error or None
