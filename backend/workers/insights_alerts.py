"""Threshold alerts: every few minutes, each workspace's alerts whose check is due are read and, on the way across their
threshold, emailed (apps/insights/alerts.check). One alert's trouble is recorded on it and never stops the others."""
import logging

from celery import shared_task
from django.utils import timezone

from apps.delivery.engine import session
from apps.insights import alerts
from apps.platform_ops import jobs
from apps.tenants.models import Tenant
from workers.insights_delivery import active_tenants

log = logging.getLogger("cep.insights")


@shared_task(name="workers.insights_alerts.check_report_alerts")
@jobs.monitored("check-report-alerts")
def check_report_alerts() -> dict:
    checked, fired, failed = 0, 0, 0
    if not alerts.present():
        return {"checked": 0, "fired": 0, "failed": 0, "skipped": "patch 0062 not applied"}
    now = timezone.now()
    for tenant_id in active_tenants():
        try:
            with session.tenant_scope(tenant_id):
                rows = alerts.due(now)
                if not rows:
                    continue
                tenant = Tenant.objects.get(pk=tenant_id)
                for row in rows:
                    result = alerts.check(tenant, row)
                    checked += 1
                    fired += 1 if result["notified"] else 0
                    failed += 0 if result["outcome"] == "OK" else 1
        except Exception:                                  # noqa: BLE001  one workspace's trouble must not stop the others
            log.exception("report alerts failed for tenant %s", tenant_id)
            failed += 1
    return {"checked": checked, "fired": fired, "failed": failed}
