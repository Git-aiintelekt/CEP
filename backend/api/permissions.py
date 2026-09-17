from rest_framework.permissions import BasePermission


class HasPermissionCode(BasePermission):
    """Checks a CEP permission code (identity.permission) on the user, or a scope on an API client.
    Use as: permission_classes = [IsAuthenticated, HasPermissionCode.for_("campaign.edit")]"""
    code = None

    @classmethod
    def for_(cls, code: str):
        return type(f"Has_{code.replace('.', '_')}", (cls,), {"code": code})

    def has_permission(self, request, view):
        user = request.user
        if getattr(user, "is_platform_admin", False):
            return True
        if hasattr(user, "has_scope"):
            return user.has_scope(self.code.replace(".", ":"))
        if request.method in ("GET", "HEAD", "OPTIONS"):
            view_code = self.code.rsplit(".", 1)[0] + ".view"
            return view_code in user.permission_codes() or self.code in user.permission_codes()
        return self.code in user.permission_codes()


class SameTenant(BasePermission):
    """Objects are already tenant-scoped by RLS and the queryset; this is the explicit second check."""
    def has_object_permission(self, request, view, obj):
        tenant_id = getattr(request, "tenant", {}).get("id")
        return str(getattr(obj, "tenant_id", tenant_id)) == str(tenant_id)
