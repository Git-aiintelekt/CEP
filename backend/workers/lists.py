"""Contact list uploads (queue: imports). The queue itself is the contact_list_import table: see apps/contact_lists/jobs.py.

A pass has 4 hours (a 1.3 million row upload takes about one). A worker that hangs is replaced; its upload stops sending
heartbeats, is claimed again after 3 minutes and carries on from its last finished chunk."""
from celery import shared_task

from apps.platform_ops import jobs as job_monitor


@shared_task(name="workers.lists.process_imports", acks_late=True, time_limit=4 * 3600)
@job_monitor.monitored("process-list-imports")
def process_imports() -> dict:
    """Runs what is claimable, within the platform's limits. Sent by the API when something is queued, and by beat as a net."""
    from apps.contact_lists import jobs
    return jobs.run_pending()
