"""Partition lifecycle — runs against every database alias (pool + each dedicated tenant)."""
from celery import shared_task
from django.conf import settings
from django.db import connections

from apps.platform_ops.jobs import monitored


def _all_aliases():
    return list(settings.DATABASES.keys())


@shared_task(name="workers.maintenance.ensure_monthly_partitions")
@monitored("ensure-monthly-partitions")
def ensure_monthly_partitions(months_ahead: int = 3) -> dict:
    out = {}
    for alias in _all_aliases():
        with connections[alias].cursor() as cur:
            cur.execute("SELECT fn_ensure_monthly_partitions(%s)", [months_ahead])
            out[alias] = cur.fetchone()[0]
    return out


@shared_task(name="workers.maintenance.apply_partition_retention")
@monitored("apply-partition-retention")
def apply_partition_retention() -> dict:
    out = {}
    for alias in _all_aliases():
        with connections[alias].cursor() as cur:
            cur.execute("SELECT fn_apply_partition_retention()")
            out[alias] = cur.fetchone()[0]
    return out
