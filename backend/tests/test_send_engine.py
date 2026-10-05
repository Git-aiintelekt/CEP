"""The send engine end to end against the real database, inside one outer transaction that is rolled back.
A throw-away SMTP listener receives the mail; Postal / SendGrid callbacks are posted to the real webhook endpoint.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
import re
import socketserver
import threading
from unittest import mock
import requests
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from api.v1.delivery_api import webhook_token
from apps.delivery import engine
from apps.delivery.models import DeliveryProvider, SenderProfile
from apps.identity.models import AppUser
from apps.tenants import context
from apps.campaigns.models import Campaign  # noqa: E402

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_send_engine(check):
    """The send engine end to end against the real database, inside one outer transaction that is rolled back."""
    class Handler(socketserver.StreamRequestHandler):
        inbox = []

        def handle(self):
            say = lambda line: self.wfile.write((line + "\r\n").encode())          # noqa: E731
            say("220 test")
            rcpt = ""
            while True:
                line = self.rfile.readline().decode(errors="replace").rstrip("\r\n")
                if not line:
                    return
                verb = line.split(" ")[0].upper()
                if verb in ("EHLO", "HELO"):
                    say("250-test"), say("250 8BITMIME")
                elif verb == "RCPT":
                    rcpt = line.split(":", 1)[1].strip("<> ")
                    say("550 no such user" if rcpt.startswith("zz.reject") else "250 ok")
                elif verb == "DATA":
                    say("354 go")
                    body = []
                    while (chunk := self.rfile.readline().decode(errors="replace")).rstrip("\r\n") != ".":
                        body.append(chunk)
                    Handler.inbox.append({"to": rcpt, "data": "".join(body)})
                    say("250 queued")
                elif verb == "QUIT":
                    say("221 bye")
                    return
                else:
                    say("250 ok")

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    PORT = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email="aby.john@aiintelekt.com")
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

    def quoted_printable(text):
        """The message as a person's mail program sees it: headers unfolded, the parts decoded."""
        import email
        from email import policy
        message = email.message_from_string(text, policy=policy.default)
        headers = "\n".join(f"{k}: {v}" for k, v in message.items())
        parts = "\n".join(part.get_content() for part in message.walk() if part.get_content_maintype() == "text")
        return headers + "\n\n" + parts

    PEOPLE = [  # party, first name, email, consent
        ("ZZ-P1", "Ana", "zz.ana@example.com", "OPTED_IN"), ("ZZ-P2", None, "zz.noname@example.com", "OPTED_IN"), ("ZZ-P3", "Cy", "zz.cy@example.com", None),
        ("ZZ-P4", "Di", "zz.di@example.com", "OPTED_OUT"), ("ZZ-P5", "Ed", None, "OPTED_IN"), ("ZZ-P6", "Fay", "zz.ana@example.com", "OPTED_IN"),
        ("ZZ-P7", "Gus", "zz.blocked@example.com", "OPTED_IN"), ("ZZ-P9", "Ivy", "zz.reject@example.com", "OPTED_IN")]

    try:
        with transaction.atomic():
            # ------------------------------------------------------------------ fixtures
            for party, first, email, consent in PEOPLE:
                sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, custom_attributes) VALUES (%s, %s, %s, 'Test', %s::jsonb, %s::jsonb)",
                    [party, TENANT, first, json.dumps([{"address": email, "is_primary": True, "is_valid": True}] if email else []), json.dumps({"loyalty_tier": "Gold"})])
                if consent:
                    sql("""INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'EMAIL', %s, %s, now())""",
                        [TENANT, party, consent, consent == "OPTED_IN"])
            sql("INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, blocked, block_reason, blocked_at) VALUES (%s, 'EMAIL', 'zz.blocked@example.com', 'ZZ-P7', TRUE, 'HARD_BOUNCE', now())", [TENANT])
            list_id = sql("INSERT INTO contact_list (tenant_id, name, source_type, created_by) VALUES (%s, 'ZZ engine test list', 'UPLOAD', %s) RETURNING id", [TENANT, str(admin.pk)], fetch=True)[0][0]
            for party, *_ in PEOPLE + [("ZZ-P8-UNKNOWN", None, None, None)]:
                sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id, custom_attributes) VALUES (%s, %s, %s, %s::jsonb)",
                    [list_id, TENANT, party, json.dumps({"offer_code": "FALL-" + party[-2:]})])

            provider = DeliveryProvider.objects.create(tenant_id=TENANT, provider_type="SMTP", channel="EMAIL", name="ZZ test smtp", is_active=True,
                                                       config={"host": "127.0.0.1", "port": PORT, "security": "NONE"})
            sender = SenderProfile.objects.create(tenant_id=TENANT, delivery_provider=provider, channel="EMAIL", display_name="ZZ Shop", from_address="hello@zz-shop.example",
                                                  reply_to_address="care@zz-shop.example", verification_status="VERIFIED")
            template = api("post", "/api/v1/templates/", {"name": "ZZ engine template", "channel": "EMAIL"}).json()
            sql("""INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content)
               VALUES (%s, 1, %s, %s, %s)""",
                [template["id"], "{{first_name}}, your code is {{offer_code}}",
                 '<html><body><p>Hi {{first_name}} ({{loyalty_tier}}), code {{offer_code}}.</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p></body></html>',
                 "Hi {{first_name}}, code {{offer_code}}. Unsubscribe: {{unsubscribe_url}}"])
            sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])

            def new_campaign(name, **extra):
                r = api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": template["id"], "sender_profile": str(sender.pk),
                                                       "contact_lists": [str(list_id)], **extra})
                assert r.status_code == 201, r.content
                return r.json()

            # ------------------------------------------------------------------ publish -> run -> mail
            campaign = new_campaign("ZZ engine campaign 1")
            test_send = api("post", f"/api/v1/campaigns/{campaign['id']}/send-test/", {"to": ["zz.me@example.com"]})
            check("test send: goes out now with a [TEST] subject and creates no execution", test_send.status_code == 200 and test_send.json()["results"][0]["ok"]
                  and Handler.inbox and "[TEST]" in Handler.inbox[-1]["data"] and sql("SELECT count(*) FROM mailer_execution WHERE tenant_id = %s AND campaign_id = %s", [TENANT, campaign["id"]], True)[0][0] == 0)
            Handler.inbox.clear()

            with mock.patch("api.v1.views._enqueue_run") as enqueue:
                published = api("post", f"/api/v1/campaigns/{campaign['id']}/publish/")
            run_id = published.json().get("id")
            check("publishing creates the run SCHEDULED", published.status_code == 201 and published.json()["status"] == "SCHEDULED", str(published.status_code))

            outcome = engine.process_run(TENANT, run_id)
            res = api("get", f"/api/v1/campaign-runs/{run_id}/results/").json()
            check("audience: everyone is accounted for, with the reason they were left out",
                  res["audience"]["members"] == 9 and res["audience"]["eligible"] == 3 and res["audience"]["suppressed"] == {"NO_CONSENT": 1, "UNSUBSCRIBED": 1, "NO_EMAIL": 1, "DUPLICATE_ADDRESS": 1,
                                                                                                                        "BLOCKED_ADDRESS": 1, "UNKNOWN_PARTY": 1}, json.dumps(res["audience"]))
            by_to = {m["to"]: quoted_printable(m["data"]) for m in Handler.inbox}
            ana = by_to.get("zz.ana@example.com", "")
            check("mail: one per eligible address, personalized from the customer and the list upload, the catalogue default for a missing name",
                  set(by_to) == {"zz.ana@example.com", "zz.noname@example.com"} and "Hi Ana (Gold), code FALL-P1." in ana and "From: ZZ Shop <hello@zz-shop.example>" in ana
                  and "Reply-To: care@zz-shop.example" in ana, str(sorted(by_to)))
            check("mail: marketing carries a working unsubscribe link and the one-click headers", "List-Unsubscribe: <http" in ana and "List-Unsubscribe-Post: List-Unsubscribe=One-Click" in ana
                  and "/api/v1/public/unsubscribe/?t=" in ana)
            check("results: 2 accepted, the address the server refused (550) is a failure with its reason, the run and the campaign are completed",
                  outcome["status"] == "COMPLETED" and res["messages"]["sent"] == 2 and res["messages"]["failed"] == 1 and res["messages"]["queued"] == 0 and res["status"] == "COMPLETED"
                  and api("get", f"/api/v1/campaigns/{campaign['id']}/").json()["status"] == "COMPLETED"
                  and "550" in sql("SELECT status_reason FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'FAILED'", [TENANT, run_id], True)[0][0], json.dumps(res["messages"]))
            again = engine.process_run(TENANT, run_id)
            check("running the same run again sends nothing (idempotent)", len(Handler.inbox) == 2 and again["sent"] == 2)

            # ------------------------------------------------------------------ unsubscribe
            link = re.search(r"https?://[^\s\"<>]+/api/v1/public/unsubscribe/\?t=[\w:.\-]+", ana).group(0)
            path = link[link.index("/api/"):]
            page = c.get(path)
            still_in = sql("SELECT consent_status FROM consent_suppression WHERE tenant_id = %s AND party_id = 'ZZ-P1' AND channel = 'EMAIL'", [TENANT], True)[0][0]
            done = c.post(path, {"List-Unsubscribe": "One-Click"})
            state = sql("SELECT consent_status, opt_out_method, marketable FROM consent_suppression WHERE tenant_id = %s AND party_id = 'ZZ-P1' AND channel = 'EMAIL'", [TENANT], True)[0]
            record = sql("SELECT action, source, campaign_run_id FROM consent_record WHERE tenant_id = %s AND party_id = 'ZZ-P1' ORDER BY id DESC LIMIT 1", [TENANT], True)[0]
            check("unsubscribe: opening the link only asks (scanners follow links); the button / one-click POST records the opt-out with its evidence",
                  page.status_code == 200 and b"Unsubscribe from marketing email" in page.content and b"zz.ana@example.com" in page.content and still_in == "OPTED_IN"
                  and done.status_code == 200 and b"You are unsubscribed" in done.content and state == ("OPTED_OUT", "UNSUBSCRIBE_LINK", False) and record[:2] == ("OPT_OUT", "UNSUBSCRIBE_LINK")
                  and str(record[2]) == run_id and c.get("/api/v1/public/unsubscribe/?t=forged").status_code in (400, 404))

            # ------------------------------------------------------------------ provider callbacks
            postal = DeliveryProvider.objects.create(tenant_id=TENANT, provider_type="POSTAL", channel="EMAIL", name="ZZ postal", is_active=True, config={"endpoint": "https://postal.example.com"})
            sendgrid = DeliveryProvider.objects.create(tenant_id=TENANT, provider_type="SENDGRID", channel="EMAIL", name="ZZ sendgrid", is_active=True, config={})
            rows = {r[0]: r for r in sql("SELECT email_address, provider_message_id, idempotency_key, id FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s", [TENANT, run_id], True)}
            noname = rows["zz.noname@example.com"]
            hook = lambda p, body, token=None: c.post(f"/api/v1/webhooks/delivery/{CODE}/{p.pk}/{token or webhook_token(p)}/", json.dumps(body), content_type="application/json")  # noqa: E731
            delivered = hook(sendgrid, [{"event": "delivered", "email": noname[0], "timestamp": 1758200005, "sg_message_id": "whatever.f1", "cep_id": noname[2]},
                                        {"event": "click", "email": noname[0], "timestamp": 1758200009, "url": "https://shop.example/fall", "useragent": "Mozilla", "ip": "203.0.113.9", "cep_id": noname[2]},
                                        {"event": "delivered", "email": "nobody@example.com", "timestamp": 1758200010, "cep_id": "not-ours"}])
            late = hook(sendgrid, [{"event": "delivered", "email": noname[0], "timestamp": 1758200020, "cep_id": noname[2]}])
            status = sql("SELECT status, delivered_at IS NOT NULL, clicked_at IS NOT NULL FROM mailer_execution WHERE tenant_id = %s AND id = %s", [TENANT, noname[3]], True)[0]
            clicks = sql("SELECT count(*) FROM tracking_event WHERE tenant_id = %s AND mailer_execution_id = %s AND event_type = 'CLICK'", [TENANT, noname[3]], True)[0][0]
            check("SendGrid callback: matched by our echoed id; delivered then clicked; an event for an unknown message is counted, not an error; a late 'delivered' cannot move a click backwards",
                  delivered.status_code == 200 and delivered.json() == {"received": 3, "applied": 2, "ignored": 0, "unmatched": 1, "failed": 0, "duplicate": 0} and late.json()["ignored"] == 1
                  and status == ("CLICKED", True, True) and clicks == 1, json.dumps(delivered.json()))
            ana_row = rows["zz.ana@example.com"]
            bounce = hook(postal, {"event": "MessageBounced", "timestamp": 1758200030, "payload": {"original_message": {"message_id": ana_row[1], "to": ana_row[0]}, "bounce": {"id": 9}}})
            blocked = sql("SELECT blocked, block_reason, hard_bounce_count FROM contact_point_status WHERE tenant_id = %s AND contact_value = %s", [TENANT, ana_row[0]], True)
            check("Postal callback: matched by the provider message id; a hard bounce blocks the address for the next run",
                  bounce.status_code == 200 and bounce.json()["applied"] == 1 and blocked and blocked[0] == (True, "HARD_BOUNCE", 1)
                  and sql("SELECT status, bounce_type FROM mailer_execution WHERE tenant_id = %s AND id = %s", [TENANT, ana_row[3]], True)[0] == ("BOUNCED", "HARD"), json.dumps(bounce.json()))
            stored = sql("SELECT provider, event_type, processing_status FROM delivery_webhook_event WHERE tenant_id = %s AND received_at > now() - interval '5 minutes' ORDER BY id", [TENANT], True)
            check("every callback is kept raw with how it was processed; a wrong token is a plain 404",
                  [r[0] for r in stored] == ["SENDGRID"] * 4 + ["POSTAL"] and all(r[2] == "PROCESSED" for r in stored) and hook(postal, {}, token="wrong").status_code == 404)

            # ------------------------------------------------------------------ the next run respects all of it
            Handler.inbox.clear()
            second = new_campaign("ZZ engine campaign 2")
            with mock.patch("api.v1.views._enqueue_run"):
                run2 = api("post", f"/api/v1/campaigns/{second['id']}/publish/").json()["id"]
            engine.process_run(TENANT, run2)
            res2 = api("get", f"/api/v1/campaign-runs/{run2}/results/").json()
            check("next campaign: the bounced address is left out for everyone who shares it, and only the remaining person is mailed",
                  res2["audience"]["suppressed"].get("BLOCKED_ADDRESS") == 3 and "zz.ana@example.com" not in {m["to"] for m in Handler.inbox}
                  and "zz.noname@example.com" in {m["to"] for m in Handler.inbox}, json.dumps(res2["audience"]["suppressed"]))

            sql("INSERT INTO communication_governance_policy (tenant_id, name, scope, max_messages, period_days, applies_to, priority) VALUES (%s, 'ZZ one per month', 'GLOBAL', 1, 30, 'MARKETING', 1)", [TENANT])
            third = new_campaign("ZZ engine campaign 3")
            with mock.patch("api.v1.views._enqueue_run"):
                run3 = api("post", f"/api/v1/campaigns/{third['id']}/publish/").json()["id"]
            engine.process_run(TENANT, run3)
            res3 = api("get", f"/api/v1/campaign-runs/{run3}/results/").json()
            logged = sql("SELECT count(*) FROM governance_evaluation_log WHERE tenant_id = %s AND campaign_run_id = %s AND reason = 'FREQUENCY_CAP' AND decision = 'SUPPRESS'", [TENANT, run3], True)[0][0]
            service = new_campaign("ZZ service notice", solicitation_type="SERVICE")
            with mock.patch("api.v1.views._enqueue_run"):
                run4 = api("post", f"/api/v1/campaigns/{service['id']}/publish/")
            check("frequency cap: someone who already got a message this month is left out and the decision is logged",
                  res3["audience"]["suppressed"].get("FREQUENCY_CAP", 0) >= 1 and logged == res3["audience"]["suppressed"]["FREQUENCY_CAP"], json.dumps(res3["audience"]["suppressed"]))
            if run4.status_code == 201:
                Handler.inbox.clear()
                engine.process_run(TENANT, run4.json()["id"])
                res4 = api("get", f"/api/v1/campaign-runs/{run4.json()['id']}/results/").json()
                service_mail = quoted_printable(Handler.inbox[0]["data"]) if Handler.inbox else ""
                check("a service message ignores marketing consent and caps, never a blocked address, and carries no one-click unsubscribe header",
                      "NO_CONSENT" not in res4["audience"]["suppressed"] and "FREQUENCY_CAP" not in res4["audience"]["suppressed"] and res4["audience"]["suppressed"].get("BLOCKED_ADDRESS") == 3
                      and "List-Unsubscribe-Post" not in service_mail and res4["messages"]["sent"] == 3, json.dumps(res4["audience"]))
            else:
                check("a service campaign can be published", False, run4.content.decode()[:200])

            # ------------------------------------------------------------------ a provider that cannot send
            DeliveryProvider.objects.filter(pk=provider.pk).update(config={"host": "127.0.0.1", "port": 9, "security": "NONE"})
            sql("DELETE FROM communication_governance_policy WHERE tenant_id = %s AND name = 'ZZ one per month'", [TENANT])
            broken = new_campaign("ZZ engine campaign broken", solicitation_type="SERVICE")
            with mock.patch("api.v1.views._enqueue_run"):
                run5 = api("post", f"/api/v1/campaigns/{broken['id']}/publish/").json()["id"]
            out5 = engine.process_run(TENANT, run5, max_rounds=2)
            reason = sql("SELECT DISTINCT status_reason FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s", [TENANT, run5], True)
            check("an unreachable provider: retried, then every message fails with the reason and the run is FAILED (nothing stays 'sending')",
                  out5["status"] == "FAILED" and out5["sent"] == 0 and out5["queued"] == 0 and out5["failed"] >= 3 and reason and "failing" in (reason[0][0] or ""), json.dumps(out5))

            # ------------------------------------------------------------------ provider management API
            created = api("post", "/api/v1/delivery-providers/", {"provider_type": "SENDGRID", "name": "ZZ api sendgrid", "secret": "SG.zz-secret", "config": {"api_base": "https://api.eu.sendgrid.com", "junk": "x"}})
            body = created.json()
            stored_row = DeliveryProvider.objects.get(pk=body["id"]) if created.status_code == 201 else None
            missing = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZZ api postal", "config": {"endpoint": "http://insecure.example"}})
            smtp_by_hand = api("post", "/api/v1/delivery-providers/", {"provider_type": "SMTP", "name": "ZZ by hand"})
            check("provider API: the key is write-only and stored encrypted, unknown config keys are dropped, the callback address is returned; validation names the fields; SMTP is not created by hand",
                  created.status_code == 201 and body["has_secret"] and "secret" not in body and body["config"] == {"api_base": "https://api.eu.sendgrid.com"}
                  and f"/api/v1/webhooks/delivery/{CODE}/{body['id']}/" in body["webhook_url"] and stored_row.secret_enc and "SG.zz-secret" not in stored_row.secret_enc
                  and missing.status_code == 400 and {"secret", "config.endpoint"} <= set(missing.json()["errors"]) and smtp_by_hand.status_code == 400, str(created.status_code))
            with mock.patch.object(requests.Session, "get", return_value=mock.Mock(status_code=200, json=lambda: {"scopes": ["mail.send"]})):
                checked = api("post", f"/api/v1/delivery-providers/{body['id']}/check/")
            new_sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": body["id"], "display_name": "ZZ News", "from_address": "News@ZZ-shop.example"})
            with mock.patch.object(requests.Session, "post", return_value=mock.Mock(status_code=202, headers={"X-Message-Id": "v1"})):
                verified = api("post", f"/api/v1/delivery-senders/{new_sender.json()['id']}/verify/", {"to": "zz.me@example.com"})
            listed = [x for x in api("get", "/api/v1/sender-profiles/").json() if x["id"] == new_sender.json()["id"]]
            removed = api("delete", f"/api/v1/delivery-providers/{body['id']}/")
            check("check + sender: the credential is validated with the provider; a new sender is pending until a real message is accepted, then campaigns can use it; removing the provider retires its senders",
                  checked.json() == {"ok": True, "detail": None} and new_sender.status_code == 201 and new_sender.json()["verification_status"] == "PENDING"
                  and new_sender.json()["from_address"] == "news@zz-shop.example" and verified.json()["ok"] and listed and listed[0]["verification_status"] == "VERIFIED"
                  and removed.status_code == 204 and not [x for x in api("get", "/api/v1/sender-profiles/").json() if x["id"] == new_sender.json()["id"]])
            transaction.set_rollback(True)
    finally:
        server.shutdown()

    tok = context.set_platform(True)
    left = (Campaign.objects.filter(name__startswith="ZZ ").count(), DeliveryProvider.objects.filter(name__startswith="ZZ ").count())
    context.reset_platform(tok)
    check("rolled back: no test campaigns or providers remain", left == (0, 0), str(left))
    check.done()
