"""Ask for a Report's progress (docs/mockups/ask-for-report-name-and-progress.html, option A): the steps of one prompt as they
happen, for the box to show while it waits. The box sends a progress id with the prompt; each step is written to the cache as it
starts and ends (cep:ai:progress:<workspace>:<person>:<id>, ten minutes) and GET /insights/assistant/progress/<id>/ reads them.
Only the steps that apply are planned; a second call to the model (more tables asked for, or a draft that did not fit) is added
as it happens. Without a progress id the steps are still kept for the reply.

    {"steps": [{"key", "label", "detail", "state": wait | now | done | failed, "started_at", "ended_at"}], "finished": bool}
"""
import time
import uuid

from django.core.cache import cache

TTL = 600


def key_of(tenant_id, user_id, progress_id) -> str:
    return f"cep:ai:progress:{tenant_id}:{user_id}:{progress_id}"


def read(tenant_id, user_id, progress_id) -> dict:
    return cache.get(key_of(tenant_id, user_id, progress_id)) or {"steps": [], "finished": False}


class Progress:
    def __init__(self, tenant_id, user_id, progress_id: str | None):
        try:
            self.key = key_of(tenant_id, user_id, uuid.UUID(str(progress_id))) if progress_id else None
        except ValueError:
            self.key = None
        self.steps: list[dict] = []
        self.finished = False

    def _save(self) -> None:
        if self.key:
            cache.set(self.key, {"steps": self.steps, "finished": self.finished}, TTL)

    def _step(self, key: str) -> dict | None:
        return next((s for s in self.steps if s["key"] == key), None)

    def plan(self, steps: list[tuple[str, str]]) -> None:
        self.steps = [{"key": key, "label": label, "detail": None, "state": "wait", "started_at": None, "ended_at": None} for key, label in steps]
        self._save()

    def add(self, key: str, label: str, before: str | None = None) -> None:
        """a step that turned out to be needed (a second call to the model), placed before `before`, or last"""
        step = {"key": key, "label": label, "detail": None, "state": "wait", "started_at": None, "ended_at": None}
        at = next((i for i, s in enumerate(self.steps) if s["key"] == before), len(self.steps))
        self.steps.insert(at, step)
        self._save()

    def drop(self, key: str) -> None:
        self.steps = [s for s in self.steps if s["key"] != key]
        self._save()

    def start(self, key: str, detail: str | None = None) -> None:
        step = self._step(key)
        if step:
            step.update(state="now", started_at=time.time(), **({"detail": detail} if detail else {}))
            self._save()

    def done(self, key: str, detail: str | None = None) -> None:
        step = self._step(key)
        if step:
            step.update(state="done", ended_at=time.time(), **({"detail": detail} if detail else {}))
            self._save()

    def fail(self, message: str) -> None:
        """the step under way (else the first not done) stops with the reason; the rest stay as they were"""
        step = next((s for s in self.steps if s["state"] == "now"), None) or next((s for s in self.steps if s["state"] == "wait"), None)
        if step:
            step.update(state="failed", ended_at=time.time(), detail=message[:300])
        self.finish()

    def finish(self) -> None:
        self.finished = True
        self._save()

    def as_list(self) -> list[dict]:
        return [dict(s) for s in self.steps]
