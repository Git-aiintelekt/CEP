"""Testing and publishing a drip (phase B3).

    test all      every message is test-sent at once, one after another, each with its own content and labelled with its
                  place in the series ("[Test 2 of 4 · would send Day 3]", a banner in the email, "[Test 2/4 · Day 3]" in a text).
    tested        a message counts as tested when its test was handed to the provider after its content last changed
                  (tested_at > content_changed_at). Content = its template (or the template's saved content), subject line,
                  preheader and A/B test; its day, send time and name are not.
    publish       a drip needs every message ready, sendable and tested, and a start date whose first message is still ahead.
                  problems() is that rule, for the checklist and for publish alike. The drip's own template copies are
                  activated by the publish (activate_copies); a shared template must already be active.
    review        the Test & Publish timeline: when each message goes, to about how many, and what may hold it back.
"""
from datetime import date, datetime, time, timedelta

from django.db.models import Max
from django.db.models.functions import Now
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from . import approval, drip, service
from .models import Campaign, CampaignActivityLog, CampaignDripStep, CampaignRun

PHRASES = {"NEEDS_TEMPLATE": "needs a template", "NEEDS_SUBJECT": "needs a subject line", "NEEDS_TEXT": "needs its text",
           "SAME_DAY": "is on the same day as another message"}
TEXT_CHANNELS = ("SMS", "MMS")
MIN_GAP_DAYS = 2


def label(step, position: int) -> str:
    """"Message 4 (Reminder)", or "Message 4" when it has no name."""
    return f"Message {position}" + (f" ({step.name})" if step.name else "")


def _template(step):
    return step.template if step.template_id and step.template.deleted_at is None else None


def _short_date(moment: datetime) -> str:
    return f"{moment:%a} {moment.day} {moment:%b}"


# ---------------------------------------------------------------- when content changes
def content_changed(template, user_id=None) -> None:
    """A template's content was saved: every message using it needs a new test, and an approval of its drip no longer holds."""
    steps = list(CampaignDripStep.objects.filter(template_id=template.pk).select_related("campaign"))
    if not steps:
        return
    CampaignDripStep.objects.filter(pk__in=[step.pk for step in steps]).update(content_changed_at=Now())
    from apps.identity.models import AppUser
    user = AppUser.objects.filter(pk=user_id).first() if user_id else None
    for campaign in {step.campaign_id: step.campaign for step in steps}.values():
        if campaign.status in service.EDITABLE:
            approval.withdraw(campaign, user, f"the template “{template.name}” of one of its messages was changed.")


# ---------------------------------------------------------------- test status
def test_states(campaign, steps) -> dict:
    """{step_id: {status, sent_at, error, run_id}}: NOT_SENT, SENDING, SENT, CHANGED (content saved after the test) or FAILED."""
    runs = {run.drip_step_id: run for run in CampaignRun.objects.filter(campaign=campaign, test_mode=True, drip_step_id__in=[step.pk for step in steps])
            .order_by("drip_step_id", "-run_number").distinct("drip_step_id")}
    failed = [run.pk for run in runs.values() if run.status == "FAILED"]
    errors = {entry.campaign_run_id: (entry.detail or {}).get("error") or entry.message
              for entry in CampaignActivityLog.objects.filter(campaign_id=campaign.pk, campaign_run_id__in=failed, event_type="TEST_FAILED")}
    states = {}
    for step in steps:
        run = runs.get(step.pk)
        error = None
        if run is not None and run.status in ("SENDING", "PREPARING"):
            status = "SENDING"
        elif run is not None and run.status == "FAILED" and (step.tested_at is None or (run.started_at or run.created_at) > step.tested_at):
            status, error = "FAILED", errors.get(run.pk)
        elif step.tested_at is None:
            status = "NOT_SENT"
        elif step.content_changed_at is not None and step.content_changed_at > step.tested_at:
            status = "CHANGED"
        else:
            status = "SENT"
        states[step.pk] = {"status": status, "sent_at": step.tested_at, "error": error, "run_id": str(run.pk) if run is not None else None}
    return states


# ---------------------------------------------------------------- test sends
def _banner(campaign, step, position: int, total: int, estimate: int | None) -> str:
    when = drip.scheduled_for(campaign, step)
    if when is None:
        return f"Test · Message {position} of {total} · Would send Day {step.day} after the start date"
    return (f"Test · Message {position} of {total} · Would send {when:%a} {when.day} {when:%b %Y}, {when:%H:%M %Z}"
            + (f" to about {estimate:,} contacts" if estimate is not None else ""))


def send_tests(campaign, steps, to: list[str], user) -> list[dict]:
    """Test-sends `steps` (in day order) to `to`, one after another: a test run each ("Test 2 of 4"), tested_at stamped when
    the provider took every message of it. One message failing never stops the others."""
    from apps.delivery.engine import dispatch, dispatch_sms, runs as engine_runs
    from apps.delivery.providers import ProviderError
    from apps.templates.models import RenderedTemplateContent
    every = drip.steps_of(campaign)
    total, texts = len(every), engine_runs.family(campaign) == "SMS"
    estimate = None if texts or campaign.scheduled_at is None else service.audience(campaign, sample=0)["estimated_recipients"]
    outcome = []
    for step in sorted(steps, key=lambda item: item.day):
        position = drip._position(every, step)
        name = label(step, position)
        number = (CampaignRun.objects.filter(campaign=campaign).aggregate(top=Max("run_number"))["top"] or 0) + 1        # not the prefetched runs: this loop adds to them
        run = CampaignRun.objects.create(campaign=campaign, tenant_id=campaign.tenant_id, run_number=number, run_type=CampaignRun.RunType.DRIP_INSTANCE,
                                         test_mode=True, status="SENDING", started_at=timezone.now(), sequence_label=f"Test {position} of {total}", drip_step=step)
        results, error = [], None
        template = _template(step)
        if template is None:
            error = f"{name} has no template."
        elif not RenderedTemplateContent.objects.filter(template_id=template.pk).exists():
            error = f"{name} has no saved content."
        else:
            try:
                if texts:
                    results = dispatch_sms.send_test(campaign.tenant_id, campaign, to, step=step, prefix=f"[Test {position}/{total} · Day {step.day}]")
                else:
                    results = dispatch.send_test(campaign.tenant_id, campaign, to, step=step,
                                                 label={"subject": f"[Test {position} of {total} · would send Day {step.day}]",
                                                        "banner": _banner(campaign, step, position, total, estimate)})
                error = next((f"{item['to']}: {item['detail'] or 'refused by the provider'}" for item in results if not item.get("ok")), None)
            except ProviderError as exc:
                error = str(exc)
        now = timezone.now()
        CampaignRun.objects.filter(pk=run.pk).update(status="FAILED" if error else "COMPLETED", completed_at=now)
        if error is None:
            CampaignDripStep.objects.filter(pk=step.pk).update(tested_at=now)
            service.record(campaign, "TEST_PUBLISHED", f"Test of {name} ({position} of {total}) sent to {', '.join(to)}. Tests do not count towards results.",
                           user=user, run=run, detail={"results": results})
        else:
            service.record(campaign, "TEST_FAILED", f"Test of {name} ({position} of {total}) failed: {error}", user=user, run=run, severity="ERROR",
                           detail={"results": results, "error": error})
        outcome.append({"step": str(step.pk), "position": position, "run": str(run.pk), "status": "FAILED" if error else "SENT", "error": error, "results": results})
    if campaign.status == Campaign.Status.DRAFT and any(item["status"] == "SENT" for item in outcome):
        campaign.status = Campaign.Status.TEST_PUBLISHED
        campaign.save(update_fields=["status"])
    return outcome


# ---------------------------------------------------------------- what stands in the way of a production publish
def _copy_blockers(step, template) -> dict:
    """What stops a message's own DRAFT copy from becoming ACTIVE. A message with its own subject line sends that one, so
    the copy's missing subject (which the editor shows as set on the Sequence step) doesn't count."""
    from apps.templates import design
    blockers = design.activation_blockers(template)
    if (step.subject_line or "").strip():
        blockers.pop("subject_line", None)
    return blockers


def _template_problem(campaign, step, template) -> str | None:
    if template.status == "ARCHIVED":
        return "its template is archived."
    if not step.template_owned and template.status != "ACTIVE":
        return "its template is still a draft. Publish the template first."
    problem = service.content_problem(template, campaign.solicitation_type)
    if problem:
        return problem
    if step.template_owned and template.status == "DRAFT":
        blockers = _copy_blockers(step, template)
        if blockers:
            return next(iter(blockers.values()))
    return None


def problems(campaign) -> dict:
    """Every blocking problem by checklist key, in the checklist's order; {} when the drip can be published. The approval is
    checked on its own (approval.problem), as for every campaign."""
    steps = drip.steps_of(campaign)
    contents, days = drip._contents(steps), [step.day for step in steps]
    found, ready, sendable = {}, [], []
    for position, step in enumerate(steps, start=1):
        codes = drip.problems(campaign, step, contents, days)
        if codes:
            ready.append(f"{label(step, position)} " + " and ".join(PHRASES[code] for code in codes) + ".")
        template = _template(step)
        problem = _template_problem(campaign, step, template) if template is not None else None
        if problem:
            sendable.append(f"Message {position}: {problem}")
    if not steps:
        ready.append("Add at least one message.")
    if ready:
        found["messages_ready"] = "\n".join(ready)
    if sendable:
        found["messages_content"] = "\n".join(sendable)
    states = test_states(campaign, steps)
    if steps and not any(step.tested_at for step in steps):
        found["messages_tested"] = f"Send the test to all {len(steps)} message{'s' if len(steps) != 1 else ''}."
    else:
        lines = []
        for position, step in enumerate(steps, start=1):
            status = states[step.pk]["status"]
            if status == "CHANGED":
                lines.append(f"Message {position} changed after its test. Resend it.")
            elif status == "FAILED":
                lines.append(f"Message {position}'s test failed. Resend it.")
            elif status in ("NOT_SENT", "SENDING"):
                lines.append(f"Message {position} hasn't been tested. Send its test.")
        if lines:
            found["messages_tested"] = "\n".join(lines)
    if campaign.scheduled_at is None:
        found["start_date"] = "Choose a start date."
    elif steps and drip.scheduled_for(campaign, steps[0]) <= timezone.now():
        found["start_date"] = f"The start date, {_short_date(campaign.scheduled_at.astimezone(service.zone_of(campaign)))}, has passed. Choose a new one."
    general = service.publish_problems(campaign, production=True)
    for key in ("contact_lists", "sender_profile", "topic"):
        if key in general:
            found[key] = general[key]
    return found


CHECKLIST = (("messages_ready", None), ("messages_content", "Every message's template is sendable"), ("messages_tested", "Every message tested"),
             ("start_date", "Start date in the future"), ("contact_lists", "Campaign List attached"), ("sender_profile", "Verified sender chosen"), ("topic", "Topic chosen"))


def checklist_items(campaign, found: dict) -> list[dict]:
    count = CampaignDripStep.objects.filter(campaign=campaign).count()
    return [{"key": key, "label": text or f"All {count} message{'s' if count != 1 else ''} ready", "ok": key not in found, "problem": found.get(key)}
            for key, text in CHECKLIST if key != "topic" or key in found]


def activate_copies(campaign) -> list[str]:
    """Inside the publish: every DRAFT copy the drip owns becomes ACTIVE, once the template rules pass. -> the names activated.
    Raises ValidationError naming the message when one doesn't pass; the caller's savepoint then undoes the publish."""
    from apps.templates.models import TemplateMaster
    activated = []
    for position, step in enumerate(drip.steps_of(campaign), start=1):
        template = _template(step)
        if template is None or not step.template_owned or template.status != "DRAFT":
            continue
        blockers = _copy_blockers(step, template)
        if blockers:
            raise ValidationError({"messages_content": [f"Message {position}: {next(iter(blockers.values()))}"]})
        TemplateMaster.objects.filter(pk=template.pk).update(status=TemplateMaster.Status.ACTIVE)
        activated.append(template.name)
    return activated


# ---------------------------------------------------------------- the review timeline
def _caps(campaign) -> list[tuple]:
    """The workspace's active frequency limits that count this drip's messages, strictest first: the ones audience.py and
    audience_sms.py apply (GLOBAL, or CHANNEL for this channel)."""
    channel = campaign.channel if campaign.channel in TEXT_CHANNELS else "EMAIL"
    with service._conn().cursor() as cursor:
        cursor.execute("""SELECT scope, channel, max_messages, period_days FROM communication_governance_policy
                           WHERE tenant_id = %s AND is_active ORDER BY priority""", [str(campaign.tenant_id)])
        rows = cursor.fetchall()
    return [(maximum, days) for scope, own, maximum, days in rows if scope == "GLOBAL" or (scope == "CHANNEL" and (own or channel) == channel)]


def _moment(campaign, step) -> datetime | None:
    """When the message goes; without a start date, its place relative to the others (a reference start), for spacing only."""
    when = drip.scheduled_for(campaign, step)
    if when is not None:
        return when
    zone = service.zone_of(campaign)
    return datetime.combine(date(2000, 1, 3) + timedelta(days=step.day), drip._clock(campaign, step, None) or time(9, 0), tzinfo=zone)


def review(campaign) -> dict:
    from apps.delivery.engine import runs as engine_runs
    from apps.delivery.engine.render import subject_of
    steps = drip.steps_of(campaign)
    contents = drip._contents(steps)
    estimate = service.audience(campaign, sample=0)["estimated_recipients"]
    texts = campaign.channel in TEXT_CHANNELS
    marketing = campaign.solicitation_type == Campaign.SolicitationType.MARKETING
    caps = _caps(campaign) if marketing and campaign.respect_governance else []
    moments = [_moment(campaign, step) for step in steps]
    noun = "texts" if texts else "emails"
    tenant_zone = getattr(campaign.tenant, "timezone", None) or "UTC"
    rows = []
    for index, step in enumerate(steps):
        content = contents.get(step.template_id)
        warnings = []
        if index and step.day - steps[index - 1].day < MIN_GAP_DAYS:
            gap = step.day - steps[index - 1].day
            warnings.append({"code": "TOO_CLOSE", "message": f"Only {gap} day{'s' if gap != 1 else ''} after message {index}."})
        for maximum, days in caps:
            window = sum(1 for moment in moments[:index + 1] if moment > moments[index] - timedelta(days=days))
            if window > maximum:
                warnings.append({"code": "FREQUENCY", "message": f"This drip sends {window} {noun} within {days} day{'s' if days != 1 else ''}; "
                                                                 f"the limit is {maximum}, so this message will skip people."})
                break
        if texts and marketing and drip._clock(campaign, step, campaign.scheduled_at) is not None:
            from zoneinfo import ZoneInfo
            moment = drip.scheduled_for(campaign, step) or datetime.combine(timezone.now().astimezone(service.zone_of(campaign)).date(),
                                                                            drip._clock(campaign, step, None), tzinfo=service.zone_of(campaign))
            opens = engine_runs.quiet_until(tenant_zone, now=moment)
            if opens is not None:
                local = moment.astimezone(ZoneInfo(tenant_zone))
                warnings.append({"code": "QUIET_HOURS", "message": f"Sends at {local:%H:%M %Z}, inside quiet hours for texts. It will wait until {opens:%H:%M}."})
        if texts:
            subject = ((getattr(content, "sms_body", None) or "").strip()[:80]) or None
        else:
            subject = subject_of(campaign, content, step) if content is not None else (step.subject_line or None)
        rows.append({"id": str(step.pk), "position": index + 1, "name": step.name, "day": step.day, "scheduled_for": drip.scheduled_for(campaign, step),
                     "subject": subject, "estimated_recipients": estimate, "warnings": warnings})
    return {"messages": rows, "summary": {"count": len(rows), "first_send_at": rows[0]["scheduled_for"] if rows else None,
                                          "last_send_at": rows[-1]["scheduled_for"] if rows else None, "estimated_recipients": estimate}}
