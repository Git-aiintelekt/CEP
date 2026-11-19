"""What a workspace is told about, and where: email to the campaign owner and to fixed addresses, and a chat webhook
(Slack, Teams or anything that takes {"text": ...}). Settings live in tenant.settings["notifications"].

A notification never raises and never blocks the work it reports on: what cannot be sent is logged. Read the settings
inside the caller's tenant transaction (prepare) and do the sending after it (deliver); notify() does both for a request.
"""
import logging
import re
from datetime import datetime

import requests
from django.conf import settings
from django.utils import timezone

from apps.tenants.models import Tenant

from . import mail

log = logging.getLogger("cep.notifications")
KEY = "notifications"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_EMAILS = 20
WEBHOOK_TIMEOUT = 5
CHANNELS = ("owner", "recipients", "webhook")

# event: (label, what it says, default per channel)
EVENTS = {
    "send_completed": ("Send completed", "with sent and failed counts", {"owner": True, "recipients": False, "webhook": True}),
    "send_failed": ("Send failed", "the run could not start or nothing went out", {"owner": True, "recipients": True, "webhook": True}),
    "approval_requested": ("Approval requested", "everyone who can approve is always emailed; this adds the recipients and the webhook",
                           {"owner": False, "recipients": False, "webhook": True}),
    "approval_decided": ("Approved or sent back", "to the person who asked", {"owner": True, "recipients": False, "webhook": False}),
    "engine_trouble": ("Sending engine trouble", "a circuit opened after repeated failures", {"owner": False, "recipients": True, "webhook": True}),
    "ab_winner": ("A/B winner chosen", "with the two rates", {"owner": True, "recipients": False, "webhook": False}),
    "weekly_report": ("Weekly report", "Monday 08:00 in the workspace's time zone, the last 7 days", {"owner": False, "recipients": True, "webhook": False}),
}


class NotificationError(Exception):
    """A setting that cannot be saved: the message names the field, as the form should show it."""

    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


# ---------------------------------------------------------------------------------------------------- settings
def _merged(stored: dict | None) -> dict:
    stored = stored or {}
    events = {}
    for key, (_, _, defaults) in EVENTS.items():
        chosen = stored.get("events", {}).get(key) or {}
        events[key] = {channel: bool(chosen.get(channel, defaults[channel])) for channel in CHANNELS}
    return {"emails": list(stored.get("emails") or []), "webhook_url": stored.get("webhook_url") or "", "webhook_tested_at": stored.get("webhook_tested_at"),
            "events": events, "muted_integrations": [str(item) for item in stored.get("muted_integrations") or []]}


def settings_of(tenant) -> dict:
    """The stored settings with every event filled in from the defaults. `tenant` is a Tenant or its id."""
    if not isinstance(tenant, Tenant):
        tenant = Tenant.objects.get(pk=tenant)
    return _merged(tenant.settings.get(KEY))


def catalogue() -> list[dict]:
    return [{"key": key, "label": label, "hint": hint} for key, (label, hint, _) in EVENTS.items()]


def save(tenant, data: dict) -> dict:
    """Validates and stores what the form sent; fields left out keep their value. Returns the merged settings."""
    if not isinstance(tenant, Tenant):
        tenant = Tenant.objects.get(pk=tenant)
    current = dict(tenant.settings.get(KEY) or {})
    if "emails" in data:
        raw = data["emails"]
        if isinstance(raw, str):
            raw = raw.replace(";", ",").split(",")
        if not isinstance(raw, list):
            raise NotificationError("emails", "Send a list of addresses.")
        emails = list(dict.fromkeys(str(item).strip().lower() for item in raw if str(item).strip()))
        bad = [item for item in emails if not EMAIL_RE.match(item)]
        if bad:
            raise NotificationError("emails", f"Not an email address: {', '.join(bad[:3])}")
        if len(emails) > MAX_EMAILS:
            raise NotificationError("emails", f"Up to {MAX_EMAILS} addresses.")
        current["emails"] = emails
    if "webhook_url" in data:
        url = (data["webhook_url"] or "").strip()
        if url and not url.startswith(("https://", "http://")):
            raise NotificationError("webhook_url", "The webhook must be an http:// or https:// address.")
        if len(url) > 1000:
            raise NotificationError("webhook_url", "That address is too long.")
        if url != current.get("webhook_url", ""):
            current["webhook_tested_at"] = None
        current["webhook_url"] = url
    if "events" in data:
        chosen = data["events"]
        if not isinstance(chosen, dict):
            raise NotificationError("events", "Send the events as an object keyed by event.")
        unknown = [key for key in chosen if key not in EVENTS]
        if unknown:
            raise NotificationError("events", f"Unknown event: {', '.join(unknown)}")
        events = dict(current.get("events") or {})
        for key, channels in chosen.items():
            events[key] = {channel: bool((channels or {}).get(channel, EVENTS[key][2][channel])) for channel in CHANNELS}
        current["events"] = events
    tenant.settings = {**tenant.settings, KEY: current}
    tenant.save(update_fields=["settings"])
    return _merged(current)


def set_integration_alerts(tenant, integration_id, enabled: bool) -> list[str]:
    """The per-integration switch on the Integrations page: a muted integration raises no engine_trouble notification."""
    if not isinstance(tenant, Tenant):
        tenant = Tenant.objects.get(pk=tenant)
    current = dict(tenant.settings.get(KEY) or {})
    muted = [str(item) for item in current.get("muted_integrations") or [] if str(item) != str(integration_id)]
    if not enabled:
        muted.append(str(integration_id))
    current["muted_integrations"] = muted
    tenant.settings = {**tenant.settings, KEY: current}
    tenant.save(update_fields=["settings"])
    return muted


def mark_webhook_tested(tenant, when: datetime) -> None:
    if not isinstance(tenant, Tenant):
        tenant = Tenant.objects.get(pk=tenant)
    current = dict(tenant.settings.get(KEY) or {})
    current["webhook_tested_at"] = when.isoformat()
    tenant.settings = {**tenant.settings, KEY: current}
    tenant.save(update_fields=["settings"])


# ---------------------------------------------------------------------------------------------------- sending
def prepare(tenant) -> dict:
    """The settings, read now so the sending can happen after the transaction that raised the event."""
    return settings_of(tenant)


def deliver(config: dict, tenant_id, event: str, *, title: str, lines: list[str], link: str | None = None, link_label: str = "Open in C360",
            owner_email: str | None = None, to: list[str] | tuple[str, ...] = ()) -> dict:
    """Sends by every channel the event is switched on for. `to` are addresses that get it regardless (approvers, a report's
    subscribers). Returns how many emails went and whether the webhook took it."""
    channels = config["events"].get(event) or EVENTS[event][2]
    addresses = list(to)
    if channels["owner"] and owner_email:
        addresses.append(owner_email)
    if channels["recipients"]:
        addresses += config["emails"]
    addresses = list(dict.fromkeys(address.lower() for address in addresses if address))
    emailed = 0
    if addresses:
        context = {"title": title, "lines": lines, "link": link, "link_label": link_label, "event_label": EVENTS[event][0]}
        emailed = len(addresses) if mail.send("workspace_notification", addresses, context, subject=f"[C360] {title}", tenant_id=tenant_id) else 0
    hooked = False
    if channels["webhook"] and config["webhook_url"]:
        hooked = post_webhook(config["webhook_url"], title, lines, link)
    log.info("notification %s for tenant %s: %d emailed, webhook %s", event, tenant_id, emailed, "ok" if hooked else "no")
    return {"email": emailed, "webhook": hooked}


def notify(tenant, event: str, **message) -> dict:
    """prepare + deliver, for code that runs inside a request."""
    try:
        config = prepare(tenant)
        return deliver(config, getattr(tenant, "pk", tenant), event, **message)
    except Exception:                                      # noqa: BLE001  a notification must never undo the action it reports
        log.exception("notification %s not sent", event)
        return {"email": 0, "webhook": False}


def post_webhook(url: str, title: str, lines: list[str], link: str | None = None) -> bool:
    text = f"*{title}*" + ("".join("\n" + line for line in lines)) + (f"\n{link}" if link else "")
    try:
        return requests.post(url, json={"text": text}, timeout=WEBHOOK_TIMEOUT).ok
    except requests.RequestException as exc:
        log.error("notification webhook failed: %s", exc)
        return False


def send_test(tenant, *, by: str) -> dict:
    """A test message by every configured channel, so the form can say what works. Raises nothing."""
    config = prepare(tenant)
    tenant_id = getattr(tenant, "pk", tenant)
    lines = [f"Sent by {by} from Settings → Notifications at {timezone.now():%d %b %Y %H:%M} UTC.", "If you can read this, the channel works."]
    emailed = len(config["emails"]) if config["emails"] and mail.send("workspace_notification", config["emails"],
                                                                         {"title": "Test notification", "lines": lines, "link": None, "link_label": "", "event_label": "Test"},
                                                                         subject="[C360] Test notification", tenant_id=tenant_id) else 0
    hooked = bool(config["webhook_url"]) and post_webhook(config["webhook_url"], "Test notification", lines)
    if hooked:
        mark_webhook_tested(tenant, timezone.now())
    return {"email": emailed, "webhook": hooked, "webhook_configured": bool(config["webhook_url"]), "emails_configured": len(config["emails"])}


def campaign_link(campaign_id, *, setup: bool = False) -> str:
    base = settings.FRONTEND_URL.rstrip("/")
    return f"{base}/campaigns/{campaign_id}/edit?step=publish&section=review" if setup else f"{base}/campaigns/{campaign_id}"
