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
