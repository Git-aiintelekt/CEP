"""Campaign operations (BRD v0.9 sections 6.3, 7, 15): what a person can do with a campaign, and what each action means.

The execution model is the existing one: a Campaign has Runs; a Run freezes a de-duplicated Campaign List when it starts
and the send engine (apps/delivery/engine) works through it. This module adds planning and operating on top:

    status        DRAFT -> TEST_PUBLISHED -> PRODUCTION_PUBLISHED -> ACTIVE -> COMPLETED, plus PAUSED and ARCHIVED.
                  "Scheduled" is derived: production-published with its next run in the future (display_status).
    send type     IMMEDIATE | SCHEDULED: one Run.  RECURRING: a Run per occurrence, the next one created when the previous
                  is on its way.  DRIP: a Run per step, all created at publish.  One Campaign, several Runs: never a
                  campaign per send, and nothing here assumes one subject line per Run (campaign_run_variant, BRD TD-04).
    audience      the Campaign List is frozen when a Run STARTS, not at publish: an unsubscribe between publishing and a
                  scheduled send has to be honoured. For an immediate send the two moments are the same.
    governance    consent, unsubscribes, blocked and invalid addresses ALWAYS apply. The corporate frequency caps apply to
                  marketing campaigns (transactional, service and e-receipt are exempt, BRD 12). `respect_governance =
                  False` lifts only those caps, and publishing such a campaign is written to the log as a warning.
    archive       replaces delete: hidden from the default list, everything kept for reporting.

Everything runs inside the request's transaction, under the tenant's row-level security.
"""
import calendar
import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import connections, transaction
from django.utils import timezone

from apps.contact_lists import governance
from apps.tenants import context

from .models import Campaign, CampaignActivityLog, CampaignRun, CampaignTarget, ContactListCampaign

log = logging.getLogger("cep.campaigns")

S = Campaign.Status
EDITABLE = (S.DRAFT, S.TEST_PUBLISHED)
LIVE = (S.PRODUCTION_PUBLISHED, S.ACTIVE)
OPEN_RUN = ("SCHEDULED", "PREPARING", "SENDING", "PAUSED")
WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
SETUP_STEPS = 6                                         # the steps before Review & Publish

# what the interface offers, by (display) status. Journey-generated campaigns are read-only (BRD 7.3): view and clone only.
ACTIONS = {
    "DRAFT": ("edit", "clone", "test_publish", "publish", "archive"),
    "TEST_PUBLISHED": ("edit", "clone", "test_publish", "publish", "archive"),
    "SCHEDULED": ("cancel_schedule", "clone", "archive"),
    "PRODUCTION_PUBLISHED": ("pause", "clone", "results", "archive"),
    "ACTIVE": ("pause", "clone", "results", "archive"),
    "PAUSED": ("resume", "clone", "results", "archive"),
    "COMPLETED": ("clone", "results", "archive"),
    "CANCELLED": ("clone", "results", "archive"),
    "ARCHIVED": ("unarchive", "clone"),
}


class ActionError(Exception):
    """The campaign is not in a state that allows this: the message says why, as the operator should read it."""


def _conn():
    return connections[context.require().db_alias]


# ---------------------------------------------------------------- activity log
def record(campaign, event_type: str, message: str, *, user=None, run=None, severity: str = "INFO", detail: dict | None = None) -> None:
    actor = None if user is None or hasattr(user, "has_scope") else user
    CampaignActivityLog.objects.create(
        tenant_id=campaign.tenant_id, campaign=campaign, campaign_run_id=getattr(run, "pk", None), event_type=event_type, severity=severity, message=message[:500],
        detail=detail or {}, actor_user_id=getattr(actor, "pk", None),
        actor_name=(getattr(actor, "display_name", None) or getattr(actor, "email", None) or ("API client" if user is not None else "System"))[:200])


def record_run_event(tenant_id, campaign_id, run_id, event_type: str, message: str, severity: str = "INFO", detail: dict | None = None) -> None:
    """For the send engine, which knows ids, not objects. Never lets a logging problem disturb a send."""
    try:
        CampaignActivityLog.objects.create(tenant_id=tenant_id, campaign_id=campaign_id, campaign_run_id=run_id, event_type=event_type, severity=severity,
                                           message=message[:500], detail=detail or {}, actor_name="System")
    except Exception:                                     # noqa: BLE001
        log.exception("activity log entry not written for campaign %s", campaign_id)


# ---------------------------------------------------------------- status as people see it
def next_run_at(campaign) -> datetime | None:
    runs = [run for run in campaign.campaign_runs.all() if not run.test_mode and run.status == "SCHEDULED"]
    times = [run.scheduled_at for run in runs if run.scheduled_at]
    return min(times) if times else None


def display_status(campaign) -> str:
    if campaign.status == S.PRODUCTION_PUBLISHED:
        upcoming = next_run_at(campaign)
        if upcoming is not None and upcoming > timezone.now():
            return "SCHEDULED"
    return campaign.status


def setup_complete(campaign) -> bool:
    """Every step before the publish was gone through. What is no longer a draft is past its setup by definition."""
    return campaign.status not in EDITABLE or campaign.setup_step >= SETUP_STEPS


def actions(campaign) -> list[str]:
    allowed = list(ACTIONS.get(display_status(campaign), ()))
    if campaign.is_journey_generated:
        allowed = [name for name in allowed if name in ("clone", "results")]
    return allowed


def _require(campaign, action: str, problem: str) -> None:
    if action not in actions(campaign):
        raise ActionError(problem)


# ---------------------------------------------------------------- schedule arithmetic
def zone_of(campaign) -> ZoneInfo:
    name = campaign.send_timezone or getattr(campaign.tenant, "timezone", None) or "UTC"
    try:
        return ZoneInfo(name)
    except Exception:                                     # noqa: BLE001
        return ZoneInfo("UTC")


def _at(day: date, clock: str | None, zone: ZoneInfo) -> datetime:
    hour, minute = (int(part) for part in (clock or "09:00").split(":")[:2])
    return datetime.combine(day, time(hour, minute), tzinfo=zone)


def validate_recurring(config: dict | None) -> str | None:
    if not isinstance(config, dict):
        return "Choose how often the campaign repeats."
    if config.get("frequency") not in ("DAILY", "WEEKLY", "MONTHLY"):
        return "Choose daily, weekly or monthly."
    try:
        if int(config.get("interval", 1)) < 1 or int(config.get("interval", 1)) > 52:
            return "The interval has to be between 1 and 52."
        if config.get("time"):
            hour, minute = (int(part) for part in str(config["time"]).split(":")[:2])
            if not (0 <= hour < 24 and 0 <= minute < 60):
                return "The send time is not a time of day."
        if config.get("end_date"):
            date.fromisoformat(str(config["end_date"]))
        if config.get("max_runs") is not None and int(config["max_runs"]) < 1:
            return "The number of sends has to be at least 1."
    except (TypeError, ValueError):
        return "The recurrence is not valid."
    if config["frequency"] == "WEEKLY" and config.get("weekdays") and any(day not in WEEKDAYS for day in config["weekdays"]):
        return "Days of the week are MO, TU, WE, TH, FR, SA, SU."
    if config["frequency"] == "MONTHLY" and config.get("day_of_month") is not None and not 1 <= int(config["day_of_month"]) <= 31:
        return "The day of the month has to be between 1 and 31."
    return None


def validate_drip(config: dict | None) -> str | None:
    steps = (config or {}).get("steps") if isinstance(config, dict) else None
    if not steps or not isinstance(steps, list):
        return "Add at least one step to the series."
    try:
        days = [int(step["day"]) for step in steps]
    except (KeyError, TypeError, ValueError):
        return "Every step needs the day it is sent on (0 = the first day)."
    if any(day < 0 or day > 365 for day in days):
        return "A step's day has to be between 0 and 365."
    if len(set(days)) != len(days):
        return "Two steps are on the same day."
    if len(days) > 30:
        return "A series has at most 30 steps."
    return None


def next_occurrence(config: dict, after: datetime, zone: ZoneInfo, first: bool = False) -> datetime | None:
    """The first send time strictly after `after` (or at/after it when `first`). None when the recurrence has ended."""
    frequency, interval, clock = config["frequency"], int(config.get("interval", 1)), config.get("time")
    local = after.astimezone(zone)
    candidate_day = local.date()
    for _ in range(800):                                  # two years of days: enough for any interval this form allows
        moment = _at(candidate_day, clock, zone)
        good = moment >= after if first else moment > after
        if good and frequency == "WEEKLY":
            good = WEEKDAYS[candidate_day.weekday()] in (config.get("weekdays") or [WEEKDAYS[local.weekday()]])
        if good and frequency == "MONTHLY":
            wanted = int(config.get("day_of_month") or local.day)
            good = candidate_day.day == min(wanted, calendar.monthrange(candidate_day.year, candidate_day.month)[1])
        if good:
            end = config.get("end_date")
            return None if end and candidate_day > date.fromisoformat(str(end)) else moment
        candidate_day += timedelta(days=1)
    return None


def _skip(config: dict, moment: datetime, zone: ZoneInfo) -> datetime:
    """Where to look from for the occurrence after `moment`, honouring "every N"."""
    interval = int(config.get("interval", 1))
    if interval <= 1:
        return moment
    if config["frequency"] == "DAILY":
        return moment + timedelta(days=interval - 1)
    if config["frequency"] == "WEEKLY":
        return moment + timedelta(weeks=interval - 1)
    local = moment.astimezone(zone)
    month = local.month - 1 + (interval - 1)
    year, month = local.year + month // 12, month % 12 + 1
    return local.replace(year=year, month=month, day=min(local.day, calendar.monthrange(year, month)[1]))


# ---------------------------------------------------------------- publish
def publish_problems(campaign, production: bool = True) -> dict:
    """What stands in the way, by field. Content rules (unsubscribe link, opt-out wording, MMS picture) are checked by the caller."""
    from apps.templates.models import RenderedTemplateContent
    missing = {}
    if campaign.template_id is None:
        missing["template"] = "Choose a template before publishing."
    elif production and campaign.template.status != "ACTIVE":
        missing["template"] = "This template is still a draft. Publish the template first." if campaign.template.status == "DRAFT" else "This template is archived."
    elif not RenderedTemplateContent.objects.filter(template_id=campaign.template_id).exists():
        missing["template"] = "This template has no saved content yet."
    if campaign.sender_profile_id is None:
        missing["sender_profile"] = "Choose a sender before publishing."
    elif campaign.sender_profile.deleted_at is not None:
        missing["sender_profile"] = "This sender was removed. Choose another one."
    elif production and campaign.sender_profile.verification_status != "VERIFIED":
        missing["sender_profile"] = "This sender is not verified yet."
    if campaign.campaign_type != Campaign.CampaignType.E_RECEIPT:
        attached = list(campaign.contact_list_campaigns.select_related("contact_list"))
        included = [link.contact_list for link in attached if link.role == "INCLUDE"]
        if not included:
            missing["contact_lists"] = "Attach at least one contact list before publishing."
        elif production:
            gone = [item.name for item in included if item.deleted_at is not None or item.status != "ACTIVE"]
            test = [item.name for item in included if item.list_environment == "TEST"]
            if gone:
                missing["contact_lists"] = f"No longer usable, detach it first: {', '.join(gone)}"
            elif test:                                       # a Test list is for test sends: it never reaches a production send by accident
                missing["contact_lists"] = f"Marked as Test, so it cannot go out in production: {', '.join(test)}. Detach it, or change the list to Production."
        if production:
            if campaign.send_type == "SCHEDULED" and (campaign.scheduled_at is None or campaign.scheduled_at <= timezone.now()):
                missing["scheduled_at"] = "Choose a send time in the future."
            if campaign.send_type == "RECURRING":
                problem = validate_recurring(campaign.recurring_config)
                if problem:
                    missing["recurring_config"] = problem
                elif next_occurrence(campaign.recurring_config, campaign.scheduled_at or timezone.now(), zone_of(campaign), first=True) is None:
                    missing["recurring_config"] = "This recurrence has already ended. Move the end date."
            if campaign.send_type == "DRIP":
                problem = validate_drip(campaign.drip_config)
                if problem:
                    missing["drip_config"] = problem
    return missing


def create_runs(campaign) -> list[CampaignRun]:
    """The Runs a production publish creates. Drip: one per step. Recurring: the first occurrence (the rest follow one by one)."""
    start = campaign.scheduled_at if campaign.send_type != "IMMEDIATE" else None
    number = campaign.campaign_runs.count()
    zone = zone_of(campaign)
    plan = []
    if campaign.send_type == "DRIP":
        anchor = (start or timezone.now()).astimezone(zone)
        clock = (campaign.drip_config or {}).get("time")
        for step in sorted(campaign.drip_config["steps"], key=lambda item: int(item["day"])):
            day = int(step["day"])
            when = None if day == 0 and start is None else (_at(anchor.date() + timedelta(days=day), clock, zone) if clock or day else anchor)
            plan.append((CampaignRun.RunType.DRIP_INSTANCE, when, f"Day {day}"))
    elif campaign.send_type == "RECURRING":
        when = next_occurrence(campaign.recurring_config, start or timezone.now(), zone, first=True)
        plan.append((CampaignRun.RunType.RECURRING_INSTANCE, when, "Occurrence 1"))
    else:
        plan.append((CampaignRun.RunType.ONE_TIME, start, None))
    return [CampaignRun.objects.create(campaign=campaign, tenant_id=campaign.tenant_id, run_number=number + index, run_type=run_type, scheduled_at=when, sequence_label=label)
            for index, (run_type, when, label) in enumerate(plan, start=1)]


def schedule_next_occurrence(campaign) -> CampaignRun | None:
    """Recurring campaigns: once no occurrence is waiting, the next one is created, until the end date or the number of sends."""
    if campaign.send_type != "RECURRING" or campaign.status not in LIVE or validate_recurring(campaign.recurring_config):
        return None
    runs = [run for run in campaign.campaign_runs.all() if not run.test_mode]
    if any(run.status == "SCHEDULED" for run in runs):
        return None
    config, zone = campaign.recurring_config, zone_of(campaign)
    limit = config.get("max_runs")
    last = max((run.scheduled_at or run.created_at for run in runs), default=timezone.now())
    when = None if limit is not None and len(runs) >= int(limit) else next_occurrence(config, max(_skip(config, last, zone), timezone.now()), zone)
    if when is None:
        if not any(run.status in OPEN_RUN for run in runs):
            Campaign.objects.filter(pk=campaign.pk).update(status=S.COMPLETED, completed_at=timezone.now())
            record(campaign, "SEND_COMPLETED", "The recurrence has ended: every occurrence was sent.")
        return None
    run = CampaignRun.objects.create(campaign=campaign, tenant_id=campaign.tenant_id, run_number=len(campaign.campaign_runs.all()) + 1,
                                     run_type=CampaignRun.RunType.RECURRING_INSTANCE, scheduled_at=when, sequence_label=f"Occurrence {len(runs) + 1}")
    record(campaign, "MODIFIED", f"Next occurrence scheduled for {when.astimezone(zone):%d %b %Y %H:%M} ({zone.key}).", run=run)
    return run


# ---------------------------------------------------------------- actions
def pause(campaign, user=None) -> Campaign:
    _require(campaign, "pause", f"A {campaign.get_status_display().lower()} campaign cannot be paused.")
    paused = CampaignRun.objects.filter(campaign=campaign, tenant_id=campaign.tenant_id, test_mode=False, status__in=("SENDING", "PREPARING")).update(status="PAUSED")
    campaign.previous_status, campaign.status = campaign.status, S.PAUSED
    campaign.save(update_fields=["previous_status", "status"])
    record(campaign, "PAUSED", "Paused. Messages already handed to the provider still go out; nothing more is sent until it is resumed."
           + (f" {paused} send in progress stopped." if paused else " Runs that are due stay waiting."), user=user)
    return campaign


def resume(campaign, user=None) -> tuple[Campaign, list[str]]:
    """-> the campaign and the ids of the Runs whose remaining messages have to be handed to the engine again."""
    _require(campaign, "resume", "Only a paused campaign can be resumed.")
    runs = list(CampaignRun.objects.filter(campaign=campaign, tenant_id=campaign.tenant_id, status="PAUSED"))
    CampaignRun.objects.filter(pk__in=[run.pk for run in runs]).update(status="SENDING")
    campaign.status, campaign.previous_status = (campaign.previous_status if campaign.previous_status in LIVE else S.ACTIVE), None
    campaign.save(update_fields=["status", "previous_status"])
    record(campaign, "RESUMED", "Resumed." + (f" {len(runs)} send continues where it stopped." if runs else ""), user=user)
    return campaign, [str(run.pk) for run in runs]


def cancel_schedule(campaign, user=None) -> Campaign:
    _require(campaign, "cancel_schedule", "Only a campaign that is scheduled and has not started can be taken back.")
    cancelled = CampaignRun.objects.filter(campaign=campaign, tenant_id=campaign.tenant_id, test_mode=False, status="SCHEDULED").update(status="CANCELLED")
    campaign.status, campaign.published_at = S.DRAFT, None
    campaign.save(update_fields=["status", "published_at"])
    record(campaign, "SCHEDULE_CANCELLED", f"Schedule cancelled: {cancelled} send{'s' if cancelled != 1 else ''} will not go out. The campaign is a draft again.", user=user)
    return campaign


def archive(campaign, user=None) -> Campaign:
    _require(campaign, "archive", "This campaign cannot be archived.")
    if campaign.status in LIVE or campaign.status == S.PAUSED:
        CampaignRun.objects.filter(campaign=campaign, tenant_id=campaign.tenant_id, status__in=("SCHEDULED", "PAUSED")).update(status="CANCELLED")
    campaign.previous_status, campaign.status, campaign.archived_at = campaign.status, S.ARCHIVED, timezone.now()
    campaign.save(update_fields=["previous_status", "status", "archived_at"])
    record(campaign, "ARCHIVED", "Archived. It is hidden from the list; its results stay available for reporting.", user=user)
    return campaign


def unarchive(campaign, user=None) -> Campaign:
    _require(campaign, "unarchive", "Only an archived campaign can be restored.")
    clash = Campaign.objects.filter(tenant_id=campaign.tenant_id, name__iexact=campaign.name, deleted_at__isnull=True).exclude(status=S.ARCHIVED).exclude(pk=campaign.pk)
    if clash.exists():
        raise ActionError("Another campaign uses this name now. Rename that one, or clone this campaign under a new name.")
    ran = campaign.campaign_runs.filter(test_mode=False).exclude(status="CANCELLED").exists()
    campaign.status = S.COMPLETED if ran else S.DRAFT          # a campaign that sent cannot become editable again: that would rewrite what its results describe
    campaign.previous_status, campaign.archived_at = None, None
    campaign.save(update_fields=["status", "previous_status", "archived_at"])
    record(campaign, "UNARCHIVED", "Restored as " + ("completed: it has already sent, so it stays read-only." if ran else "a draft."), user=user)
    return campaign


def copy_name(tenant_id, name: str) -> str:
    base = f"Copy of {name}"[:190]
    taken = set(Campaign.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True, name__istartswith=base).values_list("name", flat=True))
    candidate, number = base, 2
    while candidate.lower() in {item.lower() for item in taken}:
        candidate, number = f"{base} ({number})", number + 1
    return candidate


def clone(campaign, user=None, code: str | None = None) -> Campaign:
    """Settings, lists and targets; never status, runs or results."""
    copied = ("campaign_type", "channel", "solicitation_type", "template_id", "sender_profile_id", "description", "tags", "send_type", "send_timezone", "recurring_config",
              "drip_config", "respect_governance", "rate_limit_per_hour", "timezone_optimization", "receipt_config", "setup_step")
    values = {name: getattr(campaign, name) for name in copied}
    if campaign.campaign_type == Campaign.CampaignType.JOURNEY:                 # a copy is a campaign someone runs by hand
        values["campaign_type"] = Campaign.CampaignType.REGULAR_MARKETING
    actor = None if user is None or hasattr(user, "has_scope") else user
    copy = Campaign.objects.create(tenant_id=campaign.tenant_id, name=copy_name(campaign.tenant_id, campaign.name), code=code, status=S.DRAFT,
                                   owner_user_id=getattr(actor, "pk", None), created_by_id=getattr(actor, "pk", None), **values)
    ContactListCampaign.objects.bulk_create([ContactListCampaign(campaign=copy, contact_list_id=link.contact_list_id, tenant_id=copy.tenant_id, role=link.role)
                                             for link in campaign.contact_list_campaigns.all()])
    target = campaign.campaign_targets.filter(deleted_at__isnull=True).order_by("-created_at").first()
    if target is not None:
        CampaignTarget.objects.create(campaign=copy, tenant_id=copy.tenant_id, created_by_id=getattr(actor, "pk", None),
                                      **{name: getattr(target, name) for name in ("target_revenue", "target_opens", "target_clicks", "target_conversions", "target_redemptions",
                                                                                   "planned_cost", "planned_offer_cost", "notes")})
    record(copy, "CLONED", f"Created as a copy of “{campaign.name}”. Settings, lists and targets were copied; runs and results were not.", user=user, detail={"source": str(campaign.pk)})
    return copy


# ---------------------------------------------------------------- audience, before anything is sent
def audience(campaign, include: list | None = None, exclude: list | None = None, sample: int = 10) -> dict:
    """Merged and de-duplicated across the attached lists, minus the excluded lists, with the governance picture of today.
    `include` / `exclude` override the attached lists: the wizard asks before anything is saved."""
    links = list(campaign.contact_list_campaigns.select_related("contact_list")) if campaign is not None and include is None else []
    include = [str(i) for i in include] if include is not None else [str(link.contact_list_id) for link in links if link.role == "INCLUDE"]
    exclude = [str(i) for i in exclude] if exclude is not None else [str(link.contact_list_id) for link in links if link.role == "EXCLUDE"]
    tenant = str(context.require().tenant_id)
    channel = getattr(campaign, "channel", None) or "EMAIL"
    marketing = getattr(campaign, "solicitation_type", "MARKETING") == "MARKETING"
    params = {"tenant": tenant, "include": include or [""], "exclude": exclude or [""]}
    with _conn().cursor() as cursor:
        cursor.execute("""SELECT l.id::text, l.name, l.member_count, l.updated_at, l.list_environment, l.source_type,
                                 (SELECT count(*) FROM contact_list_member m WHERE m.tenant_id = l.tenant_id AND m.contact_list_id = l.id)
                            FROM contact_list l WHERE l.tenant_id = %(tenant)s AND l.id::text = ANY(%(ids)s)""", {"tenant": tenant, "ids": (include + exclude) or [""]})
        lists = {row[0]: {"id": row[0], "name": row[1], "member_count": row[6], "updated_at": row[3], "list_environment": row[4], "source_type": row[5]} for row in cursor.fetchall()}
        base = """WITH picked AS (SELECT DISTINCT m.party_id FROM contact_list_member m WHERE m.tenant_id = %(tenant)s AND m.contact_list_id::text = ANY(%(include)s)),
                       dropped AS (SELECT DISTINCT m.party_id FROM contact_list_member m WHERE m.tenant_id = %(tenant)s AND m.contact_list_id::text = ANY(%(exclude)s)),
                       kept AS (SELECT p.party_id FROM picked p WHERE NOT EXISTS (SELECT 1 FROM dropped d WHERE d.party_id = p.party_id))"""
        cursor.execute(base + " SELECT (SELECT count(*) FROM picked), (SELECT count(*) FROM kept)", params)
        unique, kept = cursor.fetchone()
        if channel == "EMAIL":
            judged = f"""SELECT k.party_id, {governance.status_sql()} AS status, {governance.PRIMARY_EMAIL_SQL} AS address, cm.first_name, cm.last_name
                           FROM kept k LEFT JOIN customer_master cm ON cm.party_id = k.party_id AND cm.tenant_id = %(tenant)s
                           LEFT JOIN consent_suppression cs ON cs.tenant_id = %(tenant)s AND cs.party_id = k.party_id AND cs.channel = 'EMAIL'
                           LEFT JOIN contact_point_status cps ON cps.tenant_id = %(tenant)s AND cps.contact_point_type = 'EMAIL'
                                AND cps.contact_value = {governance.PRIMARY_EMAIL_SQL}::citext"""
        else:                                              # texts: a usable number, not blocked (STOP, registry), and for marketing an opt-in
            judged = """SELECT k.party_id,
                               CASE WHEN ph.number IS NULL THEN 'NO_PHONE' WHEN cps.blocked THEN 'BLOCKED' WHEN cs.consent_status = 'OPTED_OUT' THEN 'UNSUBSCRIBED'
                                    WHEN COALESCE(cs.consent_status, 'UNKNOWN') <> 'OPTED_IN' THEN 'NO_CONSENT' ELSE 'MARKETABLE' END AS status,
                               ph.number AS address, cm.first_name, cm.last_name
                          FROM kept k LEFT JOIN customer_master cm ON cm.party_id = k.party_id AND cm.tenant_id = %(tenant)s
                          LEFT JOIN LATERAL (SELECT p ->> 'number' AS number FROM jsonb_array_elements(cm.phones) p
                                              ORDER BY COALESCE((p ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1) ph ON TRUE
                          LEFT JOIN consent_suppression cs ON cs.tenant_id = %(tenant)s AND cs.party_id = k.party_id AND cs.channel = 'SMS'
                          LEFT JOIN contact_point_status cps ON cps.tenant_id = %(tenant)s AND cps.contact_point_type = 'PHONE' AND cps.contact_value = ph.number::citext"""
        cursor.execute(base + f", judged AS ({judged}) SELECT status, count(*) FROM judged GROUP BY 1", params)
        counts = dict(cursor.fetchall())
        cursor.execute(base + f", judged AS ({judged}) SELECT party_id, address, first_name, last_name, status FROM judged ORDER BY (status = 'MARKETABLE') DESC, party_id LIMIT %(sample)s",
                       {**params, "sample": sample})
        people = [{"party_id": party, "address": address, "first_name": first, "last_name": last, "status": status,
                   "status_label": governance.label(status) or {"NO_PHONE": "No mobile number", "BLOCKED": "Blocked number"}.get(status, status)} for party, address, first, last, status in cursor.fetchall()]
    # consent is what decides a marketing send; a transactional or service message only needs an address that works
    never = ("HARD_BOUNCE", "SOFT_BOUNCE", "COMPLAINT", "BLOCKED", "INVALID_ADDRESS", "NO_PHONE")
    reachable = sum(count for status, count in counts.items() if status == "MARKETABLE" or (not marketing and status not in never))
    statuses = governance.breakdown(counts) if channel == "EMAIL" else [
        {"code": code, "label": label, "sendable": code == "MARKETABLE", "count": int(counts.get(code, 0))}
        for code, label in (("MARKETABLE", "Can receive marketing texts"), ("UNSUBSCRIBED", "Opted out (STOP)"), ("BLOCKED", "Blocked number"), ("NO_PHONE", "No mobile number"),
                            ("NO_CONSENT", "No consent on record"))]
    gross = sum(lists[i]["member_count"] for i in include if i in lists)
    return {"lists": [dict(lists[i], role="INCLUDE") for i in include if i in lists] + [dict(lists[i], role="EXCLUDE") for i in exclude if i in lists],
            "gross": gross, "unique": unique, "duplicates_removed": gross - unique, "excluded_by_list": unique - kept, "after_exclusions": kept,
            "estimated_recipients": reachable, "excluded_by_governance": kept - reachable, "marketing": marketing, "channel": channel, "statuses": statuses, "sample": people,
            "note": "An estimate as of today. The Campaign List is frozen, and governance decided for real, when the send starts."}


# ---------------------------------------------------------------- results
def metrics(campaign) -> dict:
    """Production runs only: a test publish never counts. Rates are of what was delivered, as email reporting does."""
    tenant, pk = str(campaign.tenant_id), str(campaign.pk)
    table, address = ("sms_execution", "phone_number") if campaign.channel in ("SMS", "MMS") else ("mailer_execution", "email_address")
    with _conn().cursor() as cursor:
        cursor.execute(f"""SELECT x.status, count(*) FROM {table} x JOIN campaign_run r ON r.id = x.campaign_run_id
                            WHERE x.tenant_id = %s AND x.campaign_id = %s AND NOT r.test_mode GROUP BY 1""", [tenant, pk])
        by = dict(cursor.fetchall())
        cursor.execute("""SELECT count(*) FROM consent_record WHERE tenant_id = %s AND campaign_id = %s AND action = 'OPT_OUT'""", [tenant, pk])
        unsubscribed = cursor.fetchone()[0]
        breakdown = []
        if table == "mailer_execution":
            cursor.execute("""SELECT lower(split_part(x.email_address::text, '@', 2)), count(*) FILTER (WHERE x.status NOT IN ('QUEUED', 'FAILED')),
                                     count(*) FILTER (WHERE x.status IN ('DELIVERED', 'OPENED', 'CLICKED')), count(*) FILTER (WHERE x.status IN ('OPENED', 'CLICKED')),
                                     count(*) FILTER (WHERE x.status = 'BOUNCED')
                                FROM mailer_execution x JOIN campaign_run r ON r.id = x.campaign_run_id
                               WHERE x.tenant_id = %s AND x.campaign_id = %s AND NOT r.test_mode GROUP BY 1 ORDER BY 2 DESC LIMIT 8""", [tenant, pk])
            breakdown = [{"key": domain or "unknown", "sent": sent, "delivered": delivered, "opened": opened, "bounced": bounced} for domain, sent, delivered, opened, bounced in cursor.fetchall()]
    got = lambda *names: sum(int(by.get(name, 0)) for name in names)      # noqa: E731
    texts = table == "sms_execution"
    sent = sum(int(v) for k, v in by.items() if k not in ("QUEUED", "FAILED"))
    delivered = got("DELIVERED", "RESPONDED", "OPTED_OUT") if texts else got("DELIVERED", "OPENED", "CLICKED")
    numbers = {"queued": got("QUEUED"), "sent": sent, "failed": got("FAILED"), "delivered": delivered, "opened": got("OPENED", "CLICKED"), "clicked": got("CLICKED"),
               "bounced": got("BOUNCED"), "complained": got("COMPLAINED"), "unsubscribed": max(unsubscribed, got("OPTED_OUT")), "replied": got("RESPONDED", "OPTED_OUT")}
    rate = lambda part, whole: round(part * 100 / whole, 1) if whole else 0.0      # noqa: E731
    actual = campaign.campaign_actuals.order_by("-computed_at").first()
    target = campaign.campaign_targets.filter(deleted_at__isnull=True).order_by("-created_at").first()
    conversions = getattr(actual, "attributed_conversions", None) or 0
    revenue = getattr(actual, "attributed_revenue", None)

    def progress(name, goal, value):
        return None if not goal else {"measure": name, "target": float(goal), "actual": float(value or 0), "percent": min(999.0, round(float(value or 0) * 100 / float(goal), 1))}

    return {"counts": numbers, "conversions": conversions, "revenue": revenue,
            "rates": {"delivery": rate(delivered, sent), "open": rate(numbers["opened"], delivered), "click": rate(numbers["clicked"], delivered),
                      "bounce": rate(numbers["bounced"], sent), "unsubscribe": rate(numbers["unsubscribed"], delivered), "conversion": rate(conversions, delivered)},
            "targets": [item for item in (progress("Opens", getattr(target, "target_opens", None), numbers["opened"]), progress("Clicks", getattr(target, "target_clicks", None), numbers["clicked"]),
                                          progress("Conversions", getattr(target, "target_conversions", None), conversions),
                                          progress("Revenue", getattr(target, "target_revenue", None), revenue)) if item],
            "breakdown": {"by": "carrier" if texts else "domain", "rows": breakdown,
                          "note": "Carrier figures arrive with the text aggregator's delivery receipts." if texts else None},
            "runs": CampaignRun.objects.filter(campaign=campaign, test_mode=False).count(), "test_runs": CampaignRun.objects.filter(campaign=campaign, test_mode=True).count()}


def timeseries(campaign, bucket: str = "hour") -> dict:
    bucket = bucket if bucket in ("hour", "day") else "hour"
    table = "sms_execution" if campaign.channel in ("SMS", "MMS") else "mailer_execution"
    opened = "NULL::timestamptz" if table == "sms_execution" else "x.opened_at"
    clicked = "NULL::timestamptz" if table == "sms_execution" else "x.clicked_at"
    with _conn().cursor() as cursor:
        cursor.execute(f"""SELECT t.bucket, sum(t.sent), sum(t.delivered), sum(t.opened), sum(t.clicked) FROM (
                               SELECT date_trunc(%(b)s, x.submitted_at) AS bucket, 1 AS sent, 0 AS delivered, 0 AS opened, 0 AS clicked FROM {table} x JOIN campaign_run r ON r.id = x.campaign_run_id
                                WHERE x.tenant_id = %(t)s AND x.campaign_id = %(c)s AND NOT r.test_mode AND x.submitted_at IS NOT NULL
                               UNION ALL SELECT date_trunc(%(b)s, x.delivered_at), 0, 1, 0, 0 FROM {table} x JOIN campaign_run r ON r.id = x.campaign_run_id
                                WHERE x.tenant_id = %(t)s AND x.campaign_id = %(c)s AND NOT r.test_mode AND x.delivered_at IS NOT NULL
                               UNION ALL SELECT date_trunc(%(b)s, {opened}), 0, 0, 1, 0 FROM {table} x JOIN campaign_run r ON r.id = x.campaign_run_id
                                WHERE x.tenant_id = %(t)s AND x.campaign_id = %(c)s AND NOT r.test_mode AND {opened} IS NOT NULL
                               UNION ALL SELECT date_trunc(%(b)s, {clicked}), 0, 0, 0, 1 FROM {table} x JOIN campaign_run r ON r.id = x.campaign_run_id
                                WHERE x.tenant_id = %(t)s AND x.campaign_id = %(c)s AND NOT r.test_mode AND {clicked} IS NOT NULL) t
                            GROUP BY 1 ORDER BY 1""", {"b": bucket, "t": str(campaign.tenant_id), "c": str(campaign.pk)})
        points = [{"at": at, "sent": int(sent), "delivered": int(delivered), "opened": int(opened_), "clicked": int(clicked_)} for at, sent, delivered, opened_, clicked_ in cursor.fetchall()]
    return {"bucket": bucket, "points": points}


def upsert_targets(campaign, values: dict, user=None) -> CampaignTarget:
    actor = None if user is None or hasattr(user, "has_scope") else user
    target = campaign.campaign_targets.filter(deleted_at__isnull=True).order_by("-created_at").first()
    if target is None:
        return CampaignTarget.objects.create(campaign=campaign, tenant_id=campaign.tenant_id, created_by_id=getattr(actor, "pk", None), **values)
    for name, value in values.items():
        setattr(target, name, value)
    target.updated_by_id = getattr(actor, "pk", None)
    target.save(update_fields=[*values, "updated_by_id"])
    return target


@transaction.atomic
def set_lists(campaign, include: list, exclude: list) -> tuple[list, list]:
    """Replaces the attachments. Returns (attached, detached) list names, for the activity log."""
    wanted = {item.pk: "INCLUDE" for item in include} | {item.pk: "EXCLUDE" for item in exclude}
    current = {link.contact_list_id: link for link in campaign.contact_list_campaigns.select_related("contact_list")}
    detached = [link.contact_list.name for key, link in current.items() if key not in wanted]
    ContactListCampaign.objects.filter(campaign=campaign).exclude(contact_list_id__in=list(wanted)).delete()
    attached = []
    for item in [*include, *exclude]:
        role = wanted[item.pk]
        if item.pk in current:
            if current[item.pk].role != role:
                ContactListCampaign.objects.filter(campaign=campaign, contact_list_id=item.pk).update(role=role)
        else:
            ContactListCampaign.objects.create(campaign=campaign, contact_list=item, tenant_id=campaign.tenant_id, role=role)
            attached.append(item.name + (" (excluded)" if role == "EXCLUDE" else ""))
    return attached, detached
