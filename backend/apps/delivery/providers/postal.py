"""Postal (self-hosted mail delivery platform, https://docs.postalserver.io).

Send:     POST {endpoint}/api/v1/send/message      header X-Server-API-Key, JSON body, one recipient per call
          -> {"status": "success", "data": {"message_id": "...", "messages": {"<rcpt>": {"id": 1, "token": "..."}}}}
          Postal answers HTTP 200 for application errors too: {"status": "parameter-error" | "error", "data": {"code", "message"}}
Webhooks: {"event": "MessageSent", "timestamp": 1.0, "payload": {"message": {"message_id", "to", "tag", ...}, "details", ...}}
          signed with the installation's RSA key: header X-Postal-Signature = base64(RSA-SHA1(raw body)).
"""
import base64
from datetime import datetime, timezone

import requests

from .base import ConfigField, DeliveryEvent, EmailMessage, EmailProvider, EventType, ProviderError, SendResult
from .registry import register

FATAL_CODES = {"InvalidServerAPIKey", "ServerSuspended", "AccessDenied"}                  # nothing will go out until someone fixes the provider
EVENTS = {"MessageSent": EventType.DELIVERED, "MessageDelayed": EventType.DEFERRED, "MessageDeliveryFailed": EventType.BOUNCED,
          "MessageBounced": EventType.BOUNCED, "MessageHeld": EventType.DROPPED, "MessageLoaded": EventType.OPENED, "MessageLinkClicked": EventType.CLICKED}


@register
class PostalProvider(EmailProvider):
    provider_type = "POSTAL"
    label = "Postal"
    description = "Self-hosted Postal server. Delivery, bounce, open and click callbacks through webhooks."
    supports_webhooks = True
    config_fields = (
        ConfigField("endpoint", "Postal address", kind="url", placeholder="https://postal.example.com", help="Base address of your Postal installation."),
        ConfigField("api_key", "Server API key", secret=True, help="Postal -> your mail server -> Credentials -> type API."),
        ConfigField("webhook_public_key", "Webhook public key", required=False, kind="textarea",
                    help="Optional. PEM public key of the Postal installation (postal default-dkim-record): webhook signatures are then verified."),
    )

    def open(self) -> None:
        self._session = requests.Session()
        self._session.headers.update({"X-Server-API-Key": self.secret or "", "Content-Type": "application/json"})

    def close(self) -> None:
        session = getattr(self, "_session", None)
        if session is not None:
            session.close()
            self._session = None

    def _post(self, path: str, body: dict):
        if getattr(self, "_session", None) is None:
            self.open()
        return self._session.post(str(self.config.get("endpoint", "")).rstrip("/") + path, json=body, timeout=20)

    def send(self, message: EmailMessage) -> SendResult:
        body = {"to": [message.to_email], "from": message.sender, "subject": message.subject, "html_body": message.html, "plain_body": message.text,
                "tag": message.tag or None, "reply_to": message.reply_to, "headers": {**message.headers, "X-CEP-Id": message.idempotency_key}}
        try:
            response = self._post("/api/v1/send/message", {k: v for k, v in body.items() if v not in (None, "")})
        except requests.RequestException as exc:
            return SendResult.retry(f"{exc.__class__.__name__}: {exc}")
        if response.status_code == 429 or response.status_code >= 500:
            return SendResult.retry(f"Postal answered HTTP {response.status_code}")
        try:
            answer = response.json()
        except ValueError:
            return SendResult.retry(f"Postal answered HTTP {response.status_code} without JSON")
        if answer.get("status") == "success":
            return SendResult.accepted(str((answer.get("data") or {}).get("message_id") or ""))
        data = answer.get("data") or {}
        code, text = str(data.get("code") or answer.get("status")), str(data.get("message") or "")
        if code in FATAL_CODES or response.status_code in (401, 403):
            raise ProviderError(f"Postal refused the API key or the server is suspended ({code}). {text}".strip(), retryable=False)
        return SendResult.rejected(f"{code}: {text}".strip(": "))

    def check(self) -> tuple[bool, str]:
        """An empty send is answered with a parameter error when the key is good, and with InvalidServerAPIKey when it is not."""
        try:
            answer = self._post("/api/v1/send/message", {}).json()
        except (requests.RequestException, ValueError) as exc:
            return False, f"Cannot reach Postal: {exc.__class__.__name__}: {exc}"
        finally:
            self.close()
        code = str((answer.get("data") or {}).get("code") or "")
        if code in FATAL_CODES:
            return False, f"Postal refused the API key ({code})."
        return True, ""

    # ---- webhooks
    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        pem = str(self.config.get("webhook_public_key") or "").strip()
        if not pem:
            return True                                     # the URL token is the only check until a key is configured
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        signature = headers.get("x-postal-signature", "")
        try:
            if "BEGIN" not in pem:
                pem = "-----BEGIN PUBLIC KEY-----\n" + pem + "\n-----END PUBLIC KEY-----"
            serialization.load_pem_public_key(pem.encode()).verify(base64.b64decode(signature), body, padding.PKCS1v15(), hashes.SHA1())  # noqa: S303 (Postal's scheme)
            return True
        except (InvalidSignature, ValueError, TypeError):
            return False

    def parse_webhook(self, payload) -> list[DeliveryEvent]:
        if not isinstance(payload, dict) or payload.get("event") not in EVENTS:
            return []
        body = payload.get("payload") or {}
        message = body.get("original_message") or body.get("message") or {}
        kind = EVENTS[payload["event"]]
        stamp = payload.get("timestamp") or body.get("timestamp")
        event = DeliveryEvent(kind, provider_message_id=str(message.get("message_id") or ""), email=str(message.get("to") or ""),
                              occurred_at=datetime.fromtimestamp(float(stamp), tz=timezone.utc) if stamp else None,
                              reason=str(body.get("details") or body.get("output") or "")[:200], url=str(body.get("url") or ""),
                              ip_address=body.get("ip_address") or None, user_agent=str(body.get("user_agent") or ""), raw=payload)
        if kind is EventType.BOUNCED:
            # MessageBounced = a bounce message came back (hard). MessageDeliveryFailed = Postal gave up: hard unless it says soft.
            event.bounce_type = "SOFT" if str(body.get("status", "")).lower() == "softfail" else "HARD"
        return [event]
