"""Campaign send engine.

    runs.start(tenant, run)  ->  audience.build  ->  batches  ->  dispatch.send_batch (provider adapter)  ->  runs.finalize
    providers call back      ->  api/v1/delivery_public.py    ->  events.apply

Provider adapters live in apps/delivery/providers. `process_run` below is the whole pipeline in one call, for the
management command, tests and installations without Celery; workers/campaign.py and workers/email.py run the same steps
as separate tasks so batches go out in parallel.
"""
import logging
import time

from . import dispatch, runs, session

log = logging.getLogger("cep.delivery")


def process_run(tenant_id, run_id, *, max_rounds: int = 5, wait_seconds: float = 0.0) -> dict:
    """Start (if waiting), send every batch, retry temporary failures a few times, close the run."""
    with session.tenant_scope(tenant_id):
        try:
            started = runs.start(tenant_id, run_id)
        except runs.RunNotStarted:
            started = {"batches": [], "audience": {}}
        pending = started["batches"]
        for round_number in range(max_rounds):
            again = []
            for batch in pending:
                try:
                    dispatch.send_batch(tenant_id, run_id, batch)
                except dispatch.RetryBatch as retry:
                    again.append(retry.execution_ids)
                except dispatch.ProviderError as exc:
                    dispatch.fail_queued(tenant_id, run_id, str(exc))
                    again = []
                    break
            pending = again
            if not pending:
                break
            time.sleep(wait_seconds * (round_number + 1))
        if pending:                                        # still failing after every round: do not leave the run open forever
            dispatch.fail_queued(tenant_id, run_id, "The delivery provider kept failing temporarily")
        runs.sweep(tenant_id, run_id)
        status = runs.finalize(tenant_id, run_id)
        with session.tx():
            numbers = runs.stats(tenant_id, run_id)["messages"]
        return {"status": status, **started.get("audience", {}), **numbers}
