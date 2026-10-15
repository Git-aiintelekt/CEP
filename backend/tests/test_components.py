"""The suite's components: the plan's set, the workspace's own trials and add-ons, and what GET /me/ hands the shell."""
from datetime import date

import pytest
from apps.platform_ops import components

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_resolution(check):
    today = date(2026, 10, 15)
    growth = components.resolve("GROWTH", {}, {}, today)
    check("a Growth workspace gets the released components its plan includes, in suite order", [c["key"] for c in growth] == ["cep"] and growth[0]["access"] == "PLAN", str(growth))
    check("a component that is not released is never offered, even when the plan names it", "insights" not in [c["key"] for c in components.resolve("ENTERPRISE", {}, {}, today)])
    check("an unknown plan falls back to Engagement alone", [c["key"] for c in components.resolve(None, None, None, today)] == ["cep"])
    own = components.resolve("STARTER", {"components": []}, {"components": {"cep": {"on": True, "access": "TRIAL", "until": "2026-10-31"}}}, today)
    check("a trial adds a component the plan leaves out, until its date", [(c["key"], c["access"], c["until"]) for c in own] == [("cep", "TRIAL", "2026-10-31")], str(own))
    lapsed = components.resolve("STARTER", {"components": []}, {"components": {"cep": {"on": True, "access": "TRIAL", "until": "2026-10-01"}}}, today)
    check("a lapsed trial no longer counts", lapsed == [])
    off = components.resolve("GROWTH", {}, {"components": {"cep": {"on": False}}}, today)
    check("the workspace's own entry can switch a plan component off", off == [])
    check("the plan's own list wins over the defaults", components.resolve("GROWTH", {"components": []}, {}, today) == [])
    check("More Apps lists what exists but is not released", {c["key"] for c in components.coming()} >= {"insights", "crm", "pim"})
    check.done()


def test_me_hands_the_shell_its_components(check, world):
    me = world.api("get", "/api/v1/me/")
    body = me.json() if me.status_code == 200 else {}
    check("GET /me/ names the workspace and its plan", me.status_code == 200 and body.get("workspace", {}).get("name") and body["workspace"]["plan"]["code"], str(body.get("workspace")))
    check("GET /me/ lists the components the shell may show, Engagement first", [c["key"] for c in body.get("components", [])][:1] == ["cep"]
          and body["components"][0]["name"] == "Engagement", str(body.get("components")))
    check.done()
