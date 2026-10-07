"""The hourly usage rollup stores every metric it counts, deliverability tests included (patch 0040: tenant_usage's metric
check did not allow DELIVERABILITY_TESTS, so every rollup failed on it). Everything runs on the platform connection, as
the rollup does, and is rolled back."""
import pytest
from django.db import connections, transaction

from apps.delivery.models import DeliverabilityTest
from apps.platform_ops import billing
from apps.templates.models import TemplateMaster
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = billing.P


def test_rollup_stores_deliverability_tests(check):
    tenant = Tenant.objects.using(P).get(code="NWA")
    template = TemplateMaster.objects.using(P).filter(tenant_id=tenant.pk).first()
    with transaction.atomic(using=P):
        month = billing.month_start()
        with connections[P].cursor() as cursor:
            cursor.execute("SELECT count(*) FROM deliverability_test WHERE tenant_id = %s AND requested_at >= %s", [str(tenant.pk), month])
            before = cursor.fetchone()[0]
        DeliverabilityTest.objects.using(P).create(tenant_id=tenant.pk, template=template, template_version=1, provider="MAILGUN_INSPECT", account="PLATFORM")
        try:
            result = billing.rollup_usage()
            failed = None
        except Exception as exc:                                    # noqa: BLE001
            result, failed = None, f"{type(exc).__name__}: {str(exc).splitlines()[0]}"
            transaction.set_rollback(True, using=P)
        check("the rollup runs to the end", failed is None, failed or "")
        if failed is None:
            usage = billing.usage_for(tenant.pk)
            check("this month's deliverability tests are stored with the other metrics", usage.get("DELIVERABILITY_TESTS") == before + 1
                  and "CONTACTS" in usage, f"{usage} (expected {before + 1} tests) {result}")
        transaction.set_rollback(True, using=P)
    check.done()
