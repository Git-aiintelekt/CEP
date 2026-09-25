"""Provider registry: provider_type -> adapter class, and delivery_provider row -> ready adapter instance."""
from __future__ import annotations

import os

from .base import EmailProvider, ProviderError

_ADAPTERS: dict[str, type[EmailProvider]] = {}


def register(cls: type[EmailProvider]) -> type[EmailProvider]:
    if not cls.provider_type:
        raise ValueError(f"{cls.__name__} has no provider_type")
    _ADAPTERS[cls.provider_type] = cls
    return cls


def adapter_class(provider_type: str) -> type[EmailProvider]:
    _load()
    try:
        return _ADAPTERS[provider_type]
    except KeyError:
        raise ProviderError(f"No adapter is installed for provider type {provider_type}.", retryable=False) from None


def catalogue() -> list[dict]:
    """What Settings -> Delivery offers: every adapter with the fields its form needs."""
    _load()
    return [{"provider_type": cls.provider_type, "label": cls.label, "description": cls.description, "supports_webhooks": cls.supports_webhooks,
             "manageable": cls.manageable, "channel": cls.channel, "supports_mms": bool(getattr(cls, "supports_mms", False)),
             "fields": [{"key": f.key, "label": f.label, "required": f.required, "secret": f.secret, "help": f.help, "placeholder": f.placeholder, "kind": f.kind}
                        for f in cls.config_fields]}
            for cls in sorted(_ADAPTERS.values(), key=lambda c: c.label)]


def resolve_secret(provider) -> str | None:
    """secret_enc (entered in the product, encrypted) wins; otherwise secret_ref names a secret kept elsewhere:
    env:NAME -> environment variable. Other schemes (vault:...) plug in here."""
    if getattr(provider, "secret_enc", None):
        from apps.platform_ops import crypto
        return crypto.decrypt(provider.secret_enc)
    ref = (provider.secret_ref or "").strip()
    if ref.startswith("env:"):
        value = os.environ.get(ref[4:])
        if not value:
            raise ProviderError(f"Environment variable {ref[4:]} (secret_ref of {provider.name}) is not set.", retryable=False)
        return value
    if ref:
        raise ProviderError(f"{provider.name}: no resolver for secret_ref '{ref.split(':')[0]}:'. Enter the credential in Settings -> Delivery, or use env:NAME.", retryable=False)
    return None


def for_provider(provider) -> EmailProvider:
    """The adapter for one delivery_provider row, configured and holding its credential."""
    cls = adapter_class(provider.provider_type)
    if not provider.is_active or provider.deleted_at is not None:
        raise ProviderError(f"The delivery provider {provider.name} is switched off.", retryable=False)
    adapter = cls(config=provider.config or {}, secret=resolve_secret(provider), provider_id=str(provider.pk), tenant_id=str(provider.tenant_id))
    adapter.provider_name = provider.name
    adapter.rate_limit_per_minute = provider.rate_limit_per_minute
    return adapter


_loaded = False


def _load() -> None:
    global _loaded
    if not _loaded:
        from . import postal, sandbox_sms, sendgrid, smtp  # noqa: F401  (importing registers them; digivize.py joins once its API is known)
        _loaded = True
