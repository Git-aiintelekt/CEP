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
from apps.templates.models import RenderedTemplateContent

from ..providers import ProviderError, registry
from . import audience, audience_sms, session

log = logging.getLogger("cep.delivery")
STALE_CLAIM = timedelta(minutes=15)
TABLE = {"EMAIL": "mailer_execution", "SMS": "sms_execution"}


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


def _fail(tenant_id, run, reason: str) -> None:
    log.error("run %s failed: %s", run.pk, reason)
    with session.tx():
        CampaignRun.objects.filter(pk=run.pk, tenant_id=tenant_id).update(status="FAILED", completed_at=timezone.now())
    if not run.test_mode:
        _activity(tenant_id, run.campaign_id, run.pk, "SEND_FAILED", f"Send could not start: {reason}", severity="ERROR")


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
        _activity(tenant_id, campaign.pk, run.pk, "SEND_STARTED",
                  f"Send started{' (' + run.sequence_label + ')' if run.sequence_label else ''}: Campaign List frozen with {built['members']:,} people, "
                  f"{built.get('eligible', 0):,} to be sent, {built['members'] - built.get('eligible', 0):,} left out by governance or missing details.", detail=built)
        with session.connection().cursor() as cursor:
            cursor.execute(f"SELECT id FROM {TABLE[kind]} WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED' ORDER BY id", [str(tenant_id), str(run_id)])
            ids = [row[0] for row in cursor.fetchall()]
    batches = [ids[i:i + batch_size] for i in range(0, len(ids), batch_size)]
    if not batches:
        finalize(tenant_id, run_id)
    return {"batches": batches, "audience": built, "family": kind}


def queued_batches(tenant_id, run_id, batch_size: int = 100) -> list[list[int]]:
    """What is still to be sent of a run that was paused and resumed: the messages nobody has claimed yet."""
    kind = run_family(tenant_id, run_id)
    with session.connection().cursor() as cursor:
        cursor.execute(f"SELECT id FROM {TABLE[kind]} WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED' ORDER BY id", [str(tenant_id), str(run_id)])
        ids = [row[0] for row in cursor.fetchall()]
    return [ids[i:i + batch_size] for i in range(0, len(ids), batch_size)]


def _activity(tenant_id, campaign_id, run_id, event_type, message, severity="INFO", detail=None) -> None:
    from apps.campaigns import service
    service.record_run_event(tenant_id, campaign_id, run_id, event_type, message, severity, detail)


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
        still_open = CampaignRun.objects.filter(campaign_id=run.campaign_id, tenant_id=tenant_id, status__in=["SCHEDULED", "PREPARING", "SENDING", "PAUSED"]).exclude(pk=run.pk).exists()
        # a one-time send, or the last step of a drip series, completes the campaign; a recurring campaign goes on (service.schedule_next_occurrence ends it)
        if not still_open and run.run_type in ("ONE_TIME", "DRIP_INSTANCE"):
            Campaign.objects.filter(pk=run.campaign_id, tenant_id=tenant_id, status="ACTIVE").update(status="COMPLETED", completed_at=now)
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
