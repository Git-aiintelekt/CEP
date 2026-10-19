"""Models over the Insights tables of database/CEP_Database_Schema_Platform_Operations.sql (patch 0049). Unmanaged: the DDL
is the source of truth. The catalogue (dataset, field, source, engine setting) is platform-owned; a workspace's reports
carry tenant_id and row-level security like every workspace table."""
import uuid

from django.db import models
from django.db.models.functions import Now


class ReportDataset(models.Model):
    key = models.CharField(max_length=40, primary_key=True)
    component = models.ForeignKey('platform_ops.SuiteComponent', on_delete=models.PROTECT, db_column='component_key', related_name='+')
    label = models.CharField(max_length=100)
    description = models.TextField(null=True, blank=True)
    workspace_field = models.CharField(max_length=60, default='tenant_id')
    primary_key = models.CharField(max_length=60)
    time_field = models.CharField(max_length=60, null=True, blank=True)
    freshness_policy = models.CharField(max_length=20, default='LIVE')
    status = models.CharField(max_length=10, default='ACTIVE')
    sort_order = models.IntegerField(default=0)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'report_dataset'
        ordering = ('sort_order', 'key')
        verbose_name = 'report dataset'

    def __str__(self):
        return str(self.label)


class ReportField(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dataset = models.ForeignKey(ReportDataset, on_delete=models.CASCADE, db_column='dataset_key', related_name='fields')
    key = models.CharField(max_length=60)
    label = models.CharField(max_length=100)
    column_name = models.CharField(max_length=60)
    type = models.CharField(max_length=10)
    role = models.CharField(max_length=10)
    aggregates = models.JSONField(default=list, blank=True)
    display_format = models.CharField(max_length=20, null=True, blank=True)
    sensitivity = models.CharField(max_length=10, default='NORMAL')
    sort_order = models.IntegerField(default=0)
    formula = models.JSONField(null=True, blank=True, help_text='A calculated measure: {"op": "ratio" | "difference" | "sum" | "product", "left": {"field": "delivered", "aggregate": "sum"}, '
                                                               '"right": {"field": "sent", "aggregate": "sum"} or {"value": 100}, "scale": 100}. The column is then ignored.')

    class Meta:
        managed = False
        db_table = 'report_field'
        ordering = ('sort_order', 'key')
        unique_together = (('dataset', 'key'),)

    def __str__(self):
        return f"{self.dataset_id}.{self.key}"


class ReportDatasetLink(models.Model):
    """Two datasets that share dimensions: a report on the first adds measures from the second (apps/insights/links.py, patch 0061)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    from_dataset = models.ForeignKey(ReportDataset, on_delete=models.CASCADE, db_column='from_dataset', related_name='links_out')
    to_dataset = models.ForeignKey(ReportDataset, on_delete=models.CASCADE, db_column='to_dataset', related_name='links_in')
    label = models.CharField(max_length=100)
    pairs = models.JSONField(default=list, help_text='The shared dimensions, each [field of the first dataset, field of the second]: [["campaign_name", "campaign_name"], ["channel", "channel"]]')
    time_pair = models.JSONField(null=True, blank=True, help_text='The dates that mean the same period: [first dataset\'s date, second dataset\'s date], or empty')
    status = models.CharField(max_length=10, default='ACTIVE')
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'report_dataset_link'
        ordering = ('from_dataset', 'sort_order')
        unique_together = (('from_dataset', 'to_dataset'),)
        verbose_name = 'dataset link'

    def __str__(self):
        return f"{self.from_dataset_id} → {self.to_dataset_id}"


class ReportDatasetSource(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dataset = models.ForeignKey(ReportDataset, on_delete=models.CASCADE, db_column='dataset_key', related_name='sources')
    engine = models.CharField(max_length=12)
    source_name = models.CharField(max_length=120)
    status = models.CharField(max_length=10, default='ACTIVE')

    class Meta:
        managed = False
        db_table = 'report_dataset_source'
        unique_together = (('dataset', 'engine'),)


class ReportEngineConnection(models.Model):
    """An analytics engine the back-office can point a workspace at: named by its profile on ReportEngineSetting.connection_profile."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.CharField(max_length=60, unique=True)
    engine = models.CharField(max_length=12, default='clickhouse')
    url = models.CharField(max_length=300)
    username = models.CharField(max_length=100, null=True, blank=True)
    password_enc = models.TextField(null=True, blank=True)
    database_name = models.CharField(max_length=60, default='cep_reporting')
    status = models.CharField(max_length=10, default='ACTIVE')
    notes = models.TextField(null=True, blank=True)
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_ok = models.BooleanField(null=True, blank=True)
    last_test_error = models.CharField(max_length=300, null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'report_engine_connection'
        ordering = ('profile',)

    def __str__(self):
        return f"{self.profile} ({self.engine})"


class ReportEngineSetting(models.Model):
    tenant = models.OneToOneField('tenants.Tenant', on_delete=models.CASCADE, db_column='tenant_id', primary_key=True, related_name='+')
    engine = models.CharField(max_length=12, default='postgresql')
    connection_profile = models.CharField(max_length=60, default='pg-reporting-shared')
    status = models.CharField(max_length=12, default='ACTIVE')
    freshness_sla = models.CharField(max_length=12, default='LIVE')
    query_limits = models.JSONField(default=dict, blank=True)
    last_reconciled_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'report_engine_setting'
        verbose_name = 'report engine setting'


class ReportFolder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    name = models.CharField(max_length=120)
    parent = models.ForeignKey('self', on_delete=models.PROTECT, db_column='parent_id', null=True, blank=True, related_name='children')
    owner_user = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='owner_user_id', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'report_folder'


class Report(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    folder = models.ForeignKey(ReportFolder, on_delete=models.PROTECT, db_column='folder_id', null=True, blank=True, related_name='reports')
    dataset = models.ForeignKey(ReportDataset, on_delete=models.PROTECT, db_column='dataset_key', related_name='+')
    name = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    view_type = models.CharField(max_length=20, default='grid')
    definition = models.JSONField()
    owner_user = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='owner_user_id', related_name='+', null=True, blank=True)
    visibility = models.CharField(max_length=10, default='PRIVATE')
    version = models.IntegerField(default=1)
    last_run_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'report'

    def __str__(self):
        return str(self.name)


class ReportVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    report = models.ForeignKey(Report, on_delete=models.CASCADE, db_column='report_id', related_name='versions')
    version = models.IntegerField()
    definition = models.JSONField()
    view_type = models.CharField(max_length=20)
    note = models.CharField(max_length=300, null=True, blank=True)
    changed_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='changed_by', related_name='+', null=True, blank=True)
    changed_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'report_version'
        unique_together = (('report', 'version'),)


class ReportShare(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    report = models.ForeignKey(Report, on_delete=models.CASCADE, db_column='report_id', related_name='shares')
    principal_kind = models.CharField(max_length=10)
    principal_id = models.UUIDField()
    permission = models.CharField(max_length=10)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'report_share'
        unique_together = (('report', 'principal_kind', 'principal_id'),)


class ReportRunAudit(models.Model):
    id = models.BigAutoField(primary_key=True)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    report = models.ForeignKey(Report, on_delete=models.SET_NULL, db_column='report_id', null=True, blank=True, related_name='runs')
    report_version = models.IntegerField(null=True, blank=True)
    user = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='user_id', related_name='+', null=True, blank=True)
    dataset_key = models.CharField(max_length=40)
    kind = models.CharField(max_length=10)
    filter_signature = models.CharField(max_length=64)
    duration_ms = models.IntegerField(null=True, blank=True)
    row_count = models.IntegerField(null=True, blank=True)
    outcome = models.CharField(max_length=12)
    detail = models.CharField(max_length=300, null=True, blank=True)
    started_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'report_run_audit'
