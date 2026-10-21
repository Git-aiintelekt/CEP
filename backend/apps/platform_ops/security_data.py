"""The Security page's data checks: what this server's own database says about workspace isolation, accounts and keys, and
the domains each workspace sends from. Read only; security.run() calls them once patch 0067 allows their kinds.

  isolation_findings()  every table holding workspace rows that the app's login can read keeps each workspace's rows apart
                        (forced row-level security), unless it is a platform table; the app's login cannot bypass it
  account_findings()    staff who stopped signing in, staff without a second factor, accounts that look like tests,
                        workspace API keys that are old or unused, mail engines whose callbacks are not signed
  mail_findings()       SPF and DMARC of every workspace's sending domain (apps.delivery.domain_health); DKIM is checked on the
                        workspace's own Settings → Delivery, where it gives its engine's selector

Each returns (findings, passed); a finding has the shape security.py saves.
"""
import re
from datetime import timedelta

from django.conf import settings
from django.db import connections
from django.utils import timezone

P = settings.PLATFORM_ALIAS
STALE_DAYS = 90
KEY_AGE_DAYS = 365
# a workspace table outside row-level security on purpose, besides the platform's own (settings.CONTROL_PLANE_MODELS)
ISOLATION_EXCEPTIONS = {"insights_embed": "an embed link is found by the hash of its secret; every query names its workspace"}
TEST_EMAIL = re.compile(r"@(example\.(com|org|net)|[^@]*\.(test|invalid|local|localhost|example))$|^(test|demo)[0-9._+-]*@", re.I)


def _rows(alias: str, sql: str, args=None) -> list[dict]:
    with connections[alias].cursor() as cursor:
        cursor.execute(sql, args or [])
        names = [c.name for c in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]


def _finding(kind: str, key: str, item: str, title: str, detail: str, now, should, severity: str, link: dict | None = None) -> dict:
    return {"fingerprint": f"{kind}:{key}"[:200], "kind": kind, "ecosystem": None, "item": item[:200], "title": title[:300], "detail": detail[:500],
            "installed": now, "fixed_in": should, "severity": severity, "advisories": [link] if link else []}


def _plural(n: int, word: str) -> str:
    return f"{n:,} {word}{'' if n == 1 else 's'}"


# ------------------------------------------------------------------------------------------------ workspace isolation
def isolation_findings() -> tuple[list[dict], list[str]]:
    login = _rows("default", "SELECT current_user AS name")[0]["name"]
    tables = _rows("default", """
        SELECT c.relname AS name, c.relispartition AS partition, c.relrowsecurity AND c.relforcerowsecurity AS forced,
               CASE WHEN c.relispartition THEN (SELECT r.relname FROM pg_class r WHERE r.oid = pg_partition_root(c.oid)) END AS root,
               has_table_privilege(current_user, c.oid, 'SELECT') AS readable
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
           AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)""")
    platform = set(settings.CONTROL_PLANE_MODELS) | set(ISOLATION_EXCEPTIONS)
    findings, kept, by_design, open_tables = [], 0, 0, {}
    for t in tables:
        if t["forced"]:
            kept += not t["partition"]
        elif (t["root"] or t["name"]) in platform:
            by_design += not t["partition"]
        elif t["readable"]:
            open_tables.setdefault(t["root"] or t["name"], []).append(t["name"])     # a partitioned table's partitions are one item
    for table, names in sorted(open_tables.items()):
        parts = [n for n in names if n != table]
        findings.append(_finding("DATABASE", f"rls:{table}", table, f"{table} does not keep workspaces apart",
                                 ("It holds workspace rows and the app's login reads it" + (f" ({_plural(len(parts), 'partition')} read directly)" if parts else "") +
                                  " without forced row-level security: a query that forgets the workspace filter returns every workspace's rows."),
                                 "Not forced", "Forced, with a policy", "HIGH",
                                 {"id": "PostgreSQL: row security", "url": "https://www.postgresql.org/docs/current/ddl-rowsecurity.html", "summary": ""}))
    passed = [f"{_plural(kept, 'workspace table')} keep each workspace's rows apart"]
    if by_design:
        passed.append(f"{_plural(by_design, 'platform table')} sit outside row-level security by design")

    role = _rows("default", """
        SELECT bool_or(r.rolsuper) AS superuser, bool_or(r.rolbypassrls) AS bypass
          FROM pg_roles r WHERE pg_has_role(current_user, r.oid, 'MEMBER')""")[0]
    if role["superuser"] or role["bypass"]:
        findings.append(_finding("DATABASE", "login:bypass", login, "The app's login skips row-level security",
                                 f"{login} {'is a superuser' if role['superuser'] else 'may bypass row-level security'} (itself or through a role it belongs to): "
                                 "no workspace table keeps workspaces apart for it.", "Bypasses", "NOBYPASSRLS, not a superuser", "CRITICAL"))
    else:
        passed.append("The app's login is held to row-level security")
    if _rows("default", "SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create")[0]["can_create"]:
        findings.append(_finding("DATABASE", "login:create", login, "The app's login can create tables",
                                 "A table it creates is outside every grant and policy; schema changes belong to the owner login and the patches.",
                                 "CREATE on public", "USAGE only", "MEDIUM"))
    else:
        passed.append("The app's login cannot change the schema")
    return findings, passed


# ------------------------------------------------------------------------------------------------ accounts and keys
def _day(value) -> str:
    return f"{value:%d %b %Y}" if value else "Never"


def account_findings() -> tuple[list[dict], list[str]]:
    from . import params
    findings, passed = [], []
    since = timezone.now() - timedelta(days=STALE_DAYS)
    staff = _rows(P, """SELECT u.id, u.email, u.is_platform_admin, u.last_login_at, u.mfa_enabled, u.auth_provider
                          FROM app_user u WHERE u.is_active AND (u.is_staff OR u.is_platform_admin) ORDER BY u.email""")
    for u in staff:
        if u["last_login_at"] is None or u["last_login_at"] < since:
            days = f"for {(timezone.now() - u['last_login_at']).days} days" if u["last_login_at"] else "yet"
            findings.append(_finding("ACCOUNT", f"stale:{u['id']}", u["email"], f"{u['email']} has not signed in {days}",
                                     "A platform account nobody uses still opens every workspace. Deactivate it in the back-office if it is no longer needed.",
                                     _day(u["last_login_at"]), "Deactivated, or in use", "HIGH" if u["is_platform_admin"] else "MEDIUM"))
    if staff and not any(f["fingerprint"].startswith("ACCOUNT:stale:") for f in findings):
        passed.append(f"Every platform account signed in within {STALE_DAYS} days")

    local_staff = [u for u in staff if u["auth_provider"] == "LOCAL"]
    without = [u["email"] for u in local_staff if not u["mfa_enabled"]]
    if params.get("security.mfa_required_for_staff", True):
        passed.append("Platform staff must use a second factor")
    elif without:
        findings.append(_finding("ACCOUNT", "staff-mfa", "security.mfa_required_for_staff", "Platform staff can sign in with a password alone",
                                 f"{_plural(len(without), 'staff account')} without a second factor ({', '.join(without[:5])}{'…' if len(without) > 5 else ''}), "
                                 "and Global Parameters do not require one.", "Not required", "Required", "HIGH"))
    if local_staff and not without:
        passed.append("Every platform account has a second factor")

    tests = _rows(P, """SELECT u.email, u.is_staff OR u.is_platform_admin AS staff, t.code FROM app_user u JOIN tenant t ON t.id = u.tenant_id
                         WHERE u.is_active ORDER BY u.email""")
    tests = [u for u in tests if TEST_EMAIL.search(u["email"] or "")]
    for u in tests:
        findings.append(_finding("ACCOUNT", f"test:{u['email']}", u["email"], f"{u['email']} looks like a test account",
                                 f"An active account in {u['code']} with a test address: whoever set it up may still know its password.",
                                 "Active", "Deactivated", "MEDIUM" if u["staff"] else "LOW"))
    if not tests:
        passed.append("No active account looks like a test account")

    users = _rows(P, """SELECT t.code, count(*) AS n FROM app_user u JOIN tenant t ON t.id = u.tenant_id
                         WHERE u.is_active AND NOT (u.is_staff OR u.is_platform_admin) AND (u.last_login_at IS NULL OR u.last_login_at < %s)
                         GROUP BY t.code ORDER BY count(*) DESC""", [since])
    if users:
        total = sum(u["n"] for u in users)
        findings.append(_finding("ACCOUNT", "stale-users", "workspace accounts", f"{_plural(total, 'workspace account')} unused for {STALE_DAYS} days",
                                 "Active accounts nobody signs in with: " + ", ".join(f"{u['code']} {u['n']}" for u in users[:8]) +
                                 ". Each workspace's administrators can deactivate them under Settings → Users.", f"{total:,} active", "Deactivated", "LOW"))
    else:
        passed.append(f"Every workspace account signed in within {STALE_DAYS} days")

    keys = _rows(P, """SELECT k.id, k.key_prefix, k.name, k.created_at, k.last_used_at, t.code FROM api_client k JOIN tenant t ON t.id = k.tenant_id
                        WHERE k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now()) ORDER BY k.created_at""")
    old, idle = timezone.now() - timedelta(days=KEY_AGE_DAYS), timezone.now() - timedelta(days=STALE_DAYS)
    flagged = 0
    for k in keys:
        where = f"{k['code']}'s key {k['name']}"
        if k["created_at"] < old:
            flagged += 1
            findings.append(_finding("ACCOUNT", f"key-age:{k['id']}", k["key_prefix"], f"API key {k['key_prefix']} is over a year old",
                                     f"{where} has never been replaced. Issue a new one, switch the client system over, then revoke this one.",
                                     f"Made {_day(k['created_at'])}", "Replaced yearly", "MEDIUM"))
        elif (k["last_used_at"] or k["created_at"]) < idle:
            flagged += 1
            findings.append(_finding("ACCOUNT", f"key-idle:{k['id']}", k["key_prefix"], f"API key {k['key_prefix']} is not used",
                                     f"{where} has not been used for {STALE_DAYS} days: revoke it if nothing needs it.",
                                     f"Last used {_day(k['last_used_at'])}", "Revoked", "LOW"))
    if keys and not flagged:
        passed.append(f"{_plural(len(keys), 'API key')} in use and under a year old")

    engines = _rows(P, """SELECT d.id, d.name, t.code FROM delivery_provider d JOIN tenant t ON t.id = d.tenant_id
                           WHERE d.is_active AND d.provider_type = 'POSTAL' AND coalesce(d.config->>'webhook_public_key', '') = ''""")
    for e in engines:
        findings.append(_finding("ACCOUNT", f"engine-signing:{e['id']}", e["name"], f"Callbacks from {e['name']} are not signed",
                                 f"{e['code']}'s Postal engine accepts delivery callbacks on their secret address alone. Add the Postal server's signing key "
                                 "to the engine, so a leaked address cannot fake bounces or opens.", "Address only", "Signed (X-Postal-Signature)", "MEDIUM"))
    if not engines:
        passed.append("Mail engine callbacks are signed")
    return findings, passed


# ------------------------------------------------------------------------------------------------ sending domains
SPF_FINDINGS = {  # status: (title, why, now, should, severity)
    "MISSING": ("{d} has no SPF record", "Receiving servers cannot tell which servers may send for it: mail is more often filtered, and easier to forge.",
                "None", "v=spf1 include:… ~all", "HIGH"),
    "MULTIPLE": ("{d} has more than one SPF record", "Two or more SPF records make the check fail outright: merge them into one.", "Several records", "One record", "MEDIUM"),
    "ANY": ("{d}'s SPF lets any server send", "The record ends in +all: every server on the internet passes.", "+all", "-all or ~all", "HIGH"),
}
DMARC_FINDINGS = {
    "MISSING": ("{d} has no DMARC record", "Nothing tells receivers what to do with mail that fails SPF and DKIM, so forged mail in this name is delivered.",
                "None", "p=quarantine or p=reject", "MEDIUM"),
    "MONITOR": ("{d}'s DMARC only watches", "The policy is p=none: reports arrive, but forged mail is still delivered.", "p=none", "p=quarantine or p=reject", "LOW"),
}


def mail_findings() -> tuple[list[dict], list[str]]:
    """the verdicts of apps.delivery.domain_health, the same the workspace's Settings → Delivery shows"""
    from apps.delivery import domain_health
    domains = _rows(P, """SELECT lower(split_part(s.from_address::text, '@', 2)) AS domain, array_agg(DISTINCT t.code ORDER BY t.code) AS workspaces
                            FROM sender_profile s JOIN tenant t ON t.id = s.tenant_id
                           WHERE s.channel = 'EMAIL' AND s.deleted_at IS NULL AND s.from_address IS NOT NULL
                           GROUP BY 1 ORDER BY 1""")
    findings, passed, good, reserved = [], [], 0, 0
    links = {"spf": {"id": "RFC 7208: SPF", "url": "https://www.rfc-editor.org/rfc/rfc7208", "summary": ""},
             "dmarc": {"id": "RFC 7489: DMARC", "url": "https://www.rfc-editor.org/rfc/rfc7489", "summary": ""}}
    for d in domains:
        domain = d["domain"]
        if not domain:
            continue
        result = domain_health.evaluate(domain)
        if result["lookup"] == "EXAMPLE":
            reserved += 1
            continue
        who = "Used by " + ", ".join(d["workspaces"]) + ". "
        if result["lookup"] == "NO_ANSWER":
            findings.append(_finding("MAIL", f"{domain}:dns", domain, f"{domain} could not be looked up", who + "DNS did not answer from this server.",
                                     "No answer", "SPF and DMARC records", "LOW"))
            continue
        before = len(findings)
        for part, table in (("spf", SPF_FINDINGS), ("dmarc", DMARC_FINDINGS)):
            if result[part]["status"] in table:
                title, why, now, should, severity = table[result[part]["status"]]
                findings.append(_finding("MAIL", f"{domain}:{part}", domain, title.format(d=domain), who + why, now, should, severity, links[part]))
        good += len(findings) == before
    if good:
        passed.append(f"{_plural(good, 'sending domain')} with SPF and an enforced DMARC policy")
    if reserved:
        passed.append(f"{_plural(reserved, 'sending domain')} reserved for examples, not looked up")
    if not domains:
        passed.append("No workspace sends email from its own domain yet")
    return findings, passed
