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


@shared_task(name="workers.platform.check_engine_health")
@jobs.monitored("check-engine-health")
def check_engine_health() -> dict:
    from apps.delivery import health
    return health.run()


@shared_task(name="workers.platform.check_engines_daily")
@jobs.monitored("check-engines-daily")
def check_engines_daily() -> dict:
    from apps.delivery import health
    return health.check_all()


@shared_task(name="workers.platform.probe_uptime")
@jobs.monitored("probe-uptime")
def probe_uptime() -> dict:
    from apps.platform_ops import observe
    observe.flush_metrics()
    return observe.probe_uptime()


@shared_task(name="workers.platform.check_security")
@jobs.monitored("check-security")
def check_security() -> dict:
    from apps.platform_ops import security
    return security.run("SCHEDULE")


@shared_task(name="workers.platform.prune_observability")
@jobs.monitored("prune-observability")
def prune_observability() -> dict:
    from apps.platform_ops import observe
    return observe.prune()


@shared_task(name="workers.platform.attribute_orders")
@jobs.monitored("attribute-orders")
def attribute_orders() -> dict:
    from apps.reporting import attribution
    return attribution.run()


def _dispatch_campaign_runs() -> dict:
    from workers.campaign import dispatch_due_runs
    return dispatch_due_runs()


RUNNABLE = {"rollup-usage": rollup_usage, "generate-invoices": generate_invoices, "evaluate-alerts": evaluate_alerts,
            "run-tenant-operations": run_tenant_operations, "dispatch-campaign-runs": _dispatch_campaign_runs,
            "rollup-integration-metrics": rollup_integration_metrics, "probe-uptime": probe_uptime, "prune-observability": prune_observability, "check-security": check_security,
            "attribute-orders": attribute_orders, "check-engine-health": check_engine_health, "check-engines-daily": check_engines_daily,
            "decide-ab-winners": lambda: __import__("workers.campaign", fromlist=["decide_ab_winners"]).decide_ab_winners(),
            "send-weekly-reports": lambda: __import__("workers.reports", fromlist=["send_weekly_reports"]).send_weekly_reports(),
            "deliver-report-schedules": lambda: __import__("workers.insights_delivery", fromlist=["deliver_report_schedules"]).deliver_report_schedules(),
            "check-report-alerts": lambda: __import__("workers.insights_alerts", fromlist=["check_report_alerts"]).check_report_alerts(),
            "refresh-clickhouse-reporting": lambda: __import__("workers.insights_clickhouse", fromlist=["refresh_clickhouse_reporting"]).refresh_clickhouse_reporting(),
            "refresh-audience-lists": lambda: __import__("workers.campaign", fromlist=["refresh_audience_lists"]).refresh_audience_lists(),
            "enroll-journey-customers": lambda: __import__("workers.journey", fromlist=["enroll_customers"]).enroll_customers(),
            "advance-journey-customers": lambda: __import__("workers.journey", fromlist=["advance_customers"]).advance_customers(),
            "rollup-journey-analytics": lambda: __import__("workers.journey", fromlist=["rollup_analytics"]).rollup_analytics()}
