"""The pivot and the hierarchy as tables, from a run's columns and rows: the server's twin of the front end's shape.ts, for
the Excel export (and the engine's totals later). Subtotals combine the rows shown: sums and counts add up, minimums and
maximums compare, averages and distinct counts cannot be combined and read as None.

    pivot(columns, rows, across, measure_key) -> {"header": [...], "rows": [[...], ...], "total": [...]} or {"reason": ...}
    hierarchy(columns, rows) -> {"header": [...], "rows": [(depth, is_group, [...cells]), ...], "total": [...]} or {"reason": ...}
"""
from numbers import Number


def _same(a, b) -> bool:
    return (str(a) if a is not None else "") == (str(b) if b is not None else "")


def _exact(totals, keys: dict, index: int):
    """the engine's total for these dimension keys, when it computed one"""
    for entry in totals or []:
        if len(entry["keys"]) == len(keys) and all(k in entry["keys"] and _same(entry["keys"][k], v) for k, v in keys.items()):
            return entry["values"][index]
    return None


def _agg(column: dict):
    """the aggregate a subtotal combines by; a time comparison (a running total, a change, a share) is never combined"""
    return None if column.get("compare") else column.get("aggregate")


def _combine(aggregate, values):
    numbers = [v for v in values if isinstance(v, Number) and not isinstance(v, bool)]
    if not numbers:
        return None
    if aggregate in ("sum", "count"):
        return sum(numbers)
    if aggregate == "min":
        return min(numbers)
    if aggregate == "max":
        return max(numbers)
    return None


def _split(columns, across=None):
    dims = [(i, c) for i, c in enumerate(columns) if not c.get("aggregate")]
    meas = [(i, c) for i, c in enumerate(columns) if c.get("aggregate")]
    spread = next(((i, c) for i, c in dims if c["key"] == across), None)
    down = [(i, c) for i, c in dims if not spread or c["key"] != across]
    return dims, meas, spread, down


def _distinct(rows, index):
    seen, out = set(), []
    for row in rows:
        key = str(row[index]) if row[index] is not None else ""
        if key not in seen:
            seen.add(key)
            out.append(row[index])
    return out


def pivot(columns: list[dict], rows: list[list], across: str | None, measure_key: str | None = None, totals: list[dict] | None = None) -> dict:
    dims, meas, spread, down = _split(columns, across)
    measure = next(((i, c) for i, c in meas if c["key"] == measure_key), meas[0] if meas else None)
    if not measure:
        return {"reason": "A pivot needs a value for its cells."}
    if not spread:
        return {"reason": "A pivot needs a dimension to spread across the columns."}
    if not down:
        return {"reason": "A pivot needs a dimension down the rows as well."}
    m_index, m_col = measure
    s_index, s_col = spread
    column_values = _distinct(rows, s_index)
    at = {(str(v) if v is not None else ""): i for i, v in enumerate(column_values)}
    lines: dict[tuple, dict] = {}
    for row in rows:
        key = tuple(str(row[i]) if row[i] is not None else "" for i, _ in down)
        line = lines.setdefault(key, {"labels": [row[i] for i, _ in down], "cells": [None] * len(column_values)})
        c = at[str(row[s_index]) if row[s_index] is not None else ""]
        line["cells"][c] = _combine(_agg(m_col), [line["cells"][c], row[m_index]])
    m_at = [i for i, _ in meas].index(m_index)
    exact = (lambda keys: _exact(totals, keys, m_at)) if totals else (lambda keys: None)
    out_rows = [[*line["labels"], *line["cells"], (lambda e: e if e is not None else _combine(_agg(m_col), line["cells"]))(exact(dict(zip([c["key"] for _, c in down], line["labels"]))))]
                for line in lines.values()]
    column_totals = [(lambda e: e if e is not None else _combine(_agg(m_col), [line["cells"][c] for line in lines.values()]))(exact({s_col["key"]: column_values[c]}))
                     for c in range(len(column_values))]
    grand = (lambda e: e if e is not None else _combine(_agg(m_col), column_totals))(exact({}))
    return {"row_columns": [c for _, c in down], "across": s_col, "measure": m_col, "column_values": column_values,
            "header": [*(c["label"] for _, c in down), *column_values, "Total"], "rows": out_rows, "total": ["Total", *([None] * (len(down) - 1)), *column_totals, grand]}


def hierarchy(columns: list[dict], rows: list[list], totals: list[dict] | None = None) -> dict:
    dims, meas, _, _ = _split(columns)
    if len(dims) < 2:
        return {"reason": "A hierarchy needs two or more dimensions."}
    if not meas:
        return {"reason": "A hierarchy needs a value to total per group."}
    roots: list[dict] = []
    for row in rows:
        siblings = roots
        node = None
        for depth, (i, _) in enumerate(dims):
            key = str(row[i]) if row[i] is not None else ""
            node = next((n for n in siblings if n["key"] == key), None)
            if node is None:
                node = {"key": key, "value": row[i], "depth": depth, "children": [], "row": None, "path": {c["key"]: row[j] for j, c in dims[:depth + 1]}}
                siblings.append(node)
            siblings = node["children"]
        if node is not None:
            node["row"] = [row[i] for i, _ in meas]

    def total(nodes):
        for node in nodes:
            if node["children"]:
                total(node["children"])
                node["totals"] = [(lambda e: e if e is not None else _combine(_agg(c), [(child["row"][m] if child["row"] else child["totals"][m]) for child in node["children"]]))(_exact(totals, node["path"], m))
                                  for m, (_, c) in enumerate(meas)]
            else:
                node["totals"] = [v if isinstance(v, Number) else None for v in (node["row"] or [])]

    total(roots)
    lines = []

    def walk(nodes):
        for node in nodes:
            group = bool(node["children"])
            lines.append((node["depth"], group, [node["value"], *(node["totals"] if group else node["row"])]))
            walk(node["children"])

    walk(roots)
    grand = [(lambda e: e if e is not None else _combine(_agg(c), [node["totals"][m] for node in roots]))(_exact(totals, {}, m)) for m, (_, c) in enumerate(meas)]
    return {"levels": [c for _, c in dims], "measures": [c for _, c in meas], "header": [" / ".join(c["label"] for _, c in dims), *(c["label"] for _, c in meas)],
            "rows": lines, "total": ["Total", *grand]}
