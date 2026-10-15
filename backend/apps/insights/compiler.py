"""The query compiler: one validated definition -> parameterised SQL in the engine's dialect. PostgreSQL today; the
ClickHouse dialect comes with the engine switch (Phase E). Every identifier is the catalogue's, never the request's;
every value is a bound parameter; the workspace restriction is always present, and the row-level security of the
tables beneath the view applies on top of it.

    compile(dataset, definition, zone, *, limit, offset) -> (sql, params, columns)
    columns: [{key, label, type, format, aggregate?, bucket?}] in the result's order
    totals_sets(definition, view) -> the grouping sets a hierarchy or a pivot needs, or None
    compile_totals(dataset, definition, tenant_id, zone, sets, *, limit) -> the same rows totalled per set, GROUPING SETS
"""
AGGREGATES = {"sum": "sum({col})", "count": "count({col})", "count_distinct": "count(DISTINCT {col})", "avg": "avg({col})", "min": "min({col})", "max": "max({col})"}
BUCKET_UNIT = {"day": "day", "week": "week", "month": "month", "quarter": "quarter", "year": "year"}


def _ident(name: str) -> str:
    assert name.replace("_", "").isalnum(), name
    return f'"{name}"'


def _source(name: str) -> str:
    parts = name.split(".")
    assert all(part.replace("_", "").isalnum() for part in parts), name
    return ".".join(f'"{part}"' for part in parts)


class Compiled:
    def __init__(self, sql: str, params: list, columns: list[dict]):
        self.sql, self.params, self.columns = sql, params, columns


def _dimension_expr(field: dict, bucket: str | None, zone: str, params: list) -> str:
    """A dimension as selected: a bucketed date is the start of its day, week, month, quarter or year, in the workspace's zone."""
    col = _ident(field["column"])
    if not bucket:
        return col
    if field["type"] == "datetime":
        params.extend([BUCKET_UNIT[bucket], zone])                      # placeholders bind left to right: the unit, then the zone
        return f"date_trunc(%s, {col} AT TIME ZONE %s)::date"
    params.append(BUCKET_UNIT[bucket])
    return f"date_trunc(%s, {col})::date"


def _filter_sql(dataset: dict, node: dict, zone: str, params: list) -> str:
    parts = []
    for rule in node["rules"]:
        if "rules" in rule:
            inner = _filter_sql(dataset, rule, zone, params)
            if inner:
                parts.append(f"({inner})")
            continue
        field = next(f for f in dataset["fields"] if f["key"] == rule["field"])
        col = _ident(field["column"])
        op, value = rule["operator"], rule["value"]
        temporal = field["type"] in ("date", "datetime")
        if temporal and field["type"] == "datetime" and op not in ("is_null", "is_not_null", "last_days"):
            # a day given for a timestamp means that day in the workspace's zone; the zone binds once per use of the column
            col = f"({col} AT TIME ZONE %s)"
            params.append(zone)
        if op == "is_null":
            parts.append(f"{col} IS NULL")
        elif op == "is_not_null":
            parts.append(f"{col} IS NOT NULL")
        elif op == "last_days":
            params.append(int(value))
            parts.append(f"{col} >= now() - make_interval(days => %s)")
        elif op == "in":
            params.append(list(value))
            parts.append(f"{col} = ANY(%s)")
        elif op == "between":
            if temporal:
                params.extend([value[0], *([zone] if "AT TIME ZONE" in col else []), value[1]])
                parts.append(f"{col} >= %s::timestamp AND {col} < (%s::timestamp + interval '1 day')")
            else:
                params.extend([value[0], value[1]])
                parts.append(f"{col} BETWEEN %s AND %s")
        elif op == "contains":
            params.append(f"%{_escape_like(value)}%")
            parts.append(f"{col} ILIKE %s ESCAPE '\\'")
        elif op == "starts_with":
            params.append(f"{_escape_like(value)}%")
            parts.append(f"{col} ILIKE %s ESCAPE '\\'")
        elif temporal and op in ("=", "!="):
            params.extend([value[:10], *([zone] if "AT TIME ZONE" in col else []), value[:10]])
            inside = f"{col} >= %s::timestamp AND {col} < (%s::timestamp + interval '1 day')"
            parts.append(inside if op == "=" else f"NOT ({inside})")
        else:
            params.append(value)
            parts.append(f"{col} {op} %s")
    return f" {node['combinator'].upper()} ".join(parts)


def totals_sets(definition: dict, view: dict | None) -> list[tuple[str, ...]] | None:
    """What the engine totals for a view: a hierarchy needs every prefix of its dimensions and the grand total; a pivot
    needs its rows' total, its columns' total and the grand total. None when the view has nothing to total."""
    dims = [c["field"] for c in definition["columns"] if "aggregate" not in c]
    if not view or not dims or not any("aggregate" in c for c in definition["columns"]):
        return None
    if view.get("type") == "hierarchy" and len(dims) >= 2:
        return [tuple(dims[:n]) for n in range(len(dims))]
    if view.get("type") == "pivot" and view.get("across") in dims and len(dims) >= 2:
        across = view["across"]
        return [(), tuple(d for d in dims if d != across), (across,)]
    return None


def compile_totals(dataset: dict, definition: dict, tenant_id: str, zone: str, sets: list[tuple[str, ...]], *, limit: int) -> Compiled:
    """The dimensions and raw measures once, in a subquery (so every placeholder binds once), totalled by GROUPING SETS
    over the dimension aliases. A result row is the dimensions, the measures, then GROUPING(dims): a bit per dimension,
    1 where that dimension is totalled away, the first dimension the most significant bit."""
    params: list = []
    dims = [c for c in definition["columns"] if "aggregate" not in c]
    meas = [c for c in definition["columns"] if "aggregate" in c]
    inner, columns = [], []
    for i, column in enumerate(dims):
        field = next(f for f in dataset["fields"] if f["key"] == column["field"])
        inner.append(f"{_dimension_expr(field, column.get('bucket'), zone, params)} AS {_ident(f'd{i}')}")
        columns.append({"key": column["field"], "label": column.get("label") or field["label"], "type": "date" if column.get("bucket") else field["type"], "format": field["format"],
                        **({"bucket": column["bucket"]} if column.get("bucket") else {})})
    for j, column in enumerate(meas):
        field = next(f for f in dataset["fields"] if f["key"] == column["field"])
        inner.append(f"{_ident(field['column'])} AS {_ident(f'm{j}')}")
        columns.append({"key": column["field"], "label": column.get("label") or field["label"], "type": field["type"], "format": field["format"], "aggregate": column["aggregate"]})
    where = [f"{_ident(dataset['workspace_field'])} = %s"]
    params.append(str(tenant_id))
    filters = _filter_sql(dataset, definition["filters"], zone, params)
    if filters:
        where.append(f"({filters})")
    index = {c["field"]: i for i, c in enumerate(dims)}
    kept = [i for i, c in enumerate(dims) if any(c["field"] in s for s in sets)]   # a dimension in no set is always totalled away: it cannot be selected or marked
    outer = [_ident(f"d{i}") for i in kept] + [AGGREGATES[c["aggregate"]].format(col=_ident(f"m{j}")) + f" AS {_ident(f'v{j}')}" for j, c in enumerate(meas)]
    outer.append(f"GROUPING({', '.join(_ident(f'd{i}') for i in kept)}) AS {_ident('g')}" if kept else f"0 AS {_ident('g')}")
    groups = ", ".join("(" + ", ".join(_ident(f"d{index[f]}") for f in s) + ")" for s in sets)
    sql = (f"SELECT {', '.join(outer)} FROM (SELECT {', '.join(inner)} FROM {_source(dataset['source'])} WHERE {' AND '.join(where)}) AS base "
           f"GROUP BY GROUPING SETS ({groups}) LIMIT %s")
    params.append(int(limit))
    return Compiled(sql, params, [columns[i] for i in kept] + columns[len(dims):])


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def compile(dataset: dict, definition: dict, tenant_id: str, zone: str, *, limit: int, offset: int = 0) -> Compiled:
    params: list = []
    selects, groups, columns = [], [], []
    for index, column in enumerate(definition["columns"]):
        field = next(f for f in dataset["fields"] if f["key"] == column["field"])
        alias = _ident(f"c{index}")
        if "aggregate" in column:
            expr = AGGREGATES[column["aggregate"]].format(col=_ident(field["column"]))
        else:
            expr = _dimension_expr(field, column.get("bucket"), zone, params)
            if definition["grouped"]:
                groups.append(str(index + 1))                       # by position: the expression's placeholders bind once, in the select
        selects.append(f"{expr} AS {alias}")
        columns.append({"key": column["field"], "label": column.get("label") or field["label"], "type": "date" if column.get("bucket") else field["type"],
                        "format": field["format"], **({"aggregate": column["aggregate"]} if "aggregate" in column else {}),
                        **({"bucket": column["bucket"]} if column.get("bucket") else {})})
    where = [f"{_ident(dataset['workspace_field'])} = %s"]
    params.append(str(tenant_id))
    filters = _filter_sql(dataset, definition["filters"], zone, params)
    if filters:
        where.append(f"({filters})")
    order = []
    for item in definition["orderBy"]:
        index = next(i for i, c in enumerate(definition["columns"]) if c["field"] == item["field"])
        order.append(f"{_ident(f'c{index}')} {item['direction'].upper()} NULLS LAST")
    if not order:
        order.append('"c0" ASC NULLS LAST')
    sql = f"SELECT {', '.join(selects)} FROM {_source(dataset['source'])} WHERE {' AND '.join(where)}"
    if groups:
        sql += f" GROUP BY {', '.join(groups)}"
    sql += f" ORDER BY {', '.join(order)} LIMIT %s OFFSET %s"
    params.extend([int(limit), int(offset)])
    return Compiled(sql, params, columns)
