"""The contract every delivery provider adapter implements.

The send engine knows nothing about Postal, SendGrid or SMTP. It builds an `EmailMessage`, hands it to the adapter that
`registry.for_provider(row)` returns, and records the `SendResult`. Later the provider calls back; the webhook view asks
the same adapter to authenticate the call and to translate the payload into `DeliveryEvent`s, which the engine applies to
`mailer_execution`. Adding a provider = one module with one subclass, registered with `@register`.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


# ------------------------------------------------------------------------------------------------------------ what goes out
@dataclass
class Attachment:
    name: str
    content_type: str
    data: bytes


@dataclass
class EmailMessage:
    to_email: str
    from_email: str
    subject: str
    html: str
    text: str = ""
    to_name: str = ""
    from_name: str = ""
    reply_to: str | None = None
    headers: dict[str, str] = field(default_factory=dict)       # List-Unsubscribe, List-Unsubscribe-Post ...
    idempotency_key: str = ""                                   # travels with the message and comes back in webhooks
    tag: str = ""                                               # campaign code: shows up in the provider's own reports
    metadata: dict[str, str] = field(default_factory=dict)      # tenant, campaign_run: echoed by providers that support it
    attachments: list[Attachment] = field(default_factory=list)  # receipts (PDF copy); campaigns send none

    @property
    def sender(self) -> str:
        return f"{self.from_name} <{self.from_email}>" if self.from_name else self.from_email

    @property
    def recipient(self) -> str:
        return f"{self.to_name} <{self.to_email}>" if self.to_name else self.to_email


class Outcome(str, Enum):
    ACCEPTED = "ACCEPTED"      # the provider took the message: mailer_execution -> SUBMITTED
    REJECTED = "REJECTED"      # permanent, this message only (bad address, suppressed at the provider): -> FAILED, never retried
    RETRY = "RETRY"            # temporary (timeout, 429, 5xx): stays QUEUED, the batch is retried with back-off


@dataclass
class SendResult:
    outcome: Outcome
    provider_message_id: str = ""
    reason: str = ""

    @classmethod
    def accepted(cls, message_id: str = "") -> "SendResult":
        return cls(Outcome.ACCEPTED, message_id)

    @classmethod
    def rejected(cls, reason: str) -> "SendResult":
        return cls(Outcome.REJECTED, reason=reason[:200])

    @classmethod
    def retry(cls, reason: str) -> "SendResult":
        return cls(Outcome.RETRY, reason=reason[:200])


# ------------------------------------------------------------------------------------------------------------ what comes back
class EventType(str, Enum):
    DELIVERED = "DELIVERED"
    BOUNCED = "BOUNCED"
    DEFERRED = "DEFERRED"      # temporary failure at the receiving side: recorded, status unchanged
    DROPPED = "DROPPED"        # the provider refused to try (its own suppression list, invalid address): -> FAILED
    COMPLAINED = "COMPLAINED"
    OPENED = "OPENED"
    CLICKED = "CLICKED"
    UNSUBSCRIBED = "UNSUBSCRIBED"


@dataclass
class DeliveryEvent:
    event_type: EventType
    provider_message_id: str = ""
    idempotency_key: str = ""           # when the provider echoes our metadata: the most reliable way back to the row
    email: str = ""
    occurred_at: datetime | None = None
    bounce_type: str | None = None      # HARD | SOFT
    reason: str = ""
    url: str = ""
    ip_address: str | None = None
    user_agent: str = ""
    raw: dict = field(default_factory=dict)


# ------------------------------------------------------------------------------------------------------------ describing a provider
@dataclass(frozen=True)
class ConfigField:
    """One input of the provider form in Settings -> Delivery. `secret` fields are write-only and stored encrypted."""
    key: str
    label: str
    required: bool = True
    secret: bool = False
    help: str = ""
    placeholder: str = ""
    kind: str = "text"                  # text | url | textarea


class ProviderError(Exception):
    """Raised by adapters for failures that are not about one message. retryable=False stops the run."""
    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class EmailProvider(ABC):
    provider_type: str = ""             # value of delivery_provider.provider_type
    label: str = ""                     # shown in the product
    description: str = ""
    config_fields: tuple[ConfigField, ...] = ()
    supports_webhooks: bool = False
    manageable: bool = True             # False: created by another screen (SMTP comes from Settings -> Email server)
    max_batch: int = 100                # how many executions one Celery task should take

    def __init__(self, *, config: dict, secret: str | None, provider_id: str = "", tenant_id: str = ""):
        self.config, self.secret, self.provider_id, self.tenant_id = config or {}, secret, provider_id, tenant_id

    # ---- lifecycle: one open/close around a batch, so SMTP can keep its connection and HTTP its session
    def open(self) -> None:             # noqa: B027  (optional hook)
        pass

    def close(self) -> None:            # noqa: B027
        pass

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *exc):
        self.close()

    # ---- sending
    @abstractmethod
    def send(self, message: EmailMessage) -> SendResult:
        """Hand one message to the provider. Never raises for a per-message problem: return REJECTED or RETRY.
        Raise ProviderError only when nothing can be sent at all (bad credentials, provider down)."""

    def check(self) -> tuple[bool, str]:
        """Validate configuration and credentials without sending (the 'Check connection' button)."""
        return True, ""

    # ---- webhooks
    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        """Provider-native signature check. The URL already carries an unguessable token, so providers without a
        signature scheme (or without the key configured) return True here."""
        return True

    def parse_webhook(self, payload) -> list[DeliveryEvent]:
        return []

    # ---- validation of the settings form
    @classmethod
    def validate_config(cls, config: dict, has_secret: bool) -> dict[str, str]:
        errors = {}
        for item in cls.config_fields:
            present = has_secret if item.secret else bool(str(config.get(item.key) or "").strip())
            if item.required and not present:
                errors[item.key] = f"{item.label} is required."
            if item.kind == "url" and config.get(item.key) and not str(config[item.key]).startswith("https://"):
                errors[item.key] = f"{item.label} must be an https:// address."
        return errors
