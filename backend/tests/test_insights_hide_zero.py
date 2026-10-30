"""Insights' hideZero: a grouped report leaves out the lines where every measure it names totals zero or nothing. The
definition checks the names; the compiler writes HAVING on the grouped query in each dialect (and a WHERE on the last level
of a measure formula's query); the totals, the comparisons' earlier rows and a dashboard's one figure stay as they were."""
import pytest

from apps.insights import ai_report, compiler, definition, drill, runner
from apps.insights.definition import DefinitionError

from .test_insights import DATASET

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
TENANT = "a0000000-0000-4000-8000-000000000001"
BALANCE = {"columns": [{"field": "channel"}, {"field": "campaign_name"}, {"field": "sent", "aggregate": "sum"}, {"field": "messages", "aggregate": "count"}],
           "orderBy": [{"field": "channel", "direction": "asc"}]}


def _refusal(raw) -> str:
    try:
        definition.validate(DATASET, raw)
    except DefinitionError as exc:
        return exc.field
    return ""


def test_the_definition(check):
    d = definition.validate(DATASET, {**BALANCE, "hideZero": ["sent", "sent"]})
    check("a measure of a grouped report is accepted, each once", d["hideZero"] == ["sent"], str(d.get("hideZero")))
    check("none, or an empty list, leaves the key out", "hideZero" not in definition.validate(DATASET, BALANCE)
          and "hideZero" not in definition.validate(DATASET, {**BALANCE, "hideZero": []}))
    check("what is not a list of names is refused", _refusal({**BALANCE, "hideZero": "sent"}) == "hideZero" and _refusal({**BALANCE, "hideZero": [1]}) == "hideZero")
    check("a dimension, or a field the report does not total, is refused at its place",
          _refusal({**BALANCE, "hideZero": ["sent", "channel"]}) == "hideZero[1]" and _refusal({**BALANCE, "hideZero": ["party_id"]}) == "hideZero[0]")
    check("a report of measures alone has one line, nothing to hide",
          _refusal({"columns": [{"field": "sent", "aggregate": "sum"}], "hideZero": ["sent"]}) == "hideZero")
    check.done()


def test_the_compiled_sql(check):
    d = definition.validate(DATASET, {**BALANCE, "hideZero": ["sent"]})
    plain = compiler.compile(DATASET, definition.validate(DATASET, BALANCE), TENANT, "UTC", limit=51)
    pg = compiler.compile(DATASET, d, TENANT, "UTC", limit=51)
    check("PostgreSQL: HAVING on the aggregate itself, after the group and before the order",
          ' GROUP BY 1, 2 HAVING ((sum("sent_n")) <> 0) ORDER BY "c0" ASC NULLS LAST' in pg.sql, pg.sql)
    check("PostgreSQL: no placeholder added, the values the same", pg.sql.count("%s") == len(pg.params) and pg.params == plain.params and "HAVING" not in plain.sql)
    my = compiler.compile(DATASET, d, TENANT, "UTC", limit=51, dialect="mysql")
    check("MySQL: the same with backticks", " GROUP BY 1, 2 HAVING ((sum(`sent_n`)) <> 0) ORDER BY `c0` IS NULL" in my.sql and my.sql.count("%s") == len(my.params), my.sql)
    ch = compiler.compile(DATASET, d, TENANT, "UTC", limit=51, dialect="clickhouse")
    check("ClickHouse: the same, the typed placeholders untouched",
          ' GROUP BY 1, 2 HAVING ((sum("sent_n")) <> 0) ORDER BY "c0" ASC NULLS LAST' in ch.sql and set(ch.params) == {"p0", "p1", "p2"}, ch.sql)
    both = compiler.compile(DATASET, definition.validate(DATASET, {**BALANCE, "hideZero": ["sent", "messages"]}), TENANT, "UTC", limit=51)
    check("two measures: a line is kept while either is non-zero", 'HAVING ((sum("sent_n")) <> 0 OR (count("message_id")) <> 0)' in both.sql, both.sql)
    for dialect in ("postgresql", "mysql", "clickhouse"):
        sets = [(), ("channel",)]
        same = compiler.compile_totals(DATASET, d, TENANT, "UTC", sets, limit=10, dialect=dialect)
        before = compiler.compile_totals(DATASET, definition.validate(DATASET, BALANCE), TENANT, "UTC", sets, limit=10, dialect=dialect)
        check(f"{dialect}: the totals are the same query with or without it" + (" (one query per set, UNION ALL)" if dialect == "mysql" else ""),
              same.sql == before.sql and same.params == before.params and "HAVING" not in same.sql)
    check.done()


def test_a_measure_formula(check):
    raw = {"columns": [{"field": "channel"}, {"field": "sent", "aggregate": "sum"}, {"field": "c_share", "aggregate": "calc"}],
           "derived": [{"key": "c_share", "label": "Share", "kind": "measure", "expression": "DIVIDE(SUM([Sent Count]), CALCULATE(SUM([Sent Count]), ALL([Channel])))"}],
           "hideZero": ["sent", "c_share"]}
    d = definition.validate(DATASET, raw)
    for dialect in ("postgresql", "mysql", "clickhouse"):
        c = compiler.compile(DATASET, d, TENANT, "UTC", limit=20, dialect=dialect)
        q = (lambda name: f"`{name}`") if dialect == "mysql" else (lambda name: f'"{name}"')
        check(f"{dialect}: worked out over the grouped rows, the zero lines go at the last level",
              f" WHERE (({q('w')}.{q('c1')}) <> 0 OR ({q('w')}.{q('c2')}) <> 0) ORDER BY" in c.sql and "HAVING" not in c.sql, c.sql[-300:])
    check.done()


def test_carried_and_left_out(check):
    d = definition.validate(DATASET, {**BALANCE, "hideZero": ["sent"], "view": {"type": "hierarchy"}})
    below = drill.drilled(DATASET, d, [{"field": "channel", "value": "EMAIL"}])
    check("a drill-down level keeps the measures, and their hidden zero lines", below is not None and below.get("hideZero") == ["sent"]
          and definition.validate(DATASET, below)["hideZero"] == ["sent"], str(below))
    check("a comparison's earlier rows keep every line", "hideZero" not in runner._every_line(d) and runner._every_line(d)["columns"] == d["columns"])
    reply = {"kind": "draft", "definition": {"columns": [{"field": "channel"}, {"field": "sent", "aggregate": "sum"}]}}
    changed = ai_report._changed(reply, DATASET, {k: v for k, v in d.items() if k in ("columns", "filters", "orderBy", "view", "hideZero")}, 100)
    check("a change with a prompt keeps it for the measures it keeps", changed["definition"].get("hideZero") == ["sent"], str(changed["definition"]))
    gone = ai_report._changed({"kind": "draft", "definition": {"columns": [{"field": "channel"}, {"field": "messages", "aggregate": "count"}]}}, DATASET, {"hideZero": ["sent"], "columns": d["columns"]}, 100)
    check("and drops it with the measure", "hideZero" not in gone["definition"])
    check.done()
