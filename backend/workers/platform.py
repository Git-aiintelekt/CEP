"""Platform jobs. Each is recorded in job_run (apps.platform_ops.jobs.monitored), so the health page and the alerts know
when one stops succeeding. Run one by hand with `manage.py run_job <name>` (no Celery needed)."""
from celery import shared_task

from apps.platform_ops import alerts, billing, jobs, tenant_ops


@shared_task(name="workers.platform.rollup_usage")
@jobs.monitored("rollup-usage")
def rollup_usage() -> dict:
    return billing.rollup_usage()


@shared_task(name="workers.platform.generate_invoices")
@jobs.monitored("generate-invoices")
def generate_invoices() -> dict:
    return billing.generate_invoices()


@shared_task(name="workers.platform.evaluate_alerts")
@jobs.monitored("evaluate-alerts")
def evaluate_alerts() -> dict:
    result = alerts.evaluate()
    jobs.prune()
    return result


@shared_task(name="workers.platform.run_tenant_operations")
@jobs.monitored("run-tenant-operations")
def run_tenant_operations() -> dict:
    return tenant_ops.run_requested()


@shared_task(name="workers.platform.rollup_integration_metrics")
@jobs.monitored("rollup-integration-metrics")
def rollup_integration_metrics() -> dict:
    from apps.integrations.bridge import metrics
    return metrics.rollup()


def _dispatch_campaign_runs() -> dict:
    from workers.campaign import dispatch_due_runs
    return dispatch_due_runs()


RUNNABLE = {"rollup-usage": rollup_usage, "generate-invoices": generate_invoices, "evaluate-alerts": evaluate_alerts,
            "run-tenant-operations": run_tenant_operations, "dispatch-campaign-runs": _dispatch_campaign_runs,
            "rollup-integration-metrics": rollup_integration_metrics,
            "refresh-audience-lists": lambda: __import__("workers.campaign", fromlist=["refresh_audience_lists"]).refresh_audience_lists()}
