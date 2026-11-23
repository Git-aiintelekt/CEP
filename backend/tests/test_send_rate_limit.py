"""An engine's Messages per Minute paces a run: what does not fit waits for the next pass, and nothing fails for it.
A throw-away SMTP listener receives the mail; the throttle's clock is moved by hand. Every change is rolled back."""
import json
import socketserver
import threading
from types import SimpleNamespace
from unittest import mock

import pytest
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.delivery import engine
from apps.delivery.engine.dispatch import RetryBatch
from apps.delivery.models import DeliveryProvider, SenderProfile
from apps.identity.models import AppUser
from apps.integrations.bridge import throttle
from apps.tenants import context

MINUTE = 1_800_000_000                                      # a minute boundary: the throttle's windows start here


@pytest.mark.django_db(databases=["default", "platform"])
@pytest.mark.slow
def test_rate_limited_run_waits_instead_of_failing(admin_email):
    class Handler(socketserver.StreamRequestHandler):
        inbox = []

        def handle(self):
            say = lambda line: self.wfile.write((line + "\r\n").encode())          # noqa: E731
            say("220 test")
            rcpt = ""
            while line := self.rfile.readline().decode(errors="replace").rstrip("\r\n"):
                verb = line.split(" ")[0].upper()
                if verb == "RCPT":
                    rcpt = line.split(":", 1)[1].strip("<> ")
                    say("250 ok")
                elif verb == "DATA":
                    say("354 go")
                    while self.rfile.readline().decode(errors="replace").rstrip("\r\n") != ".":
                        pass
                    Handler.inbox.append(rcpt)
                    say("250 queued")
                elif verb == "QUIT":
                    say("221 bye")
                    return
                else:
                    say("250 ok")

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    tenant, code = str(admin.tenant_id), admin.tenant.code
    client = Client()
    headers = {"HTTP_X_TENANT": code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None):
        return getattr(client, method)(path, json.dumps(body or {}), content_type="application/json", **headers)

    def sql(statement, args=None):
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [tenant])
            cursor.execute(statement, args or [])
            return cursor.fetchall() if cursor.description else None

    def send_pass(at):
        clock = SimpleNamespace(time=lambda: at, sleep=lambda seconds: None)
        with mock.patch.object(throttle, "time", clock), mock.patch.object(throttle, "MAX_WAIT_SECONDS", 0.0):
            return engine.process_run(tenant, run_id)

    try:
        with transaction.atomic():
            people = [(f"ZZ-RL{n}", f"zz.rl{n}@example.com") for n in range(1, 6)]
            for party, email in people:
                sql("INSERT INTO customer_master (party_id, tenant_id, first_name, emails) VALUES (%s, %s, 'Zed', %s::jsonb)",
                    [party, tenant, json.dumps([{"address": email, "is_primary": True, "is_valid": True}])])
                sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'EMAIL', 'OPTED_IN', TRUE, now())",
                    [tenant, party])
            list_id = sql("INSERT INTO contact_list (tenant_id, name, source_type, created_by) VALUES (%s, 'ZZ paced list', 'UPLOAD', %s) RETURNING id", [tenant, str(admin.pk)])[0][0]
            for party, _ in people:
                sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, tenant, party])
            provider = DeliveryProvider.objects.create(tenant_id=tenant, provider_type="SMTP", channel="EMAIL", name="ZZ paced smtp", is_active=True, rate_limit_per_minute=2,
                                                       config={"host": "127.0.0.1", "port": server.server_address[1], "security": "NONE"})
            sender = SenderProfile.objects.create(tenant_id=tenant, delivery_provider=provider, channel="EMAIL", display_name="ZZ Shop", from_address="hello@zz-shop.example",
                                                  verification_status="VERIFIED")
            template = api("post", "/api/v1/templates/", {"name": "ZZ paced template", "channel": "EMAIL"}).json()
            sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, html_content, text_content) VALUES (%s, 1, 'Hello', '<p>Hi {{first_name}}</p>', 'Hi')",
                [template["id"]])
            sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [template["id"]])
            campaign = api("post", "/api/v1/campaigns/", {"name": "ZZ paced campaign", "campaign_type": "REGULAR_MARKETING", "channel": "EMAIL", "template": template["id"],
                                                          "sender_profile": str(sender.pk), "contact_lists": [str(list_id)], "solicitation_type": "SERVICE"}).json()
            with mock.patch("api.v1.views._enqueue_run"):
                run_id = api("post", f"/api/v1/campaigns/{campaign['id']}/publish/").json()["id"]

            first = send_pass(MINUTE + 1)
            waiting = sql("SELECT status, attempts, status_reason FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED'", [tenant, run_id])
            run_status = sql("SELECT status FROM campaign_run WHERE id = %s", [run_id])[0][0]
            assert len(Handler.inbox) == 2 and first["sent"] == 2 and first["failed"] == 0 and first["status"] is None and first["held_for"] >= 1, first
            assert run_status == "SENDING"
            assert len(waiting) == 3 and all(attempts == 0 for _, attempts, _ in waiting), waiting      # held before it was offered: no attempt counted
            assert "Waiting for the engine's limit of 2 messages per minute" in {reason for *_, reason in waiting}, waiting

            second = send_pass(MINUTE + 61)
            assert len(Handler.inbox) == 4 and second["sent"] == 4 and second["failed"] == 0 and second["status"] is None, second

            third = send_pass(MINUTE + 121)
            assert sorted(Handler.inbox) == sorted(email for _, email in people)
            assert third["status"] == "COMPLETED" and third["sent"] == 5 and third["failed"] == 0 and third["queued"] == 0, third
            transaction.set_rollback(True)
    finally:
        server.shutdown()


def test_celery_worker_sends_a_held_batch_again_after_the_wait():
    """A held batch is a fresh task after the wait: it uses up none of the five retries a failing provider gets, and its
    messages stay with a worker until then (the send window does not give them out again)."""
    from workers import email, sms
    for worker, target, kind in ((email, "workers.email.dispatch.send_batch", "EMAIL"), (sms, "workers.sms.dispatch_sms.send_batch", "SMS")):
        with mock.patch(target, side_effect=RetryBatch([7, 8], "Waiting for the engine's limit of 2 messages per minute", retry_after=42)), \
                mock.patch.object(worker.send_batch, "apply_async") as again, mock.patch.object(worker.send_batch, "retry") as retry, \
                mock.patch.object(worker.runs, "hold") as hold, \
                mock.patch("workers.campaign.finalize_run.delay"), mock.patch.object(worker.session, "tenant_scope", return_value=mock.MagicMock()):
            outcome = worker.send_batch("tenant", "run", [7, 8])
        assert outcome == {"held": 2, "retry_after": 42}
        again.assert_called_once_with(args=["tenant", "run", [7, 8]], countdown=42)
        hold.assert_called_once_with("tenant", kind, [7, 8], 42)
        retry.assert_not_called()
