"""Models over database/CEP_Database_Schema_Platform_Operations.sql (layer 5). Unmanaged: the DDL is the source of truth."""
import uuid

from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models.functions import Now


class TenantInvoice(models.Model):
    """One invoice per tenant and month: plan price plus metered overage"""
    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        ISSUED = 'ISSUED', 'Issued'
        PAID = 'PAID', 'Paid'
        VOID = 'VOID', 'Void'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    invoice_number = models.CharField(max_length=40, unique=True)
    period_month = models.DateField()
    plan_code = models.CharField(max_length=30)
    currency = models.CharField(max_length=3, default='USD')
    base_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    overage_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_items = models.JSONField(default=list)
    usage_snapshot = models.JSONField(default=dict)
    status = models.CharField(max_length=10, default='DRAFT', choices=Status.choices)
    issued_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    external_ref = models.CharField(max_length=100, null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'tenant_invoice'

    def __str__(self):
        return self.invoice_number


class TenantOperation(models.Model):
    """Runbook record of a long-running tenant operation"""
    class Operation(models.TextChoices):
        EXPORT = 'EXPORT', 'Export data'
        MOVE_TO_DEDICATED = 'MOVE_TO_DEDICATED', 'Move to a dedicated database'
        PURGE_SOURCE = 'PURGE_SOURCE', 'Purge the pool copy after a move'
        OFFBOARD = 'OFFBOARD', 'Offboard (export, then erase)'

    class Status(models.TextChoices):
        REQUESTED = 'REQUESTED', 'Requested'
        RUNNING = 'RUNNING', 'Running'
        SUCCEEDED = 'SUCCEEDED', 'Succeeded'
        FAILED = 'FAILED', 'Failed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    operation = models.CharField(max_length=30, choices=Operation.choices)
    status = models.CharField(max_length=12, default='REQUESTED', choices=Status.choices)
    parameters = models.JSONField(default=dict, blank=True)
    progress = models.JSONField(default=list, blank=True)
    result = models.JSONField(default=dict, blank=True)
    error = models.TextField(null=True, blank=True)
    requested_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='requested_by', related_name='+', null=True, blank=True)
    requested_at = models.DateTimeField(db_default=Now())
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'tenant_operation'

    def __str__(self):
        return f"{self.get_operation_display()} · {self.tenant_id}"


class JobRun(models.Model):
    """One execution of a scheduled job"""
    class Status(models.TextChoices):
        RUNNING = 'RUNNING', 'Running'
        SUCCEEDED = 'SUCCEEDED', 'Succeeded'
        FAILED = 'FAILED', 'Failed'

    id = models.BigAutoField(primary_key=True)
    job_name = models.CharField(max_length=100)
    status = models.CharField(max_length=10, default='RUNNING', choices=Status.choices)
    started_at = models.DateTimeField(db_default=Now())
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    result = models.JSONField(null=True, blank=True)
    error = models.TextField(null=True, blank=True)
    worker = models.CharField(max_length=200, null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'job_run'

    def __str__(self):
        return f"{self.job_name} #{self.pk}"


class PlatformAlert(models.Model):
    """An open alert per failing health check"""
    class Severity(models.TextChoices):
        WARN = 'WARN', 'Warning'
        FAIL = 'FAIL', 'Failing'

    id = models.BigAutoField(primary_key=True)
    check_name = models.CharField(max_length=100)
    severity = models.CharField(max_length=10, choices=Severity.choices)
    summary = models.TextField()
    detail = models.TextField(null=True, blank=True)
    opened_at = models.DateTimeField(db_default=Now())
    last_seen_at = models.DateTimeField(db_default=Now())
    last_notified_at = models.DateTimeField(null=True, blank=True)
    notifications = models.IntegerField(default=0)
    resolved_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='acknowledged_by', related_name='+', null=True, blank=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'platform_alert'

    def __str__(self):
        return f"{self.check_name}: {self.summary[:60]}"


class SupportAccessLog(models.Model):
    """A support session in which platform staff acted as a tenant user"""
    class Mode(models.TextChoices):
        READ = 'READ', 'Read only'
        WRITE = 'WRITE', 'Read and write'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    staff_user = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='staff_user_id', related_name='+')
    target_user = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='target_user_id', related_name='+')
    staff_name = models.CharField(max_length=200, null=True, blank=True)  # the operator's row is hidden from the tenant by RLS
    reason = models.TextField()
    access_mode = models.CharField(max_length=10, default='READ', choices=Mode.choices)
    started_at = models.DateTimeField(db_default=Now())
    expires_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    requests = models.IntegerField(default=0)
    writes = models.IntegerField(default=0)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'support_access_log'

    def __str__(self):
        return f"{self.staff_user_id} as {self.target_user_id}"


class TenantIdentityProvider(models.Model):
    """A tenant's OpenID Connect identity provider"""
    tenant = models.OneToOneField('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+', primary_key=True)
    protocol = models.CharField(max_length=10, default='OIDC')
    display_name = models.CharField(max_length=100, default='Single sign-on')
    issuer = models.TextField()
    client_id = models.TextField()
    client_secret_enc = models.TextField(null=True, blank=True)
    scopes = models.CharField(max_length=200, default='openid email profile')
    allowed_email_domains = ArrayField(models.TextField(), default=list, blank=True)
    jit_provisioning = models.BooleanField(default=False)
    default_role = models.ForeignKey('identity.Role', on_delete=models.PROTECT, db_column='default_role_id', related_name='+', null=True, blank=True)
    enforce_sso = models.BooleanField(default=False)
    is_active = models.BooleanField(default=False)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'tenant_identity_provider'

    def __str__(self):
        return f"{self.display_name} ({self.issuer})"


class PlatformSetting(models.Model):
    """Global parameter of the installation (never a secret)"""
    class ValueType(models.TextChoices):
        STRING = 'STRING', 'Text'
        INTEGER = 'INTEGER', 'Whole number'
        DECIMAL = 'DECIMAL', 'Decimal'
        BOOLEAN = 'BOOLEAN', 'Yes / no'
        LIST = 'LIST', 'List'
        OBJECT = 'OBJECT', 'Object'

    key = models.CharField(max_length=100, primary_key=True)
    value = models.JSONField()
    value_type = models.CharField(max_length=10, default='STRING', choices=ValueType.choices)
    category = models.CharField(max_length=40, default='General')
    description = models.TextField()
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'platform_setting'
        ordering = ('category', 'key')

    def __str__(self):
        return self.key


class IndustryProfile(models.Model):
    """Default features and vocabulary for a kind of business"""
    code = models.CharField(max_length=30, primary_key=True)
    name = models.CharField(max_length=100)
    description = models.TextField(null=True, blank=True)
    features = models.JSONField(default=dict, blank=True)
    terminology = models.JSONField(default=dict, blank=True)
    defaults = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'industry_profile'
        ordering = ('sort_order', 'name')

    def __str__(self):
        return self.name
