"""What This Means (docs/mockups/executive-explain-free.html, option D1): a report's figures judged against the workspace's benchmarks,
the reasons read from the related reports of its pack, and what to do, written by rules from the engine's own figures. Instant, the
same each time, and never a model: no prompt is counted and nothing leaves C360.

Accuracy: a rate's 95% range (Wilson) is worked out from its count and base; a band is given only when the whole range sits in it,
"Likely ..." when the range crosses a band's edge, and "Too few to judge" under MIN_BASE. Machine opens are an estimate (the email
client's identifier, as CmpReport reads it), and a comparison with earlier campaigns says how many and from when.

    GET, POST       /insights/benchmarks/                  the workspace's benchmarks, with the packs whose defaults are not added yet
    PUT, DELETE     /insights/benchmarks/<id>/
    POST            /insights/benchmarks/defaults/         {pack}: a pack's default benchmarks on this workspace's copy of its datasets
    POST            /insights/reports/<id>/meaning/        {params}: the report's verdict, figures, reasons and actions

Reading needs report.view; changing benchmarks report.admin or user.admin. Table report_benchmark (patch 0080, row-level security).
"""
import json
import math
from urllib.parse import urlparse

from django.core.cache import cache
from django.http import StreamingHttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode
from apps.delivery.engine import session
from apps.insights import catalog, parameters, runner
from apps.insights.api import VIEW, HasInsights, _can_see_pii, _has, _q, _report_row, _tenant, _validated
from apps.insights.base_packs import PACKS
from apps.insights.definition import DefinitionError, validate

EDIT = [IsAuthenticated, HasInsights, HasPermissionCode.for_("report.admin") | HasPermissionCode.for_("user.admin")]
MIN_BASE = 30                       # under this many in a rate's base, no verdict
Z = 1.96                            # a 95% range
EARLIER = 5                         # the campaigns before, compared with
MAX_ACTIONS = 3
TONE_ORDER = {"good": 0, "watch": 1, "act": 2}


def present() -> bool:
    found = cache.get("cep:insights:benchmark-present")
    if found is None:
        found = bool(_q("SELECT to_regclass('public.report_benchmark') IS NOT NULL AS present")[0]["present"])
        cache.set("cep:insights:benchmark-present", found, 300)
    return found


# ---------------------------------------------------------------------------------------------------- the arithmetic
def wilson(count: float, base: float) -> tuple[float, float] | None:
    """the 95% range of count/base, in percent; None without a base"""
    if not base or base <= 0:
        return None
    p = max(0.0, min(1.0, count / base))
    d = 1 + Z * Z / base
    centre = (p + Z * Z / (2 * base)) / d
    half = Z * math.sqrt(p * (1 - p) / base + Z * Z / (4 * base * base)) / d
    return round(max(0.0, centre - half) * 100, 4), round(min(1.0, centre + half) * 100, 4)


def band(value: float, benchmark: dict) -> str:
    good, act = float(benchmark["good"]), float(benchmark["act"])
    if benchmark["higher_is_better"]:
        return "good" if value >= good else "act" if value < act else "watch"
    return "good" if value <= good else "act" if value > act else "watch"


def judge(value: float | None, benchmark: dict | None, count: float | None = None, base: float | None = None) -> dict:
    """the figure's band, whether the range is sure of it, and the range; no band without a benchmark, too few, or no value"""
    out = {"band": None, "sure": False, "range": None, "state": "none"}
    if value is None:
        out["state"] = "empty"
        return out
    if benchmark is None:
        out["state"] = "no_benchmark"
        return out
    if count is not None and base is not None:
        if base < MIN_BASE:
            out["state"] = "too_few"
            return out
        out["range"] = wilson(count, base)
    point = band(value, benchmark)
    out["band"], out["state"] = point, "judged"
    if out["range"]:
        out["sure"] = band(out["range"][0], benchmark) == band(out["range"][1], benchmark) == point
    else:
        out["sure"] = True
    return out


def number(value, format_: str | None) -> str:
    if value is None:
        return "—"
    v = float(value)
    if format_ == "percent":
        return f"{v:.2f}%" if abs(v) < 1 else f"{v:.1f}%"
    if format_ == "money":
        return f"${v:,.2f}" if abs(v) < 1000 else f"${v:,.0f}" if abs(v) < 100_000 else f"${v / 1000:,.0f}K"
    if format_ == "decimal":
        return f"{v:,.2f}"
    return f"{v:,.0f}"


def band_words(judged: dict, benchmark: dict | None) -> str:
    """the chip's words: On Target, Below Target, Low; Above Target, High; Likely ... when the range is not sure; or why there is none"""
    state = judged["state"]
    if state == "too_few":
        return "Too Few to Judge"
    if state == "no_benchmark":
        return "No Target"
    if state != "judged":
        return ""
    higher = benchmark["higher_is_better"]
    words = {"good": "On Target", "watch": "Below Target" if higher else "Above Target", "act": "Low" if higher else "High"}[judged["band"]]
    return words if judged["sure"] else f"Likely {words}"


def target_words(benchmark: dict | None, format_: str | None) -> str:
    if benchmark is None:
        return ""
    good = number(benchmark["good"], format_)
    return f"target {good}" if benchmark["higher_is_better"] else f"keep under {good}"


# ---------------------------------------------------------------------------------------------------- benchmarks
def benchmarks(tenant_id) -> list[dict]:
    if not present():
        return []
    return _q("""SELECT id::text, dataset_key, measure_key, higher_is_better, good::float AS good, act::float AS act, count_field, base_field, row_version, updated_at
                   FROM report_benchmark WHERE tenant_id = %s ORDER BY dataset_key, measure_key""", [str(tenant_id)])


def _benchmark_body(tenant_id, body: dict, can_see_pii: bool) -> dict:
    errors = {}
    dataset = catalog.dataset(tenant_id, str(body.get("dataset") or ""), can_see_pii)
    if dataset is None:
        raise ValidationError({"dataset": "Choose one of the datasets this workspace reports on."})
    measures = {f["key"]: f for f in dataset["fields"] if f["role"] == "measure"}
    measure = str(body.get("measure") or "")
    if measure not in measures:
        errors["measure"] = "Choose one of the dataset's measures."
    try:
        good, act = float(body.get("good")), float(body.get("act"))
    except (TypeError, ValueError):
        raise ValidationError({"good": "Give Good and Act as numbers."}) from None
    higher = body.get("higher_is_better", True) is not False
    if (higher and act > good) or (not higher and act < good):
        errors["act"] = "When higher is better, Act is at or below Good; when lower is better, at or above it."
    count, base = body.get("count_field") or None, body.get("base_field") or None
    for key, value in (("count_field", count), ("base_field", base)):
        if value is not None and value not in measures:
            errors[key] = "A count and a base are measures of the dataset."
    if bool(count) != bool(base):
        errors["base_field"] = "Give both the count and the base, or neither."
    if errors:
        raise ValidationError(errors)
    return {"dataset_key": dataset["key"], "measure_key": measure, "higher_is_better": higher, "good": good, "act": act, "count_field": count, "base_field": base}


def serialize_benchmark(row: dict, labels: dict) -> dict:
    dataset = labels.get(row["dataset_key"]) or {}
    field = (dataset.get("fields") or {}).get(row["measure_key"]) or {}
    return {"id": row["id"], "dataset": row["dataset_key"], "dataset_label": dataset.get("label") or row["dataset_key"], "measure": row["measure_key"],
            "measure_label": field.get("label") or row["measure_key"], "format": field.get("format"), "higher_is_better": row["higher_is_better"],
            "good": row["good"], "act": row["act"], "count_field": row["count_field"], "base_field": row["base_field"], "row_version": row["row_version"],
            "count_label": ((dataset.get("fields") or {}).get(row["count_field"]) or {}).get("label"), "base_label": ((dataset.get("fields") or {}).get(row["base_field"]) or {}).get("label")}


def _labels(tenant_id, can_see_pii: bool) -> dict:
    return {d["key"]: {"label": d["label"], "fields": {f["key"]: f for f in d["fields"]}} for d in catalog.for_tenant(tenant_id, can_see_pii)}


def _installs(tenant_id) -> list[dict]:
    if not _q("SELECT to_regclass('public.report_base_install') IS NOT NULL AS present")[0]["present"]:
        return []
    rows = _q("SELECT pack_key, made FROM report_base_install WHERE tenant_id = %s ORDER BY created_at DESC", [str(tenant_id)])
    return [{"pack": r["pack_key"], "made": r["made"] if isinstance(r["made"], dict) else json.loads(r["made"] or "{}")} for r in rows]


def _pack_defaults(tenant_id) -> list[dict]:
    """each added pack's default benchmarks on this workspace's copy of its datasets"""
    out = []
    for install in _installs(tenant_id):
        pack = PACKS.get(install["pack"])
        if not pack or not pack.get("benchmarks"):
            continue
        keys = dict(zip([d["id"] for d in pack["datasets"]], install["made"].get("datasets") or []))
        rows = [{**b, "dataset_key": keys[b["dataset"]]} for b in pack["benchmarks"] if b["dataset"] in keys]
        out.append({"pack": pack["key"], "name": pack["name"], "rows": rows})
    return out


class BenchmarksView(APIView):
    def get_permissions(self):
        return [p() for p in (VIEW if self.request.method == "GET" else EDIT)]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant = _tenant()
        rows = benchmarks(tenant.pk)
        labels = _labels(tenant.pk, _can_see_pii(request))
        have = {(r["dataset_key"], r["measure_key"]) for r in rows}
        offers = [{"pack": d["pack"], "name": d["name"], "missing": sum(1 for b in d["rows"] if (b["dataset_key"], b["measure"]) not in have)} for d in _pack_defaults(tenant.pk)] if present() else []
        return Response({"ready": present(), "can_edit": _has(request, "report.admin") or _has(request, "user.admin"),
                         "benchmarks": [serialize_benchmark(r, labels) for r in rows], "offers": [o for o in offers if o["missing"]]})

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None):
        tenant = _tenant()
        if not present():
            raise Conflict("Benchmarks need a database update (patch 0080). Ask your administrator.")
        data = _benchmark_body(tenant.pk, request.data if isinstance(request.data, dict) else {}, _can_see_pii(request))
        if _q("SELECT 1 FROM report_benchmark WHERE tenant_id = %s AND dataset_key = %s AND measure_key = %s", [str(tenant.pk), data["dataset_key"], data["measure_key"]]):
            raise ValidationError({"measure": "This measure has a benchmark already: change that one."})
        with session.tx():
            made = _q("""INSERT INTO report_benchmark (tenant_id, dataset_key, measure_key, higher_is_better, good, act, count_field, base_field, created_by, updated_by)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id::text""",
                      [str(tenant.pk), data["dataset_key"], data["measure_key"], data["higher_is_better"], data["good"], data["act"], data["count_field"], data["base_field"],
                       str(request.user.pk), str(request.user.pk)])
        row = next(r for r in benchmarks(tenant.pk) if r["id"] == made[0]["id"])
        return Response(serialize_benchmark(row, _labels(tenant.pk, _can_see_pii(request))), status=status.HTTP_201_CREATED)


class BenchmarkView(APIView):
    permission_classes = EDIT

    def _row(self, tenant_id, benchmark_id) -> dict:
        found = next((r for r in benchmarks(tenant_id) if r["id"] == str(benchmark_id)), None)
        if found is None:
            raise NotFound("No such benchmark.")
        return found

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None, benchmark_id=None):
        tenant = _tenant()
        current = self._row(tenant.pk, benchmark_id)
        body = request.data if isinstance(request.data, dict) else {}
        if body.get("row_version") is not None and int(body["row_version"]) != current["row_version"]:
            raise Conflict("The benchmark changed since you opened it. Reload and try again.")
        data = _benchmark_body(tenant.pk, {"dataset": current["dataset_key"], "measure": current["measure_key"], "count_field": current["count_field"],
                                           "base_field": current["base_field"], **body}, _can_see_pii(request))
        with session.tx():
            _q("""UPDATE report_benchmark SET higher_is_better = %s, good = %s, act = %s, count_field = %s, base_field = %s, updated_by = %s, updated_at = now(),
                         row_version = row_version + 1 WHERE tenant_id = %s AND id = %s""",
               [data["higher_is_better"], data["good"], data["act"], data["count_field"], data["base_field"], str(request.user.pk), str(tenant.pk), str(benchmark_id)])
        return Response(serialize_benchmark(self._row(tenant.pk, benchmark_id), _labels(tenant.pk, _can_see_pii(request))))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, benchmark_id=None):
        tenant = _tenant()
        self._row(tenant.pk, benchmark_id)
        with session.tx():
            _q("DELETE FROM report_benchmark WHERE tenant_id = %s AND id = %s", [str(tenant.pk), str(benchmark_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)


class BenchmarkDefaultsView(APIView):
    permission_classes = EDIT

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None):
        tenant = _tenant()
        if not present():
            raise Conflict("Benchmarks need a database update (patch 0080). Ask your administrator.")
        key = str((request.data or {}).get("pack") or "") if isinstance(request.data, dict) else ""
        offer = next((d for d in _pack_defaults(tenant.pk) if d["pack"] == key), None)
        if offer is None:
            raise ValidationError({"pack": "This workspace has not added that pack."})
        have = {(r["dataset_key"], r["measure_key"]) for r in benchmarks(tenant.pk)}
        added = 0
        with session.tx():
            for b in offer["rows"]:
                if (b["dataset_key"], b["measure"]) in have:
                    continue
                _q("""INSERT INTO report_benchmark (tenant_id, dataset_key, measure_key, higher_is_better, good, act, count_field, base_field, created_by, updated_by)
                      VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                   [str(tenant.pk), b["dataset_key"], b["measure"], b["higher"], b["good"], b["act"], b.get("count"), b.get("base"), str(request.user.pk), str(request.user.pk)])
                added += 1
        return Response({"added": added}, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------------------------------- running the facts
def fitted(asked: list[dict], dataset: dict, keep: tuple[str, ...] | None = None) -> list[dict]:
    """the report's questions that fit another dataset: Period on its time field, the others on a field of the same key; a latest
    default is left off, as the report's own answer (looked up on the report's dataset) is passed"""
    fields = {f["key"] for f in dataset["fields"]}
    out = []
    for p in asked:
        if keep is not None and p["key"] not in keep:
            continue
        if p.get("operator") == "period":
            if dataset.get("time_field"):
                out.append({**p, "field": dataset["time_field"]})
        elif p.get("field") in fields:
            out.append({k: v for k, v in p.items() if not (k == "default" and parameters.is_latest(v))})
    return out


def failed_definition(messages: dict, asked: list[dict]) -> dict:
    """the hard-failed addresses of the same campaign and period, for Export the Addresses"""
    return {"columns": [{"field": "recipient"}, {"field": "campaign_name"}, {"field": "failure_category"}, {"field": "bounce_reply"}],
            "filters": {"combinator": "and", "rules": [{"field": "failure_category", "operator": "in", "value": ["Hard Fail", "Bad Email"]}]},
            "orderBy": [{"field": "recipient", "direction": "asc"}], "parameters": fitted(asked, messages)}


class Facts:
    """runs small definitions on the report's own answers (its campaign, period and the rest), with this person's rights"""

    def __init__(self, tenant, request, answers: dict, report_parameters: list[dict]):
        self.tenant, self.request, self.answers, self.parameters = tenant, request, answers, report_parameters
        self.can_see_pii = _can_see_pii(request)
        self.limits = catalog.engine_of(tenant.pk)["limits"]

    def dataset(self, key: str) -> dict | None:
        return catalog.dataset(self.tenant.pk, key, True)

    def _parameters(self, dataset: dict, keep: tuple[str, ...] | None = None) -> list[dict]:
        return fitted(self.parameters, dataset, keep)

    def rows(self, dataset: dict, columns: list[dict], *, filters: list[dict] | None = None, order: list[dict] | None = None, limit: int = 50,
             derived: list[dict] | None = None, keep: tuple[str, ...] | None = None) -> list[list]:
        raw = {"columns": columns, "filters": {"combinator": "and", "rules": filters or []}, "orderBy": order or [], "limit": limit,
               "parameters": self._parameters(dataset, keep), **({"derived": derived} if derived else {})}
        try:
            definition = validate(dataset, raw, max_limit=self.limits["run_rows"])
        except DefinitionError:
            return []
        answers = {p["key"]: self.answers[p["key"]] for p in definition.get("parameters") or [] if p["key"] in self.answers}
        try:
            return runner.run(self.tenant, self.request.user, dataset, definition, "run", params=answers, mask_pii=not self.can_see_pii)["rows"]
        except runner.RunRefused:
            return []

    def sums(self, dataset: dict, fields: list[str], **kw) -> dict:
        present_ = {f["key"] for f in dataset["fields"]}
        wanted = [f for f in fields if f in present_]
        rows = self.rows(dataset, [{"field": f, "aggregate": "sum"} for f in wanted], **kw)
        return {f: float(v or 0) for f, v in zip(wanted, rows[0])} if rows else {}


def _host(url: str) -> str:
    try:
        return urlparse(url).netloc or url[:60]
    except ValueError:
        return url[:60]


def _share(part: float, whole: float) -> float:
    return part / whole * 100 if whole else 0.0


def _likely(judged: dict) -> str:
    return "" if judged["sure"] else "likely "


def _figure(key, label, value, format_, benchmark, judged, earlier=None, estimated=False) -> dict:
    return {"key": key, "label": label, "value": value, "format": format_, "band": judged["band"], "sure": judged["sure"], "state": judged["state"],
            "range": judged["range"], "words": band_words(judged, benchmark), "target": target_words(benchmark, format_), "earlier": earlier, "estimated": estimated}


def email_meaning(facts: Facts, install: dict, pack: dict, marks: dict) -> dict:
    """the Email Campaign pack: the messages dataset's rates judged, the reasons from opens, bounces and links, and the actions"""
    keys = dict(zip([d["id"] for d in pack["datasets"]], install["made"].get("datasets") or []))
    report_ids = dict(zip([r["id"] for r in pack["reports"]], install["made"].get("reports") or []))
    names = {r["id"]: r["name"] for r in pack["reports"]}
    messages = facts.dataset(keys.get("messages", ""))
    if messages is None:
        return {}
    m = facts.sums(messages, ["sent", "delivered", "hard_fail", "not_delivered", "opened", "clicked", "unsubscribed"])
    sent, delivered = m.get("sent", 0), m.get("delivered", 0)
    read = 1
    rate = lambda count, base: round(_share(m.get(count, 0), m.get(base, 0)), 4) if m.get(base) else None    # noqa: E731
    bm = {b["measure_key"]: b for b in marks.get(messages["key"], [])}

    def judged(measure, count, base):
        return judge(rate(count, base), bm.get(measure), m.get(count, 0), m.get(base, 0))

    delivery, bounce, clicks, unsub = judged("f_delivery_rate", "delivered", "sent"), judged("f_bounce_rate", "hard_fail", "sent"), \
        judged("f_click_through_rate", "clicked", "delivered"), judged("f_unsubscribe_rate", "unsubscribed", "sent")

    people, opens, machine = None, 0.0, 0.0
    open_set = facts.dataset(keys.get("opens", ""))
    if open_set is not None:
        read += 1
        o = facts.sums(open_set, ["opens", "machine_open"])
        opens, machine = o.get("opens", 0), o.get("machine_open", 0)
        counted = facts.rows(open_set, [{"field": "c_people_opened", "aggregate": "calc"}],
                             derived=[{"label": "People Opened", "kind": "measure", "expression": "DISTINCTCOUNT([Message Key], [Human Open] = 1)", "format": "integer"}])
        people = float(counted[0][0] or 0) if counted else None

    earlier, earlier_words = {}, None
    campaigns = facts.dataset(keys.get("campaigns", ""))
    current = facts.answers.get("campaign")
    if campaigns is not None and current:
        starts = [str(r[1]) for r in facts.rows(campaigns, [{"field": "campaign_name"}, {"field": "send_start"}], keep=("campaign",)) if r[1]]
        rows = facts.rows(campaigns, [{"field": "campaign_name"}, {"field": "send_start"}, {"field": "emails_sent", "aggregate": "sum"}, {"field": "delivered", "aggregate": "sum"},
                                      {"field": "hard_fail", "aggregate": "sum"}, {"field": "clicked", "aggregate": "sum"}],
                          order=[{"field": "send_start", "direction": "desc"}], limit=200, keep=()) if starts else []
        names_now = set(current if isinstance(current, list) else [current])
        before = [r for r in rows if r[0] not in names_now and r[1] and str(r[1]) < min(starts)][:EARLIER]
        if before:
            read += 1
            s = [sum(float(r[i] or 0) for r in before) for i in (2, 3, 4, 5)]
            earlier = {"f_delivery_rate": _share(s[1], s[0]), "f_bounce_rate": _share(s[2], s[0]), "f_click_through_rate": _share(s[3], s[1])}
            dates = sorted(str(r[1])[:10] for r in before)
            earlier_words = {"campaigns": len(before), "from": dates[0], "to": dates[-1]}

    figures = [
        _figure("f_delivery_rate", "Delivered", rate("delivered", "sent"), "percent", bm.get("f_delivery_rate"), delivery, earlier.get("f_delivery_rate")),
        _figure("f_bounce_rate", "Hard Bounces", rate("hard_fail", "sent"), "percent", bm.get("f_bounce_rate"), bounce, earlier.get("f_bounce_rate")),
    ]
    if people is not None:
        figures.append(_figure("people_opened", "People Who Opened", round(_share(people, delivered), 4) if delivered else None, "percent", None,
                               {"band": None, "sure": False, "range": wilson(people, delivered), "state": "estimate"}, estimated=True))
    figures.append(_figure("f_click_through_rate", "Clicked", rate("clicked", "delivered"), "percent", bm.get("f_click_through_rate"), clicks, earlier.get("f_click_through_rate")))

    # ---- the verdict
    if not sent:
        verdict = {"tone": "none", "chip": "No Emails", "title": "No email was sent for these answers.", "summary": ""}
    elif delivery["band"] == "act":
        verdict = {"tone": "act", "chip": "Fix Sending First", "title": f"Delivery is {_likely(delivery)}below target: fix sending first.", "summary": ""}
    elif clicks["state"] == "too_few":
        verdict = {"tone": "none", "chip": "Too Few to Judge", "title": f"Too few emails to judge engagement: fewer than {MIN_BASE} delivered.", "summary": ""}
    elif clicks["state"] != "judged":
        verdict = {"tone": "none", "chip": "No Benchmark", "title": "No click target is set, so engagement is not judged.", "summary": ""}
    elif clicks["band"] == "good":
        verdict = {"tone": "good", "chip": "On Track", "title": f"Delivered and engaging: {_likely(clicks)}on target.", "summary": ""}
    elif clicks["band"] == "watch":
        verdict = {"tone": "watch", "chip": "Watch", "title": f"Delivered; engagement is {_likely(clicks)}below target.", "summary": ""}
    else:
        lead = f"Delivery is {_likely(delivery)}{'on target' if delivery['band'] == 'good' else 'close to target'}"
        verdict = {"tone": "act", "chip": "Act on the List", "title": f"{lead}; engagement is {_likely(clicks)}low.", "summary": ""}
    if sent:
        parts = [f"{number(delivered, None)} of {number(sent, None)} emails delivered ({number(rate('delivered', 'sent'), 'percent')})."]
        if people is not None:
            parts.append(f"{number(people, None)} {'person' if people == 1 else 'people'} opened (about {number(_share(people, delivered), 'percent')})"
                         f" and {number(m.get('clicked', 0), None)} clicked ({number(rate('clicked', 'delivered'), 'percent')}).")
        else:
            parts.append(f"{number(m.get('clicked', 0), None)} clicked ({number(rate('clicked', 'delivered'), 'percent')}).")
        if not delivery["sure"] and delivery["band"]:
            parts.append(f"Delivery's 95% range, {number(delivery['range'][0], 'percent')} to {number(delivery['range'][1], 'percent')}, crosses a band's edge: read it as likely, not certain.")
        verdict["summary"] = " ".join(parts)

    def link(report_key):
        rid = report_ids.get(report_key)
        return {"id": rid, "name": names[report_key]} if rid else None

    # ---- the reasons
    reasons = []
    if opens:
        reasons.append({"text": f"{number(machine, None)} of {number(opens, None)} opens ({number(_share(machine, opens), 'percent')}) were machine opens, such as Apple Mail Privacy Protection (estimated from the email client).",
                        "report": link("devices")})
    failed = m.get("not_delivered", 0)
    if failed:
        top = facts.rows(messages, [{"field": "bounce_reply"}, {"field": "sent", "aggregate": "sum"}],
                         filters=[{"field": "failure_category", "operator": "!=", "value": "Delivered"}, {"field": "bounce_reply", "operator": "is_not_null", "value": None}],
                         order=[{"field": "sent", "direction": "desc"}], limit=1)
        if top and top[0][0]:
            reply = " ".join(str(top[0][0]).split()).rstrip(".")
            reply = reply if len(reply) <= 110 else reply[:107].rsplit(" ", 1)[0] + "…"
            reasons.append({"text": f"The most common failure reply: \"{reply}\", {number(top[0][1], None)} of the {number(failed, None)} not delivered.", "report": link("failures")})
    click_set = facts.dataset(keys.get("clicks", ""))
    if click_set is not None:
        read += 1
        content = [{"field": "link_type", "operator": "=", "value": "Content"}]
        total = facts.sums(click_set, ["clicks"], filters=content).get("clicks", 0)
        if total:
            top = facts.rows(click_set, [{"field": "link"}, {"field": "clicks", "aggregate": "sum"}], filters=content, order=[{"field": "clicks", "direction": "desc"}], limit=1)
            if top:
                where = _host(str(top[0][0]))
                lead = f"All {number(total, None)} clicks were on one link: {where}." if float(top[0][1] or 0) == total else f"{number(top[0][1], None)} of {number(total, None)} clicks were on {where}."
                reasons.append({"text": f"{lead} {number(m.get('unsubscribed', 0), None)} unsubscribed.", "report": link("links")})

    # ---- the actions, most urgent first
    actions = []
    if delivery["band"] in ("watch", "act"):
        actions.append({"text": f"Delivery is below {number(bm['f_delivery_rate']['good'], 'percent')}: check the sending domain and the mail server before the next send.",
                        "kind": "open", "label": f"Open {names['outcomes']}", "report": link("outcomes")})
    if bounce["band"] in ("watch", "act"):
        hard = number(m.get("hard_fail", 0), None)
        actions.append({"text": f"Hard bounces are above {number(bm['f_bounce_rate']['good'], 'percent')}: remove the {hard} addresses that hard-failed.",
                        "kind": "export_failed", "label": f"Export the {hard} Addresses", "report": link("customers")})
    if clicks["band"] in ("watch", "act"):
        actions.append({"text": f"Clicks are under {number(bm['f_click_through_rate']['good'], 'percent')}: review the list and the offer before the next send.",
                        "kind": "open", "label": f"Open {names['customers']}", "report": link("customers")})
    if opens and _share(machine, opens) >= 50:
        actions.append({"text": "Most opens are machine opens: compare campaigns on clicks, not opens.", "kind": "open", "label": f"Open {names['comparison']}", "report": link("comparison")})
    if unsub["band"] in ("watch", "act"):
        actions.append({"text": f"Unsubscribes are above {number(bm['f_unsubscribe_rate']['good'], 'percent')}: check how often this list is mailed.",
                        "kind": "open", "label": f"Open {names['unsubscribes']}", "report": link("unsubscribes")})
    notes = []
    if not bm:
        notes.append("No targets are set for these email rates, so the verdict cannot say good or bad.")
    return {"verdict": verdict, "figures": figures, "reasons": reasons, "actions": actions[:MAX_ACTIONS],
            "read": {"reports": read, "earlier": earlier_words, "benchmarks": len(bm), "campaign": names_now_words(current)}, "notes": notes, "pack": pack["key"]}


def names_now_words(current) -> str | None:
    if not current:
        return None
    names = current if isinstance(current, list) else [current]
    return names[0] if len(names) == 1 else f"{len(names)} campaigns"


def general_meaning(facts: Facts, dataset: dict, definition: dict, result: dict, marks: dict) -> dict:
    """any other report: its totals judged against the benchmarks set for its measures, and its largest and smallest group"""
    fields = {f["key"]: f for f in dataset["fields"]}
    measures = [c for c in definition["columns"] if c.get("aggregate") and c.get("field") in fields and not c.get("compare")]
    bm = {b["measure_key"]: b for b in marks.get(dataset["key"], [])}
    extra = sorted({f for b in bm.values() for f in (b.get("count_field"), b.get("base_field")) if f and f in fields})
    columns = [{"field": c["field"], "aggregate": c["aggregate"]} for c in measures] + [{"field": f, "aggregate": "sum"} for f in extra if f not in {c["field"] for c in measures}]
    totals = facts.rows(dataset, columns, filters=(definition.get("filters") or {}).get("rules"), derived=definition.get("derived"), limit=1) if columns else []
    values = dict(zip([c["field"] for c in columns], totals[0])) if totals else {}
    figures = []
    for c in measures[:4]:
        field = fields[c["field"]]
        value = values.get(c["field"])
        b = bm.get(c["field"])
        count = values.get(b["count_field"]) if b and b.get("count_field") else None
        base = values.get(b["base_field"]) if b and b.get("base_field") else None
        figures.append(_figure(c["field"], c.get("label") or field["label"], float(value) if value is not None else None, field.get("format"), b,
                               judge(float(value) if value is not None else None, b, float(count) if count is not None else None, float(base) if base is not None else None)))
    judged = [f for f in figures if f["state"] == "judged"]
    # the largest and the smallest group of the first dimension, by the first measure, from the report's own rows
    reasons = []
    dims = [i for i, c in enumerate(result.get("columns") or []) if not c.get("aggregate")]
    nums = [i for i, c in enumerate(result.get("columns") or []) if c.get("aggregate") in ("sum", "count")]
    if dims and nums:
        d, n = dims[0], nums[0]
        groups = {}
        for row in result.get("rows") or []:
            if row[n] is not None:
                groups[row[d]] = groups.get(row[d], 0) + float(row[n])
        whole = sum(groups.values())
        if len(groups) > 1 and whole:
            col_d, col_n = result["columns"][d], result["columns"][n]
            name = lambda v: str(v)[:7] if col_d.get("bucket") == "month" else str(v)[:10] if col_d.get("type") in ("date", "datetime") else str(v)      # noqa: E731
            top = max(groups, key=groups.get)
            low = min(groups, key=groups.get)
            reasons.append({"text": f"Largest {col_d['label']}: {name(top)}, {number(groups[top], col_n.get('format'))} ({number(_share(groups[top], whole), 'percent')} of {col_n['label']}).", "report": None})
            reasons.append({"text": f"Smallest: {name(low)}, {number(groups[low], col_n.get('format'))} ({number(_share(groups[low], whole), 'percent')}).", "report": None})
    if judged:
        worst = max(judged, key=lambda f: TONE_ORDER[f["band"]])
        on = sum(1 for f in judged if f["band"] == "good")
        tone = worst["band"]
        verdict = {"tone": tone, "chip": {"good": "On Track", "watch": "Watch", "act": "Act"}[tone],
                   "title": f"{on} of {len(judged)} {'figure' if len(judged) == 1 else 'figures'} on target.", "summary": " ".join(f"{f['label']} {number(f['value'], f['format'])}: {f['words'].lower()}." for f in judged)}
    else:
        verdict = {"tone": "none", "chip": "No Benchmark", "title": " ".join(f"{f['label']}: {number(f['value'], f['format'])}." for f in figures[:2]) or "No figures to judge.", "summary": ""}
    notes = []
    unset = [f["label"] for f in figures if f["state"] == "no_benchmark"]
    if unset:
        notes.append(f"No target is set for {', '.join(unset)}, so the verdict cannot say good or bad.")
    return {"verdict": verdict, "figures": figures, "reasons": reasons, "actions": [], "read": {"reports": 1, "earlier": None, "benchmarks": len(bm), "campaign": None},
            "notes": notes, "pack": None}


class MeaningView(APIView):
    permission_classes = VIEW

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, report_id=None):
        tenant = _tenant()
        row = _report_row(report_id, request)
        raw = row["definition"] if isinstance(row["definition"], dict) else json.loads(row["definition"])
        run_rows = catalog.engine_of(tenant.pk)["limits"]["run_rows"]
        dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": raw}, max_limit=run_rows, reading=True)
        params = parameters.from_request(request)
        try:
            parameters.require(definition, params)
        except parameters.ParameterError as exc:
            return Response({"type": "about:blank", "title": "The report needs an answer", "status": 422, "detail": str(exc), "outcome": "PARAMETERS"}, status=422)
        answers = runner._with_latest(tenant, dataset, definition, params)
        marks = {}
        for b in benchmarks(tenant.pk):
            marks.setdefault(b["dataset_key"], []).append(b)
        facts = Facts(tenant, request, answers, definition.get("parameters") or [])
        install = next((i for i in _installs(tenant.pk) if row["dataset_key"] in (i["made"].get("datasets") or [])), None)
        pack = PACKS.get(install["pack"]) if install else None
        try:
            if pack is not None and pack["key"] == "email-campaigns":
                out = email_meaning(facts, install, pack, marks)
            else:
                result = runner.run(tenant, request.user, dataset, definition, "run", params=params, mask_pii=not _can_see_pii(request))
                out = general_meaning(facts, dataset, definition, result, marks)
        except runner.RunRefused as exc:
            return Response({"type": "about:blank", "title": "The report did not run", "status": 422, "detail": exc.reason, "outcome": exc.outcome}, status=422)
        if not out:
            raise NotFound("The pack's datasets are not in this workspace any more.")
        return Response({**out, "ready": present(), "can_set": _has(request, "report.admin") or _has(request, "user.admin"),
                         "answers": {k: v for k, v in answers.items() if isinstance(v, (str, list, int, float))}})


class FailedExportView(APIView):
    """Export the Addresses: the hard-failed recipients of the report's campaign and period, as a CSV, masked without the right to see them"""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, report_id=None):
        tenant = _tenant()
        row = _report_row(report_id, request)
        raw = row["definition"] if isinstance(row["definition"], dict) else json.loads(row["definition"])
        limits = catalog.engine_of(tenant.pk)["limits"]
        dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": raw}, max_limit=limits["export_rows"], reading=True)
        install = next((i for i in _installs(tenant.pk) if row["dataset_key"] in (i["made"].get("datasets") or [])), None)
        pack = PACKS.get(install["pack"]) if install else None
        keys = dict(zip([d["id"] for d in pack["datasets"]], install["made"].get("datasets") or [])) if pack else {}
        messages = catalog.dataset(tenant.pk, keys.get("messages", ""), True)
        if messages is None:
            raise NotFound("This report is not one of the Email Campaign pack's.")
        answers = runner._with_latest(tenant, dataset, definition, parameters.from_request(request))
        try:
            failed = validate(messages, {**failed_definition(messages, definition.get("parameters") or []), "limit": limits["export_rows"]}, max_limit=limits["export_rows"])
        except DefinitionError as exc:
            raise ValidationError({"definition": str(exc)}) from None
        asked = {p["key"] for p in failed.get("parameters") or []}
        try:
            chunks = runner.stream_csv(tenant, request.user, messages, failed, mask_pii=not _can_see_pii(request), params={k: v for k, v in answers.items() if k in asked})
            first = next(chunks)
        except runner.RunRefused as exc:
            return Response({"type": "about:blank", "title": "The export did not run", "status": 422, "detail": exc.reason}, status=422)
        except StopIteration:
            first, chunks = "", iter(())

        def body():
            yield first
            yield from chunks
        response = StreamingHttpResponse(body(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="Hard-failed addresses.csv"'
        return response
