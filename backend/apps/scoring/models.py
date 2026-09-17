"""scoring — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now


class MlModel(models.Model):
    """Registry of scoring models (propensity, churn, CLV, send-time, next-best-action) with artifact, feature spec and metrics"""
    class ModelType(models.TextChoices):
        PROPENSITY = 'PROPENSITY', 'Propensity'
        CHURN = 'CHURN', 'Churn'
        CLV = 'CLV', 'CLV'
        SEND_TIME = 'SEND_TIME', 'Send Time'
        NEXT_BEST_ACTION = 'NEXT_BEST_ACTION', 'Next Best Action'
        SEGMENT = 'SEGMENT', 'Segment'

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        ACTIVE = 'ACTIVE', 'Active'
        RETIRED = 'RETIRED', 'Retired'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    code = models.CharField(max_length=40)  # e.g. PURCHASE_PROPENSITY_30D
    name = models.CharField(max_length=150)
    model_type = models.CharField(max_length=20, choices=ModelType.choices)  # PROPENSITY, CHURN, CLV, SEND_TIME, NEXT_BEST_ACTION, SEGMENT
    version = models.IntegerField(default=1)
    status = models.CharField(max_length=10, default='DRAFT', choices=Status.choices)  # DRAFT, ACTIVE, RETIRED
    artifact_ref = models.CharField(max_length=500, null=True, blank=True)  # object-store key of the trained artifact
    feature_spec = models.JSONField(default=dict)  # features and their sources (customer_master paths, event aggregates)
    metrics = models.JSONField(default=dict)  # AUC, calibration, drift, evaluated_at
    trained_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'ml_model'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'code', 'version'], name='ux_ml_model_tenant_id_code_version'),
        ]

    def __str__(self):
        return str(self.name)


class PartyScore(models.Model):
    """Latest score per party per model from the FastAPI scoring service; used by dynamic list criteria and journey conditions"""
    pk = models.CompositePrimaryKey('tenant_id', 'party_id', 'model_id')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    party_id = models.CharField(max_length=60)
    model = models.ForeignKey('scoring.MlModel', on_delete=models.PROTECT, db_column='model_id', related_name='party_scores')
    score = models.DecimalField(max_digits=9, decimal_places=6)  # normalised 0..1
    band = models.CharField(max_length=20, null=True, blank=True)  # HIGH / MEDIUM / LOW, or an hour-of-day for SEND_TIME
    explanation = models.JSONField(null=True, blank=True)  # top contributing features
    computed_at = models.DateTimeField(db_default=Now())
    valid_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'party_score'

    def __str__(self):
        return str(self.party_id)
