"""Digivize External SMS API, signed the way Digivize's own Postman pre-request script signs it.

    POST {endpoint}{send_path}?key=<api key>&timestamp=<unix seconds>&signature=<hex>
         single (the default; what /api/v1/external/sms/send serves, 2026-10-02 on citi-sandbox and lab):
                 {brand_id, to, message, message_type, external_ref, idempotency_key, variable_normalization, callback_url}
         batch (send_mode = batch, for the batch route when Digivize provides it; it did not exist on either host):
                 {brand_id, message, message_type, recipients: [{to, variables, external_ref}], variable_normalization, auto_create_contacts, idempotency_key, callback_url}
    signature = HMAC-SHA256(secret key, canonical) where canonical is the body plus `key` and `timestamp`, top-level keys sorted,
                serialised like PHP's http_build_query (recipients[0][to]=..., spaces as +, !'()* percent-encoded, true/false as 1/0,
                nested keys in the order they are sent), joined with &. The JSON body is written in the same key order it was signed in.

The reply and the callback shapes are not in the script; the adapter reads the plausible fields (a per-recipient list with
external_ref / to, tracking_id / message_id / id, status; a batch id) and the callback by external_ref, which carries CEP's
own message id. CEP personalises the text itself, so a batch holds every recipient of one identical text and sends no variables.
Receipts: events sms.delivered / sms.failed / sms.undelivered / sms.expired / sms.opted_out, or a status per recipient.
"""
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone
from itertools import groupby
from urllib.parse import quote, urlencode

import requests

from .base import ConfigField, DeliveryEvent, EventType, InboundMessage, ProviderError, SendResult, SmsMessage, SmsProvider
from .registry import register

DEFAULT_ENDPOINT = "https://lab.digivize.ai"
DEFAULT_SEND_PATH = "/api/v1/external/sms/send"
MESSAGE_TYPES = ("marketing", "transactional")
SEND_MODES = ("single", "batch")
VARIABLE_NORMALIZATION = "gsm7_safe"
BATCH_NAMESPACE = uuid.UUID("5a1d1e1c-0d2b-4d8e-9f0a-7c6b5a4d3e2f")

# failed / undelivered reasons that mean the number can never receive: the number is blocked for the next run
PERMANENT = {"invalid_number", "landline", "blocked", "opted_out", "suppressed", "unsubscribed", "deactivated", "unreachable"}
EVENTS = {"sms.delivered": EventType.DELIVERED, "sms.failed": EventType.BOUNCED, "sms.undelivered": EventType.BOUNCED, "sms.expired": EventType.BOUNCED,
          "sms.opted_out": EventType.BOUNCED}
FAILED_STATUSES = {"failed", "rejected", "invalid", "error", "undelivered", "blocked"}


# ---- the signature, exactly as the Postman script builds it
def php_urlencode(value) -> str:
    """encodeURIComponent, then spaces as + and !'()* percent-encoded: what PHP's urlencode produces."""
    return quote(str(value), safe="").replace("%20", "+")


def php_query(value, prefix: str = "") -> list[str]:
    """http_build_query pairs: arrays as prefix[i], objects as prefix[key], booleans as 1 / 0, nulls left out."""
    if value is None:
        return []
    if isinstance(value, bool):
        return [f"{php_urlencode(prefix)}={'1' if value else '0'}"]
    if isinstance(value, (list, tuple)):
        return [pair for index, item in enumerate(value) for pair in php_query(item, f"{prefix}[{index}]")]
    if isinstance(value, dict):
        return [pair for key, item in value.items() for pair in php_query(item, f"{prefix}[{key}]" if prefix else str(key))]
    return [f"{php_urlencode(prefix)}={php_urlencode(value)}"]


def canonical_string(payload: dict) -> str:
    """Top-level keys sorted; everything below in the order it is sent."""
    return "&".join(php_query({key: payload[key] for key in sorted(payload)}))


def signature_for(secret: str, payload: dict) -> str:
    return hmac.new((secret or "").strip().encode(), canonical_string(payload).encode(), hashlib.sha256).hexdigest()


@register
class DigivizeProvider(SmsProvider):
    provider_type = "DIGIVIZE"
    label = "Digivize"
    description = "Digivize SMS aggregator over its External API: one signed batch per identical text. Delivery receipts through the callback address."
    supports_webhooks = True
    supports_mms = True
    default_rate_limit_per_minute = 60                       # Digivize's own limit per API key; a batch is one request
    max_batch = 100
    config_fields = (
        ConfigField("endpoint", "API Address", kind="url", placeholder=DEFAULT_ENDPOINT, required=False,
                    help=f"Leave empty for {DEFAULT_ENDPOINT}. Digivize's sandbox has its own address."),
        ConfigField("send_path", "Batch Send Path", required=False, placeholder=DEFAULT_SEND_PATH,
                    help="The path of the batch request in Digivize's Postman collection, when it differs from the placeholder."),
        ConfigField("api_key", "API Key", help="Digivize's api_key: travels as the `key` query parameter and inside the signed string."),
        ConfigField("secret_key", "Secret Key", secret=True, help="Digivize's secret_key: signs every call (HMAC-SHA256). Never shown again once saved."),
        ConfigField("brand_id", "Brand ID", help="The brand's number at Digivize (brand_id), e.g. 3. A name is refused: \"The brand id field must be an integer.\""),
        ConfigField("send_mode", "Send Mode", required=False, placeholder="single",
                    help="single (the default): one request per text, the shape the sms/send route serves. batch: one request per identical text with a recipients list, "
                         "for the batch route once Digivize provides it (set the path above to it)."),
        ConfigField("message_type", "Message Type", required=False, placeholder="marketing",
                    help="marketing (the default) or transactional. Digivize applies its own rules per type."),
        ConfigField("callback_url", "Callback Address to Send", required=False, kind="url",
                    help="Optional. Paste this engine's callback address (Copy Webhook URL on its row): Digivize then posts delivery results there per batch."),
        ConfigField("webhook_secret", "Webhook Secret", required=False,
                    help="Optional. The secret you gave Digivize for the callback: results are then verified (X-Signature over the body). Empty: the callback address's own token is the check."),
    )

    # ---- calls
    @property
    def _url(self) -> str:
        base = str(self.config.get("endpoint") or DEFAULT_ENDPOINT).rstrip("/")
        path = str(self.config.get("send_path") or DEFAULT_SEND_PATH).strip()
        return base + ("/" + path.lstrip("/"))

    @property
    def _message_type(self) -> str:
        kind = str(self.config.get("message_type") or "marketing").strip().lower()
        return kind if kind in MESSAGE_TYPES else "marketing"

    @property
    def _send_mode(self) -> str:
        mode = str(self.config.get("send_mode") or "single").strip().lower()
        return mode if mode in SEND_MODES else "single"

    @property
    def _brand_id(self):
        raw = str(self.config.get("brand_id") or "").strip()
        return int(raw) if raw.isdigit() else raw

    def open(self) -> None:
        self._session = self.new_session()
        self._session.headers.update({"Content-Type": "application/json", "Accept": "application/json"})

    def close(self) -> None:
        session = getattr(self, "_session", None)
        if session is not None:
            session.close()
            self._session = None

    def _post(self, body: dict):
        """The signed batch call: auth in the query string, the body as JSON in the order it was signed."""
        if getattr(self, "_session", None) is None:
            self.open()
        key = str(self.config.get("api_key") or "")
        timestamp = str(int(time.time()))
        signature = signature_for(self.secret or "", {**body, "key": key, "timestamp": timestamp})
        url = f"{self._url}?{urlencode({'key': key, 'timestamp': timestamp, 'signature': signature})}"
        return self._session.request("POST", url, data=json.dumps(body, ensure_ascii=False).encode(), timeout=30)

    def _body(self, text: str, recipients: list[dict], *, media_url: str | None = None, batch_key: str = "") -> dict:
        body = {"brand_id": self._brand_id, "message": text, "message_type": self._message_type, "recipients": recipients,
                "variable_normalization": VARIABLE_NORMALIZATION, "auto_create_contacts": False, "idempotency_key": batch_key or f"cep-{uuid.uuid4()}"}
        if self.config.get("callback_url"):
            body["callback_url"] = str(self.config["callback_url"])
        if media_url:
            body["media_urls"] = [media_url]                  # not in Digivize's script: unconfirmed until an MMS batch is tried
        return body

    @staticmethod
    def _answer(response) -> dict:
        try:
            data = response.json()
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _error(answer: dict, response) -> str:
        for key in ("error", "message", "detail"):
            value = answer.get(key)
            if isinstance(value, dict):
                value = value.get("message") or json.dumps(value)[:160]
            if value:
                return str(value)[:200]
        errors = answer.get("errors")
        if isinstance(errors, dict):
            return "; ".join(f"{k}: {', '.join(map(str, v)) if isinstance(v, list) else v}" for k, v in errors.items())[:200]
        return f"HTTP {response.status_code}"

    @classmethod
    def _refused(cls, response, answer: dict) -> bool:
        """401 / 403, or Digivize's own wording for a bad key, signature or timestamp."""
        text = cls._error(answer, response).lower()
        return response.status_code in (401, 403) or "signature" in text or "api key" in text or "api_key" in text or "unauthori" in text or "timestamp" in text

    # ---- sending
    def send(self, message: SmsMessage) -> SendResult:
        return self.send_many([message])[0]

    def send_many(self, messages: list[SmsMessage]) -> list[SendResult]:
        """Results in order. single: one request per message. batch: one per run of identical text, at most max_batch recipients each."""
        if self._send_mode == "single":
            return [self._send_single(message) for message in messages]
        results: list[SendResult] = []
        for (text, media_url), group in groupby(messages, key=lambda m: (m.text, m.media_url)):
            items = list(group)
            for start in range(0, len(items), self.max_batch):
                results.extend(self._send_chunk(text, media_url, items[start:start + self.max_batch]))
        return results

    def _single_body(self, message: SmsMessage, ref: str) -> dict:
        body = {"brand_id": self._brand_id, "to": message.to_number, "message": message.text, "message_type": self._message_type, "external_ref": ref,
                "idempotency_key": f"cep-{uuid.uuid5(BATCH_NAMESPACE, ref)}", "variable_normalization": VARIABLE_NORMALIZATION}
        if self.config.get("callback_url"):
            body["callback_url"] = str(self.config["callback_url"])
        if message.media_url:
            body["media_urls"] = [message.media_url]
        return body

    def _send_single(self, message: SmsMessage) -> SendResult:
        ref = message.idempotency_key or f"cep-{uuid.uuid4().hex}"
        try:
            response = self._post(self._single_body(message, ref))
        except requests.RequestException as exc:
            return SendResult.retry(f"{exc.__class__.__name__}: {exc}")
        answer = self._answer(response)
        if self._refused(response, answer):
            raise ProviderError(f"Digivize refused the API key, the signature or the timestamp: {self._error(answer, response)}. Use Check on the engine.", retryable=False)
        if response.status_code == 429 or response.status_code >= 500:
            return SendResult.retry(f"Digivize answered HTTP {response.status_code}: {self._error(answer, response)}")
        if response.status_code >= 400 or answer.get("success") is False:
            return SendResult.rejected(self._error(answer, response))
        data = answer.get("data") if isinstance(answer.get("data"), dict) else answer
        status = str(data.get("status") or "").lower()
        if status in FAILED_STATUSES or data.get("error_code"):
            return SendResult.rejected(str(data.get("error") or data.get("error_code") or status)[:200])
        return SendResult.accepted(str(data.get("tracking_id") or data.get("message_id") or data.get("id") or ""))

    def _send_chunk(self, text: str, media_url: str | None, chunk: list[SmsMessage]) -> list[SendResult]:
        refs = [m.idempotency_key or f"cep-{uuid.uuid4().hex}" for m in chunk]
        recipients = [{"to": m.to_number, "variables": {}, "external_ref": ref} for m, ref in zip(chunk, refs)]
        batch_key = f"cep-{uuid.uuid5(BATCH_NAMESPACE, '|'.join(refs))}"                     # the same recipients again = the same batch, not a second send
        try:
            response = self._post(self._body(text, recipients, media_url=media_url, batch_key=batch_key))
        except requests.RequestException as exc:
            return [SendResult.retry(f"{exc.__class__.__name__}: {exc}")] * len(chunk)
        answer = self._answer(response)
        if self._refused(response, answer):
            raise ProviderError(f"Digivize refused the API key, the signature or the timestamp: {self._error(answer, response)}. Use Check on the engine.", retryable=False)
        if response.status_code == 429 or response.status_code >= 500:
            return [SendResult.retry(f"Digivize answered HTTP {response.status_code}: {self._error(answer, response)}")] * len(chunk)
        if response.status_code >= 400 or answer.get("success") is False:
            return [SendResult.rejected(self._error(answer, response))] * len(chunk)
        data = answer.get("data") if isinstance(answer.get("data"), dict) else answer
        batch_id = str(data.get("batch_id") or data.get("tracking_id") or data.get("id") or "")
        per_recipient = self._per_recipient(data, answer)
        out = []
        for m, ref in zip(chunk, refs):
            item = per_recipient.get(ref) or per_recipient.get(m.to_number)
            if item is None:
                out.append(SendResult.accepted(batch_id))
                continue
            status = str(item.get("status") or "").lower()
            own_id = str(item.get("tracking_id") or item.get("message_id") or item.get("id") or batch_id)
            if status in FAILED_STATUSES or item.get("error") or item.get("error_code"):
                out.append(SendResult.rejected(str(item.get("error") or item.get("error_code") or status)[:200]))
            else:
                out.append(SendResult.accepted(own_id))
        return out

    @staticmethod
    def _per_recipient(data: dict, answer: dict) -> dict[str, dict]:
        """Whatever list the reply carries per recipient, keyed by external_ref and by number."""
        rows = None
        for source in (data, answer):
            for key in ("recipients", "messages", "results", "items"):
                if isinstance(source.get(key), list):
                    rows = source[key]
                    break
            if rows is not None:
                break
        found: dict[str, dict] = {}
        for item in rows or []:
            if isinstance(item, dict):
                for key in (item.get("external_ref"), item.get("to")):
                    if key:
                        found[str(key)] = item
        return found

    # ---- the Check button: an empty batch proves the key, the secret and the path without sending anything
    def check(self) -> tuple[bool, str]:
        if not self.config.get("api_key") or not self.secret:
            return False, "Enter the API key and the secret key first."
        if not str(self.config.get("brand_id") or "").strip():
            return False, "Enter the brand ID first."
        try:
            # an empty batch (batch mode) or a body with no number (single mode): Digivize validates it and sends nothing
            probe = (self._body("CEP connection check", [], batch_key=f"cep-check-{uuid.uuid4()}") if self._send_mode == "batch"
                     else {k: v for k, v in self._single_body(SmsMessage(to_number="", from_sender="", text="CEP connection check"), f"cep-check-{uuid.uuid4().hex[:8]}").items() if k != "to"})
            response = self._post(probe)
        except requests.RequestException as exc:
            return False, f"Cannot reach Digivize: {exc.__class__.__name__}: {exc}"
        finally:
            self.close()
        answer = self._answer(response)
        if self._refused(response, answer):
            return False, f"Digivize refused the API key or the signature: {self._error(answer, response)}"
        if response.status_code == 404:
            return False, "Digivize knows no such path. Set the batch send path from the Postman request."
        if response.status_code >= 500:
            return False, f"Digivize answered HTTP {response.status_code}."
        if response.status_code >= 400:
            return True, f"The key and the signature are accepted; Digivize validated the request ({self._error(answer, response)})."
        return True, ""

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
        """Every per-recipient record: a list, {events: [...]}, one event, or a batch callback with data.recipients[]."""
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if not isinstance(payload, dict):
            return []
        if isinstance(payload.get("events"), list):
            return [item for item in payload["events"] if isinstance(item, dict)]
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        rows = next((data[key] for key in ("recipients", "messages", "results") if isinstance(data.get(key), list)), None)
        if rows is not None:
            head = {k: v for k, v in payload.items() if k != "data"} | {k: v for k, v in data.items() if not isinstance(v, list)}
            return [{**head, "data": {**{k: v for k, v in data.items() if not isinstance(v, list)}, **row}} for row in rows if isinstance(row, dict)]
        return [payload]

    def parse_webhook(self, payload) -> list[DeliveryEvent]:
        out = []
        for item in self._items(payload):
            name = str(item.get("event") or item.get("type") or "").lower()
            data = item.get("data") if isinstance(item.get("data"), dict) else item
            status = str(data.get("status") or "").lower()
            kind = EVENTS.get(name)
            if kind is None:                                # a status-only record: read the status
                kind = (EventType.DELIVERED if status == "delivered" else EventType.BOUNCED if status in ("failed", "undelivered", "expired", "opted_out") else None)
            if kind is None:
                continue
            code = str(data.get("error_code") or data.get("reason") or data.get("error") or "").lower()
            stamp = item.get("timestamp") or data.get("timestamp") or data.get("delivered_at") or data.get("failed_at")
            variables = data.get("variables") if isinstance(data.get("variables"), dict) else {}
            event = DeliveryEvent(kind, provider_message_id=str(data.get("tracking_id") or data.get("message_id") or data.get("id") or ""),
                                  idempotency_key=str(data.get("external_ref") or variables.get("cep_id") or ""), email=str(data.get("to") or ""),
                                  reason=(code or status or name)[:200], occurred_at=_when(stamp), raw=item)
            if kind is EventType.BOUNCED:
                opted_out = name == "sms.opted_out" or status == "opted_out" or code == "opted_out"
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
