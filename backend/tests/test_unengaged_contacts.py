"""Unengaged Contacts (patch 0094): marketing email leaves out people with no click, purchase or preference visit in the rule's
days, once CEP has mailed them that long and sent them enough emails. Rolled back.

The tenant's partitions start at its provisioning month, so the history cannot be written months back. The rule's clock is moved
forward instead (unengaged._now): with a rule of 30 days and "now" 31 days ahead, an email sent an hour ago is the first email
before the period, and emails, clicks and orders dated in the next weeks fall inside it."""
import json
from datetime import timedelta
from unittest import mock

import pytest
from django.core.cache import cache
from django.db import connections, transaction
from django.test import Client
from django.utils.timezone import now
from rest_framework_simplejwt.tokens import AccessToken

from apps.governance import platform, unengaged
from apps.governance.models import CommunicationGovernancePolicy
from apps.identity.models import AppUser
from apps.platform_ops.models import PlatformGovernancePolicy
from apps.tenants import context
from apps.tenants.models import Tenant

P = "platform"


@pytest.mark.django_db(databases=["default", "platform"])
def test_marketing_email_leaves_out_the_unengaged_and_a_win_back_campaign_reaches_them(check, world):
    real = now()
    ahead = real + timedelta(days=31)
    put = lambda body: world.api("put", "/api/v1/workspace/governance/unengaged/", body)  # noqa: E731

    check("fewer than 30 days is refused on days", put({"days": 10, "min_emails": 5}).status_code == 400)
    check("no emails is refused on min_emails", "min_emails" in json.dumps(put({"days": 30, "min_emails": 0}).json()))
    made = put({"days": 30, "min_emails": 5, "is_active": True})
    card = made.json() if made.status_code == 200 else {}
    check("the workspace's own rule, named and worded", made.status_code == 200 and card["own"]["name"] == "Unengaged Contacts"
          and card["own"]["rule"] == "No engagement in 30 days, after at least 5 marketing emails" and card["applies"] == {"days": 30, "min_emails": 5}, made.content[:400])
    own_id = card.get("own", {}).get("id")

    history_template = world.template("ZU history", "EMAIL", subject="ZU history", html="<p>History</p>")
    history = world.drip("ZU History", "EMAIL", [(0, history_template, {})], lists=[world.three])
    world.publish(history)
    run = str(world.run_of(history, 0).pk)

    def email(party, at, clicked=None):
        world.sql("""INSERT INTO mailer_execution (tenant_id, campaign_id, campaign_run_id, party_id, email_address, idempotency_key, status, created_at, clicked_at)
                     VALUES (%s, %s, %s, %s, %s, %s, 'DELIVERED', %s, %s)""",
                  [world.tenant, history, run, party, f"{party.lower()}@zs.example", f"zu:{party}:{at.isoformat()}", at, clicked])

    def mailed(party, first=True, recent=5):
        if first:
            email(party, real - timedelta(hours=1))
        for day in range(recent):
            email(party, real + timedelta(days=2 + day))

    def event(party, kind, bot=False):
        world.sql("""INSERT INTO tracking_event (tenant_id, party_id, event_type, channel, is_bot, occurred_at, mailer_execution_id)
                     VALUES (%s, %s, %s, 'EMAIL', %s, %s, (SELECT max(id) FROM mailer_execution WHERE tenant_id = %s AND party_id = %s))""",
                  [world.tenant, party, kind, bot, real + timedelta(days=10), world.tenant, party])

    p = {n: f"ZS-P{n:02d}" for n in range(1, 10)}
    mailed(p[1])                                                     # never engaged: left out
    mailed(p[2]); event(p[2], "CLICK")                               # a click
    mailed(p[3]); event(p[3], "CLICK", bot=True)                     # a security scanner's click is not engagement
    mailed(p[4], first=False)                                        # mailed only inside the period: too new to judge
    mailed(p[5], recent=2)                                           # too few emails in the period
    mailed(p[6])
    world.sql("""INSERT INTO attributed_order (tenant_id, source, order_ref, match_ref, party_id, amount, ordered_at) VALUES (%s, 'API', 'ZU-1', 'ZU-1', %s, 25, %s)""",
              [world.tenant, p[6], real + timedelta(days=10)])               # a purchase
    mailed(p[7]); email(p[7], real + timedelta(days=8), clicked=real + timedelta(days=9))   # a click the provider reported
    mailed(p[8]); event(p[8], "PREFERENCE_VIEW")                      # a preference-page visit
    mailed(p[9]); event(p[9], "OPEN")                                 # an open is not engagement

    cache.clear()                                                    # the card's counts are kept 10 minutes; the history above is newer
    with mock.patch.object(unengaged, "_now", return_value=ahead):
        page = world.api("get", "/api/v1/workspace/governance/").json()["unengaged"]
        check("the card counts the left out", page["today"]["unengaged"] >= 3 and page["today"]["total"] >= 22 and page["today"]["starts_on"] is None, page["today"])
        sheet = world.api("get", "/api/v1/workspace/governance/unengaged/people/")
        listed = {line.split(",")[0] for line in sheet.content.decode().splitlines()[1:]}
        check("the people list: never engaged, a scanner's click and an open only", sheet.status_code == 200 and {p[1], p[3], p[9]} <= listed
              and not listed & {p[2], p[4], p[5], p[6], p[7], p[8]}, sorted(listed))

        template = world.template("ZU news", "EMAIL", subject="ZU news", html="<p>News</p>")
        news = world.drip("ZU News", "EMAIL", [(0, template, {})], lists=[world.everyone])
        review = world.api("get", f"/api/v1/campaigns/{news}/steps/review/").json()["summary"]["unengaged"]
        check("the drip's Review step names the rule", review is not None and review["days"] == 30 and review["min_emails"] == 5 and review["left_out"] >= 3, review)
        world.publish(news)
        members = world.members(world.send(news, 0))
        check("left out as UNENGAGED: never engaged, a scanner's click, an open only",
              all(members.get(p[n]) == "UNENGAGED" for n in (1, 3, 9)), {n: members.get(p[n]) for n in p})
        check("kept: a click, too new, too few emails, a purchase, a provider click, a preference visit, no history",
              all(members.get(p[n]) == "ELIGIBLE" for n in (2, 4, 5, 6, 7, 8)) and members.get("ZS-P15") == "ELIGIBLE", {n: members.get(p[n]) for n in p})
        logged = world.sql("""SELECT policy_id::text FROM governance_evaluation_log WHERE tenant_id = %s AND party_id = %s AND reason = 'UNENGAGED'""",
                           [world.tenant, p[1]], True)
        check("the evaluation log names the rule", [row[0] for row in logged] == [own_id], logged)

        record = world.api("get", f"/api/v1/customers/{p[1]}/").json().get("engagement", {})
        check("the customer page: unengaged, with no engagement and 5 emails in the period", record.get("unengaged") is True and record.get("last_engaged_at") is None
              and record.get("emails") == 5 and record.get("unengaged_since"), record)
        record = world.api("get", f"/api/v1/customers/{p[2]}/").json().get("engagement", {})
        check("the customer page: engaged, with the click's date", record.get("unengaged") is False and (record.get("last_engaged_at") or "")[:10]
              == (real + timedelta(days=10)).date().isoformat(), record)

        win_back = world.drip("ZU Win Back", "EMAIL", [(0, template, {})], lists=[world.everyone], include_unengaged=True)
        check("no Review note on a win-back drip", world.api("get", f"/api/v1/campaigns/{win_back}/steps/review/").json()["summary"]["unengaged"] is None)
        world.publish(win_back)
        check("a win-back campaign reaches them", world.members(world.send(win_back, 0)).get(p[1]) == "ELIGIBLE")
        check("its publish is recorded as a warning", world.sql("""SELECT count(*) FROM campaign_activity_log WHERE campaign_id = %s AND message LIKE 'Unengaged contacts are included%%'""",
                                                                  [win_back], True)[0][0] == 1)

    world.api("put", "/api/v1/workspace/governance/unengaged/", {"is_active": False})
    with mock.patch.object(unengaged, "_now", return_value=ahead):
        again = world.drip("ZU Rule Off", "EMAIL", [(0, template, {})], lists=[world.three])
        world.publish(again)
        check("switched off, nobody is left out", world.members(world.send(again, 0)).get(p[1]) == "ELIGIBLE")
    check.done()


def _office(admin_email):
    token = context.set_platform(True)
    admin = AppUser.objects.using(P).select_related("tenant").get(email=admin_email)
    context.reset_platform(token)
    context.set_current(str(admin.tenant_id), "default", str(admin.pk))
    return admin, Client(HTTP_X_TENANT=admin.tenant.code, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(admin)))


@pytest.mark.django_db(databases=["default", "platform"])
def test_the_platform_sets_the_longest_and_the_recommended_set_adds_the_rule(check, admin_email):
    admin, office = _office(admin_email)
    tenant_id = str(admin.tenant_id)
    with transaction.atomic(using="default"), transaction.atomic(using=P):
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [tenant_id])
            cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(admin.pk)])
        CommunicationGovernancePolicy.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).update(deleted_at=now())
        added = office.post("/api/v1/workspace/governance/standard/").json()
        check("the recommended set adds 180 days and 5 emails", added["unengaged"]["own"] is not None and added["unengaged"]["applies"] == {"days": 180, "min_emails": 5}
              and "No engagement in 180 days, after at least 5 marketing emails" in added["added"], added.get("added"))
        check("an unengaged rule is not a cap", all("engagement" not in row["rule"] for row in added["caps"]), [row["rule"] for row in added["caps"]])

        rule = PlatformGovernancePolicy.objects.create(name="Test Unengaged Limit", scope="CHANNEL", channel="EMAIL", max_messages=1, period_days=1,
                                                                unengaged_days=120, unengaged_min_emails=4, applies_all=True)
        CommunicationGovernancePolicy.objects.create(tenant_id=tenant_id, name="Test Unengaged Limit", scope="CHANNEL", channel="EMAIL", max_messages=1, period_days=1,
                                                     unengaged_days=120, unengaged_min_emails=4, platform_policy_id=rule.pk)
        page = office.get("/api/v1/workspace/governance/").json()["unengaged"]
        check("the stricter platform rule applies, and is the limit", page["applies"] == {"days": 120, "min_emails": 4} and page["limit"] == {"days": 120, "min_emails": 4}
              and len(page["platform"]) == 1 and page["platform"][0]["platform"], page)
        longer = office.put("/api/v1/workspace/governance/unengaged/", json.dumps({"days": 150}), content_type="application/json")
        check("more days than the platform allows is refused, naming its limit", longer.status_code == 400 and "120" in json.dumps(longer.json()), longer.content[:300])
        shorter = office.put("/api/v1/workspace/governance/unengaged/", json.dumps({"days": 90, "min_emails": 3}), content_type="application/json")
        check("fewer days and emails are kept, and apply", shorter.status_code == 200 and shorter.json()["applies"] == {"days": 90, "min_emails": 3}, shorter.content[:300])
        transaction.set_rollback(True, using="default")
        transaction.set_rollback(True, using=P)
    check.done()


@pytest.mark.django_db(databases=["default", "platform"])
def test_the_back_office_form_makes_an_unengaged_rule_for_email_and_pushes_it(check):
    from apps.platform_ops.admin_governance import ONE, UNENGAGED, PlatformPolicyForm
    token = context.set_platform(True)
    try:
        with transaction.atomic(using=P):
            made = Tenant.objects.using(P).create(name="Governance Unengaged Test", code="ZZGOVU")
            with connections[P].cursor() as cursor:
                cursor.execute("SELECT fn_provision_tenant(%s::uuid, 3)", [str(made.pk)])
            form = PlatformPolicyForm(data={"name": "Test Unengaged", "kind": UNENGAGED, "scope": "GLOBAL", "unengaged_days": 270, "unengaged_min_emails": 5,
                                            "priority": 10, "is_active": "on", "reach": ONE, "workspace": str(made.pk)})
            check("the form takes an unengaged rule", form.is_valid(), form.errors)
            policy = form.save(commit=False)
            check("saved for email, not a cap", (policy.scope, policy.channel, policy.unengaged_days, policy.unengaged_min_emails, policy.gap_hours, policy.blackout_from)
                  == ("CHANNEL", "EMAIL", 270, 5, None, None), (policy.scope, policy.channel))
            policy.save(using=P)
            check("the back-office words it", policy.rule() == "No engagement in 270 days, after at least 5 marketing emails", policy.rule())
            platform.push(policy, using=P)
            copy = CommunicationGovernancePolicy.objects.using(P).get(platform_policy_id=policy.pk, tenant_id=made.pk, deleted_at__isnull=True)
            check("the workspace's copy carries the rule", (copy.unengaged_days, copy.unengaged_min_emails, copy.channel) == (270, 5, "EMAIL"))
            bad = PlatformPolicyForm(data={"name": "Test Unengaged Long", "kind": UNENGAGED, "scope": "CHANNEL", "channel": "EMAIL", "unengaged_days": 400,
                                           "unengaged_min_emails": 5, "priority": 10, "is_active": "on", "reach": ONE, "workspace": str(made.pk)})
            check("more than 360 days is refused", not bad.is_valid() and "unengaged_days" in bad.errors, bad.errors)
            cap = PlatformPolicyForm(data={"name": "Test Plain Cap", "kind": "CAP", "scope": "CHANNEL", "channel": "EMAIL", "max_messages": 2, "period_days": 7,
                                           "unengaged_days": 180, "unengaged_min_emails": 5, "priority": 10, "is_active": "on", "reach": ONE, "workspace": str(made.pk)})
            check("a cap drops the unengaged fields", cap.is_valid() and cap.save(commit=False).unengaged_days is None, cap.errors)
            transaction.set_rollback(True, using=P)
    finally:
        context.reset_platform(token)
    check.done()
