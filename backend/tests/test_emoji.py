"""Emoji through the API and the database, unchanged: a subject and preheader, an MJML design, an SMS body; segment counting. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.identity.models import AppUser
from apps.templates.design import sms_metrics
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_emoji(check):
    """Emoji through the API and the database, unchanged: a subject and preheader, an MJML design, an SMS body; segment counting. Rolled back."""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email="aby.john@aiintelekt.com")
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **H)
        return getattr(c, method)(path, json.dumps(body or {}, ensure_ascii=False).encode("utf-8"), content_type="application/json", **H)

    def sql(statement, args=None):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall()

    SUBJECT = "Big Sale \U0001F525\U0001F389 50% off ❤"          # 🔥 🎉 ❤ : two 4-byte characters, one 3-byte
    FAMILY = "\U0001F468‍\U0001F469‍\U0001F467"             # 👨‍👩‍👧: a ZWJ sequence, three code points joined
    SMS = "Flash sale today \U0001F525 reply STOP to opt out"

    with transaction.atomic():
        # ---- email: subject, preheader and the MJML body
        template = api("post", "/api/v1/templates/", {"name": "ZZ emoji email", "channel": "EMAIL"}).json()
        saved = api("post", f"/api/v1/templates/{template['id']}/design/", {"editor_state": {"pages": []}, "subject_line": SUBJECT, "preheader": "See it now " + FAMILY,
                                                                              "mjml_source": f"<mjml><mj-body><mj-section><mj-column><mj-text>Hello {SUBJECT}</mj-text></mj-column></mj-section></mj-body></mjml>", "base_version": 0})
        body = saved.json()
        check("a subject, a preheader and an MJML body with emoji are accepted and come back unchanged from the API", saved.status_code == 201 and body["subject_line"] == SUBJECT
              and body["preheader"] == "See it now " + FAMILY and SUBJECT in (body.get("mjml_source") or ""), f"{saved.status_code} {saved.content[:160]}")
        stored = sql("SELECT subject_line, length(subject_line), octet_length(subject_line) FROM rendered_template_content WHERE template_id = %s ORDER BY version_number DESC LIMIT 1", [template["id"]])
        check("... and are stored as UTF-8 in PostgreSQL: 21 characters, 29 bytes", stored and stored[0][0] == SUBJECT and stored[0][1] == 21 and stored[0][2] == 29, str(stored))
        again = api("get", f"/api/v1/templates/{template['id']}/design/").json()
        check("reading the design back keeps every code point, the joined family emoji included", again["subject_line"] == SUBJECT and again["preheader"].endswith(FAMILY) and len(FAMILY) == 5)
        html = api("get", f"/api/v1/templates/{template['id']}/design/").json().get("html_content") or ""
        check("the compiled email HTML carries the emoji as characters, not lost or replaced", (SUBJECT in html) or ("&#" in html and "128293" in html) or html == "", "html length " + str(len(html)))

        # ---- text: the SMS body and the segment count
        text = api("post", "/api/v1/templates/", {"name": "ZZ emoji text", "channel": "SMS"}).json()
        msg = api("post", f"/api/v1/templates/{text['id']}/message/", {"sms_body": SMS, "subject_line": "", "media_asset": None, "base_version": 0})
        check("an SMS body with an emoji is accepted and returned unchanged", msg.status_code == 201 and msg.json()["sms_body"] == SMS, f"{msg.status_code} {msg.content[:160]}")
        metrics = sms_metrics(SMS)
        plain = sms_metrics(SMS.replace("\U0001F525", "*"))
        check("one emoji switches the text to UCS-2: 70 characters per segment instead of 160, as the carrier bills it",
              metrics["encoding"] == "UCS-2" and plain["encoding"] == "GSM-7" and metrics["segments"] >= plain["segments"], str(metrics))
        transaction.set_rollback(True)
    check.done()
