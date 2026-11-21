"""Governance (patch 0088): a platform policy reaches exactly the workspaces it applies to (one, several, all), follows its changes
and leaves when taken off or deleted; a workspace sees the platform's cap locked on its Governance page and manages caps of its
own. Rolled back."""
import json

import pytest
from django.db import connections, transaction
from django.test import Client
from django.utils.timezone import now
from rest_framework_simplejwt.tokens import AccessToken

from apps.governance import platform
from apps.governance.models import CommunicationGovernancePolicy
from apps.identity.models import AppUser
from apps.platform_ops.models import PlatformGovernancePolicy
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = "platform"


def _present() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.platform_governance_policy') IS NOT NULL")
        return cursor.fetchone()[0]


def _copies(policy) -> set[str]:
    rows = CommunicationGovernancePolicy.objects.using(P).filter(platform_policy_id=policy.pk, deleted_at__isnull=True).values_list("tenant_id", flat=True)
    return set(Tenant.objects.using(P).filter(pk__in=list(rows)).values_list("code", flat=True))


def test_a_platform_policy_reaches_one_several_or_all_workspaces(check):
    if not _present():
        pytest.skip("patch 0088 has not been applied to this database")
    token = context.set_platform(True)
    try:
        with transaction.atomic(using=P):
            first = Tenant.objects.using(P).create(name="Governance Test One", code="ZZGOVA")      # two workspaces of the test's own, rolled back
            second = Tenant.objects.using(P).create(name="Governance Test Two", code="ZZGOVB")
            with connections[P].cursor() as cursor:                                                 # their partitions, as onboarding makes them
                for made in (first, second):
                    cursor.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [str(made.pk)])
            active = list(Tenant.objects.using(P).filter(status="ACTIVE").order_by("code"))
            policy = PlatformGovernancePolicy.objects.using(P).create(name="Test Email Cap", scope="CHANNEL", channel="EMAIL", max_messages=3, period_days=7,
                                                                       tenant_ids=[first.pk])
            platform.push(policy, using=P)
            check("one workspace: only it gets a copy", _copies(policy) == {first.code}, _copies(policy))
            copy = CommunicationGovernancePolicy.objects.using(P).get(platform_policy_id=policy.pk, tenant_id=first.pk, deleted_at__isnull=True)
            check("the copy carries the cap", (copy.scope, copy.channel, copy.max_messages, copy.period_days, copy.is_active) == ("CHANNEL", "EMAIL", 3, 7, True))

            policy.tenant_ids, policy.max_messages = [first.pk, second.pk], 2
            policy.save(using=P)
            outcomes = platform.push(policy, using=P)
            check("several: both get it, the first's copy follows the change", _copies(policy) == {first.code, second.code} and first.code in outcomes["updated"]
                  and CommunicationGovernancePolicy.objects.using(P).get(pk=copy.pk).max_messages == 2, outcomes)

            policy.applies_all, policy.tenant_ids = True, []
            policy.save(using=P)
            platform.push(policy, using=P)
            check("all: every active workspace has it", _copies(policy) == {t.code for t in active})

            policy.applies_all, policy.tenant_ids = False, [second.pk]
            policy.save(using=P)
            platform.push(policy, using=P)
            check("taken off: the other workspaces lose their copy", _copies(policy) == {second.code}, _copies(policy))

            removed = platform.remove_everywhere(policy, using=P)
            check("deleted: every copy goes", removed == [second.code] and _copies(policy) == set())
            transaction.set_rollback(True, using=P)
    finally:
        context.reset_platform(token)
    check.done()


def test_the_workspace_sees_the_platform_cap_locked_and_manages_its_own(check, admin_email):
    if not _present():
        pytest.skip("patch 0088 has not been applied to this database")
    token = context.set_platform(True)
    admin = AppUser.objects.using(P).select_related("tenant").get(email=admin_email)
    context.reset_platform(token)
    tenant_id, code = str(admin.tenant_id), admin.tenant.code
    context.set_current(tenant_id, "default", str(admin.pk))
    office = Client(HTTP_X_TENANT=code, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(admin)))
    with transaction.atomic(using="default"), transaction.atomic(using=P):
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [tenant_id])
            cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(admin.pk)])
        rule = PlatformGovernancePolicy.objects.create(name="Test Platform Cap", scope="CHANNEL", channel="EMAIL", max_messages=3, period_days=7, applies_all=True)
        locked = CommunicationGovernancePolicy.objects.create(tenant_id=tenant_id, name="Test Platform Cap", scope="CHANNEL", channel="EMAIL", max_messages=3,
                                                              period_days=7, platform_policy_id=rule.pk)

        page = office.get("/api/v1/workspace/governance/")
        rows = {row["id"]: row for row in page.json()["caps"]} if page.status_code == 200 else {}
        check("the page lists the platform's cap, locked, with its rule", page.status_code == 200 and rows.get(str(locked.pk), {}).get("platform") is True
              and rows[str(locked.pk)]["rule"] == "3 emails per 7 days", page.content[:300])
        check("and says what the rules did", set(page.json().get("activity", {})) >= {"checked", "sent", "capped", "sent_percent"})

        made = office.post("/api/v1/workspace/governance/caps/", json.dumps({"channel": "SMS", "max_messages": 4, "period_days": 30}), content_type="application/json")
        check("a cap of its own is added", made.status_code == 201 and made.json()["rule"] == "4 texts per 30 days" and made.json()["platform"] is False, made.content[:300])
        bad = office.post("/api/v1/workspace/governance/caps/", json.dumps({"channel": "SMS", "max_messages": 0, "period_days": 30}), content_type="application/json")
        check("a cap of 0 is refused on its field", bad.status_code == 400 and "max_messages" in bad.json().get("errors", bad.json()), bad.content[:300])
        own = made.json()["id"]
        off = office.patch(f"/api/v1/workspace/governance/caps/{own}/", json.dumps({"is_active": False}), content_type="application/json")
        check("it can be switched off", off.status_code == 200 and off.json()["is_active"] is False)
        refused = office.patch(f"/api/v1/workspace/governance/caps/{locked.pk}/", json.dumps({"max_messages": 30}), content_type="application/json")
        check("the platform's cap cannot be changed", refused.status_code == 403 and "platform" in refused.json().get("detail", ""), refused.content[:300])
        check("nor removed", office.delete(f"/api/v1/workspace/governance/caps/{locked.pk}/").status_code == 403)
        check("its own is removed", office.delete(f"/api/v1/workspace/governance/caps/{own}/").status_code == 204
              and CommunicationGovernancePolicy.objects.get(pk=own).deleted_at is not None)
        transaction.set_rollback(True, using="default")
        transaction.set_rollback(True, using=P)
    check.done()


def test_a_new_workspace_gets_the_platform_standards_locked_and_the_standard_caps_as_its_own(check):
    if not _present():
        pytest.skip("patch 0088 has not been applied to this database")
    from apps.governance import standard
    token = context.set_platform(True)
    try:
        with transaction.atomic(using=P):
            fresh = Tenant.objects.using(P).create(name="Governance Standard Test", code="ZZGOVS")
            kept = Tenant.objects.using(P).create(name="Governance Own Email Cap", code="ZZGOVK")
            with connections[P].cursor() as cursor:
                for made in (fresh, kept):
                    cursor.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [str(made.pk)])
                cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(kept.pk)])
            CommunicationGovernancePolicy.objects.using(P).create(tenant_id=kept.pk, name="Our email cap", scope="CHANNEL", channel="EMAIL", max_messages=2, period_days=7)

            result = standard.for_new_workspace(fresh.pk, using=P)
            rows = CommunicationGovernancePolicy.objects.using(P).filter(tenant_id=fresh.pk, deleted_at__isnull=True)
            locked = {(r.channel, r.max_messages, r.period_days) for r in rows if r.platform_policy_id}
            own = {("ALL" if r.scope == "GLOBAL" else r.channel, r.max_messages, r.period_days) for r in rows if not r.platform_policy_id and r.unengaged_days is None}
            unengaged = [(r.unengaged_days, r.unengaged_min_emails) for r in rows if not r.platform_policy_id and r.unengaged_days is not None]
            check("the platform standards arrive locked: one per channel per day", {("EMAIL", 1, 1), ("SMS", 1, 1), ("WHATSAPP", 1, 1)} <= locked, locked)
            check("and the standard caps as the workspace's own", own == {("EMAIL", 3, 7), ("SMS", 4, 30), ("WHATSAPP", 2, 7), ("ALL", 5, 7)}, own)
            check("and the recommended Unengaged Contacts rule", unengaged == [(180, 5)], unengaged)
            check("onboarding reports them", len(result["own"]) == 5, result)

            first = standard.apply(using=P)
            check("for every workspace: one that caps email already keeps its own and gets the other three, and the unengaged rule",
                  sorted(first["workspaces"]["ZZGOVK"]) == sorted(["4 texts per 30 days", "2 WhatsApp messages per 7 days", "5 messages per 7 days",
                                                                   "No engagement in 180 days, after at least 5 marketing emails"]), first["workspaces"].get("ZZGOVK"))
            again = standard.apply(using=P)
            check("running it again adds nothing", not any(again["workspaces"].values()) and len(PlatformGovernancePolicy.objects.using(P).filter(name__startswith="Platform Standard")) == 4,
                  again["workspaces"])
            transaction.set_rollback(True, using=P)
    finally:
        context.reset_platform(token)
    check.done()


def test_a_platform_gap_reaches_the_workspace_as_a_gap(check):
    if not _present():
        pytest.skip("patch 0088 has not been applied to this database")
    token = context.set_platform(True)
    try:
        with transaction.atomic(using=P):
            made = Tenant.objects.using(P).create(name="Governance Gap Test", code="ZZGOVG")
            with connections[P].cursor() as cursor:
                cursor.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [str(made.pk)])
            policy = PlatformGovernancePolicy.objects.using(P).create(name="Test Text Gap", scope="CHANNEL", channel="SMS", max_messages=1, period_days=1, gap_hours=24,
                                                                       tenant_ids=[made.pk])
            platform.push(policy, using=P)
            copy = CommunicationGovernancePolicy.objects.using(P).get(platform_policy_id=policy.pk, tenant_id=made.pk, deleted_at__isnull=True)
            check("the copy is a gap of 24 hours", (copy.gap_hours, copy.max_messages, copy.channel) == (24, 1, "SMS"), (copy.gap_hours, copy.max_messages))
            check("the back-office names it as a gap", policy.rule() == "24 hours between texts", policy.rule())
            transaction.set_rollback(True, using=P)
    finally:
        context.reset_platform(token)
    check.done()


def test_the_workspace_sets_its_own_gap_per_channel_beside_the_platform_one(check, admin_email):
    if not _present():
        pytest.skip("patch 0088 has not been applied to this database")
    token = context.set_platform(True)
    admin = AppUser.objects.using(P).select_related("tenant").get(email=admin_email)
    context.reset_platform(token)
    tenant_id, code = str(admin.tenant_id), admin.tenant.code
    context.set_current(tenant_id, "default", str(admin.pk))
    office = Client(HTTP_X_TENANT=code, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(admin)))
    with transaction.atomic(using="default"), transaction.atomic(using=P):
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [tenant_id])
            cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(admin.pk)])
        CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).update(deleted_at=now())   # this workspace's rules would blur it
        rule = PlatformGovernancePolicy.objects.create(name="Test Platform Gap", scope="CHANNEL", channel="SMS", max_messages=1, period_days=1, gap_hours=24, applies_all=True)
        locked = CommunicationGovernancePolicy.objects.create(tenant_id=tenant_id, name="Test Platform Gap", scope="CHANNEL", channel="SMS", max_messages=1,
                                                              period_days=1, gap_hours=24, platform_policy_id=rule.pk)

        page = office.get("/api/v1/workspace/governance/").json()
        entries = {entry["channel"]: entry for entry in page.get("gaps", [])}
        check("one entry per channel, the platform's gap locked under Text", list(entries) == ["EMAIL", "SMS", "WHATSAPP"]
              and [(g["rule"], g["platform"]) for g in entries["SMS"]["platform"]] == [("24 hours between texts", True)] and entries["SMS"]["own"] is None, entries)
        check("a gap is not listed among the caps", str(locked.pk) not in {row["id"] for row in page["caps"]})
        check("email starts at the recommended 16 hours", entries["EMAIL"]["recommended_hours"] == 16 and entries["EMAIL"]["own"] is None)

        made = office.put("/api/v1/workspace/governance/gaps/EMAIL/", json.dumps({"hours": 16, "is_active": True}), content_type="application/json")
        check("an email gap of its own is made", made.status_code == 200 and made.json()["own"]["rule"] == "16 hours between emails" and made.json()["own"]["platform"] is False,
              made.content[:300])
        changed = office.put("/api/v1/workspace/governance/gaps/EMAIL/", json.dumps({"hours": 20}), content_type="application/json")
        check("and changed, the same row", changed.status_code == 200 and changed.json()["own"]["id"] == made.json()["own"]["id"] and changed.json()["own"]["hours"] == 20)
        off = office.put("/api/v1/workspace/governance/gaps/EMAIL/", json.dumps({"is_active": False}), content_type="application/json")
        check("switched off, keeping its hours", off.status_code == 200 and off.json()["own"]["is_active"] is False and off.json()["own"]["hours"] == 20)
        bad = office.put("/api/v1/workspace/governance/gaps/EMAIL/", json.dumps({"hours": 200}), content_type="application/json")
        check("more than 168 hours is refused on its field", bad.status_code == 400 and "hours" in bad.json().get("errors", bad.json()), bad.content[:300])
        check("an unknown channel is not found", office.put("/api/v1/workspace/governance/gaps/FAX/", json.dumps({"hours": 4}), content_type="application/json").status_code == 404)
        check("a gap cannot be edited as a cap", office.patch(f"/api/v1/workspace/governance/caps/{made.json()['own']['id']}/", json.dumps({"max_messages": 3}),
                                                               content_type="application/json").status_code == 404)

        office.put("/api/v1/workspace/governance/gaps/EMAIL/", json.dumps({"hours": 16, "is_active": True}), content_type="application/json")
        office.post("/api/v1/workspace/governance/caps/", json.dumps({"channel": "EMAIL", "max_messages": 1, "period_days": 1}), content_type="application/json")
        email = next(entry for entry in office.get("/api/v1/workspace/governance/").json()["gaps"] if entry["channel"] == "EMAIL")
        check("a cap of 1 email per day already keeps 16 hours, and the page says so", email["covered_by"] == "1 email per day", email)
        transaction.set_rollback(True, using="default")
        transaction.set_rollback(True, using=P)
    check.done()
