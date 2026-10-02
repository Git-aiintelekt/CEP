"""contact_lists — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now


def _default_contact_list_import_match_rules():
    return json.loads("[\"LOYALTY_ID\", \"EMAIL\", \"PHONE\"]")


class ContactList(models.Model):
    """Reusable customer population from BI / extraction / upload"""
    class SourceType(models.TextChoices):
        BI = 'BI', 'Bi'
        EXTRACTION = 'EXTRACTION', 'Extraction'
        UPLOAD = 'UPLOAD', 'Upload'
        SEGMENT = 'SEGMENT', 'Segment'
        CLONE = 'CLONE', 'Clone'

    class ListKind(models.TextChoices):
        STATIC = 'STATIC', 'Static'
        DYNAMIC = 'DYNAMIC', 'Dynamic'
        SEGMENT = 'SEGMENT', 'Segment'
        DERIVED = 'DERIVED', 'Derived'

    class RefreshMode(models.TextChoices):
        MANUAL = 'MANUAL', 'Manual'
        SCHEDULED = 'SCHEDULED', 'Scheduled'
        ON_CAMPAIGN_BUILD = 'ON_CAMPAIGN_BUILD', 'On Campaign Build'

    class Channel(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        SMS = 'SMS', 'Texts'
        BOTH = 'BOTH', 'Email and texts'

    class ListEnvironment(models.TextChoices):
        TEST = 'TEST', 'Test'
        PRODUCTION = 'PRODUCTION', 'Production'

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'          # made by the upload wizard; ACTIVE once its first import is applied
        ACTIVE = 'ACTIVE', 'Active'
        ARCHIVED = 'ARCHIVED', 'Archived'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    legacy_contact_list_id = models.CharField(max_length=60, null=True, blank=True, unique=True)  # iCRM contact_list.CONTACT_LIST_ID, where this list is reused/migrated rather than newly created
    name = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    source_type = models.CharField(max_length=20, choices=SourceType.choices)  # BI, EXTRACTION, UPLOAD, SEGMENT
    source_reference = models.CharField(max_length=300, null=True, blank=True)  # BI job id / file name / segment id
    list_kind = models.CharField(max_length=20, default='STATIC', choices=ListKind.choices)  # STATIC (uploaded), DYNAMIC (rule, materialised on refresh), SEGMENT (C360 segment), DERIVED (filter over a parent, resolved at campaign build — never copied)
    is_master = models.BooleanField(default=True)  # master lists are the reusable populations attached to campaigns
    parent_contact_list = models.ForeignKey('self', on_delete=models.PROTECT, db_column='parent_contact_list_id', related_name='contact_lists', null=True, blank=True)
    criteria = models.JSONField(null=True, blank=True)  # DYNAMIC / DERIVED rule evaluated by the audience worker (iCRM contact_list.CRITERIA)
    refresh_mode = models.CharField(max_length=20, default='MANUAL', choices=RefreshMode.choices)  # MANUAL, SCHEDULED, ON_CAMPAIGN_BUILD
    refresh_interval_minutes = models.IntegerField(null=True, blank=True)
    last_refreshed_at = models.DateTimeField(null=True, blank=True)
    list_environment = models.CharField(max_length=20, default='PRODUCTION', choices=ListEnvironment.choices)  # TEST, PRODUCTION
    channel = models.CharField(max_length=10, default='EMAIL', choices=Channel.choices)  # EMAIL, SMS, BOTH: the required upload column and how a new person is recognised
    status = models.CharField(max_length=20, default='ACTIVE', choices=Status.choices)
    member_count = models.IntegerField(default=0)  # maintained by import worker
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'contact_list'

    def __str__(self):
        return str(self.name)


class ContactListMember(models.Model):
    """Party membership in a Contact List — party_id references only, never customer attributes (hash-partitioned)"""
    class MembershipSource(models.TextChoices):
        UPLOAD = 'UPLOAD', 'Upload'
        RULE = 'RULE', 'Rule'
        SEGMENT = 'SEGMENT', 'Segment'
        MANUAL = 'MANUAL', 'Manual'
        CLONE = 'CLONE', 'Clone'

    class MatchedBy(models.TextChoices):
        LOYALTY_ID = 'LOYALTY_ID', 'Loyalty ID'
        EMAIL = 'EMAIL', 'Email'
        PHONE = 'PHONE', 'Phone'
        PARTY_ID = 'PARTY_ID', 'Party ID'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    contact_list = models.ForeignKey('contact_lists.ContactList', on_delete=models.CASCADE, db_column='contact_list_id', related_name='contact_list_members')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    party_id = models.CharField(max_length=60)
    custom_attributes = models.JSONField(default=dict)
    membership_source = models.CharField(max_length=20, default='UPLOAD', choices=MembershipSource.choices)  # UPLOAD, RULE, SEGMENT, MANUAL
    matched_by = models.CharField(max_length=20, null=True, blank=True, choices=MatchedBy.choices)  # LOYALTY_ID, EMAIL, PHONE, PARTY_ID — identity-resolution method at import
    import_id = models.UUIDField(null=True, blank=True)  # contact_list_import that created the row (no FK: partitioned high-volume table)
    added_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'contact_list_member'
        # real primary key is (id, tenant_id, contact_list_id); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.party_id)


class ContactListImport(models.Model):
    """An upload job: file, identity-resolution rules, match / unmatched / duplicate counts"""
    class Status(models.TextChoices):
        UPLOADED = 'UPLOADED', 'Uploaded'      # file stored, waiting to be read
        STAGING = 'STAGING', 'Staging'         # being read into contact_list_import_row
        STAGED = 'STAGED', 'Staged'            # read; waiting for the column mapping
        MATCHING = 'MATCHING', 'Matching'      # being checked against the mapping
        REVIEW = 'REVIEW', 'Review'            # checked; waiting for the operator
        APPLYING = 'APPLYING', 'Applying'      # being added to the list
        APPLIED = 'APPLIED', 'Applied'
        FAILED = 'FAILED', 'Failed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    contact_list = models.ForeignKey('contact_lists.ContactList', on_delete=models.PROTECT, db_column='contact_list_id', related_name='contact_list_imports')
    file_name = models.CharField(max_length=255)
    storage_key = models.CharField(max_length=500, null=True, blank=True)  # object-store key of the uploaded file (private prefix)
    status = models.CharField(max_length=20, default='UPLOADED', choices=Status.choices)  # UPLOADED, MATCHING, REVIEW, APPLIED, FAILED
    match_rules = models.JSONField(default=_default_contact_list_import_match_rules)  # identity-resolution order against customer_master
    row_count = models.IntegerField(default=0)
    matched_count = models.IntegerField(default=0)
    unmatched_count = models.IntegerField(default=0)
    duplicate_count = models.IntegerField(default=0)
    rejected_count = models.IntegerField(default=0)  # rows that cannot be imported (no usable email address, ...)
    warning_count = models.IntegerField(default=0)  # rows imported with a remark
    applied_count = models.IntegerField(default=0)  # members the import added to the list
    file_size = models.BigIntegerField(null=True, blank=True)
    file_columns = models.JSONField(default=list)  # [{name, samples, guess}] as read from the file
    column_mapping = models.JSONField(default=dict)  # {property: column name}
    error = models.CharField(max_length=500, null=True, blank=True)
    next_action = models.CharField(max_length=10, null=True, blank=True)  # what a worker should do next: STAGE, REVIEW, APPLY
    mapping_confirmed = models.BooleanField(default=False)  # confirmed by the operator, possibly while the file was still being read
    apply_when_ready = models.BooleanField(default=False)
    progress_done = models.BigIntegerField(default=0)
    progress_total = models.BigIntegerField(default=0)  # bytes while reading, rows afterwards
    queued_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    heartbeat_at = models.DateTimeField(null=True, blank=True)
    worker = models.CharField(max_length=120, null=True, blank=True)
    attempts = models.IntegerField(default=0)
    new_customer_count = models.IntegerField(default=0)
    consent_count = models.IntegerField(default=0)
    file_encoding = models.CharField(max_length=20, null=True, blank=True)
    file_delimiter = models.CharField(max_length=4, null=True, blank=True)
    summary = models.JSONField(default=dict)  # the reconciliation: rows = held back + ready; ready = governance buckets = added + already in the list
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'contact_list_import'

    def __str__(self):
        return str(self.file_name)


class ContactListImportRow(models.Model):
    """Staging row matched to a party_id before it can become a membership (tenant + monthly partitioned)"""
    class MatchStatus(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        MATCHED = 'MATCHED', 'Matched'
        UNMATCHED = 'UNMATCHED', 'Unmatched'
        DUPLICATE = 'DUPLICATE', 'Duplicate'
        REJECTED = 'REJECTED', 'Rejected'

    class MatchMethod(models.TextChoices):
        LOYALTY_ID = 'LOYALTY_ID', 'Loyalty ID'
        EMAIL = 'EMAIL', 'Email'
        PHONE = 'PHONE', 'Phone'
        PARTY_ID = 'PARTY_ID', 'Party ID'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    import_id = models.UUIDField()
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    row_number = models.IntegerField()
    raw = models.JSONField()  # the uploaded row as received
    matched_party_id = models.CharField(max_length=60, null=True, blank=True)
    match_status = models.CharField(max_length=20, default='PENDING', choices=MatchStatus.choices)  # PENDING, MATCHED, UNMATCHED, DUPLICATE, REJECTED
    match_method = models.CharField(max_length=20, null=True, blank=True, choices=MatchMethod.choices)  # LOYALTY_ID, EMAIL, PHONE, PARTY_ID
    error_message = models.CharField(max_length=300, null=True, blank=True)  # why the row is held back
    warning = models.CharField(max_length=300, null=True, blank=True)  # a remark on a row that is imported
    governance_status = models.CharField(max_length=30, null=True, blank=True)  # how a marketing email send would judge the contact today
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'contact_list_import_row'
        # real primary key is (id, tenant_id, created_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.pk)
