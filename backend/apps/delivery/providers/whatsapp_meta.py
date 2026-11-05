"""WhatsApp through Meta's WhatsApp Business Platform (Cloud API), with the workspace's own Meta business account.

    POST {graph}/{version}/{phone number id}/messages          one template message: {"messaging_product": "whatsapp", "to", "type": "template", ...}
    GET  {graph}/{version}/{phone number id}?fields=...         the check: display number, verified name, quality rating, daily limit
    GET  {graph}/{version}/{business account id}/message_templates     the account's templates (Sync)
    POST {graph}/{version}/{business account id}/message_templates     a new template for review (Submit to Meta)
    POST {graph}/{version}/{app id}/uploads + POST {upload id}  a sample picture or document for a media header's review

Authorisation is a permanent system-user token (Bearer). A business may start a conversation only with a template Meta has
approved, so every message is a template with its values; free-form messages need the person to have written in the last
24 hours and are not sent by campaigns.

Callbacks (the app's webhook, fields "messages" and "message_template_status_update"): statuses sent / delivered / read /
failed per message (wamid), messages people send (a STOP, a quick-reply tap), template reviews and quality changes. Meta signs
the body with the app secret (X-Hub-Signature-256); before it sends any, it checks the address with a GET handshake that
must echo hub.challenge when hub.verify_token is the address's own token.
"""
import hashlib
import hmac
import re
from datetime import datetime, timezone

import requests

from .base import ConfigField, DeliveryEvent, EventType, InboundMessage, ProviderError, SendResult, WhatsAppMessage, WhatsAppProvider
from .registry import register

GRAPH = "https://graph.facebook.com"
DEFAULT_VERSION = "v23.0"
LIMITS = {"TIER_50": 50, "TIER_250": 250, "TIER_1K": 1000, "TIER_2K": 2000, "TIER_10K": 10000, "TIER_100K": 100000}
QUALITY = {"GREEN": "High", "YELLOW": "Medium", "RED": "Low", "UNKNOWN": "Not Rated Yet"}

# Meta's error codes (developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)
TOKEN_ERRORS = {0, 3, 10, 190, 200}                             # authentication, capability and permission: the token, not the message
RATE_LIMITS = {4, 80007, 130429, 131056}
TEMPLATE_ERRORS = {132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069}
REASONS = {
    131026: "Not a WhatsApp number, or it cannot receive this message",
    131049: "Meta held it back: this person has had their share of marketing messages for now",
    131047: "More than 24 hours since the person last wrote: only a template can be sent",
    131050: "The person stopped marketing messages from this business in WhatsApp",
    131051: "WhatsApp does not support this kind of message",
    131021: "The number is the business's own",
    131042: "Meta could not charge the business account: check its payment method",
    131031: "Meta locked the business account",
    132000: "The values do not match the template's variables",
    132001: "Meta has no approved template of this name and language",
    132012: "A value does not have the format the template asks for",
    132015: "Meta paused this template for low quality",
    132016: "Meta disabled this template",
}
STATUS_EVENTS = {"delivered": EventType.DELIVERED, "read": EventType.OPENED, "failed": EventType.DROPPED}
TEMPLATE_STATUSES = {"APPROVED": "APPROVED", "REJECTED": "REJECTED", "PENDING": "PENDING", "IN_APPEAL": "PENDING", "PAUSED": "PAUSED",
                     "DISABLED": "DISABLED", "FLAGGED": "APPROVED", "REINSTATED": "APPROVED", "PENDING_DELETION": "DISABLED", "DELETED": "DISABLED",
                     "LIMIT_EXCEEDED": "REJECTED", "ARCHIVED": "DISABLED"}


def digits(number: str) -> str:
    return re.sub(r"\D", "", number or "")


def reason_of(error: dict) -> tuple[int | None, str]:
    """-> (Meta's code, a sentence a person can act on) for one of Meta's error objects."""
    code = error.get("code")
    try:
        code = int(code) if code is not None else None
    except (TypeError, ValueError):
        code = None
    detail = ((error.get("error_data") or {}).get("details") or error.get("message") or error.get("title") or "").strip()
    words = REASONS.get(code) or detail or "Meta refused the message"
    return code, f"{words} (Meta {code})" if code is not None else words


def _when(stamp) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(stamp), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


@register
class WhatsAppMetaProvider(WhatsAppProvider):
    provider_type = "WHATSAPP_META"
    label = "WhatsApp (Meta)"
    description = ("WhatsApp through Meta's WhatsApp Business API, with your own Meta business account. Sends templates Meta has approved; "
                   "delivered, read and failed come back through the callback address.")
    supports_webhooks = True
    max_batch = 80
    default_rate_limit_per_minute = 4800                   # Meta's own pace for a number: 80 messages a second
    config_fields = (
        ConfigField("waba_id", "WhatsApp Business Account ID", help="Meta Business Settings → Accounts → WhatsApp Accounts, or WhatsApp Manager → Account Tools.",
                    placeholder="104883925517204"),
        ConfigField("phone_number_id", "Phone Number ID", help="WhatsApp Manager → Phone Numbers: the ID of the number, not the number itself.",
                    placeholder="118204576330981"),
        ConfigField("access_token", "Access Token", secret=True,
                    help="A permanent system-user token from Meta Business Settings → System Users, with whatsapp_business_messaging and whatsapp_business_management. Stored encrypted."),
        ConfigField("app_secret", "App Secret", required=False, secret=True, credential="transactional_secret",
                    help="Your Meta app's secret (App Settings → Basic). CEP uses it to prove a callback came from Meta. Stored encrypted."),
        ConfigField("app_id", "App ID", required=False, placeholder="1234567890123456",
                    help="Needed only to submit a template with a picture or document header: Meta reviews it with a sample file."),
        ConfigField("api_version", "Graph API Version", required=False, placeholder=DEFAULT_VERSION, help=f"Leave empty for {DEFAULT_VERSION}."),
    )

    # ---- the HTTP session
    def open(self) -> None:
        if not self.secret:
            raise ProviderError("Enter the access token first.", retryable=False)
        self._session = self.new_session()
        self._session.headers.update({"Authorization": f"Bearer {self.secret.strip()}", "Content-Type": "application/json"})

    def close(self) -> None:
        session = getattr(self, "_session", None)
        if session is not None:
            session.close()
            self._session = None

    def _url(self, path: str) -> str:
        version = str(self.config.get("api_version") or "").strip() or DEFAULT_VERSION
        return f"{GRAPH}/{version}/{path.lstrip('/')}"

    def _call(self, method: str, path: str, **kwargs):
        if getattr(self, "_session", None) is None:
            self.open()
        return self._session.request(method, self._url(path), timeout=30, **kwargs)

    @staticmethod
    def _error(response) -> dict:
        try:
            body = response.json()
        except ValueError:
            return {"message": f"HTTP {response.status_code}"}
        return (body or {}).get("error") or {"message": f"HTTP {response.status_code}"}

    def _raise_for_account(self, response) -> None:
        """A refused token or account stops everything: no message of the batch can go."""
        error = self._error(response)
        code, words = reason_of(error)
        if response.status_code in (401, 403) or code in TOKEN_ERRORS:
            raise ProviderError(f"Meta refused the access token: {error.get('message') or words}", retryable=False)

    # ---- sending
    def payload(self, message: WhatsAppMessage) -> dict:
        components = []
        if message.header_type in ("IMAGE", "DOCUMENT", "VIDEO") and message.header_link:
            kind = message.header_type.lower()
            media = {"link": message.header_link, **({"filename": message.header_filename} if kind == "document" and message.header_filename else {})}
            components.append({"type": "header", "parameters": [{"type": kind, kind: media}]})
        if message.body_values:
            components.append({"type": "body", "parameters": [{"type": "text", "text": value} for value in message.body_values]})
        return {"messaging_product": "whatsapp", "recipient_type": "individual", "to": digits(message.to_number), "type": "template",
                "biz_opaque_callback_data": message.idempotency_key[:512],
                "template": {"name": message.template_name, "language": {"code": message.language}, **({"components": components} if components else {})}}

    def send(self, message: WhatsAppMessage) -> SendResult:
        if not str(self.config.get("phone_number_id") or "").strip():
            raise ProviderError("Enter the phone number ID first.", retryable=False)
        try:
            response = self._call("POST", f"{self.config['phone_number_id'].strip()}/messages", json=self.payload(message))
        except requests.RequestException as exc:
            return SendResult.retry(f"Cannot reach Meta: {exc.__class__.__name__}")
        if response.status_code < 300:
            sent = ((response.json() or {}).get("messages") or [{}])[0]
            return SendResult.accepted(str(sent.get("id") or ""))
        self._raise_for_account(response)
        code, words = reason_of(self._error(response))
        if code in TEMPLATE_ERRORS - {132000, 132012}:
            raise ProviderError(f"{words}. Check the template in Templates → WhatsApp.", retryable=False)
        if code in RATE_LIMITS or response.status_code == 429 or response.status_code >= 500 or code in (1, 2, 131000):
            return SendResult.retry(words)
        return SendResult.rejected(words)

    # ---- the check
    def check(self) -> tuple[bool, str]:
        for key, label in (("waba_id", "the WhatsApp business account ID"), ("phone_number_id", "the phone number ID")):
            if not str(self.config.get(key) or "").strip():
                return False, f"Enter {label} first."
        if not self.secret:
            return False, "Enter the access token first."
        try:
            response = self._call("GET", self.config["phone_number_id"].strip(),
                                  params={"fields": "display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status,code_verification_status"})
        except requests.RequestException as exc:
            return False, f"Cannot reach Meta: {exc.__class__.__name__}: {exc}"
        finally:
            self.close()
        if response.status_code >= 300:
            error = self._error(response)
            return False, f"Meta refused it: {error.get('message') or reason_of(error)[1]}"
        number = response.json() or {}
        limit = LIMITS.get(str(number.get("messaging_limit_tier") or ""))
        self.detected_config = {"wa_display_number": number.get("display_phone_number"), "wa_verified_name": number.get("verified_name"),
                                "wa_quality": number.get("quality_rating"), "wa_limit": limit, "wa_name_status": number.get("name_status")}
        quality = QUALITY.get(str(number.get("quality_rating") or ""), "Not Rated Yet")
        return True, " · ".join(part for part in (number.get("display_phone_number"), number.get("verified_name"), f"Quality {quality}",
                                                    f"{limit:,} people a day" if limit else "Unlimited" if number.get("messaging_limit_tier") == "TIER_UNLIMITED" else None) if part)

    # ---- templates
    def list_templates(self) -> list[dict]:
        """Every template of the business account, as Meta describes it."""
        found, after = [], None
        try:
            while True:
                params = {"fields": "id,name,language,status,category,components,rejected_reason,quality_score", "limit": 100, **({"after": after} if after else {})}
                response = self._call("GET", f"{self.config['waba_id'].strip()}/message_templates", params=params)
                if response.status_code >= 300:
                    self._raise_for_account(response)
                    raise ProviderError(f"Meta did not list the templates: {reason_of(self._error(response))[1]}")
                body = response.json() or {}
                found.extend(body.get("data") or [])
                after = ((body.get("paging") or {}).get("cursors") or {}).get("after") if (body.get("paging") or {}).get("next") else None
                if not after or len(found) >= 2000:
                    return found
        except requests.RequestException as exc:
            raise ProviderError(f"Cannot reach Meta: {exc.__class__.__name__}") from None

    def create_template(self, definition: dict) -> dict:
        """-> {"id", "status", "category"} of the submitted template, or ProviderError with Meta's reason."""
        try:
            response = self._call("POST", f"{self.config['waba_id'].strip()}/message_templates", json=definition)
        except requests.RequestException as exc:
            raise ProviderError(f"Cannot reach Meta: {exc.__class__.__name__}") from None
        if response.status_code >= 300:
            self._raise_for_account(response)
            error = self._error(response)
            raise ProviderError(error.get("error_user_msg") or error.get("message") or reason_of(error)[1], retryable=False)
        return response.json() or {}

    def edit_template(self, meta_template_id: str, definition: dict) -> dict:
        """A rejected (or paused) template changed and sent for review again; Meta keeps its name and language."""
        try:
            response = self._call("POST", meta_template_id, json={key: definition[key] for key in ("category", "components") if key in definition})
        except requests.RequestException as exc:
            raise ProviderError(f"Cannot reach Meta: {exc.__class__.__name__}") from None
        if response.status_code >= 300:
            self._raise_for_account(response)
            error = self._error(response)
            raise ProviderError(error.get("error_user_msg") or error.get("message") or reason_of(error)[1], retryable=False)
        return {"id": meta_template_id, "status": "PENDING", **{k: v for k, v in (response.json() or {}).items() if k in ("status", "category")}}

    def upload_sample(self, data: bytes, mime_type: str, file_name: str) -> str:
        """Meta's handle of a sample file, for a media header's review (the Resumable Upload API of the app)."""
        app_id = str(self.config.get("app_id") or "").strip()
        if not app_id:
            raise ProviderError("Enter the App ID under Settings → Delivery: Meta reviews a picture or document header with a sample file.", retryable=False)
        try:
            start = self._call("POST", f"{app_id}/uploads", params={"file_name": file_name, "file_length": len(data), "file_type": mime_type})
            if start.status_code >= 300:
                self._raise_for_account(start)
                raise ProviderError(f"Meta refused the sample file: {reason_of(self._error(start))[1]}", retryable=False)
            upload = self._session.request("POST", self._url(str(start.json()["id"])), data=data, timeout=60,
                                           headers={"Authorization": f"OAuth {self.secret.strip()}", "file_offset": "0", "Content-Type": mime_type})
        except requests.RequestException as exc:
            raise ProviderError(f"Cannot reach Meta: {exc.__class__.__name__}") from None
        if upload.status_code >= 300:
            raise ProviderError(f"Meta refused the sample file: {reason_of(self._error(upload))[1]}", retryable=False)
        return str((upload.json() or {}).get("h") or "")

    # ---- what comes back
    def subscribe_challenge(self, query: dict, token: str) -> str | None:
        if query.get("hub.mode") == "subscribe" and hmac.compare_digest(str(query.get("hub.verify_token") or ""), token):
            return str(query.get("hub.challenge") or "")
        return None

    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        secret = (self.transactional_secret or "").strip()
        if not secret:
            return True                                     # no app secret entered: the URL token is the only check
        given = (headers.get("x-hub-signature-256") or "").removeprefix("sha256=").strip().lower()
        return hmac.compare_digest(given, hmac.new(secret.encode(), body, hashlib.sha256).hexdigest())

    @staticmethod
    def _values(payload, field: str) -> list[dict]:
        if not isinstance(payload, dict):
            return []
        return [change.get("value") or {} for entry in payload.get("entry") or [] if isinstance(entry, dict)
                for change in entry.get("changes") or [] if isinstance(change, dict) and change.get("field") == field]

    def parse_webhook(self, payload) -> list[DeliveryEvent]:
        out = []
        for value in self._values(payload, "messages"):
            for status in value.get("statuses") or []:
                kind = STATUS_EVENTS.get(str(status.get("status") or "").lower())
                if kind is None:                            # "sent": the engine already recorded the hand-over
                    continue
                errors = status.get("errors") or []
                reason = reason_of(errors[0])[1] if errors else ""
                out.append(DeliveryEvent(kind, provider_message_id=str(status.get("id") or ""), idempotency_key=str(status.get("biz_opaque_callback_data") or ""),
                                         occurred_at=_when(status.get("timestamp")), reason=reason[:200], raw=status,
                                         provider_event_id=f"{status.get('id')}:{status.get('status')}"[:100]))
        return out

    def parse_inbound(self, payload) -> list[InboundMessage]:
        out = []
        for value in self._values(payload, "messages"):
            to = (value.get("metadata") or {}).get("display_phone_number") or ""
            for message in value.get("messages") or []:
                kind = message.get("type")
                text = ((message.get("text") or {}).get("body") if kind == "text"
                        else (message.get("button") or {}).get("text") if kind == "button"
                        else ((message.get("interactive") or {}).get("button_reply") or {}).get("title") if kind == "interactive" else "") or ""
                out.append(InboundMessage(from_number="+" + digits(message.get("from") or ""), to_number=to, text=text, provider_message_id=str(message.get("id") or ""),
                                          received_at=_when(message.get("timestamp")), raw=message))
        return out

    def parse_account_updates(self, payload) -> list[dict]:
        out = []
        for value in self._values(payload, "message_template_status_update"):
            out.append({"kind": "template_status", "meta_template_id": str(value.get("message_template_id") or ""), "name": value.get("message_template_name"),
                        "language": value.get("message_template_language"), "status": TEMPLATE_STATUSES.get(str(value.get("event") or "").upper()),
                        "reason": None if str(value.get("reason") or "NONE").upper() == "NONE" else str(value.get("reason"))})
        for value in self._values(payload, "message_template_quality_update"):
            out.append({"kind": "template_quality", "meta_template_id": str(value.get("message_template_id") or ""), "quality": value.get("new_quality_score")})
        for value in self._values(payload, "phone_number_quality_update"):
            out.append({"kind": "number_quality", "event": value.get("event"), "limit": LIMITS.get(str(value.get("current_limit") or ""))})
        return out
