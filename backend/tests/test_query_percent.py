"""The query window's Run (and saving a query as a dataset, which runs it first) keeps a % of the person's SQL as written: MySQL's driver
and psycopg read % as a parameter mark only when parameters are sent, so none are; the row limit is written into the statement.
The driver is faked the way pymysql formats: arguments given, every % must be a mark (ER-1590 on .51, 2026-10-24)."""
from apps.insights import external

ROW = {"engine": "mysql80", "host": "db", "port": 3306, "username": "reader", "password_enc": None, "database_name": "shop", "ssl_mode": "OFF"}


class _Cursor:
    def __init__(self, sent):
        self.sent, self.description = sent, [("campaign_name",), ("sent",)]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=None):
        if args is not None:
            sql % tuple(args)                                          # what pymysql's mogrify does: raises on a % that is not a mark
        self.sent.append((sql, args))

    def fetchall(self):
        return [("SMS Spring Sale", 12)]


class _Conn:
    def __init__(self, sent):
        self.sent = sent

    def cursor(self):
        return _Cursor(self.sent)

    def close(self):
        pass


def test_a_percent_in_the_query_is_kept(check, monkeypatch):
    sent = []
    monkeypatch.setattr(external, "connect", lambda row, **kwargs: _Conn(sent))
    sql = "SELECT CAMPAIGN_NAME AS campaign_name, COUNT(*) AS sent FROM sms_mailer_master WHERE CAMPAIGN_NAME NOT LIKE 'SMS Keyword%' GROUP BY 1"
    out = external.run_sql(ROW, sql, limit=50)
    check("a query with LIKE 'SMS Keyword%' runs instead of failing in the driver", out["rows"] == [["SMS Spring Sale", 12]], out)
    check("it is sent as written, the limit in the statement and no parameters",
          sent == [(f"SELECT * FROM ({sql}) AS `q` LIMIT 51", None)], sent)
    check.done()
