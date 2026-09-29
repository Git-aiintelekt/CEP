"""A tenant's mail server offered as a campaign sender.

When Settings -> Email server has "Offer as a campaign sender" on, the workspace gets a delivery provider of type SMTP
(config: {"mail_server_id": ...}; credentials stay in mail_server, encrypted) and one email sender profile with the
server's From address. The profile is VERIFIED once a test message went through the server, so campaigns can be
published with it; switching the option off, or removing the server, retires both (soft delete: campaigns that
already reference the sender keep their history).

Runs on the request's own connection (the tenant's, under row-level security), so it never touches another tenant.
"""
from django.utils import timezone

from apps.delivery.models import DeliveryProvider, SenderProfile

PROVIDER_NAME = "Workspace mail server"


def _provider(server, include_retired=False):
    rows = DeliveryProvider.objects.filter(tenant_id=server.tenant_id, provider_type="SMTP")
    return (rows if include_retired else rows.filter(deleted_at__isnull=True)).order_by("deleted_at").first()


def sync(server, *, user_id=None) -> dict | None:
    """Brings the provider and sender profile in line with the mail server. Returns the sender profile summary or None."""
    if not server.campaign_sender or not server.is_active:
        retire(server)
        return None
    provider = _provider(server, include_retired=True)                    # the name is unique per tenant: a retired one is revived, not duplicated
    host = server.host
    if provider is None:
        others = DeliveryProvider.objects.filter(tenant_id=server.tenant_id, channel="EMAIL", is_default=True, deleted_at__isnull=True).exists()
        provider = DeliveryProvider.objects.create(tenant_id=server.tenant_id, provider_type="SMTP", channel="EMAIL", name=PROVIDER_NAME,
                                                   config={"mail_server_id": str(server.pk), "host": host}, is_default=not others, is_active=True, created_by_id=user_id)
    elif provider.config.get("host") != host or not provider.is_active or provider.deleted_at is not None:
        provider.config, provider.is_active, provider.deleted_at, provider.updated_by_id = {**provider.config, "mail_server_id": str(server.pk), "host": host}, True, None, user_id
        provider.save(update_fields=["config", "is_active", "deleted_at", "updated_by"])

    status = "VERIFIED" if server.last_test_ok else "PENDING"
    wanted = {"display_name": server.from_name or server.from_email, "from_address": server.from_email, "reply_to_address": server.reply_to or None, "verification_status": status}
    profile = SenderProfile.objects.filter(delivery_provider=provider, channel="EMAIL").order_by("deleted_at").first()   # a retired one is revived: campaigns keep pointing at it
    if profile is None:
        others = SenderProfile.objects.filter(tenant_id=server.tenant_id, channel="EMAIL", is_default=True, deleted_at__isnull=True).exists()
        profile = SenderProfile.objects.create(tenant_id=server.tenant_id, delivery_provider=provider, channel="EMAIL", is_default=not others, created_by_id=user_id, **wanted)
    else:
        wanted["deleted_at"] = None
        changed = [key for key, value in wanted.items() if getattr(profile, key) != value]
        if changed:
            for key in changed:
                setattr(profile, key, wanted[key])
            profile.updated_by_id = user_id
            profile.save(update_fields=[*changed, "updated_by"])
    return summary(profile)


def retire(server) -> None:
    provider = _provider(server)
    if provider is None:
        return
    now = timezone.now()
    SenderProfile.objects.filter(delivery_provider=provider, deleted_at__isnull=True).update(deleted_at=now, is_default=False)
    DeliveryProvider.objects.filter(pk=provider.pk).update(deleted_at=now, is_default=False, is_active=False)


def current(server) -> dict | None:
    provider = _provider(server) if server else None
    profile = SenderProfile.objects.filter(delivery_provider=provider, channel="EMAIL", deleted_at__isnull=True).first() if provider else None
    return summary(profile) if profile else None


def summary(profile) -> dict:
    return {"id": str(profile.pk), "display_name": profile.display_name, "from_address": profile.from_address, "verification_status": profile.verification_status,
            "is_default": profile.is_default}
