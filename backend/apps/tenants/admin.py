from django.conf import settings
from django.contrib import admin, messages
from unfold.decorators import action, display

from apps.adminutils import BaseAdmin, register_app_models
from apps.identity.models import AppUser

from . import services
from .models import Tenant


@admin.register(Tenant)
class TenantAdmin(BaseAdmin):
    """Register, onboard, suspend. Saving a NEW tenant also creates its partitions, its routing row and its starting
    roles, so the next step is simply adding its first administrator under Users."""
    list_display = ("code", "name", "show_status", "isolation_mode", "region", "partition_seq", "show_users", "onboarded_at")
    list_filter = ("status", "isolation_mode", "region")
    search_fields = ("code", "name", "subdomain", "custom_app_domain")
    ordering = ("code",)
    readonly_fields = ("id", "partition_seq", "created_at", "updated_at", "row_version")
    actions = ("suspend", "reactivate", "provision")
    fieldsets = (
        ("Workspace", {"fields": ("name", "code", "status", "timezone")}),
        ("Access", {"fields": ("subdomain", "custom_app_domain"), "description": "Users reach the app at <subdomain>.your-domain; the API also accepts the code in the X-Tenant header."}),
        ("Hosting", {"fields": ("isolation_mode", "region", "data_residency", "onboarded_at"),
                     "description": "SHARED tenants live in the pool database in their own partitions. Moving to DEDICATED is a migration, not a field change."}),
        ("Settings", {"fields": ("settings",), "classes": ("collapse",)}),
        ("System", {"fields": ("id", "partition_seq", "created_at", "updated_at", "row_version"), "classes": ("collapse",)}),
    )

    def get_readonly_fields(self, request, obj=None):
        fixed = ("code", "isolation_mode") if obj else ()          # the code names partitions and URLs; isolation is changed by migration
        return (*self.readonly_fields, *fixed)

    @display(description="Status", label={"ACTIVE": "success", "SUSPENDED": "danger"})
    def show_status(self, obj):
        return obj.status

    @display(description="Active users")
    def show_users(self, obj):
        return AppUser.objects.using(settings.PLATFORM_ALIAS).filter(tenant=obj, is_active=True, deleted_at__isnull=True).count()

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if not change:
            result = services.onboard_tenant(obj, using=settings.PLATFORM_ALIAS, user_id=request.user.pk)
            messages.success(request, f"{obj.code} onboarded: {result['partition_sets']} partition sets, roles {', '.join(result['roles']) or 'already present'}. "
                                      "Next: add its first administrator under Users and give them the Workspace Admin role.")

    def has_delete_permission(self, request, obj=None):
        return False                                       # tenants are suspended; removing one is an offboarding procedure (export, detach, drop)

    @action(description="Suspend: block sign-in and API access")
    def suspend(self, request, queryset):
        for tenant in queryset.filter(status="ACTIVE"):
            self.set_fields(request, tenant, status="SUSPENDED")
        messages.warning(request, "Suspended. Tenant resolution is cached for up to 60 seconds.")

    @action(description="Reactivate")
    def reactivate(self, request, queryset):
        for tenant in queryset.filter(status="SUSPENDED"):
            self.set_fields(request, tenant, status="ACTIVE")
        messages.success(request, "Reactivated.")

    @action(description="Repair onboarding (partitions, routing row, default roles)")
    def provision(self, request, queryset):
        for tenant in queryset:
            result = services.onboard_tenant(tenant, using=settings.PLATFORM_ALIAS, user_id=request.user.pk)
            months = services.ensure_partitions(tenant, using=settings.PLATFORM_ALIAS)
            messages.success(request, f"{tenant.code}: {result['partition_sets']} new partition sets, {months} monthly partitions added, roles added: {', '.join(result['roles']) or 'none'}.")


register_app_models(__package__)
