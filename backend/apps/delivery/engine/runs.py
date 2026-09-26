"""The life of a campaign run: SCHEDULED -> PREPARING -> SENDING -> COMPLETED | FAILED, for email and for texts.

    start(tenant_id, run_id)      claims the run, builds the audience, queues the executions, returns the batches
    finalize(tenant_id, run_id)   closes the run once nothing is queued any more
    sweep(tenant_id, run_id)      turns messages that were claimed but never confirmed into visible failures
    due()                         every run that should start now, across tenants (platform connection)

A run's family is EMAIL (mailer_execution) or SMS (sms_execution: SMS and MMS). Callers wrap these in
session.tenant_scope(tenant_id); each step commits on its own.
"""
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connections
from django.utils import timezone

from apps.campaigns.models import Campaign, CampaignList, CampaignRun
from apps.platform_ops import notifications
from apps.templates.models import RenderedTemplateContent

from ..providers import ProviderError, registry
from . import abtest, audience, audience_sms, sendtime, session

log = logging.getLogger("cep.delivery")
STALE_CLAIM = timedelta(minutes=15)
TABLE = {"EMAIL": "mailer_execution", "SMS": "sms_execution"}
# a message the engine may claim now: queued, past its local send time, and not held back for a subject-line winner
DUE = {"EMAIL": "status = 'QUEUED' AND (send_after IS NULL OR send_after <= now()) AND COALESCE(variant_key, '') <> 'HOLD'",
       "SMS": "status = 'QUEUED' AND (send_after IS NULL OR send_after <= now())"}


class RunNotStarted(Exception):
    pass


def family(campaign) -> str:
    """EMAIL or SMS. A campaign's channel decides; MULTI follows its template."""
    if campaign.channel in ("SMS", "MMS"):
        return "SMS"
    if campaign.channel == "MULTI" and campaign.template_id and campaign.template.channel in ("SMS", "MMS"):
        return "SMS"
    return "EMAIL"


def text_channel(campaign) -> str:
    """SMS or MMS for a text run: the template says whether there is a picture."""
    return "MMS" if (campaign.template_id and campaign.template.channel == "MMS") or campaign.channel == "MMS" else "SMS"


def quiet_until(tenant_timezone: str, now: datetime | None = None) -> datetime | None:
    """Inside the quiet hours for marketing texts (global parameter messaging.sms_quiet_hours, workspace time zone)?
    -> the moment the window opens, or None when texts may go out now."""
    from apps.platform_ops import params
    window = params.get("messaging.sms_quiet_hours", {}) or {}
    try:
        start = datetime.strptime(str(window["start"]), "%H:%M").time()
        end = datetime.strptime(str(window["end"]), "%H:%M").time()
        zone = ZoneInfo(tenant_timezone or "UTC")
    except (KeyError, ValueError, TypeError, Exception):   # noqa: BLE001  (no window configured, or an unknown time zone: no quiet hours)
        return None
    local = (now or timezone.now()).astimezone(zone)
    clock = local.time()
    quiet = (clock >= start or clock < end) if start > end else (start <= clock < end)
    if not quiet or start == end:
        return None
    opens = local.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)
    return opens if opens > local else opens + timedelta(days=1)


def _notice(tenant_id, run, event: str, title: str, lines: list[str]) -> dict | None:
    """A workspace notification, gathered inside the transaction and delivered after it (see _deliver). Never disturbs the run."""
    try:
        campaign = run.campaign
        owner = campaign.owner_user
        return {"config": notifications.prepare(campaign.tenant_id), "tenant_id": tenant_id, "event": event, "title": title, "lines": lines,
                "link": notifications.campaign_link(campaign.pk), "link_label": "Open the Campaign", "owner_email": owner.email if owner else None}
    except Exception:                                      # noqa: BLE001
        log.exception("notification for run %s not prepared", run.pk)
        return None


def _deliver(notice: dict | None) -> None:
    if not notice:
        return
    try:
        notifications.deliver(notice.pop("config"), notice.pop("tenant_id"), notice.pop("event"), **notice)
    except Exception:                                      # noqa: BLE001
        log.exception("notification not delivered")


def _fail(tenant_id, run, reason: str) -> None:
    log.error("run %s failed: %s", run.pk, reason)
    notice = None
    with session.tx():
        CampaignRun.objects.filter(pk=run.pk, tenant_id=tenant_id).update(status="FAILED", completed_at=timezone.now())
        if not run.test_mode:
            notice = _notice(tenant_id, run, "send_failed", f"{run.campaign.name}: the send could not start", [f"Reason: {reason}", "Nothing went out. Fix the cause and publish again, or resume if it was paused."])
    if not run.test_mode:
        _activity(tenant_id, run.campaign_id, run.pk, "SEND_FAILED", f"Send could not start: {reason}", severity="ERROR")
    _deliver(notice)


def start(tenant_id, run_id) -> dict:
    """-> {'batches': [[execution ids], ...], 'audience': {...}, 'family': 'EMAIL' | 'SMS'}. Safe to call twice: only one caller gets the claim."""
    with session.tx():
        run = CampaignRun.objects.select_related("campaign__template", "campaign__sender_profile__delivery_provider", "campaign__tenant").get(pk=run_id, tenant_id=tenant_id)
        campaign = run.campaign
        sender = campaign.sender_profile
        content = RenderedTemplateContent.objects.filter(template_id=campaign.template_id).order_by("-version_number").first() if campaign.template_id else None
        kind = family(campaign)
        media_url = None
        if kind == "SMS" and text_channel(campaign) == "MMS":
            from apps.templates import design
            media_url = design.message_media_url(campaign.template)
        tenant_zone = campaign.tenant.timezone

    if campaign.status in ("PAUSED", "ARCHIVED"):            # stays SCHEDULED: it starts once the campaign is resumed
        raise RunNotStarted(f"The campaign is {campaign.get_status_display().lower()}: the run waits.")
    if kind == "SMS" and campaign.solicitation_type == "MARKETING" and run.status == "SCHEDULED":
        opens = quiet_until(tenant_zone)
        if opens is not None:                               # stays SCHEDULED: the dispatcher tries again every minute
            raise RunNotStarted(f"Quiet hours for marketing texts: the run starts at {opens:%H:%M} ({tenant_zone}).")

    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""UPDATE campaign_run SET status = 'PREPARING', started_at = now()
                           WHERE id = %s AND tenant_id = %s AND status = 'SCHEDULED' AND (scheduled_at IS NULL OR scheduled_at <= now()) RETURNING id""",
                       [str(run_id), str(tenant_id)])
        if cursor.fetchone() is None:
            raise RunNotStarted("The run is not waiting to start (already started, cancelled, or scheduled for later).")

    problem, batch_size = None, 100
    if sender is None or sender.deleted_at is not None:
        problem = "The campaign has no usable sender."
    elif content is None or not ((content.sms_body or "").strip() if kind == "SMS" else (content.html_content or content.text_content)):
        problem = "The template has no saved content."
    elif kind == "SMS" and not (sender.sender_id or "").strip():
        problem = "The sender has no number or short code to text from."
    else:
        try:
            adapter = registry.for_provider(sender.delivery_provider)       # configuration and credential problems surface before anyone is queued
            batch_size = adapter.max_batch
            if adapter.channel != kind:
                problem = (f"The sender's engine ({sender.delivery_provider.name}) carries {'email' if adapter.channel == 'EMAIL' else 'text messages'}, "
                           f"and this is {'a text' if kind == 'SMS' else 'an email'} campaign. Choose a sender of the right kind.")
            elif kind == "SMS" and text_channel(campaign) == "MMS":
                if not getattr(adapter, "supports_mms", False):
                    problem = f"{sender.delivery_provider.name} cannot send picture messages (MMS)."
                elif not media_url:
                    problem = "This MMS template has no picture with a public address."
        except ProviderError as exc:
            problem = str(exc)
    if problem is None:
        from apps.platform_ops import billing
        try:
            billing.assert_can_send(tenant_id)
        except Exception as exc:                            # noqa: BLE001  (quota exhausted between publish and start)
            problem = str(exc)
    if problem:
        _fail(tenant_id, run, problem)
        return {"batches": [], "audience": {}, "failed": problem, "family": kind}

    with session.tx():
        campaign_list = CampaignList.objects.create(campaign=campaign, campaign_run=run, tenant_id=tenant_id, status="BUILDING")
        if kind == "SMS":
            built = audience_sms.build(tenant_id=tenant_id, campaign=campaign, run=run, campaign_list=campaign_list, content=content, provider=sender.delivery_provider,
                                       sender=sender, channel=text_channel(campaign), media_url=media_url)
        else:
            built = audience.build(tenant_id=tenant_id, campaign=campaign, run=run, campaign_list=campaign_list, content=content, provider_id=sender.delivery_provider_id)
        CampaignList.objects.filter(pk=campaign_list.pk).update(status="FROZEN", member_count=built["members"])
        CampaignRun.objects.filter(pk=run.pk, tenant_id=tenant_id).update(status="SENDING")
        Campaign.objects.filter(pk=campaign.pk, tenant_id=tenant_id).exclude(status__in=["PAUSED", "ARCHIVED"]).update(status="ACTIVE")
        notes = []
        with session.connection().cursor() as cursor:
            if kind == "EMAIL" and not run.test_mode:
                built["ab_test"] = abtest.split(cursor, tenant_id=tenant_id, run=run, campaign=campaign, content=content)
                if built["ab_test"] and "skipped" in built["ab_test"]:
                    notes.append("Subject line test skipped: " + built["ab_test"]["skipped"] + ".")
                elif built["ab_test"]:
                    ab = built["ab_test"]
                    notes.append(f"Subject line test: {ab['a']:,} get A, {ab['b']:,} get B, {ab['held']:,} wait for the winner by {abtest.METRICS[ab['metric']]} at "
                                 f"{ab['decide_at'].astimezone(ZoneInfo(tenant_zone)):%d %b %H:%M}.")
            if campaign.timezone_optimization and not run.test_mode:              # an immediate send works from the moment it was published
                from apps.campaigns import service as campaign_service
                built["local_time"] = sendtime.apply(cursor, tenant_id=tenant_id, run_id=run.pk, family=kind, scheduled_at=run.scheduled_at or timezone.now(),
                                                     campaign_zone=campaign_service.zone_of(campaign))
                local = built["local_time"]
                notes.append(f"Local send times: {local['localised']:,} people get it at {local['wall_clock'][-5:]} their time"
                             + (f", the last at {local['last_at'].astimezone(ZoneInfo(tenant_zone)):%d %b %H:%M} {tenant_zone}" if local["last_at"] else "")
                             + (f"; {local['unknown_zone']:,} with no known zone go now." if local["unknown_zone"] else "."))
        _activity(tenant_id, campaign.pk, run.pk, "SEND_STARTED",
                  f"Send started{' (' + run.sequence_label + ')' if run.sequence_label else ''}: Campaign List frozen with {built['members']:,} people, "
                  f"{built.get('eligible', 0):,} to be sent, {built['members'] - built.get('eligible', 0):,} left out by governance or missing details."
                  + "".join(" " + note for note in notes), detail=built)
        with session.connection().cursor() as cursor:
            cursor.execute(f"SELECT id FROM {TABLE[kind]} WHERE tenant_id = %s AND campaign_run_id = %s AND {DUE[kind]} ORDER BY id", [str(tenant_id), str(run_id)])
            ids = [row[0] for row in cursor.fetchall()]
    batches = [ids[i:i + batch_size] for i in range(0, len(ids), batch_size)]
    if not batches:
        finalize(tenant_id, run_id)                        # nothing due now: a run whose messages all wait stays SENDING until they are
    return {"batches": batches, "audience": built, "family": kind}


def queued_batches(tenant_id, run_id, batch_size: int = 100) -> list[list[int]]:
    """What is to be sent now of a run that is open: resumed after a pause, past its local send times, or released after a subject-line winner."""
    kind = run_family(tenant_id, run_id)
    with session.connection().cursor() as cursor:
        cursor.execute(f"SELECT id FROM {TABLE[kind]} WHERE tenant_id = %s AND campaign_run_id = %s AND {DUE[kind]} ORDER BY id", [str(tenant_id), str(run_id)])
        ids = [row[0] for row in cursor.fetchall()]
    return [ids[i:i + batch_size] for i in range(0, len(ids), batch_size)]


def _jsonable(value):
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value.isoformat() if isinstance(value, datetime) else value


def _activity(tenant_id, campaign_id, run_id, event_type, message, severity="INFO", detail=None) -> None:
    """Under the tenant's transaction whatever the caller holds: outside one, the row-level policy would refuse the insert."""
    from apps.campaigns import service
    with session.tx():
        service.record_run_event(tenant_id, campaign_id, run_id, event_type, message, severity, _jsonable(detail))


def run_family(tenant_id, run_id) -> str:
    run = CampaignRun.objects.select_related("campaign__template").get(pk=run_id, tenant_id=tenant_id)
    return family(run.campaign)


def stats(tenant_id, run_id, kind: str | None = None) -> dict:
    kind = kind or run_family(tenant_id, run_id)
    with session.connection().cursor() as cursor:
        cursor.execute(f"SELECT status, count(*) FROM {TABLE[kind]} WHERE tenant_id = %s AND campaign_run_id = %s GROUP BY 1", [str(tenant_id), str(run_id)])
        by_status = dict(cursor.fetchall())
        cursor.execute("""SELECT COALESCE(m.suppression_reason, 'ELIGIBLE'), count(*) FROM campaign_list_member m JOIN campaign_list l ON l.id = m.campaign_list_id
                           WHERE m.tenant_id = %s AND l.campaign_run_id = %s GROUP BY 1""", [str(tenant_id), str(run_id)])
        members = dict(cursor.fetchall())
        parts = 0
        if kind == "SMS":
            cursor.execute("SELECT COALESCE(sum(segment_count), 0) FROM sms_execution WHERE tenant_id = %s AND campaign_run_id = %s AND status NOT IN ('QUEUED', 'FAILED')",
                           [str(tenant_id), str(run_id)])
            parts = int(cursor.fetchone()[0])
    eligible = members.pop("ELIGIBLE", 0)
    sent = sum(v for k, v in by_status.items() if k not in ("QUEUED", "FAILED"))
    got = by_status.get
    messages = {"queued": got("QUEUED", 0), "sent": sent, "failed": got("FAILED", 0),
                "delivered": sum(got(k, 0) for k in (("DELIVERED", "RESPONDED", "OPTED_OUT") if kind == "SMS" else ("DELIVERED", "OPENED", "CLICKED"))),
                "opened": got("OPENED", 0) + got("CLICKED", 0), "clicked": got("CLICKED", 0), "bounced": got("BOUNCED", 0), "complained": got("COMPLAINED", 0),
                "replied": got("RESPONDED", 0) + got("OPTED_OUT", 0), "opted_out": got("OPTED_OUT", 0), "parts": parts}
    return {"family": kind, "audience": {"members": eligible + sum(members.values()), "eligible": eligible, "suppressed": members}, "messages": messages, "by_status": by_status}


def finalize(tenant_id, run_id) -> str | None:
    """COMPLETED when nothing is queued any more; FAILED when nothing at all went out. Returns the new status, or None while still sending."""
    notice = None
    with session.tx():
        run = CampaignRun.objects.select_related("campaign__template").get(pk=run_id, tenant_id=tenant_id)
        if run.status != "SENDING" or run.run_type == "ERECEIPT_INSTANCE":    # a receipt run stays open all day: receipts.py closes yesterday's
            return None
        numbers = stats(tenant_id, run_id, family(run.campaign))["messages"]
        if numbers["queued"]:
            return None
        outcome = "FAILED" if numbers["failed"] and not numbers["sent"] else "COMPLETED"
        now = timezone.now()
        CampaignRun.objects.filter(pk=run.pk, tenant_id=tenant_id, status="SENDING").update(status=outcome, completed_at=now)
        if not run.test_mode:
            _activity(tenant_id, run.campaign_id, run.pk, "SEND_FAILED" if outcome == "FAILED" else "SEND_COMPLETED",
                      (f"Send failed: none of {numbers['failed']:,} messages went out." if outcome == "FAILED"
                       else f"Send completed: {numbers['sent']:,} sent" + (f", {numbers['failed']:,} failed." if numbers["failed"] else ".")),
                      severity="ERROR" if outcome == "FAILED" else "INFO", detail=numbers)
            name = run.campaign.name + (f" ({run.sequence_label})" if run.sequence_label else "")
            notice = (_notice(tenant_id, run, "send_failed", f"{name}: the send failed", [f"None of {numbers['failed']:,} messages went out.", "Check the sending engine under Settings → Integrations, then publish again."])
                      if outcome == "FAILED" else
                      _notice(tenant_id, run, "send_completed", f"{name}: send completed",
                              [f"{numbers['sent']:,} sent" + (f", {numbers['failed']:,} failed" if numbers["failed"] else "") + f", {numbers['delivered']:,} delivered so far.",
                               "Opens and clicks keep coming in on the campaign's Performance tab."]))
        still_open = CampaignRun.objects.filter(campaign_id=run.campaign_id, tenant_id=tenant_id, status__in=["SCHEDULED", "PREPARING", "SENDING", "PAUSED"]).exclude(pk=run.pk).exists()
        # a one-time send, or the last step of a drip series, completes the campaign; a recurring campaign goes on (service.schedule_next_occurrence ends it)
        if not still_open and run.run_type in ("ONE_TIME", "DRIP_INSTANCE"):
            Campaign.objects.filter(pk=run.campaign_id, tenant_id=tenant_id, status="ACTIVE").update(status="COMPLETED", completed_at=now)
    _deliver(notice)
    return outcome


def sweep(tenant_id, run_id) -> int:
    """A worker died between claiming a message and recording the provider's answer: say so instead of leaving it 'submitted' forever."""
    with session.tx():
        kind = run_family(tenant_id, run_id)
        with session.connection().cursor() as cursor:
            unconfirmed = "provider_acked_at IS NULL" if kind == "SMS" else "provider_message_id IS NULL"       # an aggregator may answer without an id
            cursor.execute(f"""UPDATE {TABLE[kind]} SET status = 'FAILED', status_reason = 'Interrupted before the provider confirmed the message'
                                WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'SUBMITTED' AND {unconfirmed} AND submitted_at < %s""",
                           [str(tenant_id), str(run_id), timezone.now() - STALE_CLAIM])
            return cursor.rowcount


def due(limit: int = 50) -> list[tuple[str, str, str]]:
    """(tenant_id, run_id, status) of runs to start or to close, across tenants. Read on the platform connection."""
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("""SELECT r.tenant_id, r.id, r.status FROM campaign_run r JOIN tenant t ON t.id = r.tenant_id
                             JOIN campaign c ON c.id = r.campaign_id AND c.tenant_id = r.tenant_id
                           WHERE t.status = 'ACTIVE' AND ((r.status = 'SCHEDULED' AND (r.scheduled_at IS NULL OR r.scheduled_at <= now()) AND NOT r.test_mode
                                                           AND c.status NOT IN ('PAUSED', 'ARCHIVED'))
                                  OR (r.status = 'SENDING' AND r.run_type <> 'ERECEIPT_INSTANCE' AND r.started_at < now() - interval '2 minutes'))
                           ORDER BY r.created_at LIMIT %s""", [limit])
        return [(str(a), str(b), c) for a, b, c in cursor.fetchall()]
