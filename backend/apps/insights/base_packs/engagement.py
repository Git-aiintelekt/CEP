"""Engagement Reports, version 1 (docs/mockups/reports-into-insights.html, option A): what Engagement's own Reports page shows,
as Insights reports on the platform's datasets (Messages, Journey Enrollments) and one dashboard, Engagement Overview. The pack
makes no dataset and needs no connection: a report names a platform dataset by its key. Test sends are left out of every report."""

NOT_A_TEST = {"field": "test_mode", "operator": "=", "value": False}
ANY_CAMPAIGN = {"key": "campaign", "field": "campaign_name", "label": "Campaigns", "operator": "in", "required": False}
TIME_FIELD = {"messages": "submitted_at", "journey_enrollments": "enrolled_at"}
OVERVIEW = "Engagement Overview"


def _sum(field, **extra):
    return {"field": field, "aggregate": "sum", **extra}


def _calc(field):
    return {"field": field, "aggregate": "calc"}


def _report(id_, name, dataset, columns, description, *, view=None, order=None, filters=None, parameters=None, top=None):
    period = {"key": "period", "field": TIME_FIELD[dataset], "label": "Period", "operator": "period", "required": True, "default": "30d"}
    definition = {"columns": columns, "filters": {"combinator": "and", "rules": filters or []}, "orderBy": order or [], "view": view or {"type": "grid"},
                  "parameters": [*(parameters or []), period], "limit": 500, **({"top": top} if top else {})}
    return {"id": id_, "name": name, "dataset": dataset, "description": description, "definition": definition}


def _messages(id_, name, columns, description, **more):
    return _report(id_, name, "messages", columns, description, filters=[NOT_A_TEST], **more)


RATES = [_calc("delivered_rate"), _calc("open_rate"), _calc("click_rate")]

REPORTS = [
    _messages("totals", "Engagement Totals",
              [_sum("sent"), *RATES, _sum("delivered"), _sum("opened"), _sum("clicked"), _sum("bounced"), _sum("complained")],
              "Every email and text sent in the period: how many, and the shares delivered, opened and clicked."),
    _messages("by_day", "Sent and Opened by Day", [{"field": "submitted_at", "bucket": "day"}, _sum("sent"), _sum("opened")],
              "Messages sent and opened, day by day.", view={"type": "chart", "chart": "bar"}, order=[{"field": "submitted_at", "direction": "asc"}]),
    _messages("campaigns", "Campaigns in the Period",
              [{"field": "campaign_name"}, {"field": "channel"}, _sum("sent"), *RATES, _calc("bounce_rate")],
              "Each campaign that sent in the period, with its delivery, opens and clicks.", order=[{"field": "sent", "direction": "desc"}]),
    _messages("best_open", "Best Campaigns by Open Rate", [{"field": "campaign_name"}, _calc("open_rate"), _sum("opened"), _sum("delivered")],
              "The five campaigns with the highest open rate in the period.", view={"type": "chart", "chart": "bar"},
              order=[{"field": "open_rate", "direction": "desc"}], top={"n": 5, "others": False}),
    _messages("best_click", "Best Campaigns by Click Rate", [{"field": "campaign_name"}, _calc("click_rate"), _sum("clicked"), _sum("delivered")],
              "The five campaigns with the highest click rate in the period.", view={"type": "chart", "chart": "bar"},
              order=[{"field": "click_rate", "direction": "desc"}], top={"n": 5, "others": False}),
    _messages("compare", "Compare Campaigns",
              [{"field": "campaign_name"}, {"field": "channel"}, _sum("sent"), _sum("delivered"), _calc("delivered_rate"), _sum("opened"), _calc("open_rate"),
               _sum("clicked"), _calc("click_rate"), _sum("bounced"), _calc("bounce_rate")],
              "Campaigns side by side; pick the ones to compare, or see every campaign in the period.",
              view={"type": "grid", "formats": [{"column": "open_rate", "style": "bars"}, {"column": "click_rate", "style": "bars"}]},
              order=[{"field": "sent", "direction": "desc"}], parameters=[ANY_CAMPAIGN]),
    _report("journeys", "Journeys in the Period", "journey_enrollments",
            [{"field": "journey_name"}, {"field": "journey_status"}, {"field": "enrollments", "aggregate": "count", "label": "Entered"}, _sum("converted"),
             _calc("conversion_rate"), _sum("revenue")],
            "Each journey customers entered in the period: how many entered and converted, and the revenue credited to it.",
            order=[{"field": "enrollments", "direction": "desc"}]),
]


def _figure(id_, measure, title):
    return {"id": id_, "report": "totals", "show": "figure", "measure": measure, "title": title}


def _tile(id_, report, show, title):
    return {"id": id_, "report": report, "show": show, "title": title}


DASHBOARDS = [
    {"id": "overview", "name": OVERVIEW, "description": "The workspace's campaigns and journeys over a period.",
     "period": {"preset": "30d"}, "compare": True,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("sent", "sent", "Sent"), _figure("delivered", "delivered_rate", "Delivered"),
                                  _figure("opened", "open_rate", "Opened"), _figure("clicked", "click_rate", "Clicked")]},
         {"width": "2-1", "tiles": [_tile("by-day", "by_day", "chart", "Sent and Opened by Day"), _tile("best", "best_open", "chart", "Best by Open Rate")]},
         {"width": "1", "tiles": [_tile("campaigns", "campaigns", "grid", "Campaigns in the Period")]},
         {"width": "1", "tiles": [_tile("journeys", "journeys", "grid", "Journeys in the Period")]},
     ], "slicers": [{"field": "channel", "label": "Channel"}]}},
]

PACK = {
    "key": "engagement",
    "version": 1,
    "name": "Engagement Reports",
    "summary": ("What Engagement's Reports page shows, as reports you can change: totals, sent and opened by day, each campaign, the best "
                "campaigns, a comparison and the journeys; and the Engagement Overview dashboard."),
    "source": "Engagement",
    "components": ["cep", "insights"],
    "needs": None,
    "datasets": [],
    "formulas": [],
    "reports": REPORTS,
    "dashboards": DASHBOARDS,
    "benchmarks": [],
}
