"""Campaign run orchestration (queue: campaign).

    dispatch_due_runs   beat, every minute: starts runs whose time has come, keeps sending runs fed and closes finished ones,
                        and starts again a run left PREPARING by a worker that stopped
    start_run           builds the audience and gives the first batches of the send window to workers.email / workers.sms
    finalize_run        after each batch: gives out the next batch; closes the run once nothing is queued
    plan_recurring_runs beat, every 5 minutes: the next occurrence of each recurring campaign, until its end
    run_warm_ups        beat, every minute: Delivery Warm-Up (apps/delivery/warmup.py)
"""
import logging

from celery import shared_task

from apps.delivery.engine import abtest, runs, session
from apps.platform_ops import jobs

log = logging.getLogger("cep.delivery")


def _send(kind: str, tenant_id: str, run_id: str, batches: list[list[int]]) -> None:
    from workers.email import send_batch as send_email_batch
    from workers.sms import send_batch as send_sms_batch
    for batch in batches:
        (send_sms_batch if kind == "SMS" else send_email_batch).delay(tenant_id, run_id, batch)


# building the audience of a very large run takes minutes; a worker that hangs is replaced, and the run is prepared again
@shared_task(name="workers.campaign.start_run", soft_time_limit=2 * 3600, time_limit=2 * 3600 + 300)
def start_run(tenant_id: str, run_id: str) -> dict:
    with session.tenant_scope(tenant_id):
        try:
            started = runs.start(tenant_id, run_id, window=runs.WINDOW)
        except runs.RunNotStarted as exc:
            return {"skipped": str(exc)}
    _send(started.get("family") or "EMAIL", tenant_id, run_id, started["batches"])
    return {"batches": len(started["batches"]), **started.get("audience", {})}


@shared_task(name="workers.campaign.finalize_run", soft_time_limit=600, time_limit=660)
def finalize_run(tenant_id: str, run_id: str, refill: int = 1) -> dict:
    """After a batch (refill=1): the run's next batch. From the dispatcher (refill=0): nothing while batches are with workers;
    otherwise a full window of what is due (local send times, a subject-line winner, a resume, workers that died). Closes the
    run once nothing is queued."""
    with session.tenant_scope(tenant_id):
        swept = runs.sweep(tenant_id, run_id)
        with session.tx():
            due = runs.hand_out(tenant_id, run_id, refill)
            busy = runs.in_flight(tenant_id, run_id)
            if not due and not busy:
                due = runs.hand_out(tenant_id, run_id, runs.WINDOW)
            kind = runs.run_family(tenant_id, run_id) if due else None
        _send(kind, tenant_id, run_id, due)
        if due or busy:
            return {"status": None, "swept": swept, "batches": len(due)}
        return {"status": runs.finalize(tenant_id, run_id), "swept": swept, "batches": 0}


@shared_task(name="workers.campaign.decide_ab_winners")
@jobs.monitored("decide-ab-winners")
def decide_ab_winners() -> dict:
    decided, failed = 0, 0
    for tenant_id, run_id in abtest.due():
        try:
            with session.tenant_scope(tenant_id):
                abtest.decide(tenant_id, run_id)
            decided += 1
        except Exception:                                  # noqa: BLE001  one run's trouble must not stop the others
            log.exception("subject-line winner not decided for run %s", run_id)
            failed += 1
    return {"decided": decided, "failed": failed}


@shared_task(name="workers.campaign.run_warm_ups")
@jobs.monitored("run-delivery-warm-ups")
def run_warm_ups() -> dict:
    """Delivery Warm-Up, every minute: the day judged at midnight, the hour's warm-up sends picked, email let out within the hourly limit."""
    from apps.delivery import warmup
    return warmup.run_all()


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
    started = closing = recovered = 0
    for tenant_id, run_id, status in runs.due():
        if status == "SCHEDULED":
            start_run.delay(tenant_id, run_id)
            started += 1
        elif status == "PREPARING":
            try:
                with session.tenant_scope(tenant_id):
                    recovered += int(runs.recover_preparing(tenant_id, run_id))
            except Exception:                              # noqa: BLE001  one run's trouble must not stop the others
                log.exception("run %s left PREPARING was not looked at", run_id)
        else:
            finalize_run.delay(tenant_id, run_id, 0)
            closing += 1
    return {"started": started, "checked_for_completion": closing, "prepared_again": recovered}
