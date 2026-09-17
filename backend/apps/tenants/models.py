"""tenants — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now
from django.contrib.postgres.fields import ArrayField


def _default_tenant_storage_config_allowed_mime_types():
    return ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf', 'text/csv']

def _default_tenant_storage_config_image_renditions():
    return json.loads("{\"thumb\": 200, \"email\": 600, \"retina\": 1200, \"mms\": 640}")


class Tenant(models.Model):
    """Workspace/organization root for multi-tenancy"""
    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        SUSPENDED = 'SUSPENDED', 'Suspended'
        OFFBOARDED = 'OFFBOARDED', 'Offboarded'

    class IsolationMode(models.TextChoices):
        SHARED = 'SHARED', 'Shared'
        DEDICATED = 'DEDICATED', 'Dedicated'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, unique=True)
    timezone = models.CharField(max_length=64, default='UTC')
    status = models.CharField(max_length=20, default='ACTIVE', choices=Status.choices)  # ACTIVE, SUSPENDED
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)
    partition_seq = models.IntegerField(editable=False, db_default=0, unique=True)  # assigned by the database (GENERATED ALWAYS AS IDENTITY)
    subdomain = models.CharField(max_length=63, null=True, blank=True, unique=True)
    custom_app_domain = models.CharField(max_length=253, null=True, blank=True, unique=True)
    isolation_mode = models.CharField(max_length=20, default='SHARED', choices=IsolationMode.choices)
    region = models.CharField(max_length=40, null=True, blank=True)
    data_residency = models.CharField(max_length=40, null=True, blank=True)
    onboarded_at = models.DateTimeField(null=True, blank=True)
    settings = models.JSONField(default=dict)

    class Meta:
        managed = False
        db_table = 'tenant'

    def __str__(self):
        return str(self.name)


class TenantDatabase(models.Model):
    """Routing record: which database (shared pool or dedicated) hosts the tenant; drives the Django DB router"""
    class IsolationMode(models.TextChoices):
        SHARED = 'SHARED', 'Shared'
        DEDICATED = 'DEDICATED', 'Dedicated'

    class Status(models.TextChoices):
        PROVISIONING = 'PROVISIONING', 'Provisioning'
        ACTIVE = 'ACTIVE', 'Active'
        MIGRATING = 'MIGRATING', 'Migrating'
        READ_ONLY = 'READ_ONLY', 'Read Only'
        DECOMMISSIONED = 'DECOMMISSIONED', 'Decommissioned'

    tenant = models.OneToOneField('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+', primary_key=True)
    isolation_mode = models.CharField(max_length=20, default='SHARED', choices=IsolationMode.choices)  # SHARED (pool database, per-tenant partitions) | DEDICATED (own database)
    db_alias = models.CharField(max_length=63, default='default')  # Django DATABASES key selected by the tenant router
    db_host = models.CharField(max_length=253, null=True, blank=True)
    db_port = models.IntegerField(null=True, blank=True)
    db_name = models.CharField(max_length=63, null=True, blank=True)
    db_secret_ref = models.CharField(max_length=200, null=True, blank=True)  # vault key for credentials; never the credential itself
    status = models.CharField(max_length=20, default='ACTIVE', choices=Status.choices)  # PROVISIONING, ACTIVE, MIGRATING, READ_ONLY, DECOMMISSIONED
    migrated_from_alias = models.CharField(max_length=63, null=True, blank=True)
    migrated_at = models.DateTimeField(null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'tenant_database'

    def __str__(self):
        return str(self.pk)


class SubscriptionPlan(models.Model):
    """Plan catalogue: tier limits, default isolation mode, feature flags, price"""
    class DefaultIsolationMode(models.TextChoices):
        SHARED = 'SHARED', 'Shared'
        DEDICATED = 'DEDICATED', 'Dedicated'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    code = models.CharField(max_length=30, unique=True)  # STARTER, GROWTH, ENTERPRISE
    name = models.CharField(max_length=100)
    default_isolation_mode = models.CharField(max_length=20, default='SHARED', choices=DefaultIsolationMode.choices)  # SHARED, DEDICATED
    max_contacts = models.BigIntegerField(null=True, blank=True)
    max_messages_per_month = models.BigIntegerField(null=True, blank=True)
    max_users = models.IntegerField(null=True, blank=True)
    max_storage_gb = models.IntegerField(null=True, blank=True)
    features = models.JSONField(default=dict)  # feature flags: journeys, ereceipt, ab_testing, custom_domain ...
    monthly_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    overage_per_1k_messages = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)  # NULL = hard limit: sending stops
    overage_per_1k_contacts = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    currency = models.CharField(max_length=3, default='USD')
    is_active = models.BooleanField(default=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'subscription_plan'

    def __str__(self):
        return str(self.name)


class TenantSubscription(models.Model):
    """Tenant's current plan, lifecycle status and billing references"""
    class Status(models.TextChoices):
        TRIAL = 'TRIAL', 'Trial'
        ACTIVE = 'ACTIVE', 'Active'
        PAST_DUE = 'PAST_DUE', 'Past Due'
        CANCELLED = 'CANCELLED', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    plan = models.ForeignKey('tenants.SubscriptionPlan', on_delete=models.PROTECT, db_column='plan_id', related_name='tenant_subscriptions')
    status = models.CharField(max_length=20, default='TRIAL', choices=Status.choices)  # TRIAL, ACTIVE, PAST_DUE, CANCELLED
    started_at = models.DateTimeField(db_default=Now())
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    billing_customer_ref = models.CharField(max_length=100, null=True, blank=True)  # e.g. Stripe customer id
    billing_subscription_ref = models.CharField(max_length=100, null=True, blank=True)  # e.g. Stripe subscription id
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'tenant_subscription'

    def __str__(self):
        return str(self.pk)


class TenantUsage(models.Model):
    """Monthly metered usage per tenant (emails, SMS, contacts, storage) for quotas and invoicing"""
    class Metric(models.TextChoices):
        EMAIL_SENT = 'EMAIL_SENT', 'Email Sent'
        SMS_SENT = 'SMS_SENT', 'SMS Sent'
        MMS_SENT = 'MMS_SENT', 'MMS Sent'
        CONTACTS = 'CONTACTS', 'Contacts'
        STORAGE_BYTES = 'STORAGE_BYTES', 'Storage Bytes'
        API_CALLS = 'API_CALLS', 'API Calls'

    pk = models.CompositePrimaryKey('tenant_id', 'period_month', 'metric')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    period_month = models.DateField()  # first day of the month
    metric = models.CharField(max_length=30, choices=Metric.choices)  # EMAIL_SENT, SMS_SENT, MMS_SENT, CONTACTS, STORAGE_BYTES, API_CALLS
    value = models.BigIntegerField(default=0)  # rolled up by analytics workers from execution tables / storage
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'tenant_usage'

    def __str__(self):
        return str(self.pk)


class TenantStorageConfig(models.Model):
    """Object-storage bucket, CDN base URL, custom asset domain, upload rules and image renditions per tenant"""
    class StorageBackend(models.TextChoices):
        S3 = 'S3', 'S3'
        R2 = 'R2', 'R2'
        GCS = 'GCS', 'Gcs'
        AZURE = 'AZURE', 'Azure'

    class CustomDomainStatus(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        ACTIVE = 'ACTIVE', 'Active'
        FAILED = 'FAILED', 'Failed'

    tenant = models.OneToOneField('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+', primary_key=True)
    storage_backend = models.CharField(max_length=10, default='S3', choices=StorageBackend.choices)  # S3, R2, GCS, AZURE
    bucket_name = models.CharField(max_length=63)
    bucket_region = models.CharField(max_length=40, null=True, blank=True)
    base_prefix = models.CharField(max_length=200)  # t/<partition_seq>/ — every object of the tenant under one prefix
    cdn_base_url = models.TextField()  # https://cdn.cep.example.com
    custom_asset_domain = models.CharField(max_length=253, null=True, blank=True)  # assets.client-brand.com (CNAME to the CDN distribution)
    custom_domain_status = models.CharField(max_length=20, default='PENDING', choices=CustomDomainStatus.choices)  # PENDING, ACTIVE, FAILED (TLS certificate + DNS validated)
    signed_url_ttl_seconds = models.IntegerField(default=900)  # PRIVATE assets: presigned URL lifetime
    max_upload_bytes = models.BigIntegerField(default=26214400)  # 25 MB
    allowed_mime_types = ArrayField(models.TextField(), default=_default_tenant_storage_config_allowed_mime_types)
    image_renditions = models.JSONField(default=_default_tenant_storage_config_image_renditions)  # label -> max width px
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'tenant_storage_config'

    def __str__(self):
        return str(self.pk)


class PartitionRetentionPolicy(models.Model):
    """Per-table partition scheme and retention; drives provisioning, monthly creation, expiry and tenant migration functions"""
    class SubMethod(models.TextChoices):
        RANGE_MONTHLY = 'RANGE_MONTHLY', 'Range Monthly'
        HASH = 'HASH', 'Hash'

    class ExpiryAction(models.TextChoices):
        DROP = 'DROP', 'Drop'
        DETACH = 'DETACH', 'Detach'

    table_name = models.CharField(max_length=63, primary_key=True)
    tenant_partitioned = models.BooleanField(default=True)  # top level is LIST (tenant_id)
    sub_method = models.CharField(max_length=20, choices=SubMethod.choices)  # RANGE_MONTHLY, HASH
    sub_key = models.CharField(max_length=63)  # column the tenant partition is sub-partitioned on
    hash_modulus = models.IntegerField(null=True, blank=True)  # HASH only
    retention_months = models.IntegerField(null=True, blank=True)  # NULL = keep forever
    expiry_action = models.CharField(max_length=10, default='DETACH', choices=ExpiryAction.choices)  # DROP, DETACH (detached partitions are archived by ops)
    note = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'partition_retention_policy'

    def __str__(self):
        return str(self.table_name)
