"""Journey runtime jobs (apps/journeys/engine): enrollment and advancing every minute, the analytics rollup nightly,
and (apps/journeys/publish.py) going live with journeys Approved and Scheduled once their time comes."""
from celery import shared_task

from apps.journeys import publish
from apps.journeys.engine import advance, enroll, rollup
from apps.platform_ops import jobs


@shared_task(name="workers.journey.enroll_customers")
@jobs.monitored("enroll-journey-customers")
def enroll_customers() -> dict:
    return enroll.run()


@shared_task(name="workers.journey.advance_customers")
@jobs.monitored("advance-journey-customers")
def advance_customers() -> dict:
    return advance.run()


@shared_task(name="workers.journey.rollup_analytics")
@jobs.monitored("rollup-journey-analytics")
def rollup_analytics() -> dict:
    return rollup.run()


@shared_task(name="workers.journey.activate_scheduled")
@jobs.monitored("activate-scheduled-journeys")
def activate_scheduled() -> dict:
    return publish.activate_due()
