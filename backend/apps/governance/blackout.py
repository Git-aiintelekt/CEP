"""Blackout dates (patch 0093): days with no marketing on any channel, in the workspace's time zone.

A blackout is a governance policy row with blackout_from and blackout_to (one day when they match, at most 31 days), named by
`name` ("Christmas"). blackout_yearly repeats it on the same dates every year; a range may cross the new year (24 December to
2 January). The platform's blackouts (locked copies) and the workspace's own all apply. A marketing run due on one waits for
the next day that is not blacked out, and then for its send window (apps/governance/windows.py); it is never skipped.
Transactional messages, e-receipts and test sends to testers never wait.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

MAX_DAYS = 31
LOOK_AHEAD_DAYS = 400                                        # a year of yearly dates and a month of range; past that, nothing holds


def _in_year(day: date, year: int) -> date:
    """the same month and day in another year; 29 February becomes the 28th in a year without one"""
    try:
        return day.replace(year=year)
    except ValueError:
        return day.replace(year=year, day=28)


@dataclass(frozen=True)
class Blackout:
    start: date
    end: date
    yearly: bool = False
    name: str = ""

    def covers(self, day: date) -> bool:
        if not self.yearly:
            return self.start <= day <= self.end
        span = self.end - self.start
        for year in (day.year - 1, day.year):                  # a yearly range opened last year may run into this one
            start = _in_year(self.start, year)
            if start <= day <= start + span:
                return True
        return False

    def next_start(self, after: date) -> date | None:
        """the first day of its next occurrence on or after `after`, or None for a one-off date that has passed"""
        if not self.yearly:
            return self.start if self.end >= after else None
        for year in (after.year - 1, after.year, after.year + 1):
            start = _in_year(self.start, year)
            if start + (self.end - self.start) >= after:
                return start
        return None


def blacked_out(blackouts: list[Blackout], day: date) -> Blackout | None:
    return next((b for b in blackouts if b.covers(day)), None)


def next_clear_day(blackouts: list[Blackout], day: date) -> date:
    """`day` itself when no blackout covers it, otherwise the first day after that none does"""
    for offset in range(LOOK_AHEAD_DAYS):
        candidate = day + timedelta(days=offset)
        if blacked_out(blackouts, candidate) is None:
            return candidate
    return day


def rows(cursor, tenant_id) -> list[Blackout]:
    """The workspace's active blackouts (its own and the platform's copies), on the caller's cursor, under row-level security."""
    cursor.execute("""SELECT blackout_from, blackout_to, blackout_yearly, name FROM communication_governance_policy
                       WHERE tenant_id = %s AND is_active AND deleted_at IS NULL AND blackout_from IS NOT NULL""", [str(tenant_id)])
    return [Blackout(start, end, bool(yearly), label) for start, end, yearly, label in cursor.fetchall()]


def describe(start: date, end: date, yearly: bool) -> str:
    """'25 Dec, every year' / '24 Dec – 2 Jan, every year' / '1 Jan 2027' / '24 Dec 2026 – 2 Jan 2027'"""
    if yearly:
        when = f"{start.day} {start:%b}" if start == end else f"{start.day} {start:%b} – {end.day} {end:%b}"
        return f"{when}, every year"
    if start == end:
        return f"{start.day} {start:%b %Y}"
    if start.year == end.year:
        return f"{start.day} {start:%b} – {end.day} {end:%b %Y}"
    return f"{start.day} {start:%b %Y} – {end.day} {end:%b %Y}"
