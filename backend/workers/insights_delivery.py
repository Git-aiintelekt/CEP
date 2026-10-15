"""Scheduled report deliveries: every few minutes, each workspace's schedules whose time has come are built and sent
(apps/insights/schedules.deliver). One schedule's trouble is recorded on it and never stops the others."""
import logging

from celery import shared_task
from django.conf import settings
from django.db import connections
from django.utils import timezone

from apps.delivery.engine import session
from apps.insights import schedules
from apps.platform_ops import jobs
from apps.tenants.models import Tenant

log = logging.getLogger("cep.insights")


def active_tenants() -> list[str]:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("SELECT id::text FROM tenant WHERE status = 'ACTIVE' AND deleted_at IS NULL ORDER BY created_at")
        return [row[0] for row in cursor.fetchall()]


@shared_task(name="workers.insights_delivery.deliver_report_schedules")
@jobs.monitored("deliver-report-schedules")
def deliver_report_schedules() -> dict:
    sent, failed = 0, 0
    now = timezone.now()
    for tenant_id in active_tenants():
        try:
            with session.tenant_scope(tenant_id):
                rows = schedules.due(now)
                if not rows:
                    continue
                tenant = Tenant.objects.get(pk=tenant_id)
                for row in rows:
                    result = schedules.deliver(tenant, row)
                    if result["outcome"] == "OK":
                        sent += 1
                    else:
                        failed += 1
        except Exception:                                  # noqa: BLE001  one workspace's trouble must not stop the others
            log.exception("report deliveries failed for tenant %s", tenant_id)
            failed += 1
    return {"sent": sent, "failed": failed}
