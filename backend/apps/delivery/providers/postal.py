"""Postal (self-hosted mail delivery platform, https://docs.postalserver.io).

Send:     POST {endpoint}/api/v1/send/message      header X-Server-API-Key, JSON body, one recipient per call
          -> {"status": "success", "data": {"message_id": "...", "messages": {"<rcpt>": {"id": 1, "token": "..."}}}}
          Postal answers HTTP 200 for application errors too: {"status": "parameter-error" | "error", "data": {"code", "message"}}
Webhooks: {"event": "MessageSent", "timestamp": 1.0, "payload": {"message": {"message_id", "to", "tag", ...}, "details", ...}}
          signed with the installation's RSA key: header X-Postal-Signature = base64(RSA-SHA1(raw body)).
"""
import base64
import json
from datetime import datetime, timezone

import requests

from .base import ConfigField, DeliveryEvent, EmailMessage, EmailProvider, EventType, ProviderError, SendResult
from .registry import register

FATAL_CODES = {"InvalidServerAPIKey", "ServerSuspended", "AccessDenied"}                  # nothing will go out until someone fixes the provider
EVENTS = {"MessageSent": EventType.DELIVERED, "MessageDelayed": EventType.DEFERRED, "MessageDeliveryFailed": EventType.BOUNCED,
          "MessageBounced": EventType.BOUNCED, "MessageHeld": EventType.DROPPED, "MessageLoaded": EventType.OPENED, "MessageLinkClicked": EventType.CLICKED}


TAG_MAX = 250                                                # Postal's tag column is a short string
# what a Postal message carries, so a callback comes back self-describing: our execution row first, then who and why
TAG_KEYS = (("x", "cep_execution"), ("c", "cep_campaign"), ("u", "cep_purpose"), ("p", "cep_party"), ("n", "cep_receipt"), ("s", "cep_store"),
            ("r", "cep_run"), ("t", "cep_tenant"))


def tag_for(message: EmailMessage) -> str | None:
    """The tag map as compact JSON; the least useful keys are dropped from the end until it fits. A message with no
    metadata keeps its plain campaign code."""
    pairs = [(short, str(message.metadata[long])) for short, long in TAG_KEYS if message.metadata.get(long)]
    if not pairs:
        return message.tag or None
    while pairs:
        text = json.dumps(dict(pairs), separators=(",", ":"))
        if len(text) <= TAG_MAX:
            return text
        pairs.pop()
    return message.tag or None


def read_tag(value) -> dict:
    """The tag map back from a callback: JSON with our keys, or nothing for a plain tag."""
    if not isinstance(value, str) or not value.startswith("{"):
        return {}
    try:
        found = json.loads(value)
    except ValueError:
        return {}
    return found if isinstance(found, dict) else {}


@register
class PostalProvider(EmailProvider):
    provider_type = "POSTAL"
    label = "Postal"
    description = "Self-hosted Postal server. Delivery, bounce, open and click callbacks through webhooks."
    supports_webhooks = True
    config_fields = (
        ConfigField("endpoint", "Postal address", kind="url", placeholder="https://postal.example.com", help="Base address of your Postal installation."),
        ConfigField("api_key", "Server API key", secret=True, help="Postal -> your mail server -> Credentials -> type API. Carries campaigns (and everything else until a transactional key is set)."),
        ConfigField("transactional_api_key", "Transactional server API key", required=False, secret=True, credential="transactional_secret",
                    help="Optional. The API key of a second Postal mail server for receipts and other transactional email: they never queue behind a campaign "
                         "and each server keeps its own sending reputation. Both servers use the same callback address."),
        ConfigField("webhook_public_key", "Webhook public key", required=False, kind="textarea",
                    help="Optional. PEM public key of the Postal installation (postal default-dkim-record): webhook signatures are then verified."),
    )

    def open(self) -> None:
        self._session = self.new_session()
        self._session.headers.update({"Content-Type": "application/json"})

    def close(self) -> None:
        session = getattr(self, "_session", None)
        if session is not None:
            session.close()
            self._session = None

    def _post(self, path: str, body: dict, key: str | None = None):
        if getattr(self, "_session", None) is None:
            self.open()
        return self._session.post(str(self.config.get("endpoint", "")).rstrip("/") + path, json=body, timeout=20,
                                  headers={"X-Server-API-Key": key if key is not None else self.secret or ""})

    def send(self, message: EmailMessage) -> SendResult:
        body = {"to": [message.to_email], "from": message.sender, "subject": message.subject, "html_body": message.html, "plain_body": message.text,
                "tag": tag_for(message), "reply_to": message.reply_to, "headers": {**message.headers, "X-CEP-Id": message.idempotency_key},
                "attachments": [{"name": a.name, "content_type": a.content_type, "data": base64.b64encode(a.data).decode()} for a in message.attachments] or None}
        try:
            response = self._post("/api/v1/send/message", {k: v for k, v in body.items() if v not in (None, "")}, key=self.secret_for(message))
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
        """An empty send is answered with a parameter error when the key is good, and with InvalidServerAPIKey when it is not.
        Both keys are tried when two are set."""
        keys = [("server API key", self.secret)] + ([("transactional server API key", self.transactional_secret)] if self.transactional_secret else [])
        problems = []
        try:
            for label, key in keys:
                try:
                    answer = self._post("/api/v1/send/message", {}, key=key or "").json()
                except (requests.RequestException, ValueError) as exc:
                    return False, f"Cannot reach Postal: {exc.__class__.__name__}: {exc}"
                code = str((answer.get("data") or {}).get("code") or "")
                if code in FATAL_CODES:
                    problems.append(f"Postal refused the {label} ({code}).")
        finally:
            self.close()
        if problems:
            return False, " ".join(problems)
        return True, "Both keys work." if len(keys) == 2 else ""

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
        tag = read_tag(message.get("tag"))
        stamp = payload.get("timestamp") or body.get("timestamp")
        event = DeliveryEvent(kind, provider_message_id=str(message.get("message_id") or ""), email=str(message.get("to") or ""),
                              occurred_at=datetime.fromtimestamp(float(stamp), tz=timezone.utc) if stamp else None,
                              reason=str(body.get("details") or body.get("output") or "")[:200], url=str(body.get("url") or ""),
                              ip_address=body.get("ip_address") or None, user_agent=str(body.get("user_agent") or ""), raw=payload,
                              execution_id=int(tag["x"]) if str(tag.get("x") or "").isdigit() else None, tag=tag)
        if kind is EventType.BOUNCED:
            # MessageBounced = a bounce message came back (hard). MessageDeliveryFailed = Postal gave up: hard unless it says soft.
            event.bounce_type = "SOFT" if str(body.get("status", "")).lower() == "softfail" else "HARD"
        return [event]
