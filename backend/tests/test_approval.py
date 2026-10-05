"""Approval before a production publish (patch 0022) and workspace notifications, end to end against the local database,
inside one rolled-back transaction. Email and webhook calls are captured, nothing leaves the machine.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from unittest import mock
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.campaigns import approval
from apps.delivery import engine
from apps.delivery.engine import runs
from apps.identity.models import AppUser
from apps.integrations.bridge import outbound
from apps.platform_ops import notifications
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_approval(check, admin_email):
    """Approval before a production publish (patch 0022) and workspace notifications, end to end against the local database,"""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    devon = AppUser.objects.get(email="devon.okafor@northwindapparel.example")        # Campaign Manager: edit + publish, no approve, no user.admin
    maria = AppUser.objects.get(email="maria.chen@northwindapparel.example")          # Marketing Admin: approve
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()

    def headers(user):
        return {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(user))}

    H, HD, HM = headers(admin), headers(devon), headers(maria)

    def api(method, path, body=None, h=H):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **h)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **h)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    sent_mail, posted = [], []

    def fake_mail(template, to, ctx, *, subject, tenant_id=None):
        sent_mail.append({"template": template, "to": sorted(to), "subject": subject, "title": ctx.get("title"), "lines": ctx.get("lines")})
        return True

    def fake_post(url, json=None, timeout=None):
        posted.append({"url": url, "text": (json or {}).get("text", "")})
        return mock.Mock(ok=True)

    def activity(cid):
        return [row["event_type"] for row in api("get", f"/api/v1/campaigns/{cid}/activity/").json()]

    NO_QUIET = mock.patch.object(runs, "quiet_until", return_value=None)

    with transaction.atomic(), mock.patch.object(notifications.mail, "send", side_effect=fake_mail), mock.patch.object(notifications.requests, "post", side_effect=fake_post):
        # ---- fixture: people, a list, a sandbox text sender, an active template
        for party, name, phone in (("ZA-P01", "Ana", "+14705551201"), ("ZA-P02", "Ben", "+14705551202"), ("ZA-P03", "Cy", "+14705551203")):
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Test', %s::jsonb, %s::jsonb)",
                [party, TENANT, name, json.dumps([{"address": f"{name.lower()}@za.example", "is_primary": True}]), json.dumps([{"number": phone, "type": "MOBILE", "is_primary": True}])])
            sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'SMS', 'OPTED_IN', TRUE, now())", [TENANT, party])
        list_a = str(sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, 'ZA list', 'UPLOAD', 'PRODUCTION', 3, %s) RETURNING id",
                         [TENANT, str(admin.pk)], True)[0][0])
        for party in ("ZA-P01", "ZA-P02", "ZA-P03"):
            sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_a, TENANT, party])
        list_b = str(sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, 'ZA list B', 'UPLOAD', 'PRODUCTION', 1, %s) RETURNING id",
                         [TENANT, str(admin.pk)], True)[0][0])
        sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, 'ZA-P03')", [list_b, TENANT])
        provider = api("post", "/api/v1/delivery-providers/", {"provider_type": "SANDBOX_SMS", "name": "ZA sandbox texts", "config": {}}).json()
        sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": provider["id"], "display_name": "ZA Shop", "sender_id": "55178"}).json()
        api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {"to": "+14705550100"})
        template = api("post", "/api/v1/templates/", {"name": "ZA text template", "channel": "SMS"}).json()
        sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body) VALUES (%s, 1, %s)", [template["id"], "ZA Shop: Hi {{first_name}}. Reply STOP to opt out."])
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])

        def new(name, h=HD, **extra):
            return api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "REGULAR_MARKETING", "channel": "SMS", "template": template["id"], "sender_profile": sender["id"],
                                                      "contact_lists": [list_a], **extra}, h=h).json()

        def publish(cid, h=HD):
            with mock.patch("api.v1.views._enqueue_run"):
                return api("post", f"/api/v1/campaigns/{cid}/publish/", h=h)

        # ---- 1. the workspace setting
        before = api("get", "/api/v1/workspace/approvals/").json()
        forbidden = api("get", "/api/v1/workspace/approvals/", h=HD)
        turned_on = api("put", "/api/v1/workspace/approvals/", {"require_approval": True}).json()
        check("Settings → Approvals: off by default, lists who can approve (the roles with campaign.approve), and only an administrator sees or changes it",
              before["require_approval"] is False and {p["email"] for p in before["approvers"]} >= {admin.email, maria.email} and devon.email not in {p["email"] for p in before["approvers"]}
              and forbidden.status_code == 403 and turned_on["require_approval"] is True and turned_on["awaiting"] == 0, f"{before} {forbidden.status_code}")
        with mock.patch.object(approval, "approvers", return_value=[]):
            nobody = api("put", "/api/v1/workspace/approvals/", {"require_approval": True})
        check("... and refuses to switch it on while nobody could approve", nobody.status_code == 400 and "campaign.approve" in nobody.json()["errors"]["require_approval"], nobody.content[:200])

        # ---- 2. what the author sees and cannot do
        campaign = new("ZA Holiday Preview")
        cid = campaign["id"]
        refused = publish(cid)
        checklist = api("get", f"/api/v1/campaigns/{cid}/checklist/").json()
        item = next(i for i in checklist["items"] if i["key"] == "approval")
        check("a required approval stops the publish (409) and shows in the checklist; the campaign offers request_approval and no approval yet",
              refused.status_code == 409 and "second person" in refused.json()["detail"] and item["ok"] is False and checklist["ready"] is False
              and campaign["approval_required"] is True and campaign["approval"] is None and "request_approval" in campaign["actions"] and "approve" not in campaign["actions"],
              f"{refused.status_code} {refused.content[:160]}")

        # ---- 3. the request
        sent_mail.clear(); posted.clear()
        asked = api("post", f"/api/v1/campaigns/{cid}/request-approval/", {"note": "Loyalty Gold+ only, please check the 10% code."}, h=HD)
        body = asked.json()
        check("the author asks with a note: REQUESTED, who and when are recorded, the actions become approve and send_back",
              asked.status_code == 200 and body["approval"]["status"] == "REQUESTED" and body["approval"]["requested_by_name"] == "Devon Okafor" and body["approval"]["note"].startswith("Loyalty")
              and body["actions"][-2:] == ["approve", "send_back"] and "request_approval" not in body["actions"] and "APPROVAL_REQUESTED" in activity(cid), asked.content[:200])
        check("... every approver is emailed the note and the webhook gets it (the default for approval requests)",
              len(sent_mail) == 1 and sent_mail[0]["template"] == "workspace_notification" and set(sent_mail[0]["to"]) >= {admin.email, maria.email} and devon.email not in sent_mail[0]["to"]
              and "waiting for your approval" in sent_mail[0]["subject"] and "10% code" in sent_mail[0]["lines"][0] and len(posted) == 0,   # no webhook configured yet
              f"{sent_mail} {posted}")
        twice = api("post", f"/api/v1/campaigns/{cid}/request-approval/", {}, h=HD)
        check("asking twice is refused in words", twice.status_code == 409 and "already requested" in twice.json()["detail"], twice.content[:160])
        awaiting = api("get", "/api/v1/campaigns/?approval=requested").json()
        check("the list filters what is awaiting approval (the Awaiting Approval saved view)", [row["id"] for row in awaiting["results"]] == [cid]
              and api("get", "/api/v1/workspace/approvals/").json()["awaiting"] == 1 and api("get", "/api/v1/campaigns/?approval=nonsense").status_code == 400, str(awaiting)[:200])

        # ---- 4. who may decide
        no_right = api("post", f"/api/v1/campaigns/{cid}/approve/", {}, h=HD)
        other = new("ZA Own Goal", h=H)
        api("post", f"/api/v1/campaigns/{other['id']}/request-approval/", {"note": "mine"}, h=H)
        own = api("post", f"/api/v1/campaigns/{other['id']}/approve/", {}, h=H)
        check("approving needs campaign.approve (403 without it) and is never the requester's own to give (409)",
              no_right.status_code == 403 and own.status_code == 409 and "own campaign" in own.json()["detail"], f"{no_right.status_code} {own.status_code} {own.content[:160]}")
        blank = api("post", f"/api/v1/campaigns/{cid}/send-back/", {"note": "  "}, h=HM)
        sent_mail.clear()
        back = api("post", f"/api/v1/campaigns/{cid}/send-back/", {"note": "The code should be 15%, not 10%."}, h=HM).json()
        holdup = api("get", f"/api/v1/campaigns/{cid}/checklist/").json()["problems"].get("approval", "")
        check("sending back needs a note; the campaign is RETURNED with the reason, the author is emailed, and the checklist says what to do",
              blank.status_code == 409 and back["approval"]["status"] == "RETURNED" and back["approval"]["decided_by_name"] == "Maria Chen" and back["approval"]["decision_note"].startswith("The code")
              and "request_approval" in back["actions"] and holdup.startswith("Sent back: The code") and sent_mail and sent_mail[0]["to"] == [devon.email] and "sent back" in sent_mail[0]["subject"]
              and "APPROVAL_RETURNED" in activity(cid), f"{blank.status_code} {holdup} {sent_mail}")

        # ---- 5. approval, then a change withdraws it
        api("post", f"/api/v1/campaigns/{cid}/request-approval/", {"note": "Now 15%."}, h=HD)
        sent_mail.clear()
        ok = api("post", f"/api/v1/campaigns/{cid}/approve/", {"note": "Looks right."}, h=HM).json()
        checklist = api("get", f"/api/v1/campaigns/{cid}/checklist/").json()
        check("approved: APPROVED with the approver and note, the checklist item is done, the author is emailed",
              ok["approval"]["status"] == "APPROVED" and ok["approval"]["decided_by_name"] == "Maria Chen" and "approve" not in ok["actions"] and "request_approval" not in ok["actions"]
              and next(i for i in checklist["items"] if i["key"] == "approval")["ok"] is True and "approval" not in checklist["problems"]
              and sent_mail and sent_mail[0]["to"] == [devon.email] and "was approved" in sent_mail[0]["subject"] and "APPROVED" in activity(cid), f"{ok['approval']} {sent_mail}")
        only_step = api("patch", f"/api/v1/campaigns/{cid}/", {"setup_step": 6}, h=HD).json()
        renamed = api("patch", f"/api/v1/campaigns/{cid}/", {"name": "ZA Holiday Preview v2"}, h=HD).json()
        check("moving through the setup keeps the approval; changing the campaign withdraws it, with a note in the activity log",
              only_step["approval"]["status"] == "APPROVED" and renamed["approval"] is None and "request_approval" in renamed["actions"] and "APPROVAL_WITHDRAWN" in activity(cid)
              and publish(cid).status_code == 409, f"{only_step['approval']} {renamed['approval']}")
        api("post", f"/api/v1/campaigns/{cid}/request-approval/", {}, h=HD)
        api("post", f"/api/v1/campaigns/{cid}/approve/", {}, h=HM)
        api("post", f"/api/v1/campaigns/{cid}/lists/", {"contact_list": list_b, "role": "INCLUDE"}, h=HD)
        check("attaching a list after approval withdraws it too", api("get", f"/api/v1/campaigns/{cid}/", h=HD).json()["approval"] is None)

        # ---- 6. approved → published, and the send completion is notified
        api("post", f"/api/v1/campaigns/{cid}/request-approval/", {}, h=HD)
        api("post", f"/api/v1/campaigns/{cid}/approve/", {}, h=HM)
        settings_before = api("put", "/api/v1/workspace/notifications/", {"emails": ["ops@nwa.example"], "webhook_url": "https://hooks.example/T0/B0/x"}).json()
        sent_mail.clear(); posted.clear()
        published = publish(cid)
        run_id = published.json()["id"]
        with NO_QUIET:
            outcome = engine.process_run(TENANT, run_id)
        check("an approved campaign publishes (201) and its send completes", published.status_code == 201 and outcome["status"] == "COMPLETED" and outcome["sent"] == 3, f"{published.status_code} {outcome}")
        done = [m for m in sent_mail if "send completed" in m["subject"]]
        check("... the owner is emailed 'send completed' with the numbers and the webhook gets the same (owner on, recipients off, webhook on by default)",
              len(done) == 1 and done[0]["to"] == [devon.email] and "3 sent" in done[0]["lines"][0] and len(posted) == 1 and "send completed" in posted[0]["text"] and posted[0]["url"].startswith("https://hooks.example"),
              f"{done} {posted}")

        # ---- 7. Settings → Notifications
        check("the notification settings come back merged with the defaults, with the event catalogue",
              settings_before["emails"] == ["ops@nwa.example"] and settings_before["events"]["send_failed"] == {"owner": True, "recipients": True, "webhook": True}
              and settings_before["webhook_tested_at"] is None and {e["key"] for e in settings_before["catalogue"]} == set(notifications.EVENTS), str(settings_before)[:200])
        bad_mail = api("put", "/api/v1/workspace/notifications/", {"emails": ["ops@nwa.example", "not-an-address"]})
        bad_hook = api("put", "/api/v1/workspace/notifications/", {"webhook_url": "ftp://hooks.example"})
        bad_event = api("put", "/api/v1/workspace/notifications/", {"events": {"moon_phase": {"webhook": True}}})
        changed = api("put", "/api/v1/workspace/notifications/", {"events": {"send_completed": {"webhook": False}}}).json()
        check("... validates addresses, the webhook scheme and the event keys; a matrix change keeps the other channels",
              bad_mail.status_code == 400 and "not-an-address" in bad_mail.json()["errors"]["emails"] and bad_hook.status_code == 400 and bad_event.status_code == 400
              and changed["events"]["send_completed"] == {"owner": True, "recipients": False, "webhook": False}, f"{bad_mail.content[:120]} {changed['events']['send_completed']}")
        posted.clear(); sent_mail.clear()
        tested = api("post", "/api/v1/workspace/notifications/test/").json()
        after = api("get", "/api/v1/workspace/notifications/").json()
        check("Send a Test Message reaches the configured addresses and the webhook, and records when the webhook last worked",
              tested == {"email": 1, "webhook": True, "webhook_configured": True, "emails_configured": 1} and sent_mail[0]["to"] == ["ops@nwa.example"] and posted and after["webhook_tested_at"], f"{tested} {after.get('webhook_tested_at')}")
        check("notification settings are for administrators", api("get", "/api/v1/workspace/notifications/", h=HD).status_code == 403)

        # ---- 8. a send that cannot start, and a circuit that opens
        posted.clear(); sent_mail.clear()
        cid2 = new("ZA Failing", h=H)["id"]
        api("put", "/api/v1/workspace/approvals/", {"require_approval": False})
        run2 = publish(cid2, h=H).json()["id"]
        with NO_QUIET, mock.patch("apps.platform_ops.billing.assert_can_send", side_effect=RuntimeError("The plan has used its messages for this month")):
            try:
                engine.process_run(TENANT, run2)
            except Exception:                                  # noqa: BLE001
                pass
        failed = [m for m in sent_mail if "could not start" in m["subject"] or "failed" in m["subject"]]
        check("with approval switched off the publish goes straight through; a run that cannot start tells the owner and the recipients (send_failed defaults) and the webhook",
              failed and set(failed[0]["to"]) == {admin.email, "ops@nwa.example"} and any("failed" in p["text"] or "could not start" in p["text"] for p in posted), f"{sent_mail} {posted}")

        posted.clear(); sent_mail.clear()
        guard = mock.Mock(system="Postal", tenant_id=TENANT)
        guard.breaker.threshold = 5
        outbound._trouble(guard, {"tenant_id": TENANT, "breaker_cooldown_seconds": 90}, RuntimeError("401 Unauthorized"))
        check("a circuit that opens notifies the recipients and the webhook (engine_trouble defaults), naming the engine, the error and when sending resumes",
              sent_mail and sent_mail[0]["to"] == ["ops@nwa.example"] and "Postal" in sent_mail[0]["subject"] and "401" in sent_mail[0]["lines"][0] and "90 seconds" in sent_mail[0]["lines"][1]
              and posted and "Postal" in posted[0]["text"], f"{sent_mail} {posted}")

        transaction.set_rollback(True)
    check.done()
