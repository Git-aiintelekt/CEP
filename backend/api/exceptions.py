"""RFC 9457 problem+json responses for every API error, database errors included (docs/SAVE_FEEDBACK.md).

    problem_json_exception_handler   DRF's handler: DRF's own errors, then database errors in plain words, then anything else
                                     as a 500 with a reference (ER-<error group>) that the back-office Errors page finds
    server_error                     handler500: the same for an error raised outside a view (a middleware, the database down)

Database wording never reaches the client: the sentences below are CEP's. A field is named when the database says which.
"""
import logging
import re
import sys

from django.db import DatabaseError, InterfaceError, OperationalError
from django.http import JsonResponse
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler, set_rollback

log = logging.getLogger("cep.api")

FIELDS_TITLE = "Check the highlighted fields"


class Conflict(APIException):
    """409: the request is valid but the resource is not in a state that allows it (locked status, stale row_version)."""
    status_code = 409
    default_detail = "The resource is not in a state that allows this operation."
    default_code = "conflict"


# database rules whose broken value deserves its own sentence; every other rule says the value is not allowed
CHECK_SENTENCES = {
    "ck_journey_reentry_days": ("reentry_after_days", "Days before re-entry must be more than 0."),
    "ck_governance_policy_limits": (None, "A frequency cap must allow at least one message in at least one day."),
}


def _title(exc, status_code: int) -> str:
    if isinstance(exc, ValidationError):
        return FIELDS_TITLE
    default = getattr(exc, "default_detail", None)
    if isinstance(default, str) and default:
        return default.rstrip(".")
    return re.sub(r"(?<!^)(?=[A-Z])", " ", exc.__class__.__name__).replace(" Error", "").strip() or f"HTTP {status_code}"


def _problem(status: int, title: str, *, detail: str | None = None, errors=None, **extra) -> dict:
    body = {"type": "about:blank", "title": title, "status": status}
    if detail:
        body["detail"] = detail
    if errors:
        body["errors"] = errors
    body.update({key: value for key, value in extra.items() if value is not None})
    return body


def _diag(exc):
    """psycopg's diagnostics of the database error under a Django one: sqlstate, table, column, constraint, detail."""
    cause = exc.__cause__ or exc
    diag = getattr(cause, "diag", None)
    return getattr(cause, "sqlstate", None) or getattr(diag, "sqlstate", None), diag


def _label(field: str) -> str:
    return field.replace("_", " ")


def _unique_field(diag) -> str | None:
    """'Key (tenant_id, lower(name::text))=(…) already exists.' → name. Postgres leaves that detail out on tables with
    row-level security, so the index's own name is the fallback: ux_journey_code / journey_code_key → code."""
    match = re.match(r"Key \((.+?)\)=", getattr(diag, "message_detail", None) or "")
    if match:
        columns = [re.sub(r"^\w+\((\w+).*$", r"\1", part.strip()).split("::")[0] for part in match.group(1).split(",")]
        named = [column for column in columns if column not in ("tenant_id", "deleted_at") and column.isidentifier()]
        if named:
            return named[-1]
    constraint, table = getattr(diag, "constraint_name", None) or "", getattr(diag, "table_name", None) or ""
    for prefix in (f"ux_{table}_", f"uq_{table}_", f"{table}_"):
        if table and constraint.startswith(prefix):
            field = constraint.removeprefix(prefix).removesuffix("_key")
            return field if field.isidentifier() and field != "tenant_id" else None
    return None


def database_problem(exc) -> tuple[int, dict] | None:
    """The plain-words answer to a database error, or None when it is not one the client caused (then: 500)."""
    if isinstance(exc, (OperationalError, InterfaceError)):
        return 503, _problem(503, "The database is not answering", detail="CEP's database is not answering. Try again in a minute.")
    if not isinstance(exc, DatabaseError):
        return None
    state, diag = _diag(exc)
    constraint = getattr(diag, "constraint_name", None) or ""
    table = getattr(diag, "table_name", None) or ""
    if state == "23505":                                   # unique
        field = _unique_field(diag)
        sentence = f"Another record already uses this {_label(field)}." if field else "A record like this already exists."
        return 400, _problem(400, FIELDS_TITLE, errors={field: [sentence]} if field else {"non_field_errors": [sentence]})
    if state == "23514":                                   # check
        field, sentence = CHECK_SENTENCES.get(constraint, (None, None))
        if sentence is None:
            field = constraint.removeprefix(f"ck_{table}_") if table and constraint.startswith(f"ck_{table}_") else None
            sentence = "This value is not one CEP allows here." if field else "One of the values is not one CEP allows here."
        return 400, _problem(400, FIELDS_TITLE, errors={field: [sentence]} if field else {"non_field_errors": [sentence]})
    if state == "23502":                                   # not null
        field = getattr(diag, "column_name", None)
        return 400, _problem(400, FIELDS_TITLE, errors={field: ["This field is required."]} if field else {"non_field_errors": ["A required value is missing."]})
    if state == "23503":                                   # foreign key
        return 409, _problem(409, "Linked to other records", detail="This refers to something that no longer exists, or something else still uses it.")
    if state == "22001":                                   # value too long
        return 400, _problem(400, FIELDS_TITLE, errors={"non_field_errors": ["A value is longer than CEP allows."]})
    if state in ("22P02", "22007", "22008", "22003"):      # not a number / date, out of range
        return 400, _problem(400, FIELDS_TITLE, errors={"non_field_errors": ["A value is not in a form CEP can store."]})
    if state == "42501":                                   # row-level security, privileges
        return 403, _problem(403, "You do not have access", detail="You do not have access to this record.")
    if state in ("40001", "40P01"):                        # serialization failure, deadlock
        return 409, _problem(409, "Saved at the same moment", detail="Someone else was saving at the same moment. Try again.")
    return None


def _reference(exc, request) -> str:
    """Records the error (the back-office Errors page) and returns ER-<its group>."""
    log.error("Unhandled error on %s %s", getattr(request, "method", "?"), getattr(request, "path", "?"),
              exc_info=(type(exc), exc, exc.__traceback__), extra={"request": request})
    group = getattr(exc, "_cep_group_id", None)
    exc._cep_recorded = True
    return f"ER-{group}" if group else f"ER-{timezone.now():%H%M%S}"


def unexpected_problem(exc, request) -> dict:
    reference = _reference(exc, request)
    at = timezone.now()
    return _problem(500, "CEP had a problem",
                    detail=f"CEP had a problem at {at:%H:%M} UTC. Try again. If it happens again, give your administrator the reference {reference}.",
                    reference=reference, at=at.isoformat())


def problem_json_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        detail = response.data
        body = {"type": "about:blank", "title": _title(exc, response.status_code), "status": response.status_code}
        if isinstance(detail, dict) and set(detail) == {"detail"}:
            body["detail"] = str(detail["detail"])
        else:
            body["errors"] = detail
        response.data = body
        response["Content-Type"] = "application/problem+json"
        return response
    request = context.get("request")
    known = database_problem(exc)
    if known:
        status, body = known
        log.warning("database refused %s %s: %s", getattr(request, "method", "?"), getattr(request, "path", "?"), type(exc).__name__)
    else:
        status, body = 500, unexpected_problem(exc, request)
    set_rollback()
    return Response(body, status=status, content_type="application/problem+json")


def server_error(request, *args, **kwargs):
    """handler500: an error outside a view. API paths answer problem+json like every other API error."""
    if not request.path.startswith("/api/"):
        from django.views.defaults import server_error as django_server_error
        return django_server_error(request, *args, **kwargs)
    exc = sys.exc_info()[1]
    known = database_problem(exc) if exc is not None else None
    status, body = known if known else (500, unexpected_problem(exc, request) if exc is not None else _problem(500, "CEP had a problem"))
    return JsonResponse(body, status=status, content_type="application/problem+json")
