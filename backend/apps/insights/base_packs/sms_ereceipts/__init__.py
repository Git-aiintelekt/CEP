"""SMS eReceipt Reports, version 1: C360Report's SMS eReceipts suite as a base pack. Two datasets (sql), their
shared formulas, the reports and a dashboard.

The receipt flow shares its tables with SMS Marketing and is a different programme: a text sent at the till, not a
campaign. Its question is not "did it perform" but "are stores offering it, and does the receipt get looked at".

Field keys follow from the labels as Report Databases makes them (Receipt Share -> receipt_share), so every column
here is named to match its label.
"""
from . import sql as receipt_sql


def _dim(column, label, type_="string", sensitivity="NORMAL", format_=None):
    return {"column": column, "label": label, "type": type_, "role": "dimension", "aggregates": [], "format": format_,
            "sensitivity": sensitivity, "table": "t0"}


def _measure(column, label, format_="integer"):
    return {"column": column, "label": label, "type": "number", "role": "measure",
            "aggregates": ["sum", "avg", "min", "max"], "format": format_, "sensitivity": "NORMAL", "table": "t0"}


def _formula(dataset, label, expression, description, format_="percent"):
    return {"dataset": dataset, "label": label, "kind": "measure", "expression": expression,
            "description": description, "format": format_}


RECEIPT_FIELDS = [
    _dim("receipt_key", "Receipt Key"), _dim("analysis_database", "Analysis Database"),
    _dim("sent_at", "Sent At", "datetime", format_="datetime"), _dim("status", "Status"),
    _dim("carrier", "Carrier"), _dim("store", "Store"), _dim("link_type", "Link Type"),
    _dim("device_type", "Device Type"), _dim("failure_reason", "Failure Reason"),
    _measure("receipts", "Receipts"), _measure("delivered", "Delivered"), _measure("failed", "Failed"),
    _measure("segments", "Segments"), _measure("opened", "Opened"), _measure("views", "Views"),
    _measure("has_transaction", "Has Transaction"),
]
ADOPTION_FIELDS = [
    _dim("day", "Day", "date", format_="date"), _dim("analysis_database", "Analysis Database"),
    _dim("region", "Region"), _dim("district", "District"), _dim("store", "Store"), _dim("city", "City"),
    _measure("sent", "Sent"), _measure("delivered", "Delivered"), _measure("failed", "Failed"),
    _measure("customers", "Customers"), _measure("phones", "Phones"),
    _measure("views", "Views"), _measure("viewers", "Viewers"),
    _measure("transactions", "Transactions"), _measure("sales", "Sales", "money"),
    _measure("receipt_share", "Receipt Share", "percent"),
    _measure("new_customers", "New Customers"), _measure("returning_customers", "Returning Customers"),
    _measure("guest_customers", "Guest Customers"), _measure("profiles_completed", "Profiles Completed"),
]

DATASETS = [
    {"id": "receipts", "label": "SMS Receipts",
     "description": "One row per receipt text sent at the till: delivered or not, and whether the receipt was opened.",
     "sql": receipt_sql.receipts_sql, "fields": RECEIPT_FIELDS, "time_field": "sent_at", "primary_key": "receipt_key"},
    {"id": "adoption", "label": "Receipt Adoption",
     "description": "One row per store per day: how many receipts went out by text, who looked at them, and what the store took.",
     "sql": receipt_sql.adoption_sql, "fields": ADOPTION_FIELDS, "time_field": "day", "primary_key": "store"},
]

FORMULAS = [
    _formula("receipts", "Delivery Rate", "DIVIDE(SUM([Delivered]), SUM([Receipts])) * 100",
             "Receipt texts the carrier accepted, as a share of those sent"),
    _formula("receipts", "Open Rate", "DIVIDE(SUM([Opened]), SUM([Delivered])) * 100",
             "Receipts whose link was followed, as a share of delivered"),
    _formula("receipts", "Views per Opened Receipt", "DIVIDE(SUM([Views]), SUM([Opened]))",
             "How many times an opened receipt was looked at", "decimal"),
    _formula("adoption", "Delivery Rate", "DIVIDE(SUM([Delivered]), SUM([Sent])) * 100", "Delivered as a share of sent"),
    _formula("adoption", "View Rate", "DIVIDE(SUM([Viewers]), SUM([Delivered])) * 100",
             "Customers who looked at the receipt, as a share of delivered"),
    _formula("adoption", "Sales per Receipt", "DIVIDE(SUM([Sales]), SUM([Delivered]))",
             "Takings behind each delivered receipt", "money"),
    _formula("adoption", "Returning Share", "DIVIDE(SUM([Returning Customers]), SUM([Customers])) * 100",
             "Customers who had been in before, as a share of those who got a receipt"),
]

BENCHMARKS = [
    {"dataset": "receipts", "measure": "f_delivery_rate", "higher": True, "good": 96, "act": 90, "count": "delivered", "base": "receipts"},
    {"dataset": "receipts", "measure": "f_open_rate", "higher": True, "good": 35, "act": 15, "count": "opened", "base": "delivered"},
    {"dataset": "adoption", "measure": "f_view_rate", "higher": True, "good": 35, "act": 15, "count": "viewers", "base": "delivered"},
]

ANY_STORE = {"key": "store", "field": "store", "label": "Stores", "operator": "in", "required": False}


def _period(field):
    return {"key": "period", "field": field, "label": "Period", "operator": "period", "required": True, "default": "quarter"}


def _report(id_, name, dataset, columns, description, *, view=None, order=None, filters=None, top=None):
    time_field = next(d["time_field"] for d in DATASETS if d["id"] == dataset)
    definition = {"columns": columns, "filters": {"combinator": "and", "rules": filters or []}, "orderBy": order or [],
                  "view": view or {"type": "grid"}, "parameters": [ANY_STORE, _period(time_field)], "limit": 500,
                  **({"top": top} if top else {})}
    return {"id": id_, "name": name, "dataset": dataset, "description": description, "definition": definition}


def _sum(field, **extra):
    return {"field": field, "aggregate": "sum", **extra}


def _calc(field):
    return {"field": field, "aggregate": "calc"}


REPORTS = [
    _report("kpis", "Receipt KPIs", "receipts",
            [_sum("receipts"), _sum("delivered"), _calc("f_delivery_rate"), _sum("opened"), _calc("f_open_rate"),
             _sum("views"), _calc("f_views_per_opened_receipt")],
            "Receipts sent, delivered, opened and looked at, with their rates."),
    _report("adoption_by_region", "Adoption by Region, District and Store", "adoption",
            [{"field": "region"}, {"field": "district"}, {"field": "store"}, _sum("sent"), _sum("delivered"),
             _calc("f_delivery_rate"), _sum("viewers"), _calc("f_view_rate"),
             _sum("receipt_share", label="Receipt Share")],
            "How widely each store's customers take a receipt by text. The default store and stray region values "
            "sit in their own buckets rather than being blended into a region.",
            view={"type": "hierarchy"}, order=[{"field": "sent", "direction": "desc"}]),
    _report("adoption_over_time", "Adoption over Time", "adoption",
            [{"field": "day", "bucket": "week"}, _sum("sent"), _sum("delivered"), _sum("viewers")],
            "Receipts by text week by week, and how many were looked at.",
            view={"type": "chart", "chart": "stacked"}, order=[{"field": "day", "direction": "asc"}]),
    _report("leaders", "Best and Worst Stores", "adoption",
            [{"field": "store"}, {"field": "region"}, _sum("delivered"), _sum("viewers"), _calc("f_view_rate"),
             _sum("sales")],
            "Stores ranked by how often a delivered receipt is actually looked at.",
            view={"type": "grid", "formats": [{"column": "f_view_rate", "style": "bars"}]},
            order=[{"field": "f_view_rate", "direction": "desc"}], top={"n": 20, "others": True}),
    _report("delivery", "Receipt Delivery Health", "receipts",
            [{"field": "carrier"}, _sum("receipts"), _sum("delivered"), _calc("f_delivery_rate"), _sum("failed")],
            "Whether receipts arrive, by carrier.",
            order=[{"field": "receipts", "direction": "desc"}]),
    _report("failures", "Why Receipts Failed", "receipts",
            [{"field": "failure_reason"}, _sum("failed")],
            "The carrier's reason for each receipt that did not arrive.",
            filters=[{"field": "failed", "operator": "=", "value": 1}],
            order=[{"field": "failed", "direction": "desc"}], top={"n": 15, "others": True}),
    _report("devices", "Receipts by Device", "receipts",
            [{"field": "device_type"}, _sum("opened"), _sum("views")],
            "The devices receipts were opened on.",
            filters=[{"field": "opened", "operator": "=", "value": 1}],
            order=[{"field": "opened", "direction": "desc"}]),
    _report("customers", "Who Gets a Receipt", "adoption",
            [{"field": "region"}, _sum("customers"), _sum("new_customers"), _sum("returning_customers"),
             _sum("guest_customers"), _calc("f_returning_share"), _sum("profiles_completed")],
            "New, returning and guest customers behind the receipts, and how many went on to complete a profile.",
            order=[{"field": "customers", "direction": "desc"}]),
    _report("sales", "Sales behind the Receipts", "adoption",
            [{"field": "region"}, {"field": "store"}, _sum("transactions"), _sum("sales"),
             _calc("f_sales_per_receipt")],
            "What the till took behind the receipts each store sent.",
            order=[{"field": "sales", "direction": "desc"}], top={"n": 25, "others": True}),
]


def _figure(id_, report, measure, title):
    return {"id": id_, "report": report, "show": "figure", "measure": measure, "title": title}


def _tile(id_, report, show, title):
    return {"id": id_, "report": report, "show": show, "title": title}


DASHBOARDS = [
    {"id": "adoption", "name": "SMS eReceipt Dashboard",
     "description": "Receipts by text: how many go out, how widely stores offer them, who looks at them and what the till took.",
     "period": {"preset": "90d"}, "compare": True,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("sent", "kpis", "receipts", "Receipts Sent"),
                                  _figure("delivered", "kpis", "delivered", "Delivered"),
                                  _figure("opened", "kpis", "opened", "Opened"),
                                  _figure("views", "kpis", "views", "Views")]},
         {"width": "1", "tiles": [_tile("regions", "adoption_by_region", "hierarchy", "Adoption by Region, District and Store")]},
         {"width": "2", "tiles": [_tile("time", "adoption_over_time", "chart", "Adoption over Time"),
                                  _tile("leaders", "leaders", "grid", "Best and Worst Stores")]},
         {"width": "2", "tiles": [_tile("delivery", "delivery", "grid", "Delivery by Carrier"),
                                  _tile("sales", "sales", "grid", "Sales behind the Receipts")]},
     ], "slicers": [{"field": "region", "label": "Region"}]}},
]

PACK = {
    "key": "sms-ereceipts",
    "version": 1,
    "name": "SMS eReceipt Reports",
    "summary": ("Receipt KPIs, adoption by region, district and store, adoption over time, the best and worst "
                "stores, delivery and carrier failures, devices, who gets a receipt and the sales behind them; "
                "an eReceipt dashboard."),
    "source": "C360Report",
    "components": ["insights"],
    "needs": {"engine": "mysql", "label": "an analysis database",
              "tables": ["sms_mailer_master", "sms_mailer_summary"]},
    "volume": {"table": "sms_mailer_master", "alias": "m",
               "where": "m.DIRECTION = 'outbound' AND m.CAMPAIGN_NAME = 'API SMS Receipt'"},
    "datasets": DATASETS,
    "formulas": FORMULAS,
    "reports": REPORTS,
    "dashboards": DASHBOARDS,
    "benchmarks": BENCHMARKS,
    "checked": receipt_sql.checked,
}
