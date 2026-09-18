"""Delivery provider adapters: one interface (base.EmailProvider), one module per third party.

    from apps.delivery.providers import registry
    with registry.for_provider(row) as provider:
        result = provider.send(message)

See docs/DELIVERY_PROVIDERS.md for how to add one.
"""
from .base import ConfigField, DeliveryEvent, EmailMessage, EmailProvider, EventType, Outcome, ProviderError, SendResult  # noqa: F401
