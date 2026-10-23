"""A Report Database whose name holds hyphens (txpostalprod-server-7): the connection is saved, its tables are sampled and a
report on it runs, the name quoted wherever it reaches SQL; a table or column name still may not hold one. No database server
is contacted. Rolled back."""
import pytest

from apps.insights import compiler, external
from tests.test_report_db_picker import BODY, GOOD, _column

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

NAME = "txpostalprod-server-7"
COLUMNS = [{"column": "store_id", "column_type": "int", "key": True, "mappable": True, "type": "number", "role": "dimension", "aggregates": [], "format": "integer"},
           {"column": "net_amount", "column_type": "decimal(12,2)", "key": False, "mappable": True, "type": "number", "role": "measure", "aggregates": ["sum"], "format": "money"}]


def test_quoting(check):
    check("schema.table with hyphens in the schema is quoted for MySQL and PostgreSQL",
          compiler._source(f"{NAME}.sales_lines", "mysql") == f"`{NAME}`.`sales_lines`" and compiler._source(f"{NAME}.sales_lines") == f'"{NAME}"."sales_lines"')
    for bad in ("shop.sales-lines", "shop`x.sales_lines", 'shop".sales_lines', "sales lines"):
        try:
            compiler._source(bad, "mysql")
            check(f"{bad!r} is refused", False)
        except AssertionError:
            check(f"{bad!r} is refused", True)
    check("the database name pattern takes hyphens but no quote, space or dot",
          bool(external.DB_NAME.match(NAME)) and not any(external.DB_NAME.match(n) for n in ("a`b", 'a"b', "a b", "a.b", "-x" * 40)))
    check.done()


def test_a_database_named_with_hyphens(check, world, monkeypatch):
    if not _column("report_connection", "id"):
        pytest.skip("patch 0056 has not been applied to this database")
    sent = []
    monkeypatch.setattr(external, "test", lambda row: dict(GOOD))
    monkeypatch.setattr(external, "columns", lambda row, source: COLUMNS)
    monkeypatch.setattr(external, "query", lambda row, sql, params, timeout_ms, zone=None: sent.append(sql) or [[1, 10.5]])

    made = world.api("post", "/api/v1/workspace/report-databases/", {**BODY, "name": "Postal Prod", "database": NAME})
    database = made.json()
    check("the connection is saved with the hyphenated name", made.status_code == 201 and database["database_name"] == NAME and database["usable"], str(made.content[:300]))
    wrong = world.api("post", "/api/v1/workspace/report-databases/", {**BODY, "name": "Bad", "database": "shop`; drop"})
    check("a name with a quote or a space is still refused", wrong.status_code == 400 and "database" in wrong.json().get("errors", {}), str(wrong.content[:200]))

    sample = world.api("get", f"/api/v1/workspace/report-databases/{database['id']}/sources/sales_lines/")
    check("a table's sample rows are read from the quoted database", sample.status_code == 200 and f"`{NAME}`.`sales_lines`" in sent[-1], sent[-1:] or str(sample.content[:200]))
    mapped = world.api("post", f"/api/v1/workspace/report-databases/{database['id']}/datasets/", {"source": "sales_lines"}).json()
    run = world.api("post", "/api/v1/insights/reports/preview/", {"dataset": mapped["key"], "definition": {"columns": [{"field": "store_id"}, {"field": "net_amount", "aggregate": "sum"}]}})
    check("a report on it runs, the database quoted in its FROM", run.status_code == 200 and f"FROM `{NAME}`.`sales_lines`" in sent[-1], sent[-1:] or str(run.content[:300]))
    check.done()
