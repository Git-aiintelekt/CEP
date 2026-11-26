"""eReceipt Reports, version 1: C360Report's E-Receipt Intelligence Suite as a base pack. Two datasets (sql), their
shared formulas, the reports and a dashboard.

The two datasets answer different questions and count different things - the mail that went out, and every invoice
split by how the customer took their receipt. They are kept apart on purpose; adding them would be nonsense.
"""
from . import sql as ereceipt_sql


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
    _dim("sent_at", "Sent At", "datetime", format_="datetime"),
    _dim("opened_at", "Opened At", "datetime", format_="datetime"),
    _dim("clicked_at", "Clicked At", "datetime", format_="datetime"),
    _dim("bounced_at", "Bounced At", "datetime", format_="datetime"),
    _dim("receipt_type", "Receipt Type"), _dim("mail_status", "Mail Status"), _dim("store", "Store"),
    _dim("region", "Region"), _dim("district", "District"),
    _dim("opened_device", "Opened Device"), _dim("clicked_device", "Clicked Device"),
    _dim("bounce_reason", "Bounce Reason"),
    _measure("receipts", "Receipts"), _measure("opened", "Opened"), _measure("opens", "Opens"),
    _measure("clicked", "Clicked"), _measure("clicks", "Clicks"), _measure("bounced", "Bounced"),
    _measure("unsubscribed", "Unsubscribed"), _measure("tries", "Tries"),
]
ADOPTION_FIELDS = [
    _dim("day", "Day", "date", format_="date"), _dim("analysis_database", "Analysis Database"),
    _dim("store", "Store"), _dim("region", "Region"), _dim("district", "District"),
    _dim("city", "City"), _dim("state", "State"), _dim("brand", "Brand"), _dim("store_status", "Store Status"),
    _measure("invoices", "Invoices"), _measure("email_receipts", "Email Receipts"),
    _measure("text_receipts", "Text Receipts"), _measure("both_receipts", "Both Receipts"),
    _measure("printed", "Printed"), _measure("no_receipt", "No Receipt"),
    _measure("customers", "Customers"), _measure("guests", "Guests"),
]

DATASETS = [
    {"id": "adoption", "label": "Receipt Adoption",
     "description": "One row per store per day: every invoice split by how the customer took their receipt - email, text, printed or none.",
     "sql": ereceipt_sql.adoption_sql, "fields": ADOPTION_FIELDS, "time_field": "day", "primary_key": "store"},
    {"id": "receipts", "label": "eReceipt Emails",
     "description": "One row per e-receipt email: delivered, opened, clicked or bounced. Covers the e-receipt mail only, not every invoice.",
     "sql": ereceipt_sql.receipts_sql, "fields": RECEIPT_FIELDS, "time_field": "sent_at", "primary_key": "receipt_key"},
]

FORMULAS = [
    _formula("adoption", "Digital Receipt Share", "DIVIDE(SUM([Email Receipts]) + SUM([Text Receipts]), SUM([Invoices])) * 100",
             "Invoices where the customer took the receipt by email or text"),
    _formula("adoption", "Text Receipt Share", "DIVIDE(SUM([Text Receipts]), SUM([Invoices])) * 100",
             "Invoices where the receipt went out as a text"),
    _formula("adoption", "Email Receipt Share", "DIVIDE(SUM([Email Receipts]), SUM([Invoices])) * 100",
             "Invoices where the receipt went out as an email"),
    _formula("adoption", "Printed Share", "DIVIDE(SUM([Printed]), SUM([Invoices])) * 100",
             "Invoices where the receipt was printed at the till"),
    _formula("adoption", "No Receipt Share", "DIVIDE(SUM([No Receipt]), SUM([Invoices])) * 100",
             "Invoices where the customer took no receipt at all"),
    _formula("adoption", "Known Customer Share", "DIVIDE(SUM([Customers]), SUM([Invoices])) * 100",
             "Invoices with a customer behind them rather than a guest"),
    _formula("receipts", "Open Rate", "DIVIDE(SUM([Opened]), SUM([Receipts])) * 100", "E-receipts that were opened"),
    _formula("receipts", "Click Rate", "DIVIDE(SUM([Clicked]), SUM([Opened])) * 100", "Opened e-receipts whose link was followed"),
    _formula("receipts", "Bounce Rate", "DIVIDE(SUM([Bounced]), SUM([Receipts])) * 100", "E-receipts that bounced"),
]

BENCHMARKS = [
    {"dataset": "adoption", "measure": "f_digital_receipt_share", "higher": True, "good": 40, "act": 20, "count": "text_receipts", "base": "invoices"},
    {"dataset": "adoption", "measure": "f_no_receipt_share", "higher": False, "good": 25, "act": 40, "count": "no_receipt", "base": "invoices"},
    {"dataset": "receipts", "measure": "f_bounce_rate", "higher": False, "good": 1, "act": 3, "count": "bounced", "base": "receipts"},
]

ANY_STORE = {"key": "store", "field": "store", "label": "Stores", "operator": "in", "required": False}
ANY_REGION = {"key": "region", "field": "region", "label": "Regions", "operator": "in", "required": False}


def _period(field):
    return {"key": "period", "field": field, "label": "Period", "operator": "period", "required": True, "default": "quarter"}


def _report(id_, name, dataset, columns, description, *, view=None, order=None, filters=None, top=None, pick=ANY_REGION):
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
    _report("kpis", "Receipt Adoption KPIs", "adoption",
            [_sum("invoices"), _sum("text_receipts"), _sum("email_receipts"), _sum("printed"), _sum("no_receipt"),
             _calc("f_digital_receipt_share"), _calc("f_no_receipt_share")],
            "Every invoice in the period, split by how the customer took their receipt."),
    _report("by_region", "Adoption by Region, District and Store", "adoption",
            [{"field": "region"}, {"field": "district"}, {"field": "store"}, _sum("invoices"),
             _sum("text_receipts"), _sum("email_receipts"), _calc("f_digital_receipt_share"),
             _calc("f_no_receipt_share")],
            "Which stores get a digital receipt into a customer's hands and which still print everything.",
            view={"type": "hierarchy"}, order=[{"field": "invoices", "direction": "desc"}]),
    _report("over_time", "Adoption over Time", "adoption",
            [{"field": "day", "bucket": "week"}, _sum("text_receipts"), _sum("email_receipts"), _sum("printed"),
             _sum("no_receipt")],
            "How the split between text, email, printed and no receipt moves week by week.",
            view={"type": "chart", "chart": "stacked"}, order=[{"field": "day", "direction": "asc"}]),
    _report("leaders", "Best and Worst Stores", "adoption",
            [{"field": "store"}, {"field": "region"}, _sum("invoices"), _calc("f_digital_receipt_share"),
             _calc("f_printed_share")],
            "Stores ranked by the share of receipts that went out digitally.",
            view={"type": "grid", "formats": [{"column": "f_digital_receipt_share", "style": "bars"}]},
            order=[{"field": "f_digital_receipt_share", "direction": "desc"}], top={"n": 25, "others": True}),
    _report("customers", "Customers and Guests", "adoption",
            [{"field": "region"}, _sum("invoices"), _sum("customers"), _sum("guests"),
             _calc("f_known_customer_share")],
            "How much of the till is a known customer rather than a guest: the ceiling on any digital receipt.",
            order=[{"field": "invoices", "direction": "desc"}]),
    _report("brands", "Adoption by Brand and State", "adoption",
            [{"field": "brand"}, {"field": "state"}, _sum("invoices"), _calc("f_digital_receipt_share")],
            "The same split across brands and states, from the store master.",
            order=[{"field": "invoices", "direction": "desc"}], top={"n": 25, "others": True}),
    _report("mail_kpis", "eReceipt Email KPIs", "receipts",
            [_sum("receipts"), _sum("opened"), _calc("f_open_rate"), _sum("clicked"), _calc("f_click_rate"),
             _sum("bounced"), _calc("f_bounce_rate")],
            "The e-receipt mail itself: sent, opened, clicked and bounced.", pick=ANY_STORE),
    _report("mail_devices", "eReceipts by Device", "receipts",
            [{"field": "opened_device"}, _sum("opened"), _sum("opens"), _sum("clicked")],
            "The devices e-receipts were opened on. Most carry no device at all, so read this as a sample.",
            filters=[{"field": "opened", "operator": "=", "value": 1}],
            order=[{"field": "opened", "direction": "desc"}], pick=ANY_STORE),
    _report("mail_failures", "Why eReceipts Bounced", "receipts",
            [{"field": "bounce_reason"}, _sum("bounced"), _sum("tries")],
            "The mail server's reason for each e-receipt that did not arrive, and how many attempts it took.",
            filters=[{"field": "bounced", "operator": "=", "value": 1}],
            order=[{"field": "bounced", "direction": "desc"}], pick=ANY_STORE),
    _report("mail_by_store", "eReceipt Mail by Store", "receipts",
            [{"field": "region"}, {"field": "store"}, _sum("receipts"), _sum("opened"), _calc("f_open_rate")],
            "Where the e-receipt mail went, and where it got opened.",
            order=[{"field": "receipts", "direction": "desc"}], top={"n": 25, "others": True}, pick=ANY_STORE),
]


def _figure(id_, report, measure, title):
    return {"id": id_, "report": report, "show": "figure", "measure": measure, "title": title}


def _tile(id_, report, show, title):
    return {"id": id_, "report": report, "show": show, "title": title}


DASHBOARDS = [
    {"id": "adoption", "name": "eReceipt Dashboard",
     "description": "Every invoice by how the receipt was taken, which stores lead and lag, and how the e-receipt mail itself performs.",
     "period": {"preset": "90d"}, "compare": True,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("invoices", "kpis", "invoices", "Invoices"),
                                  _figure("text", "kpis", "text_receipts", "Text Receipts"),
                                  _figure("printed", "kpis", "printed", "Printed"),
                                  _figure("none", "kpis", "no_receipt", "No Receipt")]},
         {"width": "1", "tiles": [_tile("regions", "by_region", "hierarchy", "Adoption by Region, District and Store")]},
         {"width": "2", "tiles": [_tile("time", "over_time", "chart", "Adoption over Time"),
                                  _tile("leaders", "leaders", "grid", "Best and Worst Stores")]},
         {"width": "2", "tiles": [_tile("customers", "customers", "grid", "Customers and Guests"),
                                  _tile("mail", "mail_kpis", "grid", "eReceipt Email")]},
     ], "slicers": [{"field": "region", "label": "Region"}]}},
]

PACK = {
    "key": "ereceipts",
    "version": 1,
    "name": "eReceipt Reports",
    "summary": ("Receipt adoption KPIs, adoption by region, district and store, how the split moves over time, the "
                "best and worst stores, customers against guests, brand and state, and the e-receipt mail's own "
                "opens, devices and bounces; an eReceipt dashboard."),
    "source": "C360Report",
    "components": ["insights"],
    "needs": {"engine": "mysql", "label": "an analysis database",
              "tables": ["ereceipt_report", "ereceipt_summary_report", "tt_store_imp_1"]},
    "volume": {"table": "ereceipt_summary_report", "alias": "s", "where": "s.INVOICE_COUNT > 0"},
    "datasets": DATASETS,
    "formulas": FORMULAS,
    "reports": REPORTS,
    "dashboards": DASHBOARDS,
    "benchmarks": BENCHMARKS,
    "checked": ereceipt_sql.checked,
}
