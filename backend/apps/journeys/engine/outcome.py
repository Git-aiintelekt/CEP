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


@dataclass
class Finish:
    status: str = "COMPLETED"
    reason: str | None = None
