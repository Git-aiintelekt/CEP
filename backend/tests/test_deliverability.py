"""Deliverability tests: the Inspect account, the allowance, a preview test from a template, and the quota. Rolled back; Inspect faked.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
import re
from unittest import mock
import requests
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery import deliverability
from apps.identity.models import AppUser
from apps.templates.models import RenderedTemplateContent, TemplateMaster
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_deliverability(check):
    """Deliverability tests: the Inspect account, the allowance, a preview test from a template, and the quota. Rolled back; Inspect faked."""
    schema = open("../database/CEP_Database_Schema_Platform_Operations.sql", encoding="utf-8").read()
    section = schema[schema.index("-- 18. DELIVERABILITY TESTS"):schema.index("-- End of platform operations layer.")]
    section = section[:section.rindex("-- ====")]
    # the app's database user has no DDL rights: the two tables become session-temporary copies (no foreign keys, no policies),
    # found first on the search path, and the plan's new column is faked through billing.plan_for
    tables = [m.group(0) for m in re.finditer(r"CREATE TABLE IF NOT EXISTS deliverability_\w+ \((?:.|\n)*?\n\);", section)]
    tables = [re.sub(r" REFERENCES \w+\(id\)( ON DELETE (?:CASCADE|SET NULL))?", "", t).replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE") for t in tables]
    LIMIT = {"value": 50}

    # ---- a fake Mailgun Inspect
    class FakeResponse:
        def __init__(self, status, payload):
            self.status_code, self._payload = status, payload
            self.content = json.dumps(payload).encode()
            self.text = self.content.decode()
            self.headers = {"Content-Type": "application/json"}
            self.elapsed = None

        def json(self):
            return self._payload

    CLIENTS = {"gmail_chr_win": {"id": "gmail_chr_win", "client": "Gmail", "os": "Windows", "category": "Web", "browser": "Chrome", "default": True, "image_blocking": True},
               "outlook16": {"id": "outlook16", "client": "Outlook 2016", "os": "Windows", "category": "Application", "default": True, "image_blocking": True},
               "iphone15": {"id": "iphone15", "client": "iPhone 15 (iOS 17)", "os": "iOS 17", "category": "Mobile", "default": True, "image_blocking": False}}
    fake = {"calls": [], "created": [], "key_ok": True, "round": 0}

    def fake_request(self, method, url, **kwargs):
        fake["calls"].append((method, url))
        if not fake["key_ok"]:
            return FakeResponse(401, {"message": "Unauthorized"})
        if url.endswith("/v1/preview/tests/clients"):
            return FakeResponse(200, {"clients": CLIENTS})
        if url.endswith("/v2/preview/tests") and method == "POST":
            fake["created"].append(kwargs.get("json"))
            return FakeResponse(200, {"id": f"insp-{len(fake['created'])}", "reference_id": kwargs["json"].get("reference_id")})
        if re.search(r"/v1/preview/tests/insp-\d+/results$", url):
            done = fake["round"] > 0
            shot = lambda c: {"display_name": CLIENTS[c]["client"], "client": CLIENTS[c]["client"], "os": CLIENTS[c]["os"], "category": CLIENTS[c]["category"],   # noqa: E731
                              "browser": CLIENTS[c].get("browser", ""), "status": "Complete" if done else "Processing",
                              "screenshots": {"default": f"https://shots.example/{c}.png"} if done else {}, "thumbnail": f"https://shots.example/{c}_t.png" if done else ""}
            payload = {c: {"id": c, **shot(c)} for c in ("gmail_chr_win", "outlook16")}
            payload["iphone15"] = {"id": "iphone15", "display_name": "iPhone 15", "client": "iPhone 15 (iOS 17)", "os": "iOS 17", "category": "Mobile", "status": "Bounced" if done else "Processing",
                                   "status_details": "The client did not load the message", "screenshots": {}}
            return FakeResponse(200, payload)
        return FakeResponse(404, {"message": "no route"})

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email="aby.john@aiintelekt.com")
    context.reset_platform(ptok)
    context.set_current(str(tenant.id), "default", str(user.pk))
    T = str(tenant.id)
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"), mock.patch.object(requests.Session, "request", fake_request):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
                for ddl in tables:
                    cursor.execute(ddl)
            from apps.platform_ops import billing, params
            params.invalidate(T)
            with connections["platform"].cursor() as c:                                     # the live plan row has no allowance column until patch 0030 runs
                c.execute("SELECT p.code, p.name FROM tenant_subscription s JOIN subscription_plan p ON p.id = s.plan_id WHERE s.tenant_id = %s ORDER BY s.started_at DESC LIMIT 1", [T])
                found = c.fetchone() or ("GROWTH", "Growth")
            real_plan = {"code": found[0], "name": found[1], "monthly_price": 0, "currency": "USD", "subscription_status": "ACTIVE"}
            stack = mock.patch.object(billing, "plan_for", lambda tenant_id: {**real_plan, "max_deliverability_tests": LIMIT["value"]})
            stack.start()
            def count_here(tenant_id):
                with connections["default"].cursor() as c:
                    c.execute("SELECT count(*) FROM deliverability_test WHERE tenant_id = %s AND requested_at >= %s", [str(tenant_id), billing.month_start()])
                    return c.fetchone()[0]
            mock.patch.object(billing, "tests_this_month", count_here).start()

            before = API.get("/api/v1/deliverability/service/").json()
            check("no account yet: configured false", before["configured"] is False and before["has_api_key"] is False, json.dumps(before)[:120])
            allowance = API.get("/api/v1/deliverability/allowance/").json()
            plan = billing.plan_for(T) or {}
            check("the allowance reads the plan's monthly limit and this month's count",
                  allowance["used"] == 0 and allowance["limit"] == plan.get("max_deliverability_tests") and allowance["configured"] is False, json.dumps(allowance)[:160])

            template = TemplateMaster.objects.filter(tenant_id=T, channel="EMAIL", deleted_at__isnull=True, rendered_template_contents__html_content__isnull=False).distinct().first()
            check("setup: an email template with rendered content", template is not None, getattr(template, "name", None))
            started_without = API.post(f"/api/v1/templates/{template.pk}/deliverability-tests/", {}, content_type="application/json")
            check("a test before the account is set up answers 409 with where to go", started_without.status_code == 409 and "Settings" in started_without.json().get("detail", ""), f"{started_without.status_code} {str(started_without.content)[:140]}")

            bad = API.put("/api/v1/deliverability/service/", {"region": "US", "username": "acct"}, content_type="application/json")
            check("saving without a key is refused on the field", bad.status_code == 400 and "api_key" in str(bad.content), f"{bad.status_code}")
            saved = API.put("/api/v1/deliverability/service/", {"region": "EU", "username": "acct", "api_key": "key-123", "default_clients": ["gmail_chr_win", "outlook16", "iphone15"]}, content_type="application/json")
            body = saved.json() if saved.status_code == 200 else {}
            check("the account saves with the key write-only and the region", saved.status_code == 200 and body.get("has_api_key") and body.get("region") == "EU" and "api_key" not in body and body["default_clients"] == ["gmail_chr_win", "outlook16", "iphone15"], f"{saved.status_code} {str(saved.content)[:160]}")
            service = deliverability.service_for(T)
            check("and the key is stored encrypted", service.api_key_enc and "key-123" not in service.api_key_enc)

            fake["key_ok"] = False
            checked = API.post("/api/v1/deliverability/service/check/").json()
            check("Check Connection reports a refused key", checked["ok"] is False and "refused" in (checked["detail"] or ""), json.dumps(checked)[:120])
            fake["key_ok"] = True
            checked = API.post("/api/v1/deliverability/service/check/").json()
            check("and success when the key works, against the EU host", checked["ok"] is True and any("api.eu.mailgun.net" in url for _, url in fake["calls"]), json.dumps(checked)[:80])

            clients = API.get("/api/v1/deliverability/clients/").json()
            check("the clients list comes from Inspect, flattened and sorted by category", [c["id"] for c in clients["clients"]] == ["outlook16", "iphone15", "gmail_chr_win"] and clients["clients"][0]["category"] == "Application", json.dumps(clients)[:160])
            n_calls = len(fake["calls"])
            API.get("/api/v1/deliverability/clients/")
            check("and is cached", len(fake["calls"]) == n_calls)

            started = API.post(f"/api/v1/templates/{template.pk}/deliverability-tests/", {}, content_type="application/json")
            test = started.json() if started.status_code == 201 else {}
            check("a preview test starts: 201, PENDING, the template's version, the three default clients, the slots for spam and placement",
                  started.status_code == 201 and test["status"] == "PENDING" and test["kind"] == "PREVIEW" and test["clients"] == ["gmail_chr_win", "outlook16", "iphone15"]
                  and test["spam"] is None and test["placement"] is None and test["template_version"] >= 1, f"{started.status_code} {str(started.content)[:200]}")
            sent = fake["created"][-1]
            check("Inspect received the subject, the HTML with the tags filled from samples, the clients and no content checking",
                  sent["subject"] and "{{" not in sent["subject"] and "<html" in sent["html"].lower() and sent["clients"] == ["gmail_chr_win", "outlook16", "iphone15"]
                  and sent["content_checking"] == {"link_validation": False, "image_validation": False, "accessibility": False, "code_analysis": False}
                  and sent["reference_id"].startswith("cep:"), json.dumps({k: (v[:60] if isinstance(v, str) else v) for k, v in sent.items()})[:300])
            content = RenderedTemplateContent.objects.filter(template_id=template.pk).order_by("-version_number").first()
            if content.preheader:
                check("the preheader travels hidden at the top of the body", content.preheader.split("{{")[0][:12] in sent["html"])

            read = API.get(f"/api/v1/deliverability-tests/{test['id']}/").json()
            check("reading a running test polls Inspect: PROCESSING with three previews pending", read["status"] == "PROCESSING" and read["summary"]["processing"] == 3 and len(read["previews"]) == 3, json.dumps(read["summary"]))
            n_calls = len(fake["calls"])
            API.get(f"/api/v1/deliverability-tests/{test['id']}/")
            check("but not again within eight seconds", len(fake["calls"]) == n_calls)
            fake["round"] = 1
            row = deliverability.refresh(__import__("apps.delivery.models", fromlist=["DeliverabilityTest"]).DeliverabilityTest.objects.get(pk=test["id"]))
            row.checked_at = None
            row.save(update_fields=["checked_at"])
            read = API.get(f"/api/v1/deliverability-tests/{test['id']}/").json()
            check("when Inspect finishes: COMPLETE, two rendered with screenshots, one failed with its reason, sorted by category",
                  read["status"] == "COMPLETE" and read["summary"] == {"clients": 3, "complete": 2, "failed": 1, "processing": 0}
                  and [p["category"] for p in read["previews"]] == ["Application", "Mobile", "Web"]
                  and read["previews"][2]["screenshot"].endswith("gmail_chr_win.png") and read["previews"][1]["status"] == "FAILED" and "did not load" in read["previews"][1]["detail"]
                  and read["completed_at"], json.dumps(read)[:300])

            listed = API.get(f"/api/v1/templates/{template.pk}/deliverability-tests/").json()
            check("the template's test history lists it newest first with the allowance, without the previews", listed["tests"][0]["id"] == test["id"] and listed["tests"][0]["previews"] == [] and listed["allowance"]["used"] == 1, json.dumps(listed["allowance"]))

            LIMIT["value"] = 1
            allowance = API.get("/api/v1/deliverability/allowance/").json()
            check("the allowance: 1 used of 1, none left", allowance["used"] == 1 and allowance["limit"] == 1 and allowance["left"] == 0, json.dumps(allowance)[:120])
            blocked = API.post(f"/api/v1/templates/{template.pk}/deliverability-tests/", {}, content_type="application/json")
            check("the next test is refused with 409 and the plan's limit named", blocked.status_code == 409 and "1 deliverability tests" in blocked.json().get("detail", ""), f"{blocked.status_code} {str(blocked.content)[:160]}")
            check("Inspect was not called for the refused test", len(fake["created"]) == 1)
            quota = billing.quota(T)
            meter = next((m for m in quota["meters"] if m["label"].startswith("Deliverability")), None)
            check("Plan and usage shows the meter", meter and meter["used"] == 1 and meter["limit"] == 1 and meter["state"] in ("over", "blocked", "warning"), json.dumps(meter))

            with mock.patch.object(params, "enabled", return_value=False):
                off = API.post(f"/api/v1/templates/{template.pk}/deliverability-tests/", {}, content_type="application/json")
            check("a plan without the feature answers 403", off.status_code == 403, str(off.status_code))

            gone = API.delete(f"/api/v1/deliverability-tests/{test['id']}/")
            check("a test can be deleted", gone.status_code == 204 and API.get(f"/api/v1/templates/{template.pk}/deliverability-tests/").json()["tests"] == [])
            anon = Client(HTTP_X_TENANT=tenant.code).get("/api/v1/deliverability/allowance/")
            check("everything needs a login", anon.status_code == 401)
            raise RuntimeError("roll back")
    except RuntimeError as exc:
        if str(exc) != "roll back":
            raise
    mock.patch.stopall()
    check.done()
