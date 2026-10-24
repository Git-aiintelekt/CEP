"""Faster reports on a workspace's own database and the filters people ask for (docs/mockups/grid-paging-and-speed.html): a filter on
a query dataset's day field is put on its datetime, which an index can use; a parameter may default to the latest (the newest
campaign, its last send day), looked up from the newest row; a run is kept 15 minutes on a workspace's database and Refresh
runs it again. The SQL and the look-up first, then the API on the built-in Messages dataset."""
import pytest

from apps.insights import compiler, definition, parameters, runner
from apps.insights.definition import DefinitionError

from .test_insights import DATASET
from .test_report_databases import OWN

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
TENANT = "a0000000-0000-4000-8000-000000000001"
DAY = {"key": "sent_date", "label": "Sent Date", "column": "sent_date", "type": "date", "role": "dimension", "aggregates": [], "operators": ["=", ">=", "<=", ">", "<", "between", "last_days"],
       "buckets": ["day", "week", "month"], "format": "date", "sensitivity": "NORMAL", "table": "t0"}
AT = {**DAY, "key": "sent_at", "label": "Sent At", "column": "sent_at", "type": "datetime", "format": "datetime"}
CAMPAIGN = {"key": "campaign_name", "label": "Campaign", "column": "campaign_name", "type": "string", "role": "dimension", "aggregates": [], "operators": ["=", "in"], "buckets": [],
            "format": None, "sensitivity": "NORMAL", "table": "t0"}
RECEIPTS = {**OWN, "key": "x_receipts", "source": "citi.query", "time_field": "sent_at", "fields": [AT, DAY, CAMPAIGN],
            "query": "SELECT m.SENT_AT AS sent_at, DATE(m.SENT_AT) AS sent_date, m.CAMPAIGN_NAME AS campaign_name FROM sms_mailer_master m"}


def _sql(dataset, rules) -> str:
    d = definition.validate(dataset, {"columns": [{"field": "campaign_name"}], "filters": {"combinator": "and", "rules": rules}})
    return compiler.compile(dataset, d, TENANT, "America/New_York", limit=10, dialect="mysql")


def test_day_filters_use_the_datetime(check):
    check("DATE(m.SENT_AT) AS sent_date beside m.SENT_AT AS sent_at is the day of sent_at", compiler.day_fields(RECEIPTS) == {"sent_date": "sent_at"})
    last = _sql(RECEIPTS, [{"field": "sent_date", "operator": "last_days", "value": 30}])
    check("last 30 days on the day is asked of the datetime", "`t0`.`sent_at` >= NOW() - INTERVAL %s DAY" in last.sql and "`sent_date` >=" not in last.sql, last.sql)
    span = _sql(RECEIPTS, [{"field": "sent_date", "operator": "between", "value": ["2026-10-01", "2026-10-07"]}])
    check("a range of days is the datetime from the first day to before the day after the last",
          "`t0`.`sent_at` >= %s AND `t0`.`sent_at` < DATE_ADD(%s, INTERVAL 1 DAY)" in span.sql and span.params[:2] == ["2026-10-01", "2026-10-07"], span.sql)
    upto = _sql(RECEIPTS, [{"field": "sent_date", "operator": "<=", "value": "2026-10-07"}])
    check("on or before a day is before the next one", "`t0`.`sent_at` < %s" in upto.sql and "2026-10-08" in upto.params, upto.sql)
    after = _sql(RECEIPTS, [{"field": "sent_date", "operator": ">", "value": "2026-10-07"}])
    check("after a day is from the next one", "`t0`.`sent_at` >= %s" in after.sql and "2026-10-08" in after.params)
    plain = {**RECEIPTS, "query": "SELECT DATE(m.SENT_AT) AS sent_date, m.SENT_AT + INTERVAL 1 HOUR AS sent_at, m.CAMPAIGN_NAME AS campaign_name FROM sms_mailer_master m"}
    check("without the bare datetime beside it the day stays as it is", compiler.day_fields(plain) == {}
          and "`t0`.`sent_date` >= NOW()" in _sql(plain, [{"field": "sent_date", "operator": "last_days", "value": 7}]).sql)
    check.done()


def test_latest_default(check, monkeypatch):
    asked = [{"key": "campaign", "field": "campaign_name", "operator": "in", "default": {"latest": True}},
             {"key": "day", "field": "sent_at", "operator": "between", "default": {"latest": True}}]
    raw = {"columns": [{"field": "campaign_name"}], "parameters": asked}
    d = definition.validate(RECEIPTS, raw)
    check("a value and a date parameter may default to the latest", [p["default"] for p in d["parameters"]] == [{"latest": True}, {"latest": True}])
    try:
        definition.validate({**RECEIPTS, "time_field": None}, raw)
        check("without a time field the latest is refused", False)
    except DefinitionError as exc:
        check("without a time field the latest is refused", exc.field == "parameters[0].default", exc.field)
    check("unanswered and not looked up, the latest leaves its rule out", parameters.bind(RECEIPTS, d, {}) is d)

    asked_sql = []

    def fake_execute(tenant_id, compiled, timeout_ms, dialect="postgresql", dataset=None, zone=None):
        asked_sql.append((compiled.sql, list(compiled.params)))
        return ([["Spring Sale", None]] if "`c0`" in compiled.sql and "campaign_name` AS `c0`" in compiled.sql else [["2026-10-22 18:40:00"]]), 3

    monkeypatch.setattr(runner, "_execute", fake_execute)
    monkeypatch.setattr(runner.cache, "get", lambda key: None)
    monkeypatch.setattr(runner.cache, "set", lambda key, value, ttl: None)
    answers, found = runner._latest(TENANT, RECEIPTS, d, {}, 60_000, "mysql", "America/New_York", False)
    check("the latest campaign is the newest row's, and its last send day the newest row's day for that campaign",
          answers == {"campaign": ["Spring Sale"], "day": ["2026-10-22", "2026-10-22"]} and found == ["campaign", "day"], answers)
    check("the campaign is looked up first, newest first, one row", "ORDER BY `c1` IS NULL, `c1` DESC LIMIT %s" in asked_sql[0][0], asked_sql[0][0])
    check("the day is looked up under the campaign found", "Spring Sale" in asked_sql[1][1], asked_sql[1])
    given, found = runner._latest(TENANT, RECEIPTS, d, {"campaign": ["Fall Launch"]}, 60_000, "mysql", "America/New_York", False)
    check("an answer given is kept; only the day is looked up, under it", given["campaign"] == ["Fall Launch"] and found == ["day"] and "Fall Launch" in asked_sql[-1][1])
    bound = parameters.bind(RECEIPTS, {**d, "_latest": found}, given)
    check("the words say which answer was the latest", [w.get("latest") for w in parameters.words({**bound, "_latest": found})] == [None, True])
    check.done()


def test_kept_and_refresh(check, world):
    draft = {"dataset": "messages", "definition": {"columns": [{"field": "channel"}, {"field": "sent", "aggregate": "sum"}]}}
    created = world.api("post", "/api/v1/insights/reports/", {"name": "Sent by channel", **draft}).json()
    first = world.api("post", f"/api/v1/insights/reports/{created['id']}/run/", {"limit": 17}).json()
    check("a run says when it ran and how long it is kept: a minute on the platform's data", first["cached"] is False and first["ran_at"] and first["kept_s"] == 60, first)
    again = world.api("post", f"/api/v1/insights/reports/{created['id']}/run/", {"limit": 17}).json()
    check("opened again it is the kept result, with the time it ran", again["cached"] is True and again["ran_at"] == first["ran_at"])
    fresh = world.api("post", f"/api/v1/insights/reports/{created['id']}/run/", {"limit": 17, "fresh": True}).json()
    check("Refresh runs it again", fresh["cached"] is False)
    check("a workspace's own database is kept 15 minutes", runner.EXTERNAL_CACHE_SECONDS == 900)
    check.done()
