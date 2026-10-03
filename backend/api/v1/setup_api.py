"""Settings -> Set-Up, and the Home card: the seven set-up steps read from the workspace, for its administrators."""
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.tenants import context, setup
from apps.tenants.models import Tenant


class WorkspaceSetupView(APIView):
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(setup.overview(_tenant(), request.user))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None):
        tenant = _tenant()
        data = request.data if isinstance(request.data, dict) else {}
        setup.dismiss(tenant, bool(data.get("dismissed")))
        return Response(setup.overview(tenant, request.user))


def _tenant():
    return Tenant.objects.get(pk=context.require().tenant_id)
