"""How reports treat a Report Database (docs/mockups/report-database-limits.html, option B): the presets and Custom, saving them,
the runner using the database's own time limit and its own slot, and the messages naming the database. Rolled back."""
import pytest
from django.conf import settings
from django.db import connections

from apps.insights import connection_limits, external, runner
from apps.insights.runner import RunRefused

WORKSPACE = {"statement_timeout_ms": 15_000, "concurrent": 4, "preview_rows": 200, "run_rows": 5_000, "export_rows": 100_000}


def test_the_presets_and_custom(check):
    eff = connection_limits.effective
    check("Standard follows the workspace's limits", eff({"limit_profile": "STANDARD"}, WORKSPACE) == {"profile": "STANDARD", "timeout_s": 15, "concurrent": 4})
    check("and a workspace whose limit the back-office raised", eff({}, {**WORKSPACE, "statement_timeout_ms": 45_000})["timeout_s"] == 45)
    check("a connection read before patch 0074 (no profile) is Standard", eff({"limit_profile": None}, WORKSPACE)["profile"] == "STANDARD")
    check("Large or Slow: 60 seconds, 2 at once", eff({"limit_profile": "LARGE"}, WORKSPACE) == {"profile": "LARGE", "timeout_s": 60, "concurrent": 2})
    check("Live Production Database: 60 seconds, 1 at once", eff({"limit_profile": "LIVE"}, WORKSPACE) == {"profile": "LIVE", "timeout_s": 60, "concurrent": 1})
    check("Custom: its own values", eff({"limit_profile": "CUSTOM", "query_timeout_s": 90, "max_concurrent": 2}, WORKSPACE) == {"profile": "CUSTOM", "timeout_s": 90, "concurrent": 2})

    values, errors = connection_limits.parse({"limit_profile": "LIVE", "query_timeout_s": 99}, None)
    check("a preset stores no numbers of its own", values == {"limit_profile": "LIVE", "query_timeout_s": None, "max_concurrent": None} and not errors)
    values, errors = connection_limits.parse({"limit_profile": "CUSTOM", "query_timeout_s": 300, "max_concurrent": 0}, None)
    check("Custom is checked: 5 to 110 seconds, 1 to 4 at once", set(errors) == {"query_timeout_s", "max_concurrent"}, errors)
    values, errors = connection_limits.parse({}, {"limit_profile": "CUSTOM", "query_timeout_s": 75, "max_concurrent": 3})
    check("an edit that leaves them out keeps what was saved", values == {"limit_profile": "CUSTOM", "query_timeout_s": 75, "max_concurrent": 3} and not errors)
    _, errors = connection_limits.parse({"limit_profile": "FAST"}, None)
    check("an unknown preset is refused", "limit_profile" in errors)

    check("reading the catalogue takes at least 60 seconds", external.catalog_ms({"limit_profile": "STANDARD"}) == 60_000)
    check("or the database's own limit when that is longer", external.catalog_ms({"limit_profile": "CUSTOM", "query_timeout_s": 100}) == 100_000)
    check.done()


def _column(table: str, column: str) -> bool:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s)", [table, column])
        return cursor.fetchone()[0]


DATASET = {"key": "cg_sales", "external": True, "database": {"id": "c1", "name": "CG-Prod"}, "connection": {"id": "c1", "limit_profile": "LIVE"}}


def test_the_runner_uses_the_database_limits_and_its_own_slot(check, monkeypatch):
    limits = runner._for_dataset(WORKSPACE, DATASET)
    check("a report on the database runs with its time limit and its cap", limits["statement_timeout_ms"] == 60_000 and limits["connection_concurrent"] == 1)
    check("a platform dataset keeps the workspace's", runner._for_dataset(WORKSPACE, {"key": "messages"}) is WORKSPACE)
    check("the message names the database, its limit and where to raise it",
          runner._too_long(limits, DATASET) == "Stopped after 60 seconds, the limit for CG-Prod. Narrow the report with a filter or a shorter period, "
                                               "or ask your administrator to raise the limit under Settings → Report Databases.")

    monkeypatch.setattr(runner, "CONNECTION_WAIT_S", 0)
    first = runner._slot("t-limits", limits, DATASET)
    check("the first report takes the workspace's slot and the database's", len(first) == 2)
    with pytest.raises(RunRefused) as busy:
        runner._slot("t-limits", limits, DATASET)
    check("a second report on a one-at-a-time database is told so after its wait", "CG-Prod reads 1 report at a time and is busy" in str(busy.value), str(busy.value))
    runner._release(first)
    again = runner._slot("t-limits", limits, DATASET)
    check("once the first finishes, the next one runs", len(again) == 2)
    runner._release(again)
    other = runner._slot("t-limits", WORKSPACE, {"key": "messages"})
    check("a platform dataset takes the workspace's slot alone", other == ["cep:insights:running:t-limits"])
    runner._release(other)
    check.done()


@pytest.mark.django_db(databases=["default", "platform"])
def test_saving_the_limits(check, world, monkeypatch):
    if not _column("report_connection", "id"):
        pytest.skip("patch 0056 has not been applied to this database")
    monkeypatch.setattr(external, "test", lambda row: {"ok": True, "version": "5.7.44", "timezone": "UTC", "tables": 3, "views": 1, "read_only": True, "offending": [], "ms": 40, "error": None})
    base = {"name": "CG-Prod", "engine": "mysql57", "host": "db.cg-retail.internal", "port": 3306, "database": "shop", "username": "c360_reports", "password": "s3cret", "ssl": "REQUIRED"}
    listed = world.api("get", "/api/v1/workspace/report-databases/").json()
    check("the list says what Standard means here and whether limits can be stored", listed["workspace_limits"]["timeout_s"] >= 1 and "limits_ready" in listed, str(listed)[:200])
    if not _column("report_connection", "limit_profile"):
        made = world.api("post", "/api/v1/workspace/report-databases/", {**base, "limit_profile": "STANDARD"})
        check("before patch 0074 a connection still saves, on Standard", made.status_code == 201 and made.json()["limit_profile"] == "STANDARD", str(made.content[:200]))
        refused = world.api("post", "/api/v1/workspace/report-databases/", {**base, "name": "CG-Prod 2", "limit_profile": "LIVE"})
        check("and a preset says the patch is needed", refused.status_code == 400 and "0074" in str(refused.content), str(refused.content[:200]))
        check.done()
        return
    made = world.api("post", "/api/v1/workspace/report-databases/", {**base, "limit_profile": "LIVE"})
    body = made.json()
    check("saved on Live Production Database, with what it means", made.status_code == 201 and body["limit_profile"] == "LIVE" and body["limits"] == {"timeout_s": 60, "concurrent": 1}, str(body)[:300])
    edited = world.api("put", f"/api/v1/workspace/report-databases/{body['id']}/", {"limit_profile": "CUSTOM", "query_timeout_s": 90, "max_concurrent": 2, "row_version": body["row_version"]})
    check("changed to Custom: 90 seconds, 2 at once", edited.status_code == 200 and edited.json()["limits"] == {"timeout_s": 90, "concurrent": 2}, str(edited.content[:300]))
    wrong = world.api("put", f"/api/v1/workspace/report-databases/{body['id']}/", {"limit_profile": "CUSTOM", "query_timeout_s": 500, "row_version": edited.json()["row_version"]})
    check("a time limit past 110 seconds is refused on the field", wrong.status_code == 400 and "query_timeout_s" in wrong.json()["errors"], str(wrong.content[:300]))
    check.done()
