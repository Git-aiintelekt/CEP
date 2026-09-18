"""Text sending (queue: sms). One task = one batch of SMS / MMS executions through the run's aggregator adapter."""
import logging

from celery import shared_task

from apps.delivery.engine import dispatch_sms, session
from apps.delivery.engine.dispatch import RetryBatch
from apps.delivery.providers import ProviderError

log = logging.getLogger("cep.delivery")
BACKOFF = (60, 300, 900, 1800, 3600)


@shared_task(name="workers.sms.send_batch", bind=True, max_retries=len(BACKOFF), acks_late=True)
def send_batch(self, tenant_id: str, run_id: str, execution_ids: list[int]) -> dict:
    from workers.campaign import finalize_run
    with session.tenant_scope(tenant_id):
        try:
            counts = dispatch_sms.send_batch(tenant_id, run_id, execution_ids)
        except RetryBatch as retry:
            if self.request.retries >= len(BACKOFF):
                failed = dispatch_sms.fail_queued(tenant_id, run_id, f"Gave up after {self.request.retries} retries: {retry.reason}", retry.execution_ids)
                finalize_run.delay(tenant_id, run_id)
                return {"failed": failed, "reason": retry.reason}
            raise self.retry(args=[tenant_id, run_id, retry.execution_ids], countdown=BACKOFF[self.request.retries], exc=retry) from None
        except ProviderError as exc:
            log.error("text run %s stopped: %s", run_id, exc)
            failed = dispatch_sms.fail_queued(tenant_id, run_id, str(exc))
            finalize_run.delay(tenant_id, run_id)
            return {"failed": failed, "reason": str(exc)}
    finalize_run.delay(tenant_id, run_id)
    return counts
