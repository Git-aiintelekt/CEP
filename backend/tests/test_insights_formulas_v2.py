"""Insights' formula language, version 2, and shared formulas: VAR, SUMX and the new functions; CALCULATE with ALL, RANKX and the
time functions compiled over the report's grouped rows (each dialect, the widened date, the totals left empty); shared formulas
offered in the catalogue and worked out like a report's own; then the API: those measures run on the workspace's rows and checked
against plain reports, and (once patch 0065 is applied) a shared formula's life: add, use, certify, the guard on removal."""
from unittest import mock

import pytest
from django.db import connections

from apps.insights import compiler, dataset_formulas, definition, derived, formula
from apps.insights.definition import DefinitionError

from .test_insights import DATASET, P

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
TENANT = "a0000000-0000-4000-8000-000000000001"


def _refusal(text: str, measure: bool = True) -> tuple[str, int | None]:
    try:
        formula.check(text, DATASET, measure=measure)
    except formula.FormulaError as exc:
        return str(exc), exc.at
    return "", None


def _sql(text: str, dialect: str = "postgresql") -> str:
    checked = formula.check(text, DATASET, measure=False)
    return formula.render(checked.ast, dialect, lambda key: f'"{key}"')


def test_language(check):
    named = formula.check("VAR S = SUM([Sent Count]) VAR D = COUNT([Messages]) RETURN DIVIDE(D, S) * 100", DATASET, measure=True)
    check("VAR names parts and RETURN uses them, each part an aggregate of its own", named.type == "number" and len(named.calls) == 2 and not named.analytic)
    check("SUMX and the other X aggregates are the aggregates by another name", [c["fn"] for c in formula.check("SUMX([Sent Count] * 2) + COUNTX([Channel])", DATASET, measure=True).calls] == ["SUM", "COUNT"])
    share = formula.check("DIVIDE(SUM([Sent Count]), CALCULATE(SUM([Sent Count]), ALL([Channel])))", DATASET, measure=True)
    check("CALCULATE with ALL is analytic; with a condition only it narrows the aggregates", share.analytic and not share.timed
          and not formula.check("CALCULATE(SUM([Sent Count]), [Channel] = \"SMS\")", DATASET, measure=True).analytic
          and formula.check("CALCULATE(SUM([Sent Count], [Channel] = \"SMS\"), [Campaign] = \"A\")", DATASET, measure=True).calls[0]["when"]["op"] == "AND")
    check("the time functions are analytic and need the report's date; RANKX is a measure of its own",
          all(formula.check(t, DATASET, measure=True).timed for t in ("TOTALYTD(SUM([Sent Count]))", "TOTALQTD(SUM([Sent Count]))", "SAMEPERIODLASTYEAR(SUM([Sent Count]))",
                                                                       "PREVIOUSPERIOD(SUM([Sent Count]))", "PARALLELPERIOD(SUM([Sent Count]), -3, \"month\")"))
          and formula.check("RANKX(SUM([Sent Count]), \"asc\")", DATASET, measure=True).ranked)
    check("the new functions keep their types", [formula.check(t, DATASET, measure=False).type for t in
                                                 ("POWER([Sent Count], 2)", "MID([Channel], 1, 2)", "WEEKDAY([Sent])", "EOMONTH([Sent])", "DATE(2026, 1, 31)", "NOW()", "VALUE(\"7\")", "FIND(\"M\", [Channel])")]
          == ["number", "string", "number", "date", "date", "datetime", "number", "number"])
    for text, measure, words, at in (
            ("VAR X = 1", False, "write RETURN", 9),
            ("VAR SUM = 1 RETURN SUM", False, "not a function", 4),
            ("RANKX(SUM([Sent Count])) * 2", True, "measure of its own", 0),
            ("CALCULATE(SUM([Sent Count]), ALL([Sent Count]))", True, "is a measure", 33),
            ("TOTALYTD(CALCULATE(SUM([Sent Count]), ALL()))", True, "cannot sit inside one another", 9),
            ("SAMEPERIODLASTYEAR(PREVIOUSPERIOD(SUM([Sent Count])))", True, "One time shift at a time", 19),
            ("CALCULATE(DISTINCTCOUNT([Customer]), ALL())", True, "cannot be added up across groups", 10),
            ("PARALLELPERIOD(SUM([Sent Count]), 1.5, \"month\")", True, "whole number of periods", 34),
            ("TOTALYTD(SUM([Sent Count]))", False, "use it in a measure formula", 0),
            ("ALL([Channel])", True, "goes inside CALCULATE", 0),
            ("HOUR(DATE(2026, 1, 1))", False, "date and time", 5)):
        message, place = _refusal(text, measure)
        check(f"refused with its place: {text}", words in message and place == at, f"{message} at {place}")
    older = {**DATASET, "database": {"engine": "mysql57"}}
    refused = []
    for text, at in (("RANKX(SUM([Sent Count]))", 0), ("TOTALYTD(SUM([Sent Count]))", 0), ("SAMEPERIODLASTYEAR(SUM([Sent Count]))", 0),
                     ("CALCULATE(SUM([Sent Count]), ALL([Channel]))", 29), ("DIVIDE(SUM([Sent Count]), CALCULATE(SUM([Sent Count]), REMOVEFILTERS()))", 55)):
        try:
            formula.check(text, older, measure=True)
            refused.append((text, None))
        except formula.FormulaError as exc:
            refused.append((text, exc.at if "MySQL 5.7" in str(exc) else str(exc)))
    check("on a MySQL 5.7 database ALL, RANKX and the time functions are refused as you type, at their place", [r[1] for r in refused] == [0, 0, 0, 29, 55], str(refused))
    check("CALCULATE with a condition, and the other new functions, still work there",
          not formula.check("CALCULATE(SUM([Sent Count]), [Channel] = \"SMS\") + SUMX([Sent Count] * 2)", older, measure=True).analytic
          and formula.check("POWER([Sent Count], 2) + WEEKDAY([Sent])", older, measure=False).type == "number")
    with_zone = formula.ZONE.set("UTC")
    check("each dialect writes the new functions its own way",
          _sql("WEEKDAY([Sent])", "clickhouse") == "(toDayOfWeek(toTimeZone(\"submitted_at\", 'UTC')) % 7 + 1)" and _sql("WEEKDAY([Sent])", "mysql") == "DAYOFWEEK(\"submitted_at\")"
          and _sql("MOD([Sent Count], 3)") == "mod(CAST(\"sent\" AS numeric), NULLIF(CAST(3 AS numeric), 0))" and _sql("SUBSTITUTE([Channel], \"E\", \"e\")") == "REPLACE(\"channel\", 'E', 'e')"
          and _sql("SQRT([Sent Count])") == "(CASE WHEN \"sent\" >= 0 THEN sqrt(\"sent\") END)")
    formula.ZONE.reset(with_zone)
    check.done()


def _monthly(*measures, rules=None):
    return {"columns": [{"field": "submitted_at", "bucket": "month"}, {"field": "channel"}, *[{"field": key, "aggregate": "calc"} for key, _ in measures]],
            "derived": [{"key": key, "label": key[2:].replace("_", " ").title(), "kind": "measure", "expression": text} for key, text in measures],
            "filters": {"combinator": "and", "rules": rules or []}}


def test_compiled_over_the_grouped_rows(check):
    d = definition.validate(DATASET, _monthly(("c_share", "DIVIDE(SUM([Sent Count]), CALCULATE(SUM([Sent Count]), ALL([Channel]))) * 100"),
                                              ("c_ytd", "TOTALYTD(SUM([Sent Count]))"), ("c_last_year", "SAMEPERIODLASTYEAR(AVERAGE([Sent Count]))"),
                                              ("c_place", "RANKX(SUM([Sent Count]))"), rules=[{"field": "submitted_at", "operator": "last_days", "value": 90}]))
    c = compiler.compile(DATASET, d, TENANT, "America/New_York", limit=20)
    sql = c.sql
    check("three levels: the grouped rows (each aggregate its own column), the windows and the shifted copy, the rank and the trim",
          sql.startswith('SELECT "w"."c0" AS "c0"') and 'rank() OVER (ORDER BY "w"."r5" DESC NULLS LAST)' in sql and 'sum("g"."a2_1") OVER (PARTITION BY "g"."d0")' in sql
          and "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW" in sql and 'AS "s0" ON "s0"."d0" = CAST("g"."d0" - make_interval(months => 12) AS date)' in sql
          and '"s0"."d1" IS NOT DISTINCT FROM "g"."d1"' in sql and 'WHERE "w"."keep_"' in sql, sql[:400])
    check("the date's filter widens for last year's rows (both copies), and every value binds in order", c.params.count("America/New_York") == 6
          and c.sql.count("%s") == len(c.params) and c.params[-2:] == [20, 0])
    for dialect in ("mysql", "clickhouse"):
        other = compiler.compile(DATASET, d, TENANT, "UTC", limit=20, dialect=dialect)
        check(f"{dialect} compiles it too", "OVER (" in other.sql and ("DATE_SUB" in other.sql if dialect == "mysql" else "addMonths" in other.sql))
    fiscal = definition.validate(DATASET, {**_monthly(("c_ytd", "TOTALYTD(SUM([Sent Count]))")), "_fiscal": 4})
    check("year to date starts at the fiscal year's start", "make_interval(months => 3)" in compiler.compile(DATASET, {**fiscal, "_fiscal": 4}, TENANT, "UTC", limit=5).sql)
    totals = compiler.compile_totals(DATASET, d, TENANT, "UTC", [(), ("channel",)], limit=10)
    check("the totals leave such measures empty and still total the rest", totals.sql.count("NULL AS") == 4, totals.sql[:300])
    try:
        definition.validate(DATASET, {"columns": [{"field": "channel"}, {"field": "c_ytd", "aggregate": "calc"}], "derived": [{"label": "Ytd", "kind": "measure", "expression": "TOTALYTD(SUM([Sent Count]))"}]})
        check("a time function without a date in the report is refused", False)
    except DefinitionError as exc:
        check("a time function without a date in the report is refused", exc.field == "columns[1].field" and "need a date in the report" in str(exc), str(exc))
    try:
        definition.validate({**DATASET, "database": {"engine": "mysql57"}}, _monthly(("c_share", "CALCULATE(SUM([Sent Count]), ALL())")))
        check("MySQL 5.7 is refused (no window functions)", False)
    except DefinitionError as exc:
        check("MySQL 5.7 is refused (no window functions)", "MySQL 8" in str(exc))
    check.done()


def test_shared_formulas_in_the_catalogue(check):
    rows = {"messages": [
        {"id": "b0000000-0000-4000-8000-000000000001", "key": "f_open_share", "label": "Open Share", "kind": "measure", "expression": "DIVIDE(SUM([Sent Count]), COUNT([Channel])) * 100",
         "type": "number", "role": None, "format": "percent", "sensitivity": "NORMAL", "certified": True, "description": "Opens per send", "certified_by_name": "Aby", "row_version": 2},
        {"id": "b0000000-0000-4000-8000-000000000002", "key": "f_sent_bucket", "label": "Sent Bucket", "kind": "formula", "expression": "IF([Sent Count] >= 2, \"Many\", \"One\")",
         "type": "string", "role": "dimension", "format": None, "sensitivity": "NORMAL", "certified": False, "description": None, "certified_by_name": None, "row_version": 1},
        {"id": "b0000000-0000-4000-8000-000000000003", "key": "f_gone", "label": "Gone", "kind": "measure", "expression": "SUM([Missing Field])",
         "type": "number", "role": None, "format": None, "sensitivity": "NORMAL", "certified": False, "description": None, "certified_by_name": None, "row_version": 1}]}
    with mock.patch.object(dataset_formulas, "by_dataset", return_value=rows):
        dataset = dataset_formulas.attach([DATASET], TENANT, True)[0]
    shared = {f["key"]: f for f in dataset["fields"] if f.get("shared")}
    check("the catalogue offers shared formulas as fields of their kind, marked certified or not, plain data",
          shared["f_open_share"]["aggregates"] == ["calc"] and shared["f_open_share"]["shared"]["certified"] and shared["f_sent_bucket"]["role"] == "dimension"
          and dataset["formulas_version"] == "b0000000.2,b0000000.1,b0000000.1" and "checked" not in str(shared))
    worked = derived.materialize(dataset)
    check("worked out when a report compiles; one that no longer reads is left out", {f["key"] for f in worked["fields"] if f.get("shared")} == {"f_open_share", "f_sent_bucket"})
    d = definition.validate(dataset, {"columns": [{"field": "f_sent_bucket"}, {"field": "f_open_share", "aggregate": "calc"}, {"field": "c_twice", "aggregate": "calc"}],
                                      "derived": [{"label": "Twice", "kind": "measure", "expression": "[Open Share] * 2"}]})
    sql = compiler.compile(dataset, d, TENANT, "UTC", limit=10).sql
    check("a report uses them by key, and its own formulas by name", "CASE WHEN (\"sent_n\" >= 2) THEN 'Many' ELSE 'One' END" in sql
          and sql.count("sum(\"sent_n\")") == 2, sql[:300])
    check.done()


def _run(world, raw):
    response = world.api("post", "/api/v1/insights/reports/preview/", {"dataset": "attributed_orders", "definition": raw})
    return response.status_code, (response.json() if response.status_code in (200, 400, 422) else {})


def test_api(check, world):
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.report') IS NOT NULL")
        if not cursor.fetchone()[0]:
            pytest.skip("the Insights patches have not been applied to this database")
    base = {"columns": [{"field": "ordered_at", "bucket": "month"}, {"field": "channel"}, {"field": "amount", "aggregate": "sum"}],
            "orderBy": [{"field": "ordered_at", "direction": "asc"}], "limit": 200}
    status, plain = _run(world, base)
    check("the plain report runs", status == 200, str(plain)[:300])
    sums = {(str(r[0])[:10], r[1]): float(r[2] or 0) for r in plain.get("rows", [])}
    status, smart = _run(world, {**base, "columns": [*base["columns"], {"field": "c_share", "aggregate": "calc"}, {"field": "c_ytd", "aggregate": "calc"},
                                                     {"field": "c_ly", "aggregate": "calc"}, {"field": "c_prev", "aggregate": "calc"}],
                                 "derived": [{"label": "Share", "kind": "measure", "expression": "DIVIDE(SUM([Amount]), CALCULATE(SUM([Amount]), ALL([Channel]))) * 100"},
                                             {"label": "Ytd", "kind": "measure", "expression": "TOTALYTD(SUM([Amount]))"},
                                             {"label": "Ly", "kind": "measure", "expression": "SAMEPERIODLASTYEAR(SUM([Amount]))"},
                                             {"label": "Prev", "kind": "measure", "expression": "PREVIOUSPERIOD(SUM([Amount]))"}]})
    rows = smart.get("rows", [])
    check("the analytic report runs on the workspace's rows", status == 200 and rows and len(rows) == len(plain.get("rows", [])), str(smart)[:300])
    months: dict[str, float] = {}
    for r in rows:
        months[str(r[0])[:10]] = months.get(str(r[0])[:10], 0) + float(r[3] or 0)
    check("each month's shares across channels add up to 100", all(abs(v - 100) < 0.01 for v in months.values()), str(months)[:200])
    from datetime import date
    fine_ly, fine_prev, fine_ytd = True, True, True
    for r in rows:
        day, channel = date.fromisoformat(str(r[0])[:10]), r[1]
        year_ago = date(day.year - 1, day.month, 1).isoformat()
        prev = date(day.year - (day.month == 1), 12 if day.month == 1 else day.month - 1, 1).isoformat()
        fine_ly &= (r[5] is None and (year_ago, channel) not in sums) or (r[5] is not None and abs(float(r[5]) - sums[(year_ago, channel)]) < 0.01)
        fine_prev &= (r[6] is None and (prev, channel) not in sums) or (r[6] is not None and abs(float(r[6]) - sums[(prev, channel)]) < 0.01)
        ytd = sum(v for (m, c), v in sums.items() if c == channel and m[:4] == day.isoformat()[:4] and m <= day.isoformat())
        fine_ytd &= abs(float(r[4] or 0) - ytd) < 0.01
    check("last year, the period before and year to date match the plain report's months", fine_ly and fine_prev and fine_ytd)
    status, ranked = _run(world, {"columns": [{"field": "channel"}, {"field": "c_place", "aggregate": "calc"}, {"field": "amount", "aggregate": "sum"}],
                                  "derived": [{"label": "Place", "kind": "measure", "expression": "RANKX(SUM([Amount]))"}], "orderBy": [{"field": "amount", "direction": "desc"}]})
    places = [r[1] for r in ranked.get("rows", [])]
    check("RANKX numbers the rows from the largest", status == 200 and places == sorted(places), str(ranked)[:300])

    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.report_dataset_formula') IS NOT NULL")
        if not cursor.fetchone()[0]:
            check.done()
            pytest.skip("patch 0065 (shared formulas) has not been applied to this database")
    made = world.api("post", "/api/v1/insights/datasets/attributed_orders/formulas/", {"label": "Refund Share", "kind": "measure", "format": "percent",
                                                                                    "expression": "DIVIDE(-SUM([Amount], [Kind] = \"REFUND\"), SUM([Amount], [Kind] = \"ORDER\")) * 100"})
    body = made.json() if made.status_code == 201 else {}
    check("a shared formula is saved on the dataset with its key and type, not certified", made.status_code == 201 and body["key"] == "f_refund_share" and not body["certified"], made.content[:300])
    bad = world.api("post", "/api/v1/insights/datasets/attributed_orders/formulas/check/", {"field": {"label": "X", "kind": "measure", "expression": "SUM([Amount]"}}).json()
    check("the check as you type says what is wrong and where", bad["ok"] is False and bad["at"] == 0, str(bad))
    cat = world.api("get", "/api/v1/insights/catalog/attributed_orders/").json()
    check("the catalogue offers it", any(f["key"] == "f_refund_share" and f["shared"]["kind"] == "measure" for f in cat["fields"]))
    report = world.api("post", "/api/v1/insights/reports/", {"name": "Refund share by channel", "dataset": "attributed_orders", "definition": {
        "columns": [{"field": "channel"}, {"field": "f_refund_share", "aggregate": "calc"}]}})
    check("a report uses it", report.status_code == 201, report.content[:300])
    run = world.api("post", f"/api/v1/insights/reports/{report.json().get('id')}/run/", {})
    check("and runs", run.status_code == 200 and run.json()["columns"][1]["format"] == "percent", run.content[:300])
    fid = body.get("id")
    certified = world.api("post", f"/api/v1/insights/datasets/attributed_orders/formulas/{fid}/certify/", {"certified": True})
    check("a report administrator certifies it", certified.status_code == 200 and certified.json()["certified"] and certified.json()["reports"] == 1, certified.content[:300])
    gone = world.api("delete", f"/api/v1/insights/datasets/attributed_orders/formulas/{fid}/")
    check("a formula a report uses cannot be removed", gone.status_code == 409, gone.content[:200])
    renamed = world.api("put", f"/api/v1/insights/datasets/attributed_orders/formulas/{fid}/", {"label": "Refund Rate Shared", "row_version": certified.json()["row_version"]})
    check("renaming one a report uses asks for confirmation", renamed.status_code == 409, renamed.content[:200])
    listed = world.api("get", "/api/v1/insights/datasets/attributed_orders/formulas/").json()
    check("the list shows it certified, with its report", any(f["id"] == fid and f["certified"] and f["reports"] == 1 for f in listed["formulas"]) and listed["can_certify"])
    check.done()
