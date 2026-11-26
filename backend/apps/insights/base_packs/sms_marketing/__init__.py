"""SMS Marketing Reports, version 1: C360Report's SMS Marketing Intelligence Suite as a base pack. Four datasets
(sql), their shared formulas, the reports and two dashboards.

Scope is CAMPAIGN_TYPE sms / mms. The receipt flow lives in the same table and has its own pack; keeping them apart
is what stops a receipt's delivery rate flattering a campaign's.

Field keys follow from the labels as Report Databases makes them (Human Click -> human_click), so a report names a
field by its label slugged, and every column here is named to match its label.
"""
from . import sql as sms_sql


def _dim(column, label, type_="string", sensitivity="NORMAL", format_=None):
    return {"column": column, "label": label, "type": type_, "role": "dimension", "aggregates": [], "format": format_,
            "sensitivity": sensitivity, "table": "t0"}


def _measure(column, label, format_="integer"):
    return {"column": column, "label": label, "type": "number", "role": "measure",
            "aggregates": ["sum", "avg", "min", "max"], "format": format_, "sensitivity": "NORMAL", "table": "t0"}


def _formula(dataset, label, expression, description, format_="percent"):
    return {"dataset": dataset, "label": label, "kind": "measure", "expression": expression,
            "description": description, "format": format_}


MESSAGE_FIELDS = [
    _dim("message_key", "Message Key"), _dim("campaign_name", "Campaign Name"), _dim("channel", "Channel"),
    _dim("analysis_database", "Analysis Database"), _dim("sent_at", "Sent At", "datetime", format_="datetime"),
    _dim("status", "Status"), _dim("carrier", "Carrier"), _dim("link_type", "Link Type"),
    _dim("device_type", "Device Type"), _dim("click_delay", "Click Delay"),
    _dim("error_code", "Error Code"), _dim("error_message", "Error Message"),
    _measure("messages", "Messages"), _measure("delivered", "Delivered"), _measure("failed", "Failed"),
    _measure("segments", "Segments"), _measure("clicked", "Clicked"), _measure("click_events", "Click Events"),
    _measure("human_click", "Human Click"), _measure("instant_click", "Instant Click"),
    _measure("purchased", "Purchased"), _measure("sales", "Sales", "money"),
]
CAMPAIGN_FIELDS = [
    _dim("campaign_name", "Campaign Name"), _dim("channel", "Channel"),
    _dim("analysis_database", "Analysis Database"),
    _dim("first_send", "First Send", "datetime", format_="datetime"),
    _dim("last_send", "Last Send", "datetime", format_="datetime"),
    _measure("messages", "Messages"), _measure("recipients", "Recipients"), _measure("delivered", "Delivered"),
    _measure("failed", "Failed"), _measure("segments", "Segments"), _measure("clicked", "Clicked"),
    _measure("human_click", "Human Click"), _measure("click_events", "Click Events"),
    _measure("purchased", "Purchased"), _measure("sales", "Sales", "money"),
]
FAILURE_FIELDS = [
    _dim("campaign_name", "Campaign Name"), _dim("analysis_database", "Analysis Database"),
    _dim("sent_at", "Sent At", "datetime", format_="datetime"), _dim("carrier", "Carrier"),
    _dim("error_code", "Error Code"), _dim("failure_reason", "Failure Reason"),
    _dim("failure_class", "Failure Class"),
    _measure("failures", "Failures"),
]
STORE_FIELDS = [
    _dim("day", "Day", "date", format_="date"), _dim("campaign_name", "Campaign Name"), _dim("channel", "Channel"),
    _dim("analysis_database", "Analysis Database"), _dim("region", "Region"), _dim("district", "District"),
    _dim("store", "Store"), _dim("city", "City"), _dim("device_type", "Device Type"),
    _measure("sent", "Sent"), _measure("delivered", "Delivered"), _measure("failed", "Failed"),
    _measure("customers", "Customers"), _measure("clicks", "Clicks"), _measure("clickers", "Clickers"),
    _measure("transactions", "Transactions"), _measure("sales", "Sales", "money"),
    _measure("engagement_score", "Engagement Score", "decimal"),
    _measure("average_order_value", "Average Order Value", "money"),
]

DATASETS = [
    {"id": "messages", "label": "SMS Messages",
     "description": "One row per outbound marketing text: delivered or not, clicked or not, and how long the click took.",
     "sql": sms_sql.messages_sql, "fields": MESSAGE_FIELDS, "time_field": "sent_at", "primary_key": "message_key"},
    {"id": "campaigns", "label": "SMS Campaigns",
     "description": "One row per campaign: its window, what it sent, what it cost in segments and what came back.",
     "sql": sms_sql.campaigns_sql, "fields": CAMPAIGN_FIELDS, "time_field": "first_send", "primary_key": "campaign_name"},
    {"id": "failures", "label": "SMS Failures",
     "description": "One row per text that did not arrive, by the carrier's reason and what kind of problem it is.",
     "sql": sms_sql.failures_sql, "fields": FAILURE_FIELDS, "time_field": "sent_at", "primary_key": "campaign_name"},
    {"id": "stores", "label": "SMS by Store",
     "description": "The warehouse's own campaign summary by day, region, district, store and device.",
     "sql": sms_sql.stores_sql, "fields": STORE_FIELDS, "time_field": "day", "primary_key": "store"},
]

FORMULAS = [
    _formula("campaigns", "Delivery Rate", "DIVIDE(SUM([Delivered]), SUM([Messages])) * 100",
             "Texts the carrier accepted, as a share of those sent"),
    _formula("campaigns", "Failure Rate", "DIVIDE(SUM([Failed]), SUM([Messages])) * 100",
             "Texts that did not arrive, as a share of those sent"),
    _formula("campaigns", "Click Rate", "DIVIDE(SUM([Clicked]), SUM([Delivered])) * 100",
             "Every recorded click, as a share of delivered - previews and scanners included"),
    _formula("campaigns", "Human Click Rate", "DIVIDE(SUM([Human Click]), SUM([Delivered])) * 100",
             "Clicks after a pause long enough to be a person, as a share of delivered"),
    _formula("campaigns", "Segments per Message", "DIVIDE(SUM([Segments]), SUM([Messages]))",
             "Billed carrier segments each text used: the cost of a long message", "decimal"),
    _formula("campaigns", "Purchase Rate", "DIVIDE(SUM([Purchased]), SUM([Delivered])) * 100",
             "Recipients with a transaction against the text, as a share of delivered"),
    _formula("campaigns", "Revenue per Message", "DIVIDE(SUM([Sales]), SUM([Messages]))",
             "Attributed sales for each text sent", "money"),
    _formula("messages", "Human Click Share", "DIVIDE(SUM([Human Click]), SUM([Clicked])) * 100",
             "Clicks that waited long enough to be a person, as a share of every recorded click"),
    _formula("stores", "Delivery Rate", "DIVIDE(SUM([Delivered]), SUM([Sent])) * 100", "Delivered as a share of sent"),
    _formula("stores", "Click Rate", "DIVIDE(SUM([Clickers]), SUM([Delivered])) * 100", "Clickers as a share of delivered"),
]

BENCHMARKS = [
    {"dataset": "campaigns", "measure": "f_delivery_rate", "higher": True, "good": 95, "act": 90, "count": "delivered", "base": "messages"},
    {"dataset": "campaigns", "measure": "f_failure_rate", "higher": False, "good": 3, "act": 8, "count": "failed", "base": "messages"},
    {"dataset": "campaigns", "measure": "f_human_click_rate", "higher": True, "good": 2, "act": 0.5, "count": "human_click", "base": "delivered"},
    {"dataset": "messages", "measure": "f_human_click_share", "higher": True, "good": 30, "act": 10, "count": "human_click", "base": "clicked"},
]

LATEST_CAMPAIGN = {"key": "campaign", "field": "campaign_name", "label": "Campaign", "operator": "in", "required": False, "default": {"latest": True}}
ANY_CAMPAIGN = {"key": "campaign", "field": "campaign_name", "label": "Campaigns", "operator": "in", "required": False}


def _period(field):
    return {"key": "period", "field": field, "label": "Period", "operator": "period", "required": True, "default": "quarter"}


def _report(id_, name, dataset, columns, description, *, view=None, order=None, campaign=LATEST_CAMPAIGN, filters=None, top=None):
    time_field = next(d["time_field"] for d in DATASETS if d["id"] == dataset)
    definition = {"columns": columns, "filters": {"combinator": "and", "rules": filters or []}, "orderBy": order or [],
                  "view": view or {"type": "grid"}, "parameters": [campaign, _period(time_field)], "limit": 500,
                  **({"top": top} if top else {})}
    return {"id": id_, "name": name, "dataset": dataset, "description": description, "definition": definition}


def _sum(field, **extra):
    return {"field": field, "aggregate": "sum", **extra}


def _calc(field):
    return {"field": field, "aggregate": "calc"}


REPORTS = [
    _report("kpis", "Campaign KPIs", "campaigns",
            [_sum("messages"), _sum("recipients"), _sum("delivered"), _calc("f_delivery_rate"), _sum("clicked"),
             _calc("f_click_rate"), _sum("human_click"), _calc("f_human_click_rate"), _sum("sales")],
            "Sent, delivered, clicked and attributed sales for a campaign, with every rate counted twice where a "
            "click can be a preview."),
    _report("totals", "All Campaigns Totals", "campaigns",
            [_sum("messages"), _sum("delivered"), _calc("f_delivery_rate"), _sum("clicked"), _sum("human_click"),
             _calc("f_human_click_rate"), _sum("purchased"), _sum("sales")],
            "The same figures over every campaign in the period.", campaign=ANY_CAMPAIGN),
    _report("comparison", "Campaign Comparison", "campaigns",
            [{"field": "campaign_name"}, {"field": "channel"}, {"field": "first_send"}, _sum("messages"),
             _sum("delivered"), _calc("f_delivery_rate"), _sum("human_click"), _calc("f_human_click_rate"),
             _sum("sales"), _calc("f_revenue_per_message")],
            "Campaigns side by side; pick the ones to compare, or see every campaign in the period.",
            view={"type": "grid", "formats": [{"column": "f_human_click_rate", "style": "bars"},
                                              {"column": "f_delivery_rate", "style": "scale"}]},
            order=[{"field": "first_send", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("honest_clicks", "Clicks, Honestly Measured", "messages",
            [{"field": "click_delay"}, _sum("clicked"), _sum("human_click"), _sum("instant_click")],
            "How long after the send each click arrived. A carrier's scanner and a handset's link preview follow a "
            "link at once; a person takes a moment.",
            view={"type": "chart", "chart": "bar"}, filters=[{"field": "clicked", "operator": "=", "value": 1}],
            order=[{"field": "clicked", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("delivery", "Delivery Health", "campaigns",
            [{"field": "campaign_name"}, _sum("messages"), _sum("delivered"), _calc("f_delivery_rate"),
             _sum("failed"), _calc("f_failure_rate")],
            "Which campaigns arrived and which did not.",
            order=[{"field": "f_failure_rate", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("failures", "Why Texts Failed", "failures",
            [{"field": "failure_class"}, {"field": "failure_reason"}, {"field": "error_code"}, _sum("failures")],
            "Every text that did not arrive, by the carrier's own reason and the kind of problem behind it.",
            order=[{"field": "failures", "direction": "desc"}], top={"n": 20, "others": True}, campaign=ANY_CAMPAIGN),
    _report("carriers", "Carrier Performance", "messages",
            [{"field": "carrier"}, _sum("messages"), _sum("delivered"), _sum("failed"), _sum("human_click")],
            "How each carrier treats this sender.",
            order=[{"field": "messages", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("segments", "Segments and Cost", "campaigns",
            [{"field": "campaign_name"}, {"field": "channel"}, _sum("messages"), _sum("segments"),
             _calc("f_segments_per_message")],
            "Billed carrier segments per campaign: a longer message costs more to send.",
            order=[{"field": "segments", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("devices", "Clicks by Device", "messages",
            [{"field": "device_type"}, _sum("clicked"), _sum("human_click")],
            "The devices clicks came from, previews apart from people.",
            filters=[{"field": "clicked", "operator": "=", "value": 1}],
            order=[{"field": "clicked", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("links", "Link Types", "messages",
            [{"field": "link_type"}, _sum("messages"), _sum("clicked"), _sum("human_click")],
            "Which kind of link a text carried, and which got followed.",
            order=[{"field": "messages", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("regions", "Region, District and Store", "stores",
            [{"field": "region"}, {"field": "district"}, {"field": "store"}, _sum("sent"), _sum("delivered"),
             _calc("f_delivery_rate"), _sum("clickers"), _sum("sales")],
            "The warehouse's own store summary. The default store and strays sit in their own buckets rather than "
            "being blended into a region.",
            view={"type": "hierarchy"}, order=[{"field": "sent", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("revenue", "Attributed Sales", "stores",
            [{"field": "campaign_name"}, _sum("sent"), _sum("transactions"), _sum("sales"),
             _sum("average_order_value", label="Average Order Value")],
            "Transactions and sales the warehouse credits to each campaign.",
            order=[{"field": "sales", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("by_day", "Sending over Time", "campaigns",
            [{"field": "first_send", "bucket": "day"}, _sum("messages"), _sum("delivered"), _sum("human_click")],
            "What went out each day, and what came back.",
            view={"type": "chart", "chart": "stacked"}, order=[{"field": "first_send", "direction": "asc"}],
            campaign=ANY_CAMPAIGN),
    _report("best_click", "Best Campaigns by Human Click Rate", "campaigns",
            [{"field": "campaign_name"}, _calc("f_human_click_rate"), _sum("human_click"), _sum("delivered")],
            "The five campaigns people actually tapped most.",
            view={"type": "chart", "chart": "bar"}, order=[{"field": "f_human_click_rate", "direction": "desc"}],
            campaign=ANY_CAMPAIGN, top={"n": 5, "others": False}),
]


def _figure(id_, report, measure, title):
    return {"id": id_, "report": report, "show": "figure", "measure": measure, "title": title}


def _tile(id_, report, show, title):
    return {"id": id_, "report": report, "show": show, "title": title}


DASHBOARDS = [
    {"id": "management", "name": "SMS Management Dashboard",
     "description": "Every campaign in the period: totals, each campaign side by side, delivery, carriers and sales.",
     "period": {"preset": "90d"}, "compare": True,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("sent", "totals", "messages", "Texts Sent"),
                                  _figure("delivered", "totals", "delivered", "Delivered"),
                                  _figure("clicked", "totals", "human_click", "Clicked by a Person"),
                                  _figure("sales", "totals", "sales", "Attributed Sales")]},
         {"width": "1", "tiles": [_tile("comparison", "comparison", "grid", "Campaigns in the Period")]},
         {"width": "2", "tiles": [_tile("best", "best_click", "chart", "Best by Human Click Rate"),
                                  _tile("delivery", "delivery", "grid", "Delivery Health")]},
         {"width": "2", "tiles": [_tile("carriers", "carriers", "grid", "Carriers"),
                                  _tile("revenue", "revenue", "grid", "Attributed Sales")]},
     ]}},
    {"id": "campaign", "name": "SMS Campaign Performance",
     "description": "One campaign at a time, with its clicks measured honestly and its cost in segments.",
     "period": {"preset": "90d"}, "compare": False,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("sent", "kpis", "messages", "Texts Sent"),
                                  _figure("delivered", "kpis", "delivered", "Delivered"),
                                  _figure("human", "kpis", "human_click", "Clicked by a Person"),
                                  _figure("sales", "kpis", "sales", "Attributed Sales")]},
         {"width": "2", "tiles": [_tile("honest", "honest_clicks", "chart", "How Long the Click Took"),
                                  _tile("devices", "devices", "grid", "Clicks by Device")]},
         {"width": "2", "tiles": [_tile("failures", "failures", "grid", "Why Texts Failed"),
                                  _tile("segments", "segments", "grid", "Segments and Cost")]},
         {"width": "2", "tiles": [_tile("links", "links", "grid", "Link Types"),
                                  _tile("regions", "regions", "hierarchy", "Region, District and Store")]},
     ], "slicers": [{"field": "campaign_name", "label": "Campaign"}]}},
]

PACK = {
    "key": "sms-marketing",
    "version": 1,
    "name": "SMS Marketing Reports",
    "summary": ("Campaign KPIs and comparisons, clicks measured after the previews and scanners are taken out, "
                "delivery health and carrier failures, segments and cost, devices and link types, region, district "
                "and store, and attributed sales; a Management Dashboard and a Campaign Performance dashboard."),
    "source": "C360Report",
    "components": ["insights"],
    "needs": {"engine": "mysql", "label": "an analysis database",
              "tables": ["sms_mailer_master", "sms_mailer_device_summary"]},
    "volume": {"table": "sms_mailer_master", "alias": "m",
               "where": "m.DIRECTION = 'outbound' AND LOWER(COALESCE(m.CAMPAIGN_TYPE, '')) IN ('sms', 'mms')"},
    "datasets": DATASETS,
    "formulas": FORMULAS,
    "reports": REPORTS,
    "dashboards": DASHBOARDS,
    "benchmarks": BENCHMARKS,
    "checked": sms_sql.checked,
}
