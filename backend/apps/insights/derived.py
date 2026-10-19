"""Custom fields: a report's own dimensions computed from a row, kept in its definition (`derived`, up to 10) and used like
any dimension of the dataset: as rows, the spread across, a filter, a slicer of the report.

    {"key": "c_region", "label": "Region", "kind": "group", "field": "store",
     "groups": [{"label": "North", "values": ["Downtown", "Riverside"]}], "other": "Other"}
    {"key": "c_size", "label": "Order Size", "kind": "band", "field": "amount", "edges": [100, 1000]}
         -> "Under 100", "100 to under 1,000", "1,000 and over" (or `labels`, one more than the edges)
    {"key": "c_tier", "label": "Tier", "kind": "rule", "rules": [{"field": "amount", "op": ">=", "value": 500, "label": "Gold"}], "other": "Standard"}
    {"key": "c_margin", "label": "Margin", "kind": "formula", "expression": "[Revenue] - [Cost]", "type": "number", "role": "measure", "format": "money"}
    {"key": "c_rate", "label": "Email Rate", "kind": "measure", "expression": "DIVIDE(SUM([Sent], [Channel] = \"EMAIL\"), SUM([Sent])) * 100", "type": "number", "format": "percent"}

A formula (a calculated column) and a measure formula are written in the formula language (apps/insights/formula.py). A
formula may read the dataset's fields and the custom fields before it; a number formula is a measure (summed, averaged..) or
a dimension (grouped), a date one a dimension with buckets. A measure formula is a calculated measure (aggregate `calc`).

The compiler writes a CASE over the source columns with the values as escaped literals (they are checked against the
source field's type first), so no placeholder order changes. A custom field over personal data is personal itself.
"""
import re

from . import formula
from .catalog import BUCKETS, OPERATORS

KINDS = ("group", "band", "rule", "formula", "measure")
NUMBER_FORMATS = ("integer", "decimal", "money", "percent")
MEASURE_AGGREGATES = ["sum", "avg", "min", "max", "count"]
RULE_OPS = ("=", "!=", ">", ">=", "<", "<=")
SOURCE_TYPES = ("string", "number", "boolean")
MAX_FIELDS, MAX_GROUPS, MAX_VALUES, MAX_EDGES, MAX_RULES = 10, 20, 200, 20, 10
POSITIONAL = ("postgresql", "mysql")


class DerivedError(ValueError):
    def __init__(self, field: str, message: str, at: int | None = None):
        super().__init__(message)
        self.field = field
        self.at = at                                                   # in a formula: where in its text


def _source(dataset: dict, key, where: str, types=SOURCE_TYPES) -> dict:
    field = next((f for f in dataset["fields"] if f["key"] == key and not f.get("derived") and not f.get("formula")), None)
    if field is None or field["type"] not in types:
        raise DerivedError(where, "Use a text, number or yes/no field of the dataset.")
    return field


def _scalar(field: dict, value, where: str):
    if field["type"] == "number":
        if isinstance(value, bool):
            raise DerivedError(where, "Give a number.")
        try:
            return float(value) if not isinstance(value, int) else value
        except (TypeError, ValueError):
            raise DerivedError(where, "Give a number.") from None
    if field["type"] == "boolean":
        if isinstance(value, bool):
            return value
        if str(value).lower() in ("true", "false", "yes", "no"):
            return str(value).lower() in ("true", "yes")
        raise DerivedError(where, "Give yes or no.")
    text = str(value) if value is not None else ""
    if not text or len(text) > 200:
        raise DerivedError(where, "Give a value of up to 200 characters.")
    return text


def _label(value, where: str, default: str | None = None) -> str:
    text = " ".join(str(value or default or "").split())[:60]
    if not text:
        raise DerivedError(where, "Give a label.")
    return text


def _number_words(n: float) -> str:
    return f"{int(n):,}" if float(n).is_integer() else f"{n:,}"


def check(dataset: dict, raw) -> list[dict]:
    """The definition's custom fields, checked against the dataset and normalised."""
    if raw in (None, []):
        return []
    if not isinstance(raw, list) or len(raw) > MAX_FIELDS:
        raise DerivedError("derived", f"A report has up to {MAX_FIELDS} custom fields.")
    out, keys = [], {f["key"] for f in dataset["fields"]}
    for i, item in enumerate(raw):
        at = f"derived[{i}]"
        if not isinstance(item, dict) or item.get("kind") not in KINDS:
            raise DerivedError(f"{at}.kind", "A custom field is groups, bands, if-then labels, a formula or a measure formula.")
        label = _label(item.get("label"), f"{at}.label")
        key = str(item.get("key") or "") or "c_" + re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
        if not re.match(r"^c_[a-z0-9_]{1,40}$", key):
            key = f"c_field{i + 1}"
        if key in keys:
            raise DerivedError(f"{at}.label", "Another field has this name.")
        keys.add(key)
        spec = {"key": key, "label": label, "kind": item["kind"]}
        if item["kind"] in ("formula", "measure"):
            out.append({**spec, **_formula_spec(augment(dataset, {"derived": out}), item, at)})
            continue
        if item["kind"] == "group":
            source = _source(dataset, item.get("field"), f"{at}.field", ("string", "number"))
            groups = item.get("groups")
            if not isinstance(groups, list) or not 1 <= len(groups) <= MAX_GROUPS:
                raise DerivedError(f"{at}.groups", f"Give 1 to {MAX_GROUPS} groups.")
            spec["field"] = source["key"]
            spec["groups"] = []
            for j, group in enumerate(groups):
                where = f"{at}.groups[{j}]"
                values = group.get("values") if isinstance(group, dict) else None
                if not isinstance(values, list) or not 1 <= len(values) <= MAX_VALUES:
                    raise DerivedError(f"{where}.values", f"Give 1 to {MAX_VALUES} values.")
                spec["groups"].append({"label": _label(group.get("label"), f"{where}.label"), "values": [_scalar(source, v, f"{where}.values") for v in values]})
            spec["other"] = _label(item.get("other"), f"{at}.other", "Other")
        elif item["kind"] == "band":
            source = _source(dataset, item.get("field"), f"{at}.field", ("number",))
            edges = item.get("edges")
            if not isinstance(edges, list) or not 1 <= len(edges) <= MAX_EDGES:
                raise DerivedError(f"{at}.edges", f"Give 1 to {MAX_EDGES} edges.")
            edges = [_scalar(source, e, f"{at}.edges") for e in edges]
            if edges != sorted(set(edges)):
                raise DerivedError(f"{at}.edges", "The edges go up, each once.")
            labels = item.get("labels")
            if labels:
                if not isinstance(labels, list) or len(labels) != len(edges) + 1:
                    raise DerivedError(f"{at}.labels", "Give one label more than the edges, or none.")
                labels = [_label(v, f"{at}.labels") for v in labels]
            else:
                words = [_number_words(e) for e in edges]
                labels = [f"Under {words[0]}", *(f"{a} to under {b}" for a, b in zip(words, words[1:])), f"{words[-1]} and over"]
            spec.update({"field": source["key"], "edges": edges, "labels": labels})
        else:
            rules = item.get("rules")
            if not isinstance(rules, list) or not 1 <= len(rules) <= MAX_RULES:
                raise DerivedError(f"{at}.rules", f"Give 1 to {MAX_RULES} conditions.")
            spec["rules"] = []
            for j, rule in enumerate(rules):
                where = f"{at}.rules[{j}]"
                if not isinstance(rule, dict) or rule.get("op") not in RULE_OPS:
                    raise DerivedError(where, "A condition is a field, is, is not, more than, at least, less than or at most, a value and a label.")
                source = _source(dataset, rule.get("field"), f"{where}.field")
                if source["type"] != "number" and rule["op"] not in ("=", "!="):
                    raise DerivedError(f"{where}.op", "Only a number is compared with more or less.")
                spec["rules"].append({"field": source["key"], "op": rule["op"], "value": _scalar(source, rule.get("value"), f"{where}.value"), "label": _label(rule.get("label"), f"{where}.label")})
            spec["other"] = _label(item.get("other"), f"{at}.other", "Other")
        out.append(spec)
    return out


def _formula_spec(dataset: dict, item: dict, at: str) -> dict:
    """a formula's text checked against the fields so far: its type, and how it is used (a number as a measure or a dimension)"""
    text = item.get("expression")
    if not isinstance(text, str):
        raise DerivedError(f"{at}.expression", "Write a formula.", 0)
    try:
        checked = formula.check(text, dataset, measure=item["kind"] == "measure")
    except formula.FormulaError as exc:
        raise DerivedError(f"{at}.expression", str(exc), exc.at) from None
    out = {"expression": text.strip(), "type": checked.type}
    if item["kind"] == "formula":
        top = checked.ast.get("fn") if checked.ast["t"] == "call" else None
        role = item.get("role") or ("dimension" if checked.type != "number" or top in ("YEAR", "MONTH", "DAY") else "measure")
        if role not in ("dimension", "measure") or (role == "measure" and checked.type != "number"):
            raise DerivedError(f"{at}.role", "Only a number formula adds up as a measure; this one is a dimension.")
        out["role"] = role
    fmt = item.get("format")
    if fmt not in (None, ""):
        if fmt not in NUMBER_FORMATS or checked.type != "number":
            raise DerivedError(f"{at}.format", "A number is shown as a whole number, a decimal, money or a percentage.")
        out["format"] = fmt
    return out


def _formula_field(dataset: dict, spec: dict) -> dict:
    checked = formula.check(spec["expression"], dataset, measure=spec["kind"] == "measure")
    type_ = checked.type if checked.type in formula.TYPES else "number"
    shown = spec.get("format") or ({"date": "date", "datetime": "datetime"}.get(type_))
    base = {"key": spec["key"], "label": spec["label"], "column": None, "type": type_, "format": shown, "sensitivity": "PII" if checked.personal else "NORMAL"}
    if spec["kind"] == "measure":
        operands = [{"key": f"{spec['key']}__{call['n']}", "operand": call, "fields": checked.fields} for call in checked.calls]
        return {**base, "role": "measure", "aggregates": ["calc"], "operators": [], "buckets": [],
                "expression": {"text": spec["expression"], "checked": checked, "operands": operands}}
    measure = spec.get("role") == "measure"
    return {**base, "role": "measure" if measure else "dimension", "aggregates": list(MEASURE_AGGREGATES) if measure else [], "operators": OPERATORS[type_],
            "buckets": list(BUCKETS) if type_ in ("date", "datetime") and not measure else [], "derived": {**spec, "checked": checked}}


def _field_of(dataset: dict, spec: dict) -> dict:
    if spec["kind"] in ("formula", "measure"):
        return _formula_field(dataset, spec)
    sources = [spec["field"]] if "field" in spec else [r["field"] for r in spec["rules"]]
    found = [next(f for f in dataset["fields"] if f["key"] == key) for key in sources]
    personal = any(f["sensitivity"] == "PII" for f in found)
    return {"key": spec["key"], "label": spec["label"], "column": None, "type": "string", "role": "dimension", "aggregates": [], "operators": OPERATORS["string"],
            "buckets": [], "format": None, "sensitivity": "PII" if personal else "NORMAL", "derived": {**spec, "sources": {f["key"]: f for f in found}}}


def augment(dataset: dict, definition: dict | None) -> dict:
    """the dataset with the definition's custom fields among its fields"""
    specs = (definition or {}).get("derived") or []
    if not specs:
        return dataset
    have = {f["key"] for f in dataset["fields"]}
    out = dataset
    for spec in specs:                                                  # in order: a formula reads the custom fields before it
        if spec["key"] not in have:
            out = {**out, "fields": [*out["fields"], _field_of(out, spec)]}
    return out


def _literal(value, dialect: str) -> str:
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    text = str(value).replace("'", "''")
    if dialect in ("mysql", "clickhouse"):
        text = text.replace("\\", "\\\\")
    if dialect in POSITIONAL:
        text = text.replace("%", "%%")                                   # a placeholder mark otherwise
    return f"'{text}'"


def case_sql(field: dict, dialect: str, column) -> str:
    """the CASE a custom field is, over its sources' columns (`column(field)` writes one)"""
    spec = field["derived"]
    if spec["kind"] == "formula":
        checked = spec["checked"]
        return formula.render(checked.ast, dialect, lambda key: column(checked.fields[key]))
    sources = spec["sources"]
    lit = lambda v: _literal(v, dialect)                                    # noqa: E731
    if spec["kind"] == "group":
        src = column(sources[spec["field"]])
        whens = " ".join(f"WHEN {src} IN ({', '.join(lit(v) for v in g['values'])}) THEN {lit(g['label'])}" for g in spec["groups"])
        return f"(CASE {whens} ELSE {lit(spec['other'])} END)"
    if spec["kind"] == "band":
        src = column(sources[spec["field"]])
        whens = " ".join(f"WHEN {src} < {lit(edge)} THEN {lit(label)}" for edge, label in zip(spec["edges"], spec["labels"]))
        return f"(CASE WHEN {src} IS NULL THEN NULL {whens} ELSE {lit(spec['labels'][-1])} END)"
    whens = " ".join(f"WHEN {column(sources[r['field']])} {r['op'] if r['op'] != '!=' else '<>'} {lit(r['value'])} THEN {lit(r['label'])}" for r in spec["rules"])
    return f"(CASE {whens} ELSE {lit(spec['other'])} END)"
