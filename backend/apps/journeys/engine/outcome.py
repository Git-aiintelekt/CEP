"""What a step returns to advance.py (see steps.py)."""
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Hold:
    until: datetime


@dataclass
class Done:
    status: str = "SUCCESS"
    result: dict = field(default_factory=dict)
    branch: str | None = None
    run_id: str | None = None
    # a FAILED step that may succeed later (no sender, a provider error, a run that failed): retried by advance.py (retries.py)
    retry: bool = False


@dataclass
class Finish:
    status: str = "COMPLETED"
    reason: str | None = None
