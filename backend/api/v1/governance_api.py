"""Governance (Settings → Engagement → Governance): the workspace's frequency caps, the platform's among them locked.

    GET    /workspace/governance/              caps, the last 30 days, the rules applied besides the caps
    POST   /workspace/governance/caps/         {channel: ALL|EMAIL|SMS|WHATSAPP, max_messages, period_days}
    PATCH  /workspace/governance/caps/<id>/    the same fields, and is_active
    DELETE /workspace/governance/caps/<id>/
    POST   /workspace/governance/standard/     the recommended caps for the channels not capped yet

Reading needs campaign.view or governance.edit; changing needs governance.edit. A platform cap is refused with 403.
"""
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.governance import workspace
from apps.tenants import context

READ = (HasPermissionCode.for_("campaign.view")(), HasPermissionCode.for_("governance.edit")())
WRITE = HasPermissionCode.for_("governance.edit")()


class GovernanceAccess(BasePermission):
    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return any(check.has_permission(request, view) for check in READ)
        return WRITE.has_permission(request, view)


ACCESS = [IsAuthenticated, GovernanceAccess]


def _tenant():
    return context.require().tenant_id


def _user(request):
    return getattr(request.user, "pk", None) if not hasattr(request.user, "has_scope") else None


class GovernanceView(APIView):
    permission_classes = ACCESS

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(workspace.overview(_tenant()))


class CapsView(APIView):
    permission_classes = ACCESS

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None):
        try:
            return Response(workspace.add_cap(_tenant(), request.data, _user(request)), status=201)
        except workspace.GovernanceError as exc:
            raise ValidationError({exc.field: str(exc)}) from None


class CapView(APIView):
    permission_classes = ACCESS

    def _run(self, call):
        try:
            return call()
        except workspace.GovernanceError as exc:
            raise ValidationError({exc.field: str(exc)}) from None
        except workspace.Locked as exc:
            raise PermissionDenied(str(exc)) from None
        except LookupError:
            raise NotFound("No such cap.") from None

    @extend_schema(request=None, responses={200: None})
    def patch(self, request, pk, version=None):
        return Response(self._run(lambda: workspace.change_cap(_tenant(), pk, request.data, _user(request))))

    @extend_schema(responses={204: None})
    def delete(self, request, pk, version=None):
        self._run(lambda: workspace.remove_cap(_tenant(), pk, _user(request)))
        return Response(status=204)


class StandardView(APIView):
    permission_classes = ACCESS

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        return Response(workspace.add_standard(_tenant(), _user(request)))
