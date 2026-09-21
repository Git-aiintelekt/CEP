"""Contact list uploads (queue: imports). The queue itself is the contact_list_import table: see apps/contact_lists/jobs.py."""
from celery import shared_task

from apps.platform_ops import jobs as job_monitor


@shared_task(name="workers.lists.process_imports", acks_late=True)
@job_monitor.monitored("process-list-imports")
def process_imports() -> dict:
    """Runs what is claimable, within the platform's limits. Sent by the API when something is queued, and by beat as a net."""
    from apps.contact_lists import jobs
    return jobs.run_pending()
