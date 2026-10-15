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
column may carry a bucket (day, week, month, quarter, year), applied in the workspace's time zone.
"""
import hashlib
import json
from datetime import date

from .catalog import BUCKETS

MAX_COLUMNS = 40
MAX_RULES = 30
MAX_NESTING = 2
MAX_LIMIT = 100_000
DIRECTIONS = ("asc", "desc")
COMBINATORS = ("and", "or")


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


def validate(dataset: dict, raw: dict, *, max_limit: int = MAX_LIMIT) -> dict:
    """The definition, normalised, or DefinitionError naming the part at fault."""
    if not isinstance(raw, dict):
        raise DefinitionError("definition", "The definition is an object.")
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
        key = (field["key"], aggregate, bucket)
        if key in seen:
            raise DefinitionError(at, f"{field['label']} is already a column.")
        seen.add(key)
        out_columns.append({"field": field["key"], **({"aggregate": aggregate} if aggregate else {}), **({"bucket": bucket} if bucket else {}),
                            **({"label": label} if label else {})})
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
        if not any(c["field"] == item.get("field") for c in out_columns):
            raise DefinitionError(f"{at}.field", "Sort by one of the report's columns.")
        out_order.append({"field": item["field"], "direction": direction})
    limit = raw.get("limit")
    if limit is not None:
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise DefinitionError("limit", "The limit is a whole number of rows.")
        limit = min(limit, max_limit)
    return {"dataset": dataset["key"], "columns": out_columns, "grouped": grouped, "filters": filters, "orderBy": out_order, **({"limit": limit} if limit else {})}


def signature(definition: dict) -> str:
    """One hash for one normalised definition: the audit's filter signature and the result cache's key."""
    return hashlib.sha256(json.dumps(definition, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
