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

A calculated measure (a catalogue field with a `formula` and the one aggregate `calc`) is a ratio, difference, sum or product
of two sides, each another measure with one of its aggregates or a number, optionally scaled: Delivered Rate is
sum(delivered) / NULLIF(sum(sent), 0) * 100. It compiles in the select and in the totals, so every view gets it exact.

A measure formula that works over the report's grouped rows (CALCULATE with ALL, RANKX, TOTALYTD and the other time functions,
apps/insights/formula.py) compiles to three levels (_compile_analytic): the grouped query, each aggregate its own column (and
again, shifted in time, joined beside it); a window level (share of the parent, year or quarter to date); a last level that
ranks and keeps the asked-for range when the date's filter was widened for the earlier rows. Totals leave such measures empty.

A query dataset's date field that is the day of one of its datetime fields (DATE(m.SENT_AT) AS sent_date beside m.SENT_AT AS
sent_at) is filtered on the datetime instead (day_fields): the same days, but a condition an index on the column can use.
"""
import re
from datetime import date, timedelta

AGGREGATES = {"sum": "sum({col})", "count": "count({col})", "count_distinct": "count(DISTINCT {col})", "avg": "avg({col})", "min": "min({col})", "max": "max({col})"}
CALC = "calc"
FORMULA_OPS = {"ratio": "/", "difference": "-", "sum": "+", "product": "*"}
BUCKET_UNIT = {"day": "day", "week": "week", "month": "month", "quarter": "quarter", "year": "year"}
DIALECTS = ("postgresql", "clickhouse", "mysql")
POSITIONAL = ("postgresql", "mysql")


def _ident(name: str, dialect: str = "postgresql") -> str:
    assert name.replace("_", "").isalnum(), name
    return f"`{name}`" if dialect == "mysql" else f'"{name}"'


def _source(name: str, dialect: str = "postgresql") -> str:
    """schema.table (or a table alone), quoted; a schema or database name may hold hyphens (txpostalprod-server-7), a table not"""
    parts = name.split(".")
    assert parts[-1].replace("_", "").isalnum() and all(part.replace("_", "").replace("-", "").isalnum() for part in parts[:-1]), name
    return ".".join(f"`{part}`" if dialect == "mysql" else f'"{part}"' for part in parts)


def _col(field: dict, dialect: str) -> str:
    """a field's column, qualified by its table's alias when the dataset joins tables; a custom field's CASE over its sources"""
    if field.get("derived"):
        from . import derived
        return derived.case_sql(field, dialect, lambda source: _col(source, dialect))
    if field.get("operand"):                                           # one aggregate's value in a measure formula
        from . import formula
        return formula.operand_sql(field["operand"], dialect, lambda key: _col(field["fields"][key], dialect))
    column = _ident(field["column"], dialect)
    return f"{_ident(field['table'], dialect)}.{column}" if field.get("table") else column


def _field_of(dataset: dict, key: str) -> dict:
    return next(f for f in dataset["fields"] if f["key"] == key)


def operands(dataset: dict, field: dict, aggregate: str) -> list[tuple[dict, str]]:
    """The (field, aggregate) pairs a measure column reads: the field itself, or every column operand of a calculated
    measure's formula, through nested calculated measures; each field once. A measure formula reads one value per aggregate
    in it (its value, or empty where the aggregate's condition does not hold)."""
    if aggregate != CALC:
        return [(field, aggregate)]
    if field.get("expression"):
        return [(operand, operand["operand"]["fn"]) for operand in field["expression"]["operands"]]
    out, seen = [], set()
    for side in (field["formula"]["left"], field["formula"]["right"]):
        if "field" not in side:
            continue
        for pair in operands(dataset, _field_of(dataset, side["field"]), side["aggregate"]):
            if pair[0]["key"] not in seen:
                seen.add(pair[0]["key"])
                out.append(pair)
    return out


def measure_expr(dataset: dict, field: dict, aggregate: str, raw, dialect: str) -> str:
    """One measure's SQL: the aggregate over the raw column (`raw(field)` says where that column is), or a calculated
    measure's formula over its operands' aggregates. A ratio divides by NULLIF(.., 0): an empty denominator reads as
    empty, never as an error; `* 1.0` keeps integer sums from dividing as integers."""
    if aggregate != CALC:
        return AGGREGATES[aggregate].format(col=raw(field))
    if field.get("expression"):
        from . import formula as language
        found = field["expression"]["operands"]
        return language.render(field["expression"]["checked"].ast, dialect, column=None,
                               agg=lambda call: language.aggregate_sql(call, raw(found[call["n"]])))
    formula = field["formula"]

    def side(part) -> str:
        if "field" not in part:
            return repr(float(part["value"]))
        return measure_expr(dataset, _field_of(dataset, part["field"]), part["aggregate"], raw, dialect)

    left, right = side(formula["left"]), side(formula["right"])
    if formula["op"] == "ratio":
        expr = f"({left}) * 1.0 / {'nullIf' if dialect == 'clickhouse' else 'NULLIF'}(({right}), 0)"
    else:
        expr = f"({left}) {FORMULA_OPS[formula['op']]} ({right})"
    scale = formula.get("scale")
    return f"({expr}) * {float(scale)!r}" if scale not in (None, 1) else expr


def join_clause(source: str, joins: list[dict], dialect: str) -> str:
    """The FROM of a dataset that joins tables: the base as t0, each join as its alias, ON the key pairs. Every name is checked as
    an identifier; the join type is left or inner and nothing else."""
    out = f"{_source(source, dialect)} AS {_ident('t0', dialect)}"
    for join in joins:
        kind = {"left": "LEFT JOIN", "inner": "INNER JOIN"}[join["type"]]
        on = " AND ".join(f"{_ident(join['to'], dialect)}.{_ident(a, dialect)} = {_ident(join['alias'], dialect)}.{_ident(b, dialect)}" for a, b in join["on"])
        out += f" {kind} {_source(join['table'], dialect)} AS {_ident(join['alias'], dialect)} ON {on}"
    return out


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


def _dimension_expr(field: dict, bucket: str | None, zone: str, params: Params, fiscal: int = 1) -> str:
    """A dimension as selected: a bucketed date is the start of its day, week, month, quarter or year, in the workspace's zone; a
    fiscal quarter or year starts `fiscal - 1` months later than the calendar's (the date moved back, truncated, moved on)."""
    col = _col(field, params.dialect)
    if not bucket:
        return col
    if bucket in ("fiscal_quarter", "fiscal_year"):
        unit, shift = ("quarter" if bucket == "fiscal_quarter" else "year"), int(fiscal) - 1
        if params.dialect == "mysql":
            moved = f"DATE_SUB(DATE({col}), INTERVAL {shift} MONTH)"
            start = f"MAKEDATE(YEAR({moved}), 1)" if unit == "year" else f"DATE_ADD(MAKEDATE(YEAR({moved}), 1), INTERVAL (QUARTER({moved}) - 1) QUARTER)"
            return f"DATE_ADD({start}, INTERVAL {shift} MONTH)"
        if params.dialect == "clickhouse":
            local = f"toTimeZone({col}, {params.bind(zone)})" if field["type"] == "datetime" else col
            return f"toDate(addMonths(date_trunc('{unit}', addMonths({local}, -{shift})), {shift}))"
        truncated_to = params.bind(unit)                                    # bound in the order the placeholders are written
        local = f"({col} AT TIME ZONE {params.bind(zone)})" if field["type"] == "datetime" else col
        back = params.bind(shift)
        return f"(date_trunc({truncated_to}, {local} - make_interval(months => {back})) + make_interval(months => {params.bind(shift)}))::date"
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


_DAY_OF = re.compile(r"\bDATE\(\s*([^()]+?)\s*\)\s+AS\s+[`\"]?(\w+)", re.IGNORECASE)
DAY_OPERATORS = ("last_days", "between", "=", ">=", "<=", ">", "<")


def day_fields(dataset: dict) -> dict[str, str]:
    """a query dataset's date fields that are the day of one of its datetime fields: {sent_date: sent_at}"""
    sql = dataset.get("query") or ""
    if not sql:
        return {}
    types = {f["key"]: f["type"] for f in dataset["fields"]}
    out = {}
    for expr, alias in _DAY_OF.findall(sql):
        bare = re.search(rf"(?<![\w.(]){re.escape(expr)}\s+AS\s+[`\"]?(\w+)", sql, re.IGNORECASE)
        if bare and types.get(alias) == "date" and types.get(bare.group(1)) == "datetime":
            out[alias] = bare.group(1)
    return out


def _on_datetime(rule: dict, time_field: str) -> dict:
    """a rule on the day moved onto its datetime, for the same days: before or on a day is before the next one"""
    op, value = rule["operator"], rule["value"]
    if op in ("<=", ">"):
        following = (date.fromisoformat(str(value)[:10]) + timedelta(days=1)).isoformat()
        return {"field": time_field, "operator": "<" if op == "<=" else ">=", "value": following}
    return {**rule, "field": time_field, "value": str(value)[:10] if op in (">=", "<") else value}


def _filter_sql(dataset: dict, node: dict, zone: str, params: Params) -> str:
    parts = []
    ch = params.dialect == "clickhouse"
    my = params.dialect == "mysql"
    days = day_fields(dataset)
    for rule in node["rules"]:
        if "rules" in rule:
            inner = _filter_sql(dataset, rule, zone, params)
            if inner:
                parts.append(f"({inner})")
            continue
        if rule["field"] in days and rule["operator"] in DAY_OPERATORS:
            rule = _on_datetime(rule, days[rule["field"]])
        field = next(f for f in dataset["fields"] if f["key"] == rule["field"])
        col = _col(field, params.dialect)
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
    if dataset.get("query"):                                     # a dataset from a query: the checked SELECT as a subquery, its % kept out of the parameter marks
        text = dataset["query"].replace("%", "%%") if dialect in POSITIONAL else dataset["query"]
        return f"({text}) AS {_ident('t0', dialect)}"
    if dataset.get("joins"):
        return join_clause(dataset["source"], dataset["joins"], dialect)
    if dialect == "clickhouse" and not dataset.get("external"):                 # the engine's own replacing tables; a workspace's database is read as it is
        return f"{_source(dataset['source'])} FINAL"
    return _source(dataset["source"], dialect)


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
    if view.get("type") == "chart" and view.get("chart") in ("kpi", "gauge"):      # one figure: the whole period's total, worked out by the engine
        return [()]
    if view.get("type") == "pivot" and view.get("across") in dims and len(dims) >= 2:
        across = view["across"]
        return [(), tuple(d for d in dims if d != across), (across,)]
    return None


def compile_totals(dataset: dict, definition: dict, tenant_id: str, zone: str, sets: list[tuple[str, ...]], *, limit: int, dialect: str = "postgresql") -> Compiled:
    """The dimensions and raw measures once, in a subquery (so every placeholder binds once), totalled by GROUPING SETS
    over the dimension aliases. A result row is the dimensions, the measures, then GROUPING(dims): a bit per dimension,
    1 where that dimension is totalled away, the first dimension the most significant bit."""
    from . import derived, formula
    formula.ZONE.set(zone)
    dataset = derived.augment(dataset, definition)
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
            inner.append(f"{_dimension_expr(field, column.get('bucket'), zone, params, definition.get('_fiscal', 1))} AS {_ident(f'd{i}', dialect)}")
        for j, column in enumerate(meas):
            field = next(f for f in dataset["fields"] if f["key"] == column["field"])
            if _analytic_field(field):                                     # worked out over the report's rows: no total
                continue
            for k, (operand, _aggregate) in enumerate(operands(dataset, field, column["aggregate"])):
                inner.append(f"{_col(operand, dialect)} AS {_ident(_raw_alias(j, k, column), dialect)}")
        return f"(SELECT {', '.join(inner)} FROM {_from(dataset, dialect)} WHERE {_where(dataset, definition, tenant_id, zone, params)}) AS base"

    def totalled(j: int, column: dict) -> str:
        """one measure over the raw columns of the subquery: a plain aggregate, or a calculated measure's formula"""
        field = next(f for f in dataset["fields"] if f["key"] == column["field"])
        if _analytic_field(field):
            return f"NULL AS {_ident(f'v{j}', dialect)}"
        at = {operand["key"]: _raw_alias(j, k, column) for k, (operand, _aggregate) in enumerate(operands(dataset, field, column["aggregate"]))}
        return measure_expr(dataset, field, column["aggregate"], lambda f: _ident(at[f["key"]], dialect), dialect) + f" AS {_ident(f'v{j}', dialect)}"

    index = {c["field"]: i for i, c in enumerate(dims)}
    kept = [i for i, c in enumerate(dims) if any(c["field"] in s for s in sets)]   # a dimension in no set is always totalled away: it cannot be selected or marked
    measures = [totalled(j, c) for j, c in enumerate(meas)]
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


def _analytic_field(field: dict) -> bool:
    return bool(field.get("expression")) and field["expression"]["checked"].analytic


def _raw_alias(j: int, k: int, column: dict) -> str:
    """the subquery's alias for a measure's raw column: m0 for a plain measure, m0_0, m0_1.. for a calculated one's operands"""
    return f"m{j}" if column["aggregate"] != CALC else f"m{j}_{k}"


def compile(dataset: dict, definition: dict, tenant_id: str, zone: str, *, limit: int, offset: int = 0, dialect: str = "postgresql") -> Compiled:
    assert dialect in DIALECTS, dialect
    from . import derived, formula
    formula.ZONE.set(zone)                                             # a formula's dates read in the workspace's zone
    dataset = derived.augment(dataset, definition)
    if any("aggregate" in c and _analytic_field(_field_of(dataset, c["field"])) for c in definition["columns"]):
        return _compile_analytic(dataset, definition, tenant_id, zone, limit=limit, offset=offset, dialect=dialect)
    params = Params(dialect)
    selects, groups, columns = [], [], []
    for index, column in enumerate(definition["columns"]):
        field = next(f for f in dataset["fields"] if f["key"] == column["field"])
        alias = _ident(f"c{index}", dialect)
        if "aggregate" in column:
            expr = measure_expr(dataset, field, column["aggregate"], lambda f: _col(f, dialect), dialect)
        else:
            expr = _dimension_expr(field, column.get("bucket"), zone, params, definition.get("_fiscal", 1))
            if definition["grouped"]:
                groups.append(str(index + 1))                       # by position: the expression's placeholders bind once, in the select
        selects.append(f"{expr} AS {alias}")
        columns.append({"key": column["field"], "label": column.get("label") or field["label"], "type": "date" if column.get("bucket") else field["type"],
                        "format": field["format"], **({"aggregate": column["aggregate"]} if "aggregate" in column else {}),
                        **({"bucket": column["bucket"]} if column.get("bucket") else {})})
    where = _where(dataset, definition, tenant_id, zone, params)
    order = []
    for item in definition["orderBy"]:
        index = next((i for i, c in enumerate(definition["columns"]) if c["field"] == item["field"]), None)
        if index is None:                                           # a measure from a linked dataset: sorted once the two sides are matched
            continue
        alias = _ident(f"c{index}", dialect)
        order.append(f"{alias} IS NULL, {alias} {item['direction'].upper()}" if dialect == "mysql" else f"{alias} {item['direction'].upper()} NULLS LAST")
    if not order:
        order.append("`c0` IS NULL, `c0` ASC" if dialect == "mysql" else '"c0" ASC NULLS LAST')
    sql = f"SELECT {', '.join(selects)} FROM {_from(dataset, dialect)} WHERE {where}"
    if groups:
        sql += f" GROUP BY {', '.join(groups)}"
    sql += f" ORDER BY {', '.join(order)} LIMIT {params.bind(int(limit), 'Int64')} OFFSET {params.bind(int(offset), 'Int64')}"
    return Compiled(sql, params.out(), columns)


# ---------------------------------------------------------------------------------------------------- over the grouped rows
def _date_literal(day, dialect: str) -> str:
    return f"toDate('{day.isoformat()}')" if dialect == "clickhouse" else f"DATE '{day.isoformat()}'"


def _lower_bound(definition: dict, field: str, today):
    """the earliest day the definition's own rules on the date allow, or None"""
    from datetime import date, timedelta
    lows = []
    for rule in (definition.get("filters") or {}).get("rules", []):
        if "rules" in rule or rule.get("field") != field:
            continue
        op, value = rule["operator"], rule.get("value")
        try:
            if op == "last_days":
                lows.append(today - timedelta(days=int(value)))
            elif op == "between":
                lows.append(date.fromisoformat(str(value[0])[:10]))
            elif op in (">", ">=", "="):
                lows.append(date.fromisoformat(str(value)[:10]))
        except (TypeError, ValueError):
            continue
    return max(lows) if lows else None


def _bucket_start(day, bucket: str, start: int):
    from datetime import timedelta
    from . import fiscal
    if bucket == "week":
        return day - timedelta(days=day.weekday())
    if bucket == "month":
        return day.replace(day=1)
    if bucket == "quarter":
        return day.replace(month=((day.month - 1) // 3) * 3 + 1, day=1)
    if bucket == "year":
        return day.replace(month=1, day=1)
    if bucket == "fiscal_quarter":
        return fiscal.quarter_start(day, start)
    if bucket == "fiscal_year":
        return fiscal.year_start(day, start)
    return day


def _shift_key(node: dict, bucket: str) -> tuple[int, int]:
    """(months, days) back: a year (52 weeks on a weekly report), one of the report's periods, or the months asked for"""
    from . import compare
    if node.get("year"):
        return (0, 364) if bucket == "week" else (12, 0)
    if node.get("period"):
        return compare.offset("period", bucket)
    return (int(node["months"]), 0)


def _compile_analytic(dataset: dict, definition: dict, tenant_id: str, zone: str, *, limit: int, offset: int, dialect: str) -> Compiled:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from . import compare, formula
    from .formula import _walk
    params = Params(dialect)
    cols = definition["columns"]
    fields = [_field_of(dataset, c["field"]) for c in cols]
    dims = [i for i, c in enumerate(cols) if "aggregate" not in c]
    analytic = {j: fields[j]["expression"]["checked"] for j, c in enumerate(cols) if "aggregate" in c and _analytic_field(fields[j])}
    found = compare.axis(dataset, cols)
    start = int(definition.get("_fiscal", 1))
    timed = any(checked.timed for checked in analytic.values())
    if timed and found is None:
        raise ValueError("The time functions need a date in the report, grouped by day, week, month, quarter or year.")
    ax, bucket = (found[0], found[2]) if found else (None, None)
    q = lambda name: _ident(name, dialect)                              # noqa: E731
    gd = lambda i: f"{q('g')}.{q(f'd{i}')}"                              # noqa: E731

    shifts: dict[tuple[int, int], str] = {}
    windows = set()
    for checked in analytic.values():
        for node in _walk(checked.ast):
            if node["t"] == "shift":
                shifts.setdefault(_shift_key(node, bucket), f"s{len(shifts)}")
            elif node["t"] == "window":
                windows.add(node["kind"])

    wide, trim = definition, None
    if timed:
        today = datetime.now(ZoneInfo(zone)).date()

        def back(day):
            reach = [day]
            if "ytd" in windows:
                reach.append(compare.period_start(day, "year_to_date", start))
            if "qtd" in windows:
                reach.append(compare.period_start(day, "quarter_to_date", start))
            reach += [compare.move(day, months, days, -1) for months, days in shifts]
            return min(reach)
        widened = compare.widened(definition, found[1], back, today)
        if widened is not None:
            wide = widened
            lower = _lower_bound(definition, found[1], today)
            trim = _bucket_start(lower, bucket, start) if lower else None

    def inner(defn: dict) -> str:
        """the grouped rows: the dimensions, every plain measure, and each aggregate of an analytic one on its own"""
        selects = [f"{_dimension_expr(fields[i], cols[i].get('bucket'), zone, params, start)} AS {q(f'd{i}')}" for i in dims]
        for j, column in enumerate(cols):
            if "aggregate" not in column:
                continue
            if j in analytic:
                checked = analytic[j]
                for call in checked.calls:
                    n = call["n"]
                    operand = formula.operand_sql(call, dialect, lambda key, c=checked: _col(c.fields[key], dialect))
                    if call["fn"] == "AVERAGE":
                        selects += [f"sum({operand}) AS {q(f'a{j}_{n}s')}", f"count({operand}) AS {q(f'a{j}_{n}c')}"]
                    else:
                        selects.append(f"{formula.aggregate_sql(call, operand)} AS {q(f'a{j}_{n}')}")
            else:
                selects.append(f"{measure_expr(dataset, fields[j], column['aggregate'], lambda f: _col(f, dialect), dialect)} AS {q(f'v{j}')}")
        sql = f"SELECT {', '.join(selects)} FROM {_from(dataset, dialect)} WHERE {_where(dataset, defn, tenant_id, zone, params)}"
        if dims:
            sql += " GROUP BY " + ", ".join(str(k + 1) for k in range(len(dims)))
        return sql

    def period_of(unit: str) -> str:
        moved = start - 1
        if dialect == "clickhouse":
            return f"toStartOf{'Year' if unit == 'year' else 'Quarter'}(addMonths({gd(ax)}, -{moved}))"
        if dialect == "mysql":
            base = f"DATE_SUB({gd(ax)}, INTERVAL {moved} MONTH)"
            return f"YEAR({base})" if unit == "year" else f"(YEAR({base}) * 10 + QUARTER({base}))"
        return f"date_trunc('{unit}', {gd(ax)} - make_interval(months => {moved}))"

    def spec(window: dict) -> str:
        if window["kind"] == "all":
            keep = [gd(i) for i in dims if fields[i]["key"] not in window["drop"]]
            return f"PARTITION BY {', '.join(keep)}" if keep else ""
        others = [gd(i) for i in dims if i != ax]
        return (f"PARTITION BY {', '.join([*others, period_of('year' if window['kind'] == 'ytd' else 'quarter')])} "
                f"ORDER BY {gd(ax)} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW")

    nullif = "nullIf" if dialect == "clickhouse" else "NULLIF"

    def outer(j: int):
        def agg(call: dict, state: dict) -> str:
            n = call["n"]
            source = shifts[_shift_key(state["shift"], bucket)] if state.get("shift") else "g"
            window = state.get("window")
            name = lambda suffix="": f"{q(source)}.{q(f'a{j}_{n}{suffix}')}"   # noqa: E731
            if call["fn"] == "AVERAGE":
                if window:
                    over = spec(window)
                    return f"(sum({name('s')}) OVER ({over})) * 1.0 / {nullif}(sum({name('c')}) OVER ({over}), 0)"
                return f"({name('s')}) * 1.0 / {nullif}({name('c')}, 0)"
            if window:
                return f"{ {'MIN': 'min', 'MAX': 'max'}.get(call['fn'], 'sum') }({name()}) OVER ({spec(window)})"
            return name()
        return agg

    grouped = inner(wide)
    joins = []
    for (months, days), alias in shifts.items():
        if dialect == "clickhouse":
            moved = f"addMonths({gd(ax)}, -{months})" if months else f"addDays({gd(ax)}, -{days})"
        elif dialect == "mysql":
            moved = f"DATE_SUB({gd(ax)}, INTERVAL {months} MONTH)" if months else f"DATE_SUB({gd(ax)}, INTERVAL {days} DAY)"
        else:
            moved = f"CAST({gd(ax)} - make_interval({'months' if months else 'days'} => {months or days}) AS date)"
        same = [f"{q(alias)}.{q(f'd{ax}')} = {moved}"]
        for i in dims:
            if i == ax:
                continue
            if dialect == "postgresql":
                same.append(f"{q(alias)}.{q(f'd{i}')} IS NOT DISTINCT FROM {gd(i)}")
            elif dialect == "mysql":
                same.append(f"{q(alias)}.{q(f'd{i}')} <=> {gd(i)}")
            else:
                same.append(f"{q(alias)}.{q(f'd{i}')} = {gd(i)}")
        joins.append(f" LEFT JOIN ({inner(wide)}) AS {q(alias)} ON {' AND '.join(same)}")

    middle, last, columns = [], [], []
    for j, column in enumerate(cols):
        field = fields[j]
        if "aggregate" not in column:
            middle.append(f"{gd(j)} AS {q(f'c{j}')}")
            last.append(f"{q('w')}.{q(f'c{j}')} AS {q(f'c{j}')}")
        elif j in analytic and analytic[j].ranked:
            middle.append(f"{formula.render(analytic[j].ast['x'], dialect, None, outer(j), {})} AS {q(f'r{j}')}")
            direction = "ASC" if analytic[j].ast["asc"] else "DESC"
            ranked = f"{q('w')}.{q(f'r{j}')}"
            order = f"{ranked} IS NULL, {ranked} {direction}" if dialect == "mysql" else f"{ranked} {direction} NULLS LAST"
            last.append(f"rank() OVER (ORDER BY {order}) AS {q(f'c{j}')}")
        elif j in analytic:
            middle.append(f"{formula.render(analytic[j].ast, dialect, None, outer(j), {})} AS {q(f'c{j}')}")
            last.append(f"{q('w')}.{q(f'c{j}')} AS {q(f'c{j}')}")
        else:
            middle.append(f"{q('g')}.{q(f'v{j}')} AS {q(f'c{j}')}")
            last.append(f"{q('w')}.{q(f'c{j}')} AS {q(f'c{j}')}")
        columns.append({"key": column["field"], "label": column.get("label") or field["label"], "type": "date" if column.get("bucket") else field["type"],
                        "format": field["format"], **({"aggregate": column["aggregate"]} if "aggregate" in column else {}),
                        **({"bucket": column["bucket"]} if column.get("bucket") else {})})
    if trim is not None:
        middle.append(f"({gd(ax)} >= {_date_literal(trim, dialect)}) AS {q('keep_')}")
    window_sql = f"SELECT {', '.join(middle)} FROM ({grouped}) AS {q('g')}{''.join(joins)}"
    order = []
    for item in definition["orderBy"]:
        index = next((i for i, c in enumerate(cols) if c["field"] == item["field"]), None)
        if index is None:
            continue
        alias = q(f"c{index}")
        order.append(f"{alias} IS NULL, {alias} {item['direction'].upper()}" if dialect == "mysql" else f"{alias} {item['direction'].upper()} NULLS LAST")
    if not order:
        order.append("`c0` IS NULL, `c0` ASC" if dialect == "mysql" else '"c0" ASC NULLS LAST')
    sql = f"SELECT {', '.join(last)} FROM ({window_sql}) AS {q('w')}"
    if trim is not None:
        sql += f" WHERE {q('w')}.{q('keep_')}"
    sql += f" ORDER BY {', '.join(order)} LIMIT {params.bind(int(limit), 'Int64')} OFFSET {params.bind(int(offset), 'Int64')}"
    return Compiled(sql, params.out(), columns)
