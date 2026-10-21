"""The Security page's data checks on the local database: workspace tables keep workspaces apart unless they are the
platform's own, the app's login is held to row-level security; stale and test-looking accounts, old and unused API keys,
unsigned engine callbacks; SPF and DMARC of the sending domains (DNS faked). Every change rolled back."""
from datetime import timedelta
from unittest import mock

import pytest
from django.conf import settings
from django.db import connections
from django.utils import timezone

from apps.delivery import domain_health
from apps.platform_ops import security, security_data

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS


def _run(sql, args=None):
    with connections[P].cursor() as cursor:
        cursor.execute(sql, args or [])
        return cursor.fetchall() if cursor.description else None


def _by_key(findings):
    return {f["fingerprint"]: f for f in findings}


def test_isolation(check):
    findings, passed = security_data.isolation_findings()
    check("on this database every workspace table the app reads keeps workspaces apart, or is a platform table",
          not [f for f in findings if f["fingerprint"].startswith("DATABASE:rls:")], str([f["item"] for f in findings]))
    check("the app's login is held to row-level security and cannot change the schema",
          "The app's login is held to row-level security" in passed and "The app's login cannot change the schema" in passed, str(passed))
    check("the passed lines count the tables", any("workspace tables keep each workspace's rows apart" in p for p in passed)
          and any("platform tables sit outside row-level security by design" in p for p in passed), str(passed))

    with mock.patch.object(settings, "CONTROL_PLANE_MODELS", set(settings.CONTROL_PLANE_MODELS) - {"error_event"}):
        findings, _ = security_data.isolation_findings()
    leak = _by_key(findings).get("DATABASE:rls:error_event", {})
    check("a workspace table the app reads without forced row-level security, not a platform table, is High",
          leak.get("severity") == "HIGH" and leak.get("kind") == "DATABASE" and "every workspace's rows" in leak.get("detail", ""), str(leak))
    check.done()


def test_accounts(check):
    long_ago = timezone.now() - timedelta(days=200)
    admin = _run("SELECT id, email FROM app_user WHERE is_active AND is_platform_admin ORDER BY created_at LIMIT 1")
    if not admin:
        pytest.skip("no platform administrator in this database")
    admin_id, admin_email = admin[0]
    _run("UPDATE app_user SET last_login_at = %s WHERE id = %s", [long_ago, admin_id])
    member = _run("SELECT id FROM app_user WHERE is_active AND NOT (is_staff OR is_platform_admin) ORDER BY created_at LIMIT 1")
    if member:
        _run("UPDATE app_user SET email = 'test1@example.com' WHERE id = %s", [member[0][0]])
    key = _run("SELECT id, key_prefix FROM api_client WHERE revoked_at IS NULL ORDER BY created_at LIMIT 1")
    if key:
        _run("UPDATE api_client SET created_at = now() - interval '400 days', expires_at = NULL WHERE id = %s", [key[0][0]])
    _run("UPDATE delivery_provider SET config = config - 'webhook_public_key' WHERE provider_type = 'POSTAL'")

    with mock.patch("apps.platform_ops.params.get", side_effect=lambda name, default=None: False if name == "security.mfa_required_for_staff" else default):
        findings, passed = security_data.account_findings()
    found = _by_key(findings)
    stale = found.get(f"ACCOUNT:stale:{admin_id}", {})
    check("a platform administrator who has not signed in for 200 days is High", stale.get("severity") == "HIGH" and "200 days" in stale.get("title", ""), str(stale))
    if member:
        test = found.get("ACCOUNT:test:test1@example.com", {})
        check("an active workspace account with a test address is Low", test.get("severity") == "LOW" and "looks like a test account" in test.get("title", ""), str(test))
    if key:
        aged = found.get(f"ACCOUNT:key-age:{key[0][0]}", {})
        check("an API key over a year old is Medium and named by its prefix", aged.get("severity") == "MEDIUM" and aged.get("item") == key[0][1], str(aged))
    engines = [f for f in findings if f["fingerprint"].startswith("ACCOUNT:engine-signing:")]
    if _run("SELECT 1 FROM delivery_provider WHERE is_active AND provider_type = 'POSTAL'"):
        check("a Postal engine without the signing key is Medium", engines and engines[0]["severity"] == "MEDIUM", str(engines))
    no_mfa = found.get("ACCOUNT:staff-mfa")
    has_mfa = _run("SELECT bool_and(mfa_enabled) FROM app_user WHERE is_active AND (is_staff OR is_platform_admin) AND auth_provider = 'LOCAL'")[0][0]
    check("staff without a second factor, when Global Parameters do not require one, is High",
          (no_mfa or {}).get("severity") == "HIGH" if not has_mfa else no_mfa is None, str(no_mfa))

    _run("UPDATE app_user SET last_login_at = now() WHERE is_active AND (is_staff OR is_platform_admin)")
    _run("""UPDATE delivery_provider SET config = config || '{"webhook_public_key": "MIIB"}'::jsonb WHERE provider_type = 'POSTAL'""")
    with mock.patch("apps.platform_ops.params.get", side_effect=lambda name, default=None: True if name == "security.mfa_required_for_staff" else default):
        findings, passed = security_data.account_findings()
    check("once staff sign in, callbacks are signed and second factors are required, those pass",
          not [f for f in findings if f["fingerprint"].split(":")[1] in ("stale", "engine-signing", "staff-mfa")]
          and "Platform staff must use a second factor" in passed and "Mail engine callbacks are signed" in passed
          and f"Every platform account signed in within {security_data.STALE_DAYS} days" in passed, str(passed) + str([f["fingerprint"] for f in findings]))
    check.done()


def test_sending_domains(check):
    sender = _run("SELECT id FROM sender_profile WHERE channel = 'EMAIL' AND deleted_at IS NULL ORDER BY created_at LIMIT 1")
    if not sender:
        pytest.skip("no email sender in this database")
    _run("UPDATE sender_profile SET deleted_at = now() WHERE channel = 'EMAIL' AND id <> %s", [sender[0][0]])
    _run("UPDATE sender_profile SET from_address = 'news@mail.example' WHERE id = %s", [sender[0][0]])
    with mock.patch.object(domain_health, "txt", side_effect=AssertionError("a reserved domain is never looked up")):
        findings, passed = security_data.mail_findings()
    check("a domain reserved for examples is not looked up", not findings and any("reserved for examples" in p for p in passed), str(passed))

    _run("UPDATE sender_profile SET from_address = 'news@shop.co' WHERE id = %s", [sender[0][0]])

    def answers(spf, dmarc):
        return mock.patch.object(domain_health, "txt", side_effect=lambda name: dmarc if name.startswith("_dmarc.") else spf)

    for label, spf, dmarc, expect in (
            ("no SPF and no DMARC", [], [], {"MAIL:shop.co:spf": "HIGH", "MAIL:shop.co:dmarc": "MEDIUM"}),
            ("two SPF records", ["v=spf1 include:a -all", "v=spf1 include:b -all"], ["v=DMARC1; p=reject"], {"MAIL:shop.co:spf": "MEDIUM"}),
            ("SPF that lets anyone send", ["v=spf1 +all"], ["v=DMARC1; p=quarantine"], {"MAIL:shop.co:spf": "HIGH"}),
            ("SPF ending in bare all", ["v=spf1 include:a all"], ["v=DMARC1; p=quarantine"], {"MAIL:shop.co:spf": "HIGH"}),
            ("DMARC that only watches", ["v=spf1 include:mailgun.org ~all", "google-site-verification=x"], ["v=DMARC1; p=none; rua=mailto:d@shop.co"],
             {"MAIL:shop.co:dmarc": "LOW"}),
            ("DNS not answering", None, None, {"MAIL:shop.co:dns": "LOW"}),
            ("a sound domain", ["v=spf1 include:spf.postal.example -all"], ["v=DMARC1; p=reject; pct=100"], {})):
        with answers(spf, dmarc):
            findings, passed = security_data.mail_findings()
        got = {f["fingerprint"]: f["severity"] for f in findings}
        check(f"{label}: {expect or 'passes'}", got == expect and all(f["kind"] == "MAIL" and "shop.co" in f["item"] for f in findings), str(got) + str(passed))
    check("a sound domain is counted as passing", any("with SPF and an enforced DMARC policy" in p for p in passed), str(passed))
    check.done()


def test_run_without_patch_0067(check):
    if not security.present():
        pytest.skip("patch 0066 (the Security tables) has not been applied to this database")
    if security.data_allowed():
        pytest.skip("patch 0067 is applied here: the full cycle is checked by the dry run with it")
    with mock.patch.object(security, "setting_findings", return_value=([], ["Debug mode is off"], False)), \
            mock.patch.object(security, "package_findings", return_value=[]), \
            mock.patch.object(security_data, "isolation_findings", side_effect=AssertionError("not before patch 0067")), \
            mock.patch.dict("os.environ", {"CEP_SECURITY_HOST": "test-host-data"}):
        result = security.run("SCHEDULE")
        data = security.overview()
    check("before patch 0067 the check still finishes, without the data checks and without an error",
          "error" not in result and data["last"]["status"] == "DONE" and not data["data_checked"] and data["passed_data"] == {}, str(result))
    check.done()
