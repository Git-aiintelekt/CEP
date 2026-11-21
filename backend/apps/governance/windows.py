"""Send windows (patch 0092): when marketing of a channel may go out, in the workspace's time zone.

A window is a governance policy row with window_start, window_end and window_days (ISO weekdays, 1 = Monday). It runs from
start to end, past midnight when the end is the earlier time (22:00 to 02:00); its day is the day it opens. The platform's
windows (locked copies) and the workspace's own all apply, so a message may go out only when it is inside every one of
them. A marketing run due outside waits (apps/delivery/engine/runs.py starts it once the windows open); it is never skipped.
Texts cover SMS and MMS. Test sends to testers and transactional messages never wait.

A workspace with no text window keeps the platform's older quiet hours for texts (global parameter messaging.sms_quiet_hours).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

DAY_NAMES = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}
EVERY_DAY = (1, 2, 3, 4, 5, 6, 7)
CHANNELS = ("EMAIL", "SMS", "WHATSAPP")
# the hours a workspace's own window starts at when it is switched on
RECOMMENDED = {"EMAIL": ("07:00", "21:00"), "SMS": ("09:00", "20:00"), "WHATSAPP": ("09:00", "20:00")}
LOOK_AHEAD_DAYS = 8


@dataclass(frozen=True)
class Window:
    start: time
    end: time
    days: tuple[int, ...]

    def allows(self, local: datetime) -> bool:
        clock = local.time().replace(second=0, microsecond=0)
        if self.start < self.end:
            return self.start <= clock < self.end and local.isoweekday() in self.days
        if clock >= self.start:                                  # the evening part, on the day it opened
            return local.isoweekday() in self.days
        if clock < self.end:                                     # past midnight: it opened the day before
            return (local - timedelta(days=1)).isoweekday() in self.days
        return False


def channel_family(channel: str | None) -> str:
    """the channel a window is set for: MMS shares the texts' window"""
    return "SMS" if channel in ("SMS", "MMS") else (channel or "EMAIL")


def parse_time(value) -> time:
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0)
    return datetime.strptime(str(value).strip()[:5], "%H:%M").time()


def describe(start: time, end: time, days) -> str:
    """'07:00–21:00, every day' / '10:00–20:00, Mon–Fri' / '22:00–02:00, Sat, Sun'"""
    days = tuple(sorted(set(days or ())))
    if days == EVERY_DAY:
        which = "every day"
    elif days == (1, 2, 3, 4, 5):
        which = "Mon–Fri"
    elif days == (6, 7):
        which = "weekends"
    else:
        which = ", ".join(DAY_NAMES[d] for d in days)
    return f"{start:%H:%M}–{end:%H:%M}, {which}"


def allowed(windows: list[Window], local: datetime) -> bool:
    return all(window.allows(local) for window in windows)


def next_opening(windows: list[Window], local: datetime) -> datetime | None:
    """The first moment from `local` on when every window allows sending: `local` itself when it already does, the moment
    they next open otherwise, None when they never open together within the next week (windows that do not overlap)."""
    if allowed(windows, local):
        return local
    candidates = set()
    for window in windows:
        for offset in range(LOOK_AHEAD_DAYS):
            day = (local + timedelta(days=offset)).date()
            moment = datetime.combine(day, window.start, tzinfo=local.tzinfo)
            if moment > local:
                candidates.add(moment)
    return next((moment for moment in sorted(candidates) if allowed(windows, moment)), None)


def ever_open(windows: list[Window]) -> bool:
    """Do the windows share at least one minute in a week? Checked from each window's opening on each day."""
    monday = datetime(2026, 1, 5)                                 # a Monday; any week will do
    return any(allowed(windows, datetime.combine((monday + timedelta(days=d)).date(), w.start)) for w in windows for d in range(7))


def rows(cursor, tenant_id, channel: str) -> list[Window]:
    """The workspace's active windows for one channel (its own and the platform's copies), on the caller's cursor, under the
    workspace's row-level security."""
    cursor.execute("""SELECT window_start, window_end, window_days FROM communication_governance_policy
                       WHERE tenant_id = %s AND is_active AND deleted_at IS NULL AND window_start IS NOT NULL AND channel = %s""",
                   [str(tenant_id), channel_family(channel)])
    return [Window(parse_time(start), parse_time(end), tuple(days or EVERY_DAY)) for start, end, days in cursor.fetchall()]   # to the minute


def hold_until(cursor, tenant_id, channel: str, tenant_zone: str | None, now: datetime | None = None) -> tuple[datetime | None, str]:
    """When a marketing send of `channel` due `now` may go out: (None, '') to go now, otherwise (the moment the windows
    open, in the workspace's zone, and the words for the run's log). Without windows for texts, the older quiet hours."""
    from django.utils import timezone

    zone = ZoneInfo(tenant_zone or "UTC")
    local = (now or timezone.now()).astimezone(zone)
    family = channel_family(channel)
    windows = rows(cursor, tenant_id, family)
    if not windows:
        if family == "SMS":
            from apps.delivery.engine.runs import quiet_until
            opens = quiet_until(tenant_zone, now=now)
            return (opens, f"Quiet hours for marketing texts: the run starts at {opens:%H:%M} ({tenant_zone}).") if opens else (None, "")
        return None, ""
    opens = next_opening(windows, local)
    if opens == local:
        return None, ""
    noun = {"EMAIL": "emails", "SMS": "texts", "WHATSAPP": "WhatsApp messages"}[family]
    if opens is None:
        return None, ""                                           # windows that never meet do not hold a send forever; the page refuses them
    return opens, f"Outside the send window for marketing {noun}: the run starts {opens:%a %d %b %H:%M} ({tenant_zone})."
