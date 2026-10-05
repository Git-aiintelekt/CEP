"""Date / Time entry rules: when a schedule fires, who enters, and the rule in words.

    rule_definition   {schedule: DAILY | WEEKLY | MONTHLY | SPECIFIC_DATE | DATE_ATTRIBUTE, time: "HH:MM",
                       weekdays: ["MON", ...] (WEEKLY), day_of_month: 1-28 | "LAST" (MONTHLY), date: "YYYY-MM-DD" (SPECIFIC_DATE),
                       attribute, offset_days: -90..90, yearly (DATE_ATTRIBUTE),
                       contact_list_id | segment_id (who enters; optional for DATE_ATTRIBUTE)}

Times are the workspace's time zone (tenant.timezone). The enrollment pass fires a rule's latest moment once it has passed
since the version went live or last fired (journey_version.last_fired_at); a missed moment is not replayed, only the latest
fires. Daily, Weekly, Monthly and Specific Date enter the list's or segment's members at that moment. On a Date Attribute
fires daily at its time for the customers whose date (customer_master.custom_attributes[attribute], "YYYY-MM-DD...") is
`offset_days` away: -7 = 7 days before it. Yearly matches the day and month (29 Feb counts on 28 Feb in other years).
"""
import calendar
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connections

SCHEDULES = ("DAILY", "WEEKLY", "MONTHLY", "SPECIFIC_DATE", "DATE_ATTRIBUTE")
WEEKDAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MAX_OFFSET = 90
DATE_TEXT = r"^\d{4}-\d{2}-\d{2}"

AUDIENCE = {
    "contact_list_id": """
        SELECT m.party_id, %(moment)s::timestamptz AS qualified_at FROM contact_list_member m
          JOIN contact_list l ON l.id = m.contact_list_id AND l.tenant_id = m.tenant_id
         WHERE m.tenant_id = %(tenant)s AND m.contact_list_id::text = %(list)s AND l.deleted_at IS NULL AND l.status = 'ACTIVE'
           AND l.approval_status NOT IN ('AWAITING', 'REFUSED')""",
    "segment_id": """
        SELECT party_id, %(moment)s::timestamptz AS qualified_at FROM customer_segment_membership
         WHERE tenant_id = %(tenant)s AND segment_id::text = %(segment)s""",
    None: """
        SELECT party_id, %(moment)s::timestamptz AS qualified_at FROM customer_master WHERE tenant_id = %(tenant)s""",
}


def tenant_zone(tenant_id) -> ZoneInfo:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("SELECT timezone FROM tenant WHERE id = %s", [str(tenant_id)])
        row = cursor.fetchone()
    try:
        return ZoneInfo((row and row[0]) or "UTC")
    except Exception:                                      # noqa: BLE001  an unknown zone name: UTC rather than no journey
        return ZoneInfo("UTC")


def _time(definition: dict) -> time | None:
    try:
        hours, minutes = str(definition.get("time") or "").split(":")
        return time(int(hours), int(minutes))
    except (TypeError, ValueError):
        return None


def _date(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def audience_key(definition: dict) -> str | None:
    return "contact_list_id" if definition.get("contact_list_id") else "segment_id" if definition.get("segment_id") else None


def problem(definition: dict) -> str | None:
    """What the rule still needs, in words; None when it is complete."""
    schedule = str(definition.get("schedule") or "").upper()
    if schedule not in SCHEDULES:
        return "Choose a schedule."
    if _time(definition) is None:
        return "Choose a time."
    if schedule == "WEEKLY" and not [day for day in definition.get("weekdays") or [] if day in WEEKDAYS]:
        return "Choose at least one weekday."
    if schedule == "MONTHLY" and not (definition.get("day_of_month") == "LAST" or str(definition.get("day_of_month")).isdigit()
                                      and 1 <= int(definition["day_of_month"]) <= 28):
        return "Choose the day of the month."
    if schedule == "SPECIFIC_DATE" and _date(definition.get("date")) is None:
        return "Choose the date."
    if schedule == "DATE_ATTRIBUTE":
        if not definition.get("attribute"):
            return "Choose which date on the customer's record."
        try:
            if abs(int(definition.get("offset_days") or 0)) > MAX_OFFSET:
                return f"Choose at most {MAX_OFFSET} days before or after."
        except (TypeError, ValueError):
            return "Choose how many days before or after."
    elif audience_key(definition) is None:
        return "Choose who enters: a customer list or a segment."
    return None


def _fires_on(definition: dict, day: date) -> bool:
    schedule = str(definition.get("schedule") or "").upper()
    if schedule in ("DAILY", "DATE_ATTRIBUTE"):
        return True
    if schedule == "WEEKLY":
        return WEEKDAYS[day.weekday()] in (definition.get("weekdays") or [])
    if schedule == "MONTHLY":
        last = calendar.monthrange(day.year, day.month)[1]
        wanted = last if definition.get("day_of_month") == "LAST" else int(definition["day_of_month"])
        return day.day == wanted
    if schedule == "SPECIFIC_DATE":
        return day == _date(definition.get("date"))
    return False


def latest_moment(definition: dict, zone: ZoneInfo, now: datetime) -> datetime | None:
    """The newest moment the rule fires at that is not after `now` (looking back up to 62 days, or to its date)."""
    if problem(definition) is not None:
        return None
    at = _time(definition)
    local_now = now.astimezone(zone)
    if str(definition.get("schedule")).upper() == "SPECIFIC_DATE":
        moment = datetime.combine(_date(definition["date"]), at, tzinfo=zone)
        return moment if moment <= local_now else None
    for back in range(0, 63):
        day = local_now.date() - timedelta(days=back)
        moment = datetime.combine(day, at, tzinfo=zone)
        if moment <= local_now and _fires_on(definition, day):
            return moment
    return None


def next_moment(definition: dict, zone: ZoneInfo, now: datetime) -> datetime | None:
    """The first moment after `now` (for Test Publish's sample: who would enter next)."""
    if problem(definition) is not None:
        return None
    at = _time(definition)
    local_now = now.astimezone(zone)
    for ahead in range(0, 400):
        day = local_now.date() + timedelta(days=ahead)
        moment = datetime.combine(day, at, tzinfo=zone)
        if moment > local_now and _fires_on(definition, day):
            return moment
    return None


def candidates(definition: dict, args: dict, moment: datetime, zone: ZoneInfo) -> str:
    """SQL of (party_id, qualified_at) entering at `moment`; fills `args`."""
    key = audience_key(definition)
    args["moment"] = moment
    if key == "contact_list_id":
        args["list"] = str(definition["contact_list_id"])
    elif key == "segment_id":
        args["segment"] = str(definition["segment_id"])
    sql = AUDIENCE[key]
    if str(definition.get("schedule")).upper() != "DATE_ATTRIBUTE":
        return sql
    target = moment.astimezone(zone).date() - timedelta(days=int(definition.get("offset_days") or 0))
    args["attribute"] = str(definition["attribute"])
    args["date_text"] = DATE_TEXT
    if definition.get("yearly", True):
        days = [target.strftime("%m-%d")]
        if target.month == 2 and target.day == 28 and not calendar.isleap(target.year):
            days.append("02-29")
        args["month_days"] = days
        match = "substring(cm.custom_attributes ->> %(attribute)s from 6 for 5) = ANY(%(month_days)s)"
    else:
        args["full_date"] = target.isoformat()
        match = "left(cm.custom_attributes ->> %(attribute)s, 10) = %(full_date)s"
    return f"""
        SELECT a.party_id, a.qualified_at FROM ({sql}) a
          JOIN customer_master cm ON cm.tenant_id = %(tenant)s AND cm.party_id = a.party_id
         WHERE (cm.custom_attributes ->> %(attribute)s) ~ %(date_text)s AND {match}"""


DATE_ATTRIBUTES_SQL = """
SELECT e.key, count(*) FROM customer_master cm, jsonb_each_text(cm.custom_attributes) AS e(key, value)
 WHERE cm.tenant_id = %s AND jsonb_typeof(cm.custom_attributes) = 'object' AND e.value ~ %s
 GROUP BY e.key ORDER BY count(*) DESC, e.key LIMIT 50"""


def date_attributes(tenant_id) -> list[dict]:
    """[{key, label, customers}], cached for ten minutes: one pass over the workspace's customer records."""
    from django.core.cache import cache

    from apps.delivery.engine import session
    key = f"journeys:date-attributes:{tenant_id}"
    found = cache.get(key)
    if found is None:
        with session.tx(), session.connection().cursor() as cursor:
            cursor.execute(DATE_ATTRIBUTES_SQL, [str(tenant_id), DATE_TEXT])
            found = [{"key": name, "label": attribute_label(name), "customers": count} for name, count in cursor.fetchall()]
        cache.set(key, found, 600)
    return found


def _clock(definition: dict) -> str:
    at = _time(definition)
    if at is None:
        return "a time not chosen yet"
    return f"{(at.hour % 12) or 12}:{at.minute:02d} {'AM' if at.hour < 12 else 'PM'}"


def attribute_label(key: str) -> str:
    return str(key or "").replace("_", " ").strip().title()


def describe(definition: dict, audience_name: str | None = None) -> str:
    """'Every Monday at 9:00 AM, the members of VIP Customers' — the rule as Setup's summary line and Test Publish say it."""
    schedule = str(definition.get("schedule") or "").upper()
    clock = _clock(definition)
    if schedule == "DAILY":
        when = f"Every day at {clock}"
    elif schedule == "WEEKLY":
        names = [WEEKDAY_NAMES[WEEKDAYS.index(day)] for day in WEEKDAYS if day in (definition.get("weekdays") or [])]
        days = " and ".join([", ".join(names[:-1]), names[-1]]) if len(names) > 1 else (names[0] if names else "a day not chosen yet")
        when = f"Every {days} at {clock}"
    elif schedule == "MONTHLY":
        day = definition.get("day_of_month")
        when = f"On the last day of every month at {clock}" if day == "LAST" else f"On day {day} of every month at {clock}"
    elif schedule == "SPECIFIC_DATE":
        chosen = _date(definition.get("date"))
        when = f"On {chosen.strftime('%b')} {chosen.day}, {chosen.year} at {clock}" if chosen else f"On a date not chosen yet at {clock}"
    elif schedule == "DATE_ATTRIBUTE":
        offset = int(definition.get("offset_days") or 0)
        relation = "on" if offset == 0 else f"{abs(offset)} day{'s' if abs(offset) != 1 else ''} {'before' if offset < 0 else 'after'}"
        text = f"{relation} each customer’s {attribute_label(definition.get('attribute')) or 'date'}, at {clock}"
        when = f"Every year, {text}" if definition.get("yearly", True) else text[0].upper() + text[1:]
    else:
        return "a date/time schedule"
    if audience_key(definition) == "contact_list_id":
        who = f"the members of {audience_name or 'a customer list'}"
    elif audience_key(definition) == "segment_id":
        who = f"customers in {audience_name or 'a segment'}"
    else:
        who = "every customer with that date"
    return f"{when}, {who}"
