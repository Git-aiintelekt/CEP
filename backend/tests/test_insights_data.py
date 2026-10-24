"""Insights: fiscal calendars, report parameters and uploaded files. The arithmetic, the definition and the SQL first; then the API
(the fiscal year, a report that asks before it runs, and, once patch 0063 is applied, a CSV and an Excel file as datasets)."""
import io
import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from django.db import connections

from apps.insights import compare, compiler, dashboards, definition, drill, excel, fiscal, parameters, pdf, uploads
from apps.insights.definition import DefinitionError

from .test_insights import DATASET, P

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
TENANT = "a0000000-0000-4000-8000-000000000001"
FISCAL = {**DATASET, "fields": [{**f, "buckets": [*f["buckets"], "fiscal_quarter", "fiscal_year"],
                                 "operators": [*f["operators"], *fiscal.OPERATORS]} if f["type"] == "datetime" else f for f in DATASET["fields"]]}


def _refused(dataset, raw, where) -> bool:
    try:
        definition.validate(dataset, raw)
    except DefinitionError as exc:
        return exc.field.startswith(where)
    return False


def test_fiscal_calendar(check):
    april = {"start": 4, "named_by": "end"}
    check("a fiscal year from April is named by the year it ends in, its quarters counted from April",
          fiscal.name(date(2026, 4, 1), "fiscal_year", april) == "FY2027" and fiscal.name(date(2026, 4, 1), "fiscal_quarter", april) == "FY2027 Q1"
          and fiscal.name(date(2027, 1, 1), "fiscal_quarter", april) == "FY2027 Q4" and fiscal.name(date(2026, 4, 1), "fiscal_year", {"start": 4, "named_by": "start"}) == "FY2026"
          and fiscal.name(date(2026, 1, 1), "fiscal_quarter", {"start": 1, "named_by": "end"}) == "FY2026 Q1")
    check("this and last fiscal quarter and year, from a July year",
          fiscal.span("this_fiscal_year", date(2026, 2, 1), 7) == (date(2025, 7, 1), date(2026, 6, 30))
          and fiscal.span("last_fiscal_year", date(2026, 2, 1), 7) == (date(2024, 7, 1), date(2025, 6, 30))
          and fiscal.span("this_fiscal_quarter", date(2026, 10, 19), 4) == (date(2026, 10, 1), date(2026, 12, 31))
          and fiscal.span("last_fiscal_quarter", date(2026, 10, 19), 4) == (date(2026, 7, 1), date(2026, 9, 30)))
    raw = {"columns": [{"field": "submitted_at", "bucket": "fiscal_quarter"}, {"field": "sent", "aggregate": "sum", "compare": ["year_to_date"]}],
           "filters": {"combinator": "and", "rules": [{"field": "submitted_at", "operator": "this_fiscal_year"}]}}
    d = definition.validate(FISCAL, raw)
    check("a definition takes a fiscal bucket and a fiscal period filter, which has no value", d["columns"][0]["bucket"] == "fiscal_quarter" and d["filters"]["rules"][0] == {"field": "submitted_at", "operator": "this_fiscal_year", "value": None})
    check("a bucket that is not one is refused", _refused(FISCAL, {"columns": [{"field": "submitted_at", "bucket": "fiscal_month"}]}, "columns[0].bucket"))
    ready = fiscal.prepare(d, april, date(2026, 10, 19))
    check("before the query the fiscal filter becomes the year's dates, and the start rides along (the cache tells years apart)",
          ready["filters"]["rules"][0] == {"field": "submitted_at", "operator": "between", "value": ["2026-04-01", "2027-03-31"]} and ready["_fiscal"] == 4)
    check("a definition without a fiscal part is left as it is", fiscal.prepare(definition.validate(DATASET, {"columns": [{"field": "channel"}]}), april, date(2026, 10, 19)).get("_fiscal") is None)
    c = compiler.compile(FISCAL, ready, TENANT, "America/New_York", limit=10)
    check("the SQL moves the date back by the start, truncates to the quarter, moves it on; every value bound in order",
          "(date_trunc(%s, (\"submitted_at\" AT TIME ZONE %s) - make_interval(months => %s)) + make_interval(months => %s))::date" in c.sql
          and c.params[:4] == ["quarter", "America/New_York", 3, 3] and c.sql.count("%s") == len(c.params), c.sql)
    mysql = compiler.compile(FISCAL, ready, TENANT, "UTC", limit=10, dialect="mysql")
    house = compiler.compile(FISCAL, ready, TENANT, "UTC", limit=10, dialect="clickhouse")
    check("MySQL and ClickHouse have their own fiscal arithmetic", "DATE_SUB(DATE(" in mysql.sql and "INTERVAL 3 MONTH" in mysql.sql and "addMonths(date_trunc('quarter'" in house.sql, mysql.sql[:300])
    check("year and quarter to date start at the fiscal year's start", compare.period_start(date(2026, 10, 19), "year_to_date", 4) == date(2026, 4, 1)
          and compare.period_start(date(2026, 2, 19), "year_to_date", 4) == date(2025, 4, 1) and compare.period_start(date(2026, 11, 19), "quarter_to_date", 4) == date(2026, 10, 1)
          and compare.period_start(date(2026, 11, 19), "quarter_to_date") == date(2026, 10, 1))
    check("a fiscal year drills to its quarters, then months; a fiscal year ends a year after it starts",
          drill.CHAIN["fiscal_year"] == ["fiscal_year", "fiscal_quarter", "month", "day"] and drill.bucket_end(date(2026, 4, 1), "fiscal_year") == date(2027, 3, 31)
          and drill.bucket_end(date(2026, 4, 1), "fiscal_quarter") == date(2026, 6, 30))
    check("a dashboard can show this fiscal quarter or year to date", dashboards.period_bounds({"preset": "fyear"}, date(2026, 10, 19), 4)["from"] == "2026-04-01"
          and dashboards.period_bounds({"preset": "fquarter"}, date(2026, 10, 19), 4)["from"] == "2026-10-01" and dashboards._period({"preset": "fyear"}) == {"preset": "fyear"})
    column = {"key": "submitted_at", "label": "Sent", "type": "date", "bucket": "fiscal_quarter", "fiscal": april}
    check("the PDF and the workbook name a fiscal quarter as the workspace does", pdf._date_words(column, "2026-07-01") == "FY2027 Q2" and excel._value(column, "2026-07-01") == "FY2027 Q2")
    check.done()


def test_parameters(check):
    asked = [{"key": "channel", "label": "Channel", "field": "channel", "operator": "in", "required": True},
             {"key": "since", "field": "submitted_at", "operator": ">=", "default": "2026-09-01"}]
    raw = {"columns": [{"field": "campaign_name"}, {"field": "sent", "aggregate": "sum"}], "filters": {"combinator": "and", "rules": [{"field": "campaign_name", "operator": "contains", "value": "Fall"}]},
           "parameters": asked}
    d = definition.validate(DATASET, raw)
    check("a definition keeps its parameters, a missing label taken from the field", [p["key"] for p in d["parameters"]] == ["channel", "since"] and d["parameters"][1]["label"] == "Sent"
          and d["parameters"][1]["default"] == "2026-09-01" and d["parameters"][0]["required"] is True)
    for bad, where, why in (([{**asked[0], "key": "Channel!"}], "parameters[0].key", "a key that is not lower-case"),
                            ([asked[0], {**asked[0], "label": "Again"}], "parameters[1].key", "two with one key"),
                            ([{**asked[0], "operator": "contains"}], "parameters[0].operator", "an operator a parameter does not take"),
                            ([{**asked[1], "default": "soon"}], "parameters[0].default", "a default that is not a date"),
                            ([{**asked[0], "key": f"k{i}", "field": f} for i, f in enumerate(["channel", "campaign_name", "submitted_at", "party_id", "sent", "messages"])], "parameters", "more than five")):
        check(f"{why} is refused", _refused(DATASET, {**raw, "parameters": bad}, where))
    check("the viewer insists on a required answer", _raises(lambda: parameters.require(d, {}), "Choose Channel first.") and parameters.require(d, {"channel": ["SMS"]}) is None)
    bound = parameters.bind(DATASET, d, {"channel": ["SMS", "EMAIL"]})
    check("the answers, and the defaults where none was given, are and-ed onto the report's own filters",
          bound["filters"]["rules"][1:] == [{"field": "channel", "operator": "in", "value": ["SMS", "EMAIL"]}, {"field": "submitted_at", "operator": ">=", "value": "2026-09-01"}]
          and bound["_params"] == {"channel": ["SMS", "EMAIL"], "since": "2026-09-01"} and parameters.words(bound)[0] == {"key": "channel", "label": "Channel", "value": ["SMS", "EMAIL"]})
    alone = parameters.bind(DATASET, d, None)
    check("run by itself (a tile, a schedule), a parameter with no default leaves its rule out", [r["field"] for r in alone["filters"]["rules"]] == ["campaign_name", "submitted_at"])
    single = parameters.bind(DATASET, d, {"channel": "SMS"})
    check("one answer to an is-one-of question is a list of one", single["filters"]["rules"][1]["value"] == ["SMS"])
    either = definition.validate(DATASET, {**raw, "filters": {"combinator": "or", "rules": [{"field": "channel", "operator": "=", "value": "SMS"}, {"field": "channel", "operator": "=", "value": "EMAIL"}]}})
    wrapped = parameters.bind(DATASET, either, {"channel": ["SMS"]})
    check("an or-ed report keeps its own group whole under the answers", wrapped["filters"]["combinator"] == "and" and wrapped["filters"]["rules"][0]["combinator"] == "or")
    check("an answer that does not fit the field is refused by name", _raises(lambda: parameters.bind(DATASET, d, {"channel": ["SMS"], "since": "soon"}), "Sent: Give a date"))
    c = compiler.compile(DATASET, bound, TENANT, "UTC", limit=10)
    check("the answers reach the SQL as bound values", ["SMS", "EMAIL"] in c.params and c.sql.count("%s") == len(c.params))
    check.done()


def _raises(fn, words: str) -> bool:
    try:
        fn()
    except parameters.ParameterError as exc:
        return words in str(exc)
    return False


def _xlsx(rows) -> bytes:
    import openpyxl
    book = openpyxl.Workbook()
    for row in rows:
        book.active.append(row)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def test_reading_files(check):
    kind, names, rows = uploads.read_file("stores.csv", "Store;Sales;Opened;Active;Last Visit;Code\nDowntown;\"1.234,5\";19/10/2026;true;2026-10-19 08:30;007\nMall;12;03/04/2026;false;2026-10-18 17:00;12\n;;;;;\n".encode("cp1252"))
    columns = uploads.columns_of(names, rows)
    check("a semicolon CSV in Windows text: its columns and their types read from the values; empty rows left out", kind == "csv" and len(rows) == 2
          and [(c["key"], c["type"], c["role"]) for c in columns] == [("store", "string", "dimension"), ("sales", "number", "measure"), ("opened", "date", "dimension"),
                                                                       ("active", "boolean", "dimension"), ("last_visit", "datetime", "dimension"), ("code", "string", "dimension")], str(columns))
    stored = uploads.encoded(columns, rows, ZoneInfo("America/Chicago"))
    check("stored: a decimal comma read, 19/10 as the 19th (so 03/04 is 3 April), a local time as UTC, a code's leading zeros kept",
          stored[0] == {"c1": "Downtown", "c2": 1234.5, "c3": "2026-10-19", "c4": True, "c5": "2026-10-19T13:30:00+00:00", "c6": "007"} and stored[1]["c3"] == "2026-04-03", str(stored))
    _, names2, rows2 = uploads.read_file("a.csv", b"Region,Revenue,Date,Revenue\nNorth,\"1,234.50\",10/19/2026,1\nSouth,$12,03/04/2026,2\nEast,(3),,3\n")
    c2 = uploads.columns_of(names2, rows2)
    check("1,234.50, $12 and (3) are numbers; 10/19 puts the month first; a repeated header gets a number", [c["label"] for c in c2] == ["Region", "Revenue", "Date", "Revenue 2"]
          and uploads.encoded(c2, rows2, ZoneInfo("UTC"))[2] == {"c1": "East", "c2": -3, "c4": 3} and uploads.encoded(c2, rows2, ZoneInfo("UTC"))[1]["c3"] == "2026-03-04")
    kind, names3, rows3 = uploads.read_file("x.xlsx", _xlsx([["Name", "When", "Amount", None], ["a", datetime(2026, 1, 2), 3.5, None], ["b", datetime(2026, 1, 3, 10, 0), 4, None]]))
    c3 = uploads.columns_of(names3, rows3)
    check("an Excel sheet: its own dates and numbers, an empty last column left out", kind == "xlsx" and [(c["key"], c["type"]) for c in c3] == [("name", "string"), ("when", "datetime"), ("amount", "number")])
    for name, data, words in (("old.xls", b"x", "older Excel file"), ("a.pdf", b"x", "Upload a .csv or an .xlsx"), ("e.csv", b"A,B\n", "no rows under it"),
                              ("w.csv", (",".join(f"c{i}" for i in range(51)) + "\n" + ",".join("1" for _ in range(51)) + "\n").encode(), "51 columns")):
        try:
            uploads.read_file(name, data)
            check(f"{words}: refused", False)
        except uploads.FileError as exc:
            check(f"{words}: refused", words in str(exc), str(exc))
    numbers = [c for c in c2 if c["key"] == "revenue"]
    try:
        uploads.encoded(numbers, [["lots"]], ZoneInfo("UTC"))
        check("a replacement's cell that does not fit is named by row and column", False)
    except uploads.FileError as exc:
        check("a replacement's cell that does not fit is named by row and column", str(exc) == "Row 2, Revenue: not a number.", str(exc))
    row = {"id": "b0000000-0000-4000-8000-000000000002", "key": "upl_regions", "name": "Regions", "description": None, "file_name": "a.csv", "columns": c2, "row_count": 3,
           "created_at": datetime(2026, 10, 19), "replaced_at": None, "row_version": 1}
    dataset = uploads.dataset_of(row)
    d = definition.validate(dataset, {"columns": [{"field": "region"}, {"field": "revenue", "aggregate": "sum"}, {"field": "rows", "aggregate": "count"}],
                                      "filters": {"combinator": "and", "rules": [{"field": "date", "operator": "last_days", "value": 30}]}})
    sql = compiler.compile(dataset, d, TENANT, "UTC", limit=10).sql
    check("the file is a dataset: its rows cast by type in a subquery, the workspace restricted, Rows a count", dataset["time_field"] == "date"
          and "(r.data->>'c2')::numeric AS c2" in sql and "WHERE r.upload_id = 'b0000000-0000-4000-8000-000000000002'" in sql and '"tenant_id" = %s' in sql and 'count("t0"."row_no")' in sql, sql)
    check.done()


def _upload_tables() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.report_upload') IS NOT NULL")
        return cursor.fetchone()[0]


def test_api(check, world, admin_email):
    from django.test import Client
    from rest_framework_simplejwt.tokens import AccessToken

    from apps.identity.models import AppUser
    from apps.tenants import context
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.report') IS NOT NULL")
        if not cursor.fetchone()[0]:
            pytest.skip("the Insights patches have not been applied to this database")
    year = world.api("get", "/api/v1/workspace/fiscal-year/")
    check("the fiscal year starts in January until it is set", year.status_code == 200 and year.json()["start"] == 1 and year.json()["months"][3] == "April", year.content[:200])
    bad = world.api("put", "/api/v1/workspace/fiscal-year/", {"start": 13})
    check("a month that is not one is refused", bad.status_code == 400 and "start" in bad.json()["errors"], bad.content[:200])
    put = world.api("put", "/api/v1/workspace/fiscal-year/", {"start": 4, "named_by": "end"})
    check("the administrator sets an April year", put.status_code == 200 and put.json()["start"] == 4, put.content[:200])
    cat = world.api("get", "/api/v1/insights/catalog/messages/").json()
    sent = next(f for f in cat["fields"] if f["key"] == "submitted_at")
    check("the catalogue then offers fiscal quarters and years, and the fiscal period filters", sent["buckets"][-2:] == ["fiscal_quarter", "fiscal_year"] and "this_fiscal_year" in sent["operators"], str(sent["buckets"]))
    preview = world.api("post", "/api/v1/insights/reports/preview/", {"dataset": "messages", "definition": {
        "columns": [{"field": "submitted_at", "bucket": "fiscal_quarter"}, {"field": "messages", "aggregate": "count"}],
        "filters": {"combinator": "and", "rules": [{"field": "submitted_at", "operator": "last_fiscal_year"}]}}})
    body = preview.json() if preview.status_code == 200 else {}
    check("a report by fiscal quarter runs, its column carrying how the workspace names the year", preview.status_code == 200 and body["columns"][0]["fiscal"] == {"start": 4, "named_by": "end"}
          and all(str(r[0])[5:7] in ("01", "04", "07", "10") for r in body["rows"]), preview.content[:300])
    board = world.api("post", "/api/v1/insights/dashboards/", {"name": "Fiscal", "period": {"preset": "fyear"}})
    check("a dashboard's period can be this fiscal year to date", board.status_code == 201 and board.json()["bounds"]["from"][5:] == "04-01", board.content[:200])

    made = world.api("post", "/api/v1/insights/reports/", {"name": "Sends by campaign, asked", "dataset": "messages", "definition": {
        "columns": [{"field": "campaign_name"}, {"field": "messages", "aggregate": "count"}],
        "parameters": [{"key": "channel", "label": "Channel", "field": "channel", "operator": "in", "required": True}]}})
    rid = made.json().get("id") if made.status_code == 201 else None
    check("a report with a question is saved with it", made.status_code == 201, made.content[:300])
    unanswered = world.api("post", f"/api/v1/insights/reports/{rid}/run/", {"limit": 10})
    check("run without the answer, the report asks for it", unanswered.status_code == 422 and unanswered.json()["outcome"] == "PARAMETERS" and unanswered.json()["detail"] == "Choose Channel first."
          and unanswered.json()["parameter"] == "channel", unanswered.content[:300])
    answered = world.api("post", f"/api/v1/insights/reports/{rid}/run/", {"limit": 10, "params": {"channel": ["EMAIL"]}})
    said = answered.json().get("parameters", []) if answered.status_code == 200 else []
    check("answered, it runs and says what it was asked: Campaign (the latest, when one was sent in the period), its own Channel question, Period (7 days)",
          {"key": "channel", "label": "Channel", "value": ["EMAIL"]} in said and {"key": "period", "label": "Period", "value": "7d"} in said
          and [p["key"] for p in said if p["key"] != "campaign"] == ["channel", "period"], answered.content[:300])
    wrong = world.api("post", f"/api/v1/insights/reports/{rid}/run/", {"params": ["EMAIL"]})
    check("answers that are not an object are refused", wrong.status_code == 400 and "params" in wrong.json()["errors"], wrong.content[:200])
    exported = world.api("get", f"/api/v1/insights/reports/{rid}/export.csv?params=" + json.dumps({"channel": ["SMS"]}))
    check("a file takes the answers in its address", exported.status_code == 200, exported.content[:200] if hasattr(exported, "content") else "")
    values = world.api("post", "/api/v1/insights/parameters/values/", {"dataset": "messages", "field": "channel"})
    check("the values to choose from: the field's own, read with the person's access", values.status_code == 200 and values.json()["choosable"] is True and isinstance(values.json()["values"], list), values.content[:200])
    measure = world.api("post", "/api/v1/insights/parameters/values/", {"dataset": "messages", "field": "sent"})
    check("a measure offers no list (typed in)", measure.status_code == 200 and measure.json()["choosable"] is False)

    if not _upload_tables():
        check.done()
        pytest.skip("patch 0063 (uploaded files) has not been applied to this database")
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    client = Client()
    headers = {"HTTP_X_TENANT": admin.tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def send(path, name, data, extra=None):
        upload = io.BytesIO(data)
        upload.name = name
        return client.post(path, {"file": upload, **(extra or {})}, **headers)

    first = send("/api/v1/insights/uploads/", "regions.csv", b"Region,Revenue,Opened\nNorth,\"1,234.50\",10/19/2026\nSouth,12,03/04/2026\nNorth,10,10/20/2026\n", {"name": "Regional Sales"})
    up = first.json() if first.status_code == 201 else {}
    check("a CSV is read and kept as a draft with its columns and first rows", first.status_code == 201 and up["status"] == "DRAFT" and up["key"] == "upl_regional_sales" and up["row_count"] == 3
          and [c["type"] for c in up["columns"]] == ["string", "number", "date"] and up["sample"][0] == {"c1": "North", "c2": 1234.5, "c3": "2026-10-19"}, first.content[:400])
    uid = up.get("id")
    draft_keys = [d["key"] for d in world.api("get", "/api/v1/insights/catalog/").json()["datasets"]]
    check("a draft is not yet a dataset", "upl_regional_sales" not in draft_keys)
    wrong_type = world.api("put", f"/api/v1/insights/uploads/{uid}/", {"columns": [{"key": "region", "type": "number"}]})
    check("a column can only become text, not another type", wrong_type.status_code == 400, wrong_type.content[:200])
    ready = world.api("put", f"/api/v1/insights/uploads/{uid}/", {"ready": True, "columns": [{"key": "revenue", "label": "Revenue (USD)"}], "row_version": up["row_version"]})
    check("reviewed and made ready", ready.status_code == 200 and ready.json()["status"] == "READY" and ready.json()["columns"][1]["label"] == "Revenue (USD)", ready.content[:300])
    run = world.api("post", "/api/v1/insights/reports/preview/", {"dataset": "upl_regional_sales", "definition": {
        "columns": [{"field": "region"}, {"field": "revenue", "aggregate": "sum"}, {"field": "rows", "aggregate": "count"}], "orderBy": [{"field": "region", "direction": "asc"}]}})
    check("a report on the file totals its rows", run.status_code == 200 and run.json()["rows"] == [["North", 1244.5, 2], ["South", 12, 1]] and run.json()["upload"] == "regions.csv", run.content[:400])
    report = world.api("post", "/api/v1/insights/reports/", {"name": "Regions", "dataset": "upl_regional_sales", "definition": {"columns": [{"field": "region"}, {"field": "revenue", "aggregate": "sum"}]}})
    check("a report is saved on it, listed with the file's name", report.status_code == 201
          and any(r["dataset_label"] == "Regional Sales" for r in world.api("get", "/api/v1/insights/reports/").json()["reports"]), report.content[:200])
    gone = world.api("delete", f"/api/v1/insights/uploads/{uid}/")
    check("a file a report is built on cannot be deleted", gone.status_code == 409, gone.content[:200])
    missing = send(f"/api/v1/insights/uploads/{uid}/replace/", "regions.csv", b"Region,Opened\nWest,10/01/2026\n")
    check("a replacement without a column the reports read is refused", missing.status_code == 400 and "Revenue" in json.dumps(missing.json()), missing.content[:200])
    replaced = send(f"/api/v1/insights/uploads/{uid}/replace/", "regions-oct.xlsx", _xlsx([["Opened", "Region", "Revenue", "Notes"], [datetime(2026, 10, 1), "West", 99, "new"]]))
    check("an Excel replacement with the same columns in another order: new rows, same dataset", replaced.status_code == 200 and replaced.json()["row_count"] == 1 and replaced.json()["file_name"] == "regions-oct.xlsx", replaced.content[:300])
    again = world.api("post", "/api/v1/insights/reports/preview/", {"dataset": "upl_regional_sales", "definition": {"columns": [{"field": "region"}, {"field": "revenue", "aggregate": "sum"}]}})
    check("the reports read the new rows straight away", again.status_code == 200 and again.json()["rows"] == [["West", 99]], again.content[:300])
    old = send("/api/v1/insights/uploads/", "old.xls", b"x")
    check("an older Excel file is refused with what to do", old.status_code == 400 and "Save it as .xlsx" in json.dumps(old.json()))
    listed = world.api("get", "/api/v1/insights/uploads/").json()
    check("the list shows the file with its reports", any(u["id"] == uid and u["reports"] == 1 for u in listed["uploads"]) and listed["limits"]["rows"] == 100_000)
    check.done()
