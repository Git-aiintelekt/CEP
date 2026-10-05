"""The UX pass's backend: saved views and bulk pause / resume, a template's last use, a list's reach and consent filter, global search,
title-case engine labels, the per-integration alert switch, Retry Send and Replay Callback. Local database, rolled back; Postal mocked.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
from apps.delivery.models import DeliveryProvider
import json
from unittest import mock
import requests
from django.db import connection, transaction
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from api.v1.delivery_api import webhook_token
from apps.delivery import engine
from apps.delivery.engine import runs
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook, outbound
from apps.platform_ops import notifications
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_ux_backend(check, admin_email):
    """The UX pass's backend: saved views and bulk pause / resume, a template's last use, a list's reach and consent filter, global search,"""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    devon = AppUser.objects.get(email="devon.okafor@northwindapparel.example")
    analyst = AppUser.objects.get(email="priya.natarajan@northwindapparel.example")
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()

    def headers(user):
        return {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(user))}

    H, HD, HA = headers(admin), headers(devon), headers(analyst)

    def api(method, path, body=None, h=H):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **h)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **h)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    def postal_answer(body):
        r = requests.Response()
        r.status_code, r._content = 200, json.dumps(body).encode()
        r.headers["Content-Type"] = "application/json"
        return r

    OK = {"status": "success", "data": {"message_id": "zu-1@postal.example"}}
    RECEIPT = {"number": "R-ZU-0001", "transaction_at": "2026-09-18T16:12:00", "currency": "USD", "subtotal": 10, "tax_total": 1, "grand_total": 11, "tender_summary": "Visa",
               "items": [{"description": "Socks", "quantity": 1, "unit_price": 10}]}
    NO_QUIET = mock.patch.object(runs, "quiet_until", return_value=None)
    sent_mail = []

    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(notifications.mail, "send", side_effect=lambda *a, **k: sent_mail.append(k.get("subject")) or True):
        # ---- people and a list, a sandbox text engine, an SMS template
        for n in range(4):
            party = f"ZU-P{n}"
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Test', %s::jsonb, %s::jsonb)",
                [party, TENANT, f"Person{n}", json.dumps([{"address": f"p{n}@zu.example", "is_primary": True}]), json.dumps([{"number": f"+1470555{4000 + n}", "type": "MOBILE", "is_primary": True}] if n < 3 else [])])
            for channel in ("EMAIL", "SMS"):
                sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, %s, %s, %s, now())",
                    [TENANT, party, channel, "OPTED_OUT" if n == 3 and channel == "EMAIL" else "OPTED_IN", not (n == 3 and channel == "EMAIL")])
        list_id = str(sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, 'ZU list', 'UPLOAD', 'PRODUCTION', 4, %s) RETURNING id",
                          [TENANT, str(admin.pk)], True)[0][0])
        for n in range(4):
            sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, TENANT, f"ZU-P{n}"])
        sandbox = api("post", "/api/v1/delivery-providers/", {"provider_type": "SANDBOX_SMS", "name": "ZU sandbox", "config": {}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": sandbox["id"], "display_name": "ZU Shop", "sender_id": "55181"}).json()
        api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "+14705550100"})
        template = api("post", "/api/v1/templates/", {"name": "ZU text", "channel": "SMS"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body) VALUES (%s, 1, %s)", [template["id"], "ZU: Hi {{first_name}}. Reply STOP to opt out."])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])
        spare = api("post", "/api/v1/templates/", {"name": "ZU spare", "channel": "SMS"}).json()

        def new(name, h=H, **extra):
            return api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "template": template["id"], "sender_profile": sender["id"],
                                                      "contact_lists": [list_id], **extra}, h=h).json()

        def publish(cid, h=H):
            with mock.patch("api.v1.views._enqueue_run"):
                return api("post", f"/api/v1/campaigns/{cid}/publish/", h=h)

        # ---- 1. saved views
        today_c = new("ZU today")
        run_today = publish(today_c["id"]).json()["id"]
        with NO_QUIET:
            engine.process_run(TENANT, run_today)
        mine_d = new("ZU devon draft", h=HD)
        tomorrow = new("ZU tomorrow", send_type="SCHEDULED", scheduled_at=(timezone.now() + timezone.timedelta(days=1)).isoformat(), send_timezone="America/New_York")
        publish(tomorrow["id"])
        api("put", "/api/v1/workspace/approvals/", {"require_approval": True})
        api("post", f"/api/v1/campaigns/{mine_d['id']}/request-approval/", {"note": "please"}, h=HD)
        api("put", "/api/v1/workspace/approvals/", {"require_approval": False})
        active = new("ZU active")
        sql("UPDATE campaign SET status = 'ACTIVE' WHERE id = %s", [active["id"]])                          # as if a send were running
        paused = api("post", f"/api/v1/campaigns/{active['id']}/pause/").json()

        def names(query, h=H):
            return sorted(row["name"] for row in api("get", "/api/v1/campaigns/?search=ZU&" + query, h=h).json()["results"])

        check("view=mine: what the signed-in person owns", names("view=mine", h=HD) == ["ZU devon draft"] and "ZU devon draft" not in names("view=mine"), str(names("view=mine")))
        check("view=sending_today: a send that started today, not one scheduled for tomorrow", names("view=sending_today") == ["ZU today"], str(names("view=sending_today")))
        check("view=attention: paused, or waiting for approval; an unknown view is refused", names("view=attention") == ["ZU active", "ZU devon draft"] and paused["status"] == "PAUSED"
              and api("get", "/api/v1/campaigns/?view=nonsense").status_code == 400, str(names("view=attention")))

        # ---- 2. bulk pause and resume
        resumed = api("post", "/api/v1/campaigns/bulk/", {"action": "resume", "ids": [active["id"], tomorrow["id"]]}).json()
        check("bulk resume: the paused one runs again, a scheduled one is left as it is and named",
              [item["name"] for item in resumed["done"]] == ["ZU active"] and resumed["skipped"][0]["name"] == "ZU tomorrow" and "resume" in resumed["skipped"][0]["reason"].lower(), str(resumed))
        paused_again = api("post", "/api/v1/campaigns/bulk/", {"action": "pause", "ids": [active["id"]]}).json()
        forbidden = api("post", "/api/v1/campaigns/bulk/", {"action": "pause", "ids": [active["id"]]}, h=HA)
        check("bulk pause pauses; without campaign.publish it is refused", [item["name"] for item in paused_again["done"]] == ["ZU active"] and forbidden.status_code == 403
              and api("get", f"/api/v1/campaigns/{active['id']}/").json()["status"] == "PAUSED", f"{paused_again} {forbidden.status_code}")

        # ---- 3. templates: last used in
        rows = {row["name"]: row for row in api("get", "/api/v1/templates/?search=ZU").json()["results"]}
        check("a template says which campaign used it last and how many use it; a fresh one says none",
              rows["ZU text"]["last_used_in"] and rows["ZU text"]["last_used_in"]["name"] in {"ZU active", "ZU tomorrow", "ZU today", "ZU devon draft"} and rows["ZU text"]["campaign_count"] == 4
              and rows["ZU spare"]["last_used_in"] is None and rows["ZU spare"]["campaign_count"] == 0, str({k: (v["last_used_in"], v["campaign_count"]) for k, v in rows.items()}))

        # ---- 4. lists: reach per channel, consent filter
        reach = api("get", f"/api/v1/contact-lists/{list_id}/reach/").json()
        sendable = api("get", f"/api/v1/contact-lists/{list_id}/members/?status=SENDABLE").json()
        unsub = api("get", f"/api/v1/contact-lists/{list_id}/members/?status=UNSUBSCRIBED").json()
        bad = api("get", f"/api/v1/contact-lists/{list_id}/members/?status=MOON")
        check("reach: 3 of 4 by email (one unsubscribed), 3 of 4 by text (one has no phone); members filter by consent state; a bad state is refused",
              reach["email"] == {"total": 4, "sendable": 3} and reach["sms"]["sendable"] == 3 and reach["sms"]["no_phone"] == 1 and sendable["count"] == 3
              and unsub["count"] == 1 and unsub["results"][0]["email"] == "p3@zu.example" and bad.status_code == 400, f"{reach} {sendable['count']} {unsub['count']}")

        # ---- 5. global search
        found = api("get", "/api/v1/search/?q=ZU").json()
        short = api("get", "/api/v1/search/?q=Z").json()
        check("search finds campaigns, lists and templates by name, a few of each, and nothing under two characters",
              {row["name"] for row in found["campaigns"]} >= {"ZU today", "ZU active"} and len(found["campaigns"]) <= 6 and [row["name"] for row in found["lists"]] == ["ZU list"]
              and {row["name"] for row in found["templates"]} == {"ZU text", "ZU spare"} and found["campaigns"][0]["status_label"] and short == {"q": "Z", "campaigns": [], "lists": [], "templates": []}, str(found)[:300])
        by_code = api("get", f"/api/v1/search/?q={today_c['code']}").json()
        check("... and a campaign by its code", [row["name"] for row in by_code["campaigns"]] == ["ZU today"], str(by_code["campaigns"]))

        # ---- 6. engine labels in title case
        catalogue = {item["provider_type"]: item for item in api("get", "/api/v1/delivery-providers/catalogue/").json()}
        labels = [field["label"] for field in catalogue["POSTAL"]["fields"]]
        check("the Sending engines form labels are title case", "Server API Key" in labels and "Transactional Server API Key" in labels and all(word[:1].isupper() or word in ("to", "of", "that") for label in labels for word in label.split()), str(labels))

        # ---- 7. Postal: a receipt send, its log row, Retry Send and Replay Callback, the alert switch
        postal = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZU Postal", "secret": "k", "config": {"endpoint": "https://postal.zu.example"}}).json()
        esender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": postal["id"], "display_name": "ZU Receipts", "from_address": "receipts@zu.example"}).json()
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            api("post", f"/api/v1/delivery-senders/{esender['id']}/verify/", {"to": "me@zu.example"})
        rtemplate = api("post", "/api/v1/templates/", {"name": "ZU receipt", "channel": "E_RECEIPT", "starter": "store_receipt"}).json()
        sql("DELETE FROM rendered_template_content WHERE template_id = %s", [rtemplate["id"]])
        sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 9, %s, %s, %s)",
            [rtemplate["id"], "Receipt {{receipt_number}}", "<p>{{receipt_body}}</p>", "{{receipt_body}}"])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [rtemplate["id"]])
        receipts = api("post", "/api/v1/campaigns/", {"name": "ZU receipts", "campaign_type": "E_RECEIPT", "channel": "EMAIL", "solicitation_type": "TRANSACTIONAL",
                                                      "template": rtemplate["id"], "sender_profile": esender["id"]}).json()
        api("post", f"/api/v1/campaigns/{receipts['id']}/publish/")
        with mock.patch.object(requests.Session, "post", return_value=postal_answer(OK)):
            sent = api("post", "/api/v1/receipts/send/", {"campaign": receipts["id"], "to": "pat@zu.example", "name": "Pat Lee", "receipt": RECEIPT, "store": {"name": "Lenox"}})
        execution_id = sent.json()["execution_id"]
        down = postal_answer({"status": "error", "data": {"code": "ServerUnavailable", "message": "try later"}})
        down.status_code = 503
        with mock.patch.object(requests.Session, "post", return_value=down):
            failed_send = api("post", "/api/v1/receipts/send/", {"campaign": receipts["id"], "to": "sam@zu.example", "name": "Sam Lee", "receipt": {**RECEIPT, "number": "R-ZU-0002"}, "store": {"name": "Lenox"}})
        out_rows = api("get", "/api/v1/integrations/log/?direction=OUT").json()["results"]
        good_row = next(row for row in out_rows if row["system"] == "POSTAL" and row["outcome"] == "OK")
        bad_row = next(row for row in out_rows if row["system"] == "POSTAL" and row["outcome"] != "OK")
        key = json.loads(api("get", f"/api/v1/integrations/log/{bad_row['id']}/").json()["request_body"])["idempotency_key"]
        sql("UPDATE mailer_execution SET status = 'FAILED', status_reason = 'Postal: 503' WHERE tenant_id = %s AND idempotency_key = %s", [TENANT, key])
        failed_id = sql("SELECT id FROM mailer_execution WHERE tenant_id = %s AND idempotency_key = %s", [TENANT, key], True)[0][0]
        early = api("post", f"/api/v1/integrations/log/{good_row['id']}/retry/")
        with mock.patch("api.v1.views._enqueue_run"):
            retried = api("post", f"/api/v1/integrations/log/{bad_row['id']}/retry/")
            twice = api("post", f"/api/v1/integrations/log/{bad_row['id']}/retry/")
        state = sql("SELECT x.status, x.status_reason, r.status FROM mailer_execution x JOIN campaign_run r ON r.id = x.campaign_run_id WHERE x.tenant_id = %s AND x.id = %s", [TENANT, failed_id], True)[0]
        check("Retry Send: refused on a send that went through; a failed send's message (found by the key the log kept) goes back to QUEUED, its run reopens, the log says who; a second retry is refused",
              failed_send.status_code >= 400 and early.status_code == 409 and retried.status_code == 200 and retried.json()["queued"] and state[0] == "QUEUED" and state[1].startswith("Retried by ")
              and state[2] == "SENDING" and twice.status_code == 409
              and sql("SELECT count(*) FROM campaign_activity_log WHERE tenant_id = %s AND campaign_id = %s AND event_type = 'SEND_RETRIED'", [TENANT, receipts["id"]], True)[0][0] == 1,
              f"send {failed_send.status_code} {early.status_code} {retried.content[:160]} {state} {twice.status_code}")
        out_row = good_row
        hook_url = f"/api/v1/webhooks/delivery/{CODE}/{postal['id']}/{webhook_token(DeliveryProvider.objects.get(pk=postal['id']))}/"
        sql("UPDATE mailer_execution SET status = 'SUBMITTED', provider_message_id = 'zu-1@postal.example' WHERE tenant_id = %s AND id = %s", [TENANT, execution_id])
        body = {"event": "MessageLoaded", "timestamp": 1774737615.0, "uuid": "zu-evt-1", "payload": {"message": {"id": 501, "message_id": "zu-1@postal.example", "to": "pat@zu.example"}, "user_agent": "Mail/1.0"}}
        first = c.post(hook_url, content_type="application/json", data=json.dumps(body))
        opens = lambda: sql("SELECT count(*) FROM tracking_event WHERE tenant_id = %s AND mailer_execution_id = %s AND event_type = 'OPEN'", [TENANT, execution_id], True)[0][0]   # noqa: E731
        in_row = api("get", "/api/v1/integrations/log/?direction=IN").json()["results"][0]
        replayed = api("post", f"/api/v1/integrations/log/{in_row['id']}/replay/")
        not_in = api("post", f"/api/v1/integrations/log/{out_row['id']}/replay/")
        newest = api("get", "/api/v1/integrations/log/?direction=IN").json()["results"][0]
        check("Replay Callback: the stored body is applied again despite the duplicate check, a new log row says it was a replay and by whom; an outbound row cannot be replayed",
              first.json()["applied"] == 1 and replayed.status_code == 200 and replayed.json()["applied"] == 1 and replayed.json()["duplicate"] == 0 and opens() == 2
              and newest["method"] == "REPLAY" and newest["id"] != in_row["id"] and "replay of log row" in (newest["error_message"] or "") and not_in.status_code == 409,
              f"{first.content[:100]} {replayed.content[:160]} opens={opens()} {newest.get('method')} {not_in.status_code}")

        integrations = api("get", "/api/v1/integrations/").json()
        target = next(item for item in integrations if item["system"] == "POSTAL")
        muted = api("post", f"/api/v1/integrations/{target['id']}/alerts/", {"enabled": False}).json()
        after = next(item for item in api("get", "/api/v1/integrations/").json() if item["id"] == target["id"])
        sent_mail.clear()
        api("put", "/api/v1/workspace/notifications/", {"emails": ["ops@zu.example"]})
        guard = mock.Mock(system="Postal", tenant_id=TENANT)
        guard.breaker.threshold = 5
        outbound._trouble(guard, {"id": target["id"], "tenant_id": TENANT, "breaker_cooldown_seconds": 60}, RuntimeError("503"))
        quiet = list(sent_mail)
        api("post", f"/api/v1/integrations/{target['id']}/alerts/", {"enabled": True})
        outbound._trouble(guard, {"id": target["id"], "tenant_id": TENANT, "breaker_cooldown_seconds": 60}, RuntimeError("503"))
        check("the Email Alerts switch: every card shows it on by default; switched off, a circuit opening on that engine sends nothing; on again, it does",
              all(item["alerts_enabled"] for item in integrations) and muted["alerts_enabled"] is False and after["alerts_enabled"] is False and quiet == [] and len(sent_mail) == 1, f"{quiet} {sent_mail}")

        transaction.set_rollback(True)
    check.done()
