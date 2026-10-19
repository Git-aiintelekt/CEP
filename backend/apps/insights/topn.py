"""Top N with Others: a definition's `top` ({"n": 10, "others": true}) keeps the n values of its first dimension with the
largest total of the measure it is sorted by (else its first measure), and folds the rest into one "Others" line per value
of the other dimensions. In an Others line sums and counts add up, minimums and maximums compare, and an average, a
distinct count, a calculated measure or a comparison cannot be combined and is empty. Without `others` the rest is left out.
The engine's totals (a hierarchy's or a pivot's) are of every row, Others included.
"""
from numbers import Number

OTHERS = "Others"
MAX_N = 100


def _measure_index(definition: dict) -> int | None:
    columns = definition["columns"]
    for item in definition.get("orderBy", []):
        at = next((i for i, c in enumerate(columns) if c["field"] == item["field"] and "aggregate" in c), None)
        if at is not None:
            return at
    return next((i for i, c in enumerate(columns) if "aggregate" in c), None)


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


def apply(definition: dict, columns: list[dict], rows: list[list]) -> list[list]:
    """The rows cut to the top n of the first dimension, with the rest as Others when asked. `columns` are the result's
    (comparisons included), each row matching them."""
    top = definition.get("top")
    if not top or not rows:
        return rows
    first = next((i for i, c in enumerate(columns) if not c.get("aggregate")), None)
    spec_at = _measure_index(definition)
    if first is None or spec_at is None:
        return rows
    key = columns_index(definition, columns, spec_at)
    totals: dict[str, float] = {}
    order: list[str] = []
    for row in rows:
        value = str(row[first])
        if value not in totals:
            totals[value] = 0.0
            order.append(value)
        number = row[key]
        if isinstance(number, Number) and not isinstance(number, bool):
            totals[value] += float(number)
    kept = set(sorted(order, key=lambda v: (-totals[v], order.index(v)))[: int(top["n"])])
    shown = [row for row in rows if str(row[first]) in kept]
    if not top.get("others") or len(kept) == len(order):
        return shown
    rest = [row for row in rows if str(row[first]) not in kept]
    dims = [i for i, c in enumerate(columns) if not c.get("aggregate") and i != first]
    groups: dict[tuple, list[list]] = {}
    for row in rest:
        groups.setdefault(tuple(str(row[i]) for i in dims), []).append(row)
    others = []
    for members in groups.values():
        line = []
        for i, column in enumerate(columns):
            if i == first:
                line.append(OTHERS)
            elif not column.get("aggregate"):
                line.append(members[0][i])
            else:
                line.append(None if column.get("compare") else _combine(column["aggregate"], [m[i] for m in members]))
        others.append(line)
    return [*shown, *others]


def columns_index(definition: dict, columns: list[dict], spec_at: int) -> int:
    """the result column of the definition's spec_at-th column: comparisons sit after their measure"""
    at = 0
    for i, spec in enumerate(definition["columns"]):
        if i == spec_at:
            return at
        at += 1 + len(spec.get("compare", []))
    return spec_at


def check(raw, columns: list[dict]):
    """the definition's `top`, checked: n from 1 to 100, and a dimension and a measure to rank by"""
    if raw in (None, False, {}):
        return None
    if not isinstance(raw, dict):
        raise ValueError("Top is a number of values and whether the rest show as Others.")
    n = raw.get("n")
    if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= MAX_N:
        raise ValueError(f"Keep 1 to {MAX_N} values.")
    if not any("aggregate" in c for c in columns) or not any("aggregate" not in c for c in columns):
        raise ValueError("Top needs a dimension to rank and a value to rank it by.")
    return {"n": n, "others": bool(raw.get("others"))}
