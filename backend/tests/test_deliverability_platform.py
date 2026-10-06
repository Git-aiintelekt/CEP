"""Deliverability tests through the platform's Mailgun Inspect account (patch 0039): the account in the back-office,
workspaces using it up to their plan's number plus the tests added for the month (which end with it), the message at the
limit, a workspace's own account (not limited, not counted), a test read back from the account that ran it, and the
tenant page's Add Tests. Rolled back; Mailgun faked."""
import json
from datetime import datetime, time, timedelta
from unittest import mock

import pytest
import requests
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from apps.delivery import deliverability
from apps.delivery.engine import session
from apps.delivery.models import DeliverabilityService, DeliverabilityTest
from apps.identity.models import AppUser
from apps.platform_ops import billing, crypto
from apps.templates.models import TemplateMaster
from apps.tenants.models import Tenant, TenantQuotaGrant

from .test_journey_events import T

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = deliverability.P


class FakeResponse:
    def __init__(self, status, payload):
        self.status_code, self._payload = status, payload
        self.content = json.dumps(payload).encode()
        self.text = self.content.decode()
        self.headers = {"Content-Type": "application/json"}
        self.elapsed = None

    def json(self):
        return self._payload


def test_deliverability_platform(check, admin_email, fresh_cache):
    calls = []

    def fake_request(self, method, url, **kwargs):
        calls.append({"method": method, "url": url, "auth": kwargs.get("auth") or getattr(self, "auth", None), "json": kwargs.get("json")})
        if url.endswith("/v2/preview/tests") and method == "POST":
            return FakeResponse(201, {"id": f"t-{len(calls)}"})
        if "/results" in url:
            return FakeResponse(200, {})
        if url.endswith("/clients"):
            return FakeResponse(200, {"clients": {"gmail_chr_win": {"id": "gmail_chr_win", "client": "Gmail", "os": "Windows", "category": "Web", "default": True}}})
        return FakeResponse(200, {"completed": [], "processing": [], "bounced": []})

    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    api = APIClient()
    api.force_authenticate(user)
    month = billing.month_start()

    since = timezone.make_aware(datetime.combine(month, time.min))

    def count_here(tenant_id, account=None):
        """billing counts on the platform connection, which cannot see this test's uncommitted tests: count on the test's own"""
        with session.tenant_scope(tenant_id), session.tx():
            rows = DeliverabilityTest.objects.filter(tenant_id=tenant_id, requested_at__gte=since)
            return (rows.filter(account=account) if account else rows).count()

    with mock.patch.object(requests.Session, "request", fake_request), mock.patch.object(billing, "tests_this_month", count_here), \
            mock.patch.object(billing, "plan_for", lambda tenant_id: {"code": "GROWTH", "name": "Growth", "max_deliverability_tests": 2, "monthly_price": 0, "currency": "USD", "subscription_status": "ACTIVE"}), \
            mock.patch.object(deliverability.params, "enabled", lambda tenant_id, feature: True):
        DeliverabilityService.objects.using(P).filter(tenant_id__isnull=True).delete()
        with session.tenant_scope(T), session.tx():
            DeliverabilityService.objects.filter(tenant_id=T).delete()
        check("no account anywhere: nothing can run", deliverability.allowance(T)["account"] is None)

        platform = DeliverabilityService.objects.using(P).create(tenant_id=None, provider="MAILGUN_INSPECT", region="US", username="cep-platform",
                                                                  api_key_enc=crypto.encrypt("platform-key"), default_clients=["gmail_chr_win"])
        state = deliverability.allowance(T)
        check("with the platform's account: the workspace uses it, up to its plan's number",
              state["account"] == "PLATFORM" and state["limit"] == 2 and state["used"] == 0 and state["note"] == "2 a month on the Growth plan.", json.dumps(state))
        shown = api.get("/api/v1/deliverability/service/", HTTP_X_TENANT="NWA").json()
        check("the workspace sees it is provided, not the platform's key", shown["uses"] == "PLATFORM" and shown["platform_available"] is True
              and shown["configured"] is False and "platform-key" not in json.dumps(shown) and shown["default_clients"] == ["gmail_chr_win"], json.dumps(shown)[:200])

        template = TemplateMaster.objects.filter(tenant_id=T, channel="EMAIL", deleted_at__isnull=True, rendered_template_contents__html_content__isnull=False).distinct().first()
        started = api.post(f"/api/v1/templates/{template.pk}/deliverability-tests/", {}, format="json", HTTP_X_TENANT="NWA")
        created = next(call for call in calls if call["method"] == "POST")
        check("a test runs through the platform's account, tagged with the workspace's code", started.status_code == 201 and started.json()["account"] == "PLATFORM"
              and created["auth"][0] == "cep-platform" and created["json"]["reference_id"].startswith("cep:NWA:"), f"{started.status_code} {created['json'].get('reference_id')}")

        TenantQuotaGrant.objects.using(P).create(tenant_id=T, period_month=month, amount=3, note="Black Friday", granted_by_id=user.pk)
        TenantQuotaGrant.objects.using(P).create(tenant_id=T, period_month=(month - timedelta(days=1)).replace(day=1), amount=50, note="last month")
        TenantQuotaGrant.objects.using(P).create(tenant_id=T, period_month=month, amount=40, note="removed", removed_at=timezone.now())
        state = deliverability.allowance(T)
        check("tests added for this month count; last month's and removed ones do not", state["limit"] == 5 and state["added"] == 3
              and state["note"].startswith(f"2 a month on the Growth plan + 3 added for {month:%B}. Added tests end on"), json.dumps(state))

        for _ in range(4):
            api.post(f"/api/v1/templates/{template.pk}/deliverability-tests/", {}, format="json", HTTP_X_TENANT="NWA")
        refused = api.post(f"/api/v1/templates/{template.pk}/deliverability-tests/", {}, format="json", HTTP_X_TENANT="NWA")
        following = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
        check("at the limit the next test is refused, naming the total, where it comes from and when more arrive",
              refused.status_code == 409 and f"used all 5 deliverability tests for {month:%B} (2 on the Growth plan + 3 added)" in refused.json()["detail"]
              and f"{following:%b} {following.day}" in refused.json()["detail"], refused.content[:300])
        meter = next(m for m in billing.quota(T)["meters"] if m["label"].startswith("Deliverability"))
        check("Plan and usage shows the same total and where it comes from", meter["used"] == 5 and meter["limit"] == 5 and "3 added" in meter["note"], json.dumps(meter))

        running = DeliverabilityTest.objects.filter(tenant_id=T, account="PLATFORM").first()
        DeliverabilityTest.objects.filter(pk=running.pk).update(checked_at=None)
        before = len(calls)
        deliverability.refresh(DeliverabilityTest.objects.get(pk=running.pk))
        check("a test's results are read from the account that ran it", any("/results" in call["url"] and call["auth"][0] == "cep-platform" for call in calls[before:]))

        clients_only = api.put("/api/v1/deliverability/service/", {"default_clients": ["outlook16"], "image_blocking": True}, format="json", HTTP_X_TENANT="NWA")
        check("the workspace may choose its own clients and stay on the platform's account", clients_only.status_code == 200
              and clients_only.json()["uses"] == "PLATFORM" and clients_only.json()["default_clients"] == ["outlook16"], clients_only.content[:200])

        own = api.put("/api/v1/deliverability/service/", {"region": "EU", "username": "nwa-own", "api_key": "own-key", "default_clients": ["outlook16"]},
                      format="json", HTTP_X_TENANT="NWA")
        state = deliverability.allowance(T)
        check("with its own key the workspace uses its own account and CEP does not limit it", own.json()["uses"] == "OWN"
              and state["account"] == "OWN" and state["limit"] is None and "own Mailgun account" in state["note"], json.dumps(state))
        mine = api.post(f"/api/v1/templates/{template.pk}/deliverability-tests/", {}, format="json", HTTP_X_TENANT="NWA")
        last = [call for call in calls if call["method"] == "POST"][-1]
        check("its tests run through its own account and are not counted against the plan", mine.status_code == 201 and mine.json()["account"] == "OWN"
              and last["auth"][0] == "nwa-own" and "api.eu.mailgun.net" in last["url"]
              and billing.tests_this_month(T, account="PLATFORM") == 5, f"{mine.status_code} {last['url']}")
        api.delete("/api/v1/deliverability/service/", HTTP_X_TENANT="NWA")
        check("removing its own account goes back to the platform's", deliverability.allowance(T)["account"] == "PLATFORM")

        staff = AppUser.objects.using(P).filter(is_staff=True, is_active=True).order_by("created_at").first()
        user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
        try:
            office = Client()
            office.force_login(staff)
            page = office.get("/admin/platform_ops/mailserver/inspect/")
            check("the back-office shows the platform's account with this month's use by workspace", page.status_code == 200
                  and b"Mailgun Inspect" in page.content and b"cep-platform" in page.content and b"platform-key" not in page.content, str(page.status_code))
            saved = office.post("/admin/platform_ops/mailserver/inspect/", {"action": "save", "region": "EU", "username": "cep-platform-2", "api_key": "",
                                                                           "default_clients": ["gmail_chr_win"], "is_active": "on"})
            platform.refresh_from_db(using=P)
            check("saving without a key keeps the saved one", saved.status_code == 302 and platform.username == "cep-platform-2" and platform.region == "EU"
                  and crypto.decrypt(platform.api_key_enc) == "platform-key", str(saved.status_code))
            tenant = Tenant.objects.using(P).get(pk=T)
            card = office.get(f"/admin/tenants/tenant/{T}/change/")
            check("the tenant's page shows its tests this month", card.status_code == 200 and b"Deliverability Tests" in card.content, str(card.status_code))
            added = office.post(f"/admin/tenants/tenant/{T}/deliverability-tests/", {"amount": "20", "note": "Holiday refresh"})
            grant = TenantQuotaGrant.objects.using(P).filter(tenant=tenant, note="Holiday refresh").first()
            check("Add Tests records the addition for this month, by whom", added.status_code == 302 and grant is not None and grant.amount == 20
                  and grant.period_month == month and grant.granted_by_id == staff.pk)
            removed = office.post(f"/admin/tenants/tenant/{T}/deliverability-tests/", {"remove": str(grant.pk)})
            grant.refresh_from_db(using=P)
            check("and it can be removed while its month is open", removed.status_code == 302 and grant.removed_at is not None)
            old = TenantQuotaGrant.objects.using(P).get(tenant=tenant, note="last month")
            office.post(f"/admin/tenants/tenant/{T}/deliverability-tests/", {"remove": str(old.pk)})
            old.refresh_from_db(using=P)
            check("but not once its month is over", old.removed_at is None)
        finally:
            user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    check.done()
