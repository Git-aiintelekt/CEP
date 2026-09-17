"""governance — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now


class CommunicationGovernancePolicy(models.Model):
    """Cross-campaign / cross-journey frequency-cap rule"""
    class Scope(models.TextChoices):
        GLOBAL = 'GLOBAL', 'Global'
        CHANNEL = 'CHANNEL', 'Channel'
        CAMPAIGN_TYPE = 'CAMPAIGN_TYPE', 'Campaign Type'

    class AppliesTo(models.TextChoices):
        MARKETING = 'MARKETING', 'Marketing'
        ALL = 'ALL', 'All'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    name = models.CharField(max_length=200)
    scope = models.CharField(max_length=20, choices=Scope.choices)  # GLOBAL, CHANNEL, CAMPAIGN_TYPE
    channel = models.CharField(max_length=20, null=True, blank=True)  # EMAIL, SMS, MMS (null = ALL)
    max_messages = models.IntegerField()
    period_days = models.IntegerField()
    applies_to = models.CharField(max_length=20, default='MARKETING', choices=AppliesTo.choices)  # MARKETING, ALL
    priority = models.IntegerField(default=100)
    soft_bounce_threshold = models.IntegerField(null=True, blank=True)  # GLOBAL policy: soft bounces within the window that block a contact point (e.g. 3)
    soft_bounce_window_days = models.IntegerField(null=True, blank=True)  # e.g. 30
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(db_default=Now())
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'communication_governance_policy'

    def __str__(self):
        return str(self.name)


class GovernanceExemption(models.Model):
    """Exemption (transactional/e-receipt/VIP/override) from a governance policy"""
    class ExemptionType(models.TextChoices):
        TRANSACTIONAL = 'TRANSACTIONAL', 'Transactional'
        E_RECEIPT = 'E_RECEIPT', 'E Receipt'
        VIP = 'VIP', 'Vip'
        MANUAL_OVERRIDE = 'MANUAL_OVERRIDE', 'Manual Override'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    policy = models.ForeignKey('governance.CommunicationGovernancePolicy', on_delete=models.CASCADE, db_column='policy_id', related_name='governance_exemptions')
    exemption_type = models.CharField(max_length=30, choices=ExemptionType.choices)  # TRANSACTIONAL, E_RECEIPT, VIP, MANUAL_OVERRIDE
    criteria = models.JSONField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'governance_exemption'

    def __str__(self):
        return str(self.pk)


class ContactPointStatus(models.Model):
    """Health of one email address / phone number: bounces, complaints, block reason — shared by every campaign"""
    class ContactPointType(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        PHONE = 'PHONE', 'Phone'

    class BlockReason(models.TextChoices):
        HARD_BOUNCE = 'HARD_BOUNCE', 'Hard Bounce'
        SOFT_BOUNCE_THRESHOLD = 'SOFT_BOUNCE_THRESHOLD', 'Soft Bounce Threshold'
        COMPLAINT = 'COMPLAINT', 'Complaint'
        MANUAL = 'MANUAL', 'Manual'
        DND_REGISTRY = 'DND_REGISTRY', 'DND Registry'
        INVALID = 'INVALID', 'Invalid'
        GLOBAL_SUPPRESSION_LIST = 'GLOBAL_SUPPRESSION_LIST', 'Global Suppression List'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    contact_point_type = models.CharField(max_length=10, choices=ContactPointType.choices)  # EMAIL, PHONE
    contact_value = models.TextField()  # normalised address / E.164 number
    party_id = models.CharField(max_length=60, null=True, blank=True)  # NULL for registry / list-imported numbers with no known party
    is_valid = models.BooleanField(default=True)  # syntax / MX / carrier validation
    hard_bounce_count = models.IntegerField(default=0)
    soft_bounce_count = models.IntegerField(default=0)
    last_bounce_at = models.DateTimeField(null=True, blank=True)
    last_bounce_reason = models.CharField(max_length=200, null=True, blank=True)  # DSN status / provider reason
    complaint_count = models.IntegerField(default=0)
    last_complaint_at = models.DateTimeField(null=True, blank=True)
    blocked = models.BooleanField(default=False)
    block_reason = models.CharField(max_length=30, null=True, blank=True, choices=BlockReason.choices)  # HARD_BOUNCE, SOFT_BOUNCE_THRESHOLD, COMPLAINT, MANUAL, DND_REGISTRY, INVALID, GLOBAL_SUPPRESSION_LIST
    block_source = models.CharField(max_length=40, null=True, blank=True)  # POSTAL, DIGIVIZE, CSR, IMPORT, C360
    blocked_at = models.DateTimeField(null=True, blank=True)
    unblocked_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'contact_point_status'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'contact_point_type', 'contact_value'], name='ux_contact_point_status_tenant_id_contact_point_type_contact_value'),
        ]

    def __str__(self):
        return str(self.party_id)


class ConsentSuppression(models.Model):
    """Current consent per party per channel with stored MARKETABLE flag and reason"""
    class Channel(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        SMS = 'SMS', 'SMS'
        MMS = 'MMS', 'MMS'

    class ConsentStatus(models.TextChoices):
        OPTED_IN = 'OPTED_IN', 'Opted In'
        OPTED_OUT = 'OPTED_OUT', 'Opted Out'
        UNKNOWN = 'UNKNOWN', 'Unknown'

    class OptOutMethod(models.TextChoices):
        UNSUBSCRIBE_LINK = 'UNSUBSCRIBE_LINK', 'Unsubscribe Link'
        SMS_STOP = 'SMS_STOP', 'SMS Stop'
        PREFERENCE_CENTER = 'PREFERENCE_CENTER', 'Preference Center'
        CSR = 'CSR', 'CSR'
        IMPORT = 'IMPORT', 'Import'
        COMPLAINT = 'COMPLAINT', 'Complaint'

    class MarketableReason(models.TextChoices):
        NO_CONSENT = 'NO_CONSENT', 'No Consent'
        UNSUBSCRIBED = 'UNSUBSCRIBED', 'Unsubscribed'
        SMS_STOP = 'SMS_STOP', 'SMS Stop'
        HARD_BOUNCE = 'HARD_BOUNCE', 'Hard Bounce'
        SOFT_BOUNCE_THRESHOLD = 'SOFT_BOUNCE_THRESHOLD', 'Soft Bounce Threshold'
        COMPLAINT = 'COMPLAINT', 'Complaint'
        DND_REGISTRY = 'DND_REGISTRY', 'DND Registry'
        MANUAL_BLOCK = 'MANUAL_BLOCK', 'Manual Block'
        INVALID_ADDRESS = 'INVALID_ADDRESS', 'Invalid Address'
        GLOBAL_SUPPRESSION_LIST = 'GLOBAL_SUPPRESSION_LIST', 'Global Suppression List'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    party_id = models.CharField(max_length=60)
    channel = models.CharField(max_length=20, choices=Channel.choices)
    consent_status = models.CharField(max_length=20, default='UNKNOWN', choices=ConsentStatus.choices)  # OPTED_IN, OPTED_OUT, UNKNOWN
    opted_in_at = models.DateTimeField(null=True, blank=True)
    opted_out_at = models.DateTimeField(null=True, blank=True)
    opt_out_method = models.CharField(max_length=30, null=True, blank=True, choices=OptOutMethod.choices)  # UNSUBSCRIBE_LINK, SMS_STOP, PREFERENCE_CENTER, CSR, IMPORT, COMPLAINT
    suppressed = models.BooleanField(default=False)
    suppression_reason = models.CharField(max_length=200, null=True, blank=True)
    preferred_contact_point = models.ForeignKey('governance.ContactPointStatus', on_delete=models.PROTECT, db_column='preferred_contact_point_id', related_name='consent_suppressions', null=True, blank=True)
    marketable = models.BooleanField(default=False)  # consent OPTED_IN AND NOT suppressed AND preferred contact point NOT blocked
    marketable_reason = models.CharField(max_length=40, null=True, blank=True, choices=MarketableReason.choices)  # why not: NO_CONSENT, UNSUBSCRIBED, SMS_STOP, HARD_BOUNCE, SOFT_BOUNCE_THRESHOLD, COMPLAINT, DND_REGISTRY, MANUAL_BLOCK, INVALID_ADDRESS, GLOBAL_SUPPRESSION_LIST
    last_consent_record_id = models.BigIntegerField(null=True, blank=True)
    source_system = models.CharField(max_length=40, default='C360')
    updated_at = models.DateTimeField(db_default=Now())
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'consent_suppression'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'party_id', 'channel'], name='ux_consent_suppression_tenant_id_party_id_channel'),
        ]

    def __str__(self):
        return str(self.party_id)


class ConsentRecord(models.Model):
    """Append-only opt-in / opt-out proof with source and evidence (tenant + monthly partitioned, kept indefinitely)"""
    class Channel(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        SMS = 'SMS', 'SMS'
        MMS = 'MMS', 'MMS'

    class Action(models.TextChoices):
        OPT_IN = 'OPT_IN', 'Opt In'
        DOUBLE_OPT_IN_CONFIRMED = 'DOUBLE_OPT_IN_CONFIRMED', 'Double Opt In Confirmed'
        OPT_OUT = 'OPT_OUT', 'Opt Out'
        RESUBSCRIBE = 'RESUBSCRIBE', 'Resubscribe'

    class Source(models.TextChoices):
        WEB_FORM = 'WEB_FORM', 'Web Form'
        POS = 'POS', 'POS'
        IMPORT = 'IMPORT', 'Import'
        UNSUBSCRIBE_LINK = 'UNSUBSCRIBE_LINK', 'Unsubscribe Link'
        SMS_STOP = 'SMS_STOP', 'SMS Stop'
        PREFERENCE_CENTER = 'PREFERENCE_CENTER', 'Preference Center'
        CSR = 'CSR', 'CSR'
        C360_SYNC = 'C360_SYNC', 'C360 Sync'
        COMPLAINT = 'COMPLAINT', 'Complaint'
        LEGAL = 'LEGAL', 'Legal'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    party_id = models.CharField(max_length=60)
    channel = models.CharField(max_length=20, choices=Channel.choices)  # EMAIL, SMS, MMS
    action = models.CharField(max_length=30, choices=Action.choices)  # OPT_IN, DOUBLE_OPT_IN_CONFIRMED, OPT_OUT, RESUBSCRIBE
    source = models.CharField(max_length=30, choices=Source.choices)  # WEB_FORM, POS, IMPORT, UNSUBSCRIBE_LINK, SMS_STOP, PREFERENCE_CENTER, CSR, C360_SYNC, COMPLAINT, LEGAL
    evidence = models.JSONField(default=dict)  # ip, user agent, form id, verification code, provider event id
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.DO_NOTHING, db_column='campaign_id', related_name='consent_records', db_constraint=False, null=True, blank=True)
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.DO_NOTHING, db_column='campaign_run_id', related_name='consent_records', db_constraint=False, null=True, blank=True)
    mailer_execution_id = models.BigIntegerField(null=True, blank=True)  # the message whose link / reply carried the action
    sms_execution_id = models.BigIntegerField(null=True, blank=True)
    contact_list = models.ForeignKey('contact_lists.ContactList', on_delete=models.DO_NOTHING, db_column='contact_list_id', related_name='consent_records', db_constraint=False, null=True, blank=True)  # reserved: per-list preference
    occurred_at = models.DateTimeField()
    recorded_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'consent_record'
        # real primary key is (id, tenant_id, occurred_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.party_id)


class GovernanceEvaluationLog(models.Model):
    """Audit log of every governance allow/suppress decision (range-partitioned)"""
    class Decision(models.TextChoices):
        ALLOW = 'ALLOW', 'Allow'
        SUPPRESS = 'SUPPRESS', 'Suppress'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    party_id = models.CharField(max_length=60)
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.DO_NOTHING, db_column='campaign_id', related_name='governance_evaluation_logs', db_constraint=False)
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.DO_NOTHING, db_column='campaign_run_id', related_name='governance_evaluation_logs', db_constraint=False, null=True, blank=True)
    journey = models.ForeignKey('journeys.Journey', on_delete=models.DO_NOTHING, db_column='journey_id', related_name='governance_evaluation_logs', db_constraint=False, null=True, blank=True)
    channel = models.CharField(max_length=20)
    policy_id = models.UUIDField(null=True, blank=True)
    decision = models.CharField(max_length=10, choices=Decision.choices)  # ALLOW, SUPPRESS
    reason = models.CharField(max_length=200, null=True, blank=True)
    evaluated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'governance_evaluation_log'
        # real primary key is (id, tenant_id, evaluated_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.party_id)
