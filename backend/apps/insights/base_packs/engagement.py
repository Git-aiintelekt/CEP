"""Engagement Reports, version 1 (docs/mockups/reports-into-insights.html, option A): what Engagement's own Reports page shows,
as Insights reports on the platform's datasets (Messages, Journey Enrollments, with Attributed Orders and Journey Messages
blended in) and one dashboard, Engagement Overview. The pack makes no dataset and needs no connection: a report names a
platform dataset by its key. Test sends are left out of every report. It reads the fields of database patch 0103; on a
database without it the pack's check names what is missing and nothing is added.

A rate over a handful of messages says little: the best and worst lists rate a campaign only from MIN_SENT sends (an hour from
MIN_SENT delivered), as the old page did, and leave the others out."""

NOT_A_TEST = {"field": "test_mode", "operator": "=", "value": False}
ANY_CAMPAIGN = {"key": "campaign", "field": "campaign_name", "label": "Campaigns", "operator": "in", "required": False}
TIME_FIELD = {"messages": "submitted_at", "journey_enrollments": "enrolled_at"}
OVERVIEW = "Engagement Overview"
MIN_SENT = 50


def _sum(field, **extra):
    return {"field": field, "aggregate": "sum", **extra}


def _calc(field, **extra):
    return {"field": field, "aggregate": "calc", **extra}


def _report(id_, name, dataset, columns, description, *, view=None, order=None, filters=None, parameters=None, **more):
    period = {"key": "period", "field": TIME_FIELD[dataset], "label": "Period", "operator": "period", "required": True, "default": "30d"}
    definition = {"columns": columns, "filters": {"combinator": "and", "rules": filters or []}, "orderBy": order or [], "view": view or {"type": "grid"},
                  "parameters": [*(parameters or []), period], "limit": 500, **more}
    return {"id": id_, "name": name, "dataset": dataset, "description": description, "definition": definition}


def _messages(id_, name, columns, description, *, filters=None, **more):
    """a report on Messages: test sends left out, and Campaigns asked with no default. Every report on a dataset with a campaign
    is given a Campaign question when it is made (report_filters), the latest campaign by default; asking it here with no default
    keeps the report, and its dashboard tiles, on every campaign of the period."""
    return _report(id_, name, "messages", columns, description, filters=[NOT_A_TEST, *(filters or [])], parameters=[ANY_CAMPAIGN], **more)


def _rated(key, label, part, whole="Sent Count"):
    """a rate that is empty until its campaign (or hour) has MIN_SENT of `whole`: fields by their catalogue labels"""
    return {"key": key, "label": label, "kind": "measure", "type": "number", "format": "percent",
            "expression": f"IF(SUM([{whole}]) >= {MIN_SENT}, DIVIDE(SUM([{part}]), SUM([Delivered Count])) * 100)"}


def _best(id_, name, rate, extra, description):
    """the five campaigns highest on one rate, the highest first: a chart, and the line a Best and Worst figure reads"""
    return _messages(id_, name, [{"field": "campaign_name"}, _calc(rate["key"]), extra, _sum("sent")], description, derived=[rate],
                     view={"type": "chart", "chart": "bar"}, order=[{"field": rate["key"], "direction": "desc"}], hideZero=[rate["key"]], top={"n": 5, "others": False})


OPEN_RATE = _rated("c_open_rate", "Open Rate", "Opened")
CLICK_RATE = _rated("c_click_rate", "Click Rate", "Clicked")
UNSUBSCRIBE_RATE = _rated("c_unsubscribe_rate", "Unsubscribe Rate", "Unsubscribed")
HOUR_RATE = _rated("c_open_rate", "Open Rate", "Opened", whole="Delivered Count")
SEND_HOUR = {"key": "c_send_hour", "label": "Send Hour", "kind": "formula", "type": "string",       # the workspace's own time: 12 AM, 9 AM, 12 PM, 3 PM
             "expression": ('IF(HOUR([submitted_at]) = 0, "12 AM", IF(HOUR([submitted_at]) < 12, TEXT(HOUR([submitted_at])) & " AM", '
                            'IF(HOUR([submitted_at]) = 12, "12 PM", TEXT(HOUR([submitted_at]) - 12) & " PM")))')}
RATES = [_calc("delivered_rate"), _calc("open_rate"), _calc("click_rate")]

REPORTS = [
    _messages("totals", "Engagement Totals",
              [_sum("sent"), *RATES, _sum("delivered"), _sum("opened"), _sum("clicked"), _sum("bounced"), _sum("complained"), _sum("unsubscribed")],
              "Every email and text sent in the period: how many, and the shares delivered, opened and clicked."),
    _messages("by_day", "Sent and Opened by Day", [{"field": "submitted_at", "bucket": "day"}, _sum("sent"), _sum("opened")],
              "Messages sent and opened, day by day.", view={"type": "chart", "chart": "bar"}, order=[{"field": "submitted_at", "direction": "asc"}]),
    _messages("campaigns", "Campaigns in the Period",
              [{"field": "campaign_name"}, {"field": "campaign_channel", "label": "Channel"}, {"field": "first_sent", "aggregate": "min"}, _sum("sent", label="Sent"),
               _calc("delivered_rate", label="Delivered"), _calc("open_rate"), _calc("click_rate"), _calc("unsubscribe_rate", label="Unsub.")],
              "Each campaign that sent in the period: when it first sent, its delivery, opens, clicks and unsubscribes, and the revenue of the orders credited to it.",
              order=[{"field": "first_sent", "direction": "desc"}],
              blend={"dataset": "attributed_orders", "columns": [{"field": "amount", "aggregate": "sum", "label": "Revenue"}]}),
    _best("best_open", "Best Campaigns by Open Rate", OPEN_RATE, _sum("opened"), f"The five campaigns with the highest open rate in the period, of those that sent {MIN_SENT} messages or more."),
    _best("best_click", "Best Campaigns by Click Rate", CLICK_RATE, _sum("clicked"), f"The five campaigns with the highest click rate in the period, of those that sent {MIN_SENT} messages or more."),
    _best("most_unsubscribes", "Campaigns by Unsubscribe Rate", UNSUBSCRIBE_RATE, _sum("unsubscribed"),
          f"The five campaigns that lost the largest share of their readers in the period, of those that sent {MIN_SENT} messages or more."),
    _messages("send_hours", "Open Rate by Send Hour", [{"field": "c_send_hour"}, _calc("c_open_rate"), _sum("opened"), _sum("delivered")],
              f"The hours of the day emails went out, by the share that was opened: the best hour first. An hour counts from {MIN_SENT} delivered emails.",
              derived=[SEND_HOUR, HOUR_RATE], filters=[{"field": "channel", "operator": "=", "value": "EMAIL"}], view={"type": "chart", "chart": "bar"},
              order=[{"field": "c_open_rate", "direction": "desc"}], hideZero=["c_open_rate"]),
    _messages("compare", "Compare Campaigns",
              [{"field": "campaign_name"}, {"field": "channel"}, _sum("sent"), _sum("delivered"), _calc("delivered_rate"), _sum("opened"), _calc("open_rate"),
               _sum("clicked"), _calc("click_rate"), _sum("bounced"), _calc("bounce_rate"), _sum("unsubscribed"), _calc("unsubscribe_rate")],
              "Campaigns side by side; pick the ones to compare, or see every campaign in the period.",
              view={"type": "grid", "formats": [{"column": "open_rate", "style": "bars"}, {"column": "click_rate", "style": "bars"}]},
              order=[{"field": "sent", "direction": "desc"}]),
    _report("journeys", "Journeys in the Period", "journey_enrollments",
            [{"field": "journey_name"}, {"field": "journey_status", "label": "Status"}, {"field": "enrollments", "aggregate": "count", "label": "Entered"}, _sum("converted"),
             _calc("conversion_rate"), _sum("revenue")],
            "Each journey customers entered in the period: how many entered and converted, the revenue credited to it, and what became of its messages.",
            order=[{"field": "enrollments", "direction": "desc"}],
            blend={"dataset": "journey_steps", "columns": [{"field": "sent", "aggregate": "sum", "label": "Sent"}, {"field": "delivered_rate", "aggregate": "calc", "label": "Delivered"},
                                                           {"field": "held_back", "aggregate": "sum", "label": "Held Back"}]}),
]


def _figure(id_, measure, title):
    return {"id": id_, "report": "totals", "show": "figure", "measure": measure, "title": title}


def _first(id_, report, measure, title):
    """a figure that reads the report's first line (its name and one figure) in place of the period's total"""
    return {"id": id_, "report": report, "show": "figure", "measure": measure, "line": "first", "title": title}


def _tile(id_, report, show, title):
    return {"id": id_, "report": report, "show": show, "title": title}


DASHBOARDS = [
    {"id": "overview", "name": OVERVIEW, "description": "The workspace's campaigns and journeys over a period.",
     "period": {"preset": "30d"}, "compare": True,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("sent", "sent", "Sent"), _figure("delivered", "delivered_rate", "Delivered"),
                                  _figure("opened", "open_rate", "Opened"), _figure("clicked", "click_rate", "Clicked")]},
         {"width": "2-1", "tiles": [_tile("by-day", "by_day", "chart", "Sent and Opened by Day"), _tile("best", "best_open", "chart", "Best by Open Rate")]},
         {"width": "4", "tiles": [_first("highest-open", "best_open", "c_open_rate", "Highest Open Rate"), _first("highest-click", "best_click", "c_click_rate", "Highest Click Rate"),
                                  _first("most-unsubscribes", "most_unsubscribes", "c_unsubscribe_rate", "Most Unsubscribes"),
                                  _first("best-hour", "send_hours", "c_open_rate", "Best Send Hour")]},
         {"width": "1", "tiles": [_tile("campaigns", "campaigns", "grid", "Campaigns in the Period")]},
         {"width": "1", "tiles": [_tile("journeys", "journeys", "grid", "Journeys in the Period")]},
     ], "slicers": [{"field": "channel", "label": "Channel"}]}},
]

PACK = {
    "key": "engagement",
    "version": 1,
    "name": "Engagement Reports",
    "summary": ("What Engagement's Reports page shows, as reports you can change: totals, sent and opened by day, each campaign with its revenue, the best "
                "and worst campaigns, the best send hour, a comparison and the journeys; and the Engagement Overview dashboard."),
    "source": "Engagement",
    "components": ["cep", "insights"],
    "needs": None,
    "requires": "database patch 0103",
    "datasets": [],
    "formulas": [],
    "reports": REPORTS,
    "dashboards": DASHBOARDS,
    "benchmarks": [],
}
