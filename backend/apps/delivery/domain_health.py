"""Sending domains: the DNS records inboxes read before they trust a workspace's mail, looked up from this server's resolver.

  evaluate(domain, selector, mechanism)  SPF, DMARC and (with the engine's selector) DKIM of one domain: a status each, what was
                                         found, and the record to publish when one is missing or weak
  workspace_domains(alias, tenant_id)    the domains a workspace's email senders send from, with the senders and the SPF mechanism
                                         their engine needs
  refresh(alias, tenant_id, only)        looks them up and keeps the results in sending_domain (patch 0068)
  overview(tenant_id)                    what Settings → Delivery → Sending Domains shows
  set_selector(...)                      a domain's DKIM selector, then that domain looked up again

The daily check-sending-domains job refreshes every workspace; Check Now refreshes one, at most once a minute. The back-office
Security page reads the same evaluate(). Nothing in DNS is ever changed.
"""
import json
import re
from urllib.parse import urlparse

from django.db import connections

DNS_TIMEOUT = 5
RESERVED = re.compile(r"(^|\.)(example(\.(com|org|net))?|test|invalid|local|localhost)$", re.I)
SELECTOR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
SPF_FOR_ENGINE = {"SENDGRID": "include:sendgrid.net"}


def txt(name: str) -> list[str] | None:
    """the TXT strings at a name; [] when there are none, None when DNS could not answer"""
    import dns.exception
    import dns.resolver
    resolver = dns.resolver.Resolver()
    resolver.lifetime = DNS_TIMEOUT
    try:
        answer = resolver.resolve(name, "TXT")
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return []
    except (dns.exception.DNSException, OSError):
        return None
    return [b"".join(record.strings).decode("utf-8", "replace") for record in answer]


def mechanism(provider_type: str, config: dict) -> str | None:
    """what a domain's SPF record must name for this engine to send for it: the engine's own setting, Postal's spf. host, the mail server"""
    config = config or {}
    if config.get("spf_include"):
        return f"include:{config['spf_include']}"
    if provider_type == "POSTAL" and config.get("endpoint"):
        host = urlparse(str(config["endpoint"])).hostname
        return f"include:spf.{host}" if host else None
    if provider_type == "SMTP" and config.get("host"):
        return f"a:{config['host']}"
    return SPF_FOR_ENGINE.get(provider_type)


def evaluate(domain: str, selector: str | None = None, spf_mechanism: str | None = None) -> dict:
    domain = domain.lower().strip(".")
    dmarc_name = f"_dmarc.{domain}"
    dkim_name = f"{selector}._domainkey.{domain}" if selector else None
    result = {"lookup": "OK", "spf": {"status": None, "found": [], "publish": None},
              "dmarc": {"status": None, "found": [], "name": dmarc_name, "publish": None},
              "dkim": {"status": "NOT_CHECKED", "found": [], "name": dkim_name}, "changes": 0}
    if RESERVED.search(domain):
        result["lookup"] = "EXAMPLE"
        return result
    spf, dmarc = txt(domain), txt(dmarc_name)
    dkim = txt(dkim_name) if dkim_name else []
    if spf is None or dmarc is None or (dkim_name and dkim is None):
        result["lookup"] = "NO_ANSWER"
        return result

    spf = [r for r in spf if r.lower().startswith("v=spf1")]
    result["spf"]["found"] = spf
    if not spf:
        result["spf"].update(status="MISSING", publish=f"v=spf1 {spf_mechanism} ~all" if spf_mechanism else None)
    elif len(spf) > 1:
        result["spf"]["status"] = "MULTIPLE"
    elif re.search(r"(^|\s)\+?all(\s|$)", spf[0].lower()):
        result["spf"].update(status="ANY", publish=re.sub(r"(^|\s)\+?all(?=\s|$)", r"\1~all", spf[0], flags=re.I))
    else:
        result["spf"]["status"] = "PASS"

    dmarc = [r for r in dmarc if r.lower().startswith("v=dmarc1")]
    result["dmarc"]["found"] = dmarc
    policy = (re.search(r"(?:^|;)\s*p\s*=\s*(\w+)", dmarc[0].lower()) or [None, None])[1] if dmarc else None
    if not dmarc:
        result["dmarc"].update(status="MISSING", publish=f"v=DMARC1; p=quarantine; rua=mailto:dmarc@{domain}")
    elif policy not in ("quarantine", "reject"):
        result["dmarc"].update(status="MONITOR", publish=re.sub(r"((?:^|;)\s*p\s*=\s*)\w*", r"\1quarantine", dmarc[0], count=1, flags=re.I)
                               if policy else dmarc[0].rstrip("; ") + "; p=quarantine")
    else:
        result["dmarc"]["status"] = "PASS"

    if dkim_name:
        found = [r for r in dkim if "p=" in r.replace(" ", "").lower()]
        result["dkim"].update(status="PASS" if found else "MISSING", found=found)
    result["changes"] = sum(1 for part in ("spf", "dmarc", "dkim") if result[part]["status"] not in ("PASS", "NOT_CHECKED", None))
    return result


# ------------------------------------------------------------------------------------------------ a workspace's domains
def _rows(alias: str, sql: str, args=None) -> list[dict]:
    with connections[alias].cursor() as cursor:
        cursor.execute(sql, args or [])
        if cursor.description is None:
            return []
        names = [c.name for c in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]


def present(alias: str = "default") -> bool:
    """the table is there (patch 0068): asked first, so a missing table never aborts the caller's transaction"""
    return bool(_rows(alias, "SELECT to_regclass('public.sending_domain') IS NOT NULL AS ok")[0]["ok"])


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def workspace_domains(alias: str, tenant_id) -> dict[str, dict]:
    rows = _rows(alias, """
        SELECT lower(split_part(s.from_address::text, '@', 2)) AS domain, s.id, s.display_name, s.from_address::text AS from_address,
               d.provider_type, d.config
          FROM sender_profile s JOIN delivery_provider d ON d.id = s.delivery_provider_id
         WHERE s.tenant_id = %s AND s.channel = 'EMAIL' AND s.deleted_at IS NULL AND s.from_address IS NOT NULL
         ORDER BY s.display_name""", [str(tenant_id)])
    domains: dict[str, dict] = {}
    for r in rows:
        if not r["domain"]:
            continue
        entry = domains.setdefault(r["domain"], {"domain": r["domain"], "senders": [], "mechanism": None})
        entry["senders"].append({"id": str(r["id"]), "display_name": r["display_name"], "from_address": r["from_address"]})
        entry["mechanism"] = entry["mechanism"] or mechanism(r["provider_type"], _json(r["config"]) or {})
    return domains


def refresh(alias: str, tenant_id, only: set[str] | None = None) -> int:
    """looks up the workspace's domains (or only these) and keeps the results; the number looked up (0 before patch 0068)"""
    if not present(alias):
        return 0
    selectors = {r["domain"]: r["dkim_selector"] for r in _rows(alias, "SELECT domain::text AS domain, dkim_selector FROM sending_domain WHERE tenant_id = %s", [str(tenant_id)])}
    done = 0
    for domain, entry in workspace_domains(alias, tenant_id).items():
        if only is not None and domain not in only:
            continue
        result = evaluate(domain, selectors.get(domain), entry["mechanism"])
        _rows(alias, """
            INSERT INTO sending_domain (tenant_id, domain, result, checked_at) VALUES (%s, %s, %s, now())
            ON CONFLICT (tenant_id, domain) DO UPDATE SET result = EXCLUDED.result, checked_at = now(), updated_at = now(),
                                                           row_version = sending_domain.row_version + 1""", [str(tenant_id), domain, json.dumps(result)])
        done += 1
    return done


def overview(tenant_id, alias: str = "default") -> dict:
    ready = present(alias)
    kept = {r["domain"]: r for r in _rows(alias, """SELECT domain::text AS domain, dkim_selector, result, checked_at FROM sending_domain
                                                       WHERE tenant_id = %s""", [str(tenant_id)])} if ready else {}
    domains = []
    for domain, entry in workspace_domains(alias, tenant_id).items():
        row = kept.get(domain) or {}
        domains.append({"domain": domain, "senders": entry["senders"], "dkim_selector": row.get("dkim_selector"),
                        "result": _json(row.get("result")) or None, "checked_at": row.get("checked_at")})
    domains.sort(key=lambda d: (-((d["result"] or {}).get("changes") or 0), d["domain"]))
    checked = [d["checked_at"] for d in domains if d["checked_at"]]
    return {"checked_at": min(checked) if checked else None, "domains": domains, "ready": ready}


def set_selector(tenant_id, domain: str, selector: str, user_id, alias: str = "default") -> None:
    domain = domain.lower().strip()
    if domain not in workspace_domains(alias, tenant_id):
        raise ValueError("No email sender of this workspace sends from that domain.")
    selector = selector.strip()
    if selector and not SELECTOR.match(selector):
        raise ValueError("A selector is letters, digits, dots, hyphens and underscores, as your engine shows it.")
    _rows(alias, """
        INSERT INTO sending_domain (tenant_id, domain, dkim_selector, updated_by) VALUES (%s, %s, %s, %s)
        ON CONFLICT (tenant_id, domain) DO UPDATE SET dkim_selector = EXCLUDED.dkim_selector, updated_by = EXCLUDED.updated_by, updated_at = now(),
                                                       row_version = sending_domain.row_version + 1""", [str(tenant_id), domain, selector or None, str(user_id) if user_id else None])
    refresh(alias, tenant_id, only={domain})


def refresh_all() -> dict:
    """the daily job: every active workspace's domains, each workspace under its own row-level security"""
    from apps.delivery.engine import session
    from apps.journeys.engine import tenants
    done, failed = 0, []
    for tenant_id in tenants("SELECT id FROM tenant WHERE status = 'ACTIVE' ORDER BY code"):
        try:
            with session.tenant_scope(tenant_id) as scope, session.tx():
                done += refresh(scope.db_alias, tenant_id)
        except Exception as exc:                                            # noqa: BLE001  one workspace never stops the others
            failed.append(f"{tenant_id}: {exc.__class__.__name__}")
    return {"domains": done, "failed": failed}
