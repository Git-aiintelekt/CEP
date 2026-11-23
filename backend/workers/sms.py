"""Text sending (queue: sms). One task = one batch of SMS / MMS executions through the run's aggregator adapter.

A batch has 12 minutes (14 before its process is replaced): less than runs.STALE_CLAIM, so a batch still at work is never
swept as interrupted. Messages it had claimed when the limit came are marked interrupted by the sweep and never resent on
their own; the rest of the run carries on with the next batch (runs.hand_out)."""
import logging

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded

from apps.delivery.engine import dispatch_sms, runs, session
from apps.delivery.engine.dispatch import RetryBatch
from apps.delivery.providers import ProviderError

log = logging.getLogger("cep.delivery")
BACKOFF = (60, 300, 900, 1800, 3600)


@shared_task(name="workers.sms.send_batch", bind=True, max_retries=len(BACKOFF), acks_late=True, soft_time_limit=720, time_limit=840)
def send_batch(self, tenant_id: str, run_id: str, execution_ids: list[int]) -> dict:
    from workers.campaign import finalize_run
    with session.tenant_scope(tenant_id):
        try:
            counts = dispatch_sms.send_batch(tenant_id, run_id, execution_ids)
        except RetryBatch as retry:
            if retry.retry_after is not None:               # the engine's rate limit: wait for room, using up no retry
                runs.hold(tenant_id, "SMS", retry.execution_ids, retry.retry_after)
                send_batch.apply_async(args=[tenant_id, run_id, retry.execution_ids], countdown=retry.retry_after)
                return {"held": len(retry.execution_ids), "retry_after": retry.retry_after}
            if self.request.retries >= len(BACKOFF):
                failed = dispatch_sms.fail_queued(tenant_id, run_id, f"Gave up after {self.request.retries} retries: {retry.reason}", retry.execution_ids)
                finalize_run.delay(tenant_id, run_id)
                return {"failed": failed, "reason": retry.reason}
            runs.hold(tenant_id, "SMS", retry.execution_ids, BACKOFF[self.request.retries])
            raise self.retry(args=[tenant_id, run_id, retry.execution_ids], countdown=BACKOFF[self.request.retries], exc=retry) from None
        except ProviderError as exc:
            log.error("text run %s stopped: %s", run_id, exc)
            failed = dispatch_sms.fail_queued(tenant_id, run_id, str(exc))
            finalize_run.delay(tenant_id, run_id)
            return {"failed": failed, "reason": str(exc)}
        except SoftTimeLimitExceeded:
            log.error("a text batch of run %s stopped at its time limit; the messages it had claimed show as interrupted", run_id)
            finalize_run.delay(tenant_id, run_id)
            raise
        if str(counts.get("reason", "")).startswith("run is "):    # paused or stopped: they wait for the run, free to be given out again
            runs.give_back(tenant_id, "SMS", execution_ids)
            return counts
    finalize_run.delay(tenant_id, run_id)
    return counts
