"""templates — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now
from django.contrib.postgres.fields import ArrayField


def _default_personalization_tag_applies_to_channels():
    return ['EMAIL', 'E_RECEIPT', 'SMS', 'MMS']


class TemplateMaster(models.Model):
    """Channel-aware template identity (Email / E-Receipt / SMS / MMS)"""
    class Channel(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        E_RECEIPT = 'E_RECEIPT', 'E Receipt'
        SMS = 'SMS', 'SMS'
        MMS = 'MMS', 'MMS'

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        ACTIVE = 'ACTIVE', 'Active'
        ARCHIVED = 'ARCHIVED', 'Archived'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    description = models.TextField(null=True, blank=True)  # iCRM DESCRIPTION / USE_OF_TEMPLATE
    legacy_template_id = models.CharField(max_length=60, null=True, blank=True, unique=True)  # iCRM template_master.TEMPLATE_ID, for templates carried over rather than authored fresh in Template Studio
    name = models.CharField(max_length=200)
    channel = models.CharField(max_length=20, choices=Channel.choices)  # EMAIL, E_RECEIPT, SMS, MMS
    status = models.CharField(max_length=20, default='DRAFT', choices=Status.choices)  # DRAFT, ACTIVE, ARCHIVED
    cloned_from = models.ForeignKey('self', on_delete=models.PROTECT, db_column='cloned_from_id', related_name='template_masters', null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'template_master'

    def __str__(self):
        return str(self.name)


class TemplateDesignState(models.Model):
    """Versioned GrapesJS/MJML editable design state"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    template = models.ForeignKey('templates.TemplateMaster', on_delete=models.CASCADE, db_column='template_id', related_name='template_design_states')
    version_number = models.IntegerField()
    editor_state = models.JSONField()  # GrapesJS/MJML editable project state
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'template_design_state'
        constraints = [
            models.UniqueConstraint(fields=['template_id', 'version_number'], name='ux_template_design_state_template_id_version_number'),
        ]

    def __str__(self):
        return str(self.pk)


class RenderedTemplateContent(models.Model):
    """Send-ready rendered HTML/text/SMS content"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    template = models.ForeignKey('templates.TemplateMaster', on_delete=models.CASCADE, db_column='template_id', related_name='rendered_template_contents')
    version_number = models.IntegerField()
    subject_line = models.CharField(max_length=300, null=True, blank=True)  # default subject for EMAIL / E_RECEIPT; may contain {{tags}}; run variants can override (TD-04)
    preheader = models.CharField(max_length=300, null=True, blank=True)  # inbox preview text shown after the subject
    html_content = models.TextField(null=True, blank=True)
    text_content = models.TextField(null=True, blank=True)
    mjml_source = models.TextField(null=True, blank=True)
    sms_body = models.TextField(null=True, blank=True)  # for SMS/MMS channel templates
    rendered_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'rendered_template_content'
        constraints = [
            models.UniqueConstraint(fields=['template_id', 'version_number'], name='ux_rendered_template_content_template_id_version_number'),
        ]

    def __str__(self):
        return str(self.pk)


class PersonalizationTag(models.Model):
    """Tag catalogue: STANDARD / CUSTOM / INNER_TEMPLATE / SEGMENT / SYSTEM with resolution source, default and format"""
    class TagKind(models.TextChoices):
        STANDARD = 'STANDARD', 'Standard'
        CUSTOM = 'CUSTOM', 'Custom'
        INNER_TEMPLATE = 'INNER_TEMPLATE', 'Inner Template'
        SEGMENT = 'SEGMENT', 'Segment'
        SYSTEM = 'SYSTEM', 'System'

    class ResolutionSource(models.TextChoices):
        CUSTOMER_MASTER = 'CUSTOMER_MASTER', 'Customer Master'
        CAMPAIGN_LIST_MEMBER = 'CAMPAIGN_LIST_MEMBER', 'Campaign List Member'
        CAMPAIGN = 'CAMPAIGN', 'Campaign'
        CAMPAIGN_RUN = 'CAMPAIGN_RUN', 'Campaign Run'
        STORE = 'STORE', 'Store'
        SYSTEM = 'SYSTEM', 'System'
        STATIC = 'STATIC', 'Static'
        INNER_TEMPLATE = 'INNER_TEMPLATE', 'Inner Template'
        RECEIPT = 'RECEIPT', 'Receipt'

    class DataType(models.TextChoices):
        STRING = 'STRING', 'String'
        NUMBER = 'NUMBER', 'Number'
        DATE = 'DATE', 'Date'
        BOOLEAN = 'BOOLEAN', 'Boolean'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    legacy_tag_id = models.CharField(max_length=60, null=True, blank=True)  # iCRM data_tag_configuration.TAG_ID (116-row vocabulary loads 1:1)
    tag_key = models.CharField(max_length=100)  # e.g. {{first_name}}
    label = models.CharField(max_length=150)  # shown in Template Studio (iCRM TAG_NAME)
    tag_kind = models.CharField(max_length=20, default='STANDARD', choices=TagKind.choices)  # STANDARD, CUSTOM, INNER_TEMPLATE, SEGMENT, SYSTEM
    source_system = models.CharField(max_length=40)  # C360, CEP
    resolution_source = models.CharField(max_length=30, choices=ResolutionSource.choices)  # CUSTOMER_MASTER, CAMPAIGN_LIST_MEMBER, CAMPAIGN, CAMPAIGN_RUN, STORE, SYSTEM, STATIC, INNER_TEMPLATE, RECEIPT
    source_path = models.CharField(max_length=200, null=True, blank=True)  # e.g. first_name / custom_value_pairs.discount_pct / name (iCRM ENTITY_FIELD_NAME, CUSTOM_FIELD_ID)
    static_value = models.TextField(null=True, blank=True)  # STATIC tags (iCRM DATA_TAG_VALUE)
    default_value = models.TextField(null=True, blank=True)  # fallback when the source is empty
    format_spec = models.CharField(max_length=60, null=True, blank=True)  # date / number / currency pattern applied at render
    inner_template = models.ForeignKey('templates.TemplateMaster', on_delete=models.PROTECT, db_column='inner_template_id', related_name='personalization_tags', null=True, blank=True)  # INNER_TEMPLATE tags expand this block template
    data_type = models.CharField(max_length=20, default='STRING', choices=DataType.choices)
    applies_to_channels = ArrayField(models.TextField(), default=_default_personalization_tag_applies_to_channels)
    description = models.TextField(null=True, blank=True)
    sample_value = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(db_default=Now())
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'personalization_tag'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'tag_key'], name='ux_personalization_tag_tenant_id_tag_key'),
        ]

    def __str__(self):
        return str(self.tag_key)


class TemplateTag(models.Model):
    """Which tags a template uses, with mandatory flag — validated against the campaign list at publish"""
    pk = models.CompositePrimaryKey('template_id', 'tag_id')
    template = models.ForeignKey('templates.TemplateMaster', on_delete=models.CASCADE, db_column='template_id', related_name='template_tags')
    tag = models.ForeignKey('templates.PersonalizationTag', on_delete=models.PROTECT, db_column='tag_id', related_name='template_tags')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    is_mandatory = models.BooleanField(default=False)  # iCRM TAG_MANDATORY
    sequence = models.IntegerField(default=0)  # iCRM TAG_SEQUENCE
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'template_tag'

    def __str__(self):
        return str(self.pk)


class ReceiptPresentationModel(models.Model):
    """Out-of-the-box POS/eCommerce receipt layout model"""
    class LayoutType(models.TextChoices):
        POS = 'POS', 'POS'
        ENHANCED_RETAIL = 'ENHANCED_RETAIL', 'Enhanced Retail'
        ECOMMERCE = 'ECOMMERCE', 'Ecommerce'
        HYBRID = 'HYBRID', 'Hybrid'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    name = models.CharField(max_length=150)
    layout_type = models.CharField(max_length=30, choices=LayoutType.choices)  # POS, ENHANCED_RETAIL, ECOMMERCE, HYBRID
    layout_definition = models.JSONField()  # section/column structure
    is_standard = models.BooleanField(default=True)  # OOTB vs. client-custom
    created_at = models.DateTimeField(db_default=Now())
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'receipt_presentation_model'

    def __str__(self):
        return str(self.name)


class ReceiptFieldConfiguration(models.Model):
    """Client field show/hide/label/order rules for a receipt template"""
    class Section(models.TextChoices):
        HEADER = 'HEADER', 'Header'
        ITEM_LINE = 'ITEM_LINE', 'Item Line'
        DISCOUNT = 'DISCOUNT', 'Discount'
        TAX = 'TAX', 'Tax'
        TOTALS = 'TOTALS', 'Totals'
        TENDER = 'TENDER', 'Tender'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    template = models.ForeignKey('templates.TemplateMaster', on_delete=models.CASCADE, db_column='template_id', related_name='receipt_field_configurations')
    receipt_presentation_model = models.ForeignKey('templates.ReceiptPresentationModel', on_delete=models.PROTECT, db_column='receipt_presentation_model_id', related_name='receipt_field_configurations')
    field_key = models.CharField(max_length=100)  # SKU, Description, Qty, UnitPrice, ...
    section = models.CharField(max_length=30, choices=Section.choices)  # HEADER, ITEM_LINE, DISCOUNT, TAX, TOTALS, TENDER
    visible = models.BooleanField(default=True)
    label_override = models.CharField(max_length=150, null=True, blank=True)
    sort_order = models.IntegerField(default=0)
    column_group = models.CharField(max_length=50, null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'receipt_field_configuration'
        constraints = [
            models.UniqueConstraint(fields=['template_id', 'field_key'], name='ux_receipt_field_configuration_template_id_field_key'),
        ]

    def __str__(self):
        return str(self.pk)
