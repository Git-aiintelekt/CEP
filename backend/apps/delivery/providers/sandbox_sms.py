"""Sandbox text engine: accepts SMS and MMS and sends NOTHING.

For trying a workspace's text flows (audience, consent, personalization, parts, reports, STOP handling) before a real
aggregator is connected, and for the automated tests. What "went out" is the rendered text stored on sms_execution.
Its sends are not metered.

Simulate the aggregator with the engine's callback address:

    POST <webhook url>   {"events": [{"type": "delivered", "message_id": "sbx-..."},
                                     {"type": "failed", "message_id": "sbx-...", "reason": "invalid number", "permanent": true},
                                     {"type": "inbound", "from": "+14045550001", "to": "55123", "text": "STOP"}]}
"""
import uuid
from datetime import datetime, timezone

from .base import ConfigField, DeliveryEvent, EventType, InboundMessage, SendResult, SmsMessage, SmsProvider
from .registry import register


def _numbers(value) -> set[str]:
    return {item.strip() for item in str(value or "").replace(";", ",").split(",") if item.strip()}


@register
class SandboxSmsProvider(SmsProvider):
    provider_type = "SANDBOX_SMS"
    label = "Sandbox (sends nothing)"
    description = "Accepts SMS and MMS without sending them: for trying text campaigns before an aggregator is connected. Not metered."
    supports_webhooks = True
    supports_mms = True
    config_fields = (
        ConfigField("reject_numbers", "Numbers to refuse", required=False, help="Comma-separated. Sending to these fails for good, as an invalid number would."),
        ConfigField("retry_numbers", "Numbers that fail temporarily", required=False, help="Comma-separated. Sending to these asks for a retry, as a busy aggregator would."),
    )

    def send(self, message: SmsMessage) -> SendResult:
        if message.to_number in _numbers(self.config.get("reject_numbers")):
            return SendResult.rejected("Sandbox: number refused (invalid destination)")
        if message.to_number in _numbers(self.config.get("retry_numbers")):
            return SendResult.retry("Sandbox: temporary failure")
        return SendResult.accepted("sbx-" + uuid.uuid4().hex[:20])

    def _events(self, payload) -> list[dict]:
        items = payload.get("events") if isinstance(payload, dict) else payload
        return [item for item in items or [] if isinstance(item, dict)]

    def parse_webhook(self, payload) -> list[DeliveryEvent]:
        out = []
        for item in self._events(payload):
            kind = str(item.get("type", "")).lower()
            if kind not in ("delivered", "failed"):
                continue
            event = DeliveryEvent(EventType.DELIVERED if kind == "delivered" else EventType.BOUNCED, provider_message_id=str(item.get("message_id") or ""),
                                  idempotency_key=str(item.get("idempotency_key") or ""), reason=str(item.get("reason") or "")[:200],
                                  occurred_at=datetime.now(tz=timezone.utc), raw=item)
            if kind == "failed":
                event.bounce_type = "HARD" if item.get("permanent") else "SOFT"
            out.append(event)
        return out

    def parse_inbound(self, payload) -> list[InboundMessage]:
        return [InboundMessage(from_number=str(item.get("from") or ""), to_number=str(item.get("to") or ""), text=str(item.get("text") or ""),
                               provider_message_id=str(item.get("message_id") or ""), received_at=datetime.now(tz=timezone.utc), raw=item)
                for item in self._events(payload) if str(item.get("type", "")).lower() == "inbound" and item.get("from")]
