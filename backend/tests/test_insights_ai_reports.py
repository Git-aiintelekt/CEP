"""AI Reports (docs/mockups/ai-reports-page.html, option A): the menu item follows the box (GET /me insights.ai_reports); a name given
with the prompt is the draft's; the history pages newest first; the pencil renames the draft or the report it became; Clear History
empties the list but keeps the month's count; reports drafted by AI are marked in the list. The provider is faked."""
from urllib.parse import urlencode

import pytest
from django.db import connections

from apps.insights import assistant
from tests.test_insights_assistant import DRAFT, _tables
from tests.test_insights_assistant_progress import _provider

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
MODEL = "anthropic:claude-sonnet-5-5"


def _set_ai(world, enabled: bool):
    world.api("put", "/api/v1/workspace/ai-assistant/", {"enabled": enabled})


def _clearable() -> bool:
    with connections["platform"].cursor() as cursor:
        cursor.execute("SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_prompt' AND column_name = 'cleared_at'")
        return cursor.fetchone() is not None


def test_ai_reports(check, world, monkeypatch):
    if not _tables():
        pytest.skip("patch 0055 (and 0049) have not been applied to this database")
    _provider()
    monkeypatch.setattr(assistant, "call_model", lambda provider, row, model, system, user, **kwargs: (DRAFT, {"in": 120, "out": 30}))
    monkeypatch.setattr(assistant.billing, "plan_for", lambda tenant_id: {"name": "Growth", "max_ai_prompts": 50})

    me = world.api("get", "/api/v1/me/").json()
    check("with a provider on and AI on for the workspace, the menu offers AI Reports", me["insights"].get("ai_reports") is True, me.get("insights"))
    _set_ai(world, False)
    check("with AI switched off for the workspace, the menu does not", world.api("get", "/api/v1/me/").json()["insights"]["ai_reports"] is False)
    _set_ai(world, True)

    named = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign for September", "model": MODEL, "name": "  Store   Leaderboard "}).json()
    check("a name given with the prompt is the draft's, tidied", named["kind"] == "draft" and named["name"] == "Store Leaderboard", named.get("name"))
    check("the reply carries the tokens used", named.get("tokens") == {"in": 120, "out": 30}, named.get("tokens"))
    long = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign", "model": MODEL, "name": "x" * 201})
    check("a name over 200 characters is refused before the model is asked", long.status_code == 400, str(long.content[:200]))
    plain = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign for October", "model": MODEL}).json()
    check("without a name the model's stays", plain["name"] == DRAFT["name"], plain.get("name"))

    world.sql("UPDATE ai_prompt SET created_at = created_at - interval '1 minute' WHERE id = %s", [named["id"]])     # one transaction: one now()
    page = world.api("get", "/api/v1/insights/assistant/history/?limit=1").json()
    check("the history is newest first, a page at a time, with more behind it",
          [p["id"] for p in page["prompts"]] == [plain["id"]] and page["more"] is True and page["prompts"][0]["draft_name"] == DRAFT["name"], page)
    rest = world.api("get", "/api/v1/insights/assistant/history/?" + urlencode({"limit": 30, "before": page["prompts"][0]["id"]})).json()
    check("the next page starts before the last prompt shown", rest["prompts"][0]["id"] == named["id"] and not rest["more"], rest)

    renamed = world.api("post", f"/api/v1/insights/assistant/{named['id']}/rename/", {"name": "Leaderboard, Last 30 Days"})
    check("the pencil renames a draft not opened yet", renamed.status_code == 200 and renamed.json()["draft_name"] == "Leaderboard, Last 30 Days", str(renamed.content[:200]))
    opened = world.api("post", f"/api/v1/insights/assistant/{named['id']}/open/", {}).json()
    check("opening it later keeps the new name", opened["name"] == "Leaderboard, Last 30 Days", opened.get("name"))
    report = world.api("post", f"/api/v1/insights/assistant/{named['id']}/rename/", {"name": "Store Delivery Leaderboard"}).json()
    check("once opened, the pencil renames the report itself", report["report_id"] == opened["id"]
          and world.api("get", f"/api/v1/insights/reports/{opened['id']}/").json()["name"] == "Store Delivery Leaderboard", report)
    check("an empty name is refused", world.api("post", f"/api/v1/insights/assistant/{named['id']}/rename/", {"name": "  "}).status_code == 400)

    listed = {r["id"]: r for r in world.api("get", "/api/v1/insights/reports/").json()["reports"]}
    check("a report drafted by AI is marked in the list", listed[opened["id"]]["ai"] is True and not any(r["ai"] for i, r in listed.items() if i != opened["id"]), listed.get(opened["id"]))

    if not _clearable():
        check("without patch 0078 Clear History says what it needs",
              world.api("post", "/api/v1/insights/assistant/history/clear/").status_code == 409)
        check.done()
        return
    used = world.api("get", "/api/v1/insights/assistant/").json()["usage"]["used"]
    cleared = world.api("post", "/api/v1/insights/assistant/history/clear/").json()
    check("Clear History clears the person's prompts", cleared["cleared"] >= 2, cleared)
    check("the history is empty afterwards", world.api("get", "/api/v1/insights/assistant/history/").json()["prompts"] == [])
    check("the month's count is unchanged", world.api("get", "/api/v1/insights/assistant/").json()["usage"]["used"] == used)
    check.done()
