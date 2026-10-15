"""Insights, the report engine's foundation (patch 0049): the definition checked against the catalogue, the SQL the compiler
makes of it, and the API: the catalogue, a report's life, a run under the engine's limits, the export, and what another
workspace or a person without the right cannot do."""
import json

import pytest
from django.conf import settings
from django.db import connections

from datetime import date

from apps.insights import catalog, compiler, dashboards, definition, runner
from apps.insights.definition import DefinitionError

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

P = settings.PLATFORM_ALIAS
DATASET = {
    "key": "messages", "label": "Messages", "source": "reporting.rpt_messages", "workspace_field": "tenant_id", "primary_key": "message_id", "time_field": "submitted_at",
    "fields": [
        {"key": "channel", "label": "Channel", "column": "channel", "type": "string", "role": "dimension", "aggregates": [], "operators": ["=", "!=", "contains", "starts_with", "in", "is_null", "is_not_null"], "buckets": [], "format": None, "sensitivity": "NORMAL"},
        {"key": "campaign_name", "label": "Campaign", "column": "campaign_name", "type": "string", "role": "dimension", "aggregates": [], "operators": ["=", "!=", "contains", "starts_with", "in", "is_null", "is_not_null"], "buckets": [], "format": None, "sensitivity": "NORMAL"},
        {"key": "submitted_at", "label": "Sent", "column": "submitted_at", "type": "datetime", "role": "dimension", "aggregates": [], "operators": ["=", "!=", ">", ">=", "<", "<=", "between", "last_days", "is_null", "is_not_null"], "buckets": ["day", "week", "month", "quarter", "year"], "format": "datetime", "sensitivity": "NORMAL"},
        {"key": "party_id", "label": "Customer", "column": "party_id", "type": "string", "role": "dimension", "aggregates": [], "operators": ["=", "!=", "contains", "starts_with", "in", "is_null", "is_not_null"], "buckets": [], "format": None, "sensitivity": "PII"},
        {"key": "sent", "label": "Sent Count", "column": "sent_n", "type": "number", "role": "measure", "aggregates": ["sum"], "operators": ["=", "!=", ">", ">=", "<", "<=", "between", "in", "is_null", "is_not_null"], "buckets": [], "format": "integer", "sensitivity": "NORMAL"},
        {"key": "messages", "label": "Messages", "column": "message_id", "type": "number", "role": "measure", "aggregates": ["count"], "operators": [">", ">="], "buckets": [], "format": "integer", "sensitivity": "NORMAL"},
    ],
}


def test_definition_and_compiler(check):
    raw = {"columns": [{"field": "campaign_name"}, {"field": "submitted_at", "bucket": "month"}, {"field": "sent", "aggregate": "sum"}],
           "filters": {"combinator": "and", "rules": [{"field": "channel", "operator": "=", "value": "EMAIL"}, {"field": "submitted_at", "operator": "last_days", "value": 30},
                                                      {"combinator": "or", "rules": [{"field": "campaign_name", "operator": "contains", "value": "Fall %"}, {"field": "channel", "operator": "in", "value": ["SMS", "EMAIL"]}]}]},
           "orderBy": [{"field": "sent", "direction": "desc"}], "limit": 50}
    d = definition.validate(DATASET, raw)
    check("a grouped definition: the measure's aggregate marks it, the dimensions become the group", d["grouped"] and [c.get("aggregate") for c in d["columns"]] == [None, None, "sum"])
    c = compiler.compile(DATASET, d, "a0000000-0000-4000-8000-000000000001", "America/New_York", limit=51, offset=0)
    sql = c.sql
    check("the SQL reads the dataset's view, restricts on the workspace, groups by the dimensions and orders by the measure",
          sql.startswith('SELECT "campaign_name" AS "c0", date_trunc(%s, "submitted_at" AT TIME ZONE %s)::date AS "c1", sum("sent_n") AS "c2" FROM "reporting"."rpt_messages" WHERE "tenant_id" = %s')
          and ' GROUP BY 1, 2 ORDER BY' in sql and sql.endswith('ORDER BY "c2" DESC NULLS LAST LIMIT %s OFFSET %s'), sql)
    check("every value is a bound parameter, in the order of the placeholders: the bucket, the zone, the workspace, the filters, then the limit",
          c.params[:3] == ["month", "America/New_York", "a0000000-0000-4000-8000-000000000001"] and c.params[-2:] == [51, 0] and "EMAIL" in c.params and 30 in c.params
          and ["SMS", "EMAIL"] in c.params and sql.count("%s") == len(c.params), str(c.params))
    check("contains escapes the wildcard the person typed", "%Fall \\%%" in c.params and "ILIKE %s ESCAPE" in sql)
    check("a day given for a timestamp is that day in the workspace's zone", "AT TIME ZONE %s) >= now() - make_interval" not in sql and "make_interval(days => %s)" in sql)
    span = compiler.compile(DATASET, definition.validate(DATASET, {"columns": [{"field": "channel"}], "filters": {"rules": [{"field": "submitted_at", "operator": "between", "value": ["2026-09-01", "2026-09-30"]},
                                                                                                                              {"field": "submitted_at", "operator": "=", "value": "2026-10-01"}]}}),
                            "a0000000-0000-4000-8000-000000000001", "America/New_York", limit=10)
    check("a range or a day on a timestamp names the zone once per use of the column, so the placeholders and the parameters agree",
          span.sql.count("%s") == len(span.params) and span.params[1:9] == ["America/New_York", "2026-09-01", "America/New_York", "2026-09-30", "America/New_York", "2026-10-01", "America/New_York", "2026-10-01"], str(span.params))
    check("the result's columns carry the labels, the types and the formats", [x["label"] for x in c.columns] == ["Campaign", "Sent", "Sent Count"] and c.columns[1]["type"] == "date" and c.columns[2]["format"] == "integer")

    def refused(raw, where):
        try:
            definition.validate(DATASET, raw)
            return False
        except DefinitionError as exc:
            return exc.field == where
    check("a measure without an aggregate is refused, naming the column", refused({"columns": [{"field": "sent"}]}, "columns[0].aggregate"))
    check("an unknown field is refused where it sits", refused({"columns": [{"field": "campaign_name"}], "filters": {"rules": [{"field": "nope", "operator": "=", "value": 1}]}}, "filters.rules[0].field"))
    check("an operator a type does not take is refused", refused({"columns": [{"field": "campaign_name"}], "filters": {"rules": [{"field": "sent", "operator": "contains", "value": "x"}]}}, "filters.rules[0].operator"))
    check("a bucket on a string is refused", refused({"columns": [{"field": "campaign_name", "bucket": "month"}]}, "columns[0].bucket"))
    check("sorting by a column the report does not have is refused", refused({"columns": [{"field": "campaign_name"}], "orderBy": [{"field": "sent"}]}, "orderBy[0].field"))
    check("groups nest two levels at most", refused({"columns": [{"field": "campaign_name"}], "filters": {"rules": [{"rules": [{"rules": [{"rules": []}]}]}]}}, "filters.rules[0].rules[0].rules[0]"))
    shown = definition.validate(DATASET, {"columns": [{"field": "channel"}, {"field": "submitted_at", "bucket": "month"}, {"field": "sent", "aggregate": "sum"}], "view": {"type": "pivot", "across": "submitted_at"}})
    check("the view saves with the definition: its type, and the dimension spread across", shown["view"] == {"type": "pivot", "across": "submitted_at"})
    check("spreading a measure, or a field the report does not have, is refused at the view", refused({"columns": [{"field": "channel"}, {"field": "sent", "aggregate": "sum"}], "view": {"type": "chart", "across": "sent"}}, "view.across")
          and refused({"columns": [{"field": "channel"}], "view": {"type": "tree"}}, "view.type"))
    check("the limit is capped to what the engine allows", definition.validate(DATASET, {"columns": [{"field": "channel"}], "limit": 10**9}, max_limit=200)["limit"] == 200)
    check("the signature is one hash for one normalised definition", definition.signature(d) == definition.signature(definition.validate(DATASET, raw)) and len(definition.signature(d)) == 64)

    # personal data: hidden from a person without the right when building, masked when reading someone else's report
    seen = catalog._visible(DATASET, can_see_pii=False)
    check("without the right the catalogue hides the PII field and remembers it as locked", "party_id" not in [f["key"] for f in seen["fields"]] and seen["locked"] == [{"key": "party_id", "label": "Customer"}])
    try:
        definition.validate(seen, {"columns": [{"field": "party_id"}, {"field": "messages", "aggregate": "count"}]})
        told = ""
    except DefinitionError as exc:
        told = f"{exc.field}: {exc}"
    check("a draft naming it is told why, where it sits", told == "columns[0].field: Customer is personal data: building a report on it needs the report administration right.", told)
    columns = [{"key": "party_id", "label": "Customer", "type": "string", "format": None}, {"key": "messages", "label": "Messages", "type": "number", "format": "integer", "aggregate": "count"}]
    rows = [["p-1", 4], ["p-2", 1], [None, 2]]
    masked_columns, masked_rows = runner.mask(DATASET, columns, rows, True)
    check("a reader without the right gets the PII column's values masked and the column marked; empty values stay empty",
          masked_rows == [[runner.MASK, 4], [runner.MASK, 1], [None, 2]] and masked_columns[0].get("masked") is True and "masked" not in masked_columns[1], str(masked_rows))
    check("a reader with the right gets the rows as they are", runner.mask(DATASET, columns, rows, False) == (columns, rows))

    # dashboards: the period's bounds, and the period as one more rule on the time field
    check("this month runs from the 1st to today, the previous period is the same length just before",
          dashboards.period_bounds({"preset": "month"}, date(2026, 10, 15)) == {"from": "2026-10-01", "to": "2026-10-15", "previous_from": "2026-09-16", "previous_to": "2026-09-30"})
    check("the quarter starts on its first day", dashboards.period_bounds({"preset": "quarter"}, date(2026, 11, 3))["from"] == "2026-10-01")
    shaped = dashboards._with_period(raw, "submitted_at", "2026-09-01", "2026-09-30")
    check("the period is and-ed onto the report's own rules, and a report with its own rule on the time field is left alone",
          shaped["filters"]["rules"][-1] == {"field": "submitted_at", "operator": "between", "value": ["2026-09-01", "2026-09-30"]} and len(shaped["filters"]["rules"]) == 4
          and dashboards._has_time_rule(raw["filters"], "submitted_at") and not dashboards._has_time_rule({"rules": [{"field": "channel", "operator": "=", "value": "x"}]}, "submitted_at"))
    check.done()


def _tables_present() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('report_dataset', 'report', 'report_run_audit', 'dashboard', 'report_favourite')")
        return cursor.fetchone()[0] == 5


def test_api(check, world):
    if not _tables_present():
        pytest.skip("patches 0049 to 0051 have not been applied to this database")
    me = world.api("get", "/api/v1/me/").json()
    check("the workspace has Insights (Beta, on every plan) and /me says how it is offered", any(c["key"] == "insights" for c in me["components"]) and me["insights"]["mode"] in ("integrated", "standalone", "both"), str(me.get("insights")))

    cat = world.api("get", "/api/v1/insights/catalog/")
    body = cat.json() if cat.status_code == 200 else {}
    keys = [d["key"] for d in body.get("datasets", [])]
    check("the catalogue lists the first datasets with their fields and the engine", cat.status_code == 200 and keys == ["messages", "attributed_orders", "contacts", "journey_enrollments"]
          and body["engine"]["engine"] == "postgresql" and body["engine"]["limits"]["preview_rows"] > 0, f"{cat.status_code} {keys}")
    messages = next(d for d in body["datasets"] if d["key"] == "messages")
    check("an administrator sees PII fields; the fields carry their operators and buckets", any(f["key"] == "party_id" for f in messages["fields"])
          and next(f for f in messages["fields"] if f["key"] == "submitted_at")["buckets"][:2] == ["day", "week"])

    draft = {"dataset": "messages", "definition": {"columns": [{"field": "campaign_name"}, {"field": "channel"}, {"field": "sent", "aggregate": "sum"}, {"field": "messages", "aggregate": "count"}],
                                                   "filters": {"combinator": "and", "rules": [{"field": "test_mode", "operator": "=", "value": False}]},
                                                   "orderBy": [{"field": "messages", "direction": "desc"}]}}
    preview = world.api("post", "/api/v1/insights/reports/preview/", draft)
    rows = preview.json() if preview.status_code == 200 else {}
    check("a preview runs the draft under the preview cap and answers columns and rows", preview.status_code == 200 and [c["label"] for c in rows.get("columns", [])] == ["Campaign", "Channel", "Sent Count", "Messages"]
          and isinstance(rows.get("rows"), list) and rows["limit"] <= body["engine"]["limits"]["preview_rows"] and rows["cached"] is False, preview.content[:300])
    again = world.api("post", "/api/v1/insights/reports/preview/", draft).json()
    check("the same draft again comes from the cache", again.get("cached") is True)
    bad = world.api("post", "/api/v1/insights/reports/preview/", {"dataset": "messages", "definition": {"columns": [{"field": "sent"}]}})
    check("a draft the catalogue refuses is a 400 naming the part", bad.status_code == 400 and "definition.columns[0].aggregate" in json.dumps(bad.json()), bad.content[:200])

    created = world.api("post", "/api/v1/insights/reports/", {"name": "Sends by campaign", **draft})
    report = created.json() if created.status_code == 201 else {}
    check("a report is created as version 1, private, owned by its author", created.status_code == 201 and report["version"] == 1 and report["visibility"] == "PRIVATE" and report["owner_name"], created.content[:200])
    rid = report.get("id")
    listed = world.api("get", "/api/v1/insights/reports/?component=cep").json()["reports"]
    check("the list shows it under its component with its dataset's label", any(r["id"] == rid and r["component"]["key"] == "cep" and r["dataset_label"] == "Messages" and r["can_edit"] for r in listed))
    run = world.api("post", f"/api/v1/insights/reports/{rid}/run/", {"limit": 10})
    check("a saved report runs and is stamped", run.status_code == 200 and run.json()["limit"] == 10 and world.api("get", f"/api/v1/insights/reports/{rid}/").json()["last_run_at"], run.content[:200])
    changed = world.api("put", f"/api/v1/insights/reports/{rid}/", {"row_version": report["row_version"], "name": "Sends by campaign and channel", "visibility": "WORKSPACE",
                                                                   "definition": {**draft["definition"], "limit": 100, "view": {"type": "pivot", "across": "channel"}}, "note": "Shared with the workspace"})
    check("the report's view follows the definition", changed.status_code == 200 and changed.json()["view_type"] == "pivot" and changed.json()["definition"]["view"] == {"type": "pivot", "across": "channel"}, changed.content[:200])
    check("a change makes version 2 and keeps the history", changed.status_code == 200 and changed.json()["version"] == 2 and changed.json()["visibility"] == "WORKSPACE"
          and [v["version"] for v in world.api("get", f"/api/v1/insights/reports/{rid}/versions/").json()["versions"]] == [2, 1], changed.content[:200])
    stale = world.api("put", f"/api/v1/insights/reports/{rid}/", {"row_version": report["row_version"], "name": "Too late"})
    check("a stale change is a 409", stale.status_code == 409)
    history = world.api("get", f"/api/v1/insights/reports/{rid}/versions/").json()["versions"]
    check("every version carries its definition", history[0]["version"] == 2 and history[0]["definition"]["limit"] == 100 and "limit" not in history[1]["definition"], str(history)[:200])
    restored = world.api("post", f"/api/v1/insights/reports/{rid}/versions/1/restore/", {})
    check("restoring version 1 makes version 3 from its definition, and says so", restored.status_code == 200 and restored.json()["version"] == 3 and "limit" not in restored.json()["definition"]
          and world.api("get", f"/api/v1/insights/reports/{rid}/versions/").json()["versions"][0]["note"] == "Restored from version 1", restored.content[:200])
    check("a version that never was is 404", world.api("post", f"/api/v1/insights/reports/{rid}/versions/9/restore/", {}).status_code == 404)
    export = world.api("get", f"/api/v1/insights/reports/{rid}/export.csv")
    text = b"".join(export.streaming_content).decode() if export.status_code == 200 else ""
    check("the export streams a CSV with the labels as its header", export.status_code == 200 and text.startswith("Campaign,Channel,Sent Count,Messages") and "attachment" in export["Content-Disposition"], text[:120])

    # favourites and folders (Phase C)
    made_folder = world.api("post", "/api/v1/insights/folders/", {"name": "Finance"})
    folder = made_folder.json() if made_folder.status_code == 201 else {}
    check("a folder is made for the workspace", made_folder.status_code == 201 and folder["name"] == "Finance" and folder["reports"] == 0, made_folder.content[:200])
    twice = world.api("post", "/api/v1/insights/folders/", {"name": "finance"})
    check("a folder name is unique, whatever the case", twice.status_code == 400)
    filed = world.api("put", f"/api/v1/insights/reports/{rid}/", {"row_version": world.api("get", f"/api/v1/insights/reports/{rid}/").json()["row_version"], "folder_id": folder["id"]})
    check("a report is filed in a folder without a new version", filed.status_code == 200 and filed.json()["folder_id"] == folder["id"] and filed.json()["version"] == 3, filed.content[:200])
    check("the star goes on and shows in the list, first", world.api("put", f"/api/v1/insights/favourites/report/{rid}/").status_code == 204
          and next(r for r in world.api("get", "/api/v1/insights/reports/").json()["reports"] if r["id"] == rid)["favourite"] is True)
    in_folder = world.api("get", f"/api/v1/insights/reports/?folder={folder['id']}").json()["reports"]
    none = world.api("get", "/api/v1/insights/reports/?folder=none").json()["reports"]
    check("the list filters by folder, and by no folder", any(r["id"] == rid and r["folder_name"] == "Finance" for r in in_folder) and not any(r["id"] == rid for r in none))
    check("the folders list counts the reports", next(f for f in world.api("get", "/api/v1/insights/folders/").json()["folders"] if f["id"] == folder["id"])["reports"] == 1)
    check("the star comes off", world.api("delete", f"/api/v1/insights/favourites/report/{rid}/").status_code == 204
          and next(r for r in world.api("get", "/api/v1/insights/reports/").json()["reports"] if r["id"] == rid)["favourite"] is False)
    check("deleting the folder leaves its reports, filed nowhere", world.api("delete", f"/api/v1/insights/folders/{folder['id']}/").status_code == 204
          and world.api("get", f"/api/v1/insights/reports/{rid}/").json()["folder_id"] is None)

    # dashboards (Phase C): rows of tiles over the report, one period for every tile
    made = world.api("post", "/api/v1/insights/dashboards/", {"name": "Marketing Weekly"})
    dash = made.json() if made.status_code == 201 else {}
    check("a dashboard starts empty, private, on the last 30 days", made.status_code == 201 and dash["layout"] == {"rows": []} and dash["period"] == {"preset": "30d"}
          and dash["visibility"] == "PRIVATE" and dash["bounds"]["from"] < dash["bounds"]["to"], made.content[:200])
    did = dash.get("id")
    layout = {"rows": [{"width": "2-1", "tiles": [{"id": "t1", "report_id": rid, "show": "chart", "title": "Sends by campaign"}, {"id": "t2", "report_id": rid, "show": "figure", "measure": "sent"}]}]}
    saved = world.api("put", f"/api/v1/insights/dashboards/{did}/", {"row_version": dash["row_version"], "layout": layout, "period": {"preset": "7d"}, "compare": True, "note": "First tiles"})
    check("tiles save as version 2 with the period and the comparison", saved.status_code == 200 and saved.json()["version"] == 2 and saved.json()["compare"] is True
          and len(saved.json()["layout"]["rows"][0]["tiles"]) == 2, saved.content[:300])
    bad = world.api("put", f"/api/v1/insights/dashboards/{did}/", {"row_version": saved.json()["row_version"],
                                                                    "layout": {"rows": [{"width": "1", "tiles": [{"id": "x", "report_id": "00000000-0000-4000-8000-000000000000", "show": "grid"}]}]}})
    check("a tile on a report one cannot open is refused where it sits", bad.status_code == 400 and "layout.rows[0].tiles[0].report_id" in json.dumps(bad.json()), bad.content[:200])
    figure = world.api("post", f"/api/v1/insights/dashboards/{did}/tiles/t2/run/", {})
    fig = figure.json() if figure.status_code == 200 else {}
    check("a figure tile answers the measure over the period, with the previous period beside it", figure.status_code == 200 and fig.get("kind") == "figure" and fig["compared"] is True
          and fig["column"]["key"] == "sent" and fig["own_dates"] is False, figure.content[:300])
    view = world.api("post", f"/api/v1/insights/dashboards/{did}/tiles/t1/run/", {"period": {"preset": "custom", "from": "2026-09-01", "to": "2026-09-30"}})
    vw = view.json() if view.status_code == 200 else {}
    check("a view tile answers the rows in the tile's view for the period asked", view.status_code == 200 and vw.get("kind") == "view" and vw["view"]["type"] == "chart"
          and vw["bounds"] == {"from": "2026-09-01", "to": "2026-09-30", "previous_from": "2026-08-02", "previous_to": "2026-08-31"} and isinstance(vw["result"]["rows"], list), view.content[:300])
    listed_d = world.api("get", "/api/v1/insights/dashboards/").json()["dashboards"]
    check("the list counts the tiles", any(d["id"] == did and d["tiles"] == 2 and d["can_edit"] for d in listed_d), str(listed_d)[:200])
    check("a deleted dashboard is gone", world.api("delete", f"/api/v1/insights/dashboards/{did}/").status_code == 204
          and not any(d["id"] == did for d in world.api("get", "/api/v1/insights/dashboards/").json()["dashboards"]))

    audit = world.sql("SELECT kind, outcome FROM report_run_audit WHERE report_id = %s OR (report_id IS NULL AND dataset_key = 'messages') ORDER BY id", [rid], fetch=True)
    check("every preview, run and export is audited with its outcome", ("preview", "OK") in audit and ("run", "OK") in audit and ("export", "OK") in audit, str(audit))
    log = world.api("get", "/api/v1/insights/runs/?days=7&q=Sends by campaign")
    body_log = log.json() if log.status_code == 200 else {}
    check("the run log lists the runs of this report with who, the outcome, the rows and the time, and sums them up", log.status_code == 200
          and any(r["report_id"] == rid and r["kind"] == "run" and r["outcome"] == "OK" and r["user_name"] and r["duration_ms"] is not None for r in body_log.get("runs", []))
          and body_log["summary"]["runs"] >= 3 and body_log["summary"]["median_ms"] is not None and any(p["name"] for p in body_log["people"]), log.content[:300])
    check("the run log narrows by outcome", all(r["outcome"] == "TIMEOUT" for r in world.api("get", "/api/v1/insights/runs/?outcome=TIMEOUT").json()["runs"]))

    gone = world.api("delete", f"/api/v1/insights/reports/{rid}/")
    check("a deleted report is gone from the list", gone.status_code == 204 and not any(r["id"] == rid for r in world.api("get", "/api/v1/insights/reports/").json()["reports"]))
    other = world.api("get", "/api/v1/insights/reports/00000000-0000-4000-8000-000000000000/")
    check("a report of another workspace, or none, is 404", other.status_code == 404)
    check.done()
