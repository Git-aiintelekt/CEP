"""A workspace's Governance page (Settings → Engagement → Governance): its frequency caps and its gaps between messages (the
platform's copies, locked, and its own), the rules the send engine applies besides them, and what they did in the last 30 days.

Every cap and gap applies: a person who has reached any cap, or received a marketing message of the channel within a gap, is
skipped by a marketing send (apps/delivery/engine/audience*.py, reason FREQUENCY_CAP). A gap is a policy row with gap_hours
(patch 0089): one message counted over hours. A workspace's own rules therefore only ever make sending stricter than the
platform's. A workspace has at most one gap of its own per channel.
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
MAX_GAP_HOURS = 168


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


def gap_rule(hours: int, channel: str | None) -> str:
    return f"{hours} hour{'s' if hours != 1 else ''} between {WORDS.get(channel, WORDS[None])[1]}"


def _describe(values: dict) -> str:
    if values.get("gap_hours"):
        return gap_rule(values["gap_hours"], values["channel"])
    return rule(values["max_messages"], values["period_days"], values["channel"])


def _row(policy: CommunicationGovernancePolicy) -> dict:
    channel = None if policy.scope == "GLOBAL" else (policy.channel or "EMAIL")
    return {"id": str(policy.pk), "name": policy.name, "channel": channel or "ALL", "channel_label": CHANNELS.get(channel, "All Channels"),
            "max_messages": policy.max_messages, "period_days": policy.period_days, "rule": rule(policy.max_messages, policy.period_days, channel),
            "is_active": policy.is_active, "platform": policy.platform_policy_id is not None, "row_version": policy.row_version}


def caps(tenant_id) -> list[dict]:
    """the platform's copies first, then the workspace's own; each by channel (All Channels, Email, Text, WhatsApp) and period"""
    order = ["ALL", *CHANNELS]
    rows = [_row(p) for p in CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True, gap_hours__isnull=True)]
    return sorted(rows, key=lambda row: (not row["platform"], order.index(row["channel"]) if row["channel"] in order else len(order), row["period_days"], row["max_messages"]))


def _gap_row(policy: CommunicationGovernancePolicy) -> dict:
    return {"id": str(policy.pk), "name": policy.name, "hours": policy.gap_hours, "rule": gap_rule(policy.gap_hours, policy.channel or "EMAIL"),
            "is_active": policy.is_active, "platform": policy.platform_policy_id is not None, "row_version": policy.row_version}


def _covering_cap(hours: int, channel: str, cap_rows: list[dict]) -> str | None:
    """an active cap of one message that already keeps at least `hours` between this channel's messages, so the gap adds nothing"""
    for cap in cap_rows:
        if cap["is_active"] and cap["max_messages"] == 1 and cap["channel"] in (channel, "ALL") and cap["period_days"] * 24 >= hours:
            return cap["rule"]
    return None


def gaps(tenant_id, cap_rows: list[dict] | None = None) -> list[dict]:
    """One entry per channel: the workspace's own gap (or none), the platform's, and the hours recommended for a new one."""
    from apps.governance.standard import GAPS
    cap_rows = caps(tenant_id) if cap_rows is None else cap_rows
    policies = list(CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True, gap_hours__isnull=False, scope="CHANNEL").order_by("created_at"))
    entries = []
    for channel, label in CHANNELS.items():
        mine = [p for p in policies if (p.channel or "EMAIL") == channel]
        own = next((p for p in mine if p.platform_policy_id is None), None)
        entries.append({"channel": channel, "channel_label": label, "recommended_hours": GAPS[channel], "own": _gap_row(own) if own else None,
                        "platform": [_gap_row(p) for p in mine if p.platform_policy_id is not None],
                        "covered_by": _covering_cap(own.gap_hours, channel, cap_rows) if own and own.is_active else None})
    return entries


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
    cap_rows = caps(tenant_id)
    return {"caps": cap_rows, "gaps": gaps(tenant_id, cap_rows), "activity": activity(tenant_id), "text_quiet_hours": quiet,
            "soft_bounces": SOFT_BOUNCE_BLOCK_AFTER}


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


def _name(tenant_id, values: dict, exclude=None, using: str = "default") -> str:
    base = _describe(values)
    base = base[0].upper() + base[1:]
    taken = set(CommunicationGovernancePolicy.objects.using(using).filter(tenant_id=tenant_id, deleted_at__isnull=True).exclude(pk=exclude).values_list("name", flat=True))
    name, number = base, 2
    while name in taken:
        name, number = f"{base} ({number})", number + 1
    return name


def _own(tenant_id, policy_id) -> CommunicationGovernancePolicy:
    policy = CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, pk=policy_id, deleted_at__isnull=True, gap_hours__isnull=True).first()
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


def set_gap(tenant_id, channel: str, data: dict, user_id) -> dict:
    """The workspace's own gap for one channel, made or changed: {hours, is_active}. Returns that channel's entry of gaps()."""
    channel = str(channel or "").upper()
    if channel not in CHANNELS:
        raise LookupError("No such channel.")
    own = CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True, gap_hours__isnull=False, platform_policy_id__isnull=True,
                                                       scope="CHANNEL", channel=channel).order_by("created_at").first()
    try:
        hours = int(data.get("hours", own.gap_hours if own else None))
    except (TypeError, ValueError):
        raise GovernanceError("hours", "The gap is a whole number of hours.") from None
    if not 1 <= hours <= MAX_GAP_HOURS:
        raise GovernanceError("hours", f"The gap is between 1 and {MAX_GAP_HOURS} hours (7 days).")
    values = {"scope": "CHANNEL", "channel": channel, "max_messages": 1, "period_days": 1, "gap_hours": hours}
    if "is_active" in data:
        values["is_active"] = bool(data["is_active"])
    name = _name(tenant_id, values, exclude=own.pk if own else None)
    if own is None:
        CommunicationGovernancePolicy.objects.create(tenant_id=tenant_id, name=name, applies_to="MARKETING", priority=100, created_by_id=user_id, **values)
    else:
        for field, value in values.items():
            setattr(own, field, value)
        own.name, own.updated_by_id = name, user_id
        own.save(update_fields=[*values, "name", "updated_by"])
    return next(entry for entry in gaps(tenant_id) if entry["channel"] == channel)


def add_standard(tenant_id, user_id) -> dict:
    """the recommended caps for the channels the workspace does not cap yet (apps/governance/standard.py)"""
    from apps.governance import standard
    added = standard.workspace_caps(tenant_id, user_id=user_id)
    return {"added": added, "caps": caps(tenant_id)}
