"""tracking — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now


class TrackingLink(models.Model):
    """Trackable links in a template; the click-redirect endpoint resolves a short token to the target URL"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    template = models.ForeignKey('templates.TemplateMaster', on_delete=models.PROTECT, db_column='template_id', related_name='tracking_links', null=True, blank=True)
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.PROTECT, db_column='campaign_id', related_name='tracking_links', null=True, blank=True)
    token = models.CharField(max_length=24)  # short, unguessable path segment
    target_url = models.TextField()
    link_label = models.CharField(max_length=150, null=True, blank=True)  # for click-ranking reports
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'tracking_link'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'token'], name='ux_tracking_link_tenant_id_token'),
        ]

    def __str__(self):
        return str(self.pk)


class TrackingEvent(models.Model):
    """First-party engagement captured by the FastAPI tracking service — open pixel, click, unsubscribe click, web/purchase (tenant + monthly partitioned)"""
    class EventType(models.TextChoices):
        OPEN = 'OPEN', 'Open'
        CLICK = 'CLICK', 'Click'
        UNSUBSCRIBE_CLICK = 'UNSUBSCRIBE_CLICK', 'Unsubscribe Click'
        PREFERENCE_VIEW = 'PREFERENCE_VIEW', 'Preference View'
        PAGE_VIEW = 'PAGE_VIEW', 'Page View'
        PURCHASE = 'PURCHASE', 'Purchase'
        CUSTOM = 'CUSTOM', 'Custom'

    class Channel(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        SMS = 'SMS', 'SMS'
        MMS = 'MMS', 'MMS'
        WEB = 'WEB', 'Web'

    class ProcessingStatus(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        PROCESSED = 'PROCESSED', 'Processed'
        FAILED = 'FAILED', 'Failed'
        IGNORED = 'IGNORED', 'Ignored'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    party_id = models.CharField(max_length=60, null=True, blank=True)
    event_type = models.CharField(max_length=30, choices=EventType.choices)  # OPEN, CLICK, UNSUBSCRIBE_CLICK, PREFERENCE_VIEW, PAGE_VIEW, PURCHASE, CUSTOM
    channel = models.CharField(max_length=20, default='EMAIL', choices=Channel.choices)  # EMAIL, SMS, MMS, WEB
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.DO_NOTHING, db_column='campaign_id', related_name='tracking_events', db_constraint=False, null=True, blank=True)
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.DO_NOTHING, db_column='campaign_run_id', related_name='tracking_events', db_constraint=False, null=True, blank=True)
    mailer_execution_id = models.BigIntegerField(null=True, blank=True)
    sms_execution_id = models.BigIntegerField(null=True, blank=True)
    tracking_link = models.ForeignKey('tracking.TrackingLink', on_delete=models.DO_NOTHING, db_column='tracking_link_id', related_name='tracking_events', db_constraint=False, null=True, blank=True)
    url = models.TextField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)
    is_bot = models.BooleanField(default=False)  # Apple MPP / security-scanner prefetch detected
    occurred_at = models.DateTimeField(db_default=Now())
    ingested_at = models.DateTimeField(db_default=Now())
    processed_at = models.DateTimeField(null=True, blank=True)
    processing_status = models.CharField(max_length=10, default='PENDING', choices=ProcessingStatus.choices)  # PENDING, PROCESSED, FAILED, IGNORED

    class Meta:
        managed = False
        db_table = 'tracking_event'
        # real primary key is (id, tenant_id, occurred_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.event_type)
