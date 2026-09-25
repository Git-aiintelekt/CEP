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


TRAFFIC_BULK = "BULK"                                       # marketing campaigns
TRAFFIC_TRANSACTIONAL = "TRANSACTIONAL"                     # receipts, and campaigns that are not marketing


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
    traffic: str = TRAFFIC_BULK                                 # which credential and throttle lane carry it (an engine may hold two)

    @property
    def sender(self) -> str:
        return f"{self.from_name} <{self.from_email}>" if self.from_name else self.from_email

    @property
    def recipient(self) -> str:
        return f"{self.to_name} <{self.to_email}>" if self.to_name else self.to_email


@dataclass
class SmsMessage:
    to_number: str                                              # E.164: +14045550001
    from_sender: str                                            # the workspace's short code or long number
    text: str
    media_url: str | None = None                                # set = MMS
    subject: str = ""                                           # MMS only
    idempotency_key: str = ""
    tag: str = ""                                               # campaign code
    metadata: dict[str, str] = field(default_factory=dict)

    @property
    def is_mms(self) -> bool:
        return bool(self.media_url)


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


@dataclass
class InboundMessage:
    """A text a person sent to the workspace's number: STOP, START, HELP or a free reply."""
    from_number: str
    text: str
    to_number: str = ""
    provider_message_id: str = ""
    received_at: datetime | None = None
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
    credential: str = "secret"          # for secret fields: "secret" (the engine's credential) or "transactional_secret" (the second one)


class ProviderError(Exception):
    """Raised by adapters for failures that are not about one message. retryable=False stops the run."""
    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class EmailProvider(ABC):
    channel: str = "EMAIL"              # EMAIL adapters carry email; SMS adapters carry SMS and (supports_mms) MMS
    provider_type: str = ""             # value of delivery_provider.provider_type
    label: str = ""                     # shown in the product
    description: str = ""
    config_fields: tuple[ConfigField, ...] = ()
    supports_webhooks: bool = False
    manageable: bool = True             # False: created by another screen (SMTP comes from Settings -> Email server)
    max_batch: int = 100                # how many executions one Celery task should take

    def __init__(self, *, config: dict, secret: str | None, provider_id: str = "", tenant_id: str = "", transactional_secret: str | None = None):
        self.config, self.secret, self.provider_id, self.tenant_id = config or {}, secret, provider_id, tenant_id
        self.transactional_secret = transactional_secret or None
        # set by registry.for_provider from the delivery_provider row; the integration bridge reads them
        self.provider_name: str | None = None
        self.rate_limit_per_minute: int | None = None
        self.guard = None

    # ---- the integration bridge (apps.integrations.bridge): every call logged, throttled and behind a circuit breaker
    def new_session(self):
        """The requests session an HTTP adapter should use: each call is timed and written to the integration log."""
        from apps.integrations.bridge.outbound import Guard, LoggedSession
        if self.guard is None:
            self.guard = Guard(self)
        return LoggedSession(self.guard)

    def send_guarded(self, message, *, related_ref: str | None = None):
        """What the engine calls: send() with the integration's pause, breaker and throttle in front and a log row behind."""
        from apps.integrations.bridge.outbound import guarded_send
        return guarded_send(self, message, related_ref)

    # ---- two credentials on one engine
    @classmethod
    def supports_transactional_credential(cls) -> bool:
        return any(f.secret and f.credential == "transactional_secret" for f in cls.config_fields)

    def carries_transactional(self, message) -> bool:
        """True when this message goes out on the second credential: transactional traffic, and a second credential is set."""
        return bool(self.transactional_secret) and getattr(message, "traffic", TRAFFIC_BULK) == TRAFFIC_TRANSACTIONAL

    def secret_for(self, message) -> str | None:
        return self.transactional_secret if self.carries_transactional(message) else self.secret

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
    def validate_config(cls, config: dict, has_secret: bool, has_transactional_secret: bool = False) -> dict[str, str]:
        errors = {}
        for item in cls.config_fields:
            present = (has_transactional_secret if item.credential == "transactional_secret" else has_secret) if item.secret \
                else bool(str(config.get(item.key) or "").strip())
            if item.required and not present:
                errors[item.key] = f"{item.label} is required."
            if item.kind == "url" and config.get(item.key) and not str(config[item.key]).startswith("https://"):
                errors[item.key] = f"{item.label} must be an https:// address."
        return errors


class SmsProvider(EmailProvider):
    """Text messages through an aggregator. Same life cycle, configuration, credential and webhook rules as EmailProvider;
    `send` takes an SmsMessage, and `parse_inbound` translates what people text back.

    Delivery receipts use the same DeliveryEvent vocabulary: DELIVERED; BOUNCED with bounce_type HARD for a number that
    can never receive (invalid, landline, deactivated: the number is blocked) or SOFT for a temporary failure;
    DROPPED when the aggregator refused to try."""
    channel = "SMS"
    supports_mms: bool = False
    max_batch = 200

    @abstractmethod
    def send(self, message: SmsMessage) -> SendResult:       # type: ignore[override]
        """Hand one message to the aggregator. REJECTED / RETRY for a per-message problem, ProviderError when nothing can be sent."""

    def parse_inbound(self, payload) -> list[InboundMessage]:
        return []
