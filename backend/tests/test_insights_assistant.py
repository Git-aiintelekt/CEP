"""AI · Ask for a Report (apps/insights/assistant): what the model is told and how its reply is read (pure), and the API with the
provider faked: the box's state, a draft counted against the month, a question back not counted, Open in Editor, the
workspace's switch and the plan's number."""
import json

import pytest
from django.conf import settings
from django.db import connections

from apps.insights import assistant
from apps.insights.definition import DefinitionError
from tests.test_insights import DATASET

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

P = settings.PLATFORM_ALIAS
NWA = "a0000000-0000-4000-8000-000000000001"
DATASETS = [{**DATASET, "component": {"key": "cep", "name": "Engagement"}, "description": "Every message sent", "locked": [{"key": "email", "label": "Email"}],
             "fields": [f for f in DATASET["fields"] if f["key"] != "party_id"]}]
DRAFT = {"kind": "draft", "name": "sent by campaign for september", "dataset": "messages", "view": {"type": "chart", "chart": "bar"},
         "definition": {"columns": [{"field": "campaign_name"}, {"field": "sent", "aggregate": "sum"}],
                        "filters": {"combinator": "and", "rules": [{"field": "submitted_at", "operator": "between", "value": ["2026-09-01", "2026-09-30"]}]},
                        "orderBy": [{"field": "sent", "direction": "desc"}], "limit": 500}}


def test_words_and_reading(check):
    from datetime import date
    system = assistant.system_prompt(DATASETS, "America/New_York", date(2026, 10, 17))
    check("the model is told the catalogue by key and label, with what each field allows, and the day in the workspace's zone",
          '"messages" · Messages (Engagement)' in system and '"campaign_name" · Campaign · string · dimension' in system and "aggregates: sum" in system
          and "buckets: day, week, month, quarter, year" in system and "Today is 2026-10-17 in the America/New_York time zone" in system)
    check("a locked personal-data field is not in the catalogue the model sees", "party_id" not in system and '"email"' not in system)

    out = assistant.interpret(DRAFT, DATASETS, max_limit=5000)
    check("a draft is validated against its dataset and keeps its name, view and definition", out["kind"] == "draft" and out["name"] == "sent by campaign for september"
          and out["dataset_label"] == "Messages" and out["view"] == {"type": "chart", "chart": "bar"} and out["definition"]["columns"][1] == {"field": "sent", "aggregate": "sum"}
          and out["definition"]["filters"]["rules"][0]["operator"] == "between", json.dumps(out))
    try:
        assistant.interpret({**DRAFT, "definition": {**DRAFT["definition"], "columns": [{"field": "website_visits"}]}}, DATASETS, max_limit=5000)
        check("a draft on a field that does not exist is refused for the retry", False)
    except DefinitionError as exc:
        check("a draft on a field that does not exist is refused for the retry", exc.field == "columns[0].field" and "Not a field" in str(exc), f"{exc.field}: {exc}")
    try:
        assistant.interpret({**DRAFT, "dataset": "web"}, DATASETS, max_limit=5000)
        check("a draft on an unknown dataset is refused", False)
    except DefinitionError as exc:
        check("a draft on an unknown dataset is refused", exc.field == "dataset")
    q = assistant.interpret({"kind": "question", "question": "Which period is last month?", "answers": [{"label": "September", "prompt": "Revenue for September 2026"}, {"label": "30 days", "prompt": "Revenue for the last 30 days"}]}, DATASETS, max_limit=5000)
    check("a question keeps its answers as prompts", q["kind"] == "question" and len(q["answers"]) == 2 and q["answers"][0]["prompt"] == "Revenue for September 2026")
    n = assistant.interpret({"kind": "no_field", "message": "No dataset has website visits.", "suggestions": [{"label": "Clicks", "prompt": "Clicks by campaign"}]}, DATASETS, max_limit=5000)
    check("no field for this keeps its message and the closest prompts", n["kind"] == "no_field" and n["suggestions"] == [{"label": "Clicks", "prompt": "Clicks by campaign"}])

    rows = {"anthropic": {"model_reports": "claude-sonnet-5-5", "model_fast": "claude-haiku-5-5"}, "openai": {"model_reports": "gpt-5", "model_fast": "gpt-5-mini"}}
    models = assistant.models_of(rows)
    check("the models offered: each provider's reports model then its fast one, labelled", [m["id"] for m in models] == ["anthropic:claude-sonnet-5-5", "anthropic:claude-haiku-5-5", "openai:gpt-5", "openai:gpt-5-mini"]
          and models[0]["label"] == "Claude Sonnet 5.5" and models[0]["note"] == "Best for reports" and models[3]["note"] == "Fastest")
    check("the month's words", assistant.usage_words({"used": 38, "limit": 200, "plan": "Growth"}).startswith("38 of 200 prompts used in")
          and assistant.usage_words({"used": 0, "limit": 200, "plan": "Growth"}) == "200 prompts a month on the Growth plan"
          and assistant.usage_words({"used": 0, "limit": None, "plan": "Enterprise"}) == "No limit on prompts on the Enterprise plan")
    check.done()


def _tables() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ai_provider', 'ai_prompt', 'report', 'report_run_audit')")
        return cursor.fetchone()[0] == 4


def test_api(check, world, monkeypatch):
    if not _tables():
        pytest.skip("patch 0055 (and 0049) have not been applied to this database")
    from apps.platform_ops import crypto
    with connections[P].cursor() as cursor:
        cursor.execute("INSERT INTO ai_provider (provider, api_key_enc, model_reports, model_fast, is_active) VALUES ('anthropic', %s, 'claude-sonnet-5-5', 'claude-haiku-5-5', TRUE)", [crypto.encrypt("sk-test")])
        cursor.execute("INSERT INTO ai_provider (provider, api_key_enc, model_reports, model_fast, is_active) VALUES ('openai', %s, 'gpt-5', 'gpt-5-mini', FALSE)", [crypto.encrypt("sk-test")])
    assistant._TABLE_SEEN = False
    calls = []
    replies = {"draft": DRAFT, "question": {"kind": "question", "question": "Which period is last month?", "answers": [{"label": "September", "prompt": "Sent by campaign for September 2026"}, {"label": "30 days", "prompt": "Sent by campaign for the last 30 days"}]}}
    next_reply = ["draft"]

    def fake_call(provider, row, model, system, user, **kwargs):
        calls.append({"provider": provider, "model": model, "key": crypto.decrypt(row["api_key_enc"]), "user": user, "system": system})
        return replies[next_reply[0]], {"in": 1200, "out": 90}

    monkeypatch.setattr(assistant, "call_model", fake_call)
    monkeypatch.setattr(assistant.billing, "plan_for", lambda tenant_id: {"name": "Growth", "max_ai_prompts": 2})

    state = world.api("get", "/api/v1/insights/assistant/").json()
    check("the box offers the switched-on provider's two models, the default, the month's use and the examples", state["enabled"] and [m["id"] for m in state["models"]] == ["anthropic:claude-sonnet-5-5", "anthropic:claude-haiku-5-5"]
          and state["default_model"] == "anthropic:claude-sonnet-5-5" and state["usage"]["used"] == 0 and state["usage"]["limit"] == 2 and state["examples"] and state["recent"] == [], json.dumps(state)[:300])

    bad = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "", "model": "anthropic:claude-sonnet-5-5"})
    check("an empty prompt is refused", bad.status_code == 400)
    bad = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign", "model": "openai:gpt-5"})
    check("a model of a provider that is switched off is refused", bad.status_code == 400 and "model" in bad.json().get("errors", {}), str(bad.content[:200]))

    asked = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign for September as bars", "model": "anthropic:claude-haiku-5-5"})
    body = asked.json()
    check("a prompt goes to the provider with its key and the catalogue, and comes back as a draft with a preview count and the month's use",
          asked.status_code == 200 and body["kind"] == "draft" and body["counted"] and body["model"]["label"] == "Claude Haiku 5.5" and body["name"] == "sent by campaign for september"
          and body["dataset_label"] == "Messages" and body["view"]["type"] == "chart" and body["preview"] is not None and body["usage"]["used"] == 1
          and calls[-1]["key"] == "sk-test" and calls[-1]["model"] == "claude-haiku-5-5" and '"campaign_name"' in calls[-1]["system"] and calls[-1]["user"] == "Sent by campaign for September as bars",
          json.dumps(body)[:400])
    prompt_id = body["id"]
    state = world.api("get", "/api/v1/insights/assistant/").json()
    check("the prompt is in the person's recent prompts, not saved yet", state["recent"][0]["prompt"] == "Sent by campaign for September as bars" and state["recent"][0]["outcome"] == "DRAFT" and state["recent"][0]["report_id"] is None)

    opened = world.api("post", f"/api/v1/insights/assistant/{prompt_id}/open/")
    report = opened.json()
    check("Open in Editor makes the draft a private report of the person's, with a first version", opened.status_code == 201 and report["name"] == "sent by campaign for september" and report["visibility"] == "PRIVATE"
          and report["dataset"] == "messages" and report["definition"]["view"]["type"] == "chart" and report["version"] == 1, json.dumps(report)[:300])
    again = world.api("post", f"/api/v1/insights/assistant/{prompt_id}/open/").json()
    check("opening it again returns the same report", again["id"] == report["id"])
    state = world.api("get", "/api/v1/insights/assistant/").json()
    check("the recent prompt now names the report it became", state["recent"][0]["report_id"] == report["id"] and state["recent"][0]["report_name"] == report["name"])

    next_reply[0] = "question"
    asked = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Which campaigns sent the most last month?", "model": "anthropic:claude-sonnet-5-5"}).json()
    check("a question back is not counted and carries its answers", asked["kind"] == "question" and not asked["counted"] and asked["answers"][0]["prompt"] == "Sent by campaign for September 2026" and asked["usage"]["used"] == 1)
    next_reply[0] = "draft"
    answered = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": asked["answers"][0]["prompt"], "model": "anthropic:claude-sonnet-5-5", "answer_to": asked["id"]}).json()
    check("the answer becomes the next prompt, and the draft it gives counts", answered["kind"] == "draft" and answered["usage"]["used"] == 2)
    over = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Anything else", "model": "anthropic:claude-sonnet-5-5"})
    check("the plan's number for the month stops the next prompt with a plain reason", over.status_code == 409 and "2 prompts" in over.json()["detail"], str(over.content[:200]))

    mine = world.api("get", "/api/v1/workspace/ai-assistant/").json()
    check("Settings → AI Assistant shows the switches, the providers the platform offers and the month's use", mine["enabled"] and mine["providers"] == {"anthropic": True, "openai": True}
          and [p["key"] for p in mine["available"]] == ["anthropic"] and mine["usage"]["used"] == 2 and mine["usage"]["limit"] == 2 and mine["retention_days"] == 90, json.dumps(mine)[:300])
    off = world.api("put", "/api/v1/workspace/ai-assistant/", {"enabled": False})
    state = world.api("get", "/api/v1/insights/assistant/").json()
    check("switched off by the workspace, the box is gone and a prompt is refused", off.status_code == 200 and not off.json()["enabled"] and not state["enabled"] and state["reason"] == "workspace_off"
          and world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign", "model": "anthropic:claude-sonnet-5-5"}).status_code == 409)
    world.api("put", "/api/v1/workspace/ai-assistant/", {"enabled": True, "providers": {"anthropic": False}})
    state = world.api("get", "/api/v1/insights/assistant/").json()
    check("with every offered provider disallowed, the box says so", not state["enabled"] and state["reason"] == "no_provider_allowed")
    bad = world.api("put", "/api/v1/workspace/ai-assistant/", {"providers": {"gemini": True}})
    check("an unknown provider is refused", bad.status_code == 400)
    check.done()
