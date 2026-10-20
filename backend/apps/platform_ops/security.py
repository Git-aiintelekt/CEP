"""The back-office Security page's checks: each server checks itself, daily (the check-security job) and on Check Now.

  run(trigger, user_id)      one check: the packages, the settings and the site's headers; findings kept across checks
  overview(host)             what the page shows: open items worst first, accepted ones, counts, what passed, the last checks
  accept(...) / reopen(...)  Accept the Risk with a reason and a review date; or open an accepted item again

Packages: every Python package installed here and every npm package in the deployed frontend's package-lock.json, looked up
in OSV.dev (the open vulnerability database behind the GitHub, PyPI and npm advisories). Settings: Django's own deployment
checks (debug, cookies, the signing key, allowed hosts), whether the development web server is serving (read from the
running processes, on Linux), and the headers the site really sends (from security.site_address). Nothing is installed or
changed: a fix arrives with a deploy, and the next check marks the item fixed. An accepted item opens again on its review
date, or when an advisory appears that was not there when it was accepted.

Tables security_check and security_finding (patch 0066).
"""
import json
import os
import re
import socket
from datetime import date
from importlib import metadata

import requests
from django.conf import settings
from django.db import connections
from django.utils import timezone

P = settings.PLATFORM_ALIAS
OSV = "https://api.osv.dev/v1"
SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW")
RANK = {name: i for i, name in enumerate(SEVERITIES)}
OSV_SEVERITY = {"CRITICAL": "CRITICAL", "HIGH": "HIGH", "MODERATE": "MEDIUM", "MEDIUM": "MEDIUM", "LOW": "LOW"}
LOCK_FILE = settings.BASE_DIR.parent / "frontend" / "package-lock.json"
JSON_COLUMNS = {"found", "fixed", "advisories", "accepted_advisories"}         # Django's connection hands JSONB back as text

# Django's deployment checks read here: (what is wrong, why it matters, now, should be, severity, what passing reads as)
DJANGO_CHECKS = {
    "security.W018": ("Debug mode is on", "Error pages show code, settings and the request to anyone who reaches one.", "On", "Off", "HIGH", "Debug mode is off"),
    "security.W009": ("The signing key is weak", "SECRET_KEY is short, simple or the placeholder: sessions and tokens can be forged.", "Weak", "50+ random characters", "CRITICAL", "The signing key is strong"),
    "security.W020": ("ALLOWED_HOSTS is empty", "Any host name is answered.", "Empty", "The site's host names", "HIGH", "Allowed hosts are set"),
    "security.W012": ("The session cookie is not HTTPS-only", "SESSION_COOKIE_SECURE is off: the cookie can travel over plain HTTP.", "Off", "On", "HIGH", "The session cookie is HTTPS-only"),
    "security.W016": ("The CSRF cookie is not HTTPS-only", "CSRF_COOKIE_SECURE is off.", "Off", "On", "MEDIUM", "The CSRF cookie is HTTPS-only"),
    "security.W004": ("HSTS is not set in the settings", "SECURE_HSTS_SECONDS is not set, and the site's own header was not read.", "Not set", "1 year", "MEDIUM", "HSTS is set"),
    "security.W008": ("Django does not redirect to HTTPS", "SECURE_SSL_REDIRECT is off: fine when the proxy in front redirects; accept the risk then.", "Off", "On", "LOW",
                      "Requests are redirected to HTTPS"),
}
HSTS_CHECKS = {"security.W004", "security.W005", "security.W021"}            # answered by the site's real header when it was read


class CheckFailed(Exception):
    """What went wrong, in words for the page."""


def host() -> str:
    return (os.environ.get("CEP_SECURITY_HOST") or socket.gethostname())[:200]


def _q(sql: str, args=None, *, one=False):
    with connections[P].cursor() as cursor:
        cursor.execute(sql, args or [])
        if cursor.description is None:
            return None
        names = [c.name for c in cursor.description]
        rows = [{k: (json.loads(v) if k in JSON_COLUMNS and isinstance(v, str) else v) for k, v in zip(names, row)} for row in cursor.fetchall()]
    return (rows[0] if rows else None) if one else rows


def present() -> bool:
    """the tables are there (patch 0066): asked first, so a missing table never aborts the caller's transaction"""
    return bool(_q("SELECT to_regclass('public.security_finding') IS NOT NULL AS ok", one=True)["ok"])


# ------------------------------------------------------------------------------------------------ what is installed
def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def python_packages() -> dict[str, str]:
    """name -> version of every Python package installed for this process"""
    out = {}
    for dist in metadata.distributions():
        name = dist.metadata.get("Name")
        if name and dist.version:
            out[_norm(name)] = dist.version
    return out


def npm_packages(lock_file=LOCK_FILE) -> dict[str, tuple[str, bool]]:
    """name -> (version, build-time only) of every package in the deployed frontend's lock file; {} when it is not here"""
    try:
        data = json.loads(open(lock_file, encoding="utf-8").read())
    except (OSError, ValueError):
        return {}
    out: dict[str, tuple[str, bool]] = {}
    for path, entry in (data.get("packages") or {}).items():
        if not path or entry.get("link") or not entry.get("version"):
            continue
        name = path.split("node_modules/")[-1]
        dev = bool(entry.get("dev"))
        if name not in out or (out[name][1] and not dev):                   # a package shipped somewhere counts as shipped
            out[name] = (entry["version"], dev)
    return out


# ------------------------------------------------------------------------------------------------ OSV.dev
def _osv_batch(queries: list[tuple[str, str, str]]) -> dict[tuple[str, str, str], list[str]]:
    """(ecosystem, name, version) -> the ids of the advisories that affect it"""
    hits = {}
    for start in range(0, len(queries), 500):
        chunk = queries[start:start + 500]
        try:
            response = requests.post(f"{OSV}/querybatch", json={"queries": [{"package": {"name": n, "ecosystem": e}, "version": v} for e, n, v in chunk]}, timeout=30)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise CheckFailed(f"OSV.dev could not be reached: {exc.__class__.__name__}.") from None
        for query, result in zip(chunk, response.json().get("results") or []):
            ids = [v["id"] for v in result.get("vulns") or [] if v.get("id")]
            if ids:
                hits[query] = ids
    return hits


def _advisory(vuln_id: str, cache: dict) -> dict:
    if vuln_id not in cache:
        try:
            response = requests.get(f"{OSV}/vulns/{vuln_id}", timeout=20)
            cache[vuln_id] = response.json() if response.ok else {"id": vuln_id}
        except requests.RequestException:
            cache[vuln_id] = {"id": vuln_id}
    return cache[vuln_id]


def _severity(advisory: dict, cache: dict) -> str | None:
    rated = OSV_SEVERITY.get(str((advisory.get("database_specific") or {}).get("severity") or "").upper())
    if rated:
        return rated
    for alias in advisory.get("aliases") or []:                      # a PYSEC advisory carries no rating; its GHSA twin does
        if alias.startswith("GHSA-"):
            rated = OSV_SEVERITY.get(str((_advisory(alias, cache).get("database_specific") or {}).get("severity") or "").upper())
            if rated:
                return rated
    return None


def _version_key(text: str):
    try:
        from packaging.version import Version
        return (0, Version(text))
    except Exception:                                                  # noqa: BLE001  npm versions packaging cannot read
        return (1, tuple(int(p) if p.isdigit() else 0 for p in re.split(r"[.\-+]", text)))


def _fixed_in(advisory: dict, ecosystem: str, name: str, installed: str) -> str | None:
    fixes = []
    for affected in advisory.get("affected") or []:
        package = affected.get("package") or {}
        if package.get("ecosystem") != ecosystem or _norm(package.get("name", "")) != _norm(name):
            continue
        for rng in affected.get("ranges") or []:
            fixes += [event["fixed"] for event in rng.get("events") or [] if event.get("fixed")]
    later = sorted((f for f in fixes if _version_key(f) > _version_key(installed)), key=_version_key)
    return later[0] if later else (sorted(fixes, key=_version_key)[-1] if fixes else None)


def _past_affected(advisory: dict, ecosystem: str, name: str, installed: str) -> bool:
    """an advisory with no fixed version can still name its last affected one ("< 0.19.5") beside the ranges, which OSV.dev
    does not apply when it matches: the installed version past it is not affected"""
    bounds = []
    for affected in advisory.get("affected") or []:
        package = affected.get("package") or {}
        if package.get("ecosystem") != ecosystem or _norm(package.get("name", "")) != _norm(name):
            continue
        match = re.fullmatch(r"\s*(<=?)\s*v?([\w.\-+]+)\s*", str((affected.get("database_specific") or {}).get("last_known_affected_version_range") or ""))
        if match is None:
            return False
        bounds.append(match.groups())
    return bool(bounds) and all(_version_key(installed) >= _version_key(v) if op == "<" else _version_key(installed) > _version_key(v)
                                for op, v in bounds)


def _link(vuln_id: str) -> str:
    return f"https://github.com/advisories/{vuln_id}" if vuln_id.startswith("GHSA-") else f"https://osv.dev/vulnerability/{vuln_id}"


def package_findings(python: dict, npm: dict) -> list[dict]:
    queries = [("PyPI", name, version) for name, version in python.items()] + [("npm", name, info[0]) for name, info in npm.items()]
    hits = _osv_batch(queries)
    cache: dict = {}
    findings = []
    for (ecosystem, name, version), ids in hits.items():
        advisories, worst, fixes, summary = [], None, [], None
        for vuln_id in ids:
            advisory = _advisory(vuln_id, cache)
            if _past_affected(advisory, ecosystem, name, version):
                continue
            severity = _severity(advisory, cache) or "MEDIUM"
            worst = severity if worst is None or RANK[severity] < RANK[worst] else worst
            fixed = _fixed_in(advisory, ecosystem, name, version)
            if fixed:
                fixes.append(fixed)
            summary = summary or advisory.get("summary") or (advisory.get("details") or "")[:200]
            advisories.append({"id": vuln_id, "url": _link(vuln_id), "summary": (advisory.get("summary") or "")[:200], "severity": severity})
        if not advisories:
            continue
        build_only = ecosystem == "npm" and npm.get(name, ("", False))[1]
        detail = (summary or "A known advisory.")[:400] + (" Build-time only: it never reaches a browser." if build_only else "")
        findings.append({"fingerprint": f"PACKAGE:{ecosystem}:{name}", "kind": "PACKAGE", "ecosystem": ecosystem, "item": name, "title": name, "detail": detail[:500],
                         "installed": version, "fixed_in": max(fixes, key=_version_key) if fixes else None, "severity": worst or "MEDIUM",
                         "advisories": sorted(advisories, key=lambda a: RANK[a["severity"]])})
    return findings


# ------------------------------------------------------------------------------------------------ settings and headers
def _web_servers() -> set[str] | None:
    """what serves the app on this machine, read from the running processes (Linux); None where that cannot be read"""
    if not os.path.isdir("/proc"):
        return None
    found = set()
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            words = [w.decode(errors="ignore") for w in open(f"/proc/{pid}/cmdline", "rb").read().split(b"\0") if w]
        except OSError:
            continue
        if any(w.endswith("manage.py") for w in words) and "runserver" in words:
            found.add("runserver")
        elif any(re.search(r"(^|/)(gunicorn|uvicorn|daphne|uwsgi)\b", w) for w in words[:3]):
            found.add("production")
    return found


def site_headers() -> dict | None:
    """the headers the site's public address sends (None when security.site_address is not set); CheckFailed if unreachable"""
    from . import params
    address = str(params.get("security.site_address", "") or "").strip()
    if not address:
        return None
    try:
        response = requests.get(address, timeout=15, allow_redirects=True)
    except requests.RequestException as exc:
        raise CheckFailed(f"{address} could not be reached: {exc.__class__.__name__}.") from None
    return {"url": response.url, "headers": {k.lower(): v for k, v in response.headers.items()}}


def setting_findings() -> tuple[list[dict], list[str], bool]:
    """(what fails, what passed, whether the site's headers were read)"""
    from django.core.checks import run_checks
    findings, passed = [], []
    try:
        site = site_headers()
    except CheckFailed as exc:
        site = None
        findings.append({"fingerprint": "HEADER:site", "kind": "HEADER", "ecosystem": None, "item": "security.site_address", "title": "The site could not be read",
                         "detail": str(exc), "installed": None, "fixed_in": None, "severity": "LOW", "advisories": []})
    failing = {m.id: m for m in run_checks(include_deployment_checks=True, tags=["security"])}
    if site is not None:
        failing = {k: v for k, v in failing.items() if k not in HSTS_CHECKS}
    for check_id, message in failing.items():
        title, why, now, should, severity, _ok = DJANGO_CHECKS.get(check_id, (message.msg.split(".")[0][:200], (message.hint or message.msg)[:500], None, None, "MEDIUM", ""))
        findings.append({"fingerprint": f"SETTING:{check_id}", "kind": "SETTING", "ecosystem": None, "item": check_id, "title": title, "detail": why, "installed": now,
                         "fixed_in": should, "severity": severity,
                         "advisories": [{"id": f"Django {check_id.split('.')[-1]}", "url": "https://docs.djangoproject.com/en/stable/ref/checks/#security", "summary": ""}]})
    passed += [ok for check_id, (*_, ok) in DJANGO_CHECKS.items() if check_id not in failing and not (site is not None and check_id in HSTS_CHECKS)]
    servers = _web_servers()
    if servers is not None:
        if "runserver" in servers:
            findings.append({"fingerprint": "SETTING:web-server", "kind": "SETTING", "ecosystem": None, "item": "web-server", "title": "The development web server is serving",
                             "detail": "manage.py runserver is not built for internet traffic.", "installed": "runserver", "fixed_in": "gunicorn", "severity": "HIGH",
                             "advisories": [{"id": "Django: runserver", "url": "https://docs.djangoproject.com/en/stable/ref/django-admin/#runserver", "summary": ""}]})
        else:
            passed.append("A production web server serves the app")
    if site is not None:
        headers = site["headers"]
        frame = "frame-ancestors" in headers.get("content-security-policy", "").lower() or headers.get("x-frame-options", "").upper() in ("DENY", "SAMEORIGIN")
        for key, ok, title, why, should, severity, passed_title in (
                ("hsts", "strict-transport-security" in headers or not site["url"].startswith("https"), "No HSTS header", "Browsers are not told to use HTTPS only.",
                 "max-age=31536000", "MEDIUM", "The site sends HSTS"),
                ("csp", "content-security-policy" in headers, "No Content-Security-Policy", "The site's pages do not limit which scripts may run.", "script-src 'self'", "MEDIUM",
                 "The site sends a Content-Security-Policy"),
                ("nosniff", headers.get("x-content-type-options", "").lower() == "nosniff", "No nosniff header", "Browsers may guess a file's type.", "nosniff", "LOW",
                 "The site sends nosniff"),
                ("framing", frame, "Other sites can frame the app", "Neither X-Frame-Options nor frame-ancestors is sent.", "frame-ancestors 'none'", "MEDIUM",
                 "Framing is refused")):
            if ok:
                passed.append(passed_title)
            else:
                findings.append({"fingerprint": f"HEADER:{key}", "kind": "HEADER", "ecosystem": None, "item": key, "title": title, "detail": why, "installed": "Not sent",
                                 "fixed_in": should, "severity": severity, "advisories": []})
    return findings, passed, site is not None


# ------------------------------------------------------------------------------------------------ one check
def _reconcile(where: str, findings: list[dict], kinds: set[str], python: dict, npm: dict) -> list[str]:
    """findings saved: new ones open, known ones refreshed, a fixed one that is back opens again, an accepted one opens again on
    its review date or with an advisory it was not accepted with; what is no longer found is fixed. Returns what was fixed."""
    today = timezone.localdate()
    known = {row["fingerprint"]: row for row in _q("SELECT * FROM security_finding WHERE host = %s", [where])}
    seen = set()
    for f in findings:
        seen.add(f["fingerprint"])
        row = known.get(f["fingerprint"])
        ids = [a["id"] for a in f["advisories"]]
        if row is None:
            _q("""INSERT INTO security_finding (host, fingerprint, kind, ecosystem, item, title, detail, installed, fixed_in, severity, advisories)
                  VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
               [where, f["fingerprint"], f["kind"], f["ecosystem"], f["item"], f["title"], f["detail"], f["installed"], f["fixed_in"], f["severity"], json.dumps(f["advisories"])])
            continue
        status = row["status"]
        if status == "FIXED":
            status = "OPEN"
        elif status == "ACCEPTED" and ((row["review_on"] and row["review_on"] <= today) or set(ids) - set(row["accepted_advisories"] or [])):
            status = "OPEN"
        _q("""UPDATE security_finding SET title = %s, detail = %s, installed = %s, fixed_in = %s, severity = %s, advisories = %s, status = %s, last_seen = now(),
                     fixed_at = CASE WHEN %s = 'OPEN' AND status = 'FIXED' THEN NULL ELSE fixed_at END, row_version = row_version + 1 WHERE id = %s""",
           [f["title"], f["detail"], f["installed"], f["fixed_in"], f["severity"], json.dumps(f["advisories"]), status, status, row["id"]])
    fixed = []
    for fingerprint, row in known.items():
        if fingerprint in seen or row["status"] == "FIXED" or row["kind"] not in kinds:
            continue
        _q("UPDATE security_finding SET status = 'FIXED', fixed_at = now(), row_version = row_version + 1 WHERE id = %s", [row["id"]])
        now = python.get(row["item"]) if row["ecosystem"] == "PyPI" else (npm.get(row["item"], (None,))[0] if row["ecosystem"] == "npm" else None)
        fixed.append(f"{row['title']} {now}" if now else row["title"])
    return fixed


def run(trigger: str = "SCHEDULE", user_id=None) -> dict:
    """one check of this server; the result as the job reports it"""
    if not present():
        raise CheckFailed("The Security tables are not there yet: apply patch 0066.")
    where = host()
    check = _q("INSERT INTO security_check (host, trigger, triggered_by) VALUES (%s, %s, %s) RETURNING id", [where, trigger, str(user_id) if user_id else None], one=True)["id"]
    error, kinds = None, {"SETTING", "HEADER"}
    python, npm = python_packages(), npm_packages()
    findings, passed, headers_read = setting_findings()
    try:
        findings += package_findings(python, npm)
        kinds.add("PACKAGE")
    except CheckFailed as exc:
        error = f"{exc} Packages were not checked; their earlier findings stand."
    try:
        fixed = _reconcile(where, findings, kinds, python, npm)
        counts = {s: 0 for s in SEVERITIES}
        for row in _q("SELECT severity, count(*) AS n FROM security_finding WHERE host = %s AND status = 'OPEN' GROUP BY severity", [where]):
            counts[row["severity"]] = row["n"]
        found = {**counts, "passed": passed, "headers_read": headers_read}
        _q("""UPDATE security_check SET finished_at = now(), status = %s, python_packages = %s, npm_packages = %s, settings_checked = %s, found = %s, fixed = %s, error = %s
              WHERE id = %s""", ["FAILED" if error else "DONE", len(python), len(npm), len(passed) + sum(1 for f in findings if f["kind"] != "PACKAGE"),
                                 json.dumps(found), json.dumps(fixed), error, check])
    except Exception as exc:
        _q("UPDATE security_check SET finished_at = now(), status = 'FAILED', error = %s WHERE id = %s", [f"{exc.__class__.__name__}: {exc}"[:500], check])
        raise
    from django.core.cache import cache
    cache.delete("cep:admin:security")
    return {"host": where, **counts, "fixed": len(fixed), "python": len(python), "npm": len(npm), **({"error": error} if error else {})}


# ------------------------------------------------------------------------------------------------ the page
def open_counts(where: str | None = None) -> dict:
    counts = {s: 0 for s in SEVERITIES}
    if not present():                                                 # before patch 0066: nothing to show
        return counts
    for row in _q("SELECT severity, count(*) AS n FROM security_finding WHERE host = %s AND status = 'OPEN' GROUP BY severity", [where or host()]):
        counts[row["severity"]] = row["n"]
    return counts


def _split(rows: list[dict], severities: tuple) -> str:
    """'1 package, 3 settings' for the open items of these severities; 'nothing open' when there are none"""
    packages = sum(1 for r in rows if r["severity"] in severities and r["kind"] == "PACKAGE")
    others = sum(1 for r in rows if r["severity"] in severities and r["kind"] != "PACKAGE")
    parts = [f"{n} {word}{'' if n == 1 else 's'}" for n, word in ((packages, "package"), (others, "setting")) if n]
    return ", ".join(parts) or "nothing open"


def overview(where: str | None = None) -> dict | None:
    """None before patch 0066"""
    if not present():
        return None
    where = where or host()
    rows = _q("""SELECT f.*, u.display_name AS accepted_by_name FROM security_finding f LEFT JOIN app_user u ON u.id = f.accepted_by
                  WHERE f.host = %s ORDER BY array_position(ARRAY['CRITICAL','HIGH','MEDIUM','LOW']::varchar[], f.severity), f.first_seen""", [where])
    checks = _q("""SELECT c.*, u.display_name AS by_name FROM security_check c LEFT JOIN app_user u ON u.id = c.triggered_by
                    WHERE c.host = %s AND c.started_at > now() - interval '30 days' ORDER BY c.started_at DESC, c.id DESC LIMIT 60""", [where])
    last = next((c for c in checks if c["status"] != "RUNNING"), None)
    open_rows = [r for r in rows if r["status"] == "OPEN"]
    accepted = [r for r in rows if r["status"] == "ACCEPTED"]
    flagged = {(r["ecosystem"], r["item"]) for r in open_rows + accepted if r["kind"] == "PACKAGE"}
    found = (last or {}).get("found") or {}
    return {"host": where, "open": open_rows, "accepted": accepted, "last": last, "checks": checks,
            "high": sum(1 for r in open_rows if r["severity"] in ("CRITICAL", "HIGH")), "lower": sum(1 for r in open_rows if r["severity"] in ("MEDIUM", "LOW")),
            "high_packages": sum(1 for r in open_rows if r["severity"] in ("CRITICAL", "HIGH") and r["kind"] == "PACKAGE"),
            "lower_packages": sum(1 for r in open_rows if r["severity"] in ("MEDIUM", "LOW") and r["kind"] == "PACKAGE"),
            "high_caption": _split(open_rows, ("CRITICAL", "HIGH")), "lower_caption": _split(open_rows, ("MEDIUM", "LOW")),
            "python_ok": max(0, (last or {}).get("python_packages", 0) - sum(1 for e, _ in flagged if e == "PyPI")),
            "npm_ok": max(0, (last or {}).get("npm_packages", 0) - sum(1 for e, _ in flagged if e == "npm")),
            "passed": found.get("passed") or [], "headers_read": bool(found.get("headers_read"))}


def accept(finding_id: int, user_id, reason: str, review_on: date) -> None:
    row = _q("SELECT advisories FROM security_finding WHERE id = %s AND host = %s", [finding_id, host()], one=True)
    if row is None:
        raise CheckFailed("No such item on this server.")
    _q("""UPDATE security_finding SET status = 'ACCEPTED', accepted_by = %s, accepted_at = now(), accept_reason = %s, review_on = %s, accepted_advisories = %s,
                 row_version = row_version + 1 WHERE id = %s""",
       [str(user_id), reason[:500], review_on, json.dumps([a["id"] for a in row["advisories"] or []]), finding_id])
    from django.core.cache import cache
    cache.delete("cep:admin:security")


def reopen(finding_id: int) -> None:
    _q("UPDATE security_finding SET status = 'OPEN', row_version = row_version + 1 WHERE id = %s AND host = %s AND status = 'ACCEPTED'", [finding_id, host()])
    from django.core.cache import cache
    cache.delete("cep:admin:security")
