"""Whether a Report Database's account must be read-only: the global parameter insights.report_db_read_only_required (patch
0076). Yes (the default, as before): an account that can write is refused. No: it is used, with read_only false kept for the
card's warning. No database server is contacted. Rolled back."""
import pytest
from django.db import connections

from apps.insights import databases, external
from tests.test_report_db_picker import BODY, GOOD, _column

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

WRITER = {**GOOD, "read_only": False, "offending": ["INSERT, UPDATE on `shop`.*"]}


def test_the_parameter(check):
    with connections["platform"].cursor() as cursor:
        cursor.execute("SELECT value, value_type, category FROM platform_setting WHERE key = 'insights.report_db_read_only_required'")
        row = cursor.fetchone()
    if row is None:
        pytest.skip("patch 0076 has not been applied to this database")
    check("the parameter is a Yes/No under Insights", row[1] == "BOOLEAN" and row[2] == "Insights", row)
    check.done()


def test_an_account_that_can_write(check, world, monkeypatch):
    if not _column("report_connection", "id"):
        pytest.skip("patch 0056 has not been applied to this database")
    monkeypatch.setattr(external, "test", lambda row: dict(WRITER))
    monkeypatch.setattr(external, "sources", lambda row: [{"name": "sales_lines", "kind": "table", "rows": None, "columns": None, "mappable": True}])

    monkeypatch.setattr(databases, "read_only_required", lambda: True)
    refused = world.api("post", "/api/v1/workspace/report-databases/", {**BODY, "name": "Writer Required"}).json()
    check("required: the account that can write is saved but refused, as before", refused["usable"] is False and refused["last_test_ok"] is False
          and "can write" in (refused["last_test_error"] or "") and refused["test"]["read_only_required"] is True, refused)
    blocked = world.api("get", f"/api/v1/workspace/report-databases/{refused['id']}/sources/")
    check("and its tables cannot be read", blocked.status_code == 409 and "can write" in str(blocked.content), str(blocked.content[:200]))
    targets = [d["id"] for d in world.api("get", "/api/v1/workspace/report-databases/targets/").json()["databases"]]
    check("nor queried", refused["id"] not in targets, targets)

    monkeypatch.setattr(databases, "read_only_required", lambda: False)
    allowed = world.api("post", "/api/v1/workspace/report-databases/", {**BODY, "name": "Writer Allowed"}).json()
    check("not required: the same account is used, read_only false kept for the warning", allowed["usable"] is True and allowed["last_test_ok"] is True
          and allowed["read_only"] is False and not allowed["last_test_error"] and allowed["test"]["read_only_required"] is False, allowed)
    listed = world.api("get", "/api/v1/workspace/report-databases/").json()
    check("the list says read-only is not required", listed["read_only_required"] is False)
    sources = world.api("get", f"/api/v1/workspace/report-databases/{allowed['id']}/sources/")
    check("its tables can be read", sources.status_code == 200 and sources.json()["sources"][0]["name"] == "sales_lines", str(sources.content[:200]))
    targets = [d["id"] for d in world.api("get", "/api/v1/workspace/report-databases/targets/").json()["databases"]]
    check("and it can be queried; the earlier one too, now that it is not required", allowed["id"] in targets and refused["id"] in targets, targets)
    retested = world.api("post", f"/api/v1/workspace/report-databases/{refused['id']}/test/", {}).json()
    check("testing the refused one again clears its refusal", retested["database"]["usable"] is True and retested["database"]["last_test_ok"] is True, retested)
    check.done()
