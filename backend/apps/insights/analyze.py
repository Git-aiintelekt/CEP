"""The analysing visuals: Key Influencers and the Decomposition Tree, worked out from grouped runs of the report's own data,
and the written summary a dashboard tile shows.

    POST /insights/reports/analyze/          {dataset, definition, kind, measure?, path?, by?}   (the editor, as drafted)
    POST /insights/reports/<id>/analyze/     {kind, measure?, path?, by?}                        (a saved report)

Key Influencers (kind "influencers") explains one value of the report, a rate or an average (a sum is read per row of the
dataset's count, such as Sent Count per message): for each candidate dimension (the report's own first, then the dataset's,
eight at most) one grouped run, and the segments whose value sits furthest from the whole, weighted by their share of the
rows. Each run goes through the runner, so row access rules, masking, the engine's limits and the audit apply.

The Decomposition Tree (kind "decompose") splits the value by a dimension under a path of values already chosen: one
grouped run filtered to the path, the largest values first; by "auto_high" or "auto_low" tries each dimension left and keeps
the one whose top or bottom value goes furthest (Power BI's AI splits).
"""
import json
import math
from datetime import date

from django.core.cache import cache
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from . import catalog, derived, drill, parameters, pdf, runner
from .api import VIEW, _can_see_pii, _report_row, _tenant, _validated
from .definition import DefinitionError, signature, validate

MAX_CANDIDATES = 8
SEGMENTS = 50
SPLIT_ROWS = 12
SHOWN = 10
ADDITIVE = ("sum", "count", "count_distinct")
SUMMARY_SECONDS = 6 * 3600


class AnalyzeError(ValueError):
    """Why the analysis cannot run, for the person."""


# ---------------------------------------------------------------------------------------------------- the parts
def _measure(definition: dict, key: str | None) -> dict:
    measures = [c for c in definition["columns"] if "aggregate" in c]
    if not measures:
        raise AnalyzeError("Add a value to analyse, such as Delivered Rate.")
    chosen = next((c for c in measures if c["field"] == key), None) if key else None
    return chosen or next((c for c in measures if c["field"] == (definition.get("view") or {}).get("measure")), None) or measures[0]


def _field(dataset: dict, key: str) -> dict:
    return next(f for f in dataset["fields"] if f["key"] == key)


def _counter(dataset: dict, measure: dict) -> dict | None:
    """the dataset's row count, to weigh segments and to read a sum per row"""
    field = next((f for f in dataset["fields"] if f["role"] == "measure" and "count" in f["aggregates"] and not f.get("formula")), None)
    if field is None or (field["key"] == measure["field"] and measure["aggregate"] == "count"):
        return None
    return {"field": field["key"], "aggregate": "count"}


def _known(dataset: dict, definition: dict) -> dict:
    """the dataset as the report sees it: its shared formulas and the report's custom fields among its fields"""
    return derived.augment(dataset, definition)


def candidates(dataset: dict, definition: dict, mask: bool = False) -> list[dict]:
    """the dimensions to explain by: the report's own first (its custom fields too), then the dataset's, without one a rule
    already fixes to a value, the dataset's key (one row each) or personal data the person may not see; a date by month"""
    dataset = _known(dataset, definition)
    fixed = {r.get("field") for r in (definition.get("filters") or {}).get("rules", []) if r.get("operator") == "=" and "rules" not in r}
    keys = [c["field"] for c in definition["columns"] if "aggregate" not in c]
    keys += [f["key"] for f in dataset["fields"] if f["role"] == "dimension" and f["key"] not in keys]
    out = []
    for key in keys:
        field = _field(dataset, key)
        if key in fixed or key == dataset.get("primary_key") or field.get("sensitivity") == "CONFIDENTIAL" or (mask and field.get("sensitivity") == "PII") or field["type"] == "number":
            continue
        out.append({"field": key, "label": field["label"], **({"bucket": "month"} if field["type"] in ("date", "datetime") else {})})
    return out


def _run(tenant, user, dataset: dict, raw: dict, limits: dict, mask: bool, limit: int) -> dict:
    try:
        definition = validate(dataset, raw, max_limit=limits["run_rows"])
    except DefinitionError as exc:
        raise AnalyzeError(f"The analysis does not fit the data ({exc.field}: {exc}).") from None
    try:
        return runner.run(tenant, user, dataset, definition, "run", limit=limit, mask_pii=mask)
    except runner.RunRefused as exc:
        raise AnalyzeError(exc.reason) from None


def _base(definition: dict) -> dict:
    return {k: definition[k] for k in ("filters", "derived") if definition.get(k)}


def _value(row: list, at: int, per_row: bool, count_at: int | None):
    value = row[at]
    if value is None:
        return None
    if per_row:
        count = row[count_at] if count_at is not None else None
        return float(value) / float(count) if count else None
    return float(value)


def _label(column: dict, value) -> str:
    return pdf.cell_text(column, value) if value is not None else "Empty"


# ---------------------------------------------------------------------------------------------------- Key Influencers
def influencers(tenant, user, dataset: dict, definition: dict, *, measure_key: str | None, mask: bool) -> dict:
    limits = catalog.engine_of(tenant.pk)["limits"]
    measure = _measure(definition, measure_key)
    known = _known(dataset, definition)
    field = _field(known, measure["field"])
    counter = _counter(known, measure)
    per_row = measure["aggregate"] in ADDITIVE
    if per_row and (counter is None or measure["aggregate"] == "count"):
        raise AnalyzeError(f"Key Influencers explains a rate or an average; {field['label']} is a count. Analyse a rate such as Delivered Rate, or an average.")
    columns = [{"field": measure["field"], "aggregate": measure["aggregate"]}, *([counter] if counter else [])]
    whole = _run(tenant, user, dataset, {**_base(definition), "columns": columns}, limits, mask, 1)
    if not whole["rows"]:
        raise AnalyzeError("The report has no rows for its filters.")
    count_at = 1 if counter else None
    overall = _value(whole["rows"][0], 0, per_row, count_at)
    total_rows = float(whole["rows"][0][1] or 0) if counter else None
    if overall is None:
        raise AnalyzeError("The value is empty for the whole report.")
    shown_column = {**whole["columns"][0], **({"format": "decimal"} if per_row and whole["columns"][0].get("format") == "integer" else {})}
    found, tried = [], []
    for candidate in candidates(dataset, definition, mask)[:MAX_CANDIDATES]:
        dim = {"field": candidate["field"], **({"bucket": candidate["bucket"]} if candidate.get("bucket") else {})}
        order = [{"field": (counter or measure)["field"], "direction": "desc"}]
        result = _run(tenant, user, dataset, {**_base(definition), "columns": [dim, *columns], "orderBy": order, "limit": SEGMENTS}, limits, mask, SEGMENTS)
        tried.append(candidate["label"])
        if result["columns"][0].get("masked"):
            continue
        segments = len(result["rows"])
        for row in result["rows"]:
            value = _value(row, 1, per_row, 2 if counter else None)
            rows = float(row[2] or 0) if counter else None
            if value is None or (rows is not None and total_rows and (rows < 10 or rows / total_rows < 0.01)) or segments < 2:
                continue
            effect = value - overall
            share = rows / total_rows if rows is not None and total_rows else 1 / max(segments, 1)
            score = abs(effect) / (abs(overall) or 1) * math.sqrt(share)
            if score == 0:
                continue
            found.append({"field": candidate["field"], "field_label": candidate["label"], **({"bucket": candidate["bucket"]} if candidate.get("bucket") else {}),
                          "value": row[0], "value_label": _label(result["columns"][0], row[0]), "measure": value, "effect": effect,
                          "rows": int(rows) if rows is not None else None, "share": share, "score": score})
    found.sort(key=lambda item: item["score"], reverse=True)
    label = f"{field['label']} per {_field(known, counter['field'])['label'].rstrip('s').lower() or 'row'}" if per_row else whole["columns"][0]["label"]
    return {"kind": "influencers", "measure": {"field": measure["field"], "label": label, "column": shown_column}, "overall": overall, "rows": int(total_rows) if total_rows is not None else None,
            "higher": [i for i in found if i["effect"] > 0][:SHOWN], "lower": [i for i in found if i["effect"] < 0][:SHOWN], "explained_by": tried,
            "points": shown_column.get("format") == "percent"}


# ---------------------------------------------------------------------------------------------------- the Decomposition Tree
def _path_rules(dataset: dict, offered: dict, path: list[dict]) -> list[dict]:
    rules = []
    for index, step in enumerate(path):
        if not isinstance(step, dict) or step.get("field") not in offered:
            raise AnalyzeError(f"Step {index + 1} of the path is not a field to split by.")
        value = step.get("value")
        if value is None:
            rules.append({"field": step["field"], "operator": "is_null"})
        elif offered[step["field"]].get("bucket"):
            try:
                start = date.fromisoformat(str(value)[:10])
            except ValueError:
                raise AnalyzeError(f"Step {index + 1} of the path is not a date.") from None
            rules.append({"field": step["field"], "operator": "between", "value": [start.isoformat(), drill.bucket_end(start, offered[step["field"]]["bucket"]).isoformat()]})
        else:
            rules.append({"field": step["field"], "operator": "=", "value": value})
    return rules


def _with_rules(definition: dict, rules: list[dict]) -> dict:
    filters = definition.get("filters") or {"combinator": "and", "rules": []}
    combined = {**filters, "rules": [*filters.get("rules", []), *rules]} if filters.get("combinator", "and") == "and" else {"combinator": "and", "rules": [filters, *rules]}
    return {**definition, "filters": combined}


def decompose(tenant, user, dataset: dict, definition: dict, *, measure_key: str | None, path: list, by: str | None, mask: bool) -> dict:
    limits = catalog.engine_of(tenant.pk)["limits"]
    measure = _measure(definition, measure_key)
    column = {"field": measure["field"], "aggregate": measure["aggregate"]}
    offered = {c["field"]: c for c in candidates(dataset, {**definition, "filters": {"combinator": "and", "rules": []}}, mask)}
    if not isinstance(path, list) or len(path) > 6:
        raise AnalyzeError("A path is up to six steps.")
    base = _with_rules(_base(definition), _path_rules(dataset, offered, path))
    node = _run(tenant, user, dataset, {**base, "columns": [column]}, limits, mask, 1)
    total = node["rows"][0][0] if node["rows"] else None
    left = [c for key, c in offered.items() if key not in {s["field"] for s in path}]
    out = {"kind": "decompose", "measure": {"field": measure["field"], "label": node["columns"][0]["label"], "column": node["columns"][0]}, "total": total, "path": path,
           "explain_by": left}
    if not by:
        return out

    def split(candidate: dict) -> dict:
        dim = {"field": candidate["field"], **({"bucket": candidate["bucket"]} if candidate.get("bucket") else {})}
        result = _run(tenant, user, dataset, {**base, "columns": [dim, column], "orderBy": [{"field": measure["field"], "direction": "desc"}], "limit": SPLIT_ROWS + 1},
                      limits, mask, SPLIT_ROWS + 1)
        rows = [{"value": r[0], "label": _label(result["columns"][0], r[0]), "measure": r[1]} for r in result["rows"][:SPLIT_ROWS]]
        return {"by": candidate["field"], "by_label": candidate["label"], **({"bucket": candidate["bucket"]} if candidate.get("bucket") else {}), "rows": rows,
                "more": len(result["rows"]) > SPLIT_ROWS, "masked": bool(result["columns"][0].get("masked"))}

    if by in ("auto_high", "auto_low"):
        best, reach = None, None
        for candidate in left[:MAX_CANDIDATES]:
            tried = split(candidate)
            values = [float(r["measure"]) for r in tried["rows"] if r["measure"] is not None]
            if not values or tried["masked"] or len(values) < 2:
                continue
            here = max(values) if by == "auto_high" else -min(values)
            if reach is None or here > reach:
                best, reach = tried, here
        if best is None:
            raise AnalyzeError("No field left splits this value.")
        if by == "auto_low":
            best["rows"] = sorted(best["rows"], key=lambda r: (r["measure"] is None, r["measure"] if r["measure"] is not None else 0))
        return {**out, **best, "chosen": by}
    candidate = next((c for c in left if c["field"] == by), None)
    if candidate is None:
        raise AnalyzeError("Split by one of the fields offered.")
    return {**out, **split(candidate)}


# ---------------------------------------------------------------------------------------------------- the summary tile
def summary_key(tenant_id, report: dict, definition: dict, bounds: dict) -> str:
    return f"cep:insights:summary:{tenant_id}:{report['id']}:{report['version']}:{signature({**definition, 'bounds': bounds})}"


def cached_summary(key: str) -> dict | None:
    return cache.get(key)


def keep_summary(key: str, payload: dict) -> None:
    cache.set(key, payload, SUMMARY_SECONDS)


# ---------------------------------------------------------------------------------------------------- the API
def _analysis(tenant, request, dataset: dict, definition: dict, body: dict):
    kind = body.get("kind")
    mask = not _can_see_pii(request)
    try:                                                              # the report's parameters answered (else their defaults) narrow what is explained
        definition = parameters.bind(dataset, definition, parameters.from_request(request))
    except parameters.ParameterError as exc:
        return Response({"type": "about:blank", "title": "The analysis did not run", "status": 422, "detail": str(exc)}, status=422)
    try:
        if kind == "influencers":
            return Response(influencers(tenant, request.user, dataset, definition, measure_key=body.get("measure"), mask=mask))
        if kind == "decompose":
            return Response(decompose(tenant, request.user, dataset, definition, measure_key=body.get("measure"), path=body.get("path") or [], by=body.get("by"), mask=mask))
    except AnalyzeError as exc:
        return Response({"type": "about:blank", "title": "The analysis did not run", "status": 422, "detail": str(exc)}, status=422)
    raise ValidationError({"kind": "influencers or decompose."})


class AnalyzeDraftView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None):
        tenant = _tenant()
        body = request.data if isinstance(request.data, dict) else {}
        dataset, definition = _validated(request, body, max_limit=catalog.engine_of(tenant.pk)["limits"]["run_rows"])
        return _analysis(tenant, request, dataset, definition, body)


class AnalyzeReportView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, report_id=None):
        tenant = _tenant()
        row = _report_row(report_id, request)
        raw = row["definition"] if not isinstance(row["definition"], str) else json.loads(row["definition"])
        dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": raw}, max_limit=catalog.engine_of(tenant.pk)["limits"]["run_rows"], reading=True)
        return _analysis(tenant, request, dataset, definition, request.data if isinstance(request.data, dict) else {})


__all__ = ["AnalyzeDraftView", "AnalyzeReportView", "influencers", "decompose", "candidates"]
