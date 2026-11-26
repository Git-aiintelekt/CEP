"""Survey Reports, version 1: C360Report's Survey suite as a base pack. Two datasets (sql), their shared formulas,
the reports and a dashboard.

The two grains matter more here than anywhere else in these packs. The table holds one row per question answered,
and the first question - the recommendation score - is asked of everyone while the rest are asked of those who
carry on. Counting rows would make the survey look eight times larger than it is and every rate wrong. So rates
are built on `responses`, one row per sitting, and `answers` is there for what people actually said.
"""
from . import sql as survey_sql


def _dim(column, label, type_="string", sensitivity="NORMAL", format_=None):
    return {"column": column, "label": label, "type": type_, "role": "dimension", "aggregates": [], "format": format_,
            "sensitivity": sensitivity, "table": "t0"}


def _measure(column, label, format_="integer"):
    return {"column": column, "label": label, "type": "number", "role": "measure",
            "aggregates": ["sum", "avg", "min", "max"], "format": format_, "sensitivity": "NORMAL", "table": "t0"}


def _formula(dataset, label, expression, description, format_="percent"):
    return {"dataset": dataset, "label": label, "kind": "measure", "expression": expression,
            "description": description, "format": format_}


ANSWER_FIELDS = [
    _dim("answer_key", "Answer Key"), _dim("response_key", "Response Key"), _dim("crm_database", "CRM Database"),
    _dim("answered_at", "Answered At", "datetime", format_="datetime"),
    _dim("question_number", "Question Number", "number"), _dim("question", "Question"),
    _dim("answer_type", "Answer Type"), _dim("answer", "Answer"),
    _dim("channel", "Channel"), _dim("store", "Store"), _dim("region", "Region"), _dim("district", "District"),
    _dim("device_type", "Device Type"), _dim("transaction_type", "Transaction Type"),
    _measure("answers", "Answers"),
]
RESPONSE_FIELDS = [
    _dim("response_key", "Response Key"), _dim("crm_database", "CRM Database"),
    _dim("answered_at", "Answered At", "datetime", format_="datetime"),
    _dim("channel", "Channel"), _dim("store", "Store"), _dim("region", "Region"), _dim("district", "District"),
    _dim("device_type", "Device Type"), _dim("transaction_type", "Transaction Type"),
    _dim("recommendation", "Recommendation"),
    _measure("responses", "Responses"), _measure("scored", "Scored"), _measure("completed", "Completed"),
    _measure("promoters", "Promoters"), _measure("passives", "Passives"), _measure("detractors", "Detractors"),
    _measure("commented", "Commented"), _measure("contact_wanted", "Contact Wanted"),
    _measure("recommend_score", "Recommend Score", "decimal"),
    _measure("satisfaction", "Satisfaction", "decimal"),
    _measure("store_clean", "Store Clean", "decimal"),
    _measure("styles_found", "Styles Found", "decimal"),
    _measure("in_stock", "In Stock", "decimal"),
    _measure("friendliness", "Friendliness", "decimal"),
]

DATASETS = [
    {"id": "responses", "label": "Survey Responses",
     "description": "One row per sitting: its recommendation score, its ratings, and whether the person carried on past the first question.",
     "sql": survey_sql.responses_sql, "fields": RESPONSE_FIELDS, "time_field": "answered_at", "primary_key": "response_key"},
    {"id": "answers", "label": "Survey Answers",
     "description": "One row per question answered. Use this for what people said; use Responses for any rate.",
     "sql": survey_sql.answers_sql, "fields": ANSWER_FIELDS, "time_field": "answered_at", "primary_key": "answer_key"},
]

FORMULAS = [
    _formula("responses", "Net Promoter Score",
             "DIVIDE(SUM([Promoters]) - SUM([Detractors]), SUM([Scored])) * 100",
             "Promoters less detractors, over everyone who gave a score", "decimal"),
    _formula("responses", "Promoter Share", "DIVIDE(SUM([Promoters]), SUM([Scored])) * 100",
             "People who scored 9 or 10"),
    _formula("responses", "Detractor Share", "DIVIDE(SUM([Detractors]), SUM([Scored])) * 100",
             "People who scored 6 or less"),
    _formula("responses", "Completion Rate", "DIVIDE(SUM([Completed]), SUM([Responses])) * 100",
             "Sittings that carried on past the first question"),
    _formula("responses", "Comment Rate", "DIVIDE(SUM([Commented]), SUM([Completed])) * 100",
             "Completed surveys that left a written comment"),
    _formula("responses", "Contact Request Rate", "DIVIDE(SUM([Contact Wanted]), SUM([Completed])) * 100",
             "Completed surveys asking to be contacted - each one becomes a service request"),
    _formula("responses", "Average Recommend Score", "DIVIDE(SUM([Recommend Score]), SUM([Scored]))",
             "The 0 to 10 score, averaged", "decimal"),
]

BENCHMARKS = [
    {"dataset": "responses", "measure": "f_net_promoter_score", "higher": True, "good": 50, "act": 20, "count": "promoters", "base": "scored"},
    {"dataset": "responses", "measure": "f_detractor_share", "higher": False, "good": 10, "act": 20, "count": "detractors", "base": "scored"},
    {"dataset": "responses", "measure": "f_completion_rate", "higher": True, "good": 20, "act": 8, "count": "completed", "base": "responses"},
]

ANY_REGION = {"key": "region", "field": "region", "label": "Regions", "operator": "in", "required": False}
ANY_CHANNEL = {"key": "channel", "field": "channel", "label": "Channels", "operator": "in", "required": False}


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
    _report("kpis", "Survey KPIs", "responses",
            [_sum("responses"), _sum("scored"), _calc("f_net_promoter_score"), _sum("promoters"),
             _sum("detractors"), _calc("f_completion_rate"), _calc("f_contact_request_rate")],
            "Sittings, scores, the net promoter score and how many carried on past the first question."),
    _report("nps_over_time", "Score over Time", "responses",
            [{"field": "answered_at", "bucket": "week"}, _calc("f_net_promoter_score"), _sum("promoters"),
             _sum("detractors")],
            "The recommendation score week by week, with the promoters and detractors behind it.",
            view={"type": "chart", "chart": "line"}, order=[{"field": "answered_at", "direction": "asc"}]),
    _report("by_region", "Score by Region, District and Store", "responses",
            [{"field": "region"}, {"field": "district"}, {"field": "store"}, _sum("scored"),
             _calc("f_net_promoter_score"), _calc("f_detractor_share")],
            "Where customers would recommend the shop and where they would not.",
            view={"type": "hierarchy"}, order=[{"field": "scored", "direction": "desc"}]),
    _report("store_leaders", "Best and Worst Stores", "responses",
            [{"field": "store"}, {"field": "region"}, _sum("scored"), _calc("f_net_promoter_score"),
             _sum("detractors")],
            "Stores ranked by their recommendation score, with enough answers to mean something.",
            view={"type": "grid", "formats": [{"column": "f_net_promoter_score", "style": "bars"}]},
            order=[{"field": "f_net_promoter_score", "direction": "desc"}], top={"n": 25, "others": True}),
    _report("ratings", "What People Rate Well and Badly", "responses",
            [{"field": "region"}, _sum("satisfaction", label="Satisfaction"), _sum("store_clean", label="Store Clean"),
             _sum("styles_found", label="Styles Found"), _sum("in_stock", label="In Stock"),
             _sum("friendliness", label="Friendliness")],
            "The five rated questions side by side, so the weakest one is obvious.",
            filters=[{"field": "completed", "operator": "=", "value": 1}],
            order=[{"field": "region", "direction": "asc"}]),
    _report("channels", "Where Surveys Come From", "responses",
            [{"field": "channel"}, {"field": "device_type"}, _sum("responses"), _sum("completed"),
             _calc("f_completion_rate"), _calc("f_net_promoter_score")],
            "The channel each survey arrived through, and whether it gets finished.",
            order=[{"field": "responses", "direction": "desc"}], pick=ANY_CHANNEL),
    _report("completion", "Who Carries On", "responses",
            [{"field": "channel"}, _sum("responses"), _sum("scored"), _sum("completed"),
             _calc("f_completion_rate"), _calc("f_comment_rate")],
            "Everyone answers the first question; far fewer answer the rest. This is the drop.",
            view={"type": "chart", "chart": "bar"},
            order=[{"field": "responses", "direction": "desc"}], pick=ANY_CHANNEL),
    _report("contact", "Customers Asking to Be Contacted", "responses",
            [{"field": "store"}, {"field": "region"}, _sum("contact_wanted"), _sum("detractors"),
             _calc("f_contact_request_rate")],
            "Every one of these becomes a service request. Where they come from, and whether they were unhappy.",
            filters=[{"field": "contact_wanted", "operator": "=", "value": 1}],
            order=[{"field": "contact_wanted", "direction": "desc"}], top={"n": 25, "others": True}),
    _report("answers", "Answers to a Question", "answers",
            [{"field": "question"}, {"field": "answer"}, _sum("answers")],
            "What people actually chose, question by question. One row per answer, so do not read a rate off it.",
            order=[{"field": "answers", "direction": "desc"}], top={"n": 40, "others": True}),
]


def _figure(id_, report, measure, title):
    return {"id": id_, "report": report, "show": "figure", "measure": measure, "title": title}


def _tile(id_, report, show, title):
    return {"id": id_, "report": report, "show": show, "title": title}


DASHBOARDS = [
    {"id": "survey", "name": "Survey Dashboard",
     "description": "The recommendation score, where it is strong and weak, what people rate badly and who asked to be contacted.",
     "period": {"preset": "90d"}, "compare": True,
     "layout": {"rows": [
         {"width": "4", "tiles": [_figure("responses", "kpis", "responses", "Sittings"),
                                  _figure("scored", "kpis", "scored", "Gave a Score"),
                                  _figure("promoters", "kpis", "promoters", "Promoters"),
                                  _figure("detractors", "kpis", "detractors", "Detractors")]},
         {"width": "1", "tiles": [_tile("time", "nps_over_time", "chart", "Score over Time")]},
         {"width": "2", "tiles": [_tile("leaders", "store_leaders", "grid", "Best and Worst Stores"),
                                  _tile("ratings", "ratings", "grid", "What People Rate Well and Badly")]},
         {"width": "2", "tiles": [_tile("channels", "channels", "grid", "Where Surveys Come From"),
                                  _tile("contact", "contact", "grid", "Asking to Be Contacted")]},
     ], "slicers": [{"field": "region", "label": "Region"}]}},
]

PACK = {
    "key": "surveys",
    "version": 1,
    "name": "Survey Reports",
    "summary": ("Survey KPIs and the recommendation score, the score over time and by region, district and store, "
                "the best and worst stores, what people rate well and badly, where surveys come from, who carries "
                "on past the first question and who asked to be contacted; a Survey dashboard."),
    "source": "C360Report",
    "components": ["insights"],
    "needs": {"engine": "mysql", "label": "a CRM database",
              "tables": ["survey_master", "tt_store_hierarchy_imp"]},
    "volume": {"table": "survey_master", "alias": "a", "where": "a.SEQUENCE_NUMBER = 1"},
    "datasets": DATASETS,
    "formulas": FORMULAS,
    "reports": REPORTS,
    "dashboards": DASHBOARDS,
    "benchmarks": BENCHMARKS,
    "checked": survey_sql.checked,
}
