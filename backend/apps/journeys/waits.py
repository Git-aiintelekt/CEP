"""Wait steps beyond a duration (apps.journeys.engine.steps WAIT):

    {mode: TIME_OF_DAY, time: "HH:MM", zone: CUSTOMER | WORKSPACE, weekdays: ["MON", ...] | []}
        the customer continues at the next `time` on an allowed day (every day when weekdays is empty), in their own time
        zone when their record has one (customer_master.custom_attributes.timezone, an IANA name such as America/Chicago,
        from the C360 sync or the upload template's Time zone column) and zone is CUSTOMER, else the workspace's zone.
    {mode: DATE_ATTRIBUTE, attribute, offset_days: -365..365, time: "HH:MM", zone, if_passed: CONTINUE | EXIT}
        the customer continues at `time` on the day `offset_days` from the date on their record
        (custom_attributes[attribute], "YYYY-MM-DD..."); when that moment has already passed, or the record has no usable
        date, they continue at once (CONTINUE) or leave the journey (EXIT, exited early with the reason).

A wait without `mode` (or mode DURATION) is the duration wait steps.wait_seconds reads. Nothing here sends: the step
only says when to look again (Hold) or that the customer moves on (Done) or leaves (Finish).
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from . import schedule
from .engine.outcome import Done, Finish, Hold

MODES = ("DURATION", "TIME_OF_DAY", "DATE_ATTRIBUTE")
ZONES = ("CUSTOMER", "WORKSPACE")
IF_PASSED = ("CONTINUE", "EXIT")
MAX_OFFSET = 365
TIMEZONE_ATTRIBUTE = "timezone"
NO_DATE = "No date on the record"
DATE_PASSED = "The date has passed"


def mode_of(config: dict) -> str:
    found = str(config.get("mode") or "DURATION").upper()
    return found if found in MODES else "UNKNOWN"


def problem(config: dict) -> str | None:
    """What a timed wait still needs, in words; None when it is complete. Blanks on a duration wait are left to readiness."""
    mode = mode_of(config)
    if mode == "UNKNOWN":
        return "mode is DURATION, TIME_OF_DAY or DATE_ATTRIBUTE."
    if mode == "DURATION":
        return None
    if schedule._time(config) is None:                   # noqa: SLF001  the same "HH:MM" the Date / Time entry reads
        return "Choose a time of day, as HH:MM."
    if str(config.get("zone") or "CUSTOMER").upper() not in ZONES:
        return "zone is CUSTOMER or WORKSPACE."
    if mode == "TIME_OF_DAY":
        weekdays = config.get("weekdays") or []
        if not isinstance(weekdays, list) or any(day not in schedule.WEEKDAYS for day in weekdays):
            return "weekdays is a list of MON to SUN."
        return None
    attribute = config.get("attribute")
    if not isinstance(attribute, str) or not attribute.strip() or len(attribute) > 100:
        return "Choose which date on the customer's record."
    offset = config.get("offset_days", 0)
    if isinstance(offset, bool) or not isinstance(offset, int) or abs(offset) > MAX_OFFSET:
        return f"offset_days is a whole number from -{MAX_OFFSET} to {MAX_OFFSET}."
    if str(config.get("if_passed") or "CONTINUE").upper() not in IF_PASSED:
        return "if_passed is CONTINUE or EXIT."
    return None


def configured(config: dict) -> bool:
    mode = mode_of(config)
    if mode == "DURATION":
        return config.get("duration") not in (None, "")
    return mode != "UNKNOWN" and problem(config) is None


def customer_zone(attributes: dict | None, fallback: ZoneInfo) -> tuple[ZoneInfo, bool]:
    """(zone, from the customer's record?)"""
    name = str((attributes or {}).get(TIMEZONE_ATTRIBUTE) or "").strip()
    if name:
        try:
            return ZoneInfo(name), True
        except Exception:                                  # noqa: BLE001  an unknown name: the workspace's zone
            pass
    return fallback, False


def next_time_of_day(at: time, weekdays: list[str], zone: ZoneInfo, now: datetime) -> datetime:
    """The first moment at `at` on an allowed day that is not before `now`, in `zone`."""
    local = now.astimezone(zone)
    for ahead in range(0, 8):
        day = local.date() + timedelta(days=ahead)
        moment = datetime.combine(day, at, tzinfo=zone)
        if moment >= local and (not weekdays or schedule.WEEKDAYS[day.weekday()] in weekdays):
            return moment
    return datetime.combine(local.date() + timedelta(days=7), at, tzinfo=zone)


def date_moment(value, offset_days: int, at: time, zone: ZoneInfo) -> datetime | None:
    """`at` on the day `offset_days` from the record's date, or None when the value is not a date."""
    try:
        day = date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None
    return datetime.combine(day + timedelta(days=offset_days), at, tzinfo=zone)


def run(config: dict, state, enrollment, attributes: dict | None, workspace_zone: ZoneInfo) -> Hold | Done | Finish:
    """What a timed wait does for this customer now (steps.py passes the customer's attributes and the workspace's zone)."""
    found = problem(config)
    if found:
        return Done("FAILED", {"reason": found})
    mode = mode_of(config)
    at = schedule._time(config)                           # noqa: SLF001
    wants_customer = str(config.get("zone") or "CUSTOMER").upper() == "CUSTOMER"
    zone, own = customer_zone(attributes, workspace_zone) if wants_customer else (workspace_zone, False)
    now = timezone.now()
    if mode == "TIME_OF_DAY":
        until = next_time_of_day(at, list(config.get("weekdays") or []), zone, max(now, state.entered_node_at))
        if until > now:
            return Hold(until)
        return Done(result={"until": until.isoformat(), "zone": zone.key, "customer_zone": own})
    value = (attributes or {}).get(str(config["attribute"]).strip())
    until = date_moment(value, int(config.get("offset_days") or 0), at, zone)
    exit_instead = str(config.get("if_passed") or "CONTINUE").upper() == "EXIT"
    if until is None:
        if exit_instead:
            return Finish("EXITED", NO_DATE)
        return Done(result={"reason": NO_DATE, "zone": zone.key, "customer_zone": own})
    if until > now:
        return Hold(until)
    if until < state.entered_node_at - timedelta(minutes=1):
        if exit_instead:
            return Finish("EXITED", DATE_PASSED)
        return Done(result={"reason": DATE_PASSED, "until": until.isoformat(), "zone": zone.key, "customer_zone": own})
    return Done(result={"until": until.isoformat(), "zone": zone.key, "customer_zone": own})


def describe(config: dict) -> str:
    """'until 9:00 AM, the customer's time' / 'until 3 days before each customer's Renewal Date, 10:00 AM' (readiness, logs)."""
    mode = mode_of(config)
    clock = schedule._clock(config)                       # noqa: SLF001
    whose = "the customer's time" if str(config.get("zone") or "CUSTOMER").upper() == "CUSTOMER" else "workspace time"
    if mode == "TIME_OF_DAY":
        days = [day for day in schedule.WEEKDAYS if day in (config.get("weekdays") or [])]
        on = "" if not days or len(days) == 7 else f" on {', '.join(schedule.WEEKDAY_NAMES[schedule.WEEKDAYS.index(day)] for day in days)}"
        return f"until {clock}{on}, {whose}"
    if mode == "DATE_ATTRIBUTE":
        offset = int(config.get("offset_days") or 0)
        relation = "on" if offset == 0 else f"{abs(offset)} day{'s' if abs(offset) != 1 else ''} {'before' if offset < 0 else 'after'}"
        return f"until {relation} each customer’s {schedule.attribute_label(config.get('attribute')) or 'date'}, {clock}, {whose}"
    return "for a duration"
