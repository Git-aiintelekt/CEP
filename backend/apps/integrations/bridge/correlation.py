"""One correlation id per request or per worker batch, carried in a context variable so every log row written on the way —
the POS call, the provider call it caused, the retry — shares it. A caller may send its own in X-Correlation-Id; the
answer always carries the id that was used."""
import contextvars
import re
import uuid

HEADER = "X-Correlation-Id"
META_KEY = "HTTP_X_CORRELATION_ID"
_ALLOWED = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")

_current: contextvars.ContextVar[str | None] = contextvars.ContextVar("cep_correlation", default=None)


def new_id() -> str:
    return uuid.uuid4().hex


def accept(candidate: str | None) -> str:
    """The caller's id when it is a sane token, otherwise a fresh one. Never trusts the header's shape blindly: it is stored
    and shown back to people."""
    candidate = (candidate or "").strip()
    return candidate if _ALLOWED.match(candidate) else new_id()


def current() -> str:
    """The id of the work in progress, made on first use when nothing set one (a worker batch, a management command)."""
    found = _current.get()
    if found is None:
        found = new_id()
        _current.set(found)
    return found


def set_current(value: str):
    return _current.set(value)


def reset(token) -> None:
    _current.reset(token)


class CorrelationIdMiddleware:
    """Sets the id for the request from X-Correlation-Id (or makes one) and puts it on the response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = set_current(accept(request.META.get(META_KEY)))
        try:
            response = self.get_response(request)
            response[HEADER] = current()
            return response
        finally:
            reset(token)
