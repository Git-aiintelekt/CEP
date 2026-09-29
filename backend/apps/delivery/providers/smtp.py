"""SMTP: the workspace's own mail server (Settings -> Email server), or the platform server shared with it.

The delivery_provider row only points at the mail_server row (config.mail_server_id); host, login and the encrypted
password live there. SMTP has no callbacks: a message is SUBMITTED once the server accepted it, and bounces arrive as
ordinary mail at the From / Return-Path address. One connection is kept open for a whole batch.
"""
import smtplib
import socket
from email.utils import make_msgid

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection

from .base import EmailMessage, EmailProvider, ProviderError, SendResult
from .registry import register


@register
class SmtpProvider(EmailProvider):
    provider_type = "SMTP"
    label = "SMTP (your mail server)"
    description = "Sends through the mail server entered under Settings -> Email server. No delivery or bounce callbacks."
    supports_webhooks = False
    manageable = False                  # switched on from the Email server page, not created here
    max_batch = 50

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._connection = None

    def _kwargs(self) -> dict:
        server_id = self.config.get("mail_server_id")
        if not server_id:               # inline settings: used by tests and by installations that script their providers
            security = str(self.config.get("security", "STARTTLS")).upper()
            return {"backend": "django.core.mail.backends.smtp.EmailBackend", "host": self.config.get("host"), "port": int(self.config.get("port") or 587),
                    "username": self.config.get("username") or None, "password": self.secret, "use_tls": security == "STARTTLS", "use_ssl": security == "SSL"}
        from apps.platform_ops import mail
        from apps.platform_ops.models import MailServer
        server = MailServer.objects.using(settings.PLATFORM_ALIAS).filter(pk=server_id).first()
        if server is None or not server.is_active:
            raise ProviderError("The workspace mail server was removed or switched off.", retryable=False)
        return mail._kwargs(server)

    def open(self) -> None:
        try:
            self._connection = get_connection(**self._kwargs(), timeout=settings.EMAIL_TIMEOUT)
            self._connection.open()
        except smtplib.SMTPAuthenticationError as exc:
            raise ProviderError(f"The mail server refused the sign-in: {exc.smtp_error.decode(errors='replace')[:120]}", retryable=False) from None
        except (OSError, smtplib.SMTPException) as exc:
            raise ProviderError(f"Cannot reach the mail server: {exc.__class__.__name__}: {exc}") from None

    def close(self) -> None:
        if self._connection is not None:
            try:
                self._connection.close()
            except Exception:           # noqa: BLE001  (a connection that is already gone is closed enough)
                pass
            self._connection = None

    def send(self, message: EmailMessage) -> SendResult:
        if self._connection is None:
            self.open()
        message_id = make_msgid(idstring=message.idempotency_key[-24:].replace(":", ".") or None, domain=message.from_email.rsplit("@", 1)[-1])
        mail = EmailMultiAlternatives(subject=message.subject, body=message.text or " ", from_email=message.sender, to=[message.recipient],
                                      reply_to=[message.reply_to] if message.reply_to else None, connection=self._connection,
                                      headers={**message.headers, "Message-ID": message_id, "X-CEP-Id": message.idempotency_key})
        if message.html:
            mail.attach_alternative(message.html, "text/html")
        for attachment in message.attachments:
            mail.attach(attachment.name, attachment.data, attachment.content_type)
        try:
            mail.send(fail_silently=False)
            return SendResult.accepted(message_id.strip("<>"))
        except smtplib.SMTPRecipientsRefused as exc:
            code, text = next(iter(exc.recipients.values()), (550, b"recipient refused"))
            reason = f"{code} {text.decode(errors='replace') if isinstance(text, bytes) else text}"
            return SendResult.retry(reason) if 400 <= int(code) < 500 else SendResult.rejected(reason)
        except smtplib.SMTPResponseException as exc:          # sender refused, data error ...
            reason = f"{exc.smtp_code} {exc.smtp_error.decode(errors='replace') if isinstance(exc.smtp_error, bytes) else exc.smtp_error}"
            if 400 <= exc.smtp_code < 500:
                return SendResult.retry(reason)
            return SendResult.rejected(reason)
        except (smtplib.SMTPServerDisconnected, socket.timeout, ConnectionError, OSError) as exc:
            self.close()                                       # the next send reconnects
            return SendResult.retry(f"{exc.__class__.__name__}: {exc}")

    def check(self) -> tuple[bool, str]:
        try:
            self.open()
            return True, ""
        except ProviderError as exc:
            return False, str(exc)
        finally:
            self.close()
