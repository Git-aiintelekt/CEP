"""An engine's Messages per Minute counts messages. A batch of texts (one guarded call for up to 100) used to count as one
call, so 60 meant 60 batches, up to 6,000 texts. Now a batch costs one per text; a refused call gives its cost back; and a
batch larger than the whole limit goes alone into an empty minute instead of waiting for ever."""
from types import SimpleNamespace
from unittest import mock

from apps.delivery.providers.base import Outcome, SmsMessage
from apps.delivery.providers.digivize import DigivizeProvider
from apps.delivery.providers.sandbox_sms import SandboxSmsProvider
from apps.integrations.bridge import outbound, throttle

MINUTE = 1_800_000_000                                      # a minute boundary: the windows start here


def test_a_batch_costs_one_per_message(check):
    allowed = [throttle.take("zz:count", 300, cost=100, now=MINUTE + second).allowed for second in range(4)]
    check("300 a minute: three batches of 100 fit, the fourth waits for the next minute", allowed == [True, True, True, False], allowed)
    refused = throttle.take("zz:count", 300, cost=1, now=MINUTE + 10)
    check("... and the minute is full for a single text too", not refused.allowed and refused.retry_after == 50, refused)
    check("... the next minute has room again", throttle.take("zz:count", 300, cost=100, now=MINUTE + 60).allowed)
    check.done()


def test_a_refused_call_gives_its_cost_back(check):
    first = throttle.take("zz:back", 300, cost=100, now=MINUTE)
    same_second = throttle.take("zz:back", 300, cost=100, now=MINUTE)
    check("a second batch in the same second waits (the second's smoothing)", first.allowed and not same_second.allowed and same_second.retry_after == 1)
    later = [throttle.take("zz:back", 300, cost=100, now=MINUTE + second).allowed for second in (1, 2)]
    check("... and the refused batch did not use up the minute: two more fit", later == [True, True], later)
    check.done()


def test_a_batch_larger_than_the_limit_is_slowed_not_stuck(check):
    check("60 a minute: a batch of 100 goes alone into an empty minute", throttle.take("zz:big", 60, cost=100, now=MINUTE).allowed)
    check("... nothing else fits in that minute", not throttle.take("zz:big", 60, cost=1, now=MINUTE + 5).allowed)
    check("... the next batch goes in the next minute", throttle.take("zz:big", 60, cost=100, now=MINUTE + 60).allowed)
    check("a single call still counts one", throttle.take("zz:one", 2, now=MINUTE).allowed and throttle.take("zz:one", 2, now=MINUTE + 1).allowed
          and not throttle.take("zz:one", 2, now=MINUTE + 2).allowed)
    check.done()


class BatchingSandbox(SandboxSmsProvider):
    """An engine with a batch call of its own, as Digivize has: the whole batch is one guarded call."""
    def send_many(self, messages):
        return [self.send(message) for message in messages]


def test_an_engine_counts_every_text_of_a_batch(check):
    adapter = BatchingSandbox(config={}, secret=None, provider_id="zz-engine", tenant_id="")
    adapter.rate_limit_per_minute = 250
    texts = [SmsMessage(to_number=f"+1404555{n:04d}", from_sender="12345", text="Hello", idempotency_key=f"zz-{n}") for n in range(100)]
    costs = []
    real_wait = throttle.wait
    clock = SimpleNamespace(now=float(MINUTE))

    def advance(seconds):
        clock.now += seconds

    def counted(scope, per_minute, burst=None, sleep=None, cost=1):
        costs.append((per_minute, cost))
        return real_wait(scope, per_minute, burst, sleep=advance, cost=cost)

    with mock.patch.object(outbound.throttle, "wait", counted), mock.patch.object(throttle, "time", SimpleNamespace(time=lambda: clock.now, sleep=advance)):
        results = adapter.send_many_guarded(texts)
        adapter.send_many_guarded(texts)
        try:
            adapter.send_many_guarded(texts)
            third = "sent"
        except Exception as exc:                                    # noqa: BLE001 - the refusal is what the check reports
            third = type(exc).__name__
    check("a batch of 100 texts is one call costing 100", costs[:1] == [(250, 100)], costs)
    check("... every text in it was sent", len(results) == 100 and all(r.outcome is Outcome.ACCEPTED for r in results))
    check("250 a minute: the third batch of 100 is held for later, nothing fails", third == "RateLimited", third)
    check("Digivize with no Messages per Minute keeps today's pace: 6,000 texts a minute", DigivizeProvider.default_rate_limit_per_minute == 6000)
    check.done()
