"""Service Request Reports, version 1: C360Report's Service Request suite as a base pack. Three datasets (sql),
their shared formulas, the reports and a dashboard.

Nothing here identifies a customer. The CRM master carries their name, mobile, email, address and coordinates;
none is a reporting figure and none is read.
"""
from . import sql as sr_sql


def _dim(column, label, type_="string", sensitivity="NORMAL", format_=None):
    return {"column": column, "label": label, "type": type_, "role": "dimension", "aggregates": [], "format": format_,
            "sensitivity": sensitivity, "table": "t0"}


def _measure(column, label, format_="integer"):
    return {"column": column, "label": label, "type": "number", "role": "measure",
            "aggregates": ["sum", "avg", "min", "max"], "format": format_, "sensitivity": "NORMAL", "table": "t0"}


def _formula(dataset, label, expression, description, format_="percent"):
    return {"dataset": dataset, "label": label, "kind": "measure", "expression": expression,
            "description": description, "format": format_}


REQUEST_FIELDS = [
    _dim("request_key", "Request Key"), _dim("crm_database", "CRM Database"),
    _dim("request_type", "Request Type"), _dim("status", "Status"), _dim("sub_category", "Sub Category"),
    _dim("source", "Source"), _dim("priority", "Priority"), _dim("owner", "Owner"), _dim("team", "Team"),
    _dim("sla_status", "SLA Status"), _dim("location", "Location"), _dim("city", "City"), _dim("state", "State"),
    _dim("fiscal_period", "Fiscal Period"),
    _dim("opened_at", "Opened At", "datetime", format_="datetime"),
    _dim("due_at", "Due At", "datetime", format_="datetime"),
    _dim("closed_at", "Closed At", "datetime", format_="datetime"),
    _dim("reopened_at", "Reopened At", "datetime", format_="datetime"),
    _measure("requests", "Requests"), _measure("closed", "Closed"), _measure("still_open", "Still Open"),
    _measure("reopened", "Reopened"), _measure("closed_late", "Closed Late"),
    _measure("turnaround_days", "Turnaround Days", "decimal"),
]
STORE_FIELDS = [
    _dim("request_key", "Request Key"), _dim("crm_database", "CRM Database"),
    _dim("request_type", "Request Type"), _dim("status", "Status"), _dim("category", "Category"),
    _dim("responsible", "Responsible"), _dim("store", "Store"), _dim("region", "Region"),
    _dim("district", "District"), _dim("line_of_business", "Line of Business"),
    _dim("raised_at", "Raised At", "datetime", format_="datetime"),
    _dim("closed_at", "Closed At", "datetime", format_="datetime"),
    _dim("last_touched_at", "Last Touched At", "datetime", format_="datetime"),
    _measure("requests", "Requests"), _measure("closed", "Closed"), _measure("still_open", "Still Open"),
    _measure("turnaround_days", "Turnaround Days", "decimal"),
    _measure("escalation_level", "Escalation Level", "decimal"),
]
HISTORY_FIELDS = [
    _dim("event_key", "Event Key"), _dim("request_key", "Request Key"), _dim("crm_database", "CRM Database"),
    _dim("status", "Status"), _dim("priority", "Priority"), _dim("source", "Source"),
    _dim("changed_by", "Changed By"),
    _dim("changed_at", "Changed At", "datetime", format_="datetime"),
    _dim("closed_at", "Closed At", "datetime", format_="datetime"),
    _measure("events", "Events"), _measure("closing_events", "Closing Events"),
]

DATASETS = [
    {"id": "requests", "label": "Service Requests",
     "description": "One row per request as the CRM holds it: type, status, who owns it and how long it took.",
     "sql": sr_sql.requests_sql, "fields": REQUEST_FIELDS, "time_field": "opened_at", "primary_key": "request_key"},
    {"id": "by_store", "label": "Requests by Store",
     "description": "The same requests placed in the store hierarchy, which the master does not carry.",
     "sql": sr_sql.by_store_sql, "fields": STORE_FIELDS, "time_field": "raised_at", "primary_key": "request_key"},
    {"id": "history", "label": "Request History",
     "description": "One row per status change: how a request moved, and who moved it.",
     "sql": sr_sql.history_sql, "fields": HISTORY_FIELDS, "time_field": "changed_at", "primary_key": "event_key"},
]

FORMULAS = [
    _formula("requests", "Closure Rate", "DIVIDE(SUM([Closed]), SUM([Requests])) * 100",
             "Requests closed, as a share of those raised"),
    _formula("requests", "Reopen Rate", "DIVIDE(SUM([Reopened]), SUM([Closed])) * 100",
             "Closed requests that had to be opened again"),
    _formula("requests", "Late Closure Rate", "DIVIDE(SUM([Closed Late]), SUM([Closed])) * 100",
             "Requests closed after their due date"),
    _formula("requests", "Average Turnaround", "DIVIDE(SUM([Turnaround Days]), SUM([Closed]))",
             "Days from raised to closed, averaged over closed requests", "decimal"),
    _formula("by_store", "Closure Rate", "DIVIDE(SUM([Closed]), SUM([Requests])) * 100",
             "Requests closed, as a share of those raised"),
    _formula("by_store", "Average Turnaround", "DIVIDE(SUM([Turnaround Days]), SUM([Closed]))",
             "Days from raised to closed", "decimal"),
    _formula("history", "Closing Share", "DIVIDE(SUM([Closing Events]), SUM([Events])) * 100",
             "Status changes that closed the request"),
]

BENCHMARKS = [
    {"dataset": "requests", "measure": "f_closure_rate", "higher": True, "good": 95, "act": 85, "count": "closed", "base": "requests"},
    {"dataset": "requests", "measure": "f_reopen_rate", "higher": False, "good": 3, "act": 8, "count": "reopened", "base": "closed"},
    {"dataset": "requests", "measure": "f_late_closure_rate", "higher": False, "good": 10, "act": 25, "count": "closed_late", "base": "closed"},
]

ANY_TYPE = {"key": "request_type", "field": "request_type", "label": "Request Types", "operator": "in", "required": False}
ANY_REGION = {"key": "region", "field": "region", "label": "Regions", "operator": "in", "required": False}
ANY_STATUS = {"key": "status", "field": "status", "label": "Statuses", "operator": "in", "required": False}


def _period(field):
    return {"key": "period", "field": field, "label": "Period", "operator": "period", "required": True, "default": "quarter"}


def _report(id_, name, dataset, columns, description, *, view=None, order=None, filters=None, top=None, pick=ANY_TYPE):
    time_field = next(d["time_field"] for d in DATASETS if d["id"] == dataset)
    definition = {"columns": columns, "filters": {"combinator": "and", "rules": filters or []}, "orderBy": order or [],
                  "view": view or {"type": "grid"}, "parameters": [pick, _period(time_field)], "limit": 500,
                  **({"top": top} if top else {})}
    return {"id": id_, "name": name, "dataset": dataset, "description": description, "definition": definition}


def _sum(field, **extra):
    return {"field": field, "aggregate": "sum", **extra}


def _calc(field):
    return {"field": field, "aggregate": "calc"}


REPORTS = [
    _report("kpis", "Service Request KPIs", "requests",
            [_sum("requests"), _sum("closed"), _calc("f_closure_rate"), _sum("still_open"),
             _sum("reopened"), _calc("f_reopen_rate"), _calc("f_average_turnaround")],
            "Raised, closed, still open and reopened, with turnaround."),
    _report("by_type", "Requests by Type and Status", "requests",
            [{"field": "request_type"}, {"field": "status"}, _sum("requests"), _sum("closed"),
             _calc("f_closure_rate"), _calc("f_average_turnaround")],
            "What people ask for, and how much of it gets finished.",
            order=[{"field": "requests", "direction": "desc"}]),
    _report("by_source", "Where Requests Come From", "requests",
            [{"field": "source"}, {"field": "sub_category"}, _sum("requests"), _calc("f_average_turnaround")],
            "The channel each request arrived through.",
            order=[{"field": "requests", "direction": "desc"}], top={"n": 20, "others": True}),
    _report("ageing", "Open Requests by Age", "requests",
            [{"field": "opened_at", "bucket": "week"}, {"field": "request_type"}, _sum("still_open")],
            "What is still open, by the week it was raised: the backlog and how old it is.",
            view={"type": "chart", "chart": "stacked"},
            filters=[{"field": "still_open", "operator": "=", "value": 1}],
            order=[{"field": "opened_at", "direction": "asc"}]),
    _report("timeliness", "Closed Late", "requests",
            [{"field": "team"}, {"field": "owner"}, _sum("closed"), _sum("closed_late"),
             _calc("f_late_closure_rate")],
            "Requests closed after their due date, by the team and person who closed them.",
            view={"type": "grid", "formats": [{"column": "f_late_closure_rate", "style": "scale"}]},
            order=[{"field": "closed_late", "direction": "desc"}], top={"n": 20, "others": True}),
    _report("over_time", "Requests over Time", "requests",
            [{"field": "opened_at", "bucket": "week"}, _sum("requests"), _sum("closed")],
            "Raised against closed, week by week.",
            view={"type": "chart", "chart": "line"}, order=[{"field": "opened_at", "direction": "asc"}]),
    _report("by_region", "Requests by Region, District and Store", "by_store",
            [{"field": "region"}, {"field": "district"}, {"field": "store"}, _sum("requests"), _sum("closed"),
             _calc("f_closure_rate"), _calc("f_average_turnaround")],
            "The same work seen from the shop it belongs to.",
            view={"type": "hierarchy"}, order=[{"field": "requests", "direction": "desc"}], pick=ANY_REGION),
    _report("store_leaders", "Stores with the Most Requests", "by_store",
            [{"field": "store"}, {"field": "region"}, _sum("requests"), _sum("still_open"),
             _calc("f_closure_rate")],
            "Where the work lands, and where it stays open.",
            order=[{"field": "requests", "direction": "desc"}], top={"n": 25, "others": True}, pick=ANY_REGION),
    _report("escalations", "Escalations", "by_store",
            [{"field": "store"}, {"field": "category"}, _sum("requests"),
             _sum("escalation_level", label="Escalation Level")],
            "Requests that had to be escalated, and where.",
            filters=[{"field": "escalation_level", "operator": ">", "value": 0}],
            order=[{"field": "escalation_level", "direction": "desc"}], pick=ANY_REGION),
    _report("history", "How Requests Move", "history",
            [{"field": "status"}, {"field": "changed_by"}, _sum("events"), _sum("closing_events")],
            "Every status change, by the step and the person who made it.",
            order=[{"field": "events", "direction": "desc"}], top={"n": 25, "others": True}, pick=ANY_STATUS),
]


def _figure(id_, report, measure, title):
    return {"id": id_, "report": report, "show": "figure", "measure": measure, "title": title}


def _tile(id_, report, show, title):
    return {"id": id_, "report": report, "show": show, "title": title}


DASHBOARDS = [
    {"id": "service", "name": "Service Request Dashboard",
     "description": "What was raised, what was closed, what is still open and where it sits.",
     "period": {"preset": "90d"}, "compare": True,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("raised", "kpis", "requests", "Requests Raised"),
                                  _figure("closed", "kpis", "closed", "Closed"),
                                  _figure("open", "kpis", "still_open", "Still Open"),
                                  _figure("reopened", "kpis", "reopened", "Reopened")]},
         {"width": "2", "tiles": [_tile("time", "over_time", "chart", "Raised against Closed"),
                                  _tile("ageing", "ageing", "chart", "Open Requests by Age")]},
         {"width": "2", "tiles": [_tile("types", "by_type", "grid", "By Type and Status"),
                                  _tile("sources", "by_source", "grid", "Where They Come From")]},
         {"width": "1", "tiles": [_tile("regions", "by_region", "hierarchy", "By Region, District and Store")]},
     ], "slicers": [{"field": "request_type", "label": "Request Type"}]}},
]

PACK = {
    "key": "service-requests",
    "version": 1,
    "name": "Service Request Reports",
    "summary": ("Request KPIs, type and status, where requests come from, the open backlog by age, late closures "
                "by team and owner, raised against closed over time, the store hierarchy, escalations and the "
                "status history; a Service Request dashboard."),
    "source": "C360Report",
    "components": ["insights"],
    "needs": {"engine": "mysql", "label": "a CRM database",
              "tables": ["bi_service_request_master", "cust_request_report", "cust_request_history",
                         "tt_store_hierarchy_imp"]},
    "volume": {"table": "bi_service_request_master", "alias": "s", "where": "s.SR_ID IS NOT NULL"},
    "datasets": DATASETS,
    "formulas": FORMULAS,
    "reports": REPORTS,
    "dashboards": DASHBOARDS,
    "benchmarks": BENCHMARKS,
    "checked": sr_sql.checked,
}
