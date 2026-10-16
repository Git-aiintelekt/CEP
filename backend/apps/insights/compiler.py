"""The query compiler: one validated definition -> parameterised SQL in the engine's dialect, PostgreSQL, ClickHouse or MySQL.
Every identifier is the catalogue's, never the request's; every value is a bound parameter; the workspace restriction is
always present, and on PostgreSQL the row-level security of the tables beneath the view applies on top of it.

    compile(dataset, definition, tenant_id, zone, *, limit, offset, dialect) -> Compiled(sql, params, columns)
    columns: [{key, label, type, format, aggregate?, bucket?}] in the result's order
    totals_sets(definition, view) -> the grouping sets a hierarchy or a pivot needs, or None
    compile_totals(dataset, definition, tenant_id, zone, sets, *, limit, dialect) -> the same rows totalled per set, GROUPING SETS

PostgreSQL binds values as positional %s placeholders (params: a list). ClickHouse binds them as typed {pN:Type}
placeholders sent over HTTP as param_pN (params: a dict), writes the time-zone and bucket expressions its own way,
has no ESCAPE clause on ILIKE (a backslash escapes), uses IN for a list and reads the replacing tables FINAL. MySQL (a
workspace's own database, apps/insights/external.py) binds positional %s like PostgreSQL, quotes identifiers with backticks,
has no workspace restriction (the database is the workspace's), writes its buckets with DATE arithmetic in the session's
zone, uses LIKE (case-insensitive by collation), IN with one placeholder per value, "IS NULL" ordering instead of NULLS LAST,
and totals by one query per grouping set joined with UNION ALL instead of GROUPING SETS.
"""
AGGREGATES = {"sum": "sum({col})", "count": "count({col})", "count_distinct": "count(DISTINCT {col})", "avg": "avg({col})", "min": "min({col})", "max": "max({col})"}
BUCKET_UNIT = {"day": "day", "week": "week", "month": "month", "quarter": "quarter", "year": "year"}
DIALECTS = ("postgresql", "clickhouse", "mysql")
POSITIONAL = ("postgresql", "mysql")


def _ident(name: str, dialect: str = "postgresql") -> str:
    assert name.replace("_", "").isalnum(), name
    return f"`{name}`" if dialect == "mysql" else f'"{name}"'


def _source(name: str, dialect: str = "postgresql") -> str:
    parts = name.split(".")
    assert all(part.replace("_", "").isalnum() for part in parts), name
    return ".".join(f"`{part}`" if dialect == "mysql" else f'"{part}"' for part in parts)


class Compiled:
    def __init__(self, sql: str, params, columns: list[dict]):
        self.sql, self.params, self.columns = sql, params, columns


class Params:
    """The bound values in the dialect's shape: PostgreSQL a list in placeholder order, ClickHouse a dict of typed names."""

    def __init__(self, dialect: str):
        self.dialect = dialect
        self.values: list = []
        self.named: dict = {}

    def bind(self, value, type_: str = "String") -> str:
        """adds a value, returns its placeholder"""
        if self.dialect in POSITIONAL:
            self.values.append(value)
            return "%s"
        name = f"p{len(self.named)}"
        self.named[name] = value
        return f"{{{name}:{type_}}}"

    def out(self):
        return self.values if self.dialect in POSITIONAL else self.named


def _ch_type(value) -> str:
    if isinstance(value, bool):
        return "UInt8"
    if isinstance(value, int):
        return "Int64"
    if isinstance(value, float):
        return "Float64"
    if isinstance(value, (list, tuple)):
        return "Array(String)" if not value or isinstance(value[0], str) else "Array(Float64)"
    return "String"


def _dimension_expr(field: dict, bucket: str | None, zone: str, params: Params) -> str:
    """A dimension as selected: a bucketed date is the start of its day, week, month, quarter or year, in the workspace's zone."""
    col = _ident(field["column"], params.dialect)
    if not bucket:
        return col
    unit = BUCKET_UNIT[bucket]
    if params.dialect == "mysql":
        return {"day": f"DATE({col})", "week": f"DATE(DATE_SUB({col}, INTERVAL WEEKDAY({col}) DAY))", "month": f"DATE_SUB(DATE({col}), INTERVAL (DAYOFMONTH({col}) - 1) DAY)",
                "quarter": f"DATE_ADD(MAKEDATE(YEAR({col}), 1), INTERVAL (QUARTER({col}) - 1) QUARTER)", "year": f"MAKEDATE(YEAR({col}), 1)"}[unit]
    if params.dialect == "clickhouse":
        if field["type"] == "datetime":
            return f"toDate(date_trunc('{unit}', toTimeZone({col}, {params.bind(zone)})))"
        return f"toDate(date_trunc('{unit}', {col}))"
    if field["type"] == "datetime":
        return f"date_trunc({params.bind(unit)}, {col} AT TIME ZONE {params.bind(zone)})::date"
    return f"date_trunc({params.bind(unit)}, {col})::date"


def _day_span(col: str, local_col: bool, start: str, end: str, zone: str, params: Params) -> str:
    """col within the local days start..end: PostgreSQL compares the column in local time with naive timestamps; ClickHouse
    compares the instant with the local day's bounds parsed in the zone."""
    if params.dialect == "mysql":                                    # the session runs in the workspace's zone (external.connect)
        return f"{col} >= {params.bind(start)} AND {col} < DATE_ADD({params.bind(end)}, INTERVAL 1 DAY)"
    if params.dialect == "clickhouse":
        if local_col:
            return f"{col} >= toDateTime({params.bind(start)}, {params.bind(zone)}) AND {col} < toDateTime({params.bind(end)}, {params.bind(zone)}) + INTERVAL 1 DAY"
        return f"{col} >= toDate({params.bind(start)}) AND {col} < toDate({params.bind(end)}) + INTERVAL 1 DAY"
    expr = f"({col} AT TIME ZONE {params.bind(zone)})" if local_col else col
    first = f"{expr} >= {params.bind(start)}::timestamp"
    expr2 = f"({col} AT TIME ZONE {params.bind(zone)})" if local_col else col
    return f"{first} AND {expr2} < ({params.bind(end)}::timestamp + interval '1 day')"


def _filter_sql(dataset: dict, node: dict, zone: str, params: Params) -> str:
    parts = []
    ch = params.dialect == "clickhouse"
    my = params.dialect == "mysql"
    for rule in node["rules"]:
        if "rules" in rule:
            inner = _filter_sql(dataset, rule, zone, params)
            if inner:
                parts.append(f"({inner})")
            continue
        field = next(f for f in dataset["fields"] if f["key"] == rule["field"])
        col = _ident(field["column"], params.dialect)
        op, value = rule["operator"], rule["value"]
        temporal = field["type"] in ("date", "datetime")
        local = temporal and field["type"] == "datetime"
        if op == "is_null":
            parts.append(f"{col} IS NULL")
        elif op == "is_not_null":
            parts.append(f"{col} IS NOT NULL")
        elif op == "last_days":
            parts.append(f"{col} >= now() - toIntervalDay({params.bind(int(value), 'Int64')})" if ch else f"{col} >= NOW() - INTERVAL {params.bind(int(value))} DAY" if my
                         else f"{col} >= now() - make_interval(days => {params.bind(int(value))})")
        elif op == "in":
            values = list(value)
            parts.append(f"{col} IN {params.bind(values, _ch_type(values))}" if ch else f"{col} IN ({', '.join(params.bind(v) for v in values)})" if my else f"{col} = ANY({params.bind(values)})")
        elif op == "between" and temporal:
            parts.append(_day_span(col, local, str(value[0])[:10], str(value[1])[:10], zone, params))
        elif op == "between":
            parts.append(f"{col} BETWEEN {params.bind(value[0], _ch_type(value[0]))} AND {params.bind(value[1], _ch_type(value[1]))}")
        elif op in ("contains", "starts_with"):
            pattern = f"%{_escape_like(value)}%" if op == "contains" else f"{_escape_like(value)}%"
            parts.append(f"{col} ILIKE {params.bind(pattern)}" if ch else f"{col} LIKE {params.bind(pattern)}" if my else f"{col} ILIKE {params.bind(pattern)} ESCAPE '\\'")
        elif temporal and op in ("=", "!="):
            inside = _day_span(col, local, str(value)[:10], str(value)[:10], zone, params)
            parts.append(inside if op == "=" else f"NOT ({inside})")
        else:
            parts.append(f"{col} {op} {params.bind(value, _ch_type(value))}")
    return f" {node['combinator'].upper()} ".join(parts)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _from(dataset: dict, dialect: str) -> str:
    return f"{_source(dataset['source'])} FINAL" if dialect == "clickhouse" else _source(dataset["source"], dialect)


def _where(dataset: dict, definition: dict, tenant_id: str, zone: str, params: Params) -> str:
    where = [f"{_ident(dataset['workspace_field'])} = {params.bind(str(tenant_id), 'UUID')}"] if dataset.get("workspace_field") else []
    filters = _filter_sql(dataset, definition["filters"], zone, params)
    if filters:
        where.append(f"({filters})")
    return " AND ".join(where) or "1 = 1"


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


def compile_totals(dataset: dict, definition: dict, tenant_id: str, zone: str, sets: list[tuple[str, ...]], *, limit: int, dialect: str = "postgresql") -> Compiled:
    """The dimensions and raw measures once, in a subquery (so every placeholder binds once), totalled by GROUPING SETS
    over the dimension aliases. A result row is the dimensions, the measures, then GROUPING(dims): a bit per dimension,
    1 where that dimension is totalled away, the first dimension the most significant bit."""
    params = Params(dialect)
    dims = [c for c in definition["columns"] if "aggregate" not in c]
    meas = [c for c in definition["columns"] if "aggregate" in c]
    columns = []
    for column in dims:
        field = next(f for f in dataset["fields"] if f["key"] == column["field"])
        columns.append({"key": column["field"], "label": column.get("label") or field["label"], "type": "date" if column.get("bucket") else field["type"], "format": field["format"],
                        **({"bucket": column["bucket"]} if column.get("bucket") else {})})
    for column in meas:
        field = next(f for f in dataset["fields"] if f["key"] == column["field"])
        columns.append({"key": column["field"], "label": column.get("label") or field["label"], "type": field["type"], "format": field["format"], "aggregate": column["aggregate"]})

    def base() -> str:
        """the dimensions and raw measures once, in a subquery; every placeholder binds as the text is built, so it is built per use"""
        inner = []
        for i, column in enumerate(dims):
            field = next(f for f in dataset["fields"] if f["key"] == column["field"])
            inner.append(f"{_dimension_expr(field, column.get('bucket'), zone, params)} AS {_ident(f'd{i}', dialect)}")
        for j, column in enumerate(meas):
            field = next(f for f in dataset["fields"] if f["key"] == column["field"])
            inner.append(f"{_ident(field['column'], dialect)} AS {_ident(f'm{j}', dialect)}")
        return f"(SELECT {', '.join(inner)} FROM {_from(dataset, dialect)} WHERE {_where(dataset, definition, tenant_id, zone, params)}) AS base"

    index = {c["field"]: i for i, c in enumerate(dims)}
    kept = [i for i, c in enumerate(dims) if any(c["field"] in s for s in sets)]   # a dimension in no set is always totalled away: it cannot be selected or marked
    measures = [AGGREGATES[c["aggregate"]].format(col=_ident(f"m{j}", dialect)) + f" AS {_ident(f'v{j}', dialect)}" for j, c in enumerate(meas)]
    if dialect == "mysql":
        pieces = []
        for s in sets:
            bits = sum(1 << (len(kept) - 1 - n) for n, i in enumerate(kept) if dims[i]["field"] not in s)
            selected = [(_ident(f"d{i}", dialect) if dims[i]["field"] in s else f"NULL AS {_ident(f'd{i}', dialect)}") for i in kept]
            group = ", ".join(_ident(f"d{index[f]}", dialect) for f in s)
            pieces.append(f"(SELECT {', '.join([*selected, *measures, f'{bits} AS `g`'])} FROM {base()}" + (f" GROUP BY {group})" if group else ")"))
        sql = " UNION ALL ".join(pieces) + f" LIMIT {params.bind(int(limit))}"
        return Compiled(sql, params.out(), [columns[i] for i in kept] + columns[len(dims):])
    outer = [_ident(f"d{i}") for i in kept] + measures
    outer.append(f"GROUPING({', '.join(_ident(f'd{i}') for i in kept)}) AS {_ident('g')}" if kept else f"0 AS {_ident('g')}")
    groups = ", ".join("(" + ", ".join(_ident(f"d{index[f]}") for f in s) + ")" for s in sets)
    sql = f"SELECT {', '.join(outer)} FROM {base()} GROUP BY GROUPING SETS ({groups}) LIMIT {params.bind(int(limit), 'Int64')}"
    return Compiled(sql, params.out(), [columns[i] for i in kept] + columns[len(dims):])


def compile(dataset: dict, definition: dict, tenant_id: str, zone: str, *, limit: int, offset: int = 0, dialect: str = "postgresql") -> Compiled:
    assert dialect in DIALECTS, dialect
    params = Params(dialect)
    selects, groups, columns = [], [], []
    for index, column in enumerate(definition["columns"]):
        field = next(f for f in dataset["fields"] if f["key"] == column["field"])
        alias = _ident(f"c{index}", dialect)
        if "aggregate" in column:
            expr = AGGREGATES[column["aggregate"]].format(col=_ident(field["column"], dialect))
        else:
            expr = _dimension_expr(field, column.get("bucket"), zone, params)
            if definition["grouped"]:
                groups.append(str(index + 1))                       # by position: the expression's placeholders bind once, in the select
        selects.append(f"{expr} AS {alias}")
        columns.append({"key": column["field"], "label": column.get("label") or field["label"], "type": "date" if column.get("bucket") else field["type"],
                        "format": field["format"], **({"aggregate": column["aggregate"]} if "aggregate" in column else {}),
                        **({"bucket": column["bucket"]} if column.get("bucket") else {})})
    where = _where(dataset, definition, tenant_id, zone, params)
    order = []
    for item in definition["orderBy"]:
        index = next(i for i, c in enumerate(definition["columns"]) if c["field"] == item["field"])
        alias = _ident(f"c{index}", dialect)
        order.append(f"{alias} IS NULL, {alias} {item['direction'].upper()}" if dialect == "mysql" else f"{alias} {item['direction'].upper()} NULLS LAST")
    if not order:
        order.append("`c0` IS NULL, `c0` ASC" if dialect == "mysql" else '"c0" ASC NULLS LAST')
    sql = f"SELECT {', '.join(selects)} FROM {_from(dataset, dialect)} WHERE {where}"
    if groups:
        sql += f" GROUP BY {', '.join(groups)}"
    sql += f" ORDER BY {', '.join(order)} LIMIT {params.bind(int(limit), 'Int64')} OFFSET {params.bind(int(offset), 'Int64')}"
    return Compiled(sql, params.out(), columns)
