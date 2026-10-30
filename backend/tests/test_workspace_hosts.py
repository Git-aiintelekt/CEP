"""A workspace's subdomain and custom domain: kept in lower case whatever is typed, and found in any case, as are codes.

Every change is rolled back (tests/conftest.py)."""
import pytest
from django.conf import settings
from django.db import connections, transaction

from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
HOSTS = ["subdomain", "custom_app_domain"]


def _resolve(alias, key, value):
    with connections[alias].cursor() as cursor:
        cursor.execute("SELECT code FROM fn_resolve_tenant(%s, %s)", [key, value])
        row = cursor.fetchone()
    return row[0] if row else None


def test_workspace_hosts(check):
    """Typed with capitals and spaces, saved in lower case; a host name, a subdomain or a code found in any case. Rolled back."""
    P = settings.PLATFORM_ALIAS
    token = context.set_platform(True)                              # the back office: every workspace, as the Tenants admin
    try:
        _hosts(check, P)
    finally:
        context.reset_platform(token)
    check.done()


def _hosts(check, P):
    with transaction.atomic(using=P):
        nwa = Tenant.objects.using(P).get(code="NWA")
        nwa.subdomain, nwa.custom_app_domain = " ZZHost ", "ZZ-Reports.Example.COM"
        nwa.clean()
        check("cleaning gives the lower-case names, so the uniqueness check compares those",
              (nwa.subdomain, nwa.custom_app_domain) == ("zzhost", "zz-reports.example.com"), f"{nwa.subdomain} {nwa.custom_app_domain}")
        nwa.subdomain, nwa.custom_app_domain = "ZZHost", " ZZ-Reports.Example.COM"
        nwa.save(update_fields=HOSTS)                               # as the Tenants admin saves: the changed fields
        saved = Tenant.objects.using(P).values_list("subdomain", "custom_app_domain").get(pk=nwa.pk)
        check("saving keeps them in lower case, trimmed", saved == ("zzhost", "zz-reports.example.com"), str(saved))
        nwa.custom_app_domain = "   "
        nwa.save(update_fields=HOSTS)
        check("a blank domain is saved as none", Tenant.objects.using(P).values_list("custom_app_domain", flat=True).get(pk=nwa.pk) is None)

        with connections[P].cursor() as cursor:                     # a name saved with capitals before this change, past the model
            cursor.execute("UPDATE tenant SET subdomain = %s, custom_app_domain = %s WHERE id = %s", ["ZZUpper", "ZZ.Example.COM", str(nwa.pk)])
            check("the names are stored with capitals for the look-up checks", cursor.rowcount == 1)
        check("a subdomain saved with capitals is found from the lower-case host", _resolve(P, "subdomain", "zzupper") == "NWA")
        check("a custom domain saved with capitals is found from the lower-case host", _resolve(P, "custom_app_domain", "zz.example.com") == "NWA")
        check("and from a host typed in any case", _resolve(P, "custom_app_domain", "Zz.Example.Com") == "NWA")
        check("a code is found in any case", _resolve(P, "code", "nwa") == "NWA" and _resolve(P, "code", "NWA") == "NWA")
        check("an unknown name is not found", _resolve(P, "subdomain", "zz-nobody") is None and _resolve(P, "code", "zz-nobody") is None)
        transaction.set_rollback(True, using=P)
