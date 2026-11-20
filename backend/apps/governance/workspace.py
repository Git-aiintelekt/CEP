"""A workspace's Governance page (Settings → Engagement → Governance): its frequency caps (the platform's copies, locked, and
its own), the rules the send engine applies besides them, and what the caps did in the last 30 days.

Every cap applies: a person who has reached any of them is skipped by a marketing send (apps/delivery/engine/audience*.py,
reason FREQUENCY_CAP). A workspace's own caps therefore only ever make sending stricter than the platform's.
Runs in the request's tenant context (row-level security)."""
from __future__ import annotations

from django.db import connection
from django.utils import timezone

from apps.governance.models import CommunicationGovernancePolicy
from apps.governance.platform import LOCKED_MESSAGE

CHANNELS = {"EMAIL": "Email", "SMS": "Text", "WHATSAPP": "WhatsApp"}
WORDS = {"EMAIL": ("email", "emails"), "SMS": ("text", "texts"), "WHATSAPP": ("WhatsApp message", "WhatsApp messages"), None: ("message", "messages")}
MAX_PERIOD_DAYS = 365
MAX_MESSAGES = 1000


class GovernanceError(ValueError):
    """field -> message, for a 400"""
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


class Locked(PermissionError):
    pass


def rule(max_messages: int, period_days: int, channel: str | None) -> str:
    one, many = WORDS.get(channel, WORDS[None])
    return f"{max_messages} {one if max_messages == 1 else many} per {'day' if period_days == 1 else f'{period_days} days'}"


def _row(policy: CommunicationGovernancePolicy) -> dict:
    channel = None if policy.scope == "GLOBAL" else (policy.channel or "EMAIL")
    return {"id": str(policy.pk), "name": policy.name, "channel": channel or "ALL", "channel_label": CHANNELS.get(channel, "All Channels"),
            "max_messages": policy.max_messages, "period_days": policy.period_days, "rule": rule(policy.max_messages, policy.period_days, channel),
            "is_active": policy.is_active, "platform": policy.platform_policy_id is not None, "row_version": policy.row_version}


def caps(tenant_id) -> list[dict]:
    """the platform's copies first, then the workspace's own; each by channel (All Channels, Email, Text, WhatsApp) and period"""
    order = ["ALL", *CHANNELS]
    rows = [_row(p) for p in CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True)]
    return sorted(rows, key=lambda row: (not row["platform"], order.index(row["channel"]) if row["channel"] in order else len(order), row["period_days"], row["max_messages"]))


def activity(tenant_id, days: int = 30) -> dict:
    """What the rules did to marketing and transactional sends alike over the last `days` days: people checked, sent, skipped by a cap."""
    since = timezone.now() - timezone.timedelta(days=days)
    with connection.cursor() as cursor:
        cursor.execute("""SELECT count(*), count(*) FILTER (WHERE status IN ('ELIGIBLE', 'SENT')), count(*) FILTER (WHERE suppression_reason = 'FREQUENCY_CAP')
                            FROM campaign_list_member WHERE tenant_id = %s AND created_at >= %s""", [str(tenant_id), since])
        checked, sent, capped = cursor.fetchone()
    return {"days": days, "checked": checked, "sent": sent, "capped": capped,
            "sent_percent": round(100.0 * sent / checked, 1) if checked else None}


def overview(tenant_id) -> dict:
    from apps.delivery.engine.events import SOFT_BOUNCE_BLOCK_AFTER
    from apps.platform_ops import params
    window = params.get("messaging.sms_quiet_hours", {}) or {}
    quiet = {"start": window["start"], "end": window["end"]} if isinstance(window, dict) and window.get("start") and window.get("end") and window["start"] != window["end"] else None
    return {"caps": caps(tenant_id), "activity": activity(tenant_id), "text_quiet_hours": quiet, "soft_bounces": SOFT_BOUNCE_BLOCK_AFTER}


def _clean(data: dict) -> dict:
    channel = str(data.get("channel") or "").upper()
    if channel not in ("ALL", *CHANNELS):
        raise GovernanceError("channel", "Choose Email, Text, WhatsApp or All Channels.")
    values = {}
    for field, top, label in (("max_messages", MAX_MESSAGES, "The most"), ("period_days", MAX_PERIOD_DAYS, "The period")):
        try:
            number = int(data.get(field))
        except (TypeError, ValueError):
            raise GovernanceError(field, f"{label} is a whole number.") from None
        if not 1 <= number <= top:
            raise GovernanceError(field, f"{label} is between 1 and {top:,}.")
        values[field] = number
    values["scope"], values["channel"] = ("GLOBAL", None) if channel == "ALL" else ("CHANNEL", channel)
    if "is_active" in data:
        values["is_active"] = bool(data["is_active"])
    return values


def _name(tenant_id, values: dict, exclude=None) -> str:
    base = rule(values["max_messages"], values["period_days"], values["channel"])
    base = base[0].upper() + base[1:]
    taken = set(CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).exclude(pk=exclude).values_list("name", flat=True))
    name, number = base, 2
    while name in taken:
        name, number = f"{base} ({number})", number + 1
    return name


def _own(tenant_id, policy_id) -> CommunicationGovernancePolicy:
    policy = CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, pk=policy_id, deleted_at__isnull=True).first()
    if policy is None:
        raise LookupError("No such cap.")
    if policy.platform_policy_id is not None:
        raise Locked(LOCKED_MESSAGE)
    return policy


def add_cap(tenant_id, data: dict, user_id) -> dict:
    values = _clean(data)
    policy = CommunicationGovernancePolicy.objects.create(tenant_id=tenant_id, name=_name(tenant_id, values), applies_to="MARKETING", priority=100,
                                                         created_by_id=user_id, **values)
    return _row(policy)


def change_cap(tenant_id, policy_id, data: dict, user_id) -> dict:
    policy = _own(tenant_id, policy_id)
    values = _clean({"channel": _row(policy)["channel"], "max_messages": policy.max_messages, "period_days": policy.period_days, **data})
    for field, value in values.items():
        setattr(policy, field, value)
    policy.name, policy.updated_by_id = _name(tenant_id, values, exclude=policy.pk), user_id
    policy.save(update_fields=[*values, "name", "updated_by"])
    return _row(policy)


def remove_cap(tenant_id, policy_id, user_id) -> None:
    policy = _own(tenant_id, policy_id)
    policy.deleted_at, policy.is_active, policy.updated_by_id = timezone.now(), False, user_id
    policy.save(update_fields=["deleted_at", "is_active", "updated_by"])
