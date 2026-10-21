"""Settings → Delivery → Sending Domains: SPF, DMARC and DKIM verdicts with the record to publish (DNS faked), and the
workspace API: the list, Check Now at most once a minute, the DKIM selector. Rolled back."""
import json
from unittest import mock

import pytest
from django.core.cache import cache
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.delivery import domain_health
from apps.identity.models import AppUser
from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _dns(records: dict):
    """txt() stand-in: the TXT strings per name; a name missing from `records` has none, None means DNS did not answer"""
    return mock.patch.object(domain_health, "txt", side_effect=lambda name: records.get(name, []))


def test_verdicts(check):
    check("Postal's SPF host comes from its endpoint, a mail server's from its host, SendGrid's is known",
          domain_health.mechanism("POSTAL", {"endpoint": "https://emsb.lynxs.ai/"}) == "include:spf.emsb.lynxs.ai"
          and domain_health.mechanism("SMTP", {"host": "mail.shop.co"}) == "a:mail.shop.co"
          and domain_health.mechanism("SENDGRID", {}) == "include:sendgrid.net"
          and domain_health.mechanism("POSTAL", {"endpoint": "https://x", "spf_include": "_spf.custom.net"}) == "include:_spf.custom.net")

    with _dns({}):
        r = domain_health.evaluate("shop.co", None, "include:spf.emsb.lynxs.ai")
    check("nothing published: SPF and DMARC are missing, each with the record to publish; DKIM is not checked without a selector",
          r["spf"]["status"] == "MISSING" and r["spf"]["publish"] == "v=spf1 include:spf.emsb.lynxs.ai ~all"
          and r["dmarc"]["status"] == "MISSING" and r["dmarc"]["name"] == "_dmarc.shop.co" and r["dmarc"]["publish"] == "v=DMARC1; p=quarantine; rua=mailto:dmarc@shop.co"
          and r["dkim"]["status"] == "NOT_CHECKED" and r["changes"] == 2, json.dumps(r))

    with _dns({"shop.co": ["v=spf1 include:a +all"], "_dmarc.shop.co": ["v=DMARC1; p=none; rua=mailto:d@shop.co"],
               "postal-Xa71Qd._domainkey.shop.co": ["v=DKIM1; k=rsa; p=MIIBIjAN"]}):
        r = domain_health.evaluate("shop.co", "postal-Xa71Qd")
    check("an SPF that lets anyone send gets ~all in its place; a watching DMARC gets p=quarantine; DKIM found with the selector",
          r["spf"]["status"] == "ANY" and r["spf"]["publish"] == "v=spf1 include:a ~all"
          and r["dmarc"]["status"] == "MONITOR" and r["dmarc"]["publish"] == "v=DMARC1; p=quarantine; rua=mailto:d@shop.co"
          and r["dkim"]["status"] == "PASS" and r["dkim"]["name"] == "postal-Xa71Qd._domainkey.shop.co" and r["changes"] == 2, json.dumps(r))

    with _dns({"shop.co": ["v=spf1 include:a -all", "v=spf1 include:b -all"], "_dmarc.shop.co": ["v=DMARC1; p=reject"]}):
        r = domain_health.evaluate("shop.co", "wrong")
    check("two SPF records cannot be merged for you; an enforced DMARC passes; a selector with no key is missing",
          r["spf"]["status"] == "MULTIPLE" and r["spf"]["publish"] is None and len(r["spf"]["found"]) == 2
          and r["dmarc"]["status"] == "PASS" and r["dkim"]["status"] == "MISSING", json.dumps(r))

    with mock.patch.object(domain_health, "txt", return_value=None):
        r = domain_health.evaluate("shop.co")
    check("DNS not answering is said as such, with no verdicts", r["lookup"] == "NO_ANSWER" and r["spf"]["status"] is None)
    with mock.patch.object(domain_health, "txt", side_effect=AssertionError("never looked up")):
        r = domain_health.evaluate("mail.northwindapparel.example")
    check("a domain reserved for examples is not looked up", r["lookup"] == "EXAMPLE")
    check.done()


def _present() -> bool:
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.sending_domain') IS NOT NULL")
        return cursor.fetchone()[0]


def test_api(check, admin_email):
    if not _present():
        pytest.skip("patch 0068 (sending_domain) has not been applied to this database")
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    cache.delete(f"cep:sending-domains:{admin.tenant_id}")
    client = Client()
    headers = {"HTTP_X_TENANT": admin.tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def call(method, path, body=None):
        return getattr(client, method)(f"/api/v1/{path}", json.dumps(body) if body is not None else None, content_type="application/json", **headers)

    with transaction.atomic():
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(admin.tenant_id)])
            cursor.execute("""UPDATE sender_profile SET from_address = CASE WHEN display_name < 'M' THEN 'news@shop.co' ELSE 'offers@shop.co' END
                              WHERE tenant_id = %s AND channel = 'EMAIL' AND deleted_at IS NULL""", [str(admin.tenant_id)])
        listed = call("get", "sending-domains/").json()
        shop = next((d for d in listed.get("domains", []) if d["domain"] == "shop.co"), {})
        check("the domains come from the email senders, one row each with its senders, not looked up yet",
              shop and shop["result"] is None and len(shop["senders"]) >= 1 and all(d["domain"] != "" for d in listed["domains"]), json.dumps(listed)[:400])

        with _dns({"shop.co": ["v=spf1 include:spf.emsb.lynxs.ai ~all"]}):
            checked = call("post", "sending-domains/check/")
            again = call("post", "sending-domains/check/")
        shop = next((d for d in checked.json().get("domains", []) if d["domain"] == "shop.co"), {})
        check("Check Now looks the domains up and keeps the result", checked.status_code == 200 and shop.get("result", {}).get("spf", {}).get("status") == "PASS"
              and shop["result"]["dmarc"]["status"] == "MISSING" and shop["checked_at"], checked.content[:300])
        check("a second Check Now within the minute is refused", again.status_code == 429 and "less than a minute" in again.json().get("detail", ""), again.content[:200])

        bad = call("post", "sending-domains/selector/", {"domain": "shop.co", "selector": "bad selector!"})
        other = call("post", "sending-domains/selector/", {"domain": "someone-else.com", "selector": "s1"})
        check("a selector with spaces, or a domain no sender uses, is refused", bad.status_code == 400 and other.status_code == 400, bad.content[:200] + other.content[:200])
        with _dns({"shop.co": ["v=spf1 include:spf.emsb.lynxs.ai ~all"], "_dmarc.shop.co": ["v=DMARC1; p=reject"], "postal-Xa71Qd._domainkey.shop.co": ["v=DKIM1; p=MIIB"]}):
            saved = call("post", "sending-domains/selector/", {"domain": "shop.co", "selector": "postal-Xa71Qd"})
        shop = next((d for d in saved.json().get("domains", []) if d["domain"] == "shop.co"), {})
        check("a selector is kept and the domain looked up again with it", saved.status_code == 200 and shop.get("dkim_selector") == "postal-Xa71Qd"
              and shop["result"]["dkim"]["status"] == "PASS" and shop["result"]["changes"] == 0, saved.content[:300])
        with _dns({"shop.co": ["v=spf1 include:spf.emsb.lynxs.ai ~all"]}):
            daily = domain_health.refresh_all()
        check("the daily job looks up every workspace's domains, each under its own row-level security", daily["domains"] >= 1 and not daily["failed"], str(daily))
        transaction.set_rollback(True)
    cache.delete(f"cep:sending-domains:{admin.tenant_id}")
    check.done()
