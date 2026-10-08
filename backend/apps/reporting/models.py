"""reporting — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now


class CampaignMasterAnalytical(models.Model):
    """Denormalized per-campaign reporting rollup"""
    campaign = models.OneToOneField('campaigns.Campaign', on_delete=models.DO_NOTHING, db_column='campaign_id', related_name='campaign_master_analyticals', db_constraint=False, primary_key=True)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    campaign_name = models.CharField(max_length=200, null=True, blank=True)
    campaign_type = models.CharField(max_length=20, null=True, blank=True)
    channel = models.CharField(max_length=20, null=True, blank=True)
    status = models.CharField(max_length=30, null=True, blank=True)
    sent_count = models.IntegerField(null=True, blank=True)
    delivered_count = models.IntegerField(null=True, blank=True)
    open_count = models.IntegerField(null=True, blank=True)
    click_count = models.IntegerField(null=True, blank=True)
    bounce_count = models.IntegerField(null=True, blank=True)
    complaint_count = models.IntegerField(null=True, blank=True)
    conversion_count = models.IntegerField(null=True, blank=True)
    target_revenue = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    attributed_revenue = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    campaign_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    campaign_roi = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    last_refreshed_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'campaign_master_analytical'

    def __str__(self):
        return str(self.pk)


class JourneyMasterAnalytical(models.Model):
    """Denormalized per-journey reporting rollup"""
    journey = models.OneToOneField('journeys.Journey', on_delete=models.DO_NOTHING, db_column='journey_id', related_name='journey_master_analyticals', db_constraint=False, primary_key=True)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    journey_name = models.CharField(max_length=200, null=True, blank=True)
    population_mode = models.CharField(max_length=30, null=True, blank=True)
    status = models.CharField(max_length=20, null=True, blank=True)
    business_objective = models.TextField(null=True, blank=True)
    active_enrollment_count = models.IntegerField(null=True, blank=True)
    completed_count = models.IntegerField(null=True, blank=True)
    exited_count = models.IntegerField(null=True, blank=True)
    converted_count = models.IntegerField(null=True, blank=True)          # the Goal step
    attributed_revenue = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    sent_count = models.IntegerField(null=True, blank=True)               # the journey's messages across every step
    delivered_count = models.IntegerField(null=True, blank=True)
    open_count = models.IntegerField(null=True, blank=True)
    click_count = models.IntegerField(null=True, blank=True)
    bounce_count = models.IntegerField(null=True, blank=True)
    complaint_count = models.IntegerField(null=True, blank=True)
    held_back_count = models.IntegerField(null=True, blank=True)
    failed_count = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(null=True, blank=True)
    last_refreshed_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'journey_master_analytical'

    def __str__(self):
        return str(self.pk)


class JourneyExecutionMasterAnalytical(models.Model):
    """Flattened Party/Journey/node/event/campaign/outcome fact table (range-partitioned)"""
    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    party_id = models.CharField(max_length=60)
    journey = models.ForeignKey('journeys.Journey', on_delete=models.DO_NOTHING, db_column='journey_id', related_name='journey_execution_master_analyticals', db_constraint=False)
    node_id = models.UUIDField(null=True, blank=True)
    event_type = models.CharField(max_length=60, null=True, blank=True)
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.DO_NOTHING, db_column='campaign_id', related_name='journey_execution_master_analyticals', db_constraint=False, null=True, blank=True)
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.DO_NOTHING, db_column='campaign_run_id', related_name='journey_execution_master_analyticals', db_constraint=False, null=True, blank=True)
    channel = models.CharField(max_length=20, null=True, blank=True)
    outcome = models.CharField(max_length=30, null=True, blank=True)
    executed_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'journey_execution_master_analytical'
        # real primary key is (id, tenant_id, executed_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.event_type)
