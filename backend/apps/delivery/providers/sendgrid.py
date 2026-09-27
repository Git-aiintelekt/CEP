"""Twilio SendGrid (https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send).

Send:     POST {api_base}/v3/mail/send   Authorization: Bearer <API key>   -> 202 Accepted, header X-Message-Id
          our idempotency key travels as custom_args.cep_id and comes back on every event
Webhooks: Event Webhook posts a JSON array: [{"event": "delivered", "sg_message_id": "<X-Message-Id>.filter...", "email",
          "timestamp", "reason", "type", "url", "ip", "useragent", "cep_id": "..."}]
          Signed Event Webhook: ECDSA P-256 / SHA-256 over timestamp + raw body, headers
          X-Twilio-Email-Event-Webhook-Signature and X-Twilio-Email-Event-Webhook-Timestamp.
"""
import base64
from datetime import datetime, timezone

import requests

from .base import ConfigField, DeliveryEvent, EmailMessage, EmailProvider, EventType, ProviderError, SendResult
from .registry import register

EVENTS = {"delivered": EventType.DELIVERED, "bounce": EventType.BOUNCED, "deferred": EventType.DEFERRED, "dropped": EventType.DROPPED,
          "spamreport": EventType.COMPLAINED, "open": EventType.OPENED, "click": EventType.CLICKED, "unsubscribe": EventType.UNSUBSCRIBED,
          "group_unsubscribe": EventType.UNSUBSCRIBED}
RESERVED_HEADERS = {"x-sg-id", "x-sg-eid", "received", "dkim-signature", "content-type", "content-transfer-encoding", "to", "from", "subject", "reply-to", "cc", "bcc"}


@register
class SendGridProvider(EmailProvider):
    provider_type = "SENDGRID"
    label = "SendGrid"
    description = "Twilio SendGrid. Delivery, bounce, complaint, open and click callbacks through the Event Webhook."
    supports_webhooks = True
    config_fields = (
        ConfigField("api_key", "API Key", secret=True, help="SendGrid -> Settings -> API keys. The key needs the Mail Send permission."),
        ConfigField("api_base", "API Address", required=False, kind="url", placeholder="https://api.sendgrid.com",
                    help="Leave empty for the global region; EU subusers use https://api.eu.sendgrid.com."),
        ConfigField("webhook_public_key", "Event Webhook Verification Key", required=False, kind="textarea",
                    help="Optional. SendGrid -> Mail settings -> Event Webhook -> Signed Event Webhook: callbacks are then verified."),
    )

    @property
    def _base(self) -> str:
        return str(self.config.get("api_base") or "https://api.sendgrid.com").rstrip("/")

    def open(self) -> None:
        self._session = self.new_session()
        self._session.headers.update({"Authorization": f"Bearer {self.secret or ''}", "Content-Type": "application/json"})

    def close(self) -> None:
        session = getattr(self, "_session", None)
        if session is not None:
            session.close()
            self._session = None

    def _session_or_open(self):
        if getattr(self, "_session", None) is None:
            self.open()
        return self._session

    def send(self, message: EmailMessage) -> SendResult:
        to = {"email": message.to_email, **({"name": message.to_name} if message.to_name else {})}
        body = {
            "personalizations": [{"to": [to], "custom_args": {"cep_id": message.idempotency_key, **message.metadata}}],
            "from": {"email": message.from_email, **({"name": message.from_name} if message.from_name else {})},
            "subject": message.subject,
            # text/plain must come first
            "content": [*([{"type": "text/plain", "value": message.text}] if message.text else []), {"type": "text/html", "value": message.html or message.text}],
        }
        if message.reply_to:
            body["reply_to"] = {"email": message.reply_to}
        headers = {k: v for k, v in message.headers.items() if k.lower() not in RESERVED_HEADERS}
        if headers:
            body["headers"] = headers
        if message.tag:
            body["categories"] = [message.tag[:255]]
        if message.attachments:
            body["attachments"] = [{"content": base64.b64encode(a.data).decode(), "filename": a.name, "type": a.content_type, "disposition": "attachment"} for a in message.attachments]
        try:
            response = self._session_or_open().post(self._base + "/v3/mail/send", json=body, timeout=20)
        except requests.RequestException as exc:
            return SendResult.retry(f"{exc.__class__.__name__}: {exc}")
        if response.status_code in (200, 202):
            return SendResult.accepted(response.headers.get("X-Message-Id", ""))
        detail = _errors(response)
        if response.status_code in (401, 403):
            raise ProviderError(f"SendGrid refused the API key (HTTP {response.status_code}). {detail}".strip(), retryable=False)
        if response.status_code == 429 or response.status_code >= 500:
            return SendResult.retry(f"SendGrid answered HTTP {response.status_code}. {detail}".strip())
        return SendResult.rejected(f"HTTP {response.status_code}: {detail}")

    def check(self) -> tuple[bool, str]:
        try:
            response = self._session_or_open().get(self._base + "/v3/scopes", timeout=15)
        except requests.RequestException as exc:
            return False, f"Cannot reach SendGrid: {exc.__class__.__name__}: {exc}"
        finally:
            self.close()
        if response.status_code in (401, 403):
            return False, "SendGrid refused the API key."
        if response.status_code != 200:
            return False, f"SendGrid answered HTTP {response.status_code}."
        scopes = (response.json() or {}).get("scopes") or []
        return ("mail.send" in scopes, "" if "mail.send" in scopes else "The API key works but lacks the Mail Send permission.")

    # ---- webhooks
    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        key = "".join(str(self.config.get("webhook_public_key") or "").split())
        if not key:
            return True
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        signature = headers.get("x-twilio-email-event-webhook-signature", "")
        timestamp = headers.get("x-twilio-email-event-webhook-timestamp", "")
        try:
            public_key = serialization.load_der_public_key(base64.b64decode(key))
            public_key.verify(base64.b64decode(signature), timestamp.encode() + body, ec.ECDSA(hashes.SHA256()))
            return True
        except (InvalidSignature, ValueError, TypeError):
            return False

    def parse_webhook(self, payload) -> list[DeliveryEvent]:
        events = []
        for item in payload if isinstance(payload, list) else []:
            kind = EVENTS.get(str(item.get("event", "")).lower()) if isinstance(item, dict) else None
            if kind is None:                                # processed and the like: nothing to record
                continue
            stamp = item.get("timestamp")
            event = DeliveryEvent(kind, provider_message_id=str(item.get("sg_message_id") or "").split(".", 1)[0], idempotency_key=str(item.get("cep_id") or ""),
                                  email=str(item.get("email") or ""), occurred_at=datetime.fromtimestamp(float(stamp), tz=timezone.utc) if stamp else None,
                                  reason=str(item.get("reason") or item.get("response") or "")[:200], url=str(item.get("url") or ""),
                                  ip_address=item.get("ip") or None, user_agent=str(item.get("useragent") or ""), raw=item)
            if kind is EventType.BOUNCED:
                event.bounce_type = "SOFT" if str(item.get("type", "")).lower() == "blocked" else "HARD"
            events.append(event)
        return events


def _errors(response) -> str:
    try:
        return "; ".join(str(e.get("message")) for e in (response.json() or {}).get("errors", []))[:180]
    except ValueError:
        return ""
