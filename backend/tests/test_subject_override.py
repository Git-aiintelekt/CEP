"""A campaign's own subject line and preheader (patch 0025) against the local database, rolled back. Postal is mocked at the HTTP layer.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from unittest import mock
import requests
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.delivery import engine
from apps.delivery.engine import render, runs
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_subject_override(check, admin_email):
    """A campaign's own subject line and preheader (patch 0025) against the local database, rolled back. Postal is mocked at the HTTP layer."""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **H)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **H)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    posted = []

    def postal_post(self, url, **kwargs):
        body = kwargs.get("json") or {}
        posted.append({"subject": body.get("subject"), "to": body.get("to"), "html": body.get("html_body") or ""})
        r = requests.Response()
        r.status_code, r._content = 200, json.dumps({"status": "success", "time": 0.01, "flags": {}, "data": {"message_id": f"m{len(posted)}@postal.example",
                                                                                                              "messages": {(body.get("to") or ["x"])[0]: {"id": len(posted), "token": "t"}}}}).encode()
        return r

    NO_QUIET = mock.patch.object(runs, "quiet_until", return_value=None)
    T_SUBJECT, T_PREHEADER = "Your fall reward is here", "Three days only"
    OWN_SUBJECT, OWN_PREHEADER = "{{first_name}}, your reward ends Sunday", "Open it before {{first_name}} forgets"
    HIDDEN = "display:none;font-size:1px"

    # ---- the pieces, no database
    page = '<!doctype html><html><head><title>x</title></head><body style="margin:0"><p>Hi</p></body></html>'
    placed = render.with_preheader(page, "A & B <soon>")
    check("the preheader goes right after <body> as hidden text, escaped; nothing when there is none; first when there is no <body>",
          placed.index('<body style="margin:0"><div style="display:none') > 0 and "A &amp; B &lt;soon&gt;" in placed and placed.index("A &amp; B") < placed.index("<p>Hi</p>")
          and render.with_preheader(page, "") == page and render.with_preheader("<p>Hi</p>", "Soon").startswith("<div style=") and render.with_preheader("", "Soon") == "")

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(requests.Session, "post", postal_post):
        people = []
        for n in range(24):
            party = f"ZS-P{n:02d}"
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Test', %s::jsonb, '[]'::jsonb)",
                [party, TENANT, f"Person{n}", json.dumps([{"address": f"p{n}@zs.example", "is_primary": True}])])
            sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'EMAIL', 'OPTED_IN', TRUE, now())", [TENANT, party])
            people.append(party)
        list_id = str(sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, 'ZS everyone', 'UPLOAD', 'PRODUCTION', %s, %s) RETURNING id",
                          [TENANT, len(people), str(admin.pk)], True)[0][0])
        for party in people:
            sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, TENANT, party])

        postal = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZS Postal", "secret": "postal-key", "config": {"endpoint": "https://postal.zs.example"}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": postal["id"], "display_name": "ZS Shop", "from_address": "news@zs.example"}).json()
        api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "me@zs.example"})
        template = api("post", "/api/v1/templates/", {"name": "ZS email", "channel": "EMAIL"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, preheader, html_content, text_content) VALUES (%s, 1, %s, %s, %s, %s)",
            [template["id"], T_SUBJECT, T_PREHEADER, '<html><body><p>Hi {{first_name}}. <a href="{{unsubscribe_url}}">Unsubscribe</a></p></body></html>', "Hi {{first_name}}. {{unsubscribe_url}}"])
        bare = api("post", "/api/v1/templates/", {"name": "ZS bare", "channel": "EMAIL"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 1, %s, %s, %s)",
            [bare["id"], T_SUBJECT, '<html><body><p>Hi. <a href="{{unsubscribe_url}}">Unsubscribe</a></p></body></html>', "Hi. {{unsubscribe_url}}"])
        text_template = api("post", "/api/v1/templates/", {"name": "ZS text", "channel": "SMS"}).json()
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id IN (%s, %s)", [template["id"], bare["id"]])
        posted.clear()

        def new_email(name, **extra):
            return api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": template["id"], "sender_profile": sender["id"],
                                                      "contact_lists": [list_id], **extra})

        # ---- 1. the setting through the API
        campaign = new_email("ZS Fall").json()
        cid = campaign["id"]
        before = api("get", f"/api/v1/campaigns/{cid}/preview/").json()
        check("a new campaign has neither: the preview is the template's subject and preheader, and the hidden preheader is in the HTML",
              campaign["subject_line"] is None and campaign["preheader"] is None and before["subject"] == T_SUBJECT and before["preheader"] == T_PREHEADER
              and HIDDEN in before["html"] and T_PREHEADER in before["html"], str(before)[:200])
        saved = api("patch", f"/api/v1/campaigns/{cid}/", {"subject_line": "  {{first_name}},   your reward ends Sunday ", "preheader": OWN_PREHEADER, "row_version": campaign["row_version"]})
        log = [row["message"] for row in api("get", f"/api/v1/campaigns/{cid}/activity/").json()]
        check("the campaign's own are saved (spaces tidied) and the change is logged", saved.status_code == 200 and saved.json()["subject_line"] == OWN_SUBJECT
              and saved.json()["preheader"] == OWN_PREHEADER and any("subject line, preheader" in line for line in log), f"{saved.content[:200]} {log[:2]}")
        after = api("get", f"/api/v1/campaigns/{cid}/preview/").json()
        check("the preview uses them, with sample values, and lists their tags", after["subject"].endswith("your reward ends Sunday") and "{{" not in after["subject"]
              and after["preheader"].startswith("Open it before") and T_PREHEADER not in after["html"] and "first_name" in after["tags_used"], str(after)[:240])
        text = api("post", "/api/v1/campaigns/", {"name": "ZS text", "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "template": text_template["id"], "subject_line": "x"})
        check("a text campaign cannot have one", text.status_code == 400 and "no subject line" in str(text.json()["errors"]["subject_line"]), text.content[:200])

        # ---- 2. a test send, a copy, and the real send
        posted.clear()
        tested = api("post", f"/api/v1/campaigns/{cid}/test-publish/", {"to": ["me@zs.example"]})
        check("a test send carries the campaign's subject and preheader", tested.status_code == 200 and posted and posted[0]["subject"].startswith("[TEST] ")
              and posted[0]["subject"].endswith("your reward ends Sunday") and "Open it before" in posted[0]["html"], str(posted)[:300])
        copy = api("post", f"/api/v1/campaigns/{cid}/clone/").json()
        check("a copy keeps them", copy["subject_line"] == OWN_SUBJECT and copy["preheader"] == OWN_PREHEADER, str(copy)[:160])
        posted.clear()
        with mock.patch("api.v1.views._enqueue_run"):
            run_id = api("post", f"/api/v1/campaigns/{cid}/publish/").json()["id"]
        with NO_QUIET:
            done = engine.process_run(TENANT, run_id)
        stamped = sql("SELECT DISTINCT subject_line FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s", [TENANT, run_id], True)
        first = next((p for p in posted if p["to"] == ["p3@zs.example"]), {"subject": None, "html": ""})
        check("the send: each person gets the campaign's subject and preheader with their own name; the message rows record the subject as written",
              done["status"] == "COMPLETED" and done["sent"] == 24 and first["subject"] == "Person3, your reward ends Sunday" and "Open it before Person3 forgets" in first["html"]
              and first["html"].index("Open it before") < first["html"].index("<p>Hi Person3") and stamped == [(OWN_SUBJECT,)], f"{done} {first['subject']} {stamped}")

        # ---- 3. A/B: A is the campaign's own; back to the template's; no preheader anywhere means no hidden text
        ab = new_email("ZS AB", subject_line=OWN_SUBJECT, ab_config={"enabled": True, "subject_b": "Something else"}).json()
        posted.clear()
        with mock.patch("api.v1.views._enqueue_run"):
            run2 = api("post", f"/api/v1/campaigns/{ab['id']}/publish/").json()["id"]
        with NO_QUIET:
            engine.process_run(TENANT, run2)
        variants = {v["variant_key"]: v["subject_line"] for v in api("get", f"/api/v1/campaigns/{ab['id']}/runs/{run2}/").json()["variants"]}
        check("with a subject line test, A is the campaign's own subject", variants == {"A": OWN_SUBJECT, "B": "Something else"}, str(variants))
        cleared = api("patch", f"/api/v1/campaigns/{copy['id']}/", {"subject_line": "   ", "preheader": ""})
        back = api("get", f"/api/v1/campaigns/{copy['id']}/preview/").json()
        check("blank means the template's again", cleared.status_code == 200 and cleared.json()["subject_line"] is None and cleared.json()["preheader"] is None
              and back["subject"] == T_SUBJECT and back["preheader"] == T_PREHEADER, cleared.content[:200])
        plain = new_email("ZS bare", template=bare["id"]).json()
        shown = api("get", f"/api/v1/campaigns/{plain['id']}/preview/").json()
        check("no preheader on the template or the campaign: no hidden text", shown["preheader"] == "" and HIDDEN not in shown["html"], shown["html"][:160])

        transaction.set_rollback(True)
    check.done()
