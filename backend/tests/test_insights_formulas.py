"""Insights' formula language (apps/insights/formula.py): the text read and checked (types, the measure rules, errors with their
place), the SQL in each dialect, formulas as a report's custom fields through the definition, the compiler and the totals, and
the API: the check as you type, and a report with a formula column and a measure formula run on the workspace's rows."""
import pytest
from django.db import connections

from apps.insights import compiler, definition, formula
from apps.insights.definition import DefinitionError

from .test_insights import DATASET, P

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
TENANT = "a0000000-0000-4000-8000-000000000001"


def _error(text: str, measure: bool = False) -> tuple[str, int | None]:
    try:
        formula.check(text, DATASET, measure=measure)
    except formula.FormulaError as exc:
        return str(exc), exc.at
    return "", None


def _sql(text: str, dialect: str = "postgresql", measure: bool = False) -> str:
    checked = formula.check(text, DATASET, measure=measure)
    return formula.render(checked.ast, dialect, lambda key: f'"{key}"', agg=lambda call: formula.aggregate_sql(call, formula.operand_sql(call, dialect, lambda key: f'"{key}"')))


def test_reading_and_checking(check):
    check("fields by label or key, in any case; arithmetic, text and logic keep their types",
          formula.check("[sent count] * 2", DATASET, measure=False).type == "number" and formula.check("[sent] = TODAY()", DATASET, measure=False).type == "boolean"
          and formula.check("UPPER([campaign_name])", DATASET, measure=False).type == "string"
          and formula.check("[channel] & \" / \" & [Campaign]", DATASET, measure=False).type == "string"
          and formula.check("IF([Sent Count] >= 500 AND NOT ISBLANK([Channel]), \"Big\", \"Small\")", DATASET, measure=False).type == "string"
          and formula.check("DATEADD([Sent], 30, \"day\")", DATASET, measure=False).type == "datetime")
    check("a measure formula: aggregates, conditions, a calculated measure of the catalogue inlined",
          formula.check("DIVIDE(SUM([Sent Count], [Channel] = 'EMAIL'), SUM([Sent Count])) * 100", DATASET, measure=True).type == "number"
          and len(formula.check("COUNTROWS([Channel] = \"SMS\") / COUNTROWS()", DATASET, measure=True).calls) == 2
          and formula.check("MAX([Sent])", DATASET, measure=True).type == "datetime")
    check("reading personal data makes the formula personal", formula.check("LEN([Customer])", DATASET, measure=False).personal)
    for text, measure, words, at in (
            ("[Sent Count] +", False, "ends too soon", 14),
            ("[Sent Count] * (2", False, "bracket opened here", 15),
            ("\"open", False, "closing quote", 0),
            ("[Nope] * 2", False, "no field called [Nope]", 0),
            ("\"a\" + 1", False, "join text with &", 4),
            ("[Channel] = 1", False, "compares text with a number", 10),
            ("SUM([Sent Count])", False, "use it in a measure formula", 0),
            ("[Sent Count] * 2", True, "Put [Sent Count] inside SUM", 0),
            ("SUM(SUM([Sent Count]))", True, "cannot go inside SUM", 4),
            ("ROUND([Sent Count], 2.5)", False, "whole number from 0 to 10", 20),
            ("DATEDIFF([Sent], TODAY(), \"week\")", False, '"day", "month" or "year"', 25),
            ("FOO([Sent Count])", False, "not a function", 0),
            ("IF([Channel] = \"SMS\", 1, \"x\")", False, "different kinds", 0),
            ("[Channel] = BLANK", False, "ISBLANK", 10),
            ("COUNTROWS() & \"x\"", True, "works out a number", 0)):
        message, place = _error(text, measure)
        check(f"refused with its place: {text}", words in message and place == at, f"{message} at {place}")


def test_sql_in_each_dialect(check):
    check("PostgreSQL: a division never fails, a condition narrows an aggregate, text joins with CONCAT",
          _sql("[Sent Count] / 0") == '(("sent") * 1.0 / NULLIF((0), 0))'
          and _sql("SUM([Sent Count], [Channel] = \"EMAIL\")", measure=True) == "sum((CASE WHEN (\"channel\" = 'EMAIL') THEN \"sent\" END))"
          and _sql("[Channel] & \"!\"") == "CONCAT(\"channel\", '!')")
    with_zone = formula.ZONE.set("America/New_York")
    check("a date's year is read in the workspace's zone, in each dialect's words",
          _sql("YEAR([Sent])") == "CAST(EXTRACT(YEAR FROM (\"submitted_at\" AT TIME ZONE 'America/New_York')) AS int)"
          and _sql("YEAR([Sent])", "clickhouse") == "toYear(toTimeZone(\"submitted_at\", 'America/New_York'))"
          and _sql("YEAR([Sent])", "mysql") == "YEAR(\"submitted_at\")")
    formula.ZONE.reset(with_zone)
    check("a quote and a percent sign in text are escaped for the dialect", _sql("[Channel] = \"50% o'clock\"") == "(\"channel\" = '50%% o''clock')"
          and _sql("[Channel] = \"50% o'clock\"", "clickhouse") == "(\"channel\" = '50% o''clock')")
    check("rounding casts for PostgreSQL; text functions take their dialect's names",
          _sql("ROUND([Sent Count], 1)") == 'ROUND(CAST("sent" AS numeric), 1)' and _sql("UPPER([Channel])", "clickhouse") == 'upperUTF8("channel")'
          and _sql("CONTAINS([Campaign], \"fall\")", "mysql") == "(LOCATE(LOWER('fall'), LOWER(\"campaign_name\")) > 0)")
    check.done()


def test_formulas_as_custom_fields(check):
    raw = {"columns": [{"field": "c_size"}, {"field": "c_email_share", "aggregate": "calc"}, {"field": "c_doubled", "aggregate": "sum"}],
           "derived": [{"label": "Size", "kind": "formula", "expression": "IF([Sent Count] >= 1000, \"Large\", \"Small\")"},
                       {"label": "Doubled", "kind": "formula", "expression": "[Sent Count] * 2", "format": "integer"},
                       {"label": "Email Share", "kind": "measure", "expression": "DIVIDE(SUM([Sent Count], [Channel] = \"EMAIL\"), SUM([Sent Count])) * 100", "format": "percent"}],
           "filters": {"combinator": "and", "rules": [{"field": "c_size", "operator": "=", "value": "Large"}]}}
    d = definition.validate(DATASET, raw)
    kinds = {s["key"]: (s["kind"], s["type"], s.get("role"), s.get("format")) for s in d["derived"]}
    check("each formula is saved with its type and use", kinds == {"c_size": ("formula", "string", "dimension", None), "c_doubled": ("formula", "number", "measure", "integer"),
                                                                     "c_email_share": ("measure", "number", None, "percent")}, str(kinds))
    c = compiler.compile(DATASET, d, TENANT, "UTC", limit=10)
    check("the compiler writes the formula column as the group, the filter on it, and the measure formula over the group",
          "CASE WHEN (\"sent_n\" >= 1000) THEN 'Large' ELSE 'Small' END" in c.sql and "sum((\"sent_n\" * 2))" in c.sql
          and "sum((CASE WHEN (\"channel\" = 'EMAIL') THEN \"sent_n\" END))" in c.sql and " GROUP BY 1" in c.sql and c.sql.count("%s") == len(c.params), c.sql)
    check("the result's columns carry the formula's format", [col.get("format") for col in c.columns] == [None, "percent", "integer"])
    totals = compiler.compile_totals(DATASET, d, TENANT, "UTC", [(), ("c_size",)], limit=10)
    check("the totals read each aggregate's value once in the subquery", 'AS "m0_0"' in totals.sql and 'AS "m0_1"' in totals.sql and 'AS "m1"' in totals.sql
          and totals.sql.count("%s") == len(totals.params), totals.sql)
    chained = definition.validate(DATASET, {"columns": [{"field": "c_twice"}], "derived": [
        {"label": "Base", "kind": "formula", "expression": "[Sent Count] + 1", "role": "dimension"}, {"label": "Twice", "kind": "formula", "expression": "[Base] * 2", "role": "dimension"}]})
    check("a formula reads the formulas before it", "((\"sent_n\" + 1) * 2)" in compiler.compile(DATASET, chained, TENANT, "UTC", limit=5).sql)
    for bad, where in (({"label": "Later", "kind": "formula", "expression": "[After] * 2"}, "derived[0].expression"),
                       ({"label": "Text Measure", "kind": "formula", "expression": "[Channel]", "role": "measure"}, "derived[0].role"),
                       ({"label": "Rate", "kind": "measure", "expression": "SUM([Sent Count])", "format": "money!"}, "derived[0].format")):
        try:
            definition.validate(DATASET, {"columns": [{"field": "channel"}], "derived": [bad]})
            check(f"refused under {where}", False)
        except DefinitionError as exc:
            check(f"refused under {where}", exc.field == where, f"{exc.field}: {exc}")
    check.done()


def test_api(check, world):
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.report') IS NOT NULL")
        if not cursor.fetchone()[0]:
            pytest.skip("the Insights patches have not been applied to this database")
    ok = world.api("post", "/api/v1/insights/formulas/check/", {"dataset": "messages", "derived": [], "field": {"label": "Email Share", "kind": "measure",
                                                                                                              "expression": "DIVIDE(SUM([Sent Count], [Channel] = \"EMAIL\"), SUM([Sent Count])) * 100"}})
    body = ok.json() if ok.status_code == 200 else {}
    check("the check gives the field as it would be saved, its use and the fields it reads", ok.status_code == 200 and body["ok"] and body["spec"]["type"] == "number"
          and body["role"] == "measure" and sorted(body["uses"]) == ["Channel", "Sent Count"], ok.content[:300])
    bad = world.api("post", "/api/v1/insights/formulas/check/", {"dataset": "messages", "derived": [], "field": {"label": "Bad", "kind": "formula", "expression": "[Sent Count] *"}}).json()
    check("a formula that does not read says why and where", bad["ok"] is False and bad["at"] == 14 and bad["where"] == "expression", str(bad))
    draft = {"dataset": "messages", "definition": {
        "columns": [{"field": "c_kind"}, {"field": "messages", "aggregate": "count"}, {"field": "c_email_share", "aggregate": "calc"}, {"field": "c_sent_twice", "aggregate": "sum"}],
        "derived": [{"label": "Kind", "kind": "formula", "expression": "IF([Channel] = \"EMAIL\", \"Email\", \"Other\")"},
                    {"label": "Sent Twice", "kind": "formula", "expression": "COALESCE([Sent Count], 0) * 2"},
                    {"label": "Email Share", "kind": "measure", "expression": "DIVIDE(SUM([Sent Count], [Channel] = \"EMAIL\"), SUM([Sent Count])) * 100", "format": "percent"}],
        "orderBy": [{"field": "c_kind", "direction": "asc"}]}, "view": {"type": "pivot"}}
    run = world.api("post", "/api/v1/insights/reports/preview/", draft)
    rows = run.json() if run.status_code == 200 else {}
    check("a report with a formula column and a measure formula runs on the workspace's rows", run.status_code == 200
          and [c["label"] for c in rows["columns"]] == ["Kind", "Messages", "Email Share", "Sent Twice"] and rows["columns"][2]["format"] == "percent"
          and all(r[0] in ("Email", "Other") for r in rows["rows"]) and all(r[2] is None or 0 <= float(r[2]) <= 100 for r in rows["rows"]), run.content[:400])
    check.done()
