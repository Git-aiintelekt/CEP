"""campaigns — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now
from django.contrib.postgres.fields import ArrayField


def _default_campaign_list_member_segment_codes():
    return []


class Campaign(models.Model):
    """Universal outbound communication execution container"""
    class CampaignType(models.TextChoices):
        REGULAR_MARKETING = 'REGULAR_MARKETING', 'Regular Marketing'
        E_RECEIPT = 'E_RECEIPT', 'E Receipt'
        DRIP = 'DRIP', 'Drip'
        JOURNEY = 'JOURNEY', 'Journey'
        OTHER = 'OTHER', 'Other'

    class Channel(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        SMS = 'SMS', 'SMS'
        MMS = 'MMS', 'MMS'
        MULTI = 'MULTI', 'Multi'

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        TEST_PUBLISHED = 'TEST_PUBLISHED', 'Test Published'
        PRODUCTION_PUBLISHED = 'PRODUCTION_PUBLISHED', 'Production Published'
        ACTIVE = 'ACTIVE', 'Active'
        PAUSED = 'PAUSED', 'Paused'
        COMPLETED = 'COMPLETED', 'Completed'
        CANCELLED = 'CANCELLED', 'Cancelled'
        ARCHIVED = 'ARCHIVED', 'Archived'

    class SendType(models.TextChoices):
        IMMEDIATE = 'IMMEDIATE', 'Send immediately'
        SCHEDULED = 'SCHEDULED', 'Schedule for later'
        RECURRING = 'RECURRING', 'Recurring'
        DRIP = 'DRIP', 'Drip series'

    class SolicitationType(models.TextChoices):
        MARKETING = 'MARKETING', 'Marketing'
        TRANSACTIONAL = 'TRANSACTIONAL', 'Transactional'
        SERVICE = 'SERVICE', 'Service'
        LEGAL = 'LEGAL', 'Legal'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    legacy_marketing_campaign_id = models.CharField(max_length=60, null=True, blank=True, unique=True)  # iCRM marketing_campaign.MARKETING_CAMPAIGN_ID, where reconciling against pre-CEP campaign history
    name = models.CharField(max_length=200)
    campaign_type = models.CharField(max_length=20, choices=CampaignType.choices)  # REGULAR_MARKETING, E_RECEIPT, DRIP, JOURNEY, OTHER
    channel = models.CharField(max_length=20, choices=Channel.choices)  # EMAIL, SMS, MMS, MULTI
    status = models.CharField(max_length=30, default='DRAFT', choices=Status.choices)  # DRAFT, TEST_PUBLISHED, PRODUCTION_PUBLISHED, ACTIVE, COMPLETED, CANCELLED
    solicitation_type = models.CharField(max_length=20, default='MARKETING', choices=SolicitationType.choices)  # MARKETING (consent + caps + unsubscribe), TRANSACTIONAL (valid contact point only, cap-exempt), SERVICE, LEGAL (iCRM DND_REQUIRED)
    template = models.ForeignKey('templates.TemplateMaster', on_delete=models.PROTECT, db_column='template_id', related_name='campaigns', null=True, blank=True)
    origin_journey = models.ForeignKey('journeys.Journey', on_delete=models.PROTECT, db_column='origin_journey_id', related_name='campaigns', null=True, blank=True)  # FK added after journey table exists (below)
    is_journey_generated = models.BooleanField(default=False)  # journey-generated campaigns are not manually edited (BRD 7.3)
    owner_user = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='owner_user_id', related_name='+', null=True, blank=True)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    description = models.TextField(null=True, blank=True)  # iCRM CAMPAIGN_SUMMARY
    code = models.CharField(max_length=40)  # human-readable business key, e.g. CMP-2026-00042 (iCRM CAMPAIGN_CODE); used in reporting and attribution
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)
    sender_profile = models.ForeignKey('delivery.SenderProfile', on_delete=models.PROTECT, db_column='sender_profile_id', related_name='campaigns', null=True, blank=True)
    previous_status = models.CharField(max_length=30, null=True, blank=True)  # where resume goes back to
    tags = models.JSONField(default=list)
    send_type = models.CharField(max_length=20, default='IMMEDIATE', choices=SendType.choices)
    send_timezone = models.CharField(max_length=64, null=True, blank=True)  # the zone the schedule was entered in; NULL = the workspace's
    recurring_config = models.JSONField(null=True, blank=True)  # {frequency, interval, weekdays[], day_of_month, time, end_date, max_runs}
    drip_config = models.JSONField(null=True, blank=True)  # {steps: [{day}], time}
    respect_governance = models.BooleanField(default=True)
    rate_limit_per_hour = models.IntegerField(null=True, blank=True)
    timezone_optimization = models.BooleanField(default=False)
    receipt_config = models.JSONField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    setup_step = models.SmallIntegerField(default=6)  # setup steps completed, 0-6; 6 = everything but the publish
    approval_status = models.CharField(max_length=20, null=True, blank=True)  # NULL none, REQUESTED, APPROVED, RETURNED (patch 0022)
    approval_requested_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='approval_requested_by', related_name='+', null=True, blank=True)
    approval_requested_at = models.DateTimeField(null=True, blank=True)
    approval_note = models.TextField(null=True, blank=True)
    approval_decided_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='approval_decided_by', related_name='+', null=True, blank=True)
    approval_decided_at = models.DateTimeField(null=True, blank=True)
    approval_decision_note = models.TextField(null=True, blank=True)
    ab_config = models.JSONField(null=True, blank=True)  # {enabled, subject_b, sample_pct, metric, decide_after_minutes} (patch 0023)

    class Meta:
        managed = False
        db_table = 'campaign'

    def __str__(self):
        return str(self.name)


class CampaignRun(models.Model):
    """Discrete execution/batch beneath a Campaign"""
    class RunType(models.TextChoices):
        ONE_TIME = 'ONE_TIME', 'One Time'
        RECURRING_INSTANCE = 'RECURRING_INSTANCE', 'Recurring Instance'
        DRIP_INSTANCE = 'DRIP_INSTANCE', 'Drip Instance'
        JOURNEY_INSTANCE = 'JOURNEY_INSTANCE', 'Journey Instance'
        ERECEIPT_INSTANCE = 'ERECEIPT_INSTANCE', 'Ereceipt Instance'

    class Status(models.TextChoices):
        SCHEDULED = 'SCHEDULED', 'Scheduled'
        PREPARING = 'PREPARING', 'Preparing'
        SENDING = 'SENDING', 'Sending'
        PAUSED = 'PAUSED', 'Paused'
        COMPLETED = 'COMPLETED', 'Completed'
        FAILED = 'FAILED', 'Failed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.CASCADE, db_column='campaign_id', related_name='campaign_runs')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    run_number = models.IntegerField()
    run_type = models.CharField(max_length=30, choices=RunType.choices)  # ONE_TIME, RECURRING_INSTANCE, DRIP_INSTANCE, JOURNEY_INSTANCE, ERECEIPT_INSTANCE
    status = models.CharField(max_length=30, default='SCHEDULED', choices=Status.choices)  # SCHEDULED, PREPARING, SENDING, COMPLETED, FAILED, CANCELLED
    test_mode = models.BooleanField(default=False)
    sequence_label = models.CharField(max_length=60, null=True, blank=True)  # "Day 3", "Occurrence 2"
    ab_decide_at = models.DateTimeField(null=True, blank=True)  # when the subject-line winner is chosen; NULL = no test (patch 0023)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'campaign_run'
        constraints = [
            models.UniqueConstraint(fields=['campaign_id', 'run_number'], name='ux_campaign_run_campaign_id_run_number'),
        ]

    def __str__(self):
        return str(self.pk)


class CampaignRunVariant(models.Model):
    """Phase II subject-line/content variant — unused by MVP send logic"""
    class WinnerMetric(models.TextChoices):
        OPEN_RATE = 'OPEN_RATE', 'Open Rate'
        CLICK_RATE = 'CLICK_RATE', 'Click Rate'
        CONVERSION_RATE = 'CONVERSION_RATE', 'Conversion Rate'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.CASCADE, db_column='campaign_run_id', related_name='campaign_run_variants')
    variant_key = models.CharField(max_length=20, default='A')
    subject_line = models.CharField(max_length=300, null=True, blank=True)
    allocation_pct = models.DecimalField(max_digits=5, decimal_places=2, default=100.00)
    is_winner = models.BooleanField(null=True, blank=True)
    winner_metric = models.CharField(max_length=30, null=True, blank=True, choices=WinnerMetric.choices)  # OPEN_RATE, CLICK_RATE, CONVERSION_RATE
    metric_value = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'campaign_run_variant'
        constraints = [
            models.UniqueConstraint(fields=['campaign_run_id', 'variant_key'], name='ux_campaign_run_variant_campaign_run_id_variant_key'),
        ]

    def __str__(self):
        return str(self.pk)


class ContactListCampaign(models.Model):
    """Attaches one or more Contact Lists to a Campaign"""
    pk = models.CompositePrimaryKey('campaign_id', 'contact_list_id')
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.CASCADE, db_column='campaign_id', related_name='contact_list_campaigns')
    contact_list = models.ForeignKey('contact_lists.ContactList', on_delete=models.PROTECT, db_column='contact_list_id', related_name='contact_list_campaigns')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    attached_at = models.DateTimeField(db_default=Now())
    created_at = models.DateTimeField(db_default=Now())
    role = models.CharField(max_length=10, default='INCLUDE')  # INCLUDE its people, or EXCLUDE them from this campaign

    class Meta:
        managed = False
        db_table = 'contact_list_campaign'

    def __str__(self):
        return str(self.pk)


class CampaignList(models.Model):
    """Denormalized campaign-specific population, merged/de-duplicated"""
    class Status(models.TextChoices):
        BUILDING = 'BUILDING', 'Building'
        FROZEN = 'FROZEN', 'Frozen'
        FAILED = 'FAILED', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    legacy_campaign_list_id = models.CharField(max_length=60, null=True, blank=True)  # iCRM marketing_campaign_contact_list.CAMPAIGN_LIST_ID
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.CASCADE, db_column='campaign_id', related_name='campaign_lists')
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.PROTECT, db_column='campaign_run_id', related_name='campaign_lists', null=True, blank=True)  # set when a Journey/drip generates a fresh list per run
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    status = models.CharField(max_length=20, default='BUILDING', choices=Status.choices)  # BUILDING, FROZEN, FAILED
    dedup_strategy = models.CharField(max_length=30, default='PARTY_ID_LAST_WINS')
    member_count = models.IntegerField(default=0)
    generated_at = models.DateTimeField(db_default=Now())
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'campaign_list'

    def __str__(self):
        return str(self.pk)


class CampaignListMember(models.Model):
    """Party-level campaign execution population record (range-partitioned)"""
    class Status(models.TextChoices):
        ELIGIBLE = 'ELIGIBLE', 'Eligible'
        SUPPRESSED = 'SUPPRESSED', 'Suppressed'
        SENT = 'SENT', 'Sent'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    campaign_list = models.ForeignKey('campaigns.CampaignList', on_delete=models.DO_NOTHING, db_column='campaign_list_id', related_name='campaign_list_members', db_constraint=False)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    party_id = models.CharField(max_length=60)
    source_contact_list = models.ForeignKey('contact_lists.ContactList', on_delete=models.PROTECT, db_column='source_contact_list_id', related_name='campaign_list_members', null=True, blank=True)
    custom_value_pairs = models.JSONField(default=dict)  # campaign-time extensible attributes (BRD 6.3)
    segment_codes = ArrayField(models.TextField(), default=_default_campaign_list_member_segment_codes)
    status = models.CharField(max_length=20, default='ELIGIBLE', choices=Status.choices)  # ELIGIBLE, SUPPRESSED, SENT
    suppression_reason = models.CharField(max_length=40, null=True, blank=True)  # NO_EMAIL, NO_CONSENT, UNSUBSCRIBED, BLOCKED_ADDRESS, FREQUENCY_CAP ...
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'campaign_list_member'
        # real primary key is (id, tenant_id, created_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.party_id)


class CampaignTarget(models.Model):
    """Planned revenue / engagement / cost targets for a Campaign"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.CASCADE, db_column='campaign_id', related_name='campaign_targets')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    target_revenue = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    target_opens = models.IntegerField(null=True, blank=True)
    target_clicks = models.IntegerField(null=True, blank=True)
    target_conversions = models.IntegerField(null=True, blank=True)
    target_redemptions = models.IntegerField(null=True, blank=True)
    planned_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    planned_offer_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)  # offer / coupon / incentive cost (BRD 15)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'campaign_target'

    def __str__(self):
        return str(self.pk)


class CampaignActual(models.Model):
    """Actual cost, attributed revenue, ROI/contribution for a Campaign"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.CASCADE, db_column='campaign_id', related_name='campaign_actuals')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    actual_delivery_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    offer_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    attributed_revenue = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    attributed_orders = models.IntegerField(null=True, blank=True)
    attributed_conversions = models.IntegerField(null=True, blank=True)
    campaign_contribution = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)  # attributed_revenue - (delivery_cost + offer_cost); NOT accounting profit
    campaign_roi = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    revenue_per_delivered = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    cost_per_conversion = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    computed_at = models.DateTimeField(db_default=Now())
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'campaign_actual'

    def __str__(self):
        return str(self.pk)


class CampaignActivityLog(models.Model):
    """What happened to a campaign, in words (created, published, send started, paused ...)"""

    id = models.BigAutoField(primary_key=True)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.CASCADE, db_column='campaign_id', related_name='activity')
    campaign_run_id = models.UUIDField(null=True, blank=True)
    event_type = models.CharField(max_length=30)
    severity = models.CharField(max_length=10, default='INFO')
    message = models.CharField(max_length=500)
    detail = models.JSONField(default=dict)
    actor_user_id = models.UUIDField(null=True, blank=True)
    actor_name = models.CharField(max_length=200, null=True, blank=True)
    occurred_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'campaign_activity_log'
        ordering = ['-occurred_at', '-id']

    def __str__(self):
        return str(self.message)

