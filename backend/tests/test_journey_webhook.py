"""The Webhook step (apps.journeys.webhooks): the address and the secret on save, the signed POST with the customer and journey
context, a 2xx as success, 429 / 5xx and connection trouble as temporary (retried), other 4xx as permanent, the integration log
behind the journey page's Webhook Calls card, and Send a Test Call."""
import hashlib
import hmac
import json
import uuid
from types import SimpleNamespace

import pytest
import requests
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.journeys import graph, publish, webhooks
from apps.journeys.engine import steps
from apps.journeys.engine.outcome import Done
from apps.journeys.models import JourneyEnrollment, JourneyNode, JourneyVersion
from apps.platform_ops import crypto

from .test_journey_events import T, customers, make_journey, sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


class FakeResponse:
    def __init__(self, status, text="ok"):
        self.status_code, self.text, self.headers = status, text, {"Content-Type": "text/plain"}
        self.content = text.encode("utf-8")


def test_webhook_rules(check):
    check("the address must be https (or localhost)", webhooks.problem({"url": "https://hooks.example.com/cep"}) is None and "https" in webhooks.problem({"url": "http://hooks.example.com/cep"})
          and webhooks.problem({"url": "http://localhost:9000/x"}) is None and webhooks.problem({}) == "Enter the address to call." and webhooks.problem({"url": "not a url"}) is not None)
    cleaned = webhooks.clean_config({"url": " https://hooks.example.com/cep ", "secret": "shh"})
    check("a secret entered plain is kept encrypted and never plain", "secret" not in cleaned and cleaned["secret_enc"] != "shh" and crypto.decrypt(cleaned["secret_enc"]) == "shh"
          and cleaned["url"] == "https://hooks.example.com/cep")
    check("an empty secret clears it; no secret key keeps what is stored", "secret_enc" not in webhooks.clean_config({"url": "https://a.example", "secret_enc": "kept", "secret": ""})
          and webhooks.clean_config({"url": "https://a.example", "secret_enc": "kept"})["secret_enc"] == "kept")
    check("readiness and the card's words", publish._step_configured(SimpleNamespace(node_type="WEBHOOK", config={"url": "https://hooks.example.com/cep"}))
          and not publish._step_configured(SimpleNamespace(node_type="WEBHOOK", config={})) and webhooks.describe({"url": "https://hooks.example.com/cep"}) == "Webhook: hooks.example.com")
    saved = graph.clean({"entry_rules": [], "nodes": [{"key": "start", "type": "START", "config": {}}, {"key": "w", "type": "WEBHOOK", "config": {"url": "https://hooks.example.com/cep", "secret": "shh"}}],
                         "connections": [{"from": "start", "to": "w"}]})
    config = saved["nodes"][1]["config"]
    check("saving a graph encrypts the step's secret", "secret" not in config and crypto.decrypt(config["secret_enc"]) == "shh", str(config))
    with pytest.raises(ValidationError):
        graph.clean({"entry_rules": [], "nodes": [{"key": "start", "type": "START", "config": {}}, {"key": "w", "type": "WEBHOOK", "config": {"url": "http://hooks.example.com/cep"}}],
                     "connections": [{"from": "start", "to": "w"}]})


def test_webhook_calls(check, admin_email, fresh_cache, monkeypatch):
    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    with session.tenant_scope(T):
        (p1, e1), = customers(1)
        tag = uuid.uuid4().hex[:6].upper()
        journey = make_journey("webhook", entry={"entry_type": "EVENT", "rule_definition": {"event_type": f"ZJ_{tag}"}},
                               nodes=[("WEBHOOK", webhooks.clean_config({"url": "https://hooks.example.com/cep", "secret": "shh", "label": "Tell the CRM", "include_attributes": True}))])
        version = JourneyVersion.objects.get(journey=journey)
        node = JourneyNode.objects.select_related("journey_version").get(journey_version=version, node_key="webhook-0")
        enrollment = JourneyEnrollment.objects.create(journey=journey, journey_version=version, tenant_id=T, party_id=p1, status="ACTIVE")
        state = SimpleNamespace(state_data={}, entered_node_at=timezone.now())
        sent = []
        answers = {"status": 200}

        def fake_post(url, data=None, headers=None, timeout=None, **_kwargs):
            sent.append({"url": url, "data": data, "headers": headers, "timeout": timeout})
            if answers["status"] == "boom":
                raise requests.ConnectionError("connection refused")
            return FakeResponse(answers["status"], "received" if answers["status"] < 300 else "nope")

        monkeypatch.setattr(requests, "post", fake_post)

        done = steps.run(node, state, enrollment)
        body = json.loads(sent[0]["data"])
        headers = sent[0]["headers"]
        expected = "sha256=" + hmac.new(b"shh", headers["X-CEP-Timestamp"].encode() + b"." + sent[0]["data"], hashlib.sha256).hexdigest()
        check("a 2xx answer is success, with the status and the delivery id recorded", isinstance(done, Done) and done.status == "SUCCESS" and done.result["status"] == 200
              and done.result["delivery_id"] == headers["X-CEP-Delivery"], str(done))
        check("the POST carries the customer and journey context, the attributes when asked, and the event headers",
              sent[0]["url"] == "https://hooks.example.com/cep" and body["event"] == "journey.step" and body["journey"]["id"] == str(journey.pk) and body["journey"]["version"] == 1
              and body["step"] == {"key": "webhook-0", "label": "Tell the CRM"} and body["customer"]["party_id"] == p1 and body["customer"]["email"] == e1
              and "attributes" in body["customer"] and body["enrollment"]["id"] == str(enrollment.pk) and headers["Content-Type"] == "application/json"
              and headers["X-CEP-Event"] == "journey.step" and sent[0]["timeout"] == webhooks.TIMEOUT, json.dumps(body)[:400])
        check("the signature is HMAC-SHA256 of timestamp.body with the secret", headers["X-CEP-Signature"] == expected)

        answers["status"] = 503
        done = steps.run(node, state, enrollment)
        check("a 5xx is a temporary failure, retried", done.status == "FAILED" and done.retry and "503" in done.result["reason"], str(done))
        answers["status"] = "boom"
        done = steps.run(node, state, enrollment)
        check("connection trouble is temporary too", done.status == "FAILED" and done.retry and "ConnectionError" in done.result["reason"], str(done))
        answers["status"] = 404
        done = steps.run(node, state, enrollment)
        check("a 404 is permanent: recorded, the customer carries on", done.status == "FAILED" and not done.retry and "404" in done.result["reason"], str(done))
        state.state_data["retry"] = {"step": "webhook-0", "attempts": 2}
        answers["status"] = 200
        steps.run(node, state, enrollment)
        check("a retry says which attempt it is in the log", sql("SELECT attempt FROM integration_log WHERE tenant_id = %s AND system = 'WEBHOOK' ORDER BY id DESC LIMIT 1", [T]) == [(3,)])

        logged = webhooks.calls(journey)
        check("the journey's calls come from the integration log, newest first, with the outcome and the step",
              len(logged) == 5 and logged[0]["outcome"] == "OK" and logged[1]["outcome"] == "REJECTED" and logged[1]["status"] == 404 and logged[2]["outcome"] == "ERROR"
              and logged[3]["outcome"] == "RETRY" and all(row["node_key"] == "webhook-0" and row["enrollment_id"] == str(enrollment.pk) for row in logged), str(logged)[:400])
        check("the log never holds the secret", sql("SELECT count(*) FROM integration_log WHERE tenant_id = %s AND system = 'WEBHOOK' AND (request_headers::text LIKE '%%shh%%' OR request_body LIKE '%%shh%%')", [T]) == [(0,)])

        # ---- Send a Test Call, through the API
        web = APIClient()
        web.force_authenticate(user)
        tested = web.post(f"/api/v1/journeys/{journey.pk}/webhook-test/", {"url": "https://hooks.example.com/cep", "secret": "shh"}, format="json", HTTP_X_TENANT="NWA")
        test_body = json.loads(sent[-1]["data"])
        check("a test call sends a sample customer with the same signature, and answers with the status", tested.status_code == 200 and tested.json()["ok"] and tested.json()["status"] == 200
              and test_body["event"] == "journey.test" and test_body["customer"]["party_id"] == "sample-customer" and test_body["enrollment"] is None and "X-CEP-Signature" in sent[-1]["headers"],
              tested.content[:200])
        refused = web.post(f"/api/v1/journeys/{journey.pk}/webhook-test/", {"url": "http://hooks.example.com/cep"}, format="json", HTTP_X_TENANT="NWA")
        check("a test call with a bad address says so", refused.status_code == 200 and not refused.json()["ok"] and "https" in refused.json()["error"], refused.content[:200])
        listed = web.get(f"/api/v1/journeys/{journey.pk}/webhook-calls/", HTTP_X_TENANT="NWA")
        check("GET webhook-calls lists them, the test call marked", listed.status_code == 200 and len(listed.json()) == 6 and listed.json()[0]["test"] is True, listed.content[:200])
