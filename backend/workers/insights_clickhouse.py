"""The ClickHouse reporting tables kept fresh: every few minutes, the recent window of each dataset is loaded again for the
workspaces on ClickHouse (apps/insights/clickhouse.refresh). A workspace's trouble is logged and never stops the others."""
import logging

from celery import shared_task

from apps.delivery.engine import session
from apps.insights import clickhouse
from apps.platform_ops import jobs

log = logging.getLogger("cep.insights")


@shared_task(name="workers.insights_clickhouse.refresh_clickhouse_reporting")
@jobs.monitored("refresh-clickhouse-reporting")
def refresh_clickhouse_reporting() -> dict:
    if not clickhouse.configured():
        return {"skipped": "not configured"}
    refreshed, failed, rows = 0, 0, 0
    for tenant_id in clickhouse.workspaces_on_clickhouse():
        try:
            with session.tenant_scope(tenant_id):
                loaded = clickhouse.refresh(tenant_id)
            rows += sum(loaded.values())
            refreshed += 1
        except Exception:                                  # noqa: BLE001  one workspace's trouble must not stop the others
            log.exception("ClickHouse refresh failed for tenant %s", tenant_id)
            failed += 1
    return {"workspaces": refreshed, "rows": rows, "failed": failed}
