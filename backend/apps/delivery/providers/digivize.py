"""Digivize External SMS/MMS API (https://lab.digivize.ai/api/v1/external/sms/...).

Written from Digivize's Postman documentation (documenter.getpostman.com/view/2956319/2sBYAsyXk4, "External SMS/MMS
API"). Every call carries X-Api-Key, X-Timestamp (unix seconds, within 5 minutes of their clock) and X-Signature, an
HMAC-SHA256 with the secret key. The documentation shows the header scheme but not the string that is signed for a
JSON request (the query-string form it documents is for the other API groups), and its examples carry one signature
for every SMS request of the same timestamp, whatever the body. So the adapter knows the plausible forms and the Check
button finds the one Digivize accepts: it asks for the status of a made-up tracking id with each form until the answer
is not "invalid signature", then remembers the form on the engine (`signature_scheme`). A form can also be typed in.

    send:      POST sms/send   {to, message | trigger_slug, variables, media_urls, callback_url, store_number}
               -> data.tracking_id (their message id), status queued; 60 requests per minute per API key
    receipts:  the webhook registered with Digivize posts {event, timestamp, data: {tracking_id, to, status, error_code}}
               events sms.delivered, sms.failed (undelivered / expired / failed), sms.opted_out
    inbound:   Digivize has no free-text reply webhook; STOP / START are reported as sms.opted_out (blocked here)
"""
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone

import requests

from .base import ConfigField, DeliveryEvent, EventType, InboundMessage, ProviderError, SendResult, SmsMessage, SmsProvider
from .registry import register

DEFAULT_ENDPOINT = "https://lab.digivize.ai"
BASE_PATH = "/api/v1/external"

# what Digivize may be signing, tried in this order by Check; each takes (timestamp, api_key, method, path, body) -> the string
SCHEMES = {
    "timestamp": lambda ts, key, method, path, body: ts,
    "key_timestamp": lambda ts, key, method, path, body: key + ts,
    "timestamp_key": lambda ts, key, method, path, body: ts + key,
    "timestamp_body": lambda ts, key, method, path, body: ts + body,
    "canonical": lambda ts, key, method, path, body: "\n".join([ts, method, path, body]),
    "key_timestamp_body": lambda ts, key, method, path, body: key + ts + body,
}

# failed / undelivered reasons that mean the number can never receive: the number is blocked for the next run
PERMANENT = {"invalid_number", "landline", "blocked", "opted_out", "suppressed", "unsubscribed", "deactivated", "unreachable"}
EVENTS = {"sms.delivered": EventType.DELIVERED, "sms.failed": EventType.BOUNCED, "sms.undelivered": EventType.BOUNCED, "sms.expired": EventType.BOUNCED,
          "sms.opted_out": EventType.BOUNCED}


@register
class DigivizeProvider(SmsProvider):
    provider_type = "DIGIVIZE"
    label = "Digivize"
    description = "Digivize SMS / MMS aggregator over its External API. Delivery receipts through a webhook registered with Digivize."
    supports_webhooks = True
    supports_mms = True
    default_rate_limit_per_minute = 60                       # Digivize's own limit per API key
    config_fields = (
        ConfigField("endpoint", "API address", kind="url", placeholder=DEFAULT_ENDPOINT, required=False,
                    help=f"Leave empty for {DEFAULT_ENDPOINT}. Digivize's sandbox has its own address."),
        ConfigField("api_key", "API key", help="The X-Api-Key Digivize gave you (sk_...). It identifies the account; the secret key below signs each call."),
        ConfigField("secret_key", "Secret key", secret=True, help="Signs every call (HMAC-SHA256). Never shown again once saved."),
        ConfigField("store_number", "Store number", required=False, help="Optional. Sent with every message for Digivize's own tracking."),
        ConfigField("callback_url", "Callback address to send", required=False, kind="url",
                    help="Optional. Paste this engine's callback address (Copy webhook URL on its row): Digivize then posts delivery receipts there per message. "
                         "Registering the address once with Digivize (their webhooks endpoint) does the same for every message."),
        ConfigField("webhook_secret", "Webhook secret", required=False,
                    help="Optional. The secret you gave Digivize for the webhook: receipts are then verified (X-Signature over the body). Empty: the callback address's own token is the check."),
        ConfigField("signature_scheme", "Signature form", required=False, placeholder="found by Check",
                    help="What the HMAC signs. Leave empty: Check tries the known forms and keeps the one Digivize accepts. Forms: " + ", ".join(SCHEMES)),
    )

    # ---- calls
    @property
    def _base(self) -> str:
        return str(self.config.get("endpoint") or DEFAULT_ENDPOINT).rstrip("/") + BASE_PATH

    def open(self) -> None:
        self._session = self.new_session()
        self._session.headers.update({"Content-Type": "application/json", "Accept": "application/json"})

    def close(self) -> None:
        session = getattr(self, "_session", None)
        if session is not None:
            session.close()
            self._session = None

    def _signature(self, scheme: str, timestamp: str, method: str, path: str, body: str) -> str:
        canonical = SCHEMES[scheme](timestamp, str(self.config.get("api_key") or ""), method.upper(), path, body)
        return hmac.new((self.secret or "").encode(), canonical.encode(), hashlib.sha256).hexdigest()

    def _request(self, method: str, path: str, body: dict | None = None, scheme: str | None = None):
        """One signed call. `path` is under /api/v1/external; the body is sent exactly as signed."""
        if getattr(self, "_session", None) is None:
            self.open()
        scheme = scheme or str(self.config.get("signature_scheme") or "").strip() or next(iter(SCHEMES))
        if scheme not in SCHEMES:
            raise ProviderError(f"Digivize: unknown signature form '{scheme}'. Leave the field empty and use Check.", retryable=False)
        timestamp = str(int(time.time()))
        text = json.dumps(body, separators=(",", ":"), ensure_ascii=False) if body is not None else ""
        headers = {"X-Api-Key": str(self.config.get("api_key") or ""), "X-Timestamp": timestamp,
                   "X-Signature": self._signature(scheme, timestamp, method, BASE_PATH + path, text)}
        return self._session.request(method.upper(), self._base + path, data=text.encode() if text else None, headers=headers, timeout=20)

    @staticmethod
    def _answer(response) -> dict:
        try:
            data = response.json()
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _refused(response, answer: dict) -> bool:
        """401 / 403, or Digivize's own wording for a bad key or signature."""
        text = str(answer.get("error") or "").lower()
        return response.status_code in (401, 403) or "signature" in text or "api key" in text

    # ---- sending
    def send(self, message: SmsMessage) -> SendResult:
        body = {"to": message.to_number, "message": message.text}
        if message.media_url:
            body["media_urls"] = [message.media_url]
        if self.config.get("store_number"):
            body["store_number"] = str(self.config["store_number"])
        if self.config.get("callback_url"):
            body["callback_url"] = str(self.config["callback_url"])
        if message.idempotency_key:
            body["variables"] = {"cep_id": message.idempotency_key}
        try:
            response = self._request("POST", "/sms/send", body)
        except requests.RequestException as exc:
            return SendResult.retry(f"{exc.__class__.__name__}: {exc}")
        answer = self._answer(response)
        if response.status_code == 429 or response.status_code >= 500:
            return SendResult.retry(f"Digivize answered HTTP {response.status_code}: {answer.get('error') or ''}".strip(": "))
        if self._refused(response, answer):
            raise ProviderError(f"Digivize refused the API key or the signature: {answer.get('error') or response.status_code}. Use Check on the engine.", retryable=False)
        data = answer.get("data") or {}
        if answer.get("success") and data.get("tracking_id"):
            return SendResult.accepted(str(data["tracking_id"]))
        reason = str(answer.get("error") or data.get("status") or f"HTTP {response.status_code}")
        return SendResult.rejected(reason)

    # ---- the Check button: which form does Digivize sign?
    def check(self) -> tuple[bool, str]:
        if not self.config.get("api_key") or not self.secret:
            return False, "Enter the API key and the secret key first."
        probe = f"/sms/status/{uuid.uuid4()}"
        chosen = str(self.config.get("signature_scheme") or "").strip()
        candidates = [chosen] if chosen else list(SCHEMES)
        if chosen and chosen not in SCHEMES:
            return False, f"Unknown signature form '{chosen}'. Leave it empty and check again."
        try:
            for scheme in candidates:
                try:
                    response = self._request("GET", probe, scheme=scheme)
                except requests.RequestException as exc:
                    return False, f"Cannot reach Digivize: {exc.__class__.__name__}: {exc}"
                answer = self._answer(response)
                if self._refused(response, answer):
                    continue
                if response.status_code >= 500:
                    return False, f"Digivize answered HTTP {response.status_code}."
                self.detected_config = {"signature_scheme": scheme}          # the check endpoint stores it on the engine
                return True, ("" if chosen else f"Signature form: {scheme}.")
        finally:
            self.close()
        return False, ("Digivize refused the API key or the signature." if chosen else
                       "Digivize refused every known signature form: check the API key and the secret key, or ask Digivize what the signature signs.")

    # ---- what comes back
    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        secret = str(self.config.get("webhook_secret") or "").strip()
        if not secret:
            return True                                     # the URL token is the only check
        given = headers.get("x-signature") or headers.get("x-webhook-signature") or headers.get("x-digivize-signature") or ""
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(given.strip().lower(), expected)

    @staticmethod
    def _items(payload) -> list[dict]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            if isinstance(payload.get("events"), list):
                return [item for item in payload["events"] if isinstance(item, dict)]
            return [payload]
        return []

    def parse_webhook(self, payload) -> list[DeliveryEvent]:
        out = []
        for item in self._items(payload):
            name = str(item.get("event") or item.get("type") or "").lower()
            data = item.get("data") if isinstance(item.get("data"), dict) else item
            status = str(data.get("status") or "").lower()
            kind = EVENTS.get(name)
            if kind is None:                                # a status-only callback (callback_url form): read the status
                kind = EventType.DELIVERED if status == "delivered" else EventType.BOUNCED if status in ("failed", "undelivered", "expired") else None
            if kind is None:
                continue
            code = str(data.get("error_code") or data.get("reason") or "").lower()
            stamp = item.get("timestamp") or data.get("delivered_at") or data.get("failed_at")
            variables = data.get("variables") if isinstance(data.get("variables"), dict) else {}
            event = DeliveryEvent(kind, provider_message_id=str(data.get("tracking_id") or data.get("message_id") or ""),
                                  idempotency_key=str(variables.get("cep_id") or ""), reason=(code or status or name)[:200], occurred_at=_when(stamp), raw=item)
            if kind is EventType.BOUNCED:
                opted_out = name == "sms.opted_out"
                event.bounce_type = "HARD" if opted_out or code in PERMANENT else "SOFT"
                if opted_out:
                    event.reason = "opted_out"
            out.append(event)
        return out

    def parse_inbound(self, payload) -> list[InboundMessage]:
        """Digivize does not forward free-text replies; a STOP is reported as sms.opted_out and handled by parse_webhook."""
        return []


def _when(value) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)) or str(value).isdigit():
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, OverflowError, OSError):
        return None
