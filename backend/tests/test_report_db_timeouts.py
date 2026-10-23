"""A slow customer database (MySQL 5.7 behind a firewall, a large schema): the catalogue gets a longer limit than a report, the
table list falls back to the names alone when counting them takes too long, the time-out reads in words, and the report limit
can be raised per workspace up to what the web server allows. No database server is contacted."""
import pymysql
import pytest

from apps.insights import external
from apps.insights.admin import MAX_STATEMENT_TIMEOUT_MS, ReportEngineSettingForm

ROW = {"engine": "mysql57", "database_name": "CG-Prod", "schema_name": "public"}


class Cursor:
    def __init__(self, conn):
        self.conn = conn
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=None):
        self.conn.statements.append(sql)
        if "information_schema" in sql and self.conn.slow:
            raise pymysql.err.OperationalError(external.MYSQL_TIMEOUT, "Query execution was interrupted, maximum statement execution time exceeded")
        if sql.startswith("SHOW FULL TABLES"):
            self.rows = [("orders", "BASE TABLE"), ("v_sales", "VIEW"), ("customers", "BASE TABLE")]
        else:
            self.rows = [("customers", "BASE TABLE", 1200, 9), ("orders", "BASE TABLE", 5_000_000, 14)]

    def fetchall(self):
        return self.rows


class Conn:
    def __init__(self, slow):
        self.slow, self.statements, self.pinged = slow, [], False

    def cursor(self):
        return Cursor(self)

    def ping(self, reconnect=False):
        self.pinged = reconnect


def test_the_table_list_is_names_alone_from_one_statement(check):
    for slow in (False, True):
        conn = Conn(slow=slow)
        listed = external._mysql_sources(conn, conn.cursor(), ROW, "CG-Prod")
        check(f"{'a slow' if slow else 'a quick'} server: views first, then tables, by name; nothing counted",
              [(s["name"], s["kind"], s["rows"], s["columns"]) for s in listed] == [("v_sales", "view", None, None), ("customers", "table", None, None), ("orders", "table", None, None)], listed)
        check("one SHOW FULL TABLES, which opens no table, the database name quoted (it has a hyphen)", conn.statements == ["SHOW FULL TABLES FROM `CG-Prod`"], conn.statements)
    check.done()


def test_a_join_is_checked_on_a_sample_of_the_base(check, monkeypatch):
    sent = []
    monkeypatch.setattr(external, "query", lambda row, sql, params, *, timeout_ms, zone=None: sent.append((sql, timeout_ms)) or [[10_000, 10_400, 9_812]])
    joins = [{"alias": "t1", "table": "stores", "type": "left", "to": "t0", "on": [["store_id", "id"]]}]
    out = external.join_check({**ROW, "database_name": "shop"}, "sales_lines", joins)
    sql, timeout = sent[0]
    check("the base is read through LIMIT 10000, in both counts", sql.count("(SELECT * FROM `shop`.`sales_lines` LIMIT 10000) AS `t0`") == 2 and "FROM `shop`.`sales_lines` AS" not in sql, sql)
    check("under the sample's time limit", timeout == external.SAMPLE_TIMEOUT_MS)
    check("the answer says it was a sample", out["sample"] == 10_000 and out["sampled"] and out["matched_rows"] == 9_812 and out["multiplies"], out)
    check.done()


def test_the_limits_and_the_message(check):
    check("the catalogue may take longer than a report", external.CATALOG_TIMEOUT_MS == 60_000 and external.SAMPLE_TIMEOUT_MS == 30_000)
    check("a slow server gets longer to answer at all", external.CONNECT_TIMEOUT_S >= 15)
    said = external._message(pymysql.err.OperationalError(3024, "Query execution was interrupted, maximum statement execution time exceeded"))
    check("the server's time limit reads in words, not as an error number", "took too long to answer" in said and "3024" not in said, said)
    lost = external._message(pymysql.err.OperationalError(2013, "Lost connection to MySQL server during query"))
    check("so does a read that timed out behind a firewall", "took too long to answer" in lost, lost)
    check.done()


@pytest.mark.parametrize("limits, ok", [({"statement_timeout_ms": 60_000}, True), ({"statement_timeout_ms": MAX_STATEMENT_TIMEOUT_MS}, True),
                                        ({"statement_timeout_ms": 300_000}, False), ({"statement_timeout_ms": "60s"}, False), ({}, True)])
def test_the_report_limit_can_be_raised_up_to_what_the_web_server_allows(limits, ok):
    form = ReportEngineSettingForm.__new__(ReportEngineSettingForm)
    form.cleaned_data = {"query_limits": limits}
    if ok:
        assert form.clean_query_limits() == limits
    else:
        with pytest.raises(Exception, match="statement_timeout_ms"):
            form.clean_query_limits()
