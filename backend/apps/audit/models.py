"""audit — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now
from django.contrib.postgres.fields import ArrayField


class DefinitionAuditLog(models.Model):
    """Before/after change history of every campaign, journey, template and policy definition (tenant + monthly partitioned)"""
    class Action(models.TextChoices):
        INSERT = 'INSERT', 'Insert'
        UPDATE = 'UPDATE', 'Update'
        DELETE = 'DELETE', 'Delete'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    entity_table = models.CharField(max_length=63)
    entity_id = models.TextField()
    action = models.CharField(max_length=10, choices=Action.choices)  # INSERT, UPDATE, DELETE
    changed_by = models.UUIDField(null=True, blank=True)  # app.current_user_id session setting
    changed_at = models.DateTimeField(db_default=Now())
    changed_columns = ArrayField(models.TextField(), null=True, blank=True)  # UPDATE only
    old_row = models.JSONField(null=True, blank=True)
    new_row = models.JSONField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'definition_audit_log'
        # real primary key is (id, tenant_id, changed_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.pk)


class ReferenceCode(models.Model):
    """Labelled catalogue of every closed value set (code_set = table.column); CHECK constraints enforce, this table describes"""
    pk = models.CompositePrimaryKey('code_set', 'code')
    code_set = models.CharField(max_length=80)  # '<table>.<column>'
    code = models.CharField(max_length=40)
    label = models.CharField(max_length=120)
    description = models.TextField(null=True, blank=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'reference_code'

    def __str__(self):
        return str(self.code)
