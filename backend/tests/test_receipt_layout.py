"""Verifies the new receipt-layout backend (GET/POST /templates/{id}/receipt/, GET /templates/{id}/receipt/versions/)
against the real local DB, rolled back. Confirms: a fresh E_RECEIPT template opens on the Standard preset with real
defaults (not null), saving creates a new version sharing the template's global version counter without colliding
with a `design` save on the same template, concurrent-save (stale base_version) gives 409, and version 0 answers
correctly after nothing has been saved.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from django.db import transaction
from django.test import Client
from apps.identity.models import AppUser
from apps.tenants import context
from rest_framework_simplejwt.tokens import AccessToken

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_receipt_layout(check):
    """Verifies the new receipt-layout backend (GET/POST /templates/{id}/receipt/, GET /templates/{id}/receipt/versions/)"""
    tok = context.set_platform(True)
    staff = AppUser.objects.select_related("tenant").get(email="aby.john@aiintelekt.com")
    context.reset_platform(tok)
    c = Client()
    H = {"HTTP_X_TENANT": staff.tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(staff))}

    with transaction.atomic():
        r = c.post("/api/v1/templates/", data=json.dumps({"name": "Receipt backend test", "channel": "E_RECEIPT"}), content_type="application/json", **H)
        check("setup: creating the E_RECEIPT template through the API works", r.status_code == 201, f"status={r.status_code} body={r.json()}")
        tpl_id = r.json()["id"]

        r = c.get(f"/api/v1/templates/{tpl_id}/receipt/", **H)
        body = r.json()
        check("GET on a fresh template: 200, version 0, Standard preset with real (non-empty) sections",
              r.status_code == 200 and body["version_number"] == 0 and body["layout_preset"] == "STANDARD" and len(body["sections"]) == 7,
              json.dumps(body)[:300])

        save_body = {"layout_preset": "COMPACT", "sections": [{"key": "items", "label": "Items", "order": 0, "locked": True, "visible": True,
                     "data_binding": None, "columns": {"product_image": False, "sku": False, "quantity": True, "unit_price": True, "amount": True},
                     "row_height": "COMPACT"}], "custom_html": None, "custom_css": None, "base_version": 0}
        r = c.post(f"/api/v1/templates/{tpl_id}/receipt/", data=json.dumps(save_body), content_type="application/json", **H)
        saved = r.json()
        check("POST saves version 1 with the posted preset", r.status_code == 201 and saved["version_number"] == 1 and saved["layout_preset"] == "COMPACT",
              json.dumps(saved)[:300])

        # also save the OUTER design (same template, same shared version counter) to prove receipt/design don't collide
        design_body = {"editor_state": {"pages": []}, "mjml_source": "<mjml><mj-body></mj-body></mjml>", "subject_line": "Your receipt",
                        "preheader": "", "base_version": 0}
        r = c.post(f"/api/v1/templates/{tpl_id}/design/", data=json.dumps(design_body), content_type="application/json", **H)
        design_saved = r.json()
        check("design save on the same template lands at version 2, not colliding with the receipt's version 1",
              r.status_code == 201 and design_saved["version_number"] == 2, json.dumps(design_saved)[:200])
        check("...and the design's own latest_version is 2 (a bare GrapesJS state has no 'kind' key and must still count)",
              design_saved["latest_version"] == 2, f"latest_version={design_saved.get('latest_version')}")
        r = c.get(f"/api/v1/templates/{tpl_id}/design/", **H)
        check("GET /design/ afterwards also reports latest_version 2, so a second save with base_version 2 is not a false 409",
              r.status_code == 200 and r.json()["latest_version"] == 2 and r.json()["version_number"] == 2, json.dumps(r.json())[:160])
        r = c.post(f"/api/v1/templates/{tpl_id}/design/", data=json.dumps({**design_body, "base_version": 2}), content_type="application/json", **H)
        check("a second design save with the right base_version succeeds (version 3)", r.status_code == 201 and r.json()["version_number"] == 3, f"status={r.status_code}")

        r = c.get(f"/api/v1/templates/{tpl_id}/receipt/", **H)
        after_design = r.json()
        check("receipt GET after an unrelated design save still reports latest_version 1 (its own latest, not the design's)",
              after_design["latest_version"] == 1 and after_design["version_number"] == 1, json.dumps(after_design)[:200])

        # concurrent-save: base_version stale (client still thinks receipt is at 0)
        stale = {**save_body, "layout_preset": "ITEMIZED", "base_version": 0}
        r = c.post(f"/api/v1/templates/{tpl_id}/receipt/", data=json.dumps(stale), content_type="application/json", **H)
        check("stale base_version on receipt save answers 409, not a silent overwrite", r.status_code == 409, f"status={r.status_code} body={r.json()}")

        # versions listing
        r = c.get(f"/api/v1/templates/{tpl_id}/receipt/versions/", **H)
        versions = r.json()
        check("receipt/versions/ lists exactly the one receipt version (not the design version)",
              r.status_code == 200 and len(versions) == 1 and versions[0]["version_number"] == 1, json.dumps(versions))

        # wrong channel
        r = c.post("/api/v1/templates/", data=json.dumps({"name": "Email, not receipt", "channel": "EMAIL"}), content_type="application/json", **H)
        email_tpl_id = r.json()["id"]
        r = c.post(f"/api/v1/templates/{email_tpl_id}/receipt/", data=json.dumps(save_body), content_type="application/json", **H)
        check("saving a receipt layout on an EMAIL template is rejected (409), not silently accepted", r.status_code == 409, f"status={r.status_code}")

        transaction.set_rollback(True)
    check.done()
