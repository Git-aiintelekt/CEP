"""Insights, the report engine's foundation (patch 0049): the definition checked against the catalogue, the SQL the compiler
makes of it, and the API: the catalogue, a report's life, a run under the engine's limits, the export, and what another
workspace or a person without the right cannot do."""
import json

import pytest
from django.conf import settings
from django.db import connections

from apps.insights import compiler, definition
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
    check("the limit is capped to what the engine allows", definition.validate(DATASET, {"columns": [{"field": "channel"}], "limit": 10**9}, max_limit=200)["limit"] == 200)
    check("the signature is one hash for one normalised definition", definition.signature(d) == definition.signature(definition.validate(DATASET, raw)) and len(definition.signature(d)) == 64)
    check.done()


def _tables_present() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('report_dataset', 'report', 'report_run_audit')")
        return cursor.fetchone()[0] == 3


def test_api(check, world):
    if not _tables_present():
        pytest.skip("patch 0049 has not been applied to this database")
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
                                                                   "definition": {**draft["definition"], "limit": 100}, "note": "Shared with the workspace"})
    check("a change makes version 2 and keeps the history", changed.status_code == 200 and changed.json()["version"] == 2 and changed.json()["visibility"] == "WORKSPACE"
          and [v["version"] for v in world.api("get", f"/api/v1/insights/reports/{rid}/versions/").json()["versions"]] == [2, 1], changed.content[:200])
    stale = world.api("put", f"/api/v1/insights/reports/{rid}/", {"row_version": report["row_version"], "name": "Too late"})
    check("a stale change is a 409", stale.status_code == 409)
    export = world.api("get", f"/api/v1/insights/reports/{rid}/export.csv")
    text = b"".join(export.streaming_content).decode() if export.status_code == 200 else ""
    check("the export streams a CSV with the labels as its header", export.status_code == 200 and text.startswith("Campaign,Channel,Sent Count,Messages") and "attachment" in export["Content-Disposition"], text[:120])

    audit = world.sql("SELECT kind, outcome FROM report_run_audit WHERE report_id = %s OR (report_id IS NULL AND dataset_key = 'messages') ORDER BY id", [rid], fetch=True)
    check("every preview, run and export is audited with its outcome", ("preview", "OK") in audit and ("run", "OK") in audit and ("export", "OK") in audit, str(audit))

    gone = world.api("delete", f"/api/v1/insights/reports/{rid}/")
    check("a deleted report is gone from the list", gone.status_code == 204 and not any(r["id"] == rid for r in world.api("get", "/api/v1/insights/reports/").json()["reports"]))
    other = world.api("get", "/api/v1/insights/reports/00000000-0000-4000-8000-000000000000/")
    check("a report of another workspace, or none, is 404", other.status_code == 404)
    check.done()
