"""The time zones a workspace can be set to: the reference_code rows of code set 'tenant.timezone' (patch 0085), each an IANA
zone with a place people recognise, shown with its offset as it is today, so summer time is right:

    choices(current)  -> [("America/New_York", "(UTC−05:00) Eastern Time (US & Canada)"), ...]

Before the patch, the short list the onboarding flow always had. A workspace already on a value outside the list (an
abbreviation such as "EST", which has no summer time) keeps it, marked, until someone chooses a place.
"""
import zoneinfo
from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.db import DatabaseError

CODE_SET = "tenant.timezone"
FALLBACK = (("UTC", "Coordinated Universal Time (UTC)"), ("America/New_York", "Eastern Time (US & Canada)"), ("America/Chicago", "Central Time (US & Canada)"),
            ("America/Denver", "Mountain Time (US & Canada)"), ("America/Los_Angeles", "Pacific Time (US & Canada)"), ("America/Toronto", "Toronto"),
            ("Europe/London", "London"), ("Europe/Paris", "Paris"), ("Europe/Berlin", "Berlin"), ("Asia/Kolkata", "India (Mumbai, New Delhi)"),
            ("Asia/Dubai", "Dubai"), ("Asia/Singapore", "Singapore"), ("Australia/Sydney", "Sydney, Melbourne"))


def offset(zone: str, now: datetime | None = None) -> str:
    """'(UTC−05:00)': the zone's offset at this moment"""
    try:
        delta = (now or datetime.now(dt_timezone.utc)).astimezone(zoneinfo.ZoneInfo(zone)).utcoffset()
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        return ""
    minutes = int(delta.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "−"
    return f"(UTC{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d})"


def listed() -> list[tuple[str, str]]:
    """(zone, place) in the table's order; the fallback before patch 0085"""
    from apps.audit.models import ReferenceCode
    try:
        rows = list(ReferenceCode.objects.using(settings.PLATFORM_ALIAS).filter(code_set=CODE_SET, is_active=True)
                    .order_by("sort_order", "label").values_list("code", "label"))
    except DatabaseError:
        rows = []
    return rows or list(FALLBACK)


def choices(current: str | None = None) -> list[tuple[str, str]]:
    now = datetime.now(dt_timezone.utc)
    out = [(zone, f"{offset(zone, now)} {place}".strip()) for zone, place in listed()]
    if current and current not in {zone for zone, _ in out}:
        out.insert(0, (current, f"{current}: not in the list, choose a place"))
    return out


def is_known(zone: str) -> bool:
    try:
        zoneinfo.ZoneInfo(zone)
        return True
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        return False
