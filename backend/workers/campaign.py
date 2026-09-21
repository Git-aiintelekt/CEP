"""Campaign run orchestration (queue: campaign).

    dispatch_due_runs   beat, every minute: starts runs whose time has come, closes runs whose last batch is done
    start_run           builds the audience and fans the executions out to workers.email.send_batch
    finalize_run        closes the run once nothing is queued
    plan_recurring_runs beat, every 5 minutes: the next occurrence of each recurring campaign, until its end
"""
import logging

from celery import shared_task

from apps.delivery.engine import runs, session
from apps.platform_ops import jobs

log = logging.getLogger("cep.delivery")


@shared_task(name="workers.campaign.start_run")
def start_run(tenant_id: str, run_id: str) -> dict:
    from workers.email import send_batch as send_email_batch
    from workers.sms import send_batch as send_sms_batch
    with session.tenant_scope(tenant_id):
        try:
            started = runs.start(tenant_id, run_id)
        except runs.RunNotStarted as exc:
            return {"skipped": str(exc)}
    send_batch = send_sms_batch if started.get("family") == "SMS" else send_email_batch
    for batch in started["batches"]:
        send_batch.delay(tenant_id, run_id, batch)
    return {"batches": len(started["batches"]), **started.get("audience", {})}


@shared_task(name="workers.campaign.finalize_run")
def finalize_run(tenant_id: str, run_id: str) -> dict:
    with session.tenant_scope(tenant_id):
        swept = runs.sweep(tenant_id, run_id)
        return {"status": runs.finalize(tenant_id, run_id), "swept": swept}


@shared_task(name="workers.campaign.refresh_audience_lists")
@jobs.monitored("refresh-audience-lists")
def refresh_audience_lists() -> dict:
    """Contact lists that follow a BI / extraction audience, per workspace, when their refresh interval has passed."""
    from django.conf import settings

    from apps.contact_lists import lists
    from apps.tenants.models import Tenant
    refreshed = failed = 0
    for tenant_id in Tenant.objects.using(settings.CONTROL_PLANE_ALIAS).filter(status="ACTIVE", deleted_at__isnull=True).values_list("id", flat=True):
        try:
            with session.tenant_scope(str(tenant_id)), session.tx():
                refreshed += lists.refresh_due(tenant_id)
        except Exception:                                 # one workspace's problem does not stop the others
            failed += 1
    return {"refreshed": refreshed, "workspaces_failed": failed}


@shared_task(name="workers.campaign.plan_recurring_runs")
@jobs.monitored("plan-recurring-runs")
def plan_recurring_runs() -> dict:
    """One campaign, many Runs (BRD 7): when no occurrence of a recurring campaign is waiting, the next one is created."""
    from django.conf import settings

    from apps.campaigns import service
    from apps.campaigns.models import Campaign
    from apps.tenants.models import Tenant
    planned = failed = 0
    for tenant_id in Tenant.objects.using(settings.CONTROL_PLANE_ALIAS).filter(status="ACTIVE", deleted_at__isnull=True).values_list("id", flat=True):
        try:
            with session.tenant_scope(str(tenant_id)), session.tx():
                recurring = (Campaign.objects.filter(tenant_id=tenant_id, send_type="RECURRING", status__in=service.LIVE, deleted_at__isnull=True)
                             .select_related("tenant").prefetch_related("campaign_runs"))
                planned += sum(1 for campaign in recurring if service.schedule_next_occurrence(campaign) is not None)
        except Exception:                                 # one workspace's problem does not stop the others
            log.exception("planning recurring runs failed for workspace %s", tenant_id)
            failed += 1
    return {"planned": planned, "workspaces_failed": failed}


@shared_task(name="workers.campaign.dispatch_due_runs")
@jobs.monitored("dispatch-campaign-runs")
def dispatch_due_runs() -> dict:
    started = closing = 0
    for tenant_id, run_id, status in runs.due():
        if status == "SCHEDULED":
            start_run.delay(tenant_id, run_id)
            started += 1
        else:
            finalize_run.delay(tenant_id, run_id)
            closing += 1
    return {"started": started, "checked_for_completion": closing}
