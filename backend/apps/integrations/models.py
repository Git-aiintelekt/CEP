"""integrations — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now
from django.contrib.postgres.fields import ArrayField


class DomainEvent(models.Model):
    """Transactional outbox: every business change writes an event in the same transaction; a relay publishes to the event stream (tenant + monthly partitioned)"""
    class AggregateType(models.TextChoices):
        TENANT = 'TENANT', 'Tenant'
        CAMPAIGN = 'CAMPAIGN', 'Campaign'
        CAMPAIGN_RUN = 'CAMPAIGN_RUN', 'Campaign Run'
        CONTACT_LIST = 'CONTACT_LIST', 'Contact List'
        TEMPLATE = 'TEMPLATE', 'Template'
        JOURNEY = 'JOURNEY', 'Journey'
        JOURNEY_ENROLLMENT = 'JOURNEY_ENROLLMENT', 'Journey Enrollment'
        CONSENT = 'CONSENT', 'Consent'
        CONTACT_POINT = 'CONTACT_POINT', 'Contact Point'
        MEDIA_ASSET = 'MEDIA_ASSET', 'Media Asset'

    class Producer(models.TextChoices):
        DJANGO = 'DJANGO', 'Django'
        INGEST = 'INGEST', 'Ingest'
        TRACKING = 'TRACKING', 'Tracking'
        SCORING = 'SCORING', 'Scoring'
        WORKER = 'WORKER', 'Worker'

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        PUBLISHED = 'PUBLISHED', 'Published'
        FAILED = 'FAILED', 'Failed'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    aggregate_type = models.CharField(max_length=40, choices=AggregateType.choices)  # CAMPAIGN, CAMPAIGN_RUN, JOURNEY, CONSENT, ...
    aggregate_id = models.CharField(max_length=60)  # UUID or party_id as text
    event_type = models.CharField(max_length=60)  # e.g. campaign.published, consent.opted_out, run.completed
    payload = models.JSONField(default=dict)
    producer = models.CharField(max_length=20, default='DJANGO', choices=Producer.choices)  # DJANGO, INGEST, TRACKING, SCORING, WORKER
    occurred_at = models.DateTimeField(db_default=Now())
    published_at = models.DateTimeField(null=True, blank=True)
    publish_attempts = models.IntegerField(default=0)
    status = models.CharField(max_length=10, default='PENDING', choices=Status.choices)  # PENDING, PUBLISHED, FAILED

    class Meta:
        managed = False
        db_table = 'domain_event'
        # real primary key is (id, tenant_id, occurred_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.event_type)


class WebhookSubscription(models.Model):
    """Outbound webhooks: which domain events go to which client HTTPS endpoint, HMAC-signed"""
    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        PAUSED = 'PAUSED', 'Paused'
        DISABLED = 'DISABLED', 'Disabled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    name = models.CharField(max_length=100)
    target_url = models.TextField()  # https only
    secret_ref = models.CharField(max_length=200)  # HMAC signing secret held in the vault
    event_types = ArrayField(models.TextField())  # domain_event.event_type patterns, e.g. campaign.*, consent.opted_out
    status = models.CharField(max_length=10, default='ACTIVE', choices=Status.choices)  # ACTIVE, PAUSED, DISABLED
    max_attempts = models.IntegerField(default=8)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'webhook_subscription'

    def __str__(self):
        return str(self.name)


class OutboundWebhookDelivery(models.Model):
    """Attempt log for outbound webhooks with retry schedule and dead-lettering (tenant + monthly partitioned)"""
    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        SUCCEEDED = 'SUCCEEDED', 'Succeeded'
        FAILED = 'FAILED', 'Failed'
        DEAD = 'DEAD', 'Dead'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    subscription_id = models.UUIDField()
    domain_event_id = models.BigIntegerField()
    event_type = models.CharField(max_length=60)
    attempt = models.IntegerField(default=1)
    status = models.CharField(max_length=10, default='PENDING', choices=Status.choices)  # PENDING, SUCCEEDED, FAILED, DEAD
    response_status = models.IntegerField(null=True, blank=True)
    response_excerpt = models.CharField(max_length=500, null=True, blank=True)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    attempted_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'outbound_webhook_delivery'
        # real primary key is (id, tenant_id, attempted_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.event_type)


# ---------------------------------------------------------------------------------------------- integration bridge (patch 0019)
class Integration(models.Model):
    """One record per external integration of a workspace: its throttle, retry, circuit-breaker and log policy, and its last call"""
    class Kind(models.TextChoices):
        POS_RECEIPTS = 'POS_RECEIPTS', 'POS receipts (inbound)'
        ORDERS = 'ORDERS', 'Orders for attribution (inbound)'
        PROVIDER = 'PROVIDER', 'Sending engine (outbound)'

    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        PAUSED = 'PAUSED', 'Paused'

    class LogLevel(models.TextChoices):
        FULL = 'FULL', 'Every call, with bodies'
        ERRORS = 'ERRORS', 'Every call; bodies only for failures'
        NONE = 'NONE', 'Nothing'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    kind = models.CharField(max_length=30, choices=Kind.choices)
    name = models.CharField(max_length=100)
    direction = models.CharField(max_length=3)  # IN, OUT
    system = models.CharField(max_length=30)  # POS, POSTAL, SENDGRID, SMTP, DIGIVIZE, SANDBOX_SMS
    status = models.CharField(max_length=10, default='ACTIVE', choices=Status.choices)
    environment = models.CharField(max_length=10, default='PRODUCTION')  # SANDBOX, PRODUCTION
    delivery_provider = models.ForeignKey('delivery.DeliveryProvider', on_delete=models.PROTECT, db_column='delivery_provider_id', related_name='+', null=True, blank=True)
    throttle_per_minute = models.IntegerField(null=True, blank=True)  # NULL = the plan's default (inbound) / the engine's own rate (outbound)
    throttle_burst = models.IntegerField(null=True, blank=True)
    retry_max_attempts = models.IntegerField(default=3)
    breaker_failures = models.IntegerField(default=5)
    breaker_cooldown_seconds = models.IntegerField(default=60)
    breaker_open_until = models.DateTimeField(null=True, blank=True)
    log_level = models.CharField(max_length=10, default='FULL', choices=LogLevel.choices)
    log_body_max_bytes = models.IntegerField(default=65536)
    log_retention_days = models.IntegerField(default=90)
    last_call_at = models.DateTimeField(null=True, blank=True)
    last_outcome = models.CharField(max_length=12, null=True, blank=True)
    last_error = models.CharField(max_length=500, null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'integration'

    def __str__(self):
        return f"{self.name} ({self.system})"


class IntegrationLog(models.Model):
    """One row per API call in either direction: what was sent, what came back, how long it took"""
    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, started_at)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    integration = models.ForeignKey('integrations.Integration', on_delete=models.DO_NOTHING, db_column='integration_id', related_name='+', null=True, blank=True, db_constraint=False)
    direction = models.CharField(max_length=3)
    kind = models.CharField(max_length=30)
    system = models.CharField(max_length=30)
    correlation_id = models.CharField(max_length=64)
    related_ref = models.CharField(max_length=200, null=True, blank=True)
    method = models.CharField(max_length=10)
    url = models.TextField()
    request_headers = models.JSONField(null=True, blank=True)
    request_body = models.TextField(null=True, blank=True)
    request_bytes = models.IntegerField(default=0)
    response_status = models.IntegerField(null=True, blank=True)
    response_headers = models.JSONField(null=True, blank=True)
    response_body = models.TextField(null=True, blank=True)
    response_bytes = models.IntegerField(default=0)
    outcome = models.CharField(max_length=12)  # OK, REJECTED, RETRY, ERROR, THROTTLED, BREAKER, PAUSED
    error_class = models.CharField(max_length=100, null=True, blank=True)
    error_message = models.CharField(max_length=500, null=True, blank=True)
    attempt = models.IntegerField(default=1)
    duration_ms = models.IntegerField(null=True, blank=True)
    api_client_id = models.UUIDField(null=True, blank=True)
    worker = models.CharField(max_length=200, null=True, blank=True)
    started_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'integration_log'

    def __str__(self):
        return f"{self.direction} {self.system} {self.method} {self.outcome}"


class IntegrationMetric(models.Model):
    """Per-minute figures per integration, rolled up from integration_log"""
    pk = models.CompositePrimaryKey('tenant_id', 'integration_id', 'bucket_start')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    integration = models.ForeignKey('integrations.Integration', on_delete=models.DO_NOTHING, db_column='integration_id', related_name='+', db_constraint=False)
    bucket_start = models.DateTimeField()
    calls = models.IntegerField(default=0)
    ok = models.IntegerField(default=0)
    rejected = models.IntegerField(default=0)
    retried = models.IntegerField(default=0)
    errors = models.IntegerField(default=0)
    throttled = models.IntegerField(default=0)
    duration_p50_ms = models.IntegerField(null=True, blank=True)
    duration_p95_ms = models.IntegerField(null=True, blank=True)
    duration_max_ms = models.IntegerField(null=True, blank=True)
    bytes_in = models.BigIntegerField(default=0)
    bytes_out = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'integration_metric'

    def __str__(self):
        return f"{self.integration_id} {self.bucket_start:%Y-%m-%d %H:%M}"
