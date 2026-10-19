"""A report definition, checked against the catalogue before it is saved or run. Nothing in it is ever a table or column
name: fields are catalogue keys, operators and aggregates come from allow-lists, and the server resolves everything.

    {
      "dataset": "messages",
      "columns": [{"field": "campaign_name"}, {"field": "submitted_at", "bucket": "month"}, {"field": "sent", "aggregate": "sum"}],
      "filters": {"combinator": "and", "rules": [{"field": "channel", "operator": "=", "value": "EMAIL"},
                                                  {"field": "submitted_at", "operator": "last_days", "value": 30}]},
      "orderBy": [{"field": "sent", "direction": "desc"}],
      "limit": 500
    }

A column with an aggregate makes the report grouped: every column without one is a group-by key. A date or datetime
column may carry a bucket (day, week, month, quarter, year), applied in the workspace's time zone. A measure column may
carry `compare`: up to four time comparisons (apps/insights/compare.py), each one more result column after it.
"""
import hashlib
import json
from datetime import date

from . import compare as comparisons
from . import derived, links, topn
from .catalog import BUCKETS

MAX_COLUMNS = 40
MAX_RULES = 30
MAX_NESTING = 2
MAX_LIMIT = 100_000
DIRECTIONS = ("asc", "desc")
COMBINATORS = ("and", "or")
SIGNALS = ("forecast", "anomalies")


class DefinitionError(ValueError):
    """What is wrong, and where: ('columns[2].field', 'Not a field of this dataset.')"""
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


def _field_of(dataset: dict, key, where: str) -> dict:
    if not isinstance(key, str):
        raise DefinitionError(where, "Name a field.")
    for field in dataset["fields"]:
        if field["key"] == key:
            return field
    for locked in dataset.get("locked", []):
        if locked["key"] == key:
            raise DefinitionError(where, f"{locked['label']} is personal data: building a report on it needs the report administration right.")
    raise DefinitionError(where, "Not a field of this dataset.")


def _check_value(field: dict, operator: str, value, where: str):
    type_ = field["type"]
    if operator in ("is_null", "is_not_null"):
        return None
    if operator == "last_days":
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 3660:
            raise DefinitionError(where, "Give a number of days from 1 to 3660.")
        return value
    if operator == "in":
        if not isinstance(value, list) or not value or len(value) > 200:
            raise DefinitionError(where, "Give a list of 1 to 200 values.")
        return [_scalar(type_, item, where) for item in value]
    if operator == "between":
        if not isinstance(value, list) or len(value) != 2:
            raise DefinitionError(where, "Give the two ends of the range.")
        return [_scalar(type_, item, where) for item in value]
    return _scalar(type_, value, where)


def _scalar(type_: str, value, where: str):
    if value is None:
        raise DefinitionError(where, "Give a value.")
    if type_ == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            try:
                return float(str(value))
            except ValueError:
                raise DefinitionError(where, "Give a number.") from None
        return value
    if type_ == "boolean":
        if isinstance(value, bool):
            return value
        if str(value).lower() in ("true", "false"):
            return str(value).lower() == "true"
        raise DefinitionError(where, "Give true or false.")
    if type_ in ("date", "datetime"):
        text = str(value)
        try:
            date.fromisoformat(text[:10])
        except ValueError:
            raise DefinitionError(where, "Give a date like 2026-09-30.") from None
        return text[:19]
    if not isinstance(value, str) or len(value) > 500:
        raise DefinitionError(where, "Give text of up to 500 characters.")
    return value


def _filters(dataset: dict, node, where: str, depth: int, count: list[int]) -> dict:
    if node in (None, {}):
        return {"combinator": "and", "rules": []}
    if not isinstance(node, dict):
        raise DefinitionError(where, "Filters are a group of rules.")
    combinator = str(node.get("combinator", "and")).lower()
    if combinator not in COMBINATORS:
        raise DefinitionError(f"{where}.combinator", "Use and or or.")
    rules = node.get("rules", [])
    if not isinstance(rules, list):
        raise DefinitionError(f"{where}.rules", "Rules are a list.")
    out = []
    for index, rule in enumerate(rules):
        at = f"{where}.rules[{index}]"
        if not isinstance(rule, dict):
            raise DefinitionError(at, "A rule names a field, an operator and a value.")
        if "rules" in rule:
            if depth >= MAX_NESTING:
                raise DefinitionError(at, f"Groups nest {MAX_NESTING} levels deep at most.")
            out.append(_filters(dataset, rule, at, depth + 1, count))
            continue
        count[0] += 1
        if count[0] > MAX_RULES:
            raise DefinitionError(at, f"A report has {MAX_RULES} rules at most.")
        field = _field_of(dataset, rule.get("field"), f"{at}.field")
        operator = str(rule.get("operator", ""))
        if operator not in field["operators"]:
            raise DefinitionError(f"{at}.operator", f"{field['label']} does not take {operator or 'that operator'}.")
        out.append({"field": field["key"], "operator": operator, "value": _check_value(field, operator, rule.get("value"), f"{at}.value")})
    return {"combinator": combinator, "rules": out}


VIEW_TYPES = ("grid", "chart", "hierarchy", "pivot")
CHART_KINDS = ("bar", "line", "area", "pie", "funnel", "stacked", "stacked100", "combo")
FORMAT_STYLES = ("scale", "bars", "rules")
RULE_OPS = (">", ">=", "<", "<=", "=")
TONES = ("good", "warning", "bad")
MAX_FORMATS, MAX_FORMAT_RULES = 20, 5


def _formats(raw, out_columns: list[dict]) -> list[dict]:
    """Conditional formatting: per totalled column (a measure, or one of its comparisons, <field>__<kind>) a colour scale,
    data bars, or up to five rules, each a comparison with a number and a tone (good, warning, bad); the first rule that
    matches a cell colours it."""
    if raw in (None, []):
        return []
    if not isinstance(raw, list) or len(raw) > MAX_FORMATS:
        raise DefinitionError("view.formats", f"Formatting is a list of up to {MAX_FORMATS} columns.")
    keys = set()
    for column in out_columns:
        if "aggregate" in column:
            keys.add(column["field"])
            keys.update(f"{column['field']}__{kind}" for kind in column.get("compare", []))
    out, seen = [], set()
    for i, item in enumerate(raw):
        at = f"view.formats[{i}]"
        if not isinstance(item, dict) or item.get("column") not in keys:
            raise DefinitionError(f"{at}.column", "Format one of the report's totalled columns.")
        if item["column"] in seen:
            raise DefinitionError(f"{at}.column", "Each column is formatted once.")
        seen.add(item["column"])
        style = item.get("style")
        if style not in FORMAT_STYLES:
            raise DefinitionError(f"{at}.style", "Use a colour scale, data bars or rules.")
        entry = {"column": item["column"], "style": style}
        if style == "rules":
            rules = item.get("rules")
            if not isinstance(rules, list) or not 1 <= len(rules) <= MAX_FORMAT_RULES:
                raise DefinitionError(f"{at}.rules", f"Give 1 to {MAX_FORMAT_RULES} rules.")
            checked = []
            for j, rule in enumerate(rules):
                where = f"{at}.rules[{j}]"
                value = rule.get("value") if isinstance(rule, dict) else None
                if not isinstance(rule, dict) or rule.get("op") not in RULE_OPS or isinstance(value, bool) or not isinstance(value, (int, float)) or rule.get("tone") not in TONES:
                    raise DefinitionError(where, "A rule is more than, at least, less than, at most or equal to a number, and good, warning or bad.")
                checked.append({"op": rule["op"], "value": value, "tone": rule["tone"]})
            entry["rules"] = checked
        out.append(entry)
    return out


def _view(raw, out_columns: list[dict]) -> dict | None:
    """How the report is shown: the view, the chart's kind (bars, lines, area, a pie of the first measure by the first dimension,
    or a funnel of its stages in the report's order), and the dimension spread across (one of the report's own)."""
    if raw is None:
        return None
    if not isinstance(raw, dict) or raw.get("type") not in VIEW_TYPES:
        raise DefinitionError("view.type", "Use grid, chart, hierarchy or pivot.")
    out = {"type": raw["type"]}
    chart = raw.get("chart")
    if chart is not None:
        if chart not in CHART_KINDS:
            raise DefinitionError("view.chart", "Use bar, line, area, pie, funnel, stacked, stacked100 or combo.")
        out["chart"] = chart
    across = raw.get("across")
    if across is not None:
        if not any(c["field"] == across and "aggregate" not in c for c in out_columns):
            raise DefinitionError("view.across", "Spread one of the report's dimensions across.")
        out["across"] = across
    formats = _formats(raw.get("formats"), out_columns)
    if formats:
        out["formats"] = formats
    signals = raw.get("signals")                                       # a chart's forecast line and anomaly flags, worked out in the browser
    if signals not in (None, [], {}):
        if not isinstance(signals, list) or any(s not in SIGNALS for s in signals) or len(set(signals)) != len(signals):
            raise DefinitionError("view.signals", "Use forecast, anomalies, or both.")
        out["signals"] = [s for s in SIGNALS if s in signals]
    return out


def validate(dataset: dict, raw: dict, *, max_limit: int = MAX_LIMIT) -> dict:
    """The definition, normalised, or DefinitionError naming the part at fault."""
    if not isinstance(raw, dict):
        raise DefinitionError("definition", "The definition is an object.")
    try:                                                              # the report's custom fields join the dataset's for everything below
        specs = derived.check(dataset, raw.get("derived"))
    except derived.DerivedError as exc:
        raise DefinitionError(exc.field, str(exc)) from None
    dataset = derived.augment(dataset, {"derived": specs})
    columns = raw.get("columns")
    if not isinstance(columns, list) or not columns:
        raise DefinitionError("columns", "Choose at least one column.")
    if len(columns) > MAX_COLUMNS:
        raise DefinitionError("columns", f"A report has {MAX_COLUMNS} columns at most.")
    out_columns, seen = [], set()
    for index, column in enumerate(columns):
        at = f"columns[{index}]"
        if not isinstance(column, dict):
            raise DefinitionError(at, "A column names a field.")
        field = _field_of(dataset, column.get("field"), f"{at}.field")
        aggregate, bucket = column.get("aggregate"), column.get("bucket")
        if aggregate is not None:
            if aggregate not in field["aggregates"]:
                raise DefinitionError(f"{at}.aggregate", f"{field['label']} cannot be {aggregate}med." if aggregate == "sum" else f"{field['label']} does not take {aggregate}.")
        elif field["role"] == "measure":
            raise DefinitionError(f"{at}.aggregate", f"{field['label']} is a measure: choose how to total it ({', '.join(field['aggregates'])}).")
        if bucket is not None:
            if field["type"] not in ("date", "datetime"):
                raise DefinitionError(f"{at}.bucket", "Only a date can be grouped by day, week, month, quarter or year.")
            if bucket not in BUCKETS:
                raise DefinitionError(f"{at}.bucket", f"Use one of {', '.join(BUCKETS)}.")
            if aggregate is not None:
                raise DefinitionError(f"{at}.bucket", "A totalled column has no bucket.")
        label = column.get("label")
        if label is not None and (not isinstance(label, str) or len(label) > 100):
            raise DefinitionError(f"{at}.label", "A label is text of up to 100 characters.")
        kinds = column.get("compare")
        if kinds is not None:
            if aggregate is None:
                raise DefinitionError(f"{at}.compare", "Only a totalled column can be compared.")
            if (not isinstance(kinds, list) or len(kinds) > comparisons.MAX_PER_MEASURE or len(set(map(str, kinds))) != len(kinds)
                    or any(kind not in comparisons.KINDS for kind in kinds)):
                raise DefinitionError(f"{at}.compare", f"Compare with up to {comparisons.MAX_PER_MEASURE} of {', '.join(comparisons.KINDS)}, each once.")
            if any(kind in comparisons.ADDITIVE_KINDS for kind in kinds) and aggregate not in comparisons.ADDITIVE:
                raise DefinitionError(f"{at}.compare", f"A running total, a year or quarter to date and a share of the total add up sums and counts; {field['label']} is totalled as {aggregate}.")
        target = column.get("target")
        if kinds and any(kind in comparisons.TARGET_KINDS for kind in kinds):
            if isinstance(target, bool) or not isinstance(target, (int, float)):
                raise DefinitionError(f"{at}.target", "Give the target, a number, to compare with.")
        else:
            target = None
        key = (field["key"], aggregate, bucket)
        if key in seen:
            raise DefinitionError(at, f"{field['label']} is already a column.")
        seen.add(key)
        out_columns.append({"field": field["key"], **({"aggregate": aggregate} if aggregate else {}), **({"bucket": bucket} if bucket else {}),
                            **({"label": label} if label else {}), **({"compare": list(kinds)} if kinds else {}), **({"target": target} if target is not None else {})})
    timed = next((i for i, c in enumerate(out_columns) if any(kind in comparisons.TIMED for kind in c.get("compare", []))), None)
    if timed is not None and comparisons.axis(dataset, out_columns) is None:
        raise DefinitionError(f"columns[{timed}].compare", "Comparing with an earlier period, or adding up along the dates, needs a date in the report, such as Sent by Month.")
    grouped = any("aggregate" in c for c in out_columns)
    filters = _filters(dataset, raw.get("filters"), "filters", 0, [0])
    order = raw.get("orderBy", [])
    if not isinstance(order, list):
        raise DefinitionError("orderBy", "Sorting is a list.")
    out_order = []
    for index, item in enumerate(order):
        at = f"orderBy[{index}]"
        if not isinstance(item, dict):
            raise DefinitionError(at, "A sort names a column and a direction.")
        direction = str(item.get("direction", "asc")).lower()
        if direction not in DIRECTIONS:
            raise DefinitionError(f"{at}.direction", "Use asc or desc.")
        if not any(c["field"] == item.get("field") for c in out_columns) and not _blended_key(raw.get("blend"), item.get("field")):
            raise DefinitionError(f"{at}.field", "Sort by one of the report's columns.")
        out_order.append({"field": item["field"], "direction": direction})
    limit = raw.get("limit")
    if limit is not None:
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise DefinitionError("limit", "The limit is a whole number of rows.")
        limit = min(limit, max_limit)
    view = _view(raw.get("view"), out_columns)
    try:
        top = topn.check(raw.get("top"), out_columns)
    except ValueError as exc:
        raise DefinitionError("top", str(exc)) from None
    through = raw.get("drillthrough")
    if through not in (None, []):
        if not isinstance(through, list) or len(through) > 10:
            raise DefinitionError("drillthrough", "A report takes up to 10 fields from other reports.")
        for i, key in enumerate(through):
            field = next((f for f in dataset["fields"] if f["key"] == key and f["role"] == "dimension"), None)
            if field is None:
                raise DefinitionError(f"drillthrough[{i}]", "A report takes dimensions of its dataset from other reports.")
        through = list(dict.fromkeys(through))
    try:
        blend = links.check(dataset, raw.get("blend"), out_columns, compared=any(c.get("compare") for c in out_columns), top=bool(top), view=view)
    except links.BlendError as exc:
        raise DefinitionError(exc.field, str(exc)) from None
    for index, item in enumerate(out_order):
        if "." in item["field"] and not (blend and any(links.column_key(blend["dataset"], c["field"]) == item["field"] for c in blend["columns"])):
            raise DefinitionError(f"orderBy[{index}].field", "Sort by one of the report's columns.")
    return {"dataset": dataset["key"], "columns": out_columns, "grouped": grouped, "filters": filters, "orderBy": out_order, **({"limit": limit} if limit else {}),
            **({"view": view} if view else {}), **({"drillthrough": through} if through else {}), **({"derived": specs} if specs else {}), **({"top": top} if top else {}), **({"blend": blend} if blend else {})}


def _blended_key(raw, key) -> bool:
    """a sort on a measure added from a linked dataset ("attributed_orders.revenue"), checked once the blend is"""
    return isinstance(key, str) and "." in key and isinstance(raw, dict) and key.split(".", 1)[0] == raw.get("dataset")


def _blended_key(raw, key) -> bool:
    """a sort on a measure added from a linked dataset ("attributed_orders.revenue"), checked once the blend is"""
    return isinstance(key, str) and "." in key and isinstance(raw, dict) and key.split(".", 1)[0] == raw.get("dataset")


def _blended_key(raw, key) -> bool:
    """a sort on a measure added from a linked dataset ("attributed_orders.revenue"), checked once the blend is"""
    return isinstance(key, str) and "." in key and isinstance(raw, dict) and key.split(".", 1)[0] == raw.get("dataset")


def signature(definition: dict) -> str:
    """One hash for one normalised definition: the audit's filter signature and the result cache's key."""
    return hashlib.sha256(json.dumps(definition, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
