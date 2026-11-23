"""The storage record (tenant_storage_config) every workspace needs once uploads go to object storage (MEDIA_BUCKET): the bucket,
the workspace's own folder in it (t/<partition_seq>/) and the CDN address its images are served from (apps/media/storage.py).

Onboarding makes it; `manage.py storage_records` adds it to the workspaces that predate the switch, and can run before the
switch with the bucket and CDN given on the command line. A record that exists is never changed here: the back-office edits it.
"""
from django.conf import settings
from django.db import connections, transaction

from apps.tenants.models import Tenant, TenantStorageConfig


class MissingCdn(ValueError):
    """A bucket without a CDN address: the record cannot be made (cdn_base_url is required)."""


def backend_for(endpoint: str | None) -> str:
    return "R2" if endpoint and "r2.cloudflarestorage.com" in endpoint else "S3"


def wanted(tenant, *, bucket=None, cdn=None, region=None, endpoint=None) -> dict | None:
    """The record this workspace would get, from the arguments or else the settings; None while uploads stay on the local disk."""
    bucket = bucket or settings.MEDIA_BUCKET
    if not bucket:
        return None
    cdn = (cdn or settings.CDN_BASE_URL or "").rstrip("/")
    if not cdn:
        raise MissingCdn("CDN_BASE_URL is empty: set it (https://cdn.example.com) before workspaces can get a storage record.")
    if not cdn.startswith("https://"):
        raise MissingCdn(f"The CDN address must start with https:// (got {cdn}).")
    endpoint = endpoint or settings.AWS_S3_ENDPOINT_URL
    seq = tenant.partition_seq or Tenant.objects.using(settings.PLATFORM_ALIAS).values_list("partition_seq", flat=True).get(pk=tenant.pk)
    return {"storage_backend": backend_for(endpoint), "bucket_name": bucket, "bucket_region": region or settings.MEDIA_REGION or None,
            "base_prefix": f"t/{seq}/", "cdn_base_url": cdn}


def ensure(tenant, *, using: str, user_id=None, **given) -> str:
    """'off' (no bucket), 'exists' or 'created'. Raises MissingCdn when a bucket is set without a CDN address."""
    fields = wanted(tenant, **given)
    if fields is None:
        return "off"
    with transaction.atomic(using=using), connections[using].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.pk)])   # row-level security and the audit trigger
        if TenantStorageConfig.objects.using(using).filter(tenant_id=tenant.pk).exists():
            return "exists"
        TenantStorageConfig.objects.using(using).create(tenant_id=tenant.pk, updated_by_id=user_id, **fields)
    return "created"


def lacking(using: str | None = None) -> list[Tenant]:
    """Active and suspended workspaces without a storage record."""
    using = using or settings.PLATFORM_ALIAS
    with connections[using].cursor() as cursor:
        cursor.execute("""SELECT t.id FROM tenant t WHERE t.status <> 'OFFBOARDED'
                          AND NOT EXISTS (SELECT 1 FROM tenant_storage_config s WHERE s.tenant_id = t.id)""")
        ids = [row[0] for row in cursor.fetchall()]
    return list(Tenant.objects.using(using).filter(pk__in=ids).order_by("code"))
