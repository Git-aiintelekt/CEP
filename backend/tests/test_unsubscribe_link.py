"""The unsubscribe link: a test send's token, a bad token, a real token. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
from django.db import connections, transaction
from django.test import Client
from apps.delivery.engine import unsubscribe
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_unsubscribe_link(check):
    """The unsubscribe link: a test send's token, a bad token, a real token. Rolled back."""
    class Roll(Exception):
        pass

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    context.reset_platform(ptok)
    client = Client()
    URL = "/api/v1/public/unsubscribe/"

    test_token = unsubscribe.test_token(tenant_code="NWA", email="someone@example.com")
    check("a test send's token names the workspace and is marked", unsubscribe.read(test_token) == {"t": "NWA", "e": "someone@example.com", "test": True})

    for token, label in (("test", "the old literal 'test'"), ("", "no token"), ("garbage.token.here", "a forged token")):
        answer = client.get(URL, {"t": token} if token else {})
        body = answer.content.decode()
        check(f"{label}: the view's own page, not a JSON 404", answer.status_code == 400 and "This link is not valid" in body and "Unknown tenant" not in body, f"{answer.status_code} {answer['Content-Type']}")

    answer = client.get(URL, {"t": test_token})
    body = answer.content.decode()
    check("a test send's link: 200 page saying it was a test, naming the address, no button", answer.status_code == 200 and "This was a test message" in body and "someone@example.com" in body and "<button" not in body, f"{answer.status_code}")

    try:
        with transaction.atomic(using="default"):
            with connections["default"].cursor() as cursor:                 # name the tenant for both counts: the policy hides the rows otherwise
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
                cursor.execute("SELECT count(*) FROM consent_record WHERE tenant_id = %s", [str(tenant.id)])
                before = cursor.fetchone()[0]
            answer = client.post(f"{URL}?t={test_token}", {"List-Unsubscribe": "One-Click"})
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT count(*) FROM consent_record WHERE tenant_id = %s", [str(tenant.id)])
                after = cursor.fetchone()[0]
            check("POST (one-click) on a test token: same page, nothing recorded", answer.status_code == 200 and "This was a test message" in answer.content.decode() and after == before, f"{before}->{after}")
            raise Roll
    except Roll:
        pass

    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
        cursor.execute("SELECT party_id FROM consent_suppression WHERE tenant_id = %s AND channel = 'EMAIL' AND consent_status <> 'OPTED_OUT' LIMIT 1", [str(tenant.id)])
        row = cursor.fetchone()
        cursor.execute("SELECT set_config('app.current_tenant', '', false)")
    if row:
        real = unsubscribe.token_for(tenant_code="NWA", party_id=str(row[0]), email="person@example.com", campaign_id="00000000-0000-0000-0000-000000000000", run_id="00000000-0000-0000-0000-000000000000")
        answer = client.get(URL, {"t": real})
        check("a real token still shows the confirmation page with the button", answer.status_code == 200 and "Stop sending marketing email" in answer.content.decode() and "<button" in answer.content.decode(), str(answer.status_code))
    else:
        print("skip: no opted-in email party to build a real token for")
    check.done()
