"""Email Campaign Reports, version 1: CmpReport's reports on Postal's own tables, as a base pack (docs/mockups/base-reports.html).
Four datasets (email_sql), their shared formulas, the reports and two dashboards. Field keys follow from the labels as Report
Databases makes them (Delivered First Attempt -> delivered_first_attempt); tests/test_insights_base_reports.py holds them to it.
A report or a tile names a dataset or a report by its id here; adding the pack swaps in what this workspace made."""
from . import email_sql


def _dim(column, label, type_="string", sensitivity="NORMAL", format_=None):
    return {"column": column, "label": label, "type": type_, "role": "dimension", "aggregates": [], "format": format_, "sensitivity": sensitivity, "table": "t0"}


def _measure(column, label, format_="integer"):
    return {"column": column, "label": label, "type": "number", "role": "measure", "aggregates": ["sum", "avg", "min", "max"], "format": format_, "sensitivity": "NORMAL", "table": "t0"}


def _formula(dataset, label, expression, description, format_="percent"):
    """a shared formula; a percent is worked out in percent (DIVIDE(...) * 100), as the app shows a percent's value with a % sign"""
    return {"dataset": dataset, "label": label, "kind": "measure", "expression": expression, "description": description, "format": format_}


MESSAGE_FIELDS = [
    _dim("message_key", "Message Key"), _dim("postal_database", "Postal Database"), _dim("campaign_id", "Campaign Id"), _dim("campaign_name", "Campaign Name"),
    _dim("party_id", "Party Id"), _dim("subject", "Subject"), _dim("recipient", "Recipient", sensitivity="PII"), _dim("domain", "Domain"),
    _dim("provider", "Provider"), _dim("sent_at", "Sent At", "datetime", format_="datetime"), _dim("final_status", "Final Status"),
    _measure("sent", "Sent"), _measure("delivered", "Delivered"), _measure("hard_fail", "Hard Fail"), _measure("pending", "Pending"),
    _measure("not_delivered", "Not Delivered"), _measure("attempts", "Attempts"), _measure("retry_attempts", "Retry Attempts"), _measure("retried", "Retried"),
    _measure("delivered_first_attempt", "Delivered First Attempt"), _measure("delivered_after_retry", "Delivered After Retry"), _measure("soft_fails", "Soft Fails"),
    _dim("failure_category", "Failure Category"), _dim("bounce_reply", "Bounce Reply"),
    _measure("opened", "Opened"), _measure("opens", "Opens"), _measure("clicked", "Clicked"), _measure("clicks", "Clicks"), _measure("unsubscribed", "Unsubscribed"),
]
CAMPAIGN_FIELDS = [
    _dim("campaign_id", "Campaign Id"), _dim("campaign_name", "Campaign Name"), _dim("send_start", "Send Start", "datetime", format_="datetime"),
    _dim("send_end", "Send End", "datetime", format_="datetime"), _measure("duration_minutes", "Duration Minutes", "decimal"), _measure("emails_sent", "Emails Sent"),
    _measure("emails_per_minute", "Emails per Minute", "decimal"), _measure("emails_per_hour", "Emails per Hour", "decimal"),
    _measure("delivered_first_attempt", "Delivered First Attempt"), _measure("delivered_after_retry", "Delivered After Retry"), _measure("delivered", "Delivered"),
    _measure("pending_or_failed", "Pending or Failed"), _measure("opened", "Opened"), _measure("clicked", "Clicked"), _measure("unsubscribed", "Unsubscribed"),
    _measure("hard_fail", "Hard Fail"),
]
CLICK_FIELDS = [
    _dim("click_key", "Click Key"), _dim("campaign_id", "Campaign Id"), _dim("campaign_name", "Campaign Name"), _dim("recipient", "Recipient", sensitivity="PII"),
    _dim("message_key", "Message Key"), _dim("sent_at", "Sent At", "datetime", format_="datetime"), _dim("clicked_at", "Clicked At", "datetime", format_="datetime"),
    _dim("url", "Link"), _dim("link_type", "Link Type"), _measure("clicks", "Clicks"),
]
OPEN_FIELDS = [
    _dim("open_key", "Open Key"), _dim("campaign_id", "Campaign Id"), _dim("campaign_name", "Campaign Name"), _dim("recipient", "Recipient", sensitivity="PII"),
    _dim("message_key", "Message Key"), _dim("sent_at", "Sent At", "datetime", format_="datetime"), _dim("opened_at", "Opened At", "datetime", format_="datetime"),
    _dim("device_type", "Device Type"), _dim("operating_system", "Operating System"), _dim("email_client", "Email Client"),
    _measure("machine_open", "Machine Open"), _measure("human_open", "Human Open"), _measure("opens", "Opens"),
]

DATASETS = [
    {"id": "messages", "label": "Email Messages", "description": "One row per marketing email from Postal: delivery, retries, opens, clicks and unsubscribes.",
     "sql": email_sql.messages_sql, "fields": MESSAGE_FIELDS, "time_field": "sent_at", "primary_key": "message_key"},
    {"id": "campaigns", "label": "Email Campaigns", "description": "One row per email campaign: its sending window, speed and totals.",
     "sql": email_sql.campaigns_sql, "fields": CAMPAIGN_FIELDS, "time_field": "send_start", "primary_key": "campaign_id"},
    {"id": "clicks", "label": "Email Link Clicks", "description": "One row per click on a tracked link; unsubscribe links apart from content links.",
     "sql": email_sql.link_clicks_sql, "fields": CLICK_FIELDS, "time_field": "sent_at", "primary_key": "click_key"},
    {"id": "opens", "label": "Email Opens", "description": "One row per open, by device, system and email client; machine opens (privacy proxies, scanners) flagged.",
     "sql": email_sql.opens_sql, "fields": OPEN_FIELDS, "time_field": "sent_at", "primary_key": "open_key"},
]

FORMULAS = [
    _formula("messages", "Delivery Rate", "DIVIDE(SUM([Delivered]), SUM([Sent])) * 100", "Delivered as a share of emails sent"),
    _formula("messages", "Open Rate", "DIVIDE(SUM([Opened]), SUM([Delivered])) * 100", "Recipients who opened, as a share of delivered"),
    _formula("messages", "Click-Through Rate", "DIVIDE(SUM([Clicked]), SUM([Delivered])) * 100", "Recipients who clicked, as a share of delivered"),
    _formula("messages", "Bounce Rate", "DIVIDE(SUM([Hard Fail]), SUM([Sent])) * 100", "Hard fails as a share of emails sent"),
    _formula("messages", "Unsubscribe Rate", "DIVIDE(SUM([Unsubscribed]), SUM([Sent])) * 100", "Unsubscribes as a share of emails sent"),
    _formula("messages", "First-Attempt Rate", "DIVIDE(SUM([Delivered First Attempt]), SUM([Sent])) * 100", "Delivered on the first attempt, as a share of emails sent"),
    _formula("messages", "Retry Recovery", "DIVIDE(SUM([Delivered After Retry]), SUM([Delivered])) * 100", "Deliveries that needed a retry, as a share of delivered"),
    _formula("messages", "Retry %", "DIVIDE(SUM([Retried]), SUM([Sent])) * 100", "Emails that needed more than one attempt"),
    _formula("messages", "Avg Retries per Recipient", "DIVIDE(SUM([Retry Attempts]), SUM([Retried]))", "Retry attempts per retried recipient", "decimal"),
    _formula("campaigns", "Delivery Rate", "DIVIDE(SUM([Delivered]), SUM([Emails Sent])) * 100", "Delivered as a share of emails sent"),
    _formula("campaigns", "Open Rate", "DIVIDE(SUM([Opened]), SUM([Delivered])) * 100", "Recipients who opened, as a share of delivered"),
    _formula("campaigns", "Click-Through Rate", "DIVIDE(SUM([Clicked]), SUM([Delivered])) * 100", "Recipients who clicked, as a share of delivered"),
    _formula("campaigns", "Unsubscribe Rate", "DIVIDE(SUM([Unsubscribed]), SUM([Emails Sent])) * 100", "Unsubscribes as a share of emails sent"),
    _formula("campaigns", "First-Attempt Rate", "DIVIDE(SUM([Delivered First Attempt]), SUM([Emails Sent])) * 100", "Delivered on the first attempt"),
    _formula("campaigns", "Retry Recovery", "DIVIDE(SUM([Delivered After Retry]), SUM([Delivered])) * 100", "Deliveries that needed a retry"),
    _formula("clicks", "Emails Clicked", "DISTINCTCOUNT([Message Key])", "Emails with at least one click on the link", "integer"),
    _formula("opens", "Machine Open Share", "DIVIDE(SUM([Machine Open]), SUM([Opens])) * 100", "Opens by a proxy or scanner rather than a person"),
]

# What "good" means for the messages dataset's rates (Settings -> Benchmarks offers them); count and base make each rate's range
BENCHMARKS = [
    {"dataset": "messages", "measure": "f_delivery_rate", "higher": True, "good": 95, "act": 90, "count": "delivered", "base": "sent"},
    {"dataset": "messages", "measure": "f_bounce_rate", "higher": False, "good": 2, "act": 5, "count": "hard_fail", "base": "sent"},
    {"dataset": "messages", "measure": "f_click_through_rate", "higher": True, "good": 1.5, "act": 0.5, "count": "clicked", "base": "delivered"},
    {"dataset": "messages", "measure": "f_unsubscribe_rate", "higher": False, "good": 0.3, "act": 0.5, "count": "unsubscribed", "base": "sent"},
]

LATEST_CAMPAIGN = {"key": "campaign", "field": "campaign_name", "label": "Campaign", "operator": "in", "required": False, "default": {"latest": True}}
ANY_CAMPAIGN = {"key": "campaign", "field": "campaign_name", "label": "Campaigns", "operator": "in", "required": False}


def _period(field):
    return {"key": "period", "field": field, "label": "Period", "operator": "period", "required": True, "default": "quarter"}


def _report(id_, name, dataset, columns, description, *, view=None, order=None, campaign=LATEST_CAMPAIGN, filters=None, top=None):
    time_field = next(d["time_field"] for d in DATASETS if d["id"] == dataset)
    definition = {"columns": columns, "filters": {"combinator": "and", "rules": filters or []}, "orderBy": order or [], "view": view or {"type": "grid"},
                  "parameters": [campaign, _period(time_field)], "limit": 500, **({"top": top} if top else {})}
    return {"id": id_, "name": name, "dataset": dataset, "description": description, "definition": definition}


def _sum(field, **extra):
    return {"field": field, "aggregate": "sum", **extra}


def _calc(field):
    return {"field": field, "aggregate": "calc"}


REPORTS = [
    _report("kpis", "Campaign KPIs", "messages",
            [_sum("sent"), _sum("delivered"), _calc("f_delivery_rate"), _sum("opened"), _calc("f_open_rate"), _sum("clicked"), _calc("f_click_through_rate"),
             _sum("hard_fail"), _calc("f_bounce_rate"), _sum("unsubscribed"), _calc("f_unsubscribe_rate")],
            "Sent, delivered, opened, clicked, bounced and unsubscribed for a campaign, with their rates."),
    _report("totals", "All Campaigns Totals", "messages",
            [_sum("sent"), _sum("delivered"), _calc("f_delivery_rate"), _sum("opened"), _calc("f_open_rate"), _sum("clicked"), _calc("f_click_through_rate"),
             _sum("hard_fail"), _sum("unsubscribed")],
            "The same figures over every campaign in the period: the Management Dashboard's totals.", campaign=ANY_CAMPAIGN),
    _report("send_status", "Campaign Send Status", "campaigns",
            [{"field": "campaign_name"}, {"field": "send_start"}, {"field": "send_end"}, _sum("duration_minutes"), _sum("emails_sent"), {"field": "emails_per_minute", "aggregate": "avg"},
             {"field": "emails_per_hour", "aggregate": "avg"}, _sum("delivered_first_attempt"), _sum("delivered_after_retry"), _sum("delivered"), _sum("pending_or_failed"),
             _calc("f_delivery_rate"), _calc("f_first_attempt_rate"), _calc("f_retry_recovery")],
            "When a campaign started and finished sending, how fast, and how much was delivered first time or after a retry.",
            order=[{"field": "send_start", "direction": "desc"}]),
    _report("outcomes", "Delivery Outcomes", "messages", [{"field": "failure_category"}, _sum("sent", compare=["percent_of_total"])],
            "Delivered, bad addresses, policy rejections, Postal errors, hard fails and pending, as shares of the emails sent.",
            view={"type": "chart", "chart": "pie"}, order=[{"field": "sent", "direction": "desc"}]),
    _report("failures", "Failure and Bounce Reasons", "messages", [{"field": "failure_category"}, {"field": "bounce_reply"}, _sum("sent", label="Emails")],
            "Every email not delivered, by its category and the receiving server's last reply.",
            filters=[{"field": "failure_category", "operator": "!=", "value": "Delivered"}], order=[{"field": "sent", "direction": "desc"}], top={"n": 25, "others": True}),
    _report("providers", "Provider Performance", "messages",
            [{"field": "provider"}, _sum("sent"), _sum("delivered"), _calc("f_delivery_rate"), _sum("opened"), _calc("f_open_rate"), _sum("clicked"), _sum("soft_fails"), _calc("f_retry")],
            "Gmail, Microsoft, Yahoo and the rest: delivery, opens, clicks and retries, over the campaigns picked or every one in the period.",
            order=[{"field": "sent", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("retries", "Retry Analysis", "messages",
            [{"field": "provider"}, _sum("retry_attempts"), _sum("retried", label="Recipients Retried"), _sum("delivered_after_retry"), _calc("f_avg_retries_per_recipient"), _calc("f_retry_recovery")],
            "How many emails needed another attempt, by provider, and how many got through after it.", order=[{"field": "retry_attempts", "direction": "desc"}]),
    _report("list_quality", "Contact-List Quality", "messages",
            [{"field": "domain"}, _sum("sent"), _sum("delivered"), _calc("f_delivery_rate"), _sum("hard_fail"), _calc("f_bounce_rate"), _sum("opened"), _calc("f_open_rate")],
            "The receiving domains with the most email, and how each delivers and bounces: where the list needs cleaning. Every campaign in the period unless you pick some.",
            view={"type": "grid", "formats": [{"column": "f_bounce_rate", "style": "scale"}]}, order=[{"field": "sent", "direction": "desc"}], top={"n": 15, "others": True},
            campaign=ANY_CAMPAIGN),
    _report("links", "Link Clicks", "clicks", [{"field": "link"}, {"field": "link_type"}, _sum("clicks"), _calc("f_emails_clicked")],
            "Clicks on each tracked link in a campaign, and how many emails they came from.", order=[{"field": "clicks", "direction": "desc"}]),
    _report("devices", "Opens by Device and Client", "opens",
            [{"field": "device_type"}, {"field": "email_client"}, _sum("opens"), _sum("human_open", label="Opens by People"), _sum("machine_open", label="Machine Opens")],
            "Opens by device, then email client; privacy proxies and scanners shown as machine opens.", view={"type": "hierarchy"}, order=[{"field": "opens", "direction": "desc"}]),
    _report("opens_by_day", "Opens over Time", "opens",
            [{"field": "opened_at", "bucket": "day"}, _sum("human_open", label="Opens by People"), _sum("machine_open", label="Machine Opens")],
            "Opens by day after the send, people apart from machines.", view={"type": "chart", "chart": "stacked"}, order=[{"field": "opened_at", "direction": "asc"}]),
    _report("customers", "Customer Detail", "messages",
            [{"field": "recipient"}, {"field": "sent_at"}, {"field": "final_status"}, {"field": "failure_category"}, _sum("opened"), _sum("opens"), _sum("clicked"), _sum("clicks"), _sum("unsubscribed")],
            "One line per recipient of a campaign: delivered or not, opened, clicked, unsubscribed. Export it for follow-up.",
            order=[{"field": "sent_at", "direction": "asc"}]),
    _report("unsubscribes", "Unsubscribes", "messages", [{"field": "recipient"}, {"field": "sent_at"}, {"field": "domain"}, _sum("unsubscribed")],
            "Who unsubscribed from a campaign, through its unsubscribe link.", filters=[{"field": "unsubscribed", "operator": "=", "value": 1}],
            order=[{"field": "sent_at", "direction": "asc"}]),
    _report("comparison", "Campaign Comparison", "campaigns",
            [{"field": "campaign_name"}, _sum("emails_sent"), _sum("delivered"), _calc("f_delivery_rate"), _sum("opened"), _calc("f_open_rate"), _sum("clicked"),
             _calc("f_click_through_rate"), _sum("unsubscribed"), _calc("f_unsubscribe_rate")],
            "Campaigns side by side; pick the ones to compare, or see every campaign in the period.",
            view={"type": "grid", "formats": [{"column": "f_open_rate", "style": "bars"}, {"column": "f_delivery_rate", "style": "scale"}]},
            order=[{"field": "emails_sent", "direction": "desc"}], campaign=ANY_CAMPAIGN),
    _report("best_open", "Best Campaigns by Open Rate", "campaigns", [{"field": "campaign_name"}, _calc("f_open_rate"), _sum("opened"), _sum("delivered")],
            "The five campaigns with the highest open rate in the period.", view={"type": "chart", "chart": "bar"},
            order=[{"field": "f_open_rate", "direction": "desc"}], campaign=ANY_CAMPAIGN, top={"n": 5, "others": False}),
    _report("worst_delivery", "Lowest Delivery Rate Campaigns", "campaigns", [{"field": "campaign_name"}, _calc("f_delivery_rate"), _sum("delivered"), _sum("emails_sent")],
            "The five campaigns with the lowest delivery rate in the period.", view={"type": "chart", "chart": "bar"},
            order=[{"field": "f_delivery_rate", "direction": "asc"}], campaign=ANY_CAMPAIGN, top={"n": 5, "others": False}),
]


def _figure(id_, report, measure, title):
    return {"id": id_, "report": report, "show": "figure", "measure": measure, "title": title}


def _tile(id_, report, show, title):
    return {"id": id_, "report": report, "show": show, "title": title}


DASHBOARDS = [
    {"id": "management", "name": "Management Dashboard", "description": "Every email campaign in the period: totals, each campaign, the best and the worst, providers and list quality.",
     "period": {"preset": "90d"}, "compare": True,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("sent", "totals", "sent", "Emails Sent"), _figure("delivered", "totals", "delivered", "Delivered"),
                                  _figure("opened", "totals", "opened", "Opened"), _figure("clicked", "totals", "clicked", "Clicked")]},
         {"width": "1", "tiles": [_tile("comparison", "comparison", "grid", "Campaigns in the Period")]},
         {"width": "2", "tiles": [_tile("best", "best_open", "chart", "Best by Open Rate"), _tile("worst", "worst_delivery", "chart", "Lowest Delivery Rate")]},
         {"width": "2", "tiles": [_tile("providers", "providers", "grid", "Providers"), _tile("quality", "list_quality", "grid", "Contact-List Quality")]},
     ]}},
    {"id": "performance", "name": "Campaign Performance", "description": "One campaign at a time, the latest unless you pick another: CmpReport's Performance Report.",
     "period": {"preset": "90d"}, "compare": False,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("sent", "kpis", "sent", "Emails Sent"), _figure("delivered", "kpis", "delivered", "Delivered"),
                                  _figure("opened", "kpis", "opened", "Opened"), _figure("clicked", "kpis", "clicked", "Clicked")]},
         {"width": "1", "tiles": [_tile("send-status", "send_status", "grid", "Send Status")]},
         {"width": "2", "tiles": [_tile("outcomes", "outcomes", "chart", "Delivery Outcomes"), _tile("failures", "failures", "grid", "Failure and Bounce Reasons")]},
         {"width": "2", "tiles": [_tile("links", "links", "grid", "Link Clicks"), _tile("devices", "devices", "hierarchy", "Opens by Device and Client")]},
         {"width": "2", "tiles": [_tile("opens", "opens_by_day", "chart", "Opens over Time"), _tile("retries", "retries", "grid", "Retry Analysis")]},
     ], "slicers": [{"field": "campaign_name", "label": "Campaign"}]}},
]

PACK = {
    "key": "email-campaigns",
    "version": 1,
    "name": "Email Campaign Reports",
    "summary": ("Campaign KPIs, send status, delivery and retries, failures and bounces, providers, list quality, link clicks, opens by device "
                "and client, customer detail, unsubscribes and comparisons; a Management Dashboard and a Campaign Performance dashboard."),
    "source": "CmpReport",
    "components": ["insights"],
    "needs": {"engine": "mysql", "label": "a Postal database", "tables": ["messages", "deliveries", "loads", "clicks", "links"]},
    "datasets": DATASETS,
    "formulas": FORMULAS,
    "reports": REPORTS,
    "dashboards": DASHBOARDS,
    "benchmarks": BENCHMARKS,
    "checked": email_sql.checked,
}
