"""customers — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now


class CustomerMaster(models.Model):
    """Non-authoritative synced copy of C360's denormalized Customer Master (BRD TD-02)"""
    party_id = models.CharField(max_length=60, primary_key=True)  # canonical key, sourced from C360
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    first_name = models.CharField(max_length=120, null=True, blank=True)
    last_name = models.CharField(max_length=120, null=True, blank=True)
    emails = models.JSONField(default=list)  # [{address, is_primary, is_valid}]
    phones = models.JSONField(default=list)  # [{number, type, is_primary}]
    primary_address = models.JSONField(null=True, blank=True)
    custom_attributes = models.JSONField(default=dict)  # loyalty tier, RFM/CLV, etc.; `timezone` (an IANA name) is the customer's own time zone, read by journey waits
    source_system = models.CharField(max_length=40, default='C360')
    is_synced_copy = models.BooleanField(default=True)  # always TRUE per TD-02; kept explicit
    synced_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'customer_master'

    def __str__(self):
        return str(self.party_id)


class Segment(models.Model):
    """Cached reference to a C360/BI segment definition"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    source_system = models.CharField(max_length=40, default='C360')
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    rule_definition = models.JSONField(null=True, blank=True)  # rule-based definition, if exposed
    synced_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'segment'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'source_system', 'code'], name='ux_segment_tenant_id_source_system_code'),
        ]

    def __str__(self):
        return str(self.name)


class Coupon(models.Model):
    """Cached reference to a C360 coupon definition; not owned/edited by CEP (do not rebuild coupon issuance)"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    source_system = models.CharField(max_length=40, default='C360')
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    discount_definition = models.JSONField(null=True, blank=True)  # {type: PERCENT|AMOUNT, value}, if exposed
    is_active = models.BooleanField(default=True)
    synced_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'coupon'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'source_system', 'code'], name='ux_coupon_tenant_id_source_system_code'),
        ]

    def __str__(self):
        return str(self.name)


class LoyaltyTier(models.Model):
    """Cached reference to a C360 loyalty tier; not owned/edited by CEP (do not rebuild the loyalty program)"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    source_system = models.CharField(max_length=40, default='C360')
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=200)
    rank = models.IntegerField(default=0)  # ordering only, e.g. Silver < Gold < Platinum
    description = models.TextField(null=True, blank=True)
    synced_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'loyalty_tier'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'source_system', 'code'], name='ux_loyalty_tier_tenant_id_source_system_code'),
        ]

    def __str__(self):
        return str(self.name)


class CustomerSegmentMembership(models.Model):
    """Party membership in a synced segment"""
    pk = models.CompositePrimaryKey('segment_id', 'party_id')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    party_id = models.CharField(max_length=60)
    segment = models.ForeignKey('customers.Segment', on_delete=models.PROTECT, db_column='segment_id', related_name='customer_segment_memberships')
    qualified_at = models.DateTimeField(db_default=Now())
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'customer_segment_membership'

    def __str__(self):
        return str(self.party_id)


class CustomerAttributeSource(models.Model):
    """A system customer attribute values come from: a Report Database table read by an ID column, a file, or the API (patch 0100)."""
    class Kind(models.TextChoices):
        DATABASE = 'DATABASE', 'Report Database'
        FILE = 'FILE', 'File'
        API = 'API', 'API'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    name = models.CharField(max_length=120)
    system = models.CharField(max_length=40)  # ICRM, SHOPIFY ...: the namespace of its IDs in customer_external_id
    kind = models.CharField(max_length=10, choices=Kind.choices)
    report_connection_id = models.UUIDField(null=True, blank=True)
    table_name = models.CharField(max_length=128, null=True, blank=True)
    id_column = models.CharField(max_length=128, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_sync_run_id = models.UUIDField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'customer_attribute_source'

    def __str__(self):
        return str(self.name)


class CustomerAttributeDefinition(models.Model):
    """A workspace's own customer field: the key a tag names, its type, and where it is read (patch 0100)."""
    class DataType(models.TextChoices):
        TEXT = 'TEXT', 'Text'
        NUMBER = 'NUMBER', 'Number'
        DATE = 'DATE', 'Date'
        BOOLEAN = 'BOOLEAN', 'Yes or No'

    class Scope(models.TextChoices):
        CUSTOMER = 'CUSTOMER', 'The Customer'
        LIST = 'LIST', 'One List Entry'

    class Refresh(models.TextChoices):
        NIGHTLY = 'NIGHTLY', 'Nightly'
        ON_IMPORT = 'ON_IMPORT', 'On Import'
        ON_CHANGE = 'ON_CHANGE', 'On Change'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    key = models.CharField(max_length=60)
    label = models.CharField(max_length=120)
    data_type = models.CharField(max_length=10, default='TEXT', choices=DataType.choices)
    scope = models.CharField(max_length=10, default='CUSTOMER', choices=Scope.choices)
    source = models.ForeignKey('customers.CustomerAttributeSource', on_delete=models.SET_NULL, db_column='source_id', related_name='attributes', null=True, blank=True)
    source_field = models.CharField(max_length=128, null=True, blank=True)
    refresh = models.CharField(max_length=12, default='ON_IMPORT', choices=Refresh.choices)
    is_pii = models.BooleanField(default=False)
    default_value = models.CharField(max_length=500, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'customer_attribute_definition'

    def __str__(self):
        return str(self.label)


class CustomerAttributeSyncRun(models.Model):
    """One read of an attribute source: nightly, Sync Now, an import, Fill From Database or an API push (patch 0100)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    source = models.ForeignKey('customers.CustomerAttributeSource', on_delete=models.CASCADE, db_column='source_id', related_name='runs', null=True, blank=True)
    trigger = models.CharField(max_length=10)  # NIGHTLY, MANUAL, IMPORT, FILL, API
    status = models.CharField(max_length=10, default='QUEUED')  # QUEUED, RUNNING, DONE, FAILED
    params = models.JSONField(default=dict)
    people_read = models.IntegerField(default=0)
    people_matched = models.IntegerField(default=0)
    values_changed = models.IntegerField(default=0)
    error = models.CharField(max_length=500, null=True, blank=True)
    queued_at = models.DateTimeField(db_default=Now())
    started_at = models.DateTimeField(null=True, blank=True)
    heartbeat_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'customer_attribute_sync_run'

    def __str__(self):
        return f"{self.trigger} {self.status}"
