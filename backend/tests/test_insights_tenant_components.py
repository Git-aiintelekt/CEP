"""Insights shows what the workspace's components fit: the platform's datasets of a component it does not have are not in the
catalogue, a report on one is not listed, its own data is filed under Engagement when it has it and Insights otherwise, and the
base packs offered are those its components fit, the ones chosen at onboarding marked. Rolled back."""
import pytest
from django.conf import settings
from django.db import connections

from apps.insights import catalog, uploads
from apps.insights.base_packs import PACKS, fitting, needs
from apps.platform_ops import params

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS
DEFINITION = {"columns": [{"field": "channel"}, {"field": "sent", "aggregate": "sum"}]}


def _tenant_of(world) -> str:
    return world.api("get", "/api/v1/me/").json()["tenant"]["id"]


def _engagement(tenant_id, on: bool) -> None:
    with connections[P].cursor() as cursor:
        cursor.execute("DELETE FROM tenant_component WHERE tenant_id = %s AND component_key = 'cep'", [tenant_id])
        if not on:
            cursor.execute("INSERT INTO tenant_component (tenant_id, component_key, access) VALUES (%s, 'cep', 'OFF')", [tenant_id])
    params.invalidate(tenant_id)
    catalog.invalidate()


def test_packs_name_what_they_need(check):
    check("every pack names the components it needs; the Email Campaign pack reads a Postal database, so Insights alone",
          all(needs(p) for p in PACKS.values()) and needs(PACKS["email-campaigns"]) == ["insights"])
    check("a workspace is offered the packs its components fit", [p["key"] for p in fitting(["insights"])] == ["email-campaigns"] and fitting(["cep"]) == [])
    check("an upload is filed under the component it is given", uploads.dataset_of({"key": "upl_x", "name": "X", "description": None, "file_name": "x.csv", "columns": [], "id": "1",
                                                                                   "row_count": 0, "replaced_at": None, "created_at": __import__("datetime").datetime(2026, 1, 1), "row_version": 1},
                                                                                  "insights")["component"] == {"key": "insights", "name": "Insights"})
    check.done()


def test_insights_follows_the_workspaces_components(check, world):
    tenant_id = _tenant_of(world)
    made = world.api("post", "/api/v1/insights/reports/", {"name": "Component Scope Sends", "dataset": "messages", "definition": DEFINITION})
    check("a report on Engagement's Messages is made while the workspace has Engagement", made.status_code == 201, made.content[:200])
    listed = lambda: [r["name"] for r in world.api("get", "/api/v1/insights/reports/").json()["reports"]]      # noqa: E731
    datasets = lambda: {d["key"]: d["component"]["key"] for d in world.api("get", "/api/v1/insights/catalog/").json()["datasets"]}     # noqa: E731
    before = datasets()
    check("with Engagement, the catalogue has its datasets and the report is listed", before.get("messages") == "cep" and "Component Scope Sends" in listed(), before)
    check("its own data is filed under Engagement", catalog.home_component(tenant_id) == "cep")
    try:
        _engagement(tenant_id, on=False)
        after = datasets()
        check("without Engagement, none of its datasets is in the catalogue", not any(component == "cep" and key in before for key, component in after.items() if key in ("messages", "contacts")),
              after)
        check("... the report on Messages is no longer listed", "Component Scope Sends" not in listed())
        check("... its own data is filed under Insights", catalog.home_component(tenant_id) == "insights")
        packs = world.api("get", "/api/v1/insights/base-reports/").json()["packs"]
        check("the Email Campaign pack is still offered: it needs Insights only", [p["key"] for p in packs] == ["email-campaigns"]
              and packs[0]["components"] == [{"key": "insights", "name": "Insights"}] and packs[0]["chosen"] is False, packs)
        with connections["default"].cursor() as cursor:                # the API reads the tenant row on this connection
            cursor.execute("UPDATE tenant SET settings = COALESCE(settings, '{}'::jsonb) || '{\"base_packs\": [\"email-campaigns\"]}'::jsonb WHERE id = %s", [tenant_id])
        packs = world.api("get", "/api/v1/insights/base-reports/").json()["packs"]
        check("a pack chosen at onboarding is marked", packs[0]["chosen"] is True, packs)
    finally:
        _engagement(tenant_id, on=True)
    check("with Engagement back, the report is listed again", "Component Scope Sends" in listed())
    check.done()
