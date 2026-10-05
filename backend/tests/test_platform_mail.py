"""The platform's mail server is never a tenant's: resolution, the workspace API and the SMTP provider. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import uuid
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery.models import DeliveryProvider, SenderProfile
from apps.delivery.providers import registry
from apps.delivery.providers.base import ProviderError
from apps.identity.models import AppUser
from apps.platform_ops import mail
from apps.platform_ops.models import MailServer
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_platform_mail(check, admin_email):
    """The platform's mail server is never a tenant's: resolution, the workspace API and the SMTP provider. Rolled back."""
    class Roll(Exception):
        pass

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    tok = context.set_current(str(tenant.id), "default", str(user.pk))
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:                 # the row-level policy wants the tenant on the session
                cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.id)])
            MailServer.objects.using("platform").filter(tenant_id=tenant.id).delete()
            MailServer.objects.using("platform").filter(tenant_id__isnull=True).delete()
            platform = MailServer.objects.using("platform").create(tenant_id=None, host="smtp.platform.example", from_email="noreply@platform.example", from_name="CEP")

            check("model has no sharing fields", not any(hasattr(MailServer, name) for name in ("use_platform_server", "shared_with_all", "shared_tenant_ids")))
            check("no sharing helper is left in mail", not hasattr(mail, "shared_with"))
            check("a tenant without a server falls back to the platform's server with the platform's From", mail.resolve(str(tenant.id)).source == "platform" and mail.resolve(str(tenant.id)).from_email == "CEP <noreply@platform.example>")
            # the workspace API: its rows live on the API connection, in a savepoint of their own so no uncommitted row of one
            # connection can block the other's unique index
            class Inner(Exception):
                pass
            try:
                with transaction.atomic(using="default"):
                    client = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
                    answer = client.put("/api/v1/workspace/mail-server/", {"host": "", "from_email": "hello@nwa.example", "port": 587, "security": "STARTTLS"}, content_type="application/json")
                    body = answer.json()
                    check("PUT without a host is refused plainly", answer.status_code == 400 and "Enter the SMTP server name." in str(body), f"{answer.status_code} {str(body)[:120]}")
                    answer = client.put("/api/v1/workspace/mail-server/", {"host": "smtp.nwa.example", "use_platform_server": True, "from_email": "hello@nwa.example", "port": 587, "security": "STARTTLS"}, content_type="application/json")
                    check("PUT ignores a stray use_platform_server and keeps the tenant's host", answer.status_code == 200 and answer.json()["server"]["host"] == "smtp.nwa.example" and answer.json()["in_use"] == "tenant", f"{answer.status_code} {str(answer.json())[:120]}")
                    page = client.get("/api/v1/workspace/mail-server/").json()
                    check("GET carries no sharing keys", "platform_shared" not in page and "platform_host" not in page and page["in_use"] == "tenant" and "use_platform_server" not in page["server"], str(sorted(page)))
                    raise Inner
            except Inner:
                pass

            own = MailServer.objects.using("platform").create(tenant_id=tenant.id, host="smtp.nwa.example", from_email="hello@nwa.example", from_name="Northwind", campaign_sender=True)
            route = mail.resolve(str(tenant.id))
            check("a tenant with its own server uses it", route.source == "tenant" and route.connection_kwargs["host"] == "smtp.nwa.example" and route.from_email == "Northwind <hello@nwa.example>")
            own.is_active = False
            own.save(using="platform")
            check("switched off, the tenant's system mail falls back to the platform's server", mail.resolve(str(tenant.id)).source == "platform")
            own.is_active = True
            own.save(using="platform")
            check("the platform's own mail uses the platform's server", mail.resolve(None).source == "platform")

            # the SMTP delivery provider only ever opens the tenant's own server
            provider = DeliveryProvider.objects.create(tenant_id=tenant.id, provider_type="SMTP", channel="EMAIL", name=f"probe {uuid.uuid4().hex[:6]}",
                                                       config={"mail_server_id": str(own.pk), "host": own.host}, is_active=True)
            adapter = registry.for_provider(provider)
            check("the SMTP provider connects to the tenant's host", adapter._kwargs()["host"] == "smtp.nwa.example")
            own.is_active = False
            own.save(using="platform")
            try:
                adapter._kwargs(); refused = None
            except ProviderError as exc:
                refused = str(exc)
            check("… and refuses, never falling back to the platform's, when that server is off", refused == "The workspace mail server was removed or switched off.", str(refused))
            own.is_active = True
            own.save(using="platform")

            # the platform row's admin form has no sharing fields
            from apps.platform_ops.admin import MailServerForm
            check("the back-office form has no sharing fields", not {"shared_with_all", "shared_tenants"} & set(MailServerForm.base_fields) and "shared_with_all" not in MailServerForm.Meta.fields)
            raise Roll
    except Roll:
        pass
    finally:
        context.reset(tok)
    check.done()
