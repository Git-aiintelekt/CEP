"""Rate limits that hold across every process.

A limit is a number of calls per minute; a call may cost more than one (a batch of texts costs one per text, so an
engine's Messages per Minute counts messages whether they go one request each or many to a request). It is enforced
with two fixed windows in the shared cache — the current minute, and the current second for burst smoothing — using
atomic increments, so any number of API workers and Celery workers count against the same figure. A refused call gives
its cost back, so a worker waiting for room never uses the room up itself. A call costing more than a whole window may
go alone into an otherwise empty one, so a batch larger than the limit is slowed, never stuck. In development without Redis the cache is per process, which is enough to see
the behaviour; production runs Redis.

    take(...)   -> Decision: for an inbound call, answered at once (429 with Retry-After when refused)
    wait(...)   -> for an outbound call: sleeps until the window has room, capped, so a worker paces itself
"""
import math
import time
from dataclasses import dataclass

from django.core.cache import cache

PREFIX = "cep:throttle"
MAX_WAIT_SECONDS = 5.0


@dataclass(frozen=True)
class Decision:
    allowed: bool
    limit: int | None
    remaining: int
    reset_in: int                                          # seconds until the minute window resets
    retry_after: int = 0


def _count(key: str, ttl: int, amount: int = 1) -> int:
    """Atomic increment of a window counter that expires with the window. cache.add creates it with the ttl."""
    if cache.add(key, amount, ttl):
        return amount
    try:
        return cache.incr(key, amount)
    except ValueError:                                     # expired between add and incr
        cache.add(key, amount, ttl)
        return amount


def _give_back(key: str, amount: int) -> None:
    try:
        cache.decr(key, amount)
    except ValueError:                                     # the window ended meanwhile: nothing to give back
        pass


DEFAULT_BURST = 10                                            # a second may carry this many calls when the minute allows, whatever the even pace


def burst_for(per_minute: int, burst: int | None) -> int:
    """How many calls one second may carry: the even pace or the default burst (within the minute's limit), plus the policy's own burst."""
    even = math.ceil(per_minute / 60)
    return max(1, min(per_minute, max(even, DEFAULT_BURST)) + max(0, burst or 0))


def take(scope: str, per_minute: int | None, burst: int | None = None, now: float | None = None, cost: int = 1) -> Decision:
    """Counts a call of `cost` (1, or the messages in a batch) against `scope`. No limit means always allowed."""
    now = now if now is not None else time.time()
    minute = int(now // 60)
    cost = max(1, int(cost))
    if not per_minute:
        return Decision(True, None, 0, 60 - int(now % 60))
    minute_key, second_key = f"{PREFIX}:{scope}:m:{minute}", f"{PREFIX}:{scope}:s:{int(now)}"
    used = _count(minute_key, 120, cost)
    reset_in = 60 - int(now % 60)
    if used > per_minute and used > cost:
        _give_back(minute_key, cost)
        return Decision(False, per_minute, max(0, per_minute - used + cost), reset_in, retry_after=max(1, reset_in))
    per_second = burst_for(per_minute, burst)
    second_used = _count(second_key, 5, cost)
    if second_used > per_second and second_used > cost:
        _give_back(second_key, cost)
        _give_back(minute_key, cost)
        return Decision(False, per_minute, max(0, per_minute - used + cost), reset_in, retry_after=1)
    return Decision(True, per_minute, max(0, per_minute - used), reset_in)


def wait(scope: str, per_minute: int | None, burst: int | None = None, sleep=time.sleep, cost: int = 1) -> float:
    """Blocks until the call fits, up to MAX_WAIT_SECONDS. Returns the seconds waited. A worker that would have to wait
    longer than the cap gives up its turn (the caller retries the batch later) rather than hold a connection open."""
    waited = 0.0
    while True:
        decision = take(scope, per_minute, burst, cost=cost)
        if decision.allowed:
            return waited
        pause = min(float(decision.retry_after), MAX_WAIT_SECONDS - waited)
        if pause <= 0:
            raise Throttled(decision)
        sleep(pause)
        waited += pause


class Throttled(Exception):
    def __init__(self, decision: Decision):
        super().__init__(f"rate limit of {decision.limit} per minute reached; retry in {decision.retry_after}s")
        self.decision = decision
