"""Rate limits that hold across every process.

A limit is a number of calls per minute. It is enforced with two fixed windows in the shared cache — the current
minute, and the current second for burst smoothing — using atomic increments, so any number of API workers and Celery
workers count against the same figure. In development without Redis the cache is per process, which is enough to see
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


def _count(key: str, ttl: int) -> int:
    """Atomic increment of a window counter that expires with the window. cache.add creates it with the ttl."""
    if cache.add(key, 1, ttl):
        return 1
    try:
        return cache.incr(key)
    except ValueError:                                     # expired between add and incr
        cache.add(key, 1, ttl)
        return 1


DEFAULT_BURST = 10                                            # a second may carry this many calls when the minute allows, whatever the even pace


def burst_for(per_minute: int, burst: int | None) -> int:
    """How many calls one second may carry: the even pace or the default burst (within the minute's limit), plus the policy's own burst."""
    even = math.ceil(per_minute / 60)
    return max(1, min(per_minute, max(even, DEFAULT_BURST)) + max(0, burst or 0))


def take(scope: str, per_minute: int | None, burst: int | None = None, now: float | None = None) -> Decision:
    """Counts one call against `scope`. No limit means always allowed."""
    now = now if now is not None else time.time()
    minute = int(now // 60)
    if not per_minute:
        return Decision(True, None, 0, 60 - int(now % 60))
    used = _count(f"{PREFIX}:{scope}:m:{minute}", 120)
    reset_in = 60 - int(now % 60)
    if used > per_minute:
        return Decision(False, per_minute, 0, reset_in, retry_after=max(1, reset_in))
    per_second = burst_for(per_minute, burst)
    second_used = _count(f"{PREFIX}:{scope}:s:{int(now)}", 5)
    if second_used > per_second:
        return Decision(False, per_minute, max(0, per_minute - used), reset_in, retry_after=1)
    return Decision(True, per_minute, max(0, per_minute - used), reset_in)


def wait(scope: str, per_minute: int | None, burst: int | None = None, sleep=time.sleep) -> float:
    """Blocks until the call fits, up to MAX_WAIT_SECONDS. Returns the seconds waited. A worker that would have to wait
    longer than the cap gives up its turn (the caller retries the batch later) rather than hold a connection open."""
    waited = 0.0
    while True:
        decision = take(scope, per_minute, burst)
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
