"""Delivery Warm-Up: a new sending IP or domain earns the inboxes' trust by sending a little more each day.

    plan(...)                the days of a plan: the schedule's hourly limits by warm-up age, cut off where the workspace
                             plan's contacts fit in one day
    start / change_days / update / act      what Settings → Delivery Warm-Up does
    hold_run(tenant, run)    runs.start: every marketing email of a warming workspace waits (send_after = 'infinity') ...
    release(tenant)          ... and is let out a few at a time within the hour's limit, the workspace's own campaigns first
    tick(tenant)             the warm-up job, every minute: closes the day at midnight and judges it, picks the hour's
                             warm-up sends, lets out what the hour allows
    overview(tenant)         the page

The warm-up sends: every hour CEP takes the next people of the day's lists (most engaged first, then in list order), round
after round, so everyone is reached once before anyone twice. Each person gets a template they have not had: the day's,
or else the next one of the plan's templates (then the extra ones). Someone who has had every template is skipped and
counted, so the page can ask for another template. A day's sends of one template are a WARM_UP campaign ("Day 9 · Mid-Season
Sale"), one run an hour through the hidden-list pattern of journeys (apps/journeys/engine/messages.py): the campaign list is
frozen and every governance rule applies at the send.

Everything here runs inside session.tenant_scope(tenant); the job's steps commit on their own.
"""
import logging
import math
import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.delivery.engine import session

log = logging.getLogger("cep.delivery")

# hourly email limit by warm-up age in days (0-41)
SCHEDULE = [20, 28, 39, 55, 77, 108, 151, 211, 295, 413, 579, 810, 1000, 1587, 2222, 3111, 4356, 6098, 8583, 11953, 16734,
            23427, 32798, 45917, 64284, 89998, 125997, 176395, 246953, 345735, 484029, 677640, 948696, 1328175, 1859444, 2603222,
            3644511, 5102316, 7143242, 10000539, 14000754, 19601056]
START_AGE = {"DEDICATED": 0, "SHARED": 7}                 # a shared pool is already warm: only the domain is new
OPEN = ("WARMING", "PAUSED")
BOUNCE_LIMIT, COMPLAINT_LIMIT, JUDGED_FROM = 0.02, 0.001, 50   # a day with fewer sends is judged on complaints and a bounce or two
NOT_SENT = "WARM_UP_DAY_ENDED"
STOPPED_REASON = "WARM_UP_STOPPED"
ENGAGED = """SELECT party_id, max(COALESCE(clicked_at, opened_at)) AS seen FROM mailer_execution
              WHERE tenant_id = %(tenant)s AND opened_at > now() - interval '90 days' GROUP BY party_id"""
PRIMARY_EMAIL = """(SELECT lower(e ->> 'address') FROM jsonb_array_elements(cm.emails) e
                     WHERE COALESCE((e ->> 'is_valid')::boolean, TRUE) AND COALESCE(e ->> 'address', '') <> '' LIMIT 1)"""

_present: set[str] = set()


class WarmupError(ValueError):
    """What the person asked for cannot be done; the message says why."""


def present() -> bool:
    """Patch 0083 is on this workspace's database."""
    alias = session.connection().alias
    if alias in _present:
        return True
    with session.connection().cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.delivery_warmup') IS NOT NULL")
        found = cursor.fetchone()[0]
    if found:
        _present.add(alias)
    return found


def _rows(cursor) -> list[dict]:
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def _one(cursor) -> dict | None:
    rows = _rows(cursor)
    return rows[0] if rows else None


# ---------------------------------------------------------------- the plan
def window_hours(plan_kind: str, window_start: time, window_end: time) -> int:
    if plan_kind == "HOURLY":
        return 24
    start, end = window_start.hour * 60 + window_start.minute, window_end.hour * 60 + window_end.minute
    return max(1, math.ceil((end - start) / 60))


def plan(ip_mode: str, plan_kind: str, window_start: time, window_end: time, contacts: int | None) -> list[dict]:
    """[{day, age, hourly, daily}]: the schedule from the start age, one day per age, until a day's sends reach `contacts`
    (that day's hour is cut to just enough). Without a contact limit the whole schedule."""
    hours = window_hours(plan_kind, window_start, window_end)
    days = []
    for age in range(START_AGE[ip_mode], len(SCHEDULE)):
        hourly = SCHEDULE[age]
        last = bool(contacts) and hourly * hours >= contacts
        if last:
            hourly = max(1, math.ceil(contacts / hours))
        days.append({"day": len(days) + 1, "age": age, "hourly": hourly, "daily": hourly * hours})
        if last:
            break
    return days


def contacts_target(tenant_id) -> tuple[int | None, str | None]:
    """The workspace plan's contacts and the plan's name."""
    from apps.platform_ops import billing
    try:
        found = billing.plan_for(tenant_id) or {}
    except Exception:                                      # noqa: BLE001  (no subscription tables: the whole schedule)
        found = {}
    contacts = found.get("max_contacts")
    return (int(contacts) if contacts else None), found.get("name")


# ---------------------------------------------------------------- reading
def _zone(tenant_id) -> ZoneInfo:
    from apps.tenants.models import Tenant
    name = Tenant.objects.filter(pk=tenant_id).values_list("timezone", flat=True).first() or "UTC"
    try:
        return ZoneInfo(name)
    except (KeyError, ValueError):
        return ZoneInfo("UTC")


def current(cursor, tenant_id, *, lock: bool = False) -> dict | None:
    """The open warm-up, or else the latest one."""
    cursor.execute("SELECT * FROM delivery_warmup WHERE tenant_id = %s ORDER BY (status IN ('WARMING', 'PAUSED')) DESC, started_at DESC LIMIT 1"
                   + (" FOR UPDATE" if lock else ""), [str(tenant_id)])
    return _one(cursor)


def _days(cursor, warmup_id) -> list[dict]:
    cursor.execute("SELECT * FROM delivery_warmup_day WHERE warmup_id = %s ORDER BY day_no", [str(warmup_id)])
    return _rows(cursor)


def _day(cursor, warmup_id, day_no) -> dict | None:
    cursor.execute("SELECT * FROM delivery_warmup_day WHERE warmup_id = %s AND day_no = %s", [str(warmup_id), day_no])
    return _one(cursor)


def _hour(local: datetime) -> tuple[datetime, datetime]:
    start = local.replace(minute=0, second=0, microsecond=0)
    return start, start + timedelta(hours=1)


def _in_window(warmup, local: datetime) -> bool:
    return warmup["plan_kind"] == "HOURLY" or warmup["window_start"] <= local.time().replace(tzinfo=None) < warmup["window_end"]


def _used(cursor, tenant_id, start: datetime, end: datetime) -> int:
    """Email of the workspace let out in this hour (released, or sent without being held: receipts and other transactional mail)."""
    cursor.execute("""SELECT count(*) FROM mailer_execution
                       WHERE tenant_id = %(t)s AND created_at >= %(s)s - interval '8 days'
                         AND ((send_after >= %(s)s AND send_after < %(e)s) OR (send_after IS NULL AND submitted_at >= %(s)s AND submitted_at < %(e)s))""",
                   {"t": str(tenant_id), "s": start, "e": end})
    return cursor.fetchone()[0]


def _held(cursor, tenant_id) -> dict:
    cursor.execute("""SELECT (c.campaign_type = 'WARM_UP'), count(*) FROM mailer_execution e JOIN campaign c ON c.id = e.campaign_id AND c.tenant_id = e.tenant_id
                       WHERE e.tenant_id = %s AND e.status = 'QUEUED' AND e.send_after = 'infinity' GROUP BY 1""", [str(tenant_id)])
    found = dict(cursor.fetchall())
    return {"own": found.get(False, 0), "warm_up": found.get(True, 0)}


# ---------------------------------------------------------------- holding and letting out
def holding(cursor, tenant_id) -> dict | None:
    """The warm-up that holds the workspace's marketing email to its limits (WARMING or PAUSED), or None."""
    if not present():
        return None
    cursor.execute("SELECT * FROM delivery_warmup WHERE tenant_id = %s AND status IN ('WARMING', 'PAUSED')", [str(tenant_id)])
    return _one(cursor)


def hold_run(cursor, tenant_id, run_id) -> int:
    """runs.start, for a marketing email run: while a warm-up is open its messages wait for the pacer. Returns how many."""
    if holding(cursor, tenant_id) is None:
        return 0
    cursor.execute("UPDATE mailer_execution SET send_after = 'infinity' WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED'",
                   [str(tenant_id), str(run_id)])
    held = cursor.rowcount
    if held:
        release(cursor, tenant_id)
    return held


def paced(limit: int, minute: int) -> int:
    """What may have gone out by the end of this minute of the hour: the limit spread evenly, so an hour's mail never leaves at once."""
    return math.ceil(limit * (minute + 1) / 60)


def release(cursor, tenant_id, now: datetime | None = None) -> int:
    """Lets out what this hour still allows: the limit spread over the hour's minutes, the workspace's own campaigns before
    the warm-up's, the oldest first. Nothing outside a daily plan's window; the warm-up's own sends wait while it is paused."""
    warmup = holding(cursor, tenant_id)
    if warmup is None:
        return 0
    now = now or timezone.now()
    local = now.astimezone(_zone(tenant_id))
    if not _in_window(warmup, local):
        return 0
    day = _day(cursor, warmup["id"], warmup["current_day"])
    if day is None:
        return 0
    start, end = _hour(local)
    allowed = paced(day["hourly_limit"], local.minute) - _used(cursor, tenant_id, start, end)
    if allowed <= 0:
        return 0
    cursor.execute("""UPDATE mailer_execution SET send_after = now()
                       WHERE tenant_id = %(t)s AND status = 'QUEUED' AND send_after = 'infinity'
                         AND id IN (SELECT e.id FROM mailer_execution e JOIN campaign c ON c.id = e.campaign_id AND c.tenant_id = e.tenant_id
                                     WHERE e.tenant_id = %(t)s AND e.status = 'QUEUED' AND e.send_after = 'infinity' AND COALESCE(e.variant_key, '') <> 'HOLD'
                                       AND (c.campaign_type <> 'WARM_UP' OR %(warm)s)
                                     ORDER BY (c.campaign_type = 'WARM_UP'), e.created_at, e.id LIMIT %(n)s)""",
                   {"t": str(tenant_id), "n": allowed, "warm": warmup["status"] == "WARMING"})
    return cursor.rowcount


def _release_all(cursor, tenant_id, reason: str) -> None:
    """The warm-up is over: the CEP's own warm-up sends still waiting are not sent, everything else goes as soon as it may."""
    cursor.execute("""UPDATE mailer_execution e SET status = 'FAILED', not_sent_reason = %s, status_reason = 'The warm-up ended before it went out', send_after = NULL
                        FROM campaign c WHERE c.id = e.campaign_id AND c.tenant_id = e.tenant_id AND c.campaign_type = 'WARM_UP'
                         AND e.tenant_id = %s AND e.status = 'QUEUED' AND e.send_after = 'infinity'""", [reason, str(tenant_id)])
    cursor.execute("UPDATE mailer_execution SET send_after = NULL WHERE tenant_id = %s AND status = 'QUEUED' AND send_after = 'infinity'", [str(tenant_id)])


# ---------------------------------------------------------------- starting and changing
def _usable_templates(cursor, tenant_id, ids) -> dict[str, str]:
    """id -> name of the email templates among `ids` that can be sent: not deleted or archived, with saved content."""
    ids = [str(i) for i in ids if i]
    if not ids:
        return {}
    cursor.execute("""SELECT t.id::text, t.name FROM template_master t
                       WHERE t.tenant_id = %s AND t.id::text = ANY(%s) AND t.deleted_at IS NULL AND t.channel = 'EMAIL' AND t.status <> 'ARCHIVED'
                         AND EXISTS (SELECT 1 FROM rendered_template_content r WHERE r.template_id = t.id AND COALESCE(r.html_content, r.text_content, '') <> '')""",
                   [str(tenant_id), ids])
    return dict(cursor.fetchall())


def _check_lists(cursor, tenant_id, list_ids) -> list[str]:
    ids = [str(i) for i in dict.fromkeys(list_ids or [])]
    if not ids:
        raise WarmupError("Choose at least one contact list.")
    cursor.execute("""SELECT id::text FROM contact_list WHERE tenant_id = %s AND id::text = ANY(%s) AND deleted_at IS NULL AND is_master
                         AND status <> 'ARCHIVED' AND list_environment = 'PRODUCTION'""", [str(tenant_id), ids])
    found = {row[0] for row in cursor.fetchall()}
    if len(found) != len(ids):
        raise WarmupError("A list was not found, or it is a test or archived list.")
    return ids


def _check_template(cursor, tenant_id, template_id) -> str:
    if not template_id or str(template_id) not in _usable_templates(cursor, tenant_id, [template_id]):
        raise WarmupError("Choose an email template with saved content.")
    return str(template_id)


def _parse_time(value, default: time) -> time:
    if value in (None, ""):
        return default
    if isinstance(value, time):
        return value
    try:
        return datetime.strptime(str(value)[:5], "%H:%M").time()
    except ValueError:
        raise WarmupError("Use a time like 08:00.") from None


def start(tenant_id, user_id, data: dict) -> dict:
    """Starts a warm-up: the plan sized to the workspace plan, every day with the chosen lists and template."""
    ip_mode, plan_kind, advance = str(data.get("ip_mode") or "DEDICATED").upper(), str(data.get("plan_kind") or "DAILY").upper(), str(data.get("advance_mode") or "AUTO").upper()
    if ip_mode not in START_AGE or plan_kind not in ("HOURLY", "DAILY") or advance not in ("AUTO", "APPROVE"):
        raise WarmupError("Choose how mail leaves, the plan and how the day moves on.")
    window_start, window_end = _parse_time(data.get("window_start"), time(8)), _parse_time(data.get("window_end"), time(21))
    if window_end <= window_start:
        raise WarmupError("The sending window must end after it starts, on the same day.")
    with session.tx(), session.connection().cursor() as cursor:
        if not present():
            raise WarmupError("Delivery Warm-Up needs patch 0083 on this workspace's database.")
        if holding(cursor, tenant_id) is not None:
            raise WarmupError("A warm-up is already running. Stop it before starting another.")
        cursor.execute("""SELECT s.id FROM sender_profile s JOIN delivery_provider p ON p.id = s.delivery_provider_id
                           WHERE s.tenant_id = %s AND s.id::text = %s AND s.deleted_at IS NULL AND s.channel = 'EMAIL' AND p.is_active""",
                       [str(tenant_id), str(data.get("sender_profile") or "")])
        if cursor.fetchone() is None:
            raise WarmupError("Choose an email sender on an active engine.")
        lists = _check_lists(cursor, tenant_id, data.get("list_ids"))
        template = _check_template(cursor, tenant_id, data.get("template_id"))
        contacts, _ = contacts_target(tenant_id)
        days = plan(ip_mode, plan_kind, window_start, window_end, contacts)
        today = timezone.now().astimezone(_zone(tenant_id)).date()
        cursor.execute("""INSERT INTO delivery_warmup (tenant_id, sender_profile_id, ip_mode, plan_kind, window_start, window_end, advance_mode, day_started_on,
                                                       contacts_target, started_by, updated_by)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                       [str(tenant_id), str(data["sender_profile"]), ip_mode, plan_kind, window_start, window_end, advance, today, contacts, user_id, user_id])
        warmup_id = cursor.fetchone()[0]
        for day in days:
            cursor.execute("""INSERT INTO delivery_warmup_day (warmup_id, day_no, tenant_id, schedule_age, hourly_limit, list_ids, template_id, started_on, updated_by)
                              VALUES (%s, %s, %s, %s, %s, %s::uuid[], %s, %s, %s)""",
                           [str(warmup_id), day["day"], str(tenant_id), day["age"], day["hourly"], lists, template, today if day["day"] == 1 else None, user_id])
    return {"id": str(warmup_id), "days": len(days)}


def change_days(tenant_id, user_id, data: dict) -> int:
    """Today's and later days: other lists, another template, another hourly limit. Days already sent stay as they were."""
    with session.tx(), session.connection().cursor() as cursor:
        warmup = holding(cursor, tenant_id)
        if warmup is None:
            raise WarmupError("There is no warm-up running.")
        total = len(_days(cursor, warmup["id"]))
        try:
            first, last = int(data.get("from_day")), int(data.get("to_day") or data.get("from_day"))
        except (TypeError, ValueError):
            raise WarmupError("Say which days to change.") from None
        if first < warmup["current_day"] or last < first or last > total:
            raise WarmupError(f"Only today's day ({warmup['current_day']}) and later days, up to {total}, can be changed.")
        sets, args = [], []
        if "list_ids" in data:
            sets.append("list_ids = %s::uuid[]")
            args.append(_check_lists(cursor, tenant_id, data["list_ids"]))
        if "template_id" in data:
            sets.append("template_id = %s")
            args.append(_check_template(cursor, tenant_id, data["template_id"]))
        if "hourly_limit" in data:
            try:
                limit = int(data["hourly_limit"])
            except (TypeError, ValueError):
                raise WarmupError("The hourly limit is a whole number.") from None
            if not 1 <= limit <= 50_000_000:
                raise WarmupError("The hourly limit must be at least 1.")
            sets.append("hourly_limit = %s")
            args.append(limit)
        if not sets:
            raise WarmupError("Nothing to change.")
        cursor.execute(f"UPDATE delivery_warmup_day SET {', '.join(sets)}, updated_by = %s, updated_at = now() WHERE warmup_id = %s AND day_no BETWEEN %s AND %s",
                       [*args, user_id, str(warmup["id"]), first, last])
        changed = cursor.rowcount
        cursor.execute("UPDATE delivery_warmup SET updated_at = now(), updated_by = %s, row_version = row_version + 1 WHERE id = %s", [user_id, str(warmup["id"])])
    return changed


def update(tenant_id, user_id, data: dict) -> None:
    """How the day moves on, the sending window, the extra templates for people who have had every day's."""
    with session.tx(), session.connection().cursor() as cursor:
        warmup = holding(cursor, tenant_id)
        if warmup is None:
            raise WarmupError("There is no warm-up running.")
        sets, args = [], []
        if "advance_mode" in data:
            mode = str(data["advance_mode"]).upper()
            if mode not in ("AUTO", "APPROVE"):
                raise WarmupError("Choose Automatic or Approve Each Step.")
            sets.append("advance_mode = %s")
            args.append(mode)
            if mode == "AUTO":
                sets.append("offered_day = NULL")
        if "window_start" in data or "window_end" in data:
            begin, end = _parse_time(data.get("window_start"), warmup["window_start"]), _parse_time(data.get("window_end"), warmup["window_end"])
            if end <= begin:
                raise WarmupError("The sending window must end after it starts, on the same day.")
            sets += ["window_start = %s", "window_end = %s"]
            args += [begin, end]
        if "extra_template_ids" in data:
            wanted = [str(i) for i in dict.fromkeys(data["extra_template_ids"] or [])]
            if len(_usable_templates(cursor, tenant_id, wanted)) != len(wanted):
                raise WarmupError("Every extra template must be an email template with saved content.")
            sets.append("extra_template_ids = %s::uuid[]")
            args.append(wanted)
        if not sets:
            raise WarmupError("Nothing to change.")
        cursor.execute(f"UPDATE delivery_warmup SET {', '.join(sets)}, updated_at = now(), updated_by = %s, row_version = row_version + 1 WHERE id = %s",
                       [*args, user_id, str(warmup["id"])])


def act(tenant_id, user_id, action: str) -> None:
    """approve | stay | back (Approve Each Step), pause | resume, stop."""
    with session.tx(), session.connection().cursor() as cursor:
        warmup = holding(cursor, tenant_id)
        if warmup is None:
            raise WarmupError("There is no warm-up running.")
        wid, day, today = str(warmup["id"]), warmup["current_day"], timezone.now().astimezone(_zone(tenant_id)).date()
        total = len(_days(cursor, wid))
        if action == "approve":
            if not warmup["offered_day"]:
                raise WarmupError("No day is waiting for approval.")
            _move(cursor, warmup, warmup["offered_day"], today, total, user_id)
        elif action == "stay":
            cursor.execute("UPDATE delivery_warmup SET offered_day = NULL, updated_at = now(), updated_by = %s WHERE id = %s", [user_id, wid])
        elif action == "back":
            if day <= 1:
                raise WarmupError("The warm-up is on its first day.")
            _move(cursor, warmup, day - 1, today, total, user_id)
        elif action == "pause":
            if warmup["status"] != "WARMING":
                raise WarmupError("The warm-up is not running.")
            cursor.execute("UPDATE delivery_warmup SET status = 'PAUSED', paused_at = now(), status_note = NULL, updated_at = now(), updated_by = %s WHERE id = %s", [user_id, wid])
        elif action == "resume":
            if warmup["status"] != "PAUSED":
                raise WarmupError("The warm-up is not paused.")
            cursor.execute("""UPDATE delivery_warmup SET status = 'WARMING', paused_at = NULL, status_note = NULL, failed_streak = 0, updated_at = now(), updated_by = %s
                               WHERE id = %s""", [user_id, wid])
        elif action == "stop":
            cursor.execute("""UPDATE delivery_warmup SET status = 'STOPPED', finished_at = now(), offered_day = NULL, status_note = 'Stopped by hand.',
                                     updated_at = now(), updated_by = %s WHERE id = %s""", [user_id, wid])
            _release_all(cursor, tenant_id, STOPPED_REASON)
        else:
            raise WarmupError("Unknown action.")


def _move(cursor, warmup, day_no: int, today: date, total: int, user_id=None) -> None:
    """The plan goes to `day_no`; past the last day the warm-up is finished and every limit goes."""
    wid = str(warmup["id"])
    if day_no > total:
        cursor.execute("""UPDATE delivery_warmup SET status = 'WARM', current_day = %s, offered_day = NULL, finished_at = now(), status_note = NULL,
                                 updated_at = now(), updated_by = %s WHERE id = %s""", [total, user_id, wid])
        _release_all(cursor, warmup["tenant_id"], NOT_SENT)
        return
    cursor.execute("UPDATE delivery_warmup SET current_day = %s, offered_day = NULL, updated_at = now(), updated_by = %s WHERE id = %s", [day_no, user_id, wid])
    cursor.execute("UPDATE delivery_warmup_day SET started_on = COALESCE(started_on, %s) WHERE warmup_id = %s AND day_no = %s", [today, wid, day_no])


# ---------------------------------------------------------------- the day: judged at midnight
def _figures(cursor, tenant_id, start: datetime, end: datetime) -> dict:
    """The workspace's marketing email handed to the engine between `start` and `end`: sent, bounced, complained."""
    cursor.execute("""SELECT count(*), count(*) FILTER (WHERE x.bounced_at IS NOT NULL OR x.status = 'BOUNCED'),
                             count(*) FILTER (WHERE x.complained_at IS NOT NULL OR x.status = 'COMPLAINED')
                        FROM mailer_execution x JOIN campaign c ON c.id = x.campaign_id AND c.tenant_id = x.tenant_id
                       WHERE x.tenant_id = %(t)s AND x.created_at >= %(s)s - interval '8 days' AND x.submitted_at >= %(s)s AND x.submitted_at < %(e)s
                         AND c.solicitation_type = 'MARKETING'""", {"t": str(tenant_id), "s": start, "e": end})
    sent, bounced, complained = cursor.fetchone()
    return {"sent": sent, "bounced": bounced, "complained": complained}


def healthy(figures: dict) -> bool:
    sent, bounced, complained = figures["sent"], figures["bounced"], figures["complained"]
    if sent < JUDGED_FROM:
        return complained == 0 and bounced <= 1
    return bounced / sent <= BOUNCE_LIMIT and complained / sent <= COMPLAINT_LIMIT


def _close_day(cursor, tenant_id, warmup, local: datetime, zone: ZoneInfo) -> dict:
    """Midnight has passed since the day began: judge it, keep or move the plan, drop the warm-up sends it did not get to."""
    wid, today = str(warmup["id"]), local.date()
    start = datetime.combine(warmup["day_started_on"], time.min, zone)
    figures = _figures(cursor, tenant_id, start, datetime.combine(today, time.min, zone))
    ok, quiet = healthy(figures), figures["sent"] == 0
    outcome = "QUIET" if quiet else "DONE" if ok else "HELD"
    cursor.execute("""UPDATE delivery_warmup_day SET sent = %s, bounced = %s, complained = %s, outcome = %s, closed_on = %s
                       WHERE warmup_id = %s AND day_no = %s""",
                   [figures["sent"], figures["bounced"], figures["complained"], outcome, today - timedelta(days=1), wid, warmup["current_day"]])
    cursor.execute("""UPDATE mailer_execution e SET status = 'FAILED', not_sent_reason = %s, status_reason = 'The warm-up day ended before it went out', send_after = NULL
                        FROM campaign c WHERE c.id = e.campaign_id AND c.tenant_id = e.tenant_id AND c.campaign_type = 'WARM_UP'
                         AND e.tenant_id = %s AND e.status = 'QUEUED' AND e.send_after = 'infinity' AND e.created_at < %s""",
                   [NOT_SENT, str(tenant_id), datetime.combine(today, time.min, zone)])
    streak = 0 if ok or quiet else warmup["failed_streak"] + 1
    cursor.execute("UPDATE delivery_warmup SET day_started_on = %s, last_hour_planned = NULL, failed_streak = %s, updated_at = now() WHERE id = %s",
                   [today, streak, wid])
    total = len(_days(cursor, wid))
    day = warmup["current_day"]
    if warmup["status"] != "WARMING":
        return {"closed": day, "outcome": outcome}
    if streak >= 2:
        back = max(1, day - 1)
        _move(cursor, warmup, back, today, total)
        cursor.execute("""UPDATE delivery_warmup SET status = 'PAUSED', paused_at = now(), failed_streak = 0,
                                 status_note = %s WHERE id = %s""",
                       [f"Paused after two days over a health limit (bounces {BOUNCE_LIMIT:.0%}, complaints {COMPLAINT_LIMIT:.1%}); back to day {back}. "
                        "Look at the bounces and complaints of the last campaigns, then resume.", wid])
        return {"closed": day, "outcome": outcome, "paused": True}
    if ok and not quiet:
        if warmup["advance_mode"] == "AUTO":
            _move(cursor, warmup, day + 1, today, total)
        else:
            cursor.execute("UPDATE delivery_warmup SET offered_day = %s WHERE id = %s", [day + 1, wid])
    return {"closed": day, "outcome": outcome}


def _close_campaigns(cursor, tenant_id, today: date) -> int:
    """A warm-up day's campaigns are completed once their date has passed (or the warm-up has ended) and no run is open."""
    cursor.execute("""UPDATE campaign c SET status = 'COMPLETED', completed_at = now(), updated_at = now()
                        FROM delivery_warmup_campaign l JOIN delivery_warmup w ON w.id = l.warmup_id
                       WHERE l.campaign_id = c.id AND l.tenant_id = %s AND c.tenant_id = l.tenant_id AND c.status IN ('PRODUCTION_PUBLISHED', 'ACTIVE')
                         AND (l.sent_on < %s OR w.status NOT IN ('WARMING', 'PAUSED'))
                         AND NOT EXISTS (SELECT 1 FROM campaign_run r WHERE r.campaign_id = c.id AND r.status IN ('SCHEDULED', 'PREPARING', 'SENDING', 'PAUSED'))""",
                   [str(tenant_id), today])
    return cursor.rowcount


# ---------------------------------------------------------------- the hour's warm-up sends
def _pick(cursor, tenant_id, warmup, day, wanted: int, today: date, round_no: int, exclude: list[str]) -> list[str]:
    """The next people of the day's lists in this round: an email address and marketing consent, not yet in the round and not
    yet today; the most engaged first (opened or clicked in 30 days, then 90), then in list order."""
    cursor.execute(f"""
        WITH members AS (
            SELECT DISTINCT ON (m.party_id) m.party_id, m.added_at, m.id AS seq FROM contact_list_member m
             WHERE m.tenant_id = %(t)s AND m.contact_list_id = ANY(%(lists)s::uuid[])
             ORDER BY m.party_id, m.added_at, m.id
        ), engaged AS ({ENGAGED})
        SELECT mb.party_id FROM members mb
          JOIN customer_master cm ON cm.tenant_id = %(t)s AND cm.party_id = mb.party_id
          JOIN consent_suppression cs ON cs.tenant_id = %(t)s AND cs.party_id = mb.party_id AND cs.channel = 'EMAIL'
                                     AND cs.consent_status = 'OPTED_IN' AND NOT COALESCE(cs.suppressed, FALSE)
          LEFT JOIN engaged g ON g.party_id = mb.party_id
         WHERE {PRIMARY_EMAIL} IS NOT NULL AND NOT (mb.party_id = ANY(%(exclude)s))
           AND NOT EXISTS (SELECT 1 FROM delivery_warmup_send s WHERE s.tenant_id = %(t)s AND s.warmup_id = %(w)s AND s.party_id = mb.party_id
                                                                 AND (s.round = %(round)s OR s.sent_on = %(today)s))
         ORDER BY CASE WHEN g.seen > now() - interval '30 days' THEN 0 WHEN g.seen IS NOT NULL THEN 1 ELSE 2 END, mb.added_at, mb.seq
         LIMIT %(n)s""",
                   {"t": str(tenant_id), "tenant": str(tenant_id), "lists": [str(i) for i in day["list_ids"]], "exclude": exclude, "w": str(warmup["id"]),
                    "round": round_no, "today": today, "n": wanted})
    return [row[0] for row in cursor.fetchall()]


def _pool(cursor, tenant_id, warmup, day) -> list[str]:
    """The templates a person may get, in order: the day's, the later days', the earlier days', then the extra ones."""
    days = [d for d in _days(cursor, warmup["id"]) if d["template_id"]]
    later = [d["template_id"] for d in days if d["day_no"] > day["day_no"]] + [d["template_id"] for d in days if d["day_no"] < day["day_no"]]
    order = [str(t) for t in dict.fromkeys([day["template_id"], *later, *(warmup["extra_template_ids"] or [])]) if t]
    usable = _usable_templates(cursor, tenant_id, order)
    return [t for t in order if t in usable]


def assign(pool: list[str], received: dict[str, set[str]], parties: list[str]) -> dict[str, str | None]:
    """party -> the first template of the pool they have not had, or None when they have had them all."""
    return {party: next((t for t in pool if t not in received.get(party, set())), None) for party in parties}


def _received(cursor, warmup_id, parties) -> dict[str, set[str]]:
    cursor.execute("""SELECT party_id, array_agg(DISTINCT template_id::text) FROM delivery_warmup_send
                       WHERE warmup_id = %s AND party_id = ANY(%s) AND template_id IS NOT NULL GROUP BY 1""", [str(warmup_id), parties])
    return {party: set(templates) for party, templates in cursor.fetchall()}


def _campaign(cursor, tenant_id, warmup, day, template_id: str, template_name: str, today: date, total: int):
    """The warm-up campaign of this day, template and date, made on first use."""
    from apps.campaigns.models import Campaign
    wid = str(warmup["id"])
    cursor.execute("SELECT campaign_id FROM delivery_warmup_campaign WHERE warmup_id = %s AND day_no = %s AND sent_on = %s AND template_id = %s",
                   [wid, day["day_no"], today, template_id])
    found = cursor.fetchone()
    if found:
        return Campaign.objects.get(pk=found[0])
    cursor.execute("SELECT 1 FROM delivery_warmup_campaign WHERE warmup_id = %s AND day_no = %s AND template_id = %s", [wid, day["day_no"], template_id])
    again = cursor.fetchone() is not None                  # the day was held and runs again: its date tells the campaigns apart
    now = timezone.now()
    campaign = Campaign.objects.create(
        tenant_id=tenant_id, name=(f"Day {day['day_no']} · {template_name}" + (f" · {today:%d %b}" if again else ""))[:200], campaign_type="WARM_UP", channel="EMAIL",
        status="PRODUCTION_PUBLISHED", solicitation_type="MARKETING", template_id=template_id, sender_profile_id=warmup["sender_profile_id"],
        owner_user_id=warmup["started_by"], code=f"WRM-{today:%Y%m%d}-{uuid.uuid4().hex[:8].upper()}", published_at=now, send_type="IMMEDIATE",
        description=f"Sent by the Delivery Warm-Up: day {day['day_no']} of {total}, {today:%d %b %Y}.")
    cursor.execute("INSERT INTO delivery_warmup_campaign (campaign_id, tenant_id, warmup_id, day_no, sent_on, template_id) VALUES (%s, %s, %s, %s, %s, %s)",
                   [str(campaign.pk), str(tenant_id), wid, day["day_no"], today, template_id])
    return campaign


def _queue(campaign, parties: list[str], label: str) -> bool:
    """Adds the people to the campaign's run that has not started, or opens the next run with a hidden list of its own.
    False while the newest run is being prepared (its audience is being read): they are picked again next hour."""
    from apps.campaigns.models import Campaign, CampaignRun, ContactListCampaign
    from apps.contact_lists.models import ContactList
    Campaign.objects.select_for_update().get(pk=campaign.pk)
    latest = CampaignRun.objects.select_for_update().filter(campaign=campaign).order_by("-run_number").first()
    if latest is not None and latest.status == "PREPARING":
        return False
    link = ContactListCampaign.objects.select_related("contact_list").filter(campaign=campaign, role="INCLUDE").first()
    if latest is not None and latest.status == "SCHEDULED" and link is not None:
        contact_list = link.contact_list
    else:
        ContactListCampaign.objects.filter(campaign=campaign).delete()        # the previous run froze its list: the next one starts empty
        contact_list = ContactList.objects.create(
            tenant_id=campaign.tenant_id, name=f"{campaign.name} {label} {uuid.uuid4().hex[:6]}"[:200], source_type="EXTRACTION",
            source_reference=f"warmup:{campaign.pk}", list_kind="STATIC", is_master=False, status="DRAFT", channel="EMAIL",
            description="People the Delivery Warm-Up picked for this hour.")
        ContactListCampaign.objects.create(campaign=campaign, contact_list=contact_list, tenant_id=campaign.tenant_id, role="INCLUDE")
        number = (latest.run_number if latest is not None else 0) + 1
        CampaignRun.objects.create(campaign=campaign, tenant_id=campaign.tenant_id, run_number=number, run_type="RECURRING_INSTANCE",
                                   scheduled_at=timezone.now(), sequence_label=label)
    with session.connection().cursor() as cursor:
        cursor.execute("""INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id, membership_source, matched_by)
                          SELECT %s, %s, p, 'RULE', 'PARTY_ID' FROM unnest(%s::varchar[]) AS p
                           WHERE NOT EXISTS (SELECT 1 FROM contact_list_member m WHERE m.contact_list_id = %s AND m.party_id = p)""",
                       [str(contact_list.pk), str(campaign.tenant_id), parties, str(contact_list.pk)])
        cursor.execute("UPDATE contact_list SET member_count = (SELECT count(*) FROM contact_list_member WHERE contact_list_id = %s) WHERE id = %s",
                       [str(contact_list.pk), str(contact_list.pk)])
    return True


def _top_up(cursor, tenant_id, warmup, local: datetime) -> dict:
    """Once an hour: what the hour leaves after what went out and what is waiting goes to the next people of the lists."""
    start, end = _hour(local)
    if warmup["status"] != "WARMING" or not _in_window(warmup, local) or (warmup["last_hour_planned"] and warmup["last_hour_planned"] >= start):
        return {}
    days = _days(cursor, warmup["id"])
    day = next((d for d in days if d["day_no"] == warmup["current_day"]), None)
    if day is None:
        return {}
    share = paced(day["hourly_limit"], 59 - local.minute)                    # a warm-up started at 14:40 has a third of the hour
    held = _held(cursor, tenant_id)
    budget = share - _used(cursor, tenant_id, start, end) - held["own"] - held["warm_up"]
    cursor.execute("UPDATE delivery_warmup SET last_hour_planned = %s WHERE id = %s", [start, str(warmup["id"])])
    if budget <= 0 or not day["list_ids"] or not day["template_id"]:
        return {"budget": max(budget, 0), "picked": 0}
    today, round_no = local.date(), warmup["round"]
    picked = [(party, round_no) for party in _pick(cursor, tenant_id, warmup, day, budget, today, round_no, [])]
    if len(picked) < budget:                               # everyone in the lists had this round: the next one begins
        more = _pick(cursor, tenant_id, warmup, day, budget - len(picked), today, round_no + 1, [party for party, _ in picked])
        if more:
            round_no += 1
            cursor.execute("UPDATE delivery_warmup SET round = %s WHERE id = %s", [round_no, str(warmup["id"])])
            picked += [(party, round_no) for party in more]
    if not picked:
        return {"budget": budget, "picked": 0}
    pool = _pool(cursor, tenant_id, warmup, day)
    names = _usable_templates(cursor, tenant_id, pool)
    choice = assign(pool, _received(cursor, warmup["id"], [party for party, _ in picked]), [party for party, _ in picked])
    rounds = dict(picked)
    by_template: dict[str, list[str]] = {}
    for party, template in choice.items():
        if template:
            by_template.setdefault(template, []).append(party)
    label = f"{local:%H}:00"
    skipped = [party for party, template in choice.items() if template is None]
    queued = 0
    for template, parties in by_template.items():
        campaign = _campaign(cursor, tenant_id, warmup, day, template, names[template], today, len(days))
        if not _queue(campaign, parties, label):
            continue
        cursor.execute("""INSERT INTO delivery_warmup_send (tenant_id, warmup_id, party_id, round, day_no, sent_on, template_id, campaign_id)
                          SELECT %s, %s, p.party, p.round, %s, %s, %s, %s FROM unnest(%s::varchar[], %s::int[]) AS p(party, round)""",
                       [str(tenant_id), str(warmup["id"]), day["day_no"], today, template, str(campaign.pk), parties, [rounds[p] for p in parties]])
        queued += len(parties)
    if skipped:
        cursor.execute("""INSERT INTO delivery_warmup_send (tenant_id, warmup_id, party_id, round, day_no, sent_on)
                          SELECT %s, %s, p.party, p.round, %s, %s FROM unnest(%s::varchar[], %s::int[]) AS p(party, round)""",
                       [str(tenant_id), str(warmup["id"]), day["day_no"], today, skipped, [rounds[p] for p in skipped]])
    return {"budget": budget, "picked": len(picked), "queued": queued, "no_template": len(skipped)}


def tick(tenant_id, now: datetime | None = None) -> dict:
    """The warm-up job's pass for one workspace."""
    now = now or timezone.now()
    zone = _zone(tenant_id)
    local = now.astimezone(zone)
    done: dict = {}
    with session.tx(), session.connection().cursor() as cursor:
        if not present():
            return {}
        warmup = current(cursor, tenant_id, lock=True)
        if warmup is None:
            return {}
        if warmup["status"] in OPEN and local.date() > warmup["day_started_on"]:
            done["day"] = _close_day(cursor, tenant_id, warmup, local, zone)
            warmup = current(cursor, tenant_id, lock=True)
        done["campaigns_completed"] = _close_campaigns(cursor, tenant_id, local.date())
        if warmup["status"] in OPEN:
            done["hour"] = _top_up(cursor, tenant_id, warmup, local)
    with session.tx(), session.connection().cursor() as cursor:
        done["released"] = release(cursor, tenant_id, now)
    return done


def run_all() -> dict:
    """Every active workspace with a warm-up, one at a time; one workspace's trouble never stops the others."""
    from django.conf import settings

    from apps.tenants.models import Tenant
    passes = failed = 0
    for tenant_id in Tenant.objects.using(settings.CONTROL_PLANE_ALIAS).filter(status="ACTIVE", deleted_at__isnull=True).values_list("id", flat=True):
        try:
            with session.tenant_scope(str(tenant_id)):
                if tick(str(tenant_id)):
                    passes += 1
        except Exception:                                  # noqa: BLE001
            log.exception("warm-up pass failed for workspace %s", tenant_id)
            failed += 1
    return {"warm_ups": passes, "workspaces_failed": failed}


# ---------------------------------------------------------------- the page
def overview(tenant_id) -> dict:
    contacts, plan_name = contacts_target(tenant_id)
    out = {"present": True, "contacts_target": contacts, "plan_name": plan_name, "warmup": None, "days": []}
    with session.tx(), session.connection().cursor() as cursor:
        if not present():
            return {**out, "present": False}
        warmup = current(cursor, tenant_id)
        if warmup is None:
            return out
        wid = str(warmup["id"])
        zone = _zone(tenant_id)
        now = timezone.now()
        local = now.astimezone(zone)
        days = _days(cursor, wid)
        cursor.execute("""SELECT l.day_no, count(x.id) FILTER (WHERE x.submitted_at IS NOT NULL), count(x.id) FILTER (WHERE x.opened_at IS NOT NULL),
                                 count(x.id) FILTER (WHERE x.status = 'QUEUED')
                            FROM delivery_warmup_campaign l LEFT JOIN mailer_execution x ON x.tenant_id = l.tenant_id AND x.campaign_id = l.campaign_id
                           WHERE l.warmup_id = %s GROUP BY 1""", [wid])
        sends = {day_no: {"sent": sent, "opened": opened, "waiting": waiting} for day_no, sent, opened, waiting in cursor.fetchall()}
        cursor.execute("""SELECT l.day_no, c.id::text, c.name, c.status, l.sent_on FROM delivery_warmup_campaign l JOIN campaign c ON c.id = l.campaign_id
                           WHERE l.warmup_id = %s ORDER BY l.sent_on, c.created_at""", [wid])
        campaigns: dict[int, list] = {}
        for day_no, cid, name, status, sent_on in cursor.fetchall():
            campaigns.setdefault(day_no, []).append({"id": cid, "name": name, "status": status, "sent_on": sent_on.isoformat()})
        list_ids = sorted({str(i) for d in days for i in d["list_ids"]})
        cursor.execute("SELECT id::text, name, member_count FROM contact_list WHERE tenant_id = %s AND id::text = ANY(%s)", [str(tenant_id), list_ids])
        lists = {row[0]: {"id": row[0], "name": row[1], "member_count": row[2]} for row in cursor.fetchall()}
        template_ids = sorted({str(d["template_id"]) for d in days if d["template_id"]} | {str(t) for t in warmup["extra_template_ids"] or []})
        cursor.execute("SELECT id::text, name FROM template_master WHERE tenant_id = %s AND id::text = ANY(%s)", [str(tenant_id), template_ids])
        templates = dict(cursor.fetchall())
        cursor.execute("""SELECT count(DISTINCT party_id) FILTER (WHERE template_id IS NOT NULL), count(*) FILTER (WHERE template_id IS NULL AND round = %s)
                            FROM delivery_warmup_send WHERE warmup_id = %s""", [warmup["round"], wid])
        reached, no_template = cursor.fetchone()
        cursor.execute("SELECT s.display_name, s.from_address FROM sender_profile s WHERE s.id = %s", [str(warmup["sender_profile_id"])])
        sender = cursor.fetchone()
        hours = window_hours(warmup["plan_kind"], warmup["window_start"], warmup["window_end"])
        start, end = _hour(local)
        today_start = datetime.combine(local.date(), time.min, zone)
        today_figures = _figures(cursor, tenant_id, today_start, today_start + timedelta(days=1))
        held = _held(cursor, tenant_id) if warmup["status"] in OPEN else {"own": 0, "warm_up": 0}
        used = _used(cursor, tenant_id, start, end)
    current_day = warmup["current_day"]
    current_row = next((d for d in days if d["day_no"] == current_day), None)
    open_ = warmup["status"] in OPEN

    def state(d) -> str:
        if not open_:
            return "DONE" if d["outcome"] or d["day_no"] <= current_day else "SKIPPED"
        if d["day_no"] < current_day:
            return "DONE"
        return "TODAY" if d["day_no"] == current_day else "PLANNED"

    def when(d) -> str | None:
        if d["day_no"] >= current_day and open_:
            return (local.date() + timedelta(days=d["day_no"] - current_day)).isoformat()
        return (d["closed_on"] or d["started_on"]).isoformat() if (d["closed_on"] or d["started_on"]) else None

    out["warmup"] = {
        "id": wid, "status": warmup["status"], "status_note": warmup["status_note"], "ip_mode": warmup["ip_mode"], "plan_kind": warmup["plan_kind"],
        "window_start": warmup["window_start"].strftime("%H:%M"), "window_end": warmup["window_end"].strftime("%H:%M"), "window_hours": hours,
        "advance_mode": warmup["advance_mode"], "current_day": current_day, "days_total": len(days), "offered_day": warmup["offered_day"], "round": warmup["round"],
        "contacts_target": warmup["contacts_target"], "extra_template_ids": [str(t) for t in warmup["extra_template_ids"] or []],
        "sender": {"id": str(warmup["sender_profile_id"]), "display_name": sender[0] if sender else None, "from_address": sender[1] if sender else None},
        "started_at": warmup["started_at"], "finished_at": warmup["finished_at"], "time_zone": str(zone),
        "today": {"date": local.date().isoformat(), "hour": f"{local:%H}:00", "in_window": _in_window(warmup, local),
                  "limit_hour": current_row["hourly_limit"] if current_row else None, "limit_day": current_row["hourly_limit"] * hours if current_row else None,
                  "sent_this_hour": used, "sent": today_figures["sent"], "bounced": today_figures["bounced"], "complained": today_figures["complained"],
                  "waiting_own": held["own"], "waiting_warm_up": held["warm_up"]},
        "limits": {"bounce": BOUNCE_LIMIT, "complaint": COMPLAINT_LIMIT},
        "people": {"reached": reached, "no_template": no_template},
    }
    out["days"] = [{
        "day": d["day_no"], "age": d["schedule_age"], "hourly_limit": d["hourly_limit"], "daily_limit": d["hourly_limit"] * hours, "date": when(d), "state": state(d),
        "lists": [lists.get(str(i), {"id": str(i), "name": "Removed list", "member_count": 0}) for i in d["list_ids"]],
        "template": {"id": str(d["template_id"]), "name": templates.get(str(d["template_id"]), "Removed template")} if d["template_id"] else None,
        "sent": sends.get(d["day_no"], {}).get("sent", 0), "opened": sends.get(d["day_no"], {}).get("opened", 0), "waiting": sends.get(d["day_no"], {}).get("waiting", 0),
        "health": {"sent": d["sent"], "bounced": d["bounced"], "complained": d["complained"], "outcome": d["outcome"]} if d["outcome"] else None,
        "campaigns": campaigns.get(d["day_no"], []),
    } for d in days]
    out["extra_templates"] = [{"id": t, "name": templates.get(t, "Removed template")} for t in out["warmup"]["extra_template_ids"]]
    return out


def campaign_day(campaign_id) -> dict | None:
    """A warm-up campaign's day, for its page: {day, days_total, sent_on, status}."""
    with session.connection().cursor() as cursor:
        if not present():
            return None
        cursor.execute("""SELECT l.day_no, l.sent_on, w.status, (SELECT count(*) FROM delivery_warmup_day d WHERE d.warmup_id = w.id)
                            FROM delivery_warmup_campaign l JOIN delivery_warmup w ON w.id = l.warmup_id WHERE l.campaign_id = %s""", [str(campaign_id)])
        found = cursor.fetchone()
    if found is None:
        return None
    return {"day": found[0], "sent_on": found[1].isoformat(), "warm_up_status": found[2], "days_total": found[3]}


def setup_step(tenant_id) -> dict | None:
    """The Set-Up step's facts: None without a warm-up; else its status and day."""
    with session.connection().cursor() as cursor:
        if not present():
            return None
        warmup = current(cursor, tenant_id)
        if warmup is None:
            return None
        cursor.execute("SELECT count(*) FROM delivery_warmup_day WHERE warmup_id = %s", [str(warmup["id"])])
        total = cursor.fetchone()[0]
    return {"status": warmup["status"], "day": warmup["current_day"], "days_total": total, "offered_day": warmup["offered_day"],
            "plan_kind": warmup["plan_kind"], "ip_mode": warmup["ip_mode"]}


def previews(tenant_id, window_start=None, window_end=None) -> dict:
    """The four plans a new warm-up can choose from, sized to the workspace plan."""
    contacts, plan_name = contacts_target(tenant_id)
    begin, end = _parse_time(window_start, time(8)), _parse_time(window_end, time(21))
    if end <= begin:
        raise WarmupError("The sending window must end after it starts, on the same day.")
    return {"contacts_target": contacts, "plan_name": plan_name,
            "plans": {f"{ip}_{kind}": plan(ip, kind, begin, end, contacts) for ip in START_AGE for kind in ("HOURLY", "DAILY")}}
