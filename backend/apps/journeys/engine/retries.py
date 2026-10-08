"""Retries (phase 6 of the journey gaps): a step that fails for a temporary reason is tried again after 5, 15 and 60 minutes;
what is still failing after the last try is given up and listed on the journey page's Needs Attention card, with Retry Now
and Skip Step. A permanent failure (a missing template, a refused address) is recorded and the customer carries on, as before.

The retry state lives in journey_customer_state.state_data["retry"]:

    {"step": node_key, "attempts": n, "reason": "...", "next_try_at": iso | null, "gave_up_at": iso | null, "temporary": true}

What is temporary is decided where the failure is known (Done(..., retry=True) in messages.py and the other handlers); an
exception a handler raises counts as temporary too. One scheduler at a time per workspace: advance_tenant and enroll_tenant
take a session-level advisory lock (`lock`), so a second scheduler process skips the workspace instead of running it twice.
"""
from datetime import timedelta

from django.utils import timezone

DELAYS = (timedelta(minutes=5), timedelta(minutes=15), timedelta(minutes=60))
MAX_ATTEMPTS = len(DELAYS)
GAVE_UP_REASON = "Gave up after {n} tries"


def note_failure(state, node_key: str, reason: str) -> dict:
    """Records one more failed try of `node_key` in the state and schedules the next, or gives up. Returns the retry entry."""
    retry = state.state_data.get("retry") or {}
    attempts = (retry.get("attempts") or 0) + 1 if retry.get("step") == node_key else 1
    now = timezone.now()
    entry = {"step": node_key, "attempts": attempts, "reason": reason, "temporary": True, "first_failed_at": retry.get("first_failed_at") or now.isoformat()}
    if attempts <= MAX_ATTEMPTS:
        until = now + DELAYS[attempts - 1]
        entry.update(next_try_at=until.isoformat(), gave_up_at=None)
        state.next_scheduled_at = until
    else:
        entry.update(next_try_at=None, gave_up_at=now.isoformat())
        state.next_scheduled_at = None
    state.state_data["retry"] = entry
    return entry


def clear(state) -> None:
    state.state_data.pop("retry", None)


def gave_up(state) -> bool:
    return bool((state.state_data.get("retry") or {}).get("gave_up_at"))


def retry_now(state) -> None:
    """Retry Now: the step runs again on the next pass; the tries so far stay on record."""
    retry = state.state_data.get("retry") or {}
    retry.update(gave_up_at=None, next_try_at=timezone.now().isoformat(), manual=True)
    state.state_data["retry"] = retry
    state.next_scheduled_at = timezone.now()


LOCK_SQL = "SELECT pg_try_advisory_lock(hashtext(%s))"
UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext(%s))"


class lock:
    """A session-level advisory lock on the caller's connection: `with lock(connection, key) as held:` — held is False when
    another session holds it, and the caller skips the work."""

    def __init__(self, connection, key: str):
        self.connection, self.key, self.held = connection, key, False

    def __enter__(self) -> bool:
        with self.connection.cursor() as cursor:
            cursor.execute(LOCK_SQL, [self.key])
            self.held = bool(cursor.fetchone()[0])
        return self.held

    def __exit__(self, *_exc) -> None:
        if self.held:
            with self.connection.cursor() as cursor:
                cursor.execute(UNLOCK_SQL, [self.key])
