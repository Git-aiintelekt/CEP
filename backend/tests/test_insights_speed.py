"""Faster reports on a workspace's own database and the filters people ask for (docs/mockups/grid-paging-and-speed.html): a filter on
a query dataset's day field is put on its datetime, which an index can use; a parameter may default to the latest (the newest
campaign, its last send day), looked up from the newest row; a run is kept 15 minutes on a workspace's database and Refresh
runs it again. The SQL and the look-up first, then the API on the built-in Messages dataset."""
import pytest

from apps.insights import compiler, definition, parameters, report_filters, runner
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
    check("the campaign is looked up first, newest first in a plain order an index can give, one row", "ORDER BY `c1` DESC LIMIT %s" in asked_sql[0][0] and "IS NULL" not in asked_sql[0][0], asked_sql[0][0])
    check("the day is looked up under the campaign found", "Spring Sale" in asked_sql[1][1], asked_sql[1])
    bound = parameters.bind(RECEIPTS, {**d, "_latest": found}, answers)
    check("the words say which answers were the latest", [w.get("latest") for w in parameters.words({**bound, "_latest": found})] == [True, True])
    looked = len(asked_sql)
    given, found = runner._latest(TENANT, RECEIPTS, d, {"campaign": ["Fall Launch", "Haribo"]}, 60_000, "mysql", "America/New_York", False)
    check("campaigns chosen by hand: kept, and the send day stays open (any day of theirs), nothing looked up",
          given == {"campaign": ["Fall Launch", "Haribo"]} and found == [] and len(asked_sql) == looked, given)
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


def test_every_report_asks_campaign_channel_and_period(check, world):
    asked = report_filters.standard_filters(DATASET)
    check("the Messages dataset asks Campaign (several, the latest), Channel (several, all) and Period (7 days, always asked), in that order",
          [(p["key"], p["field"], p["operator"], p.get("default"), p["required"]) for p in asked]
          == [("campaign", "campaign_name", "in", {"latest": True}, False), ("channel", "channel", "in", None, False), ("period", "submitted_at", "period", "7d", True)])
    check("data without a campaign, a channel or a time field asks none of them", report_filters.standard_filters({**OWN, "time_field": None}) == [])
    mine = {"columns": [{"field": "campaign_name"}], "parameters": [{"key": "store", "field": "party_id", "operator": "in", "required": False},
                                                                   {"key": "chan", "label": "Which Channel", "field": "channel", "operator": "=", "required": True},
                                                                   {"key": "since", "field": "submitted_at", "operator": ">=", "default": "2026-09-01"}]}
    shaped = report_filters.with_standard_filters(DATASET, mine)
    check("the author's channel question keeps the Channel slot, a question on the time field gives way to Period, the author's own follow",
          [p["key"] for p in shaped["parameters"]] == ["campaign", "chan", "period", "store"], shaped["parameters"])
    check("nothing to add: the same definition back", report_filters.with_standard_filters(DATASET, shaped) is shaped)
    d = definition.validate(DATASET, shaped)
    bound = parameters.bind(DATASET, d, {"chan": "SMS", "campaign": ["Fall Launch"]})
    check("Period answers as the last 7 days by default", {"field": "submitted_at", "operator": "last_days", "value": 7} in bound["filters"]["rules"])
    for value, rule in (("quarter", {"field": "submitted_at", "operator": "last_days", "value": 91}), (["2026-09-01", "2026-09-30"], {"field": "submitted_at", "operator": "between", "value": ["2026-09-01", "2026-09-30"]})):
        answered = parameters.bind(DATASET, d, {"chan": "SMS", "period": value})
        check(f"Period {value} answers as {rule['operator']}", rule in answered["filters"]["rules"] and answered["_params"]["period"] == value)
    try:
        parameters.bind(DATASET, d, {"chan": "SMS", "period": ["2026-09-30", "2026-09-01"]})
        check("a custom period backwards is refused", False)
    except parameters.ParameterError as exc:
        check("a custom period backwards is refused", "first date" in str(exc))

    made = world.api("post", "/api/v1/insights/reports/", {"name": "Delivered by campaign", "dataset": "messages", "definition": {"columns": [{"field": "campaign_name"}, {"field": "sent", "aggregate": "sum"}]}}).json()
    check("a new report is saved with Campaign, Channel and Period", [p["key"] for p in made["definition"].get("parameters", [])] == ["campaign", "channel", "period"], made.get("definition"))
    stripped = {**made["definition"], "parameters": [p for p in made["definition"]["parameters"] if p["key"] != "period"]}
    saved = world.api("put", f"/api/v1/insights/reports/{made['id']}/", {"row_version": made["row_version"], "definition": stripped}).json()
    check("Period cannot be saved away", any(p["key"] == "period" for p in saved["definition"]["parameters"]), saved.get("definition"))
    world.sql("""INSERT INTO report (tenant_id, dataset_key, name, view_type, definition, owner_user_id, visibility)
                 SELECT tenant_id, 'messages', 'Older report', 'grid', %s, owner_user_id, 'PRIVATE' FROM report WHERE id = %s RETURNING id""",
              ['{"dataset": "messages", "columns": [{"field": "channel"}], "grouped": false, "filters": {"combinator": "and", "rules": []}, "orderBy": []}', made["id"]])
    older = next(r for r in world.api("get", "/api/v1/insights/reports/").json()["reports"] if r["name"] == "Older report")
    shown = world.api("get", f"/api/v1/insights/reports/{older['id']}/").json()
    check("a report from before is shown with the filters, as it runs", [p["key"] for p in shown["definition"].get("parameters", [])] == ["campaign", "channel", "period"])
    ran = world.api("post", f"/api/v1/insights/reports/{older['id']}/run/", {"limit": 5}).json()
    check("and runs with Period: the last 7 days", any(p["key"] == "period" and p["value"] == "7d" for p in ran.get("parameters", [])), ran.get("parameters"))
    listed = [r for r in report_filters.add_to_reports(world.tenant) if r["name"] == "Older report"]
    check("the command lists it, without changing it", [r["added"] for r in listed] == [["Campaign", "Channel", "Period"]], listed)
    report_filters.add_to_reports(world.tenant, apply=True)
    check("applied, nothing is left to add", report_filters.add_to_reports(world.tenant) == [])
    check.done()
