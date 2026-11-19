"""The upgrade notice every signed-in person sees, in every workspace: before, during and just after a release is installed.

The state is one global parameter, platform.upgrade (an OBJECT), written by the back-office (Platform → Scheduled Upgrade)
and by the install script (manage.py upgrade_notice start | done):

    NONE        nothing planned
    SCHEDULED   starts_at (UTC), minutes, note: the app shows an amber strip until it starts
    UPGRADING   set just before the services restart: the app dims under "Upgrade in Progress" and reconnects by itself
    DONE        version: shown for an hour; the app offers Reload when its own build is older

public() is what GET /platform-status/ answers, with stale states put right: a schedule long past, or an upgrade nobody
marked done, stops showing on its own so no workspace is left with a strip or a card that never goes away.
"""
import json
from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db import connections
from django.utils import timezone

from . import params

KEY = "platform.upgrade"
STATES = ("NONE", "SCHEDULED", "UPGRADING", "DONE")
DONE_SHOWN = timedelta(hours=1)
NOTE_MAX = 200


class UpgradeError(ValueError):
    pass


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        when = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return when if when.tzinfo else when.replace(tzinfo=dt_timezone.utc)


def stored(fresh: bool = False) -> dict:
    """The kept state: from the parameters (cached a minute) for the status call, or fresh from the row before changing it."""
    if fresh:
        with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
            cursor.execute("SELECT value FROM platform_setting WHERE key = %s", [KEY])
            found = cursor.fetchone()
        value = found[0] if found else None
    else:
        value = params.get(KEY, None)
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = None
    return value if isinstance(value, dict) and value.get("state") in STATES else {"state": "NONE"}


def _stale_after(minutes) -> timedelta:
    return timedelta(minutes=max(60, 3 * int(minutes or 0)))


def public(now: datetime | None = None, state: dict | None = None) -> dict:
    """What the app is told: the state (or the one given), put right when it is stale."""
    now = now or timezone.now()
    data = state if state is not None else stored()
    state = data["state"]
    starts_at, changed_at = _parse(data.get("starts_at")), _parse(data.get("changed_at"))
    minutes = int(data.get("minutes") or 0) or None
    if state == "SCHEDULED" and (starts_at is None or now > starts_at + _stale_after(minutes)):
        state = "NONE"
    elif state == "UPGRADING" and (changed_at is None or now > changed_at + _stale_after(minutes)):
        state = "NONE"
    elif state == "DONE" and (changed_at is None or now > changed_at + DONE_SHOWN):
        state = "NONE"
    if state == "NONE":
        return {"state": "NONE"}
    out = {"state": state, "starts_at": starts_at.isoformat() if starts_at else None, "minutes": minutes, "note": data.get("note") or "",
           "changed_at": changed_at.isoformat() if changed_at else None}
    if state == "DONE":
        out["version"] = data.get("version") or ""
    return out


def _write(data: dict, user_id=None) -> dict:
    data = {**data, "changed_at": timezone.now().isoformat()}
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute(
            """INSERT INTO platform_setting (key, value, value_type, category, description, updated_by, updated_at)
               VALUES (%s, %s::jsonb, 'OBJECT', 'Platform', %s, %s, now())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()""",
            [KEY, json.dumps(data), "The upgrade notice people see in every workspace (Platform → Scheduled Upgrade; manage.py upgrade_notice)", user_id])
    params.invalidate()
    return data


def local_start(text: str, zone: str) -> datetime:
    """'2026-11-20T22:00' in a time zone -> an aware datetime; refused when it cannot be read or is in the past."""
    try:
        tz = ZoneInfo(zone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        raise UpgradeError(f"{zone} is not a time zone. Use a name such as Asia/Singapore or UTC.") from None
    try:
        when = datetime.fromisoformat(str(text).strip())
    except ValueError:
        raise UpgradeError("Give the start as a date and time, such as 2026-11-20 22:00.") from None
    when = when.replace(tzinfo=tz) if when.tzinfo is None else when
    if when < timezone.now() - timedelta(minutes=1):
        raise UpgradeError("The start is in the past. Choose a later time; for an upgrade happening now, mark it as upgrading instead.")
    return when


def schedule(starts_at: datetime, minutes: int, note: str = "", zone: str = "UTC", user_id=None) -> dict:
    if not 1 <= int(minutes) <= 240:
        raise UpgradeError("Say how long it takes, between 1 and 240 minutes.")
    note = " ".join(str(note or "").split())
    if len(note) > NOTE_MAX:
        raise UpgradeError(f"Keep the note under {NOTE_MAX} characters.")
    return _write({"state": "SCHEDULED", "starts_at": starts_at.astimezone(dt_timezone.utc).isoformat(), "minutes": int(minutes), "note": note,
                   "zone": zone}, user_id)


def start(user_id=None) -> dict:
    """Just before the services restart: keeps the schedule's length and note, if there was one."""
    data = stored(fresh=True)
    keep = {k: data[k] for k in ("starts_at", "minutes", "note", "zone") if data.get(k) and data["state"] == "SCHEDULED"}
    return _write({"state": "UPGRADING", "minutes": 10, **keep}, user_id)


def done(version: str = "", user_id=None) -> dict:
    return _write({"state": "DONE", "version": str(version or "").strip()[:40]}, user_id)


def clear(user_id=None) -> dict:
    return _write({"state": "NONE"}, user_id)
