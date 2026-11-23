"""Give every workspace without one its storage record (apps/media/records.py). A dry run unless --apply.

Run it before switching uploads to object storage, with the bucket and CDN given here, so no workspace is left without one:
    manage.py storage_records --bucket cep-media --cdn https://cdn.example.com --region auto \\
        --endpoint https://<account-id>.r2.cloudflarestorage.com --apply
Afterwards, with MEDIA_BUCKET and CDN_BASE_URL in .env, the arguments can be left out.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.media import records
from apps.tenants import context


class Command(BaseCommand):
    help = "Add the storage record (bucket, folder, CDN address) to every workspace that lacks one. Dry run unless --apply."

    def add_arguments(self, parser):
        parser.add_argument("--bucket", help="Bucket name (default: MEDIA_BUCKET)")
        parser.add_argument("--cdn", help="CDN address, https://… (default: CDN_BASE_URL)")
        parser.add_argument("--region", help="Bucket region; auto for Cloudflare R2 (default: MEDIA_REGION)")
        parser.add_argument("--endpoint", help="S3 endpoint; an r2.cloudflarestorage.com address records R2 (default: S3_ENDPOINT_URL)")
        parser.add_argument("--apply", action="store_true", help="Make the records (otherwise only list them)")

    def handle(self, *args, bucket=None, cdn=None, region=None, endpoint=None, apply=False, **options):
        given = {"bucket": bucket, "cdn": cdn, "region": region, "endpoint": endpoint}
        P = settings.PLATFORM_ALIAS
        token = context.set_platform(True)
        try:
            workspaces = records.lacking(P)
            if not workspaces:
                self.stdout.write("Every workspace has a storage record.")
                return
            try:
                if records.wanted(workspaces[0], **given) is None:
                    raise CommandError("No bucket: give --bucket, or set MEDIA_BUCKET in .env.")
            except records.MissingCdn as problem:
                raise CommandError(str(problem)) from None
            failed = 0
            for tenant in workspaces:
                fields = records.wanted(tenant, **given)
                line = (f"{tenant.code:<12} {fields['storage_backend']} {fields['bucket_name']}/{fields['base_prefix']:<8} "
                        f"region {fields['bucket_region'] or '-'} · {fields['cdn_base_url']}")
                if apply:
                    try:
                        line += f"  {records.ensure(tenant, using=P, **given)}"
                    except Exception as problem:            # noqa: BLE001  one workspace's failure never stops the others
                        line += f"  FAILED: {str(problem).splitlines()[0]}"
                        failed += 1
                self.stdout.write(line)
            done = len(workspaces) - failed
            self.stdout.write(f"{done} workspace{'s' if done != 1 else ''} given a storage record." + (f" {failed} failed: see above." if failed else "")
                              if apply else f"{len(workspaces)} workspace{'s' if len(workspaces) != 1 else ''} would get one. Run again with --apply to make them.")
        finally:
            context.reset_platform(token)
