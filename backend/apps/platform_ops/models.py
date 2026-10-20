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


class MailServer(models.Model):
    """SMTP details entered in the product: one per tenant, plus the platform's own row (tenant NULL) for the platform's own mail"""
    class Security(models.TextChoices):
        NONE = 'NONE', 'None (plain)'
        STARTTLS = 'STARTTLS', 'STARTTLS (usually port 587)'
        SSL = 'SSL', 'SSL/TLS (usually port 465)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+', null=True, blank=True)
    host = models.CharField(max_length=253, default='', blank=True)
    port = models.IntegerField(default=587)
    security = models.CharField(max_length=10, default='STARTTLS', choices=Security.choices)
    username = models.CharField(max_length=200, null=True, blank=True)
    password_enc = models.TextField(null=True, blank=True)
    from_email = models.CharField(max_length=254)
    from_name = models.CharField(max_length=150, null=True, blank=True)
    reply_to = models.CharField(max_length=254, null=True, blank=True)
    campaign_sender = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_ok = models.BooleanField(null=True, blank=True)
    last_test_error = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'mail_server'
        verbose_name = 'mail server'

    def __str__(self):
        return f"{self.tenant.code if self.tenant_id else 'Platform'}: {self.host}"


def _every_channel():
    return ['EMAIL', 'E_RECEIPT', 'SMS', 'MMS']


class PlatformPersonalizationTag(models.Model):
    """The installation's tag catalogue (patch 0026): kept in the back-office, copied into every workspace (apps/templates/inherit.py)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tag_key = models.CharField(max_length=100, unique=True)
    label = models.CharField(max_length=150)
    tag_kind = models.CharField(max_length=20, default='STANDARD')
    source_system = models.CharField(max_length=40, default='CEP')
    resolution_source = models.CharField(max_length=30)
    source_path = models.CharField(max_length=200, null=True, blank=True)
    static_value = models.TextField(null=True, blank=True)
    default_value = models.TextField(null=True, blank=True)
    format_spec = models.CharField(max_length=60, null=True, blank=True)
    data_type = models.CharField(max_length=20, default='STRING')
    applies_to_channels = ArrayField(models.TextField(), default=_every_channel)
    description = models.TextField(null=True, blank=True)
    sample_value = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'platform_personalization_tag'
        verbose_name = 'personalization tag'
        verbose_name_plural = 'personalization tags'

    def __str__(self):
        return '{{' + self.tag_key + '}}'


class ErrorGroup(models.Model):
    """One distinct error (same source, kind and place): how often, since when, and whether someone dealt with it"""
    class Source(models.TextChoices):
        BACKEND = 'BACKEND', 'API'
        BROWSER = 'BROWSER', 'Browser'
        JOB = 'JOB', 'Job'

    class Status(models.TextChoices):
        OPEN = 'OPEN', 'Open'
        RESOLVED = 'RESOLVED', 'Resolved'
        IGNORED = 'IGNORED', 'Ignored'

    id = models.BigAutoField(primary_key=True)
    fingerprint = models.CharField(max_length=64, unique=True)
    source = models.CharField(max_length=10, choices=Source.choices)
    kind = models.CharField(max_length=200)
    message = models.TextField()
    culprit = models.CharField(max_length=300, null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    occurrences = models.BigIntegerField(default=0)
    first_seen = models.DateTimeField(db_default=Now())
    last_seen = models.DateTimeField(db_default=Now())
    regressed_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='resolved_by', related_name='+', null=True, blank=True)
    note = models.TextField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'error_group'
        verbose_name = 'error'
        verbose_name_plural = 'errors'

    def __str__(self):
        return f"{self.kind}: {self.message[:80]}"


class ErrorEvent(models.Model):
    """One occurrence of an error group, sampled"""
    id = models.BigAutoField(primary_key=True)
    group = models.ForeignKey(ErrorGroup, on_delete=models.CASCADE, db_column='group_id', related_name='events')
    occurred_at = models.DateTimeField(db_default=Now())
    tenant_id = models.UUIDField(null=True, blank=True)
    tenant_code = models.CharField(max_length=50, null=True, blank=True)
    user_id = models.UUIDField(null=True, blank=True)
    method = models.CharField(max_length=10, null=True, blank=True)
    path = models.CharField(max_length=500, null=True, blank=True)
    status_code = models.IntegerField(null=True, blank=True)
    release = models.CharField(max_length=60, null=True, blank=True)
    stack = models.TextField(null=True, blank=True)
    context = models.JSONField(default=dict)

    class Meta:
        managed = False
        db_table = 'error_event'


class UptimeTarget(models.Model):
    """An address the probe-uptime job calls every minute"""
    class State(models.TextChoices):
        UP = 'UP', 'Up'
        DOWN = 'DOWN', 'Down'
        UNKNOWN = 'UNKNOWN', 'Not checked yet'

    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=100, unique=True)
    url = models.URLField(max_length=500, verbose_name='address')
    expect_status = models.IntegerField(default=200, verbose_name='expected status', help_text='The HTTP status a healthy answer has.')
    expect_text = models.CharField(max_length=200, null=True, blank=True, verbose_name='expected text', help_text='Optional: the answer must contain this text.')
    timeout_ms = models.IntegerField(default=5000, verbose_name='timeout (ms)', help_text='A slower answer counts as a failure.')
    is_active = models.BooleanField(default=True, verbose_name='active')
    state = models.CharField(max_length=10, choices=State.choices, default=State.UNKNOWN)
    state_since = models.DateTimeField(db_default=Now())
    consecutive_failures = models.IntegerField(default=0)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    last_ms = models.IntegerField(null=True, blank=True)
    last_error = models.CharField(max_length=500, null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'uptime_target'
        verbose_name = 'uptime target'

    def __str__(self):
        return self.name


class UptimeCheck(models.Model):
    """One probe of an uptime target"""
    id = models.BigAutoField(primary_key=True)
    target = models.ForeignKey(UptimeTarget, on_delete=models.CASCADE, db_column='target_id', related_name='checks')
    checked_at = models.DateTimeField(db_default=Now())
    ok = models.BooleanField()
    status_code = models.IntegerField(null=True, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    error = models.CharField(max_length=500, null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'uptime_check'


# ---------------------------------------------------------------------------------------------------- the suite's components (0048)
class SuiteComponent(models.Model):
    """The registry: what exists, its release state and what it depends on. PLANNED cannot be switched on anywhere."""
    class Release(models.TextChoices):
        RELEASED = 'RELEASED', 'Released'
        BETA = 'BETA', 'Beta'
        PLANNED = 'PLANNED', 'Coming soon'

    key = models.CharField(max_length=20, primary_key=True)
    name = models.CharField(max_length=60)
    tagline = models.CharField(max_length=120, blank=True, default='')
    release = models.CharField(max_length=10, choices=Release.choices, default=Release.PLANNED)
    needs = models.JSONField(default=list, blank=True)
    js_budget_kb = models.IntegerField(null=True, blank=True)
    sort_order = models.IntegerField(default=0)
    row_version = models.IntegerField(default=1)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'suite_component'
        ordering = ('sort_order', 'key')
        verbose_name = 'component'

    def __str__(self):
        return str(self.name)


class PlanComponent(models.Model):
    """A component a plan includes"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey('tenants.SubscriptionPlan', on_delete=models.CASCADE, db_column='plan_id', related_name='plan_components')
    component = models.ForeignKey(SuiteComponent, on_delete=models.CASCADE, db_column='component_key', related_name='+')
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'plan_component'
        unique_together = (('plan', 'component'),)


class TenantComponent(models.Model):
    """A workspace's own entry for a component: a trial until a date, an add-on, or OFF although the plan includes it"""
    class Access(models.TextChoices):
        TRIAL = 'TRIAL', 'Trial'
        ADDON = 'ADDON', 'Add-on'
        OFF = 'OFF', 'Off'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE, db_column='tenant_id', related_name='+')
    component = models.ForeignKey(SuiteComponent, on_delete=models.CASCADE, db_column='component_key', related_name='+')
    access = models.CharField(max_length=10, choices=Access.choices)
    until = models.DateField(null=True, blank=True)
    row_version = models.IntegerField(default=1)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'tenant_component'
        unique_together = (('tenant', 'component'),)


class SecurityFinding(models.Model):
    """What the security check found on a server (apps/platform_ops/security.py); the back-office Security page is its list"""
    class Status(models.TextChoices):
        OPEN = 'OPEN', 'Open'
        FIXED = 'FIXED', 'Fixed'
        ACCEPTED = 'ACCEPTED', 'Accepted'

    id = models.BigAutoField(primary_key=True)
    host = models.CharField(max_length=200)
    fingerprint = models.CharField(max_length=200)
    kind = models.CharField(max_length=10)
    item = models.CharField(max_length=200)
    title = models.CharField(max_length=200)
    severity = models.CharField(max_length=10)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    first_seen = models.DateTimeField(db_default=Now())
    last_seen = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'security_finding'
        verbose_name = 'security item'

    def __str__(self):
        return self.title
