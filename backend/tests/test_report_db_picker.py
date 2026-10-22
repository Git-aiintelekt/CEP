"""Finding a table among 1,000+ (docs/mockups/report-database-catalogue.html, option A): the names read live and held in memory for
the search, Reload the List, a table's row estimate read when it is chosen, the pins (the only thing kept), and Find Databases.
No database server is contacted. Rolled back."""
import pytest
from django.conf import settings
from django.db import connections

from apps.insights import external

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _column(table: str, column: str) -> bool:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s)", [table, column])
        return cursor.fetchone()[0]


GOOD = {"ok": True, "version": "5.7.44", "timezone": "UTC", "tables": 1284, "views": 96, "read_only": True, "offending": [], "ms": 40, "error": None}
BODY = {"name": "CG-Prod", "engine": "mysql57", "host": "db.cg-retail.internal", "port": 3306, "database": "shop", "username": "c360_reports", "password": "s3cret", "ssl": "REQUIRED"}


def test_the_table_list_the_chosen_table_and_the_pins(check, world, monkeypatch):
    if not _column("report_connection", "id"):
        pytest.skip("patch 0056 has not been applied to this database")
    reads = []
    names = [{"name": f"sales_{n:04d}", "kind": "table", "rows": None, "columns": None, "mappable": True} for n in range(1284)]
    monkeypatch.setattr(external, "test", lambda row: dict(GOOD))
    monkeypatch.setattr(external, "sources", lambda row: reads.append("names") or names)
    monkeypatch.setattr(external, "columns", lambda row, source: [{"column": "line_id", "column_type": "bigint", "key": True, "mappable": True, "type": "number", "role": "dimension", "aggregates": [], "format": "integer"}])
    monkeypatch.setattr(external, "sample", lambda row, source, names, limit=5, zone=None, joins=None: [[1]])
    monkeypatch.setattr(external, "table_rows", lambda row, source: reads.append(f"rows:{source}") or 412_000_000)
    made = world.api("post", "/api/v1/workspace/report-databases/", BODY).json()
    cid = made["id"]

    first = world.api("get", f"/api/v1/workspace/report-databases/{cid}/sources/").json()
    check("all 1,284 names come back, with when they were read and from which database", len(first["sources"]) == 1284 and first["read_at"] and first["database"] == "shop", str(first)[:200])
    world.api("get", f"/api/v1/workspace/report-databases/{cid}/sources/")
    check("searching again within 10 minutes does not ask the database", reads == ["names"], reads)
    world.api("get", f"/api/v1/workspace/report-databases/{cid}/sources/?reload=1")
    check("Reload the List does", reads == ["names", "names"], reads)
    one = world.api("get", f"/api/v1/workspace/report-databases/{cid}/sources/sales_0007/").json()
    check("choosing a table reads its columns and row estimate, that table only", one["rows"] == 412_000_000 and reads[-1] == "rows:sales_0007" and one["columns"][0]["column"] == "line_id", str(one)[:200])

    pinned = world.api("put", f"/api/v1/workspace/report-databases/{cid}/pins/", {"pinned": ["sales_0007", "sales_0001", "sales_0007"]})
    if not _column("report_connection", "pinned_tables"):
        check("before patch 0074, pins say the patch is needed", pinned.status_code == 400 and "0074" in str(pinned.content), str(pinned.content[:200]))
    else:
        check("pins are kept once each, in the order given", pinned.status_code == 200 and pinned.json()["pinned"] == ["sales_0007", "sales_0001"], str(pinned.content[:200]))
        again = world.api("get", f"/api/v1/workspace/report-databases/{cid}/sources/").json()
        check("and come back with the list", again["pinned"] == ["sales_0007", "sales_0001"], again["pinned"])
    wrong = world.api("put", f"/api/v1/workspace/report-databases/{cid}/pins/", {"pinned": ["bad name; drop"]})
    check("a pin must be a plain table name", wrong.status_code == 400, str(wrong.content[:200]))
    check.done()


def test_find_databases(check, world, monkeypatch):
    seen = []
    monkeypatch.setattr(external, "databases_of", lambda row: seen.append(row["database_name"]) or {"kind": "database", "found": [{"name": "shop_reporting", "tables": 142}, {"name": "shop", "tables": 1284}]})
    answer = world.api("post", "/api/v1/workspace/report-databases/find-databases/", {k: v for k, v in BODY.items() if k != "database"})
    check("the databases the account can see, with their table counts", answer.status_code == 200 and answer.json()["found"][0] == {"name": "shop_reporting", "tables": 142}, str(answer.content[:200]))
    check("found without a database name: MySQL connects to information_schema, which every account can read", seen == ["information_schema"], seen)
    pg = world.api("post", "/api/v1/workspace/report-databases/find-databases/", {**{k: v for k, v in BODY.items() if k != "database"}, "engine": "postgresql", "port": 5432})
    check("PostgreSQL lists the schemas of a database, so it needs the database's name", pg.status_code == 400 and "database" in pg.json()["errors"], str(pg.content[:200]))
    check.done()
