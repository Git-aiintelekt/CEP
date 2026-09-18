"""The life of a campaign run: SCHEDULED -> PREPARING -> SENDING -> COMPLETED | FAILED.

    start(tenant_id, run_id)      claims the run, builds the audience, queues the executions, returns the batches
    finalize(tenant_id, run_id)   closes the run once nothing is queued any more
    sweep(tenant_id, run_id)      turns messages that were claimed but never confirmed into visible failures
    due()                         every run that should start now, across tenants (platform connection)

Callers wrap these in session.tenant_scope(tenant_id); each step commits on its own.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.db import connections
from django.utils import timezone

from apps.campaigns.models import Campaign, CampaignList, CampaignRun
from apps.templates.models import RenderedTemplateContent

from ..providers import ProviderError, registry
from . import audience, session

log = logging.getLogger("cep.delivery")
STALE_CLAIM = timedelta(minutes=15)


class RunNotStarted(Exception):
    pass


def _fail(tenant_id, run, reason: str) -> None:
    log.error("run %s failed: %s", run.pk, reason)
    with session.tx():
        CampaignRun.objects.filter(pk=run.pk, tenant_id=tenant_id).update(status="FAILED", completed_at=timezone.now())


def start(tenant_id, run_id) -> dict:
    """-> {'batches': [[execution ids], ...], 'audience': {...}}. Safe to call twice: only one caller gets the claim."""
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""UPDATE campaign_run SET status = 'PREPARING', started_at = now()
                           WHERE id = %s AND tenant_id = %s AND status = 'SCHEDULED' AND (scheduled_at IS NULL OR scheduled_at <= now()) RETURNING id""",
                       [str(run_id), str(tenant_id)])
        if cursor.fetchone() is None:
            raise RunNotStarted("The run is not waiting to start (already started, cancelled, or scheduled for later).")

    with session.tx():
        run = CampaignRun.objects.select_related("campaign__template", "campaign__sender_profile__delivery_provider").get(pk=run_id, tenant_id=tenant_id)
        campaign = run.campaign
        sender = campaign.sender_profile
        content = RenderedTemplateContent.objects.filter(template_id=campaign.template_id).order_by("-version_number").first() if campaign.template_id else None

    problem = None
    if campaign.channel != "EMAIL" and not (campaign.template_id and campaign.template.channel in ("EMAIL", "E_RECEIPT")):
        problem = f"The send engine delivers email; this campaign's channel is {campaign.channel}."
    elif sender is None or sender.deleted_at is not None:
        problem = "The campaign has no usable sender."
    elif content is None or not (content.html_content or content.text_content):
        problem = "The template has no saved content."
    else:
        try:
            adapter = registry.for_provider(sender.delivery_provider)       # configuration and credential problems surface before anyone is queued
            batch_size = adapter.max_batch
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
        return {"batches": [], "audience": {}, "failed": problem}

    with session.tx():
        campaign_list = CampaignList.objects.create(campaign=campaign, campaign_run=run, tenant_id=tenant_id, status="BUILDING")
        built = audience.build(tenant_id=tenant_id, campaign=campaign, run=run, campaign_list=campaign_list, content=content, provider_id=sender.delivery_provider_id)
        CampaignList.objects.filter(pk=campaign_list.pk).update(status="FROZEN", member_count=built["members"])
        CampaignRun.objects.filter(pk=run.pk, tenant_id=tenant_id).update(status="SENDING")
        Campaign.objects.filter(pk=campaign.pk, tenant_id=tenant_id).update(status="ACTIVE")
        with session.connection().cursor() as cursor:
            cursor.execute("SELECT id FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED' ORDER BY id", [str(tenant_id), str(run_id)])
            ids = [row[0] for row in cursor.fetchall()]
    batches = [ids[i:i + batch_size] for i in range(0, len(ids), batch_size)]
    if not batches:
        finalize(tenant_id, run_id)
    return {"batches": batches, "audience": built}


def stats(tenant_id, run_id) -> dict:
    with session.connection().cursor() as cursor:
        cursor.execute("SELECT status, count(*) FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s GROUP BY 1", [str(tenant_id), str(run_id)])
        by_status = dict(cursor.fetchall())
        cursor.execute("""SELECT COALESCE(m.suppression_reason, 'ELIGIBLE'), count(*) FROM campaign_list_member m JOIN campaign_list l ON l.id = m.campaign_list_id
                           WHERE m.tenant_id = %s AND l.campaign_run_id = %s GROUP BY 1""", [str(tenant_id), str(run_id)])
        members = dict(cursor.fetchall())
    eligible = members.pop("ELIGIBLE", 0)
    sent = sum(v for k, v in by_status.items() if k not in ("QUEUED", "FAILED"))
    return {"audience": {"members": eligible + sum(members.values()), "eligible": eligible, "suppressed": members},
            "messages": {"queued": by_status.get("QUEUED", 0), "sent": sent, "failed": by_status.get("FAILED", 0),
                         "delivered": sum(by_status.get(k, 0) for k in ("DELIVERED", "OPENED", "CLICKED")), "opened": by_status.get("OPENED", 0) + by_status.get("CLICKED", 0),
                         "clicked": by_status.get("CLICKED", 0), "bounced": by_status.get("BOUNCED", 0), "complained": by_status.get("COMPLAINED", 0)},
            "by_status": by_status}


def finalize(tenant_id, run_id) -> str | None:
    """COMPLETED when nothing is queued any more; FAILED when nothing at all went out. Returns the new status, or None while still sending."""
    with session.tx():
        run = CampaignRun.objects.select_related("campaign").get(pk=run_id, tenant_id=tenant_id)
        if run.status != "SENDING":
            return None
        numbers = stats(tenant_id, run_id)["messages"]
        if numbers["queued"]:
            return None
        outcome = "FAILED" if numbers["failed"] and not numbers["sent"] else "COMPLETED"
        CampaignRun.objects.filter(pk=run.pk, tenant_id=tenant_id, status="SENDING").update(status=outcome, completed_at=timezone.now())
        still_open = CampaignRun.objects.filter(campaign_id=run.campaign_id, tenant_id=tenant_id, status__in=["SCHEDULED", "PREPARING", "SENDING"]).exclude(pk=run.pk).exists()
        if not still_open and run.run_type == "ONE_TIME":
            Campaign.objects.filter(pk=run.campaign_id, tenant_id=tenant_id, status="ACTIVE").update(status="COMPLETED")
    return outcome


def sweep(tenant_id, run_id) -> int:
    """A worker died between claiming a message and recording the provider's answer: say so instead of leaving it 'submitted' forever."""
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""UPDATE mailer_execution SET status = 'FAILED', status_reason = 'Interrupted before the provider confirmed the message'
                           WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'SUBMITTED' AND provider_message_id IS NULL AND submitted_at < %s""",
                       [str(tenant_id), str(run_id), timezone.now() - STALE_CLAIM])
        return cursor.rowcount


def due(limit: int = 50) -> list[tuple[str, str, str]]:
    """(tenant_id, run_id, status) of runs to start or to close, across tenants. Read on the platform connection."""
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("""SELECT r.tenant_id, r.id, r.status FROM campaign_run r JOIN tenant t ON t.id = r.tenant_id
                           WHERE t.status = 'ACTIVE' AND ((r.status = 'SCHEDULED' AND (r.scheduled_at IS NULL OR r.scheduled_at <= now()) AND NOT r.test_mode)
                                  OR (r.status = 'SENDING' AND r.started_at < now() - interval '2 minutes'))
                           ORDER BY r.created_at LIMIT %s""", [limit])
        return [(str(a), str(b), c) for a, b, c in cursor.fetchall()]
