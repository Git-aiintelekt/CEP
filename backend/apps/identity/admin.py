from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.utils import timezone
from unfold.decorators import action, display
from unfold.widgets import UnfoldAdminCheckboxSelectMultipleWidget

from apps.adminutils import BaseAdmin, register_app_models

from .models import ApiClient, AppUser, Permission, Role, RolePermission, UserRole

P = settings.PLATFORM_ALIAS


# ------------------------------------------------------------------------------------------------------------ users
class AppUserForm(forms.ModelForm):
    """user_role has a composite key, which Django Admin cannot edit inline: roles are a plain multi-select here."""
    roles = forms.ModelMultipleChoiceField(queryset=Role.objects.none(), required=False, widget=UnfoldAdminCheckboxSelectMultipleWidget,
                                           help_text="Only roles of the user's own tenant can be given. Save a new user once to see its tenant's roles.")

    class Meta:
        model = AppUser
        fields = ("tenant", "email", "display_name", "auth_provider", "external_subject_id", "is_active", "mfa_enabled", "is_staff", "is_platform_admin")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        adding = self.instance._state.adding              # UUID keys exist before the first save: `instance.pk` cannot tell
        tenant_id = (self.data.get("tenant") or self.initial.get("tenant")) if adding else self.instance.tenant_id
        if tenant_id:
            self.fields["roles"].queryset = Role.objects.using(P).filter(tenant_id=tenant_id, deleted_at__isnull=True).order_by("name")
        if not adding:
            self.fields["roles"].initial = list(UserRole.objects.using(P).filter(user=self.instance).values_list("role_id", flat=True))

    def clean_email(self):
        return self.cleaned_data["email"].strip().lower()

    def clean(self):
        data = super().clean()
        if data.get("is_platform_admin") and not data.get("is_staff"):
            self.add_error("is_staff", "A platform administrator must also be staff, or they cannot sign in here.")
        return data


@admin.register(AppUser)
class AppUserAdmin(BaseAdmin):
    form = AppUserForm
    list_display = ("email", "display_name", "tenant", "show_roles", "show_active", "is_staff", "is_platform_admin", "last_login")
    list_filter = ("tenant", "is_active", "is_staff", "is_platform_admin", "auth_provider")
    search_fields = ("email", "display_name")
    ordering = ("email",)
    raw_id_fields = ()
    autocomplete_fields = ("tenant",)
    readonly_fields = ("last_login", "created_at", "updated_at")
    actions = ("deactivate", "activate")
    actions_detail = ("password_link", "support_session")
    fieldsets = (
        ("Person", {"fields": ("tenant", "email", "display_name")}),
        ("Sign-In", {"fields": ("auth_provider", "external_subject_id", "is_active", "mfa_enabled", "last_login"),
                     "description": "Passwords are never typed here. Use “Create password link” and send the link to the user."}),
        ("Roles in the Tenant", {"fields": ("roles",)}),
        ("Platform Staff", {"fields": ("is_staff", "is_platform_admin"),
                            "description": "Staff can open this back-office. Platform administrators can change everything in it, for every tenant."}),
        ("System", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    def get_readonly_fields(self, request, obj=None):
        return (*self.readonly_fields, *(("tenant", "email") if obj else ()))

    @display(description="Roles")
    def show_roles(self, obj):
        return ", ".join(Role.objects.using(P).filter(user_roles__user=obj, deleted_at__isnull=True).order_by("name").values_list("name", flat=True)) or "—"

    @display(description="Active", boolean=True)
    def show_active(self, obj):
        return obj.is_active

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by_id = request.user.pk
        super().save_model(request, obj, form, change)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if "roles" in form.cleaned_data:
            user, wanted = form.instance, {role.id for role in form.cleaned_data["roles"] if role.tenant_id == form.instance.tenant_id}
            UserRole.objects.using(P).filter(user=user).exclude(role_id__in=wanted).delete()
            have = set(UserRole.objects.using(P).filter(user=user).values_list("role_id", flat=True))
            UserRole.objects.using(P).bulk_create([UserRole(user=user, role_id=role_id) for role_id in wanted - have])

    def has_delete_permission(self, request, obj=None):
        return False                                       # deactivate: everything a user created keeps its author

    @action(description="Deactivate")
    def deactivate(self, request, queryset):
        for user in queryset.exclude(pk=request.user.pk).filter(is_active=True):
            self.set_fields(request, user, is_active=False)
        messages.warning(request, "Deactivated (your own account is never included).")

    @action(description="Activate")
    def activate(self, request, queryset):
        for user in queryset.filter(is_active=False):
            self.set_fields(request, user, is_active=True)

    @action(description="Create Password Link", url_path="password-link")
    def password_link(self, request, object_id):
        from django.shortcuts import redirect
        user = AppUser.objects.using(P).select_related("tenant").get(pk=object_id)
        if not user.is_active or user.auth_provider != "LOCAL":
            messages.error(request, "Only active users who sign in with a password can get a link.")
        else:
            from apps.platform_ops import links, mail
            link = links.password_link(user)
            hours = links.hours()
            sent = mail.is_configured(user.tenant_id) and mail.send("password_link", user.email, tenant_id=user.tenant_id, subject=f"Choose your password for {user.tenant.code}", context={
                "name": user.display_name, "workspace": user.tenant.code, "link": link, "hours": hours, "invited": not user.password, "invited_by": "The platform team"})
            if sent:
                messages.success(request, f"A one-time password link was emailed to {user.email} (valid {hours} hours, until first use or sign-in).")
            else:
                messages.warning(request, f"Email is not configured or failed, so send this one-time link to {user.email} yourself (valid {hours} hours): {link}")
        return redirect("admin:identity_appuser_change", object_id)


    @action(description="Sign In as This User (support session)", url_path="support-session")
    def support_session(self, request, object_id):
        from apps.platform_ops import support
        return support.admin_view(self, request, object_id)


# ------------------------------------------------------------------------------------------------------------ roles
class RoleForm(forms.ModelForm):
    permissions = forms.ModelMultipleChoiceField(queryset=Permission.objects.none(), required=False, widget=UnfoldAdminCheckboxSelectMultipleWidget)

    class Meta:
        model = Role
        fields = ("tenant", "name", "description")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["permissions"].queryset = Permission.objects.using(P).order_by("code")
        if not self.instance._state.adding:
            self.fields["permissions"].initial = list(RolePermission.objects.using(P).filter(role=self.instance).values_list("permission_id", flat=True))


@admin.register(Role)
class RoleAdmin(BaseAdmin):
    form = RoleForm
    list_display = ("name", "tenant", "show_permissions", "show_users")
    list_filter = ("tenant",)
    search_fields = ("name",)
    ordering = ("tenant", "name")
    autocomplete_fields = ("tenant",)
    fieldsets = ((None, {"fields": ("tenant", "name", "description")}), ("Permissions", {"fields": ("permissions",)}))

    def get_queryset(self, request):
        return super().get_queryset(request).filter(deleted_at__isnull=True)

    def get_readonly_fields(self, request, obj=None):
        return ("tenant",) if obj else ()

    @display(description="Permissions")
    def show_permissions(self, obj):
        return RolePermission.objects.using(P).filter(role=obj).count()

    @display(description="Users")
    def show_users(self, obj):
        return UserRole.objects.using(P).filter(role=obj, user__deleted_at__isnull=True).count()

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if "permissions" in form.cleaned_data:
            role, wanted = form.instance, {p.id for p in form.cleaned_data["permissions"]}
            RolePermission.objects.using(P).filter(role=role).exclude(permission_id__in=wanted).delete()
            have = set(RolePermission.objects.using(P).filter(role=role).values_list("permission_id", flat=True))
            RolePermission.objects.using(P).bulk_create([RolePermission(role=role, permission_id=pid) for pid in wanted - have])

    def delete_model(self, request, obj):
        if UserRole.objects.using(P).filter(role=obj, user__deleted_at__isnull=True).exists():
            messages.error(request, f"{obj.name} still has users; move them first.")
            return
        self._stamp(request, obj)
        obj.deleted_at = timezone.now()
        obj.save(using=P, update_fields=["deleted_at"])


# ------------------------------------------------------------------------------------------------------------ API keys
@admin.register(ApiClient)
class ApiClientAdmin(BaseAdmin):
    """Keys are issued by tenant administrators in Settings (the secret is shown once, to them). Here: see and revoke."""
    list_display = ("name", "tenant", "client_type", "key_prefix", "show_state", "last_used_at", "expires_at")
    list_filter = ("tenant", "client_type")
    search_fields = ("name", "key_prefix")
    exclude = ("key_hash",)
    actions = ("revoke",)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in ApiClient._meta.concrete_fields if f.name not in ("key_hash", "rate_limit_per_minute", "expires_at")]

    @display(description="State", label={"Active": "success", "Revoked": "info", "Expired": "warning"})
    def show_state(self, obj):
        return "Revoked" if obj.revoked_at else "Expired" if obj.expires_at and obj.expires_at <= timezone.now() else "Active"

    @action(description="Revoke: the key stops working immediately")
    def revoke(self, request, queryset):
        for client in queryset.filter(revoked_at__isnull=True):
            self.set_fields(request, client, revoked_at=timezone.now())
        messages.warning(request, "Revoked.")


register_app_models(__package__)
