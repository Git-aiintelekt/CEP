"""media — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now


class MediaAsset(models.Model):
    """Images and MMS media in object storage, checksum de-duplicated"""
    class AssetKind(models.TextChoices):
        IMAGE = 'IMAGE', 'Image'
        DOCUMENT = 'DOCUMENT', 'Document'
        LIST_UPLOAD = 'LIST_UPLOAD', 'List Upload'
        RECEIPT_LOGO = 'RECEIPT_LOGO', 'Receipt Logo'
        MMS_MEDIA = 'MMS_MEDIA', 'MMS Media'
        EXPORT = 'EXPORT', 'Export'

    class Visibility(models.TextChoices):
        PUBLIC = 'PUBLIC', 'Public'
        PRIVATE = 'PRIVATE', 'Private'

    class ScanStatus(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        CLEAN = 'CLEAN', 'Clean'
        INFECTED = 'INFECTED', 'Infected'
        SKIPPED = 'SKIPPED', 'Skipped'

    class UploadedVia(models.TextChoices):
        API = 'API', 'API'
        DIRECT_UPLOAD = 'DIRECT_UPLOAD', 'Direct Upload'
        SYSTEM = 'SYSTEM', 'System'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    file_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=100)
    byte_size = models.BigIntegerField()
    storage_key = models.CharField(max_length=500)  # object-store key (S3/GCS/Azure)
    public_url = models.TextField(null=True, blank=True)  # CDN URL used in rendered content / MMS media_url
    checksum_sha256 = models.CharField(max_length=64)  # de-duplication and integrity
    width_px = models.IntegerField(null=True, blank=True)
    height_px = models.IntegerField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)
    asset_kind = models.CharField(max_length=20, default='IMAGE', choices=AssetKind.choices)
    visibility = models.CharField(max_length=10, default='PUBLIC', choices=Visibility.choices)
    cdn_url = models.TextField(null=True, blank=True)
    cache_control = models.CharField(max_length=100, default='public, max-age=31536000, immutable')
    etag = models.CharField(max_length=80, null=True, blank=True)
    variants = models.JSONField(default=dict)
    scan_status = models.CharField(max_length=10, default='PENDING', choices=ScanStatus.choices)
    uploaded_via = models.CharField(max_length=20, default='API', choices=UploadedVia.choices)

    class Meta:
        managed = False
        db_table = 'media_asset'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'checksum_sha256'], name='ux_media_asset_tenant_id_checksum_sha256'),
        ]

    def __str__(self):
        return str(self.file_name)


class TemplateMediaAsset(models.Model):
    """Which templates use which media asset (blocks deleting in-use media)"""
    pk = models.CompositePrimaryKey('template_id', 'media_asset_id')
    template = models.ForeignKey('templates.TemplateMaster', on_delete=models.CASCADE, db_column='template_id', related_name='template_media_assets')
    media_asset = models.ForeignKey('media.MediaAsset', on_delete=models.PROTECT, db_column='media_asset_id', related_name='template_media_assets')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'template_media_asset'

    def __str__(self):
        return str(self.pk)
