"""Settings -> Consent Policy: what an upload does with people who have no consent, whether texts need a date, approval before
the first send, the consent lifetime and the attestation sentence. Read by anyone who uploads lists (the wizard shows the
consequence), changed by workspace administrators."""
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.contact_lists import consent
from apps.tenants import context
from apps.tenants.models import Tenant

ADMIN = HasPermissionCode.for_("user.admin")
READ = (HasPermissionCode.for_("list.view")(), HasPermissionCode.for_("list.import")(), HasPermissionCode.for_("user.admin")())


class ConsentPolicyView(APIView):
    def get_permissions(self):
        base = [IsAuthenticated(), SameTenant()]
        return base + [ADMIN()] if self.request.method == "PUT" else base + [_AnyOf()]

    def _payload(self, tenant):
        return {**consent.policy_of(tenant), "attestation_preview": consent.attestation_text(tenant), "workspace_name": tenant.name,
                "lifetimes": list(consent.LIFETIMES), "bases": [{"key": key, "label": label} for key, label in consent.BASES]}

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(self._payload(_tenant()))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None):
        tenant = _tenant()
        try:
            consent.save_policy(tenant, request.data if isinstance(request.data, dict) else {})
        except consent.ConsentError as exc:
            raise ValidationError({exc.field: str(exc)}) from None
        return Response(self._payload(tenant))


class _AnyOf:
    """Any of the read permissions: a list reader, an uploader or an administrator."""
    def has_permission(self, request, view):
        return any(check.has_permission(request, view) for check in READ)

    def has_object_permission(self, request, view, obj):
        return True


def _tenant():
    return Tenant.objects.get(pk=context.require().tenant_id)
