"""Email Campaign Reports (Warehouse), version 1: C360Report's email campaign suite on the marketing warehouse's own
tables, as a base pack. Five datasets (sql), their shared formulas, the reports and two dashboards.

This is the sibling of the Email Campaign Reports pack. That one reads the sending platform's log, which holds every
message the relay handled and no campaigns; this one reads the warehouse, where the campaigns and their audiences
live. A workspace adds whichever matches the database it has - or both, if it has both.

Field keys follow from the labels as Report Databases makes them (Machine Open -> machine_open), so a report names a
field by its label slugged; tests/test_insights_base_reports.py holds the packs to it. A report or a tile names a
dataset or a report by its id here; adding the pack swaps in what this workspace made.
"""
from . import sql as warehouse_sql


def _dim(column, label, type_="string", sensitivity="NORMAL", format_=None):
    return {"column": column, "label": label, "type": type_, "role": "dimension", "aggregates": [], "format": format_,
            "sensitivity": sensitivity, "table": "t0"}


def _measure(column, label, format_="integer"):
    return {"column": column, "label": label, "type": "number", "role": "measure",
            "aggregates": ["sum", "avg", "min", "max"], "format": format_, "sensitivity": "NORMAL", "table": "t0"}


def _formula(dataset, label, expression, description, format_="percent"):
    return {"dataset": dataset, "label": label, "kind": "measure", "expression": expression,
            "description": description, "format": format_}


CAMPAIGN_FIELDS = [
    _dim("campaign_id", "Campaign Id"), _dim("campaign_name", "Campaign Name"), _dim("warehouse", "Warehouse"),
    _dim("first_send", "First Send", "datetime", format_="datetime"),
    _dim("last_send", "Last Send", "datetime", format_="datetime"),
    _measure("recipients", "Recipients"), _measure("reached", "Reached"), _measure("messages", "Messages"),
    _measure("openers", "Openers"), _measure("clickers", "Clickers"), _measure("bounced", "Bounced"),
    _measure("unsubscribed", "Unsubscribed"),
]
MESSAGE_FIELDS = [
    _dim("message_key", "Message Key"), _dim("campaign_id", "Campaign Id"), _dim("campaign_name", "Campaign Name"),
    _dim("warehouse", "Warehouse"), _dim("party_id", "Party Id", sensitivity="PII"),
    _dim("sent_at", "Sent At", "datetime", format_="datetime"),
    _dim("bounced_at", "Bounced At", "datetime", format_="datetime"), _dim("bounce_status", "Bounce Status"),
    _measure("sent", "Sent"), _measure("opened", "Opened"), _measure("opens", "Opens"),
    _measure("clicked", "Clicked"), _measure("clicks", "Clicks"), _measure("bounced", "Bounced"),
    _measure("unsubscribed", "Unsubscribed"), _measure("not_opened", "Not Opened"),
]
OPEN_FIELDS = [
    _dim("open_key", "Open Key"), _dim("campaign_id", "Campaign Id"), _dim("campaign_name", "Campaign Name"),
    _dim("warehouse", "Warehouse"), _dim("party_id", "Party Id", sensitivity="PII"),
    _dim("opened_at", "Opened At", "datetime", format_="datetime"),
    _dim("device_type", "Device Type"), _dim("opened_by", "Opened By"),
    _measure("opens", "Opens"), _measure("human_open", "Human Open"), _measure("machine_open", "Machine Open"),
]
CLICK_FIELDS = [
    _dim("click_key", "Click Key"), _dim("campaign_id", "Campaign Id"), _dim("campaign_name", "Campaign Name"),
    _dim("warehouse", "Warehouse"), _dim("party_id", "Party Id", sensitivity="PII"),
    _dim("clicked_at", "Clicked At", "datetime", format_="datetime"), _dim("device_type", "Device Type"),
    _measure("clicks", "Clicks"),
]
DOMAIN_FIELDS = [
    _dim("delivery_key", "Delivery Key"), _dim("campaign_id", "Campaign Id"), _dim("campaign_name", "Campaign Name"),
    _dim("warehouse", "Warehouse"), _dim("domain", "Domain"), _dim("provider", "Provider"),
    _dim("sent_at", "Sent At", "datetime", format_="datetime"),
    _dim("bounced_at", "Bounced At", "datetime", format_="datetime"),
    _dim("bounce_type", "Bounce Type"), _dim("bounce_class", "Bounce Class"),
    _measure("sent", "Sent"), _measure("opened", "Opened"), _measure("clicked", "Clicked"),
    _measure("bounced", "Bounced"), _measure("unsubscribed", "Unsubscribed"),
]

DATASETS = [
    {"id": "campaigns", "label": "Email Campaigns",
     "description": "One row per campaign: who it reached, who opened, clicked, bounced and unsubscribed.",
     "sql": warehouse_sql.campaigns_sql, "fields": CAMPAIGN_FIELDS, "time_field": "first_send", "primary_key": "campaign_id"},
    {"id": "messages", "label": "Email Messages",
     "description": "One row per person per campaign. The warehouse keeps several rows for one recipient; this is the grain that does not double-count them.",
     "sql": warehouse_sql.messages_sql, "fields": MESSAGE_FIELDS, "time_field": "sent_at", "primary_key": "message_key"},
    {"id": "opens", "label": "Email Opens",
     "description": "One row per open, by what fetched it: image proxies, security scanners and agent-less fetches apart from people.",
     "sql": warehouse_sql.opens_sql, "fields": OPEN_FIELDS, "time_field": "opened_at", "primary_key": "open_key"},
    {"id": "clicks", "label": "Email Clicks",
     "description": "One row per click, by device. A click needs a person, which is what makes it the engagement figure to trust.",
     "sql": warehouse_sql.clicks_sql, "fields": CLICK_FIELDS, "time_field": "clicked_at", "primary_key": "click_key"},
    {"id": "domains", "label": "Delivery by Domain",
     "description": "One row per recipient domain per campaign: the mailbox provider, and why a message bounced.",
     "sql": warehouse_sql.domains_sql, "fields": DOMAIN_FIELDS, "time_field": "sent_at", "primary_key": "delivery_key"},
]

FORMULAS = [
    _formula("campaigns", "Open Rate", "DIVIDE(SUM([Openers]), SUM([Reached])) * 100",
             "Recipients who opened, as a share of those the campaign reached"),
    _formula("campaigns", "Click Rate", "DIVIDE(SUM([Clickers]), SUM([Reached])) * 100",
             "Recipients who clicked, as a share of those the campaign reached"),
    _formula("campaigns", "Bounce Rate", "DIVIDE(SUM([Bounced]), SUM([Recipients])) * 100",
             "Recipients whose message bounced, as a share of the audience"),
    _formula("campaigns", "Unsubscribe Rate", "DIVIDE(SUM([Unsubscribed]), SUM([Reached])) * 100",
             "Recipients who unsubscribed, as a share of those reached"),
    _formula("campaigns", "Messages per Recipient", "DIVIDE(SUM([Messages]), SUM([Reached]))",
             "How many sends each person got: above 1 means the campaign resent", "decimal"),
    _formula("messages", "Open Rate", "DIVIDE(SUM([Opened]), SUM([Sent])) * 100", "Recipients who opened"),
    _formula("messages", "Click Rate", "DIVIDE(SUM([Clicked]), SUM([Sent])) * 100", "Recipients who clicked"),
    _formula("opens", "Machine Open Share", "DIVIDE(SUM([Machine Open]), SUM([Opens])) * 100",
             "Opens by a proxy, a scanner or an agent-less fetch rather than a person"),
    _formula("opens", "Opens by People Share", "DIVIDE(SUM([Human Open]), SUM([Opens])) * 100",
             "Opens that look like someone reading the mail"),
    _formula("domains", "Bounce Rate", "DIVIDE(SUM([Bounced]), SUM([Sent])) * 100", "Bounces as a share of what was sent"),
]

# What "good" means for the campaign rates. An open rate here counts recorded opens, most of which are machines, so
# the band that matters is the click rate: it needs a person.
BENCHMARKS = [
    {"dataset": "campaigns", "measure": "f_bounce_rate", "higher": False, "good": 2, "act": 5, "count": "bounced", "base": "recipients"},
    {"dataset": "campaigns", "measure": "f_click_rate", "higher": True, "good": 1.5, "act": 0.3, "count": "clickers", "base": "reached"},
    {"dataset": "campaigns", "measure": "f_unsubscribe_rate", "higher": False, "good": 0.3, "act": 0.5, "count": "unsubscribed", "base": "reached"},
    {"dataset": "opens", "measure": "f_opens_by_people_share", "higher": True, "good": 20, "act": 5, "count": "human_open", "base": "opens"},
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
            [_sum("reached"), _sum("openers"), _calc("f_open_rate"), _sum("clickers"), _calc("f_click_rate"),
             _sum("bounced"), _calc("f_bounce_rate"), _sum("unsubscribed"), _calc("f_unsubscribe_rate")],
            "Reached, opened, clicked, bounced and unsubscribed for a campaign, with their rates."),
    _report("totals", "All Campaigns Totals", "campaigns",
            [_sum("recipients"), _sum("reached"), _sum("openers"), _calc("f_open_rate"), _sum("clickers"),
             _calc("f_click_rate"), _sum("bounced"), _calc("f_bounce_rate"), _sum("unsubscribed")],
            "The same figures over every campaign in the period: the Management Dashboard's totals.", campaign=ANY_CAMPAIGN),
    _report("comparison", "Campaign Comparison", "campaigns",
            [{"field": "campaign_name"}, {"field": "first_send"}, _sum("reached"), _sum("openers"), _calc("f_open_rate"),
             _sum("clickers"), _calc("f_click_rate"), _sum("bounced"), _calc("f_bounce_rate"), _sum("unsubscribed")],
            "Campaigns side by side; pick the ones to compare, or see every campaign in the period.",
            view={"type": "grid", "formats": [{"column": "f_click_rate", "style": "bars"}, {"column": "f_bounce_rate", "style": "scale"}]},
            order=[{"field": "first_send", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("resends", "Audience and Resends", "campaigns",
            [{"field": "campaign_name"}, _sum("recipients"), _sum("reached"), _sum("messages"), _calc("f_messages_per_recipient")],
            "How many people a campaign was meant for, how many it reached, and how often it sent to the same person.",
            order=[{"field": "recipients", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("honest_opens", "Engagement, Honestly Measured", "opens",
            [{"field": "opened_by"}, _sum("opens"), _sum("human_open", label="Opens by People"),
             _sum("machine_open", label="Machine Opens"), _calc("f_machine_open_share")],
            "Who fetched the tracking pixel. Image proxies, security gateways and agent-less fetches are not readers, "
            "and on most lists they are nearly all of it.",
            view={"type": "chart", "chart": "bar"}, order=[{"field": "opens", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("opens_by_day", "Opens over Time", "opens",
            [{"field": "opened_at", "bucket": "day"}, _sum("human_open", label="Opens by People"), _sum("machine_open", label="Machine Opens")],
            "Opens by day after the send, people apart from machines.",
            view={"type": "chart", "chart": "stacked"}, order=[{"field": "opened_at", "direction": "asc"}]),
    _report("devices", "Opens by Device", "opens",
            [{"field": "device_type"}, {"field": "opened_by"}, _sum("opens"), _sum("human_open", label="Opens by People")],
            "Opens by the device the warehouse recorded, then by what fetched them. Device is recorded on few of them, "
            "so read this as a sample rather than the audience.",
            view={"type": "hierarchy"}, order=[{"field": "opens", "direction": "desc"}]),
    _report("providers", "Mailbox Providers", "domains",
            [{"field": "provider"}, _sum("sent"), _sum("opened"), _sum("clicked"), _sum("bounced"), _calc("f_bounce_rate")],
            "Gmail, Yahoo, Microsoft, Apple and the rest: how each delivers and bounces.",
            order=[{"field": "sent", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("bounces", "Why Mail Bounced", "domains",
            [{"field": "bounce_class"}, {"field": "bounce_type"}, _sum("bounced")],
            "Every bounce by what the mailbox said. The reason text carries recipients' own addresses, so only the class is kept.",
            filters=[{"field": "bounced", "operator": ">", "value": 0}],
            order=[{"field": "bounced", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("list_quality", "Address and List Quality", "domains",
            [{"field": "domain"}, _sum("sent"), _sum("bounced"), _calc("f_bounce_rate"), _sum("opened")],
            "The receiving domains with the most mail, and how each delivers: where the list needs cleaning.",
            view={"type": "grid", "formats": [{"column": "f_bounce_rate", "style": "scale"}]},
            order=[{"field": "sent", "direction": "desc"}], top={"n": 20, "others": True}, campaign=ANY_CAMPAIGN),
    _report("clicks_by_device", "Clicks by Device", "clicks",
            [{"field": "device_type"}, _sum("clicks")],
            "The devices clicks came from. Unlike an open, a click needs a person.",
            order=[{"field": "clicks", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("customers", "Customer Detail", "messages",
            [{"field": "party_id"}, {"field": "sent_at"}, _sum("sent"), _sum("opened"), _sum("opens"), _sum("clicked"),
             _sum("clicks"), _sum("bounced"), _sum("unsubscribed")],
            "One line per recipient of a campaign: reached, opened, clicked, bounced, unsubscribed. Export it for follow-up.",
            order=[{"field": "sent_at", "direction": "asc"}]),
    _report("unsubscribes", "Unsubscribes", "messages",
            [{"field": "party_id"}, {"field": "sent_at"}, _sum("unsubscribed")],
            "Who unsubscribed from a campaign.",
            filters=[{"field": "unsubscribed", "operator": "=", "value": 1}],
            order=[{"field": "sent_at", "direction": "asc"}]),
    _report("best_click", "Best Campaigns by Click Rate", "campaigns",
            [{"field": "campaign_name"}, _calc("f_click_rate"), _sum("clickers"), _sum("reached")],
            "The five campaigns with the highest click rate in the period.",
            view={"type": "chart", "chart": "bar"}, order=[{"field": "f_click_rate", "direction": "desc"}],
            campaign=ANY_CAMPAIGN, top={"n": 5, "others": False}),
    _report("worst_bounce", "Highest Bounce Rate Campaigns", "campaigns",
            [{"field": "campaign_name"}, _calc("f_bounce_rate"), _sum("bounced"), _sum("recipients")],
            "The five campaigns that bounced most in the period.",
            view={"type": "chart", "chart": "bar"}, order=[{"field": "f_bounce_rate", "direction": "desc"}],
            campaign=ANY_CAMPAIGN, top={"n": 5, "others": False}),
]


def _figure(id_, report, measure, title):
    return {"id": id_, "report": report, "show": "figure", "measure": measure, "title": title}


def _tile(id_, report, show, title):
    return {"id": id_, "report": report, "show": show, "title": title}


DASHBOARDS = [
    {"id": "management", "name": "Management Dashboard",
     "description": "Every campaign in the period: totals, each campaign, the best and the worst, providers and list quality.",
     "period": {"preset": "90d"}, "compare": True,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("reached", "totals", "reached", "Recipients Reached"),
                                  _figure("openers", "totals", "openers", "Opened"),
                                  _figure("clickers", "totals", "clickers", "Clicked"),
                                  _figure("bounced", "totals", "bounced", "Bounced")]},
         {"width": "1", "tiles": [_tile("comparison", "comparison", "grid", "Campaigns in the Period")]},
         {"width": "2", "tiles": [_tile("best", "best_click", "chart", "Best by Click Rate"),
                                  _tile("worst", "worst_bounce", "chart", "Highest Bounce Rate")]},
         {"width": "2", "tiles": [_tile("providers", "providers", "grid", "Mailbox Providers"),
                                  _tile("quality", "list_quality", "grid", "Address and List Quality")]},
     ]}},
    {"id": "performance", "name": "Campaign Performance",
     "description": "One campaign at a time, the latest unless you pick another, with its engagement measured honestly.",
     "period": {"preset": "90d"}, "compare": False,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("reached", "kpis", "reached", "Recipients Reached"),
                                  _figure("openers", "kpis", "openers", "Opened"),
                                  _figure("clickers", "kpis", "clickers", "Clicked"),
                                  _figure("unsubscribed", "kpis", "unsubscribed", "Unsubscribed")]},
         {"width": "2", "tiles": [_tile("honest", "honest_opens", "chart", "Who Fetched the Pixel"),
                                  _tile("opens", "opens_by_day", "chart", "Opens over Time")]},
         {"width": "2", "tiles": [_tile("bounces", "bounces", "grid", "Why Mail Bounced"),
                                  _tile("devices", "devices", "hierarchy", "Opens by Device")]},
         {"width": "2", "tiles": [_tile("clicks", "clicks_by_device", "grid", "Clicks by Device"),
                                  _tile("resends", "resends", "grid", "Audience and Resends")]},
     ], "slicers": [{"field": "campaign_name", "label": "Campaign"}]}},
]

PACK = {
    "key": "email-campaigns-warehouse",
    "version": 1,
    "name": "Email Campaign Reports (Warehouse)",
    "summary": ("Campaign KPIs and comparisons, audience and resends, engagement measured after the image proxies and "
                "scanners are taken out, bounce reasons, mailbox providers, list quality, clicks by device, customer "
                "detail and unsubscribes; a Management Dashboard and a Campaign Performance dashboard."),
    "source": "C360Report",
    "components": ["insights"],
    "needs": {"engine": "mysql", "label": "a marketing warehouse database",
              "tables": ["mailer_master", "bi_campaign_report_by_domain", "campaign_report_opened", "campaign_report_clicked"]},
    # How the database picker sizes a candidate: its busiest table, and what a campaign row looks like in it.
    "volume": {"table": "mailer_master", "alias": "m", "where": "m.SENT > 0"},
    "datasets": DATASETS,
    "formulas": FORMULAS,
    "reports": REPORTS,
    "dashboards": DASHBOARDS,
    "benchmarks": BENCHMARKS,
    "checked": warehouse_sql.checked,
}
