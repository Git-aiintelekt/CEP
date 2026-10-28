"""What This Means (docs/mockups/executive-explain-free.html, option D1): the 95% ranges, the bands and when a verdict is sure,
the Email Campaign pack's verdict, reasons and actions from City HT's Sep03 figures (faked, no database server), any other report
judged by its own totals, and the endpoints. Rolled back."""
import pytest
from django.conf import settings
from django.db import connections

from apps.insights import meaning
from apps.insights.base_packs import PACKS

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
PACK = PACKS["email-campaigns"]
HIGHER = {"higher_is_better": True, "good": 95, "act": 90}
LOWER = {"higher_is_better": False, "good": 2, "act": 5}


def _table(name: str) -> bool:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [f"public.{name}"])
        return cursor.fetchone()[0]


def test_the_ranges_and_the_bands(check):
    low, high = meaning.wilson(805, 835)
    check("805 of 835 delivered: 94.9% to 97.5%", (round(low, 2), round(high, 2)) == (94.92, 97.47), (low, high))
    low, high = meaning.wilson(2, 805)
    check("2 clicks of 805: 0.07% to 0.9%", (round(low, 2), round(high, 2)) == (0.07, 0.9), (low, high))
    check("no base, no range", meaning.wilson(0, 0) is None)
    check("higher is better: Good at or above Good, Act under Act, Watch between",
          [meaning.band(v, HIGHER) for v in (95, 92, 89.9)] == ["good", "watch", "act"])
    check("lower is better: the same, mirrored", [meaning.band(v, LOWER) for v in (2, 3.5, 5.1)] == ["good", "watch", "act"])

    delivered = meaning.judge(96.41, HIGHER, 805, 835)
    check("96.4% is Good, but its range dips under 95%: likely, not sure", delivered["band"] == "good" and not delivered["sure"]
          and meaning.band_words(delivered, HIGHER) == "Likely On Target", delivered)
    bounced = meaning.judge(3.47, LOWER, 29, 835)
    check("3.5% hard bounces, its whole range between 2% and 5%: surely Above Target", bounced["sure"] and meaning.band_words(bounced, LOWER) == "Above Target", bounced)
    few = meaning.judge(10.0, HIGHER, 2, 20)
    check(f"under {meaning.MIN_BASE} in the base: no verdict", few["band"] is None and meaning.band_words(few, HIGHER) == "Too Few to Judge", few)
    check("no benchmark: no band", meaning.band_words(meaning.judge(5.0, None), None) == "No Target")
    check("a figure without a count and base is judged on its value alone", meaning.judge(80.0, HIGHER) == {"band": "act", "sure": True, "range": None, "state": "judged"})
    check("numbers read as the app shows them", [meaning.number(805, None), meaning.number(96.4072, "percent"), meaning.number(0.2484, "percent"), meaning.number(291034, "money")]
          == ["805", "96.4%", "0.25%", "$291K"])
    check.done()


class FakeFacts:
    """the pack's datasets and their figures for Sep03, without a database server"""
    KEYS = {"messages": "x_msg", "campaigns": "x_cmp", "clicks": "x_clk", "opens": "x_opn"}

    def __init__(self, answers=None, sums=None):
        self.answers = answers or {"campaign": ["Sep03 - Star Bag"], "period": "quarter"}
        self.figures = sums or {"sent": 835, "delivered": 805, "hard_fail": 29, "not_delivered": 30, "opened": 2, "clicked": 2, "unsubscribed": 0}
        self.asked = []

    def dataset(self, key):
        return {"key": key, "fields": [{"key": "recipient"}], "time_field": "sent_at"} if key in self.KEYS.values() else None

    def _parameters(self, dataset, keep=None):
        return [{"key": "campaign", "field": "campaign_name", "operator": "in"}]

    def sums(self, dataset, fields, **kw):
        if dataset["key"] == "x_opn":
            return {"opens": 40, "machine_open": 38}
        if dataset["key"] == "x_clk":
            return {"clicks": 6}
        return {f: self.figures[f] for f in fields if f in self.figures}

    def rows(self, dataset, columns, **kw):
        self.asked.append((dataset["key"], [c["field"] for c in columns], kw.get("keep")))
        fields = [c["field"] for c in columns]
        if fields == ["c_people_opened"]:
            return [[2]]
        if fields == ["bounce_reply", "sent"]:
            return [["550 5.2.1   The email account that you tried to reach is inactive.", 18]]
        if fields == ["link", "clicks"]:
            return [["https://locations.cititrends.com/stores?utm=sep03", 6]]
        if fields == ["campaign_name", "send_start"]:
            return [["Sep03 - Star Bag", "2026-09-03T14:00:00"]]
        if dataset["key"] == "x_cmp":
            return [["Oct01 - Fall", "2026-10-01T14:00:00", 900, 880, 10, 30], ["Sep03 - Star Bag", "2026-09-03T14:00:00", 835, 805, 29, 2],
                    ["Aug20 - Back to School", "2026-08-20T14:00:00", 1000, 970, 12, 20], ["Aug06 - Summer", "2026-08-06T14:00:00", 1000, 980, 8, 10]]
        return []


def _install():
    return {"pack": "email-campaigns", "made": {"datasets": list(FakeFacts.KEYS.values()), "reports": [f"r-{r['id']}" for r in PACK["reports"]]}}


def _marks():
    return {"x_msg": [{"measure_key": b["measure"], "higher_is_better": b["higher"], "good": b["good"], "act": b["act"]} for b in PACK["benchmarks"]]}


def test_an_email_campaign_in_words(check):
    facts = FakeFacts()
    out = meaning.email_meaning(facts, _install(), PACK, _marks())
    verdict = out["verdict"]
    check("delivered but barely clicked: act on the list, both halves said as likely where the range crosses a band's edge",
          verdict["chip"] == "Act on the List" and verdict["title"] == "Delivery is likely on target; engagement is likely low.", verdict)
    check("the summary states the counts and rates, and the delivery range",
          verdict["summary"].startswith("805 of 835 emails delivered (96.4%). 2 people opened (about 0.25%) and 2 clicked (0.25%).") and "94.9% to 97.5%" in verdict["summary"], verdict["summary"])
    figures = {f["key"]: f for f in out["figures"]}
    check("four figures: delivered, hard bounces, people who opened, clicked", list(figures) == ["f_delivery_rate", "f_bounce_rate", "people_opened", "f_click_through_rate"])
    check("people who opened is an estimate, with no band", figures["people_opened"]["estimated"] and figures["people_opened"]["band"] is None)
    check("hard bounces above target, surely", figures["f_bounce_rate"]["words"] == "Above Target" and figures["f_bounce_rate"]["target"] == "keep under 2.0%", figures["f_bounce_rate"])
    check("compared with the campaigns before Sep03 only, never a later one", out["read"]["earlier"] == {"campaigns": 2, "from": "2026-08-06", "to": "2026-08-20"}
          and round(figures["f_delivery_rate"]["earlier"], 1) == 97.5, (out["read"], figures["f_delivery_rate"]["earlier"]))
    reasons = [r["text"] for r in out["reasons"]]
    check("machine opens, stated as estimated", reasons[0].startswith("38 of 40 opens (95.0%) were machine opens") and "estimated" in reasons[0], reasons)
    check("the most common failure reply, its spaces tidied, with how many", 'The email account that you tried to reach is inactive." , 18' not in reasons[1]
          and "550 5.2.1 The email account" in reasons[1] and "18 of the 30 not delivered" in reasons[1], reasons[1])
    check("the clicks by link, by host", reasons[2] == "All 6 clicks were on one link: locations.cititrends.com. 0 unsubscribed.", reasons[2])
    check("every reason links to the pack report it came from", [r["report"]["name"] for r in out["reasons"]] == ["Opens by Device and Client", "Failure and Bounce Reasons", "Link Clicks"]
          and out["reasons"][0]["report"]["id"] == "r-devices")
    actions = out["actions"]
    check("at most three actions, most urgent first: the bounces, the clicks, then the machine opens",
          [a["kind"] for a in actions] == ["export_failed", "open", "open"] and actions[0]["label"] == "Export the 29 Addresses" and actions[1]["label"] == "Open Customer Detail"
          and actions[2]["label"] == "Open Campaign Comparison", actions)
    messages = {"key": "x_msg", "fields": [{"key": "campaign_name"}, {"key": "recipient"}], "time_field": "sent_at"}
    asked = [{"key": "campaign", "field": "campaign_name", "operator": "in", "default": {"latest": True}}, {"key": "period", "field": "send_start", "operator": "period", "default": "quarter"}]
    export = meaning.failed_definition(messages, asked)
    check("the export reads the hard-failed recipients of the same campaign and period: Period on this dataset's time field, the latest left to the report's answer",
          export["filters"]["rules"][0]["value"] == ["Hard Fail", "Bad Email"] and export["parameters"] == [{"key": "campaign", "field": "campaign_name", "operator": "in"},
                                                                                                         {"key": "period", "field": "sent_at", "operator": "period", "default": "quarter"}], export)
    check("nothing causal is claimed", not any(w in " ".join(reasons + [verdict["title"], verdict["summary"]]).lower() for w in ("because", "caused", "due to", "led to")))
    check.done()


def test_too_few_and_no_targets(check):
    small = FakeFacts(sums={"sent": 25, "delivered": 24, "hard_fail": 1, "not_delivered": 1, "opened": 1, "clicked": 1, "unsubscribed": 0})
    out = meaning.email_meaning(small, _install(), PACK, _marks())
    check(f"under {meaning.MIN_BASE} delivered: too few to judge, and no action on clicks", out["verdict"]["chip"] == "Too Few to Judge"
          and not any(a["label"] == "Open Customer Detail" for a in out["actions"]), out["verdict"])
    bare = meaning.email_meaning(FakeFacts(), _install(), PACK, {})
    check("no benchmarks: the figures without bands, and a note to set them", bare["verdict"]["chip"] == "No Benchmark" and bare["notes"]
          and all(f["band"] is None for f in bare["figures"]) and bare["actions"] == [a for a in bare["actions"] if a["kind"] == "open"], bare["verdict"])
    none = meaning.email_meaning(FakeFacts(sums={"sent": 0, "delivered": 0}), _install(), PACK, _marks())
    check("nothing sent: said so", none["verdict"]["chip"] == "No Emails" and none["verdict"]["summary"] == "")
    check.done()


def test_any_other_report(check):
    class Facts:
        answers = {}

        def rows(self, dataset, columns, **kw):
            return [[291034.0, 1200]]
    dataset = {"key": "upl_sales", "fields": [{"key": "category", "label": "Category"}, {"key": "net_sales", "label": "Net Sales", "format": "money"},
                                              {"key": "orders", "label": "Orders", "format": "integer"}]}
    definition = {"columns": [{"field": "category"}, {"field": "net_sales", "aggregate": "sum"}, {"field": "orders", "aggregate": "sum"}], "filters": {"combinator": "and", "rules": []}}
    result = {"columns": [{"key": "category", "label": "Category"}, {"key": "net_sales", "label": "Net Sales", "aggregate": "sum", "format": "money"},
                          {"key": "orders", "label": "Orders", "aggregate": "sum"}],
              "rows": [["Apparel", 78500.0, 300], ["Shoes", 61000.0, 250], ["Home", 13100.0, 90]]}
    out = meaning.general_meaning(Facts(), dataset, definition, result, {})
    check("no benchmark: the totals said plainly", out["verdict"]["chip"] == "No Benchmark" and out["verdict"]["title"] == "Net Sales: $291K. Orders: 1,200.", out["verdict"])
    check("the largest and smallest group of the first column, with their shares",
          [r["text"] for r in out["reasons"]] == ["Largest Category: Apparel, $78,500 (51.4% of Net Sales).", "Smallest: Home, $13,100 (8.6%)."], out["reasons"])
    check("and a note naming what has no target", out["notes"] == ["No target is set for Net Sales, Orders, so the verdict cannot say good or bad."], out["notes"])
    judged = meaning.general_meaning(Facts(), dataset, definition, result, {"upl_sales": [{"measure_key": "net_sales", "higher_is_better": True, "good": 300000, "act": 250000,
                                                                                            "count_field": None, "base_field": None}]})
    check("a benchmark on a measure: judged and said", judged["verdict"]["chip"] == "Watch" and judged["verdict"]["title"] == "0 of 1 figure on target."
          and judged["figures"][0]["words"] == "Below Target", judged["verdict"])
    check.done()


def test_the_endpoints(check, world):
    report = world.api("post", "/api/v1/insights/reports/", {"name": "Sends by channel, explained", "dataset": "messages", "definition": {
        "columns": [{"field": "channel"}, {"field": "sent", "aggregate": "sum"}], "filters": {"combinator": "and", "rules": [{"field": "submitted_at", "operator": "last_days", "value": 400}]}}})
    rid = report.json()["id"]
    said = world.api("post", f"/api/v1/insights/reports/{rid}/meaning/", {"params": {}})
    body = said.json()
    check("any report gets What This Means, free and at once", said.status_code == 200 and body["verdict"]["tone"] in ("none", "good", "watch", "act")
          and body["figures"][0]["key"] == "sent" and body["read"]["reports"] == 1, said.content[:300])
    listed = world.api("get", "/api/v1/insights/benchmarks/")
    check("the benchmarks list says whether the database has them yet", listed.status_code == 200 and listed.json()["ready"] == _table("report_benchmark"), listed.content[:200])
    if not _table("report_benchmark"):
        refused = world.api("post", "/api/v1/insights/benchmarks/", {"dataset": "messages", "measure": "sent", "good": 100, "act": 50})
        check("without patch 0080, setting one is refused with why", refused.status_code == 409 and "0080" in refused.content.decode(), refused.content[:200])
        check.done()
        return
    made = world.api("post", "/api/v1/insights/benchmarks/", {"dataset": "messages", "measure": "sent", "good": 100, "act": 50})
    check("a benchmark is set on a measure", made.status_code == 201 and made.json()["measure_label"], made.content[:200])
    wrong = world.api("post", "/api/v1/insights/benchmarks/", {"dataset": "messages", "measure": "sent", "good": 100, "act": 50})
    check("one per measure", wrong.status_code == 400, wrong.content[:200])
    upside = world.api("put", f"/api/v1/insights/benchmarks/{made.json()['id']}/", {"good": 50, "act": 100})
    check("Act beyond Good the wrong way is refused", upside.status_code == 400 and "act" in upside.json()["errors"], upside.content[:200])
    judged = world.api("post", f"/api/v1/insights/reports/{rid}/meaning/", {"params": {}}).json()
    figure = judged["figures"][0]
    check("the report's figure is judged against it (empty when the database has no sends)",
          figure["state"] == ("judged" if figure["value"] is not None else "empty") and figure["target"] == "target 100" and judged["read"]["benchmarks"] == 1, judged["figures"])
    gone = world.api("delete", f"/api/v1/insights/benchmarks/{made.json()['id']}/")
    check("and removed", gone.status_code == 204 and world.api("get", "/api/v1/insights/benchmarks/").json()["benchmarks"] == [])
    check.done()


def test_the_layer_keeps_benchmarks_per_workspace(check):
    from pathlib import Path
    layer = (Path(settings.BASE_DIR).parent / "database" / "CEP_Database_Schema_Platform_Operations.sql").read_text(encoding="utf-8")
    check("report_benchmark: one per measure in a workspace, Act on the right side of Good, row-level security",
          "CREATE TABLE IF NOT EXISTS report_benchmark" in layer and "ux_report_benchmark_measure ON report_benchmark(tenant_id, dataset_key, measure_key)" in layer
          and "ck_report_benchmark_bands" in layer and "ARRAY['report_benchmark']" in layer)
    patch = (Path(settings.BASE_DIR).parent / "database" / "patches" / "0080_benchmarks.sql").read_text(encoding="utf-8")
    check("patch 0080 runs the layer", "CEP_Database_Schema_Platform_Operations.sql" in patch)
    check.done()
