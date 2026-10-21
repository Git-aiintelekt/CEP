"""ClickHouse as a Report Database (apps/insights/external, databases, the compiler's ClickHouse dialect on a workspace's own
database), and a report author connecting a database from New Report: the column typing, the grants and the query window's guard
(pure); the connector against a faked HTTP interface (read-only settings, an account whose profile refuses settings, errors in
words, a stopped query); the API as someone with Report Edit but not User Admin: a ClickHouse connection saved and tested, a table
mapped whole, a report run on it in the ClickHouse dialect without FINAL. No network: the wire is faked."""
import json

import pytest
from django.conf import settings
from django.db import connections

from apps.identity.models import AppUser
from apps.insights import clickhouse, compiler, databases, definition, external
from apps.platform_ops import crypto
from tests.test_insights import DATASET

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

P = settings.PLATFORM_ALIAS
ROW = {"engine": "clickhouse", "host": "ch.cityht.example", "port": 8443, "database_name": "events", "schema_name": "events", "username": "c360_reader",
       "password_enc": crypto.encrypt("ch-secret"), "ssl_mode": "REQUIRED"}
OWN = {**DATASET, "key": "x_page_views", "label": "Page Views", "source": "events.page_views", "workspace_field": None, "engine": "clickhouse", "external": True,
       "fields": [
           {"key": "viewed_at", "label": "Viewed At", "column": "viewed_at", "type": "datetime", "role": "dimension", "aggregates": [], "operators": ["between", "last_days"], "buckets": ["day", "month"], "format": "datetime", "sensitivity": "NORMAL"},
           {"key": "page", "label": "Page", "column": "page", "type": "string", "role": "dimension", "aggregates": [], "operators": ["=", "in", "contains"], "buckets": [], "format": None, "sensitivity": "NORMAL"},
           {"key": "views", "label": "Views", "column": "views", "type": "number", "role": "measure", "aggregates": ["sum"], "operators": [">"], "buckets": [], "format": "integer", "sensitivity": "NORMAL"},
       ]}


class FakeClickHouse:
    """Answers clickhouse._request by the SQL it is sent; records every call with its settings. refuse_settings: the account's profile
    is readonly = 1, so any setting is refused with code 164."""

    def __init__(self, answers, refuse_settings=False):
        self.answers, self.refuse_settings, self.calls = answers, refuse_settings, []

    def __call__(self, sql, conn, *, params=None, body=None, settings_=None, timeout_s=30):
        self.calls.append({"sql": sql, "params": params, "settings": dict(settings_ or {}), "url": conn.url, "user": conn.user, "password": conn.password})
        if self.refuse_settings and set(settings_ or {}) - {"database"}:
            raise clickhouse.ClickHouseError("ClickHouse answered 500: Code: 164. DB::Exception: Cannot modify 'readonly' setting in readonly mode. (READONLY) (version 24.8.4.13)")
        for start, answer in self.answers:
            if sql.startswith(start):
                if isinstance(answer, Exception):
                    raise answer
                return json.dumps(answer).encode()
        raise AssertionError("unexpected SQL: " + sql)


def _tables() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('report_connection', 'report_dataset_custom', 'report', 'report_run_audit')")
        return cursor.fetchone()[0] == 4


def _takes_clickhouse() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_report_connection_engine'")
        found = cursor.fetchone()
    return bool(found) and "clickhouse" in found[0]


def test_pure(check):
    check("ClickHouse types read through Nullable and LowCardinality: integers, floats, decimals, dates, datetimes, booleans, text, and complex types apart",
          [external._ch_type(t) for t in ("UInt64", "Nullable(Int32)", "Float64", "Decimal(12, 2)", "Date32", "DateTime64(3, 'UTC')", "Nullable(DateTime)", "Bool",
                                         "LowCardinality(Nullable(String))", "UUID", "Array(String)", "Map(String, UInt64)", "Tuple(a String)")]
          == ["bigint", "bigint", "double", "decimal", "date", "datetime", "datetime", "boolean", "varchar", "varchar", "complex", "complex", "complex"])
    typed = external._typed(external._ch_type("Decimal(12, 2)"), "Decimal(12, 2)", "net_amount")
    check("a decimal amount is a money measure; an id stays a dimension", typed["role"] == "measure" and typed["format"] == "money"
          and external._typed("bigint", "UInt64", "store_id")["role"] == "dimension")
    check("SELECT and SHOW grants read as read-only", external._ch_grants(["GRANT SELECT ON events.* TO c360_reader", "GRANT SHOW TABLES, SHOW COLUMNS ON events.* TO c360_reader"]) == [])
    check("a grant to write, a role and the grant option are named",
          external._ch_grants(["GRANT SELECT, INSERT, ALTER UPDATE ON events.* TO c360_reader", "GRANT analysts TO c360_reader", "GRANT SELECT ON events.* TO c360_reader WITH GRANT OPTION"])
          == ["INSERT, ALTER UPDATE on events.*", "a role: analysts", "GRANT OPTION on events.*"])

    for sql, words in (("SELECT * FROM url('http://x/a.csv', CSV)", "url()"), ("SELECT count() FROM s3('https://b/k', 'CSV')", "s3()"),
                       ("SELECT * FROM remote('other:9000', db.t)", "remote()"), ("SELECT 1 FROM events.page_views SETTINGS max_execution_time = 9999", "SETTINGS")):
        try:
            external.check_sql(sql, "clickhouse")
            refused = ""
        except external.ExternalError as exc:
            refused = str(exc)
        check(f"the ClickHouse window refuses {words}", words in refused, refused)
    check("an ordinary SELECT passes on ClickHouse, and the ClickHouse rules leave MySQL alone",
          external.check_sql("SELECT page, count() AS views FROM page_views WHERE page LIKE '/shop%' GROUP BY page", "clickhouse").startswith("SELECT page")
          and external.check_sql("SELECT settings FROM app_config", "mysql80") == "SELECT settings FROM app_config")

    d = definition.validate(OWN, {"columns": [{"field": "page"}, {"field": "viewed_at", "bucket": "month"}, {"field": "views", "aggregate": "sum"}],
                                  "filters": {"combinator": "and", "rules": [{"field": "page", "operator": "in", "value": ["/", "/shop"]}, {"field": "viewed_at", "operator": "last_days", "value": 30}]},
                                  "orderBy": [{"field": "views", "direction": "desc"}], "limit": 100})
    out = compiler.compile(OWN, d, "a0000000-0000-4000-8000-000000000001", "America/New_York", limit=51, offset=0, dialect="clickhouse")
    check("a workspace's ClickHouse database is read as it is: no FINAL, no workspace restriction, typed {pN:Type} parameters",
          'FROM "events"."page_views" WHERE' in out.sql and "FINAL" not in out.sql and "tenant_id" not in out.sql and isinstance(out.params, dict) and "{p0:" in out.sql, out.sql)
    engine_own = compiler.compile({**OWN, "external": False}, d, "a0000000-0000-4000-8000-000000000001", "America/New_York", limit=51, offset=0, dialect="clickhouse")
    check("the engine's own replacing tables are still read FINAL", '"events"."page_views" FINAL' in engine_own.sql, engine_own.sql)
    check.done()


def test_connector(check, monkeypatch):
    fake = FakeClickHouse([
        ("SELECT version()", {"meta": [], "data": [["24.8.4.13", "UTC", 0]]}),
        ("SELECT engine IN", {"meta": [], "data": [[0, 38], [1, 4]]}),
        ("SHOW GRANTS", {"meta": [], "data": [["GRANT SELECT ON events.* TO c360_reader"]]}),
        ("SELECT name, engine, total_rows FROM system.tables", {"meta": [], "data": [["page_views", "MergeTree", 48200000], ["orders_daily", "View", None], ["bad name", "MergeTree", 3]]}),
        ("SELECT table, count() FROM system.columns", {"meta": [], "data": [["page_views", 3], ["orders_daily", 7]]}),
        ("SELECT name, type, is_in_primary_key FROM system.columns", {"meta": [], "data": [["viewed_at", "DateTime64(3, 'UTC')", 1], ["page", "LowCardinality(String)", 0],
                                                                                          ["views", "UInt32", 0], ["tags", "Array(String)", 0]]}),
        ("SELECT * FROM (SELECT page", {"meta": [{"name": "page", "type": "String"}, {"name": "day", "type": "Date"}, {"name": "views", "type": "UInt64"}],
                                         "data": [["/", "2026-10-20", 120], ["/shop", "2026-10-20", 48]]}),
        ("SELECT slow", clickhouse.ClickHouseError("ClickHouse answered 500: Code: 159. DB::Exception: Timeout exceeded: elapsed 15.0 seconds. (TIMEOUT_EXCEEDED)")),
        ("SELECT \"page\"", {"meta": [], "data": [["/", 120]]}),
    ])
    monkeypatch.setattr(clickhouse, "_request", fake)

    tested = external.test(ROW)
    check("Test Connection reads the version, the zone, the tables and views, and finds a SELECT-only account read-only",
          tested["ok"] and tested["version"] == "24.8.4.13" and tested["tables"] == 38 and tested["views"] == 4 and tested["read_only"] and tested["offending"] == [], json.dumps(tested))
    first = fake.calls[0]
    check("over HTTPS to the host and HTTP port, as the account, with the password decrypted, and no setting on the account's own checks",
          first["url"] == "https://ch.cityht.example:8443" and first["user"] == "c360_reader" and first["password"] == "ch-secret" and first["settings"] == {"database": "events"}, str(first))

    listed = external.sources(ROW)
    check("the tables and views the account can read, views first, their columns counted", [(s["name"], s["kind"], s["columns"]) for s in listed][:2] == [("orders_daily", "view", 7), ("page_views", "table", 3)]
          and listed[1]["rows"] == 48200000 and listed[0]["rows"] is None and not listed[2]["mappable"], json.dumps(listed))
    cols = external.columns(ROW, "page_views")
    check("a table's columns typed: the datetime a dimension, the count a measure, an array not mappable, the sort key marked",
          [(c["column"], c["type"], c["role"], c["mappable"], c["key"]) for c in cols] == [("viewed_at", "datetime", "dimension", True, True), ("page", "string", "dimension", True, False),
                                                                                            ("views", "number", "measure", True, False), ("tags", "string", "dimension", False, False)], json.dumps(cols))

    fake.calls.clear()
    ran = external.run_sql(ROW, "SELECT page, toDate(viewed_at) AS day, count() AS views FROM page_views GROUP BY page, day", limit=1, timeout_ms=15_000, zone="America/New_York")
    sent = fake.calls[0]
    check("the query window wraps the SELECT with a limit and sends it read-only, with the limit, LEFT JOIN NULLs and the workspace's zone",
          sent["sql"].endswith(") AS q LIMIT 2 FORMAT JSONCompact") and sent["settings"]["readonly"] == 2 and sent["settings"]["max_execution_time"] == 15
          and sent["settings"]["join_use_nulls"] == 1 and sent["settings"]["session_timezone"] == "America/New_York" and sent["settings"]["database"] == "events", str(sent))
    check("its columns are typed from the server's types, one row shown and more said to be there",
          [(c["column"], c["type"]) for c in ran["columns"]] == [("page", "string"), ("day", "date"), ("views", "number")] and ran["rows"] == [["/", "2026-10-20", 120]] and ran["truncated"])
    try:
        external.query(ROW, "SELECT slow FROM t", {}, timeout_ms=15_000)
        stopped = ""
    except RuntimeError as exc:
        stopped = str(exc)
    check("a query the server stops reads as a statement timeout, as on the other engines", stopped.startswith("statement timeout"), stopped)
    rows = external.query(ROW, 'SELECT "page" FROM "events"."page_views" WHERE "page" IN {p0:Array(String)}', {"p0": ["/"]}, timeout_ms=15_000)
    check("the runner's path sends the compiler's parameters by name and returns the rows", rows == [["/", 120]] and fake.calls[-1]["params"] == {"p0": ["/"]})

    strict = FakeClickHouse(fake.answers, refuse_settings=True)
    monkeypatch.setattr(clickhouse, "_request", strict)
    rows = external.query(ROW, 'SELECT "page" FROM x', None, timeout_ms=15_000)
    check("an account whose profile is read-only refuses every setting: the query is sent again with fewer, then none, and still answers",
          rows == [["/", 120]] and [sorted(set(c["settings"]) - {"database"}) for c in strict.calls] == [
              ["join_use_nulls", "max_execution_time", "output_format_json_quote_64bit_integers", "readonly"], ["join_use_nulls", "max_execution_time", "output_format_json_quote_64bit_integers"], []],
          str([c["settings"] for c in strict.calls]))

    writer = FakeClickHouse([("SELECT version()", {"meta": [], "data": [["24.8.4.13", "UTC", 0]]}), ("SELECT engine IN", {"meta": [], "data": []}),
                             ("SHOW GRANTS", {"meta": [], "data": [["GRANT SELECT, INSERT, DROP TABLE ON events.* TO c360_reader"]]})])
    monkeypatch.setattr(clickhouse, "_request", writer)
    tested = external.test(ROW)
    check("an account that can write is not read-only, and what it holds is named", tested["ok"] and tested["read_only"] is False and tested["offending"] == ["INSERT, DROP TABLE on events.*"], json.dumps(tested))
    profile = FakeClickHouse([("SELECT version()", {"meta": [], "data": [["24.8.4.13", "UTC", 1]]}), ("SELECT engine IN", {"meta": [], "data": [[0, 2]]})])
    monkeypatch.setattr(clickhouse, "_request", profile)
    tested = external.test(ROW)
    check("an account whose profile is read-only passes whatever it was granted, and its grants are not asked", tested["read_only"] and not any(c["sql"].startswith("SHOW GRANTS") for c in profile.calls))

    for code, words in ((516, "refused the user and password"), (81, "No database of that name")):
        refused = FakeClickHouse([("SELECT version()", clickhouse.ClickHouseError(f"ClickHouse answered 516: Code: {code}. DB::Exception: no. (X) (version 24.8)"))])
        monkeypatch.setattr(clickhouse, "_request", refused)
        tested = external.test(ROW)
        check(f"code {code} is said in words", not tested["ok"] and words in tested["error"], tested["error"])
    unreachable = FakeClickHouse([("SELECT version()", clickhouse.ClickHouseError("ClickHouse could not be reached: <urlopen error [Errno 11001] getaddrinfo failed>"))])
    monkeypatch.setattr(clickhouse, "_request", unreachable)
    check("a server that does not answer names the HTTP ports", "8443 with HTTPS, 8123 without" in external.test(ROW)["error"])
    plain = external._ch_connection({**ROW, "ssl_mode": "OFF", "port": 8123})
    check("encryption off reads over plain HTTP", plain.url == "http://ch.cityht.example:8123")
    check.done()


def test_author_connects_from_new_report(check, world, monkeypatch):
    if not _tables():
        pytest.skip("patch 0056 has not been applied to this database")
    if not _takes_clickhouse():
        pytest.skip("patch 0071 has not been applied to this database: report_connection does not take ClickHouse yet")
    fake = FakeClickHouse([
        ("SELECT version()", {"meta": [], "data": [["24.8.4.13", "UTC", 0]]}),
        ("SELECT engine IN", {"meta": [], "data": [[0, 1]]}),
        ("SHOW GRANTS", {"meta": [], "data": [["GRANT SELECT ON events.* TO c360_reader"]]}),
        ("SELECT name, type, is_in_primary_key FROM system.columns", {"meta": [], "data": [["viewed_at", "DateTime", 1], ["page", "String", 0], ["views", "UInt32", 0]]}),
        ("SELECT \"page\" AS \"c0\"", {"meta": [], "data": [["/", 120], ["/shop", 48]]}),
    ])
    monkeypatch.setattr(clickhouse, "_request", fake)
    author = {"report.view", "report.edit"}                                    # a report author: Report Edit, not User Admin
    monkeypatch.setattr(AppUser, "permission_codes", lambda self: set(author))
    monkeypatch.setattr(AppUser, "is_platform_admin", property(lambda self: False, lambda self, value: None), raising=False)

    check("a report author does not see Settings' list of databases", world.api("get", "/api/v1/workspace/report-databases/").status_code == 403)
    tried = world.api("post", "/api/v1/workspace/report-databases/test/", {"name": "Events Warehouse", "engine": "clickhouse", "host": "ch.cityht.example", "database": "events",
                                                                          "username": "c360_reader", "password": "ch-secret", "ssl": "REQUIRED"})
    check("but may test a new connection from New Report", tried.status_code == 200 and tried.json()["test"]["read_only"] is True, str(tried.content[:300]))
    preferred = world.api("post", "/api/v1/workspace/report-databases/", {"name": "Events Warehouse", "engine": "clickhouse", "host": "ch.cityht.example", "database": "events",
                                                                         "username": "c360_reader", "password": "ch-secret", "ssl": "PREFERRED"})
    check("ClickHouse is HTTPS or plain HTTP, never Preferred", preferred.status_code == 400 and "ssl" in preferred.json()["errors"], str(preferred.content[:200]))
    made = world.api("post", "/api/v1/workspace/report-databases/", {"name": "Events Warehouse", "engine": "clickhouse", "host": "ch.cityht.example", "database": "events",
                                                                    "username": "c360_reader", "password": "ch-secret", "ssl": "REQUIRED"})
    body = made.json()
    check("and save it: port 8443 by default, tested at once, read-only and usable", made.status_code == 201 and body["engine_name"] == "ClickHouse" and body["port"] == 8443
          and body["read_only"] is True and body["usable"] and body["server_version"] == "24.8.4.13", json.dumps(body)[:300])
    cid = body["id"]
    targets = world.api("get", "/api/v1/workspace/report-databases/targets/").json()["databases"]
    check("New Report offers it to query", any(t["id"] == cid and t["engine_name"] == "ClickHouse" for t in targets), json.dumps(targets)[:300])

    mapped = world.api("post", f"/api/v1/workspace/report-databases/{cid}/datasets/", {"source": "page_views"})
    dataset = mapped.json()
    check("a table picked whole becomes a dataset: every readable column a field, labelled from its name, the first datetime the time field, the sort key the row key",
          mapped.status_code == 201 and dataset["label"] == "Page Views" and [f["key"] for f in dataset["fields"]] == ["viewed_at", "page", "views"]
          and dataset["time_field"] == "viewed_at" and dataset["primary_key"] == "viewed_at" and dataset["fields"][2]["role"] == "measure", str(mapped.content[:400]))
    again = world.api("post", f"/api/v1/workspace/report-databases/{cid}/datasets/", {"source": "page_views"})
    check("picking the same table again gives the same dataset, not a copy", again.status_code == 200 and again.json()["key"] == dataset["key"], str(again.content[:200]))
    check("removing the connection stays with administrators", world.api("delete", f"/api/v1/workspace/report-databases/{cid}/").status_code == 403)

    author.add("user.admin")                                                   # the catalogue and the report as an administrator, like any dataset
    report = world.api("post", "/api/v1/insights/reports/", {"name": "Views by Page", "dataset": dataset["key"],
                                                             "definition": {"columns": [{"field": "page"}, {"field": "views", "aggregate": "sum"}], "filters": {"combinator": "and", "rules": []},
                                                                            "orderBy": [{"field": "views", "direction": "desc"}]}})
    check("a report is built on it", report.status_code == 201, str(report.content[:300]))
    fake.calls.clear()
    run = world.api("post", f"/api/v1/insights/reports/{report.json()['id']}/run/", {}).json()
    sent = next(c for c in fake.calls if c["sql"].startswith('SELECT "page"'))
    check("running it reads the ClickHouse database in the ClickHouse dialect, without FINAL, read-only, as the saved account",
          run.get("rows") == [["/", 120], ["/shop", 48]] and run.get("source") == "Events Warehouse" and 'FROM "events"."page_views"' in sent["sql"] and "FINAL" not in sent["sql"]
          and sent["settings"]["readonly"] == 2 and sent["password"] == "ch-secret", json.dumps(run)[:300] + " " + sent["sql"])
    check.done()
