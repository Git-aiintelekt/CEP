"""Ask for a Report's progress and name (docs/mockups/ask-for-report-name-and-progress.html: option A's steps, option B's name):
the steps of a prompt are reported as they happen and come back with the reply; a draft that does not fit adds the second try;
a failure stops at its step with the reason; Open in Editor takes the name the person gave the draft. The provider is faked."""
import json
import uuid

import pytest
from django.db import connections

from apps.insights import assistant
from apps.platform_ops import crypto
from tests.test_insights_assistant import DRAFT, _tables

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _provider():
    with connections["platform"].cursor() as cursor:
        cursor.execute("INSERT INTO ai_provider (tenant_id, provider, api_key_enc, model_reports, model_fast, is_active) VALUES (NULL, 'anthropic', %s, 'claude-sonnet-5-5', 'claude-haiku-5-5', TRUE)",
                       [crypto.encrypt("sk-test")])
    assistant._TABLE_SEEN = False


def test_progress_and_name(check, world, monkeypatch):
    if not _tables():
        pytest.skip("patch 0055 (and 0049) have not been applied to this database")
    _provider()
    replies = []

    def fake_call(provider, row, model, system, user, **kwargs):
        reply = replies.pop(0) if replies else DRAFT
        if isinstance(reply, Exception):
            raise reply
        return reply, {"in": 10, "out": 5}

    monkeypatch.setattr(assistant, "call_model", fake_call)
    monkeypatch.setattr(assistant.billing, "plan_for", lambda tenant_id: {"name": "Growth", "max_ai_prompts": 50})
    model = "anthropic:claude-sonnet-5-5"

    progress = str(uuid.uuid4())
    asked = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign for September", "model": model, "progress": progress}).json()
    steps = asked["steps"]
    check("a plain prompt has three steps, all done: Claude drafting, the check, the preview",
          [(s["key"], s["state"]) for s in steps] == [("draft", "done"), ("check", "done"), ("preview", "done")] and steps[0]["label"] == "Claude is drafting the report"
          and steps[0]["detail"] == "Claude Sonnet 5.5", json.dumps(steps)[:400])
    read = world.api("get", f"/api/v1/insights/assistant/progress/{progress}/").json()
    check("the same steps are read back by the progress id, finished", read["finished"] and [s["key"] for s in read["steps"]] == ["draft", "check", "preview"], read)
    check("an unknown progress id reads as no steps yet", world.api("get", f"/api/v1/insights/assistant/progress/{uuid.uuid4()}/").json() == {"steps": [], "finished": False})

    replies[:] = [{**DRAFT, "definition": {**DRAFT["definition"], "columns": [{"field": "website_visits"}]}}, DRAFT]
    retried = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign", "model": model}).json()["steps"]
    check("a draft that does not fit adds the second try and its check, the first check saying why",
          [s["key"] for s in retried] == ["draft", "check", "retry", "check_again", "preview"] and all(s["state"] == "done" for s in retried)
          and retried[1]["detail"].startswith("The first draft did not fit") and retried[2]["label"] == "Claude is trying again", json.dumps(retried)[:500])

    replies[:] = [assistant.ProviderError("The provider answered 400: something")]
    failed = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign", "model": model}).json()
    check("a failure stops at its step with the reason; the steps after it stay waiting", failed["kind"] == "failed"
          and [(s["key"], s["state"]) for s in failed["steps"]] == [("draft", "failed"), ("check", "wait"), ("preview", "wait")]
          and "400" in failed["steps"][0]["detail"], json.dumps(failed["steps"])[:400])

    opened = world.api("post", f"/api/v1/insights/assistant/{asked['id']}/open/", {"name": "  My   September Sends  "})
    check("Open in Editor takes the name given to the draft", opened.status_code == 201 and opened.json()["name"] == "My September Sends", str(opened.content[:300]))
    again = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign", "model": model}).json()
    long = world.api("post", f"/api/v1/insights/assistant/{again['id']}/open/", {"name": "x" * 201})
    check("a name over 200 characters is refused", long.status_code == 400 and "name" in long.json().get("errors", {}), str(long.content[:200]))
    plain = world.api("post", f"/api/v1/insights/assistant/{again['id']}/open/", {})
    check("without a name the model's stays", plain.status_code == 201 and plain.json()["name"] == DRAFT["name"], str(plain.content[:200]))
    check.done()
