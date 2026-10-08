"""journeys — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now


class Journey(models.Model):
    """Independent orchestration definition — not a child of Campaign"""
    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        TEST = 'TEST', 'Test'
        APPROVED = 'APPROVED', 'Approved'          # passed Test Publish and approved; live now (scheduled_activate_at null) or at that time (6i)
        ACTIVE = 'ACTIVE', 'Active'
        PAUSED = 'PAUSED', 'Paused'
        ARCHIVED = 'ARCHIVED', 'Archived'

    class PopulationMode(models.TextChoices):
        FIXED = 'FIXED', 'Fixed'
        CONTINUOUSLY_QUALIFYING = 'CONTINUOUSLY_QUALIFYING', 'Continuously Qualifying'
        EVENT_TRIGGERED = 'EVENT_TRIGGERED', 'Event Triggered'

    class ReentryPolicy(models.TextChoices):
        NEVER = 'NEVER', 'Never'
        AFTER_X_DAYS = 'AFTER_X_DAYS', 'After X Days'
        EVERY_QUALIFYING_EVENT = 'EVERY_QUALIFYING_EVENT', 'Every Qualifying Event'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    name = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=20, default='DRAFT', choices=Status.choices)  # DRAFT, TEST, ACTIVE, PAUSED, ARCHIVED
    population_mode = models.CharField(max_length=30, choices=PopulationMode.choices)  # FIXED, CONTINUOUSLY_QUALIFYING, EVENT_TRIGGERED
    reentry_policy = models.CharField(max_length=30, default='NEVER', choices=ReentryPolicy.choices)  # NEVER, AFTER_X_DAYS, EVERY_QUALIFYING_EVENT
    reentry_after_days = models.IntegerField(null=True, blank=True)
    owner_user = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='owner_user_id', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    code = models.CharField(max_length=40)  # human-readable business key, e.g. JRN-2026-00007
    current_version = models.ForeignKey('journeys.JourneyVersion', on_delete=models.PROTECT, db_column='current_version_id', related_name='journeys', null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)
    scheduled_activate_at = models.DateTimeField(null=True, blank=True)  # set with status=APPROVED: when run_scheduler's activate-scheduled-journeys job goes live
    goal_description = models.TextField(null=True, blank=True)  # free text, e.g. "First purchase in 30 days" (phase 6d; patch 0037). Full editing arrives with the Setup modal (6e); for now set from Journey Details.
    exit_criteria_description = models.TextField(null=True, blank=True)  # free text, e.g. "Goal met · unsubscribe · 45 days" (phase 6d; patch 0037)
    source_template = models.ForeignKey('journeys.JourneyTemplate', on_delete=models.PROTECT, db_column='source_template_id', related_name='journeys_created', null=True, blank=True)  # the saved template it was made from (patch 0036)
    source_starter_key = models.CharField(max_length=60, null=True, blank=True)  # the CEP starter it was made from (apps/journeys/starters.py; patch 0036)

    class Meta:
        managed = False
        db_table = 'journey'

    def __str__(self):
        return str(self.name)


class JourneyTemplate(models.Model):
    """A workspace's saved journey template: one version's graph, its journey's setup and goal (patch 0036)"""
    class Category(models.TextChoices):
        LIFECYCLE = 'LIFECYCLE', 'Lifecycle'
        COMMERCE = 'COMMERCE', 'Commerce'
        LOYALTY = 'LOYALTY', 'Loyalty'
        ENGAGEMENT = 'ENGAGEMENT', 'Engagement'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    name = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    category = models.CharField(max_length=20, choices=Category.choices)
    population_mode = models.CharField(max_length=30, choices=Journey.PopulationMode.choices)
    reentry_policy = models.CharField(max_length=30, default='NEVER', choices=Journey.ReentryPolicy.choices)
    reentry_after_days = models.IntegerField(null=True, blank=True)
    goal_description = models.TextField(null=True, blank=True)
    graph = models.JSONField()  # {entry_rules, nodes, connections}: apps/journeys/graph.py's wire format
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'journey_template'

    def __str__(self):
        return str(self.name)


class JourneyVersion(models.Model):
    """Versioned Journey configuration snapshot"""
    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        TEST_PUBLISHED = 'TEST_PUBLISHED', 'Test Published'
        ACTIVE = 'ACTIVE', 'Active'
        RETIRED = 'RETIRED', 'Retired'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    journey = models.ForeignKey('journeys.Journey', on_delete=models.CASCADE, db_column='journey_id', related_name='journey_versions')
    version_number = models.IntegerField()
    status = models.CharField(max_length=20, default='DRAFT', choices=Status.choices)  # DRAFT, TEST_PUBLISHED, ACTIVE, RETIRED
    definition_snapshot = models.JSONField(null=True, blank=True)  # full node/connection graph snapshot at publish time
    published_at = models.DateTimeField(null=True, blank=True)
    population_frozen_at = models.DateTimeField(null=True, blank=True)  # Fixed population: nobody enters this version after it (patch 0038)
    last_fired_at = models.DateTimeField(null=True, blank=True)  # Date / Time entry: the schedule moment that last fired (patch 0038)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'journey_version'
        constraints = [
            models.UniqueConstraint(fields=['journey_id', 'version_number'], name='ux_journey_version_journey_id_version_number'),
        ]

    def __str__(self):
        return str(self.pk)


class JourneyEntryRule(models.Model):
    """Entry/population criteria for a Journey version"""
    class EntryType(models.TextChoices):
        CUSTOMER_LIST = 'CUSTOMER_LIST', 'Customer List'
        EVENT = 'EVENT', 'Event'
        DATE_TIME = 'DATE_TIME', 'Date Time'
        SEGMENT_CHANGE = 'SEGMENT_CHANGE', 'Segment Change'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    journey_version = models.ForeignKey('journeys.JourneyVersion', on_delete=models.CASCADE, db_column='journey_version_id', related_name='journey_entry_rules')
    entry_type = models.CharField(max_length=30, choices=EntryType.choices)  # CUSTOMER_LIST, EVENT, DATE_TIME, SEGMENT_CHANGE
    rule_definition = models.JSONField()
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'journey_entry_rule'

    def __str__(self):
        return str(self.pk)


class JourneyNode(models.Model):
    """Entry / logic / communication / action / control node in a Journey graph"""
    class NodeFamily(models.TextChoices):
        ENTRY = 'ENTRY', 'Entry'
        LOGIC = 'LOGIC', 'Logic'
        COMMUNICATION = 'COMMUNICATION', 'Communication'
        ACTION = 'ACTION', 'Action'
        CONTROL = 'CONTROL', 'Control'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    journey_version = models.ForeignKey('journeys.JourneyVersion', on_delete=models.CASCADE, db_column='journey_version_id', related_name='journey_nodes')
    node_key = models.CharField(max_length=100)  # stable key within the version's graph
    node_family = models.CharField(max_length=20, choices=NodeFamily.choices)  # ENTRY, LOGIC, COMMUNICATION, ACTION, CONTROL
    node_type = models.CharField(max_length=40)  # CONDITION, WAIT, SPLIT, EMAIL, SMS, COUPON_ISSUE, LOYALTY_CHANGE, SEGMENT_UPDATE, EXIT, ...
    config = models.JSONField(default=dict)  # wait duration, condition expr, template_id, action params...
    canvas_position = models.JSONField(null=True, blank=True)  # {x,y} for builder UI
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'journey_node'
        constraints = [
            models.UniqueConstraint(fields=['journey_version_id', 'node_key'], name='ux_journey_node_journey_version_id_node_key'),
        ]

    def __str__(self):
        return str(self.pk)


class JourneyConnection(models.Model):
    """Path/edge between two Journey nodes"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    journey_version = models.ForeignKey('journeys.JourneyVersion', on_delete=models.CASCADE, db_column='journey_version_id', related_name='journey_connections')
    from_node = models.ForeignKey('journeys.JourneyNode', on_delete=models.CASCADE, db_column='from_node_id', related_name='journey_connections_from_node')
    to_node = models.ForeignKey('journeys.JourneyNode', on_delete=models.CASCADE, db_column='to_node_id', related_name='journey_connections_to_node')
    branch_key = models.CharField(max_length=50, null=True, blank=True)  # e.g. 'YES' / 'NO' / 'A' / 'B'
    condition_label = models.CharField(max_length=200, null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'journey_connection'

    def __str__(self):
        return str(self.pk)


class JourneyEnrollment(models.Model):
    """Party participation instance in a Journey"""
    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        EXITED = 'EXITED', 'Exited'
        COMPLETED = 'COMPLETED', 'Completed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    journey = models.ForeignKey('journeys.Journey', on_delete=models.PROTECT, db_column='journey_id', related_name='journey_enrollments')
    journey_version = models.ForeignKey('journeys.JourneyVersion', on_delete=models.PROTECT, db_column='journey_version_id', related_name='journey_enrollments')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    party_id = models.CharField(max_length=60)
    status = models.CharField(max_length=20, default='ACTIVE', choices=Status.choices)  # ACTIVE, EXITED, COMPLETED
    enrolled_at = models.DateTimeField(db_default=Now())
    exited_at = models.DateTimeField(null=True, blank=True)
    converted_at = models.DateTimeField(null=True, blank=True)        # the Goal step (apps.journeys.goals): the first matching event's moment
    converted_node_id = models.UUIDField(null=True, blank=True)       # the Goal step reached
    attributed_revenue = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    exit_reason = models.CharField(max_length=100, null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'journey_enrollment'

    def __str__(self):
        return str(self.party_id)


class JourneySuppression(models.Model):
    """A customer one journey must never enter or message (apps.journeys.suppressions); patch 0046."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    journey = models.ForeignKey('journeys.Journey', on_delete=models.CASCADE, db_column='journey_id', related_name='suppressions')
    party_id = models.CharField(max_length=60)
    given = models.CharField(max_length=200, null=True, blank=True)
    note = models.CharField(max_length=200, null=True, blank=True)
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'journey_suppression'


class JourneyCustomerState(models.Model):
    """Current node/status for an active enrollment"""
    journey_enrollment = models.OneToOneField('journeys.JourneyEnrollment', on_delete=models.CASCADE, db_column='journey_enrollment_id', related_name='journey_customer_states', primary_key=True)
    current_node = models.ForeignKey('journeys.JourneyNode', on_delete=models.PROTECT, db_column='current_node_id', related_name='journey_customer_states', null=True, blank=True)
    entered_node_at = models.DateTimeField(null=True, blank=True)
    next_scheduled_at = models.DateTimeField(null=True, blank=True)  # drives the "due transitions" poller (no open worker waits)
    state_data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(db_default=Now())
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'journey_customer_state'

    def __str__(self):
        return str(self.pk)


class JourneyNodeExecution(models.Model):
    """Execution result/history per node per party (range-partitioned)"""
    class ExecutionStatus(models.TextChoices):
        SUCCESS = 'SUCCESS', 'Success'
        FAILED = 'FAILED', 'Failed'
        SKIPPED = 'SKIPPED', 'Skipped'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    journey_enrollment = models.ForeignKey('journeys.JourneyEnrollment', on_delete=models.DO_NOTHING, db_column='journey_enrollment_id', related_name='journey_node_executions', db_constraint=False)
    journey_node = models.ForeignKey('journeys.JourneyNode', on_delete=models.DO_NOTHING, db_column='journey_node_id', related_name='journey_node_executions', db_constraint=False)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    party_id = models.CharField(max_length=60)
    execution_status = models.CharField(max_length=20, choices=ExecutionStatus.choices)  # SUCCESS, FAILED, SKIPPED
    result_data = models.JSONField(null=True, blank=True)
    generated_campaign_run_id = models.UUIDField(null=True, blank=True)  # set on COMMUNICATION nodes that generated a run
    executed_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'journey_node_execution'
        # real primary key is (id, tenant_id, executed_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.party_id)


class JourneyEvent(models.Model):
    """Inbound trigger event feed: purchase, cart abandon, engagement, etc. (range-partitioned)"""
    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    party_id = models.CharField(max_length=60)
    event_type = models.CharField(max_length=60)  # PURCHASE, CATEGORY_PURCHASE, CART_ABANDON, COUPON_ISSUED, COUPON_REDEEMED, EMAIL_OPEN, EMAIL_CLICK, SMS_RESPONSE, SEGMENT_CHANGE, LOYALTY_TIER_CHANGE, ...
    event_source = models.CharField(max_length=40)  # C360, POSTAL, DIGIVIZE, COMMERCE, LOYALTY
    event_payload = models.JSONField(default=dict)
    occurred_at = models.DateTimeField()
    ingested_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'journey_event'
        # real primary key is (id, tenant_id, occurred_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.event_type)


class JourneyGeneratedCampaign(models.Model):
    """Links a Journey node's execution window to a generated Campaign"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    journey = models.ForeignKey('journeys.Journey', on_delete=models.PROTECT, db_column='journey_id', related_name='journey_generated_campaigns')
    journey_node = models.ForeignKey('journeys.JourneyNode', on_delete=models.PROTECT, db_column='journey_node_id', related_name='journey_generated_campaigns')
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.PROTECT, db_column='campaign_id', related_name='journey_generated_campaigns')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    generation_date = models.DateField()  # supports the daily-aggregation default window
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'journey_generated_campaign'
        constraints = [
            models.UniqueConstraint(fields=['journey_node_id', 'generation_date'], name='ux_journey_generated_campaign_journey_node_id_generation_date'),
        ]

    def __str__(self):
        return str(self.pk)


class JourneyGeneratedCampaignRun(models.Model):
    """Links a generated Campaign to its Campaign Run and execution window"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    journey_generated_campaign = models.ForeignKey('journeys.JourneyGeneratedCampaign', on_delete=models.CASCADE, db_column='journey_generated_campaign_id', related_name='journey_generated_campaign_runs')
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.PROTECT, db_column='campaign_run_id', related_name='journey_generated_campaign_runs')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    execution_window_start = models.DateTimeField()
    execution_window_end = models.DateTimeField()
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'journey_generated_campaign_run'

    def __str__(self):
        return str(self.pk)
