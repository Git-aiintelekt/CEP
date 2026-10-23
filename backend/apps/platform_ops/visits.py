"""Switch Workspace (docs/mockups/switch-workspace.html, option B): a platform administrator enters another workspace as
themselves, with full rights, giving a reason. Unlike a support session (support.py) nobody is impersonated: the visit's tokens
carry the administrator's own id and the claim `visit` (api.auth reads the user through the platform connection, since the
workspace's row-level security hides them, and refuses the token once the visit has ended or in another workspace).

Each visit is a platform_visit row (patch 0077): who, which workspace, why, from when to when. The workspace's administrators read
theirs under Settings -> Security -> Platform Visits; the back-office lists them all.

    GET  /platform/workspaces/?q=        the workspaces a platform administrator may switch to
    POST /platform/visits/               {workspace, reason} -> {access, refresh, tenant, workspace}
    POST /auth/visit/end/                Back to Platform: the visit ends
    GET  /workspace/platform-visits/     the workspace's visits (user.admin)
"""
from django.conf import settings
from django.core.cache import cache
from django.db import connections
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from api.permissions import HasPermissionCode, SameTenant

P = settings.PLATFORM_ALIAS
REASON_MIN = 5
LISTED = 200                                                        # workspaces in one answer; the search narrows a longer list


def _rows(sql: str, args=()) -> list[dict]:
    with connections[P].cursor() as cursor:
        cursor.execute(sql, args)
        names = [c[0] for c in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]


def present() -> bool:
    """patch 0077: visits can be recorded"""
    known = cache.get("cep:platform-visit-present")
    if known is None:
        known = bool(_rows("SELECT to_regclass('public.platform_visit') IS NOT NULL AS present")[0]["present"])
        cache.set("cep:platform-visit-present", known, 300)
    return known


def workspaces(user, q: str = "") -> list[dict]:
    """every workspace but the administrator's own, the ones they visited last first, then by code; with plan, users and status"""
    term = f"%{q.strip()}%" if q.strip() else None
    last = ("(SELECT max(v.started_at) FROM platform_visit v WHERE v.tenant_id = t.id AND v.staff_user_id = %s)" if present() else "NULL::timestamptz")
    args = [str(user.pk)] if present() else []
    rows = _rows(f"""SELECT t.id::text, t.code, t.name, t.status,
                            (SELECT p.name FROM tenant_subscription s JOIN subscription_plan p ON p.id = s.plan_id
                              WHERE s.tenant_id = t.id AND s.status <> 'CANCELLED' ORDER BY s.started_at DESC LIMIT 1) AS plan,
                            (SELECT count(*) FROM app_user u WHERE u.tenant_id = t.id AND u.is_active) AS users,
                            {last} AS last_visit
                       FROM tenant t
                      WHERE t.deleted_at IS NULL AND t.id <> %s {"AND (t.code ILIKE %s OR t.name ILIKE %s)" if term else ""}
                      ORDER BY last_visit DESC NULLS LAST, t.code LIMIT %s""",
                 [*args, str(user.tenant_id), *([term, term] if term else []), LISTED])
    return [{"id": r["id"], "code": r["code"], "name": r["name"], "status": r["status"], "plan": r["plan"], "users": int(r["users"]), "last_visit": r["last_visit"]} for r in rows]


def start(user, code: str, reason: str, ip: str | None) -> dict:
    """The visit recorded and its tokens: the administrator's own id with the claim `visit` (and the workspace's id)."""
    if not getattr(user, "is_platform_admin", False) or not user.is_active:
        raise PermissionDenied("Only platform administrators can switch workspace.")
    if not present():
        raise ValidationError({"workspace": "Switching workspace needs database patch 0077."})
    reason = " ".join(str(reason or "").split())
    if len(reason) < REASON_MIN:
        raise ValidationError({"reason": "Say in a few words why you are going in; the workspace's administrators read it."})
    found = _rows("SELECT id::text, code, name, status FROM tenant WHERE upper(code) = upper(%s) AND deleted_at IS NULL", [str(code or "").strip()])
    if not found:
        raise ValidationError({"workspace": "No such workspace."})
    target = found[0]
    if target["id"] == str(user.tenant_id):
        raise ValidationError({"workspace": "This is your own workspace."})
    visit = _rows("""INSERT INTO platform_visit (tenant_id, staff_user_id, staff_name, home_tenant_id, reason, ip_address)
                     VALUES (%s, %s, %s, %s, %s, %s) RETURNING id::text""",
                  [target["id"], str(user.pk), user.display_name or user.email, str(user.tenant_id), reason[:500], ip])[0]
    refresh = RefreshToken.for_user(user)
    refresh["visit"], refresh["visit_tenant"] = visit["id"], target["id"]          # copied into every access token made from it
    return {"access": str(refresh.access_token), "refresh": str(refresh), "tenant": target["code"], "workspace": target["name"], "visit": visit["id"]}


def open_visit(visit_id, user_id, tenant_id=None) -> dict | None:
    """the visit while it is open, for this administrator (and this workspace, when given)"""
    if not present():
        return None
    rows = _rows("""SELECT v.id::text, v.tenant_id::text, v.reason, v.started_at, h.code AS home_code, h.name AS home_name
                      FROM platform_visit v LEFT JOIN tenant h ON h.id = v.home_tenant_id
                     WHERE v.id = %s AND v.staff_user_id = %s AND v.ended_at IS NULL""", [str(visit_id), str(user_id)])
    if not rows or (tenant_id is not None and rows[0]["tenant_id"] != str(tenant_id)):
        return None
    return rows[0]


def touch(visit_id, write: bool) -> None:
    with connections[P].cursor() as cursor:
        cursor.execute("UPDATE platform_visit SET last_seen_at = now(), writes = writes + %s WHERE id = %s", [1 if write else 0, str(visit_id)])


def end(visit_id) -> None:
    with connections[P].cursor() as cursor:
        cursor.execute("UPDATE platform_visit SET ended_at = now() WHERE id = %s AND ended_at IS NULL", [str(visit_id)])


def for_tenant(tenant_id) -> list[dict]:
    if not present():
        return []
    rows = _rows("""SELECT id::text, staff_name, reason, started_at, COALESCE(ended_at, last_seen_at) AS until, ended_at IS NULL AS open, writes
                      FROM platform_visit WHERE tenant_id = %s ORDER BY started_at DESC LIMIT 100""", [str(tenant_id)])
    return [{"id": r["id"], "who": r["staff_name"] or "Platform administrator", "reason": r["reason"], "started_at": r["started_at"], "until": r["until"],
             "open": bool(r["open"]), "writes": int(r["writes"])} for r in rows]


def _client_ip(request) -> str | None:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return forwarded.split(",")[0].strip() or request.META.get("REMOTE_ADDR") or None


# ---------------------------------------------------------------------------------------------------- the API
class PlatformOnly(IsAuthenticated):
    message = "Only platform administrators can switch workspace."

    def has_permission(self, request, view):
        return super().has_permission(request, view) and bool(getattr(request.user, "is_platform_admin", False)) \
            and getattr(getattr(request, "_request", request), "platform_visit", None) is None


class WorkspacesView(APIView):
    permission_classes = [PlatformOnly]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response({"workspaces": workspaces(request.user, str(request.query_params.get("q") or "")), "ready": present()})


class VisitsView(APIView):
    permission_classes = [PlatformOnly]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None):
        body = request.data if isinstance(request.data, dict) else {}
        return Response(start(request.user, str(body.get("workspace") or ""), str(body.get("reason") or ""), _client_ip(request)), status=status.HTTP_201_CREATED)


class VisitEndView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, version=None):
        visit = getattr(getattr(request, "_request", request), "platform_visit", None)
        if visit is None:
            raise ValidationError({"detail": "This is not a visit."})
        end(visit["id"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceVisitsView(APIView):
    """Transparency: every time a platform administrator entered this workspace as themselves."""
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(for_tenant(request.tenant["id"]))
