"""Digivize (SMS / MMS aggregator) - NOT INSTALLED YET.

This module is deliberately not imported by registry._load(): the Digivize API specification was not available when the
text engine was built, and an adapter written from guesses would fail on the first real message. Everything around it is
ready (audience, consent, parts, sms_execution, retries, receipts, STOP / START / HELP, reports, settings screen), so
this one file is all that is missing.

To finish it, fill in the five marked places from the Digivize documentation or from the code that sends to Digivize
today, add `digivize` to the import in registry._load(), and test it offline the way postal.py and sendgrid.py are tested
(mock the HTTP session, feed real sample callbacks to parse_webhook / parse_inbound).

Needed from the specification:
  1. send SMS:   URL, HTTP method, authentication (header? basic? token in the body?), request fields, success and error answers
  2. send MMS:   how the picture travels (public URL or upload?), size and type limits, subject field
  3. receipts:   callback format, the statuses (delivered / failed / expired ...) and which failures are permanent
  4. inbound:    callback format for replies (STOP / START / HELP are handled by the engine, not here)
  5. limits:     messages per second, batch endpoint if any, sender id rules (short code, long number, alphanumeric)
"""
import requests

from .base import ConfigField, DeliveryEvent, InboundMessage, ProviderError, SendResult, SmsMessage, SmsProvider

# from .registry import register          # <- uncomment together with @register below once the five places are filled in


# @register
class DigivizeProvider(SmsProvider):
    provider_type = "DIGIVIZE"
    label = "Digivize"
    description = "Digivize SMS / MMS aggregator."
    supports_webhooks = True
    supports_mms = True
    config_fields = (
        ConfigField("endpoint", "API address", kind="url", placeholder="https://api.digivize.example"),          # (1) confirm
        ConfigField("api_key", "API key", secret=True),                                                          # (1) confirm the credential type
        ConfigField("account_id", "Account id", required=False),                                                 # (1) if the API needs one
    )

    def open(self) -> None:
        self._session = self.new_session()
        # (1) authentication goes here, e.g. self._session.headers["Authorization"] = f"Bearer {self.secret}"

    def close(self) -> None:
        session = getattr(self, "_session", None)
        if session is not None:
            session.close()
            self._session = None

    def send(self, message: SmsMessage) -> SendResult:
        # (1) + (2): build the request from message.to_number, message.from_sender, message.text, message.media_url,
        # message.idempotency_key (send it as the client reference so receipts can echo it), then map the answer:
        #   accepted            -> SendResult.accepted(<their message id>)
        #   bad number etc.     -> SendResult.rejected(<their reason>)
        #   429 / 5xx / timeout -> SendResult.retry(<reason>)
        #   bad credentials     -> raise ProviderError(..., retryable=False)
        raise ProviderError("The Digivize adapter is not implemented yet: its API specification is needed (see apps/delivery/providers/digivize.py).", retryable=False)

    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        return True                                         # (3) their signature scheme, if they have one

    def parse_webhook(self, payload) -> list[DeliveryEvent]:
        return []                                           # (3) receipts -> DeliveryEvent(DELIVERED | BOUNCED HARD/SOFT | DROPPED)

    def parse_inbound(self, payload) -> list[InboundMessage]:
        return []                                           # (4) replies -> InboundMessage(from_number, to_number, text, provider_message_id)
