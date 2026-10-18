"""Time comparisons on a report's measures: a measure column may carry `compare`, a list of comparisons, each one more result
column right after the measure:

    previous_period         the measure for the bucket before (the previous month on a monthly row)
    previous_year           the measure for the same bucket a year earlier (52 weeks for a weekly row)
    change_previous_period  the change against the bucket before, in percent
    change_previous_year    the change against the same bucket last year, in percent
    running_total           the measure added up along the dates, per value of the other dimensions (sums and counts)
    percent_of_total        the row's share of the report's total (sums and counts)

All but the last need a time axis: the report's first dimension that is a date (a date field, or a date and time bucketed
by day, week, month, quarter or year). The earlier periods come from a second run of the same definition with its date
rules moved back by the offset, matched to the rows by the other dimensions and the bucket moved forward, so the figure of
the first month in a range is there too. A rule on the date inside an or-group cannot be moved and is refused. Everything
here is pure: the runner runs the queries and hands the rows in.
"""
import calendar
from datetime import date, timedelta

KINDS = ("previous_period", "previous_year", "change_previous_period", "change_previous_year", "running_total", "percent_of_total")
TIMED = ("previous_period", "previous_year", "change_previous_period", "change_previous_year", "running_total")
ADDITIVE_KINDS = ("running_total", "percent_of_total")
ADDITIVE = ("sum", "count")
PERCENT = ("change_previous_period", "change_previous_year", "percent_of_total")
MAX_PER_MEASURE = 4
UNIT_WORDS = {"day": "Day", "week": "Week", "month": "Month", "quarter": "Quarter", "year": "Year"}
GROUP = {"previous_period": "period", "change_previous_period": "period", "previous_year": "year", "change_previous_year": "year"}


class CompareError(ValueError):
    """A comparison that cannot be worked out for this definition; the message is for the person."""


def axis(dataset: dict, columns: list[dict]) -> tuple[int, str, str] | None:
    """the time axis: (its index among the columns, its field key, its bucket), or None"""
    for i, column in enumerate(columns):
        if "aggregate" in column:
            continue
        field = next((f for f in dataset["fields"] if f["key"] == column["field"]), None)
        if field is None:
            continue
        if field["type"] == "date":
            return i, field["key"], column.get("bucket") or "day"
        if field["type"] == "datetime" and column.get("bucket"):
            return i, field["key"], column["bucket"]
    return None


def kinds_of(definition: dict) -> list[str]:
    return [kind for column in definition["columns"] for kind in column.get("compare", [])]


def label(base: str, kind: str, unit: str | None) -> str:
    words = UNIT_WORDS.get(unit or "", "Period")
    return {"previous_period": f"{base}, Previous {words}", "previous_year": f"{base}, Last Year", "change_previous_period": f"{base}, Change vs Previous {words}",
            "change_previous_year": f"{base}, Change vs Last Year", "running_total": f"{base}, Running Total", "percent_of_total": f"{base}, % of Total"}[kind]


def columns(dataset: dict, definition: dict, base: list[dict]) -> list[dict]:
    """the result's columns: each measure followed by its comparisons"""
    found = axis(dataset, definition["columns"])
    unit = found[2] if found else None
    out = []
    for spec, column in zip(definition["columns"], base):
        out.append(column)
        for kind in spec.get("compare", []):
            out.append({"key": f"{column['key']}__{kind}", "label": label(column["label"], kind, unit), "type": "number",
                        "format": "percent" if kind in PERCENT else column["format"], "aggregate": column["aggregate"], "compare": kind})
    return out


# ---------------------------------------------------------------------------------------------------- dates
def add_months(day: date, months: int) -> date:
    """a month later or earlier; the last day of a month stays the last day, a day past the end is clamped"""
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    last = calendar.monthrange(year, month + 1)[1]
    was_last = day.day == calendar.monthrange(day.year, day.month)[1]
    return date(year, month + 1, last if was_last else min(day.day, last))


def offset(group: str, unit: str) -> tuple[int, int]:
    """(months, days) between a bucket and the one it is compared with"""
    if group == "period":
        return {"day": (0, 1), "week": (0, 7), "month": (1, 0), "quarter": (3, 0), "year": (12, 0)}[unit]
    return (0, 364) if unit == "week" else (12, 0)


def move(day: date, months: int, days: int, sign: int) -> date:
    return add_months(day, sign * months) + timedelta(days=sign * days)


def _move_text(value, months: int, days: int, sign: int):
    text = str(value)
    return move(date.fromisoformat(text[:10]), months, days, sign).isoformat() + text[10:]


def shifted(definition: dict, field: str, months: int, days: int, today: date) -> dict | None:
    """The definition with its rules on the time axis moved back by the offset; None when it has none (the rows serve as they are)."""
    filters = definition.get("filters") or {"combinator": "and", "rules": []}

    def touches(node) -> bool:
        return any(touches(rule) if "rules" in rule else rule.get("field") == field for rule in node.get("rules", []))

    if not touches(filters):
        return None
    if filters.get("combinator") != "and" or any("rules" in rule and touches(rule) for rule in filters["rules"]):
        raise CompareError("A comparison with an earlier period needs the date's filters joined with and, not inside an or-group.")
    rules = []
    for rule in filters["rules"]:
        if "rules" in rule or rule.get("field") != field:
            rules.append(rule)
            continue
        op, value = rule["operator"], rule.get("value")
        if op in ("is_null", "is_not_null", "in"):
            rules.append(rule)
        elif op == "last_days":
            rules.append({"field": field, "operator": "between", "value": [move(today - timedelta(days=int(value)), months, days, -1).isoformat(), move(today, months, days, -1).isoformat()]})
        elif op == "between":
            rules.append({**rule, "value": [_move_text(value[0], months, days, -1), _move_text(value[1], months, days, -1)]})
        else:
            rules.append({**rule, "value": _move_text(value, months, days, -1)})
    return {**definition, "filters": {"combinator": "and", "rules": rules}}


# ---------------------------------------------------------------------------------------------------- the figures
def _num(value):
    return None if value is None or isinstance(value, bool) else float(value)


def apply(dataset: dict, definition: dict, rows: list[list], earlier: dict[str, list[list]], grand: dict[int, float] | None) -> list[list]:
    """The rows with each measure's comparisons after it. `earlier`: the rows of the shifted run per group ("period", "year");
    `grand`: the report's total per measure index, for the share of total."""
    specs = definition["columns"]
    found = axis(dataset, specs)
    dims = [i for i, c in enumerate(specs) if "aggregate" not in c]
    others = [i for i in dims if not found or i != found[0]]
    lookups = {}
    if found:
        at, _, unit = found
        for group, source in earlier.items():
            months, days = offset(group, unit)
            table = {}
            for row in source:
                if row[at] is None:
                    continue
                table[(tuple(str(row[i]) for i in others), move(date.fromisoformat(str(row[at])[:10]), months, days, 1).isoformat())] = row
            lookups[group] = table
    running = {}
    if found and any("running_total" in c.get("compare", []) for c in specs):
        at = found[0]
        for m, spec in enumerate(specs):
            if "running_total" not in spec.get("compare", []):
                continue
            order = sorted(range(len(rows)), key=lambda r: (tuple(str(rows[r][i]) for i in others), str(rows[r][at])))
            totals, out = {}, {}
            for r in order:
                part = tuple(str(rows[r][i]) for i in others)
                totals[part] = totals.get(part, 0.0) + (_num(rows[r][m]) or 0.0)
                out[r] = totals[part]
            running[m] = out
    result = []
    for r, row in enumerate(rows):
        line = []
        key_others = tuple(str(row[i]) for i in others)
        bucket = str(row[found[0]])[:10] if found and row[found[0]] is not None else None
        for m, spec in enumerate(specs):
            line.append(row[m])
            for kind in spec.get("compare", []):
                current = _num(row[m])
                if kind in GROUP:
                    match = lookups.get(GROUP[kind], {}).get((key_others, bucket)) if bucket else None
                    before = _num(match[m]) if match else None
                    if kind.startswith("change_"):
                        line.append(None if current is None or not before else (current - before) / abs(before) * 100)
                    else:
                        line.append(before)
                elif kind == "running_total":
                    line.append(running.get(m, {}).get(r))
                else:                                                     # percent_of_total
                    total = (grand or {}).get(m)
                    line.append(None if current is None or not total else current / total * 100)
        result.append(line)
    return result


def expand_totals(definition: dict, totals: list[dict] | None) -> list[dict] | None:
    """The engine's totals with an empty value for each comparison, so they line up with the result's measure columns."""
    if totals is None:
        return None
    measures = [c for c in definition["columns"] if "aggregate" in c]
    out = []
    for entry in totals:
        values = []
        for spec, value in zip(measures, entry["values"]):
            values.append(value)
            values.extend([None] * len(spec.get("compare", [])))
        out.append({**entry, "values": values})
    return out
