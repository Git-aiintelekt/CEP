"""The component a report is listed under (docs/mockups/report-component.html, option A): Automatic (its dataset's) unless chosen
when the report is made (New Report, a report from a query, Ask for a Report) or changed later by whoever may edit it; any
component of the suite, read from suite_component, so one added later is offered too. The list groups and filters by it.
Rolled back."""
import pytest
from django.db import connections

from apps.insights import api as insights_api
from apps.insights import assistant
from apps.platform_ops import crypto
from tests.test_insights_assistant import DRAFT, _tables

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

DEFINITION = {"columns": [{"field": "campaign_name"}, {"field": "sent", "aggregate": "sum"}], "limit": 500}


def _present() -> bool:
    with connections["platform"].cursor() as cursor:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'report' AND column_name = 'component_key')")
        return cursor.fetchone()[0]


def _listed(world, query: str = "") -> dict[str, str]:
    return {r["name"]: r["component"]["key"] for r in world.api("get", f"/api/v1/insights/reports/{query}").json()["reports"]}


def test_choosing_and_changing_a_reports_component(check, world):
    if not _present():
        pytest.skip("patch 0075 has not been applied to this database")
    insights_api.cache.delete("cep:insights:report-component-present")
    catalog = world.api("get", "/api/v1/insights/catalog/").json()
    with connections["platform"].cursor() as cursor:
        cursor.execute("SELECT key FROM suite_component ORDER BY sort_order, name")
        suite = [row[0] for row in cursor.fetchall()]
    check("the catalogue offers every component of the suite, in its order, read from suite_component",
          [c["key"] for c in catalog["components"]] == suite and catalog["can_choose_component"] is True and "sales" in suite, catalog.get("components"))

    plain = world.api("post", "/api/v1/insights/reports/", {"name": "Component Test Automatic", "dataset": "messages", "definition": DEFINITION}).json()
    check("a report made without a choice is Automatic: no component of its own, its dataset's in the list",
          plain["component_key"] is None and plain["component_auto"] == "cep" and _listed(world)["Component Test Automatic"] == "cep", plain)
    filed = world.api("post", "/api/v1/insights/reports/", {"name": "Component Test Sales", "dataset": "messages", "definition": DEFINITION, "component": "sales"})
    report = filed.json()
    check("a report made with a component is listed under it", filed.status_code == 201 and report["component_key"] == "sales"
          and _listed(world)["Component Test Sales"] == "sales", str(filed.content[:300]))
    check("the list filters by the report's own component", "Component Test Sales" in _listed(world, "?component=sales")
          and "Component Test Sales" not in _listed(world, "?component=cep") and "Component Test Automatic" in _listed(world, "?component=cep"))

    moved = world.api("put", f"/api/v1/insights/reports/{report['id']}/", {"row_version": report["row_version"], "component": "inv"}).json()
    check("whoever may edit it changes it, without a new version", moved["component_key"] == "inv" and moved["version"] == report["version"]
          and _listed(world)["Component Test Sales"] == "inv", moved)
    back = world.api("put", f"/api/v1/insights/reports/{report['id']}/", {"row_version": moved["row_version"], "component": None}).json()
    check("and back to Automatic", back["component_key"] is None and _listed(world)["Component Test Sales"] == "cep", back)
    renamed = world.api("put", f"/api/v1/insights/reports/{report['id']}/", {"row_version": back["row_version"], "name": "Component Test Renamed"})
    check("a change that does not name the component keeps it", renamed.status_code == 200 and renamed.json()["component_key"] is None)
    wrong = world.api("post", "/api/v1/insights/reports/", {"name": "Component Test Wrong", "dataset": "messages", "definition": DEFINITION, "component": "nowhere"})
    check("a component the suite does not have is refused", wrong.status_code == 400 and "component" in wrong.json().get("errors", {}), str(wrong.content[:200]))
    check.done()


def test_ask_for_a_report_files_the_draft(check, world, monkeypatch):
    if not _tables() or not _present():
        pytest.skip("patches 0055 and 0075 are needed on this database")
    insights_api.cache.delete("cep:insights:report-component-present")
    with connections["platform"].cursor() as cursor:
        cursor.execute("INSERT INTO ai_provider (tenant_id, provider, api_key_enc, model_reports, model_fast, is_active) VALUES (NULL, 'anthropic', %s, 'claude-sonnet-5-5', 'claude-haiku-5-5', TRUE)", [crypto.encrypt("sk-test")])
    assistant._TABLE_SEEN = False
    monkeypatch.setattr(assistant, "call_model", lambda *args, **kwargs: (DRAFT, {"in": 10, "out": 5}))
    monkeypatch.setattr(assistant.billing, "plan_for", lambda tenant_id: {"name": "Growth", "max_ai_prompts": 50})
    asked = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign", "model": "anthropic:claude-sonnet-5-5", "component": "crm"}).json()
    check("the draft carries the component chosen with the prompt", asked.get("kind") == "draft" and asked.get("component") == "crm", asked)
    opened = world.api("post", f"/api/v1/insights/assistant/{asked['id']}/open/", {})
    check("Open in Editor files the report under it", opened.status_code == 201 and opened.json()["component_key"] == "crm", str(opened.content[:300]))
    wrong = world.api("post", "/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign", "model": "anthropic:claude-sonnet-5-5", "component": "nowhere"})
    check("an unknown component is refused before the model is asked", wrong.status_code == 400, str(wrong.content[:200]))
    check.done()
