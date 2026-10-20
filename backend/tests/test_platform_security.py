"""The back-office Security page: the installed packages looked up in OSV.dev (faked here), Django's deployment checks and the
site's headers read into findings; the page without patch 0066 says so; with it, a check, Accept the Risk, a fix found by the
next check, the badge and the Home card. Rolled back."""
import json
from datetime import date, timedelta
from unittest import mock

import pytest
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.db import connections
from django.test import Client

from apps.identity.models import AppUser
from apps.platform_ops import admin_ui, security

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS

ADVISORIES = {
    "PYSEC-2026-1": {"id": "PYSEC-2026-1", "summary": "A crafted token crashes the request", "aliases": ["GHSA-aaaa-bbbb-cccc"],
                     "affected": [{"package": {"ecosystem": "PyPI", "name": "PyJWT"}, "ranges": [{"events": [{"introduced": "0"}, {"fixed": "2.15.0"}]}]}]},
    "GHSA-aaaa-bbbb-cccc": {"id": "GHSA-aaaa-bbbb-cccc", "database_specific": {"severity": "HIGH"}},
    "GHSA-dddd-eeee-ffff": {"id": "GHSA-dddd-eeee-ffff", "summary": "Event-loop denial of service", "database_specific": {"severity": "MODERATE"},
                            "affected": [{"package": {"ecosystem": "npm", "name": "source-map-js"}, "ranges": [{"events": [{"introduced": "1.0.0"}, {"fixed": "1.2.2"}]}]}]},
    "GHSA-589f-c66p-hxr4": {"id": "GHSA-589f-c66p-hxr4", "summary": "grapesjs before 0.19.5 vulnerable to Cross-site Scripting", "database_specific": {"severity": "MODERATE"},
                            "affected": [{"package": {"ecosystem": "npm", "name": "grapesjs"}, "ranges": [{"type": "SEMVER", "events": [{"introduced": "0"}]}],
                                          "database_specific": {"last_known_affected_version_range": "< 0.19.5"}}]},
}


class _Answer:
    def __init__(self, data, ok=True):
        self._data, self.ok = data, ok

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


def _osv(vulnerable: dict):
    """requests.post/get stand-ins: the batch answers with the advisories of the packages named in `vulnerable`"""
    def post(url, json=None, timeout=None):
        return _Answer({"results": [{"vulns": [{"id": i} for i in vulnerable.get((q["package"]["ecosystem"], q["package"]["name"]), [])]} for q in json["queries"]]})

    def get(url, timeout=None):
        return _Answer(ADVISORIES.get(url.rsplit("/", 1)[-1], {}), ok=url.rsplit("/", 1)[-1] in ADVISORIES)
    return post, get


def test_checks(check, tmp_path):
    lock = tmp_path / "package-lock.json"
    lock.write_text(json.dumps({"packages": {"": {"name": "app"}, "node_modules/source-map-js": {"version": "1.2.1", "dev": True},
                                             "node_modules/react": {"version": "19.2.0"}, "node_modules/vite/node_modules/source-map-js": {"version": "1.2.1", "dev": True}}}))
    npm = security.npm_packages(lock)
    check("the lock file's packages are read, a build-time one marked", npm == {"source-map-js": ("1.2.1", True), "react": ("19.2.0", False)}, str(npm))
    post, get = _osv({("PyPI", "pyjwt"): ["PYSEC-2026-1"], ("npm", "source-map-js"): ["GHSA-dddd-eeee-ffff"]})
    with mock.patch.object(security.requests, "post", side_effect=post), mock.patch.object(security.requests, "get", side_effect=get):
        found = {f["item"]: f for f in security.package_findings({"pyjwt": "2.14.0", "django": "6.1.1"}, npm)}
    jwt, maps = found.get("pyjwt", {}), found.get("source-map-js", {})
    check("a PYSEC advisory takes its GHSA twin's rating, with the version that fixes it", jwt.get("severity") == "HIGH" and jwt.get("fixed_in") == "2.15.0"
          and jwt.get("advisories", [{}])[0].get("url") == "https://osv.dev/vulnerability/PYSEC-2026-1", str(jwt))
    check("a moderate npm advisory is Medium and says it is build-time only", maps.get("severity") == "MEDIUM" and "Build-time only" in maps.get("detail", "")
          and maps.get("fixed_in") == "1.2.2" and set(found) == {"pyjwt", "source-map-js"}, str(maps))

    post, get = _osv({("npm", "grapesjs"): ["GHSA-589f-c66p-hxr4"]})
    with mock.patch.object(security.requests, "post", side_effect=post), mock.patch.object(security.requests, "get", side_effect=get):
        newer = security.package_findings({}, {"grapesjs": ("0.23.6", False)})
        older = security.package_findings({}, {"grapesjs": ("0.19.4", False)})
    check("an advisory without a fixed version is dropped when the installed version is past its last affected one, and kept before it",
          newer == [] and [f["item"] for f in older] == ["grapesjs"], str(newer) + str(older))

    page = {"url": "https://cep.example/", "headers": {"strict-transport-security": "max-age=31536000", "x-content-type-options": "nosniff", "x-frame-options": "DENY"}}
    with mock.patch.object(security, "site_headers", return_value=page):
        findings, passed, read = security.setting_findings()
    by_item = {f["item"]: f for f in findings}
    check("Django's checks become settings to fix: debug on is High", settings.DEBUG is False or by_item.get("security.W018", {}).get("severity") == "HIGH", str(list(by_item)))
    check("a header the site does not send is a finding, the ones it sends pass, and HSTS is read from the site rather than the settings",
          read and "csp" in by_item and "hsts" not in by_item and "security.W004" not in by_item and "The site sends nosniff" in passed and "Framing is refused" in passed,
          str(list(by_item)) + str(passed))
    with mock.patch.object(security, "site_headers", side_effect=security.CheckFailed("https://cep.example/ could not be reached: ConnectTimeout.")):
        findings, passed, read = security.setting_findings()
    check("an unreachable site is a Low item and its headers are not judged", not read and any(f["item"] == "security.site_address" and f["severity"] == "LOW" for f in findings))
    check("the tile caption names packages and settings", security._split([{"severity": "HIGH", "kind": "PACKAGE"}, {"severity": "HIGH", "kind": "SETTING"},
                                                                            {"severity": "CRITICAL", "kind": "SETTING"}], ("CRITICAL", "HIGH")) == "1 package, 2 settings"
          and security._split([], ("LOW",)) == "nothing open")
    check.done()


def _present() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.security_finding') IS NOT NULL")
        return cursor.fetchone()[0]


def test_page(check):
    staff = AppUser.objects.using(P).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
    if staff is None:
        pytest.skip("no platform superuser in this database")
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        office = Client()
        office.force_login(staff)
        if not _present():
            page = office.get("/admin/platform_ops/securityfinding/")
            check("before patch 0066 the page says it needs the database update", page.status_code == 200 and b"patch 0066" in page.content, str(page.status_code))
            check.done()
            pytest.skip("patch 0066 (the Security tables) has not been applied to this database")

        post, get = _osv({("PyPI", "pyjwt"): ["PYSEC-2026-1"], ("npm", "source-map-js"): ["GHSA-dddd-eeee-ffff"]})
        page_headers = {"url": "https://cep.example/", "headers": {"x-content-type-options": "nosniff"}}
        with mock.patch.object(security.requests, "post", side_effect=post), mock.patch.object(security.requests, "get", side_effect=get), \
                mock.patch.object(security, "site_headers", return_value=page_headers), \
                mock.patch.object(security, "python_packages", return_value={"pyjwt": "2.14.0", "django": "6.1.1"}), \
                mock.patch.object(security, "npm_packages", return_value={"source-map-js": ("1.2.1", True), "react": ("19.2.0", False)}), \
                mock.patch.dict("os.environ", {"CEP_SECURITY_HOST": "test-host"}):
            ran = office.post("/admin/platform_ops/securityfinding/check/")
            page = office.get("/admin/platform_ops/securityfinding/")
            body = page.content.decode()
            check("Check Now runs the check and the page lists what needs attention, worst first", ran.status_code == 302 and page.status_code == 200
                  and "Needs Attention" in body and body.index("pyjwt") < body.index("source-map-js") and "PYSEC-2026-1" in body and "2.15.0" in body, str(page.status_code))
            check("the badge counts the open Critical and High items, and Home shows a card", (admin_ui.security_badge(None) or 0) >= 1
                  and any(i["title"].startswith(tuple(str(n) for n in range(1, 30))) and "security item" in i["title"] for i in admin_ui._security_attention()))
            maps = next(r for r in security.overview()["open"] if r["item"] == "source-map-js")
            refused = office.post(f"/admin/platform_ops/securityfinding/{maps['id']}/accept/", {"reason": "short", "review_on": (date.today() + timedelta(days=30)).isoformat()})
            check("accepting needs a reason in a sentence", refused.status_code == 200 and b"Say why" in refused.content)
            accepted = office.post(f"/admin/platform_ops/securityfinding/{maps['id']}/accept/",
                                   {"reason": "A build-time tool: it never reaches a browser.", "review_on": (date.today() + timedelta(days=30)).isoformat()})
            data = security.overview()
            check("an accepted item leaves the open list and shows under Accepted with who and why", accepted.status_code == 302
                  and not any(r["item"] == "source-map-js" for r in data["open"]) and data["accepted"][0]["accept_reason"].startswith("A build-time tool"))

        post, get = _osv({("npm", "source-map-js"): ["GHSA-dddd-eeee-ffff", "GHSA-new"]})
        with mock.patch.object(security.requests, "post", side_effect=post), mock.patch.object(security.requests, "get", side_effect=get), \
                mock.patch.object(security, "site_headers", return_value=page_headers), \
                mock.patch.object(security, "python_packages", return_value={"pyjwt": "2.15.1", "django": "6.1.1"}), \
                mock.patch.object(security, "npm_packages", return_value={"source-map-js": ("1.2.1", True)}), \
                mock.patch.dict("os.environ", {"CEP_SECURITY_HOST": "test-host"}):
            result = security.run("SCHEDULE")
            data = security.overview()
        jwt = security._q("SELECT status, fixed_at FROM security_finding WHERE host = 'test-host' AND item = 'pyjwt'", one=True)
        check("the next check marks the updated package fixed and says so in the history", jwt["status"] == "FIXED" and jwt["fixed_at"] is not None
              and result["fixed"] >= 1 and "pyjwt 2.15.1" in data["checks"][0]["fixed"], str(jwt) + str(data["checks"][0]["fixed"]))
        check("an accepted item opens again when a newer advisory appears", any(r["item"] == "source-map-js" for r in data["open"]))
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    check.done()
