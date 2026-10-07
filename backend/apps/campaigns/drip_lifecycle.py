"""A running drip (phase B4): its status and actions, Stop Remaining Messages, Resume after missed days, Retry a failed message,
and its progress for lists and Home.

    status        SCHEDULED until a production message has started; ACTIVE after (PAUSED, COMPLETED as usual). A drip that
                  has sent never goes back to DRAFT: Cancel Schedule is offered only before its first message starts.
    stop          cancels every unsent message for good; the drip is COMPLETED with stopped_at / stopped_by. Clone to send again.
    resume        missed messages go at the next send time, one per day, in order; later messages keep their days unless a
                  moved one would reach them, then they move just enough to stay a day apart (resume_plan, used for both).
    retry         a failed message nobody received gets a new run, now ("Day 3 (retry)"), on the same audience.
"""
from datetime import datetime, timedelta

from django.db.models import Max
from django.utils import timezone

from . import drip, service
from .models import Campaign, CampaignDripStep, CampaignRun

S = Campaign.Status
CANCELLABLE = ("SCHEDULED", "PAUSED")


def is_drip(campaign) -> bool:
    return campaign.campaign_type == Campaign.CampaignType.DRIP


def _production(campaign) -> list:
    """The campaign's production runs, from the prefetched runs when the list loaded them."""
    return [run for run in campaign.campaign_runs.all() if not run.test_mode]


def started(campaign) -> bool:
    """A production message has started: people may have received something, so it can't become a draft again."""
    return any(run.started_at is not None for run in _production(campaign))


def display_status(campaign) -> str | None:
    """A drip's status as people see it; None when the general rule applies (service.display_status)."""
    if not is_drip(campaign) or not started(campaign):
        return None
    return S.ACTIVE if campaign.status == S.PRODUCTION_PUBLISHED else campaign.status


def actions(campaign, shown: str) -> tuple:
    """What a drip offers, by what has happened: before its first message, running, paused, finished."""
    if shown in ("SCHEDULED", S.PRODUCTION_PUBLISHED):
        return ("cancel_schedule", "clone", "archive")
    if shown == S.ACTIVE:
        return ("pause", "stop", "clone", "results", "archive")
    if shown == S.PAUSED:
        return ("resume", "stop", "clone", "results", "archive")
    return service.ACTIONS.get(shown, ())


def _label(step, steps) -> str:
    return drip_label(step, drip._position(steps, step))


def drip_label(step, position: int) -> str:
    return f"Message {position}" + (f" ({step.name})" if step.name else "")


def _lower(text: str) -> str:
    return text[:1].lower() + text[1:]


def _when(moment: datetime, zone) -> str:
    local = moment.astimezone(zone)
    return f"{local:%a} {local.day} {local:%b}"


def _clock_text(moment: datetime, zone) -> str:
    return f"{moment.astimezone(zone):%H:%M %Z}"


# ---------------------------------------------------------------- stop
def stop(campaign, user=None) -> Campaign:
    if not is_drip(campaign):
        raise service.ActionError("Only a drip's remaining messages can be stopped.")
    if "stop" not in service.actions(campaign):
        raise service.ActionError("Only a running or paused drip can be stopped.")
    now = timezone.now()
    steps = drip.steps_of(campaign)
    runs = list(CampaignRun.objects.filter(campaign=campaign, tenant_id=campaign.tenant_id, test_mode=False, status__in=CANCELLABLE).select_related("drip_step"))
    CampaignRun.objects.filter(pk__in=[run.pk for run in runs]).update(status="CANCELLED", completed_at=now)
    with service._conn().cursor() as cursor:                # a send paused part-way stops where it is: what it still queued never goes
        for table in ("mailer_execution", "sms_execution"):
            cursor.execute(f"UPDATE {table} SET status = 'FAILED', status_reason = 'Not sent: the drip was stopped early.' "
                           f"WHERE tenant_id = %s AND campaign_run_id::text = ANY(%s) AND status = 'QUEUED'", [str(campaign.tenant_id), [str(run.pk) for run in runs]])
    actor = None if user is None or hasattr(user, "has_scope") else user
    campaign.status, campaign.completed_at, campaign.stopped_at, campaign.stopped_by_id = S.COMPLETED, now, now, getattr(actor, "pk", None)
    campaign.save(update_fields=["status", "completed_at", "stopped_at", "stopped_by"])
    named = [_lower(_label(run.drip_step, steps)) for run in sorted(runs, key=lambda run: run.drip_step.day if run.drip_step_id else 999)
             if run.drip_step_id and run.drip_step in steps]
    who = getattr(actor, "display_name", None) or getattr(actor, "email", None) or ("an API client" if user is not None else "the system")
    message = (f"Stopped early by {who}. " + (f"{len(runs)} message{'s were' if len(runs) != 1 else ' was'} cancelled" + (f": {', '.join(named)}." if named else ".")
                                              if runs else "No message was waiting."))
    service.record(campaign, "STOPPED_EARLY", message, user=user, detail={"cancelled": len(runs), "runs": [str(run.pk) for run in runs]})
    return campaign


def stopped_early(campaign) -> dict | None:
    if campaign.stopped_at is None:
        return None
    by = campaign.stopped_by
    cancelled = sum(1 for run in _production(campaign) if run.status == "CANCELLED" and run.completed_at == campaign.stopped_at)
    return {"at": campaign.stopped_at, "by_name": (by.display_name or by.email) if by else None, "cancelled": cancelled}


# ---------------------------------------------------------------- resume
def resume_plan(campaign, now: datetime | None = None) -> dict:
    """What Resume does to a paused drip's timetable, without doing it: missed messages (still waiting, their time passed) at the
    next send time, one per day; later ones kept, or moved just enough to stay at least a day after the one before.
    -> {missed: [...], moved: [...], unchanged: [...], changes: {run_id: new time}}, times in the campaign's zone."""
    now = now or timezone.now()
    zone = service.zone_of(campaign)
    steps = drip.steps_of(campaign)
    waiting = sorted((run for run in CampaignRun.objects.filter(campaign=campaign, tenant_id=campaign.tenant_id, test_mode=False, status="SCHEDULED",
                                                                drip_step__isnull=False).select_related("drip_step")),
                     key=lambda run: (run.drip_step.day, run.run_number))
    missed, moved, unchanged, changes = [], [], [], {}
    last_day = None                                             # the local date of the message placed before
    for run in waiting:
        step, position = run.drip_step, drip._position(steps, run.drip_step)
        due = run.scheduled_at
        if due is not None and due <= now:
            clock = drip._clock(campaign, step, campaign.scheduled_at) or due.astimezone(zone).time()
            day = now.astimezone(zone).date()
            if datetime.combine(day, clock, tzinfo=zone) <= now:
                day += timedelta(days=1)
            if last_day is not None and day <= last_day:
                day = last_day + timedelta(days=1)
            when = datetime.combine(day, clock, tzinfo=zone)
            missed.append({"position": position, "name": step.name, "was_due": due.astimezone(zone), "will_send": when})
            changes[str(run.pk)] = when
        else:
            when = due
            if when is not None and last_day is not None and when.astimezone(zone).date() <= last_day:
                when = (when + timedelta(days=(last_day - when.astimezone(zone).date()).days + 1)).astimezone(zone)
                moved.append({"position": position, "name": step.name, "was_due": due.astimezone(zone), "will_send": when})
                changes[str(run.pk)] = when
            else:
                unchanged.append({"position": position, "name": step.name, "sends": due.astimezone(zone) if due else None})
        if when is not None:
            last_day = when.astimezone(zone).date()
    return {"missed": missed, "moved": moved, "unchanged": unchanged, "changes": changes}


def apply_resume_plan(campaign, user=None) -> str:
    """Moves the runs as resume_plan says (the caller holds the transaction that also changes the status). -> the log sentence."""
    plan = resume_plan(campaign)
    for run_id, when in plan["changes"].items():
        CampaignRun.objects.filter(pk=run_id, tenant_id=campaign.tenant_id, status="SCHEDULED").update(scheduled_at=when)
    zone = service.zone_of(campaign)
    steps = {position: step for position, step in enumerate(drip.steps_of(campaign), start=1)}
    words = [f"{drip_label(steps[item['position']], item['position'])}, due {_when(item['was_due'], zone)}, sends {_when(item['will_send'], zone)} at "
             f"{_clock_text(item['will_send'], zone)}." for item in plan["missed"]]
    words += [f"{drip_label(steps[item['position']], item['position'])} moves to {_when(item['will_send'], zone)} at {_clock_text(item['will_send'], zone)}, a day after the one before."
              for item in plan["moved"]]
    return " ".join(words)


def public_plan(plan: dict) -> dict:
    return {key: plan[key] for key in ("missed", "moved", "unchanged")}


# ---------------------------------------------------------------- retry
def _received(campaign, run) -> int:
    from apps.delivery.engine import runs as engine_runs
    table = engine_runs.TABLE[engine_runs.family(campaign)]
    with service._conn().cursor() as cursor:
        cursor.execute(f"SELECT count(*) FROM {table} WHERE tenant_id = %s AND campaign_run_id = %s AND status NOT IN ('QUEUED', 'FAILED')",
                       [str(campaign.tenant_id), str(run.pk)])
        return cursor.fetchone()[0]


def retry(campaign, step, user=None) -> CampaignRun:
    """A new production run for a failed message nobody received, now. The engine builds it like any later message (B2)."""
    steps = drip.steps_of(campaign)
    name = _label(step, steps)
    latest = CampaignRun.objects.filter(campaign=campaign, tenant_id=campaign.tenant_id, test_mode=False, drip_step=step).order_by("-run_number").first()
    if latest is None or latest.status != "FAILED":
        raise service.ActionError(f"{name} hasn't failed, so there is nothing to retry.")
    if _received(campaign, latest):
        raise service.ActionError(f"Part of {_lower(name)} went out, so it can't be retried.")
    if campaign.stopped_at is not None:
        raise service.ActionError("The drip was stopped early. Clone it to send its messages again.")
    if campaign.status not in (S.ACTIVE, S.PAUSED, S.COMPLETED, S.PRODUCTION_PUBLISHED):
        raise service.ActionError(f"A {campaign.get_status_display().lower()} drip's messages can't be retried.")
    number = (CampaignRun.objects.filter(campaign=campaign).aggregate(top=Max("run_number"))["top"] or 0) + 1
    run = CampaignRun.objects.create(campaign=campaign, tenant_id=campaign.tenant_id, run_number=number, run_type=CampaignRun.RunType.DRIP_INSTANCE,
                                     scheduled_at=timezone.now(), sequence_label=f"Day {step.day} (retry)", drip_step=step)
    if campaign.status == S.COMPLETED:                          # it finished only because its last message failed
        campaign.status, campaign.completed_at = S.ACTIVE, None
        campaign.save(update_fields=["status", "completed_at"])
    service.record(campaign, "MESSAGE_RETRIED", f"{name} will be sent again now" + (", once the drip is resumed." if campaign.status == S.PAUSED else "."),
                   user=user, run=run, detail={"step_position": drip._position(steps, step), "failed_run": str(latest.pk)})
    return run


# ---------------------------------------------------------------- progress
def progress(campaign) -> dict | None:
    """{total, sent, failed, cancelled, next}: each message by its latest production run. Prefetched runs and steps only, so the
    list pays nothing per campaign."""
    if not is_drip(campaign):
        return None
    steps = sorted(campaign.drip_steps.all(), key=lambda step: step.day)
    latest = {}
    for run in sorted(_production(campaign), key=lambda run: run.run_number):
        if run.drip_step_id:
            latest[run.drip_step_id] = run
    states = [latest[step.pk].status for step in steps if step.pk in latest]
    waiting = sorted(((latest[step.pk], position, step) for position, step in enumerate(steps, start=1)
                      if step.pk in latest and latest[step.pk].status == "SCHEDULED"), key=lambda item: (item[0].scheduled_at or timezone.now(), item[1]))
    upcoming = waiting[0] if waiting else None
    return {"total": len(steps), "sent": sum(1 for status in states if status in ("COMPLETED", "SENDING")),
            "failed": states.count("FAILED"), "cancelled": states.count("CANCELLED"),
            "next": {"position": upcoming[1], "name": upcoming[2].name, "scheduled_at": upcoming[0].scheduled_at} if upcoming else None}


def step_of(campaign, step_id):
    return CampaignDripStep.objects.filter(campaign=campaign, pk=step_id).first()
