from django.contrib import admin
from unfold.decorators import display

from apps.adminutils import BaseAdmin, register_app_models

from .models import DeliveryProvider


@admin.register(DeliveryProvider)
class DeliveryProviderAdmin(BaseAdmin):
    """Tenants manage their providers under Settings -> Delivery. Here: see them across tenants, switch one off in an
    emergency. The credential (secret_enc) is never shown or edited in the back-office."""
    list_display = ("tenant", "name", "provider_type", "channel", "is_default", "is_active", "show_check", "show_credential")
    list_filter = ("provider_type", "is_active", "tenant")
    search_fields = ("name",)
    ordering = ("tenant__code", "name")
    exclude = ("secret_enc",)
    readonly_fields = ("tenant", "provider_type", "channel", "name", "config", "secret_ref", "is_default", "last_checked_at", "last_check_ok", "last_check_error",
                       "created_by", "updated_by", "created_at", "updated_at", "deleted_at", "row_version")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @display(description="Last Check", label={"OK": "success", "Failed": "danger", "Not Checked": "info"})
    def show_check(self, obj):
        return "Not Checked" if obj.last_check_ok is None else "OK" if obj.last_check_ok else "Failed"

    @display(description="Credential")
    def show_credential(self, obj):
        return "entered in the product" if obj.secret_enc else (obj.secret_ref or "none")


register_app_models(__package__)
