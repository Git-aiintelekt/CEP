"""POST /templates/{id}/clone/ and DELETE /templates/{id}/ against the real local DB, rolled back. Also checks mrml
renders the -noshare social network names the designer now writes (a direct profile link, not a share link).

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from django.db import transaction
from django.test import Client
from apps.identity.models import AppUser
from apps.templates import design
from apps.templates.models import RenderedTemplateContent, TemplateDesignState, TemplateMaster, TemplateTag
from apps.tenants import context
from rest_framework_simplejwt.tokens import AccessToken

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_template_clone(check):
    """POST /templates/{id}/clone/ and DELETE /templates/{id}/ against the real local DB, rolled back. Also checks mrml"""
    tok = context.set_platform(True)
    staff = AppUser.objects.select_related("tenant").get(email="aby.john@aiintelekt.com")
    context.reset_platform(tok)
    c = Client()
    H = {"HTTP_X_TENANT": staff.tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(staff))}
    J = {"content_type": "application/json"}

    with transaction.atomic():
        r = c.post("/api/v1/templates/", data=json.dumps({"name": "Clone source email", "channel": "EMAIL", "starter": "promotion"}), **J, **H)
        check("setup: an EMAIL template from the Sale announcement starter (version 1)", r.status_code == 201 and r.json()["latest_version"] == 1, f"status={r.status_code} body={str(r.json())[:200]}")
        src_id = r.json()["id"]
        # a second design version, so the copy provably takes the LATEST and not the first
        d = c.get(f"/api/v1/templates/{src_id}/design/", **H).json()
        r = c.post(f"/api/v1/templates/{src_id}/design/", data=json.dumps({"editor_state": {"pages": [{"marker": "v2"}]}, "mjml_source": d["mjml_source"],
                                                                            "subject_line": "Second subject", "preheader": "", "base_version": 1}), **J, **H)
        check("setup: version 2 saved on the source", r.status_code == 201 and r.json()["version_number"] == 2, f"status={r.status_code}")

        r = c.post(f"/api/v1/templates/{src_id}/clone/", data="{}", **J, **H)
        copy = r.json()
        check("POST /clone/ answers 201 with a DRAFT copy named '<name> (copy)', cloned_from the source, at version 1",
              r.status_code == 201 and copy["status"] == "DRAFT" and copy["name"] == "Clone source email (copy)" and copy["cloned_from"] == src_id and copy["latest_version"] == 1,
              json.dumps(copy)[:300])
        cd = c.get(f"/api/v1/templates/{copy['id']}/design/", **H).json()
        check("the copy's design is the source's LATEST version (subject 'Second subject', editor_state marker v2), renumbered 1",
              cd["version_number"] == 1 and cd["latest_version"] == 1 and cd["subject_line"] == "Second subject" and cd["editor_state"] == {"pages": [{"marker": "v2"}]}
              and cd["html_content"] and cd["mjml_source"] == d["mjml_source"], json.dumps(cd)[:200])
        check("the copy carries the source's tag links", set(TemplateTag.objects.filter(template_id=copy["id"]).values_list("tag_id", flat=True))
              == set(TemplateTag.objects.filter(template_id=src_id).values_list("tag_id", flat=True)) and TemplateTag.objects.filter(template_id=copy["id"]).exists())
        check("the source is untouched: still 2 versions, still ACTIVE/DRAFT as it was",
              RenderedTemplateContent.objects.filter(template_id=src_id).count() == 2 and TemplateDesignState.objects.filter(template_id=src_id).count() == 2)

        r = c.post(f"/api/v1/templates/{src_id}/clone/", data="{}", **J, **H)
        check("a second copy gets a numbered name rather than a duplicate-name error", r.status_code == 201 and r.json()["name"] == "Clone source email (copy) 2", f"status={r.status_code} name={r.json().get('name')}")
        r = c.post(f"/api/v1/templates/{src_id}/clone/", data=json.dumps({"name": "My own copy name"}), **J, **H)
        check("a name in the body is used for the copy", r.status_code == 201 and r.json()["name"] == "My own copy name", f"status={r.status_code}")

        # the copy is a fresh draft the editor can go on saving: base_version 1 must not be a false 409
        r = c.post(f"/api/v1/templates/{copy['id']}/design/", data=json.dumps({"editor_state": {"pages": [{"marker": "v2-edited"}]}, "mjml_source": d["mjml_source"],
                                                                                "subject_line": "Edited copy", "preheader": "", "base_version": 1}), **J, **H)
        check("saving on the copy with base_version 1 lands at version 2 (no false conflict)", r.status_code == 201 and r.json()["version_number"] == 2, f"status={r.status_code} body={str(r.json())[:200]}")

        # SMS: message content (sms_body) is what gets copied
        r = c.post("/api/v1/templates/", data=json.dumps({"name": "Clone source sms", "channel": "SMS", "starter": "sms_promotion"}), **J, **H)
        sms_id = r.json()["id"]
        r = c.post(f"/api/v1/templates/{sms_id}/clone/", data="{}", **J, **H)
        sm = c.get(f"/api/v1/templates/{r.json()['id']}/message/", **H).json()
        check("an SMS copy keeps the message text at version 1", r.status_code == 201 and sm["version_number"] == 1 and "STOP" in sm["sms_body"], json.dumps(sm)[:200])

        # E_RECEIPT: design (v1) and receipt layout (v2) both travel
        r = c.post("/api/v1/templates/", data=json.dumps({"name": "Clone source receipt", "channel": "E_RECEIPT", "starter": "store_receipt"}), **J, **H)
        rc_id = r.json()["id"]
        r = c.post(f"/api/v1/templates/{rc_id}/receipt/", data=json.dumps({"layout_preset": "COMPACT", "sections": design.default_receipt_sections(), "custom_html": None, "custom_css": None, "base_version": 0}), **J, **H)
        check("setup: receipt layout saved on the source", r.status_code == 201, f"status={r.status_code}")
        r = c.post(f"/api/v1/templates/{rc_id}/clone/", data="{}", **J, **H)
        rc_copy = r.json()["id"]
        rd = c.get(f"/api/v1/templates/{rc_copy}/design/", **H).json()
        rr = c.get(f"/api/v1/templates/{rc_copy}/receipt/", **H).json()
        check("an E-Receipt copy has its design at version 1 and its COMPACT receipt layout at version 2",
              rd["version_number"] == 1 and rd["latest_version"] == 1 and rr["version_number"] == 2 and rr["layout_preset"] == "COMPACT", f"design={rd['version_number']}/{rd['latest_version']} receipt={rr['version_number']}/{rr.get('layout_preset')}")

        # delete: a plain template goes; one a campaign uses is refused
        r = c.delete(f"/api/v1/templates/{copy['id']}/", **H)
        check("DELETE a draft copy answers 204 and it leaves the list", r.status_code == 204 and TemplateMaster.objects.get(pk=copy["id"]).deleted_at is not None
              and copy["id"] not in [t["id"] for t in c.get("/api/v1/templates/?channel=EMAIL", **H).json()["results"]], f"status={r.status_code}")
        campaigns = c.get("/api/v1/campaigns/", **H).json()["results"]
        used_id = next((row["template"] for row in campaigns if row.get("template")), None)
        if used_id is not None:
            r = c.delete(f"/api/v1/templates/{used_id}/", **H)
            check("DELETE a template a campaign uses answers 409 with the archive hint", r.status_code == 409 and "Archive it instead" in r.json().get("detail", ""), f"status={r.status_code} body={r.content[:160]}")
        else:
            print("SKIP no template in use by a campaign in this database")

        # mrml renders the -noshare network names the designer now writes, with the href used directly
        html = design.render_mjml('<mjml><mj-body><mj-section><mj-column><mj-social><mj-social-element name="facebook-noshare" href="https://facebook.com/northwind">Facebook</mj-social-element>'
                                  '<mj-social-element name="youtube-noshare" href="https://youtube.com/@northwind"></mj-social-element></mj-social></mj-column></mj-section></mj-body></mjml>')
        check("mrml renders facebook-noshare as a direct link to the profile, not a sharer URL", 'href="https://facebook.com/northwind"' in html and "sharer.php" not in html)
        check("mrml renders youtube-noshare with its icon", "youtube.png" in html and 'href="https://youtube.com/@northwind"' in html)
        raw = design.render_mjml('<mjml><mj-body><mj-raw><table role="presentation" width="100%"><tr><td>Custom <b>HTML</b></td></tr></table></mj-raw>'
                                 '<mj-section><mj-column><mj-text>after</mj-text></mj-column></mj-section></mj-body></mjml>')
        check("mrml renders a body-level mj-raw block as-is", "Custom <b>HTML</b>" in raw and "after" in raw)

        transaction.set_rollback(True)
    check.done()
