"""The weekly report email: once a week, in each workspace's own time, to the addresses its administrator chose."""
import logging

from celery import shared_task
from django.conf import settings
from django.db import connections
from django.utils import timezone

from apps.delivery.engine import session
from apps.platform_ops import jobs, notifications
from apps.reporting import reports
from apps.tenants.models import Tenant

log = logging.getLogger("cep.reports")


def due_tenants() -> list[tuple[str, str, dict]]:
    """(tenant_id, name, weekly settings) of workspaces whose report is due now and was not sent today."""
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("""SELECT id, name, timezone, settings -> 'reports' -> 'weekly' FROM tenant
                           WHERE status = 'ACTIVE' AND deleted_at IS NULL AND (settings -> 'reports' -> 'weekly' ->> 'enabled') = 'true'""")
        rows = cursor.fetchall()
    due = []
    for tenant_id, name, zone_name, weekly in rows:
        weekly = {**reports.WEEKLY_DEFAULTS, **(weekly or {})}
        local = timezone.now().astimezone(reports.zone_of(type("T", (), {"timezone": zone_name})()))
        if local.weekday() == int(weekly["weekday"]) and local.hour >= int(weekly["hour"]) and weekly.get("last_sent_on") != local.date().isoformat() and weekly["recipients"]:
            due.append((str(tenant_id), name, weekly))
    return due


def send_for(tenant_id: str, weekly: dict) -> dict:
    """Must run inside session.tenant_scope(tenant_id)."""
    with session.tx():
        tenant = Tenant.objects.get(pk=tenant_id)
        zone = reports.zone_of(tenant)
        today = timezone.now().astimezone(zone).date()
        report = reports.summary(tenant, today - timezone.timedelta(days=7), today - timezone.timedelta(days=1))
        config = notifications.prepare(tenant)
        reports.mark_weekly_sent(tenant, today)
        name = tenant.name
    outcome = notifications.deliver(config, tenant_id, "weekly_report", title=f"{name}: last week in numbers", lines=reports.weekly_lines(report),
                                    link=settings.FRONTEND_URL.rstrip("/") + "/reports", link_label="Open Reports", to=weekly["recipients"])
    return {"sent": report["totals"]["sent"], **outcome}


@shared_task(name="workers.reports.send_weekly_reports")
@jobs.monitored("send-weekly-reports")
def send_weekly_reports() -> dict:
    sent, failed = 0, 0
    for tenant_id, _name, weekly in due_tenants():
        try:
            with session.tenant_scope(tenant_id):
                send_for(tenant_id, weekly)
            sent += 1
        except Exception:                                  # noqa: BLE001  one workspace's trouble must not stop the others
            log.exception("weekly report not sent for tenant %s", tenant_id)
            failed += 1
    return {"sent": sent, "failed": failed}
