"""Tenant-prefixed object storage behind the CDN (see CEP_SaaS_Tenancy_and_CDN_Setup.md §3)."""
from django.conf import settings
from storages.backends.s3 import S3Storage

from apps.tenants import context


def _cfg():
    from apps.tenants.models import TenantStorageConfig
    return TenantStorageConfig.objects.using(settings.CONTROL_PLANE_ALIAS).get(tenant_id=context.require().tenant_id)


class TenantPublicStorage(S3Storage):
    """World-readable assets served by stable CDN URLs (template images, MMS media, receipt logos)."""
    querystring_auth = False
    file_overwrite = False                                # content-addressed keys are immutable
    object_parameters = {"CacheControl": "public, max-age=31536000, immutable"}

    def __init__(self, **kw):
        c = _cfg()
        host = c.custom_asset_domain if c.custom_domain_status == "ACTIVE" else c.cdn_base_url.removeprefix("https://")
        super().__init__(bucket_name=c.bucket_name, region_name=c.bucket_region, location=c.base_prefix.rstrip("/"),
                         custom_domain=host, endpoint_url=settings.AWS_S3_ENDPOINT_URL, **kw)


class TenantPrivateStorage(S3Storage):
    """List uploads, exports, receipts: presigned URLs with a short TTL, never cached by the CDN."""
    querystring_auth = True
    file_overwrite = False
    object_parameters = {"CacheControl": "private, no-store"}

    def __init__(self, **kw):
        c = _cfg()
        super().__init__(bucket_name=c.bucket_name, region_name=c.bucket_region, location=f"{c.base_prefix.rstrip('/')}/private",
                         querystring_expire=c.signed_url_ttl_seconds, endpoint_url=settings.AWS_S3_ENDPOINT_URL, **kw)
