"""Email sending (queue: email). One task = one batch of executions through the run's delivery provider."""
import logging

from celery import shared_task

from apps.delivery.engine import dispatch, session
from apps.delivery.providers import ProviderError

log = logging.getLogger("cep.delivery")
BACKOFF = (60, 300, 900, 1800, 3600)                        # seconds before retry 1..5 of a batch that hit a temporary provider problem


@shared_task(name="workers.email.send_batch", bind=True, max_retries=len(BACKOFF), acks_late=True)
def send_batch(self, tenant_id: str, run_id: str, execution_ids: list[int]) -> dict:
    from workers.campaign import finalize_run
    with session.tenant_scope(tenant_id):
        try:
            counts = dispatch.send_batch(tenant_id, run_id, execution_ids)
        except dispatch.RetryBatch as retry:
            if self.request.retries >= len(BACKOFF):
                failed = dispatch.fail_queued(tenant_id, run_id, f"Gave up after {self.request.retries} retries: {retry.reason}", retry.execution_ids)
                finalize_run.delay(tenant_id, run_id)
                return {"failed": failed, "reason": retry.reason}
            raise self.retry(args=[tenant_id, run_id, retry.execution_ids], countdown=BACKOFF[self.request.retries], exc=retry) from None
        except ProviderError as exc:                        # not retryable: bad credentials, provider switched off
            log.error("run %s stopped: %s", run_id, exc)
            failed = dispatch.fail_queued(tenant_id, run_id, str(exc))
            finalize_run.delay(tenant_id, run_id)
            return {"failed": failed, "reason": str(exc)}
    finalize_run.delay(tenant_id, run_id)                   # cheap: does nothing while other batches are still queued
    return counts
