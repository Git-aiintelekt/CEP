"""Campaign send engine.

    runs.start(tenant, run)  ->  audience.build  ->  batches  ->  dispatch.send_batch (provider adapter)  ->  runs.finalize
    providers call back      ->  api/v1/delivery_public.py    ->  events.apply

Provider adapters live in apps/delivery/providers. `process_run` below is the whole pipeline in one call, for the
management command, tests and installations without Celery; workers/campaign.py and workers/email.py run the same steps
as separate tasks so batches go out in parallel.
"""
import logging
import time

from . import dispatch, dispatch_sms, runs, session

log = logging.getLogger("cep.delivery")


def process_run(tenant_id, run_id, *, max_rounds: int = 5, wait_seconds: float = 0.0) -> dict:
    """Start (if waiting), send every batch, retry temporary failures a few times, close the run.
    When the engine's rate limit has no room, this pass stops and everything not yet sent stays queued: the run stays
    open and the scheduler's next pass goes on from there, so a paced engine sends at its pace and nothing fails for it."""
    with session.tenant_scope(tenant_id):
        try:
            started = runs.start(tenant_id, run_id)
        except runs.RunNotStarted as waiting:
            started = {"batches": [], "audience": {}, "waiting": str(waiting)}
        with session.tx():
            kind = started.get("family") or runs.run_family(tenant_id, run_id)
            if started.get("waiting"):                     # not waiting to start: it may be a run that was paused and resumed, with messages still queued
                started["batches"] = runs.queued_batches(tenant_id, run_id)
        sender = dispatch_sms if kind == "SMS" else dispatch
        pending = started["batches"]
        held_for = None
        for round_number in range(max_rounds):
            again = []
            for batch in pending:
                try:
                    sender.send_batch(tenant_id, run_id, batch)
                except dispatch.RetryBatch as retry:
                    if retry.retry_after is not None:      # the engine's pace: the rest waits for the next pass
                        held_for = retry.retry_after
                        break
                    again.append(retry.execution_ids)
                except dispatch.ProviderError as exc:
                    sender.fail_queued(tenant_id, run_id, str(exc))
                    again = []
                    break
            pending = again
            if not pending or held_for is not None:
                break
            time.sleep(wait_seconds * (round_number + 1))
        if held_for is not None:
            log.info("run %s held by its engine's rate limit; the next pass goes on in about %ss", run_id, held_for)
        elif pending:                                      # still failing after every round: do not leave the run open forever
            sender.fail_queued(tenant_id, run_id, "The delivery provider kept failing temporarily")
        runs.sweep(tenant_id, run_id)
        status = runs.finalize(tenant_id, run_id)
        with session.tx():
            numbers = runs.stats(tenant_id, run_id)["messages"]
        return {"status": status, "family": kind, **({"waiting": started["waiting"]} if started.get("waiting") else {}),
                **({"held_for": held_for} if held_for is not None else {}), **started.get("audience", {}), **numbers}
