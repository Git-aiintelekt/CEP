"""Linked datasets (report_dataset_link, patch 0061): two of the platform's datasets that share dimensions, so a report on one
adds measures from the other. Messages and Attributed Orders share the campaign and the channel, and a period on the send date
is the same period on the order date: "Sent and revenue by campaign" is one report.

    "blend": {"dataset": "attributed_orders", "columns": [{"field": "revenue", "aggregate": "sum"}]}

Each side is totalled on its own, by the report's groups, and the other side's totals are matched to the report's rows (a
row the other side has no total for shows it empty; the other side's rows with no match in the report are not shown). The
report's groups must all be ones the two share, a date only on the linked dates. Rules on the shared fields and the linked
date apply to both sides; other rules apply to the report's own dataset only, and the result says so. A blended report has
no time comparisons, no Top N, and no hierarchy totals.

The catalogue carries each dataset's links with the measures the other dataset offers (catalog._load), so checking a
definition needs nothing else; running one reads the other dataset from the catalogue and applies the person's row access
rules for it too.
"""
from django.conf import settings
from django.core.cache import cache
from django.db import connections

MAX_COLUMNS = 6
TTL = 60


class BlendError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


def present() -> bool:
    key = "cep:insights:present:report_dataset_link"
    known = cache.get(key)
    if known is None:
        with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
            cursor.execute("SELECT to_regclass('report_dataset_link') IS NOT NULL")
            known = bool(cursor.fetchone()[0])
        cache.set(key, known, TTL)
    return known


def load() -> list[dict]:
    """the active links, from each dataset to another"""
    if not present():
        return []
    cached = cache.get("cep:insights:links")
    if cached is not None:
        return cached
    import json
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("""SELECT from_dataset, to_dataset, label, pairs, time_pair FROM report_dataset_link WHERE status = 'ACTIVE'
                           ORDER BY from_dataset, sort_order, to_dataset""")
        rows = cursor.fetchall()
    out = []
    for source, target, label, pairs, time_pair in rows:
        pairs = json.loads(pairs) if isinstance(pairs, str) else pairs
        time_pair = json.loads(time_pair) if isinstance(time_pair, str) else time_pair
        out.append({"from": source, "to": target, "label": label, "pairs": [list(p) for p in pairs or [] if isinstance(p, list) and len(p) == 2],
                    "time_pair": list(time_pair) if isinstance(time_pair, list) and len(time_pair) == 2 else None})
    cache.set("cep:insights:links", out, TTL)
    return out


def invalidate() -> None:
    cache.delete("cep:insights:links")
    cache.delete("cep:insights:present:report_dataset_link")


def attach(datasets: list[dict], links: list[dict]) -> list[dict]:
    """each dataset with its links, each link with the other dataset's label and the measures it offers (no PII, no confidential)"""
    by_key = {d["key"]: d for d in datasets}
    out = []
    for d in datasets:
        mine = []
        for link in links:
            other = by_key.get(link["to"])
            if link["from"] != d["key"] or other is None:
                continue
            keys = {f["key"] for f in d["fields"]}
            other_keys = {f["key"] for f in other["fields"]}
            pairs = [p for p in link["pairs"] if p[0] in keys and p[1] in other_keys]
            time_pair = link["time_pair"] if link["time_pair"] and link["time_pair"][0] in keys and link["time_pair"][1] in other_keys else None
            if not pairs and not time_pair:
                continue
            measures = [{k: f[k] for k in ("key", "label", "type", "aggregates", "format", "formula") if k in f}
                        for f in other["fields"] if f["role"] == "measure" and f["sensitivity"] not in ("PII", "CONFIDENTIAL")]
            mine.append({"to": link["to"], "to_label": other["label"], "label": link["label"], "pairs": pairs, "time_pair": time_pair, "measures": measures})
        out.append({**d, "links": mine} if mine else d)
    return out


def column_key(target: str, field: str) -> str:
    return f"{target}.{field}"


def check(dataset: dict, raw, out_columns: list[dict], *, compared: bool, top: bool, view: dict | None) -> dict | None:
    """the blend, normalised, or BlendError"""
    if raw in (None, {}):
        return None
    if not isinstance(raw, dict):
        raise BlendError("blend", "Measures from a linked dataset name the dataset and the measures.")
    link = next((l for l in dataset.get("links", []) if l["to"] == raw.get("dataset")), None)
    if link is None:
        raise BlendError("blend.dataset", f"{dataset['label']} has no link to that dataset.")
    columns = raw.get("columns")
    if not isinstance(columns, list) or not columns:
        raise BlendError("blend.columns", f"Choose a measure from {link['to_label']}.")
    if len(columns) > MAX_COLUMNS:
        raise BlendError("blend.columns", f"Up to {MAX_COLUMNS} measures from a linked dataset.")
    if compared or top:
        raise BlendError("blend", "A report with measures from a linked dataset has no time comparisons and no Top N.")
    if view and view.get("type") == "hierarchy":
        raise BlendError("blend", "A report with measures from a linked dataset is shown as a table, a chart or a pivot, not a hierarchy.")
    shared = {p[0] for p in link["pairs"]}
    time_from = link["time_pair"][0] if link["time_pair"] else None
    for i, column in enumerate(out_columns):
        if "aggregate" in column:
            continue
        if column["field"] in shared or (column["field"] == time_from and column.get("bucket")):
            continue
        words = [f["label"] for f in dataset["fields"] if f["key"] in shared]
        if time_from:
            words.append(next((f["label"] for f in dataset["fields"] if f["key"] == time_from), time_from) + " by a period")
        raise BlendError(f"columns[{i}].field", f"With measures from {link['to_label']}, group only by what both share: {', '.join(words)}.")
    if not any("aggregate" not in c for c in out_columns):
        raise BlendError("blend", f"Group the report by something both share before adding measures from {link['to_label']}.")
    out, seen = [], set()
    for i, column in enumerate(columns):
        at = f"blend.columns[{i}]"
        if not isinstance(column, dict):
            raise BlendError(at, "A column names a measure.")
        field = next((m for m in link["measures"] if m["key"] == column.get("field")), None)
        if field is None:
            raise BlendError(f"{at}.field", f"Not a measure of {link['to_label']}.")
        aggregate = column.get("aggregate")
        if aggregate not in field["aggregates"]:
            raise BlendError(f"{at}.aggregate", f"{field['label']} takes {', '.join(field['aggregates'])}.")
        label = column.get("label")
        if label is not None and (not isinstance(label, str) or len(label) > 100):
            raise BlendError(f"{at}.label", "A label is text of up to 100 characters.")
        if field["key"] in seen:
            raise BlendError(at, f"{field['label']} is already added.")
        seen.add(field["key"])
        out.append({"field": field["key"], "aggregate": aggregate, **({"label": label} if label else {})})
    return {"dataset": link["to"], "columns": out}


def _mapped_rules(definition: dict, mapping: dict) -> tuple[list[dict], list[str]]:
    """the report's top-level rules that apply to the other side too, renamed; and the fields of the rules that do not"""
    filters = definition.get("filters") or {"combinator": "and", "rules": []}
    carried, own = [], []
    for rule in filters.get("rules", []):
        if "rules" in rule or filters.get("combinator") != "and":
            own.extend(r.get("field") for r in (rule.get("rules") or [rule]) if r.get("field"))
            continue
        if rule.get("field") in mapping:
            carried.append({**rule, "field": mapping[rule["field"]]})
        else:
            own.append(rule["field"])
    return carried, own


def other_definition(dataset: dict, definition: dict) -> tuple[dict, list[str]]:
    """the definition the linked side runs: the report's groups renamed, the blend's measures, the rules that carry over; and the
    fields whose rules stay on the report's side"""
    blend = definition["blend"]
    link = next(l for l in dataset["links"] if l["to"] == blend["dataset"])
    mapping = {a: b for a, b in link["pairs"]}
    if link["time_pair"]:
        mapping[link["time_pair"][0]] = link["time_pair"][1]
    groups = [{"field": mapping[c["field"]], **({"bucket": c["bucket"]} if c.get("bucket") else {})} for c in definition["columns"] if "aggregate" not in c]
    rules, own = _mapped_rules(definition, mapping)
    return {"dataset": blend["dataset"], "columns": [*groups, *blend["columns"]], "grouped": True, "filters": {"combinator": "and", "rules": rules},
            "orderBy": []}, own


def columns(dataset: dict, definition: dict, other: dict) -> list[dict]:
    """the blended columns as the result shows them"""
    target = definition["blend"]["dataset"]
    out = []
    for column in definition["blend"]["columns"]:
        field = next(f for f in other["fields"] if f["key"] == column["field"])
        out.append({"key": column_key(target, field["key"]), "label": column.get("label") or f"{field['label']} ({other['label']})", "type": "number" if field["type"] in ("number", "integer") else field["type"],
                    "format": field["format"], "aggregate": column["aggregate"], "linked": target})
    return out


def merge(definition: dict, rows: list[list], other_rows: list[list]) -> list[list]:
    """each of the report's rows with the other side's totals for its groups"""
    dims = [i for i, c in enumerate(definition["columns"]) if "aggregate" not in c]
    width = len(definition["blend"]["columns"])
    found = {}
    for row in other_rows:
        found[tuple(_same(v) for v in row[:len(dims)])] = list(row[len(dims):len(dims) + width])
    return [list(row) + found.get(tuple(_same(row[i]) for i in dims), [None] * width) for row in rows]


def _same(value):
    """a group's value as a key both sides agree on (a date and a timestamp of the same bucket, text case as it is)"""
    if hasattr(value, "isoformat"):
        return value.isoformat()[:19]
    return value
