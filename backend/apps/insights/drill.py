"""Drill-down: a chart's levels are the report's dimensions in order (the one spread across stays as the series); a date
bucketed by year drills to quarters, months and days, a quarter to months and days, a month to days, a week to days. A
drill path names the value clicked at each level above the one shown:

    {"path": [{"field": "submitted_at", "bucket": "year", "value": "2026-01-01"}, {"field": "submitted_at", "bucket": "quarter", "value": "2026-07-01"}]}

`drilled` turns the report's definition and a path into the definition of the level below: that level as the rows, the
spread across kept, the measures kept, and one rule per step (the bucket's dates, or the value) and-ed with the report's
own filters. The caller validates it like any definition; the engine runs it like any report.
"""
import calendar
from datetime import date, timedelta

from .compare import TIMED, add_months

CHAIN = {"year": ["year", "quarter", "month", "day"], "quarter": ["quarter", "month", "day"], "month": ["month", "day"], "week": ["week", "day"], "day": ["day"],
         "fiscal_year": ["fiscal_year", "fiscal_quarter", "month", "day"], "fiscal_quarter": ["fiscal_quarter", "month", "day"]}
BUCKET_WORDS = {"day": "Day", "week": "Week", "month": "Month", "quarter": "Quarter", "year": "Year", "fiscal_quarter": "Fiscal Quarter", "fiscal_year": "Fiscal Year"}
MAX_PATH = 8


class DrillError(ValueError):
    """A path that does not fit the report; the message is for the person."""


def _field(dataset: dict, key: str) -> dict:
    return next(f for f in dataset["fields"] if f["key"] == key)


def levels(dataset: dict, definition: dict) -> list[dict]:
    from .derived import augment
    dataset = augment(dataset, definition)
    across = (definition.get("view") or {}).get("across")
    out = []
    for column in definition["columns"]:
        if "aggregate" in column or column["field"] == across:
            continue
        field = _field(dataset, column["field"])
        label = column.get("label") or field["label"]
        if field["type"] in ("date", "datetime") and column.get("bucket"):
            out.extend({"field": field["key"], "bucket": bucket, "label": f"{label} by {BUCKET_WORDS[bucket]}"} for bucket in CHAIN[column["bucket"]])
        else:
            out.append({"field": field["key"], "label": label})
    return out


def info(dataset: dict, definition: dict, path: list[dict]) -> dict | None:
    """what the browser needs to show the breadcrumb and to know whether a click drills: the levels, the path, the depth"""
    found = levels(dataset, definition)
    if len(found) < 2:
        return None
    return {"levels": found, "path": path, "depth": len(path)}


def keeps_rest(raw) -> bool:
    """a pivot or a hierarchy asks to keep the levels under the one drilled"""
    return isinstance(raw, dict) and bool(raw.get("keep_rest"))


def path_body(raw) -> list[dict]:
    """[{field, bucket?, value}] from a request, or [] when there is none"""
    path = raw.get("path") if isinstance(raw, dict) else raw
    if path in (None, []):
        return []
    if not isinstance(path, list) or len(path) > MAX_PATH:
        raise DrillError(f"A drill path is a list of up to {MAX_PATH} steps.")
    out = []
    for step in path:
        if not isinstance(step, dict) or not isinstance(step.get("field"), str):
            raise DrillError("Each drill step names a field and a value.")
        value = step.get("value")
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise DrillError("A drill value is a single value.")
        bucket = step.get("bucket")
        if bucket is not None and bucket not in CHAIN:
            raise DrillError("A drill step's bucket is day, week, month, quarter or year.")
        out.append({"field": step["field"], **({"bucket": bucket} if bucket else {}), "value": value})
    return out


def bucket_end(start: date, bucket: str) -> date:
    if bucket == "day":
        return start
    if bucket == "week":
        return start + timedelta(days=6)
    if bucket == "month":
        return start.replace(day=calendar.monthrange(start.year, start.month)[1])
    if bucket in ("quarter", "fiscal_quarter"):
        return add_months(start.replace(day=1), 3) - timedelta(days=1)
    if bucket == "fiscal_year":
        return add_months(start.replace(day=1), 12) - timedelta(days=1)
    return date(start.year, 12, 31)


def drilled(dataset: dict, definition: dict, path: list[dict], keep_rest: bool = False) -> dict | None:
    """The raw definition of the level under the path, or None for the top (the report as it is). `keep_rest`: a pivot or a
    hierarchy keeps the report's dimensions after the one drilled, so it still has levels to show."""
    if not path:
        return None
    from .derived import augment
    dataset = augment(dataset, definition)
    found = levels(dataset, definition)
    if len(path) >= len(found):
        raise DrillError("There is nothing below this level.")
    rules = []
    for step, level in zip(path, found):
        if step["field"] != level["field"] or step.get("bucket") != level.get("bucket"):
            raise DrillError("The drill path does not match this report's levels.")
        if level.get("bucket"):
            if step["value"] is None:
                rules.append({"field": level["field"], "operator": "is_null"})
                continue
            try:
                start = date.fromisoformat(str(step["value"])[:10])
            except ValueError:
                raise DrillError("A date step's value is the bucket's first day, such as 2026-07-01.") from None
            rules.append({"field": level["field"], "operator": "between", "value": [start.isoformat(), bucket_end(start, level["bucket"]).isoformat()]})
        elif step["value"] is None:
            rules.append({"field": level["field"], "operator": "is_null"})
        else:
            rules.append({"field": level["field"], "operator": "=", "value": step["value"]})
    current = found[len(path)]
    view = definition.get("view") or {}
    across = view.get("across")
    temporal = bool(current.get("bucket")) or _field(dataset, current["field"])["type"] == "date"
    measures = []
    for column in definition["columns"]:
        if "aggregate" not in column:
            continue
        kept = [kind for kind in column.get("compare", []) if temporal or kind not in TIMED]
        measures.append({k: v for k, v in column.items() if k != "compare"} | ({"compare": kept} if kept else {}))
    spread = [c for c in definition["columns"] if "aggregate" not in c and c["field"] == across]
    rest = []
    if keep_rest:
        dims = [c for c in definition["columns"] if "aggregate" not in c and c["field"] != across]
        at = next((i for i, c in enumerate(dims) if c["field"] == current["field"]), len(dims))
        rest = [{k: v for k, v in c.items() if k in ("field", "bucket", "label")} for c in dims[at + 1:]]
    columns = [{"field": current["field"], **({"bucket": current["bucket"]} if current.get("bucket") else {})}, *rest, *spread, *measures]
    keys = {c["field"] for c in measures}
    order = [{"field": current["field"], "direction": "asc"}] if temporal else ([o for o in definition.get("orderBy", []) if o["field"] in keys] or [{"field": current["field"], "direction": "asc"}])
    filters = definition.get("filters") or {"combinator": "and", "rules": []}
    filters = {**filters, "rules": [*filters.get("rules", []), *rules]} if filters.get("combinator", "and") == "and" else {"combinator": "and", "rules": [filters, *rules]}
    out = {"columns": columns, "filters": filters, "orderBy": order}
    for key in ("limit", "derived", "top", "blend"):
        if definition.get(key):
            out[key] = definition[key]
    if view:
        out["view"] = view
    return out
