"""RFC 9457 problem+json responses for every API error."""
import re

from rest_framework.views import exception_handler


from rest_framework.exceptions import APIException


class Conflict(APIException):
    """409: the request is valid but the resource is not in a state that allows it (locked status, stale row_version)."""
    status_code = 409
    default_detail = "The resource is not in a state that allows this operation."
    default_code = "conflict"


def _title(exc, status_code: int) -> str:
    default = getattr(exc, "default_detail", None)
    if isinstance(default, str) and default:
        return default.rstrip(".")
    return re.sub(r"(?<!^)(?=[A-Z])", " ", exc.__class__.__name__).replace(" Error", "").strip() or f"HTTP {status_code}"


def problem_json_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None
    detail = response.data
    body = {"type": "about:blank", "title": _title(exc, response.status_code), "status": response.status_code}
    if isinstance(detail, dict) and set(detail) == {"detail"}:
        body["detail"] = str(detail["detail"])
    else:
        body["errors"] = detail
    response.data = body
    response["Content-Type"] = "application/problem+json"
    return response
