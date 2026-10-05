"""A receipt from a store the workspace has not listed: a note in the answer, and STORE tags that fall back to the number."""
import pytest

from apps.pos import mapping
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_unlisted_store(check):
    """An unknown store number gets a note and a fallback name; no number, no note."""
    token = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    context.reset_platform(token)
    context.set_current(str(tenant.id), "default", None)
    from django.db import connections
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.id)])
    read = {"transaction": {"store_number": "00137"}, "store": {}}
    note = mapping.missing_store_note(tenant.id, read)
    check("an unknown store 00137 gets a note naming it", note and "00137" in note, note)
    check("no store number, no note", mapping.missing_store_note(tenant.id, {"transaction": {"store_number": ""}, "store": {}}) is None)
    tags = mapping.store_tags(tenant.id, read)
    check("an unknown store's name falls back to its number; the address stays empty", tags.get("name") == "Store 00137" and not tags.get("address1"),
          {k: tags.get(k) for k in ("name", "address1", "city")})
    check.done()
