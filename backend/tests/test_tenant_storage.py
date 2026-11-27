"""The workspace's storage record read where the background workers read it: the workspace in scope, but not set on the
connection (each worker step sets it inside its own short transaction). tenant_storage_config has forced row-level security,
so a read outside such a transaction found no row, and every list upload on object storage failed at STAGE with
"TenantStorageConfig matching query does not exist" (.68, from 25 Nov 2026). Rolled back."""
import pytest
from django.db import connections
from django.test import override_settings

from apps.contact_lists import imports
from apps.delivery.engine import session
from apps.media import storage

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

NWA = "a0000000-0000-4000-8000-000000000001"
BUCKET = {"MEDIA_BUCKET": "cep-media-dev", "MEDIA_REGION": "us-east-1", "CDN_BASE_URL": "https://cdn.cep.example.com"}


def _forget_tenant():
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', '', false)")


def test_a_worker_finds_the_storage_record(check):
    _forget_tenant()
    with session.tenant_scope(NWA):
        try:
            record = storage._cfg()
        except Exception as exc:                                    # noqa: BLE001 - the failure is what the check reports
            record, error = None, f"{type(exc).__name__}: {exc}"
        else:
            error = ""
        check("the record is found without the workspace set on the connection", record is not None, error)
        check("... the workspace's own record", record is not None and (str(record.tenant_id), record.bucket_name, record.base_prefix)
              == (NWA, "cep-media-dev", "t/1/"), record and (str(record.tenant_id), record.bucket_name, record.base_prefix))

        _forget_tenant()
        with override_settings(**BUCKET):
            try:
                private = imports.storage()
            except Exception as exc:                                # noqa: BLE001
                private, error = None, f"{type(exc).__name__}: {exc}"
            check("an upload's private storage is built from it", isinstance(private, storage.TenantPrivateStorage), error)
            check("... in the workspace's private folder of its bucket", private is not None
                  and (private.bucket_name, private.location) == ("cep-media-dev", "t/1/private"),
                  private and (private.bucket_name, private.location))
    check.done()


def test_inside_a_transaction_the_read_still_works(check):
    with session.tenant_scope(NWA), session.tx():
        record = storage._cfg()
        check("a request or worker step already in a transaction reads it too", str(record.tenant_id) == NWA)
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT current_setting('app.current_tenant', true)")
            check("... and its workspace setting is untouched", cursor.fetchone()[0] == NWA)
    check.done()
