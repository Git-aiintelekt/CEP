"""identity — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now
from django.contrib.postgres.fields import ArrayField
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager


def _default_api_client_scopes():
    return []


class AppUserManager(BaseUserManager):
    def create_user(self, email, display_name, tenant, password=None, **extra):
        user = self.model(email=self.normalize_email(email), display_name=display_name, tenant=tenant, **extra)
        user.set_password(password) if password else user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email, display_name, tenant, password=None, **extra):
        extra.setdefault('is_staff', True)
        extra.setdefault('is_platform_admin', True)
        return self.create_user(email, display_name, tenant, password, **extra)


class AppUser(AbstractBaseUser):
    """Platform user login/identity"""
    class AuthProvider(models.TextChoices):
        LOCAL = 'LOCAL', 'Local'
        SAML = 'SAML', 'SAML'
        OIDC = 'OIDC', 'OIDC'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    email = models.TextField(unique=True)  # case-insensitive (CITEXT) in the database
    display_name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    auth_provider = models.CharField(max_length=20, default='LOCAL', choices=AuthProvider.choices)  # LOCAL, SAML, OIDC
    external_subject_id = models.CharField(max_length=255, null=True, blank=True)  # IdP subject / NameID for SSO users
    mfa_enabled = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)  # may use Django Admin (internal ops)
    is_platform_admin = models.BooleanField(default=False)  # cross-tenant platform operator (superuser)
    created_by = models.ForeignKey('self', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('self', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)
    password = models.CharField(max_length=255, db_column='password_hash', null=True, blank=True)  # Django hasher output; NULL for SSO-only users
    last_login = models.DateTimeField(db_column='last_login_at', null=True, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['display_name']
    objects = AppUserManager()

    @property
    def is_superuser(self):
        return self.is_platform_admin

    @property
    def is_anonymous(self):
        return False

    @property
    def is_authenticated(self):
        return True

    def permission_codes(self):
        """Permission codes granted through role assignments (identity.role_permission)."""
        from django.db.models import Q
        return set(Permission.objects.filter(role_permissions__role__user_roles__user=self).values_list('code', flat=True))

    def has_perm(self, perm, obj=None):
        return self.is_platform_admin or perm in self.permission_codes()

    def has_module_perms(self, app_label):
        return self.is_staff or self.is_platform_admin

    def check_password(self, raw_password):
        if not self.password:                              # NULL in the database: SSO-only, or no password set yet
            return False
        return super().check_password(raw_password)

    def has_usable_password(self):
        return bool(self.password) and super().has_usable_password()

    class Meta:
        managed = False
        db_table = 'app_user'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'auth_provider', 'external_subject_id'], name='ux_app_user_tenant_id_auth_provider_external_subject_id'),
        ]

    def __str__(self):
        return str(self.display_name)


class Role(models.Model):
    """Named permission bundle"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    name = models.CharField(max_length=100)
    description = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'role'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'name'], name='ux_role_tenant_id_name'),
        ]

    def __str__(self):
        return str(self.name)


class Permission(models.Model):
    """Individual grantable permission"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    code = models.CharField(max_length=100, unique=True)  # e.g. campaign.publish, journey.activate
    description = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'permission'

    def __str__(self):
        return str(self.code)


class RolePermission(models.Model):
    """Role-to-permission assignment"""
    pk = models.CompositePrimaryKey('role_id', 'permission_id')
    role = models.ForeignKey('identity.Role', on_delete=models.CASCADE, db_column='role_id', related_name='role_permissions')
    permission = models.ForeignKey('identity.Permission', on_delete=models.CASCADE, db_column='permission_id', related_name='role_permissions')
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'role_permission'

    def __str__(self):
        return str(self.pk)


class UserRole(models.Model):
    """User-to-role assignment"""
    pk = models.CompositePrimaryKey('user_id', 'role_id')
    user = models.ForeignKey('identity.AppUser', on_delete=models.CASCADE, db_column='user_id', related_name='+')
    role = models.ForeignKey('identity.Role', on_delete=models.CASCADE, db_column='role_id', related_name='user_roles')
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'user_role'

    def __str__(self):
        return str(self.pk)


class ApiClient(models.Model):
    """Scoped, hashed API keys for integrations and services with IP allow-list, rate limit, expiry and revocation"""
    class ClientType(models.TextChoices):
        SERVICE = 'SERVICE', 'Service'
        INTEGRATION = 'INTEGRATION', 'Integration'
        WEBHOOK_SOURCE = 'WEBHOOK_SOURCE', 'Webhook Source'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    name = models.CharField(max_length=100)
    client_type = models.CharField(max_length=20, choices=ClientType.choices)  # SERVICE (internal FastAPI service), INTEGRATION (client system), WEBHOOK_SOURCE (inbound webhook caller)
    key_prefix = models.CharField(max_length=20, unique=True)  # visible part, e.g. cep_li_8Fk2Qz ; the rest is only ever shown once
    key_hash = models.CharField(max_length=64)  # sha256 of the full key
    scopes = ArrayField(models.TextField(), default=_default_api_client_scopes)  # e.g. lists:write, events:ingest, scores:read
    allowed_ip_cidrs = ArrayField(models.TextField(), null=True, blank=True)
    rate_limit_per_minute = models.IntegerField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'api_client'

    def __str__(self):
        return str(self.name)
