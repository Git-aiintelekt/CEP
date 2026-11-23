"""The storage record a workspace needs once uploads go to object storage: onboarding makes it, storage_records adds it to the
workspaces that lack one (before the switch, from its arguments), the readiness panel and the health check name a gap. Rolled back."""
import io

import pytest
from django.conf import settings
from django.core.management import call_command
from django.db import connections, transaction
from django.test import override_settings

from apps.media import records
from apps.tenants import context, readiness, services
from apps.tenants.models import Tenant, TenantStorageConfig

P = settings.PLATFORM_ALIAS
R2 = {"MEDIA_BUCKET": "cep-media", "MEDIA_REGION": "auto", "CDN_BASE_URL": "https://cdn.example.com/",
      "AWS_S3_ENDPOINT_URL": "https://0123abcd.r2.cloudflarestorage.com"}
pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _record(tenant_id):
    with transaction.atomic(using=P), connections[P].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])
        return TenantStorageConfig.objects.using(P).filter(tenant_id=tenant_id).first()


def _new_workspace(code):
    made = Tenant.objects.using(P).create(name=f"Storage Test {code}", code=code)
    made.refresh_from_db(using=P)
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [str(made.pk)])          # the audit log's partitions
    return made


def test_onboarding_makes_the_record_once_uploads_go_to_object_storage(check):
    token = context.set_platform(True)
    try:
        with transaction.atomic(using=P):
            plain = _new_workspace("ZZSTO1")
            result = services.onboard_tenant(plain, using=P)
            check("on the local disk onboarding makes no record", result["storage"] == "off" and _record(plain.pk) is None, result.get("storage"))

            with override_settings(**R2):
                made = _new_workspace("ZZSTO2")
                result = services.onboard_tenant(made, using=P)
                record = _record(made.pk)
                check("with a bucket it makes the record", result["storage"] == "created" and record is not None, result.get("storage"))
                check("... R2 from the endpoint, the workspace's own folder, the CDN address without a trailing slash",
                      (record.storage_backend, record.bucket_name, record.bucket_region, record.base_prefix, record.cdn_base_url)
                      == ("R2", "cep-media", "auto", f"t/{made.partition_seq}/", "https://cdn.example.com"),
                      (record.storage_backend, record.bucket_name, record.bucket_region, record.base_prefix, record.cdn_base_url))
                check("... with the default upload rules", record.signed_url_ttl_seconds == 900 and record.custom_domain_status == "PENDING")
                again = services.onboard_tenant(made, using=P)
                check("Repair Onboarding leaves an existing record alone", again["storage"] == "exists")

                shown = {c["key"]: c for c in readiness.checks(made)}
                check("the readiness panel shows the record", shown["storage"]["state"] == "ok" and "R2 · cep-media/t/" in shown["storage"]["text"]
                      and "https://cdn.example.com" in shown["storage"]["text"], shown.get("storage"))
                shown = {c["key"]: c for c in readiness.checks(plain)}
                check("... and a workspace without one as a gap to repair", shown["storage"]["state"] == "todo"
                      and shown["storage"]["action"] == "Repair Onboarding", shown.get("storage"))
                check("the health check names it", any(t.code == "ZZSTO1" for t in records.lacking(P)))

            with override_settings(MEDIA_BUCKET="cep-media", CDN_BASE_URL=""):
                late = _new_workspace("ZZSTO3")
                result = services.onboard_tenant(late, using=P)
                check("a bucket without a CDN address: onboarding still finishes, the record is not made", result["storage"] == "failed" and _record(late.pk) is None)

            check("without a bucket the readiness panel has no storage line", "storage" not in {c["key"] for c in readiness.checks(plain)})
            transaction.set_rollback(True, using=P)
    finally:
        context.reset_platform(token)
    check.done()


def test_storage_records_lists_then_adds_the_missing_records_before_the_switch(check):
    with transaction.atomic(using=P):
        first = _new_workspace("ZZSTO4")
        out = io.StringIO()
        call_command("storage_records", "--bucket", "cep-media", "--cdn", "https://cdn.example.com", "--region", "auto",
                     "--endpoint", "https://0123abcd.r2.cloudflarestorage.com", stdout=out)
        text = out.getvalue()
        check("a dry run lists the workspace with what it would get", f"ZZSTO4       R2 cep-media/t/{first.partition_seq}/" in text
              and "Run again with --apply" in text and _record(first.pk) is None, text[-600:])

        out = io.StringIO()
        call_command("storage_records", "--bucket", "cep-media", "--cdn", "https://cdn.example.com", "--region", "auto",
                     "--endpoint", "https://0123abcd.r2.cloudflarestorage.com", "--apply", stdout=out)
        record = _record(first.pk)
        check("--apply makes it", record is not None and record.base_prefix == f"t/{first.partition_seq}/" and "given a storage record" in out.getvalue(),
              out.getvalue()[-400:])
        check("... and the workspace no longer lacks one", all(t.code != "ZZSTO4" for t in records.lacking(P)))

        for bad, words in ((["--bucket", "cep-media"], "CDN_BASE_URL is empty"), (["--bucket", "cep-media", "--cdn", "http://cdn.example.com"], "must start with https://")):
            with override_settings(CDN_BASE_URL=""):
                _new_workspace("ZZSTO5") if not Tenant.objects.using(P).filter(code="ZZSTO5").exists() else None
                try:
                    call_command("storage_records", *bad, stdout=io.StringIO())
                    refused = ""
                except Exception as problem:                   # noqa: BLE001
                    refused = str(problem)
                check(f"refused: {words}", words in refused, refused)
        transaction.set_rollback(True, using=P)
    check.done()
