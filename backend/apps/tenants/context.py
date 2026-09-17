"""Per-request / per-task tenant context (contextvars, so it is safe under threads and asyncio)."""
import contextvars
from dataclasses import dataclass


@dataclass(frozen=True)
class TenantContext:
    tenant_id: str
    db_alias: str
    user_id: str | None = None


_current: contextvars.ContextVar[TenantContext | None] = contextvars.ContextVar("cep_tenant", default=None)


def set_current(tenant_id: str, db_alias: str, user_id: str | None = None):
    return _current.set(TenantContext(str(tenant_id), db_alias, str(user_id) if user_id else None))


def reset(token) -> None:
    _current.reset(token)


def current() -> TenantContext | None:
    return _current.get()


# ---- platform mode: Django Admin / internal tooling, cross-tenant on the BYPASSRLS connection -------------------
_platform: contextvars.ContextVar[bool] = contextvars.ContextVar("cep_platform", default=False)


def set_platform(on: bool = True):
    return _platform.set(on)


def reset_platform(token) -> None:
    _platform.reset(token)


def is_platform() -> bool:
    return _platform.get()


def require() -> TenantContext:
    ctx = _current.get()
    if ctx is None:
        raise RuntimeError("No tenant in context — request must pass TenantMiddleware or task must use @tenant_task")
    return ctx
