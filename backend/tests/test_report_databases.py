"""Report Databases (apps/insights/databases, external, the compiler's MySQL dialect): the SQL the engine writes for a workspace's own
MySQL database (pure), the grants check and the column typing (pure), and the API with the database faked: a connection tested
and recorded, an account that can write refused, a dataset mapped, the catalogue offering it, a report built and run on it."""
import json

import pytest
from django.conf import settings
from django.db import connections

from apps.insights import compiler, databases, definition, external
from tests.test_insights import DATASET

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

P = settings.PLATFORM_ALIAS
OWN = {**DATASET, "key": "x_store_sales", "label": "Store Sales", "source": "nwa_ops.v_daily_sales", "workspace_field": None, "engine": "mysql",
       "fields": [
           {"key": "sale_day", "label": "Sale Day", "column": "sale_day", "type": "date", "role": "dimension", "aggregates": [], "operators": ["=", "!=", "between", "last_days"], "buckets": ["day", "week", "month", "quarter", "year"], "format": "date", "sensitivity": "NORMAL"},
           {"key": "store_name", "label": "Store Name", "column": "store_name", "type": "string", "role": "dimension", "aggregates": [], "operators": ["=", "!=", "contains", "in", "is_null"], "buckets": [], "format": None, "sensitivity": "NORMAL"},
           {"key": "category", "label": "Category", "column": "category", "type": "string", "role": "dimension", "aggregates": [], "operators": ["=", "in"], "buckets": [], "format": None, "sensitivity": "NORMAL"},
           {"key": "net_sales", "label": "Net Sales", "column": "net_sales", "type": "number", "role": "measure", "aggregates": ["sum", "avg"], "operators": [">"], "buckets": [], "format": "money", "sensitivity": "NORMAL"},
       ]}


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, sql, args=None):
        pass

    def fetchall(self):
        return self.rows


def test_mysql_dialect(check):
    d = definition.validate(OWN, {"columns": [{"field": "store_name"}, {"field": "sale_day", "bucket": "month"}, {"field": "net_sales", "aggregate": "sum"}],
                                  "filters": {"combinator": "and", "rules": [{"field": "sale_day", "operator": "between", "value": ["2026-08-01", "2026-09-30"]},
                                                                             {"field": "category", "operator": "in", "value": ["Outerwear", "Denim"]},
                                                                             {"field": "store_name", "operator": "contains", "value": "town"},
                                                                             {"field": "sale_day", "operator": "last_days", "value": 90}]},
                                  "orderBy": [{"field": "net_sales", "direction": "desc"}], "limit": 500})
    out = compiler.compile(OWN, d, "a0000000-0000-4000-8000-000000000001", "America/New_York", limit=51, offset=0, dialect="mysql")
    check("MySQL: backticked identifiers, no workspace restriction, a month bucket in DATE arithmetic, a day range, IN with one placeholder a value, LIKE, an interval, IS NULL ordering, positional params",
          out.sql == "SELECT `store_name` AS `c0`, DATE_SUB(DATE(`sale_day`), INTERVAL (DAYOFMONTH(`sale_day`) - 1) DAY) AS `c1`, sum(`net_sales`) AS `c2` FROM `nwa_ops`.`v_daily_sales` "
                     "WHERE (`sale_day` >= %s AND `sale_day` < DATE_ADD(%s, INTERVAL 1 DAY) AND `category` IN (%s, %s) AND `store_name` LIKE %s AND `sale_day` >= NOW() - INTERVAL %s DAY) "
                     "GROUP BY 1, 2 ORDER BY `c2` IS NULL, `c2` DESC LIMIT %s OFFSET %s"
          and out.params == ["2026-08-01", "2026-09-30", "Outerwear", "Denim", "%town%", 90, 51, 0], out.sql + " " + json.dumps(out.params))
    t = compiler.compile_totals(OWN, d, "a0000000-0000-4000-8000-000000000001", "America/New_York", [(), ("store_name",)], limit=100, dialect="mysql")
    check("MySQL totals: one query per grouping set joined with UNION ALL, the bits as a constant, every placeholder bound per piece",
          t.sql.startswith("(SELECT NULL AS `d0`, sum(`m0`) AS `v0`, 1 AS `g` FROM (SELECT") and " UNION ALL (SELECT `d0`, sum(`m0`) AS `v0`, 0 AS `g` FROM (SELECT" in t.sql
          and t.sql.endswith("GROUP BY `d0`) LIMIT %s") and len(t.params) == 2 * 6 + 1 and [c["key"] for c in t.columns] == ["store_name", "net_sales"], t.sql)
    pg = compiler.compile(OWN, d, "a0000000-0000-4000-8000-000000000001", "America/New_York", limit=51, dialect="postgresql")
    check("without a workspace field the PostgreSQL query carries only the filters", pg.sql.count("WHERE (") == 1 and "tenant_id" not in pg.sql)

    read_only, offending = external._grants(_Cursor([("GRANT USAGE ON *.* TO `cep_reader`@`%`",), ("GRANT SELECT, SHOW VIEW ON `nwa_ops`.* TO `cep_reader`@`%`",)]))
    check("an account with SELECT, SHOW VIEW and USAGE is read-only", read_only and offending == [])
    read_only, offending = external._grants(_Cursor([("GRANT USAGE ON *.* TO 'loyalty_app'@'%'",), ("GRANT SELECT, INSERT, UPDATE ON `loyalty`.* TO 'loyalty_app'@'%'",),
                                                     ("GRANT CREATE ON `loyalty`.`staging` TO 'loyalty_app'@'%' WITH GRANT OPTION",)]))
    check("an account that can write is named with what it holds", not read_only and offending == ["INSERT, UPDATE on `loyalty`.*", "CREATE on `loyalty`.`staging`", "GRANT OPTION on `loyalty`.`staging`"], str(offending))
    read_only, offending = external._grants(_Cursor([("GRANT ALL PRIVILEGES ON *.* TO 'root'@'%'",), ("GRANT `app_admin`@`%` TO `svc`@`%`",)]))
    check("ALL PRIVILEGES and a role are refused", not read_only and offending[0].startswith("ALL PRIVILEGES") and offending[1].startswith("a role"))

    class _PgCursor:
        def __init__(self, answers):
            self.answers, self.at = answers, 0

        def execute(self, sql, args=None):
            self.current = self.answers[self.at]; self.at += 1

        def fetchone(self):
            return self.current[0] if self.current else None

        def fetchall(self):
            return self.current

    read_only, offending = external._grants_pg(_PgCursor([[(False, False, False, False)], [], [(False,)]]), "public")
    check("a PostgreSQL role with SELECT alone is read-only", read_only and offending == [])
    read_only, offending = external._grants_pg(_PgCursor([[(False, True, False, False)], [("orders", "INSERT, UPDATE")], [(True,)]]), "public")
    check("a PostgreSQL role that can create roles, write a table or create in the schema is refused", not read_only and offending == ["can create roles", "INSERT, UPDATE on public.orders", "CREATE on schema public"], str(offending))
    check("PostgreSQL column types are read too", external._typed("numeric", "numeric", "total_paid")["format"] == "money" and external._typed("timestamp with time zone", "timestamp with time zone", "ordered_at")["type"] == "datetime"
          and external._typed("boolean", "boolean", "is_gift")["type"] == "boolean" and external._typed("double precision", "double precision", "weight") == {"type": "number", "role": "measure", "aggregates": ["sum", "avg", "min", "max"], "format": "decimal"})
    pg_own = {**OWN, "engine": "postgresql", "external": True, "source": "public.v_daily_sales"}
    pg_sql = compiler.compile(pg_own, d, "a0000000-0000-4000-8000-000000000001", "America/New_York", limit=51, dialect="postgresql")
    check("a PostgreSQL database of the workspace's gets the PostgreSQL dialect without a workspace restriction", pg_sql.sql.startswith('SELECT "store_name" AS "c0", date_trunc(%s, "sale_day")::date AS "c1", sum("net_sales") AS "c2" FROM "public"."v_daily_sales" WHERE ("sale_day"')
          and "tenant_id" not in pg_sql.sql, pg_sql.sql)
    check("columns are typed for the catalogue", external._typed("decimal", "decimal(12,2)", "net_sales") == {"type": "number", "role": "measure", "aggregates": ["sum", "avg", "min", "max"], "format": "money"}
          and external._typed("int", "int(11)", "store_id")["role"] == "dimension" and external._typed("datetime", "datetime", "sold_at")["type"] == "datetime"
          and external._typed("tinyint", "tinyint(1)", "is_return")["type"] == "boolean" and external._typed("varchar", "varchar(80)", "store_name")["type"] == "string"
          and external._typed("int", "int(11)", "tickets") == {"type": "number", "role": "measure", "aggregates": ["sum", "avg", "min", "max"], "format": "integer"})
    try:
        databases._dataset_body({"label": "Store Sales", "source": "v daily", "fields": [{"column": "net_sales", "label": "Net Sales", "type": "number", "role": "measure", "aggregates": []}]}, None)
        check("a mapping with a bad source name and a measure without a calculation is refused", False)
    except Exception as exc:                                        # noqa: BLE001
        errors = exc.detail if hasattr(exc, "detail") else {}
        check("a mapping with a bad source name and a measure without a calculation is refused", "source" in errors and "fields[0].aggregates" in errors, str(errors))
    body = databases._dataset_body({"label": "Store Sales", "description": "Daily", "source": "v_daily_sales", "time_field": "sale_day",
                                    "fields": [{"column": "sale_day", "label": "Sale Day", "type": "date", "role": "dimension"}, {"column": "net_sales", "label": "Net Sales", "type": "number", "role": "measure", "aggregates": ["sum"], "format": "money", "sensitivity": "normal"},
                                               {"column": "cashier_email", "label": "Cashier Email", "type": "string", "role": "dimension", "sensitivity": "PII"}]}, None)
    check("a good mapping gets field keys from its labels and keeps the sensitivities", [f["key"] for f in body["fields"]] == ["sale_day", "net_sales", "cashier_email"] and body["fields"][2]["sensitivity"] == "PII"
          and body["fields"][1]["aggregates"] == ["sum"] and body["time_field"] == "sale_day")
    check.done()


def _tables() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('report_connection', 'report_dataset_custom', 'report', 'report_run_audit')")
        return cursor.fetchone()[0] == 4


def test_api(check, world, monkeypatch):
    if not _tables():
        pytest.skip("patch 0056 (and 0049) have not been applied to this database")
    from apps.platform_ops import crypto
    calls = []
    outcome = {"ok": True, "version": "8.0.36", "timezone": "UTC", "tables": 14, "views": 6, "read_only": True, "offending": [], "ms": 48, "error": None}

    def fake_test(row):
        calls.append(("test", row["host"], crypto.decrypt(row["password_enc"])))
        return dict(outcome)

    monkeypatch.setattr(external, "test", fake_test)
    monkeypatch.setattr(external, "sources", lambda row: [{"name": "v_daily_sales", "kind": "view", "rows": None, "columns": 4, "mappable": True}, {"name": "sales_lines", "kind": "table", "rows": 4200000, "columns": 18, "mappable": True}])
    monkeypatch.setattr(external, "columns", lambda row, source: [{"column": "sale_day", "column_type": "date", "key": False, "mappable": True, "type": "date", "role": "dimension", "aggregates": [], "format": "date"},
                                                                  {"column": "store_name", "column_type": "varchar(80)", "key": False, "mappable": True, "type": "string", "role": "dimension", "aggregates": [], "format": None},
                                                                  {"column": "net_sales", "column_type": "decimal(12,2)", "key": False, "mappable": True, "type": "number", "role": "measure", "aggregates": ["sum", "avg", "min", "max"], "format": "money"}])
    monkeypatch.setattr(external, "sample", lambda row, source, names, limit=5, zone=None: [["2026-10-15", "Downtown", 9420.0]][:limit])

    def fake_query(row, sql, params, *, timeout_ms, zone=None):
        calls.append(("query", sql, list(params), crypto.decrypt(row["password_enc"]), zone))
        return [["Downtown", 61880.0], ["Riverside", 27320.0]]

    monkeypatch.setattr(external, "query", fake_query)

    empty = world.api("get", "/api/v1/workspace/report-databases/").json()
    check("nothing connected yet, with the grant to give", empty["ready"] and empty["databases"] == [] and "GRANT SELECT" in empty["grant_example"])
    bad = world.api("post", "/api/v1/workspace/report-databases/", {"name": "Store Operations", "host": "ops db", "database": "nwa-ops", "username": "cep_reader"})
    check("a connection needs a host without spaces, a plain database name and a password", bad.status_code == 400 and {"host", "database", "password"} <= set(bad.json()["errors"]), str(bad.content[:300]))
    made = world.api("post", "/api/v1/workspace/report-databases/", {"name": "Store Operations", "engine": "mysql80", "host": "ops-db.northwind.local", "port": 3306, "database": "nwa_ops",
                                                                      "username": "cep_reader", "password": "s3cret", "ssl": "REQUIRED"})
    body = made.json()
    check("a connection is saved with its password encrypted, tested at once and recorded read-only", made.status_code == 201 and body["engine_name"] == "MySQL 8.0" and body["read_only"] is True
          and body["last_test_ok"] is True and body["server_version"] == "8.0.36" and body["usable"] and "password" not in json.dumps(body) and calls[0] == ("test", "ops-db.northwind.local", "s3cret"), json.dumps(body)[:300])
    cid = body["id"]

    outcome.update(read_only=False, offending=["INSERT, UPDATE on `nwa_ops`.*"])
    tested = world.api("post", f"/api/v1/workspace/report-databases/{cid}/test/").json()
    check("an account that can write fails the test and the connection is not usable", tested["test"]["read_only"] is False and tested["database"]["read_only"] is False and not tested["database"]["usable"]
          and "can write" in tested["database"]["last_test_error"], json.dumps(tested)[:300])
    refused = world.api("get", f"/api/v1/workspace/report-databases/{cid}/sources/")
    check("its tables cannot be listed until the account is fixed", refused.status_code == 409)
    outcome.update(read_only=True, offending=[])
    world.api("post", f"/api/v1/workspace/report-databases/{cid}/test/")
    listed = world.api("get", f"/api/v1/workspace/report-databases/{cid}/sources/").json()
    check("the tables and views the account can read, views first", [s["name"] for s in listed["sources"]] == ["v_daily_sales", "sales_lines"] and listed["sources"][1]["rows"] == 4200000)
    cols = world.api("get", f"/api/v1/workspace/report-databases/{cid}/sources/v_daily_sales/").json()
    check("a source's columns come typed, with a few rows", [c["column"] for c in cols["columns"]] == ["sale_day", "store_name", "net_sales"] and cols["columns"][2]["role"] == "measure" and cols["sample"]["rows"] == [["2026-10-15", "Downtown", 9420.0]])

    fields = [{"column": "sale_day", "label": "Sale Day", "type": "date", "role": "dimension"}, {"column": "store_name", "label": "Store Name", "type": "string", "role": "dimension"},
              {"column": "net_sales", "label": "Net Sales", "type": "number", "role": "measure", "aggregates": ["sum", "avg"], "format": "money"}]
    preview = world.api("post", f"/api/v1/workspace/report-databases/{cid}/preview/", {"label": "Store Sales", "source": "v_daily_sales", "fields": fields}).json()
    check("the preview shows the first rows with the labels", [c["label"] for c in preview["columns"]] == ["Sale Day", "Store Name", "Net Sales"] and preview["rows"] == [["2026-10-15", "Downtown", 9420.0]])
    mapped = world.api("post", f"/api/v1/workspace/report-databases/{cid}/datasets/", {"label": "Store Sales", "description": "Daily sales by store", "source": "v_daily_sales", "time_field": "sale_day", "fields": fields})
    dataset = mapped.json()
    check("a dataset is mapped with a key of its own", mapped.status_code == 201 and dataset["key"] == "x_store_sales" and dataset["field_count"] == 3 and dataset["reports"] == 0, str(mapped.content[:300]))

    catalogue = world.api("get", "/api/v1/insights/catalog/").json()
    own = next((d for d in catalogue["datasets"] if d["key"] == "x_store_sales"), None)
    check("the catalogue offers the mapped dataset with its database named and nothing of the connection", own is not None and own["database"]["name"] == "Store Operations" and own["database"]["engine_name"] == "MySQL 8.0"
          and "connection" not in own and [f["key"] for f in own["fields"]] == ["sale_day", "store_name", "net_sales"] and own["fields"][2]["aggregates"] == ["sum", "avg"], json.dumps(own)[:300])

    report = world.api("post", "/api/v1/insights/reports/", {"name": "Net Sales by Store", "dataset": "x_store_sales",
                                                              "definition": {"columns": [{"field": "store_name"}, {"field": "net_sales", "aggregate": "sum"}], "filters": {"combinator": "and", "rules": [{"field": "sale_day", "operator": "last_days", "value": 7}]},
                                                                             "orderBy": [{"field": "net_sales", "direction": "desc"}]}})
    check("a report is built on it", report.status_code == 201, str(report.content[:300]))
    rid = report.json()["id"]
    run = world.api("post", f"/api/v1/insights/reports/{rid}/run/", {}).json()
    query = next(c for c in calls if c[0] == "query")
    check("running it reads the workspace's database with the MySQL query, the key decrypted, in the workspace's zone, and says where the rows came from",
          run["rows"] == [["Downtown", 61880.0], ["Riverside", 27320.0]] and run["freshness"] == "LIVE" and run["source"] == "Store Operations"
          and query[1].startswith("SELECT `store_name` AS `c0`, sum(`net_sales`) AS `c1` FROM `nwa_ops`.`v_daily_sales` WHERE (`sale_day` >= NOW() - INTERVAL %s DAY)") and query[2][0] == 7
          and query[3] == "s3cret" and query[4] == "America/New_York", json.dumps(run)[:300] + " " + str(query[1]))
    reports_ = world.api("get", "/api/v1/insights/reports/").json()["reports"]
    mine = next(r for r in reports_ if r["id"] == rid)
    check("the report list names the dataset and marks it as the workspace's own", mine["dataset_label"] == "Store Sales" and mine["own_dataset"] and mine["component"]["key"] == "cep")

    blocked = world.api("delete", f"/api/v1/workspace/report-databases/datasets/{dataset['id']}/")
    check("a dataset with a report on it is not deleted", blocked.status_code == 409 and "1 report is" in blocked.json()["detail"], str(blocked.content[:200]))
    blocked = world.api("delete", f"/api/v1/workspace/report-databases/{cid}/")
    check("a database with a dataset is not removed", blocked.status_code == 409)
    world.api("delete", f"/api/v1/insights/reports/{rid}/")
    gone = world.api("delete", f"/api/v1/workspace/report-databases/datasets/{dataset['id']}/")
    check("without reports the dataset goes, and the catalogue forgets it", gone.status_code == 204 and not any(d["key"] == "x_store_sales" for d in world.api("get", "/api/v1/insights/catalog/").json()["datasets"]))
    gone = world.api("delete", f"/api/v1/workspace/report-databases/{cid}/")
    check("then the database can be removed", gone.status_code == 204 and world.api("get", "/api/v1/workspace/report-databases/").json()["databases"] == [])

    # a PostgreSQL database: the port and the schema, the PostgreSQL dialect on a run
    outcome.update(version="16.4", timezone="UTC")
    pg = world.api("post", "/api/v1/workspace/report-databases/", {"name": "Loyalty Warehouse", "engine": "postgresql", "host": "loyalty.example.com", "database": "loyalty", "schema": "analytics",
                                                                    "username": "cep_reader", "password": "pg-secret"}).json()
    check("a PostgreSQL connection defaults to port 5432 and keeps its schema", pg["engine_name"] == "PostgreSQL" and pg["port"] == 5432 and pg["schema_name"] == "analytics" and pg["usable"], json.dumps(pg)[:300])
    pg_dataset = world.api("post", f"/api/v1/workspace/report-databases/{pg['id']}/datasets/", {"label": "Points", "source": "v_points", "fields": [{"column": "store_name", "label": "Store Name", "type": "string", "role": "dimension"},
                                                                                                                                                      {"column": "net_sales", "label": "Points", "type": "number", "role": "measure", "aggregates": ["sum"]}]}).json()
    pg_report = world.api("post", "/api/v1/insights/reports/", {"name": "Points by Store", "dataset": pg_dataset["key"], "definition": {"columns": [{"field": "store_name"}, {"field": "points", "aggregate": "sum"}], "filters": {"combinator": "and", "rules": []}}}).json()
    calls.clear()
    world.api("post", f"/api/v1/insights/reports/{pg_report['id']}/run/", {})
    query = next(c for c in calls if c[0] == "query")
    check("a run on it is written in the PostgreSQL dialect against the schema, with that connection's key", query[1].startswith('SELECT "store_name" AS "c0", sum("net_sales") AS "c1" FROM "analytics"."v_points" WHERE 1 = 1') and query[3] == "pg-secret", query[1])
    check.done()
