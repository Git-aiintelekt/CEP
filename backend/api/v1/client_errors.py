"""POST /api/v1/client-errors/: the React app reports an error a person hit in the browser (an uncaught error, a rejected
promise, a page that crashed into the error screen). Recorded in the back-office's Errors with source Browser.

No sign-in is required (a crash can happen before or during sign-in), so the endpoint is small and strict: a JSON body of
at most 16 KB, at most 30 reports a minute from one address, and only known fields are kept. The workspace comes from
the X-Tenant header, the person from the access token when one is sent; both are optional.
"""
import json
import re

from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from apps.platform_ops import observe

MAX_BODY = 16_000
PER_MINUTE = 30
_IDS = re.compile(r"/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)(?=/|$)", re.I)
_FRAME = re.compile(r"^\s*at\s+([\w$.<>]+)\s|^([\w$.<>]+)@", re.M)


def _client_ip(request) -> str:
    return (request.META.get("HTTP_CF_CONNECTING_IP") or request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
            or request.META.get("REMOTE_ADDR") or "unknown")


def _tenant(request):
    if not request.headers.get("X-Tenant"):
        return None
    try:
        from apps.tenants.resolver import resolve_tenant
        return resolve_tenant(request)
    except Exception:                                      # noqa: BLE001
        return None


def _user_id(request):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        from rest_framework_simplejwt.tokens import AccessToken
        return AccessToken(header[7:]).get("user_id")
    except Exception:                                      # noqa: BLE001  expired or foreign: the report still counts
        return None


def page_route(page: str) -> str:
    """/campaigns/8f0c…/edit -> /campaigns/:id/edit, so one crash on many campaigns is one error."""
    path = (page or "").split("?")[0].split("#")[0]
    return _IDS.sub("/:id", path)[:200] or "/"


@csrf_exempt
@require_POST
def client_error_view(request):
    if len(request.body) > MAX_BODY:
        return JsonResponse({"detail": "Too large."}, status=413)
    key = f"cep:client-errors:{_client_ip(request)}"
    cache.add(key, 0, 60)
    try:
        if cache.incr(key) > PER_MINUTE:
            return JsonResponse({"detail": "Too many reports."}, status=429)
    except ValueError:
        pass
    try:
        body = json.loads(request.body or b"{}")
    except ValueError:
        return JsonResponse({"detail": "Not JSON."}, status=400)
    if not isinstance(body, dict) or not str(body.get("message") or "").strip():
        return JsonResponse({"detail": "A message is required."}, status=400)
    kind = str(body.get("kind") or "Error")[:120]
    message = str(body["message"])[:2000]
    stack = str(body.get("stack") or "")[:12000]
    route = page_route(str(body.get("page") or ""))
    frame = _FRAME.search(stack)
    function = (frame.group(1) or frame.group(2)) if frame else ""
    tenant = _tenant(request)
    observe.record_error(
        source="BROWSER", kind=kind, message=message, place=f"{route}|{function}|{re.sub(r'[0-9]+', '#', message)[:160]}", culprit=f"Page {route}",
        stack=stack + (f"\n\nComponent stack:{body['component_stack']}" if body.get("component_stack") else ""),
        tenant_id=tenant["id"] if tenant else None, tenant_code=tenant["code"] if tenant else None, user_id=_user_id(request),
        path=str(body.get("page") or "")[:500], release=str(body.get("release") or "")[:60] or None,
        context={k: str(v)[:300] for k, v in {"page": body.get("page"), "how": body.get("how"), "browser": request.headers.get("User-Agent", "")[:300],
                                              "viewport": body.get("viewport")}.items() if v})
    return HttpResponse(status=204)
