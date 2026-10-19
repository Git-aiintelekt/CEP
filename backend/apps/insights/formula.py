"""The formula language: a report's calculated columns (one value per row) and measure formulas (over the rows of a group), kept
in its custom fields (apps/insights/derived.py, kinds `formula` and `measure`) and compiled to the engine's SQL.

    [Revenue] - [Cost]                                   a calculated column: fields by their label (or key) in brackets
    IF([Amount] >= 500, "Gold", "Standard")
    YEAR([Sent]) & "-" & TEXT(MONTH([Sent]))
    DIVIDE(SUM([Delivered]), SUM([Sent])) * 100          a measure formula: aggregates over the group's rows
    SUM([Sent], [Channel] = "EMAIL")                     an aggregate with a condition: only the rows it holds for
    COUNTROWS([Amount] > 0) / COUNTROWS()

Operators: + - * / (a division by zero is empty), & joins text, = <> < <= > >= compare, AND OR NOT. Literals: numbers,
"text" or 'text' (a doubled quote inside), TRUE, FALSE, BLANK. Functions are in FUNCTIONS. In a measure formula every field
sits inside an aggregate, or is a measure that is itself calculated (inlined). Nothing in a formula is ever a table or column
name the person typed: fields resolve to the catalogue's, functions come from the list, literals are escaped.
"""
import contextvars
import re

ZONE = contextvars.ContextVar("insights_formula_zone", default="UTC")   # the workspace's zone while a query is compiled
MAX_LENGTH, MAX_NODES = 2000, 300
TYPES = ("number", "string", "boolean", "date", "datetime")
UNITS = ("day", "month", "year")

# name: (fewest arguments, most (None: any), what it is)
FUNCTIONS = {
    "IF": (2, 3, "logic"), "SWITCH": (3, None, "logic"), "ISBLANK": (1, 1, "logic"), "COALESCE": (2, None, "logic"),
    "DIVIDE": (2, 3, "math"), "ROUND": (1, 2, "math"), "ABS": (1, 1, "math"), "FLOOR": (1, 1, "math"), "CEILING": (1, 1, "math"),
    "CONCAT": (2, None, "text"), "UPPER": (1, 1, "text"), "LOWER": (1, 1, "text"), "TRIM": (1, 1, "text"), "LEFT": (2, 2, "text"),
    "RIGHT": (2, 2, "text"), "LEN": (1, 1, "text"), "CONTAINS": (2, 2, "text"), "REPLACE": (3, 3, "text"), "TEXT": (1, 1, "text"),
    "YEAR": (1, 1, "date"), "MONTH": (1, 1, "date"), "DAY": (1, 1, "date"), "TODAY": (0, 0, "date"), "DATEDIFF": (3, 3, "date"), "DATEADD": (3, 3, "date"),
    "SUM": (1, 2, "aggregate"), "AVERAGE": (1, 2, "aggregate"), "MIN": (1, 2, "aggregate"), "MAX": (1, 2, "aggregate"), "COUNT": (1, 2, "aggregate"),
    "DISTINCTCOUNT": (1, 2, "aggregate"), "COUNTROWS": (0, 1, "aggregate"),
}
AGGREGATE_SQL = {"SUM": "sum({x})", "AVERAGE": "avg({x})", "MIN": "min({x})", "MAX": "max({x})", "COUNT": "count({x})", "DISTINCTCOUNT": "count(DISTINCT {x})", "COUNTROWS": "count({x})"}
KEYWORDS = ("AND", "OR", "NOT", "TRUE", "FALSE", "BLANK")


class FormulaError(ValueError):
    """what is wrong, and where in the text (a character offset), when that is known"""
    def __init__(self, message: str, at: int | None = None):
        super().__init__(message)
        self.at = at


# ---------------------------------------------------------------------------------------------------- reading the text
TOKEN = re.compile(r"""(?P<ws>\s+)|(?P<num>\d+(?:\.\d+)?|\.\d+)|(?P<str>"(?:[^"]|"")*"|'(?:[^']|'')*')|(?P<field>\[[^\[\]]*\])
                       |(?P<name>[A-Za-z_][A-Za-z0-9_]*)|(?P<op><>|!=|<=|>=|&&|\|\||[-+*/&=<>(),])""", re.X)


def _tokens(text: str) -> list[tuple[str, str, int]]:
    out, at = [], 0
    while at < len(text):
        found = TOKEN.match(text, at)
        if not found:
            char = text[at]
            if char in "\"'":
                raise FormulaError("This text needs its closing quote.", at)
            if char == "[":
                raise FormulaError("This field name needs its closing ].", at)
            raise FormulaError(f"“{char}” is not part of a formula.", at)
        kind = found.lastgroup
        if kind != "ws":
            out.append((kind, found.group(), at))
        at = found.end()
    out.append(("end", "", len(text)))
    return out


class _Parser:
    def __init__(self, text: str):
        self.tokens = _tokens(text)
        self.i = 0
        self.nodes = 0

    def peek(self):
        return self.tokens[self.i]

    def take(self):
        token = self.tokens[self.i]
        self.i += 1
        return token

    def word(self, *words) -> bool:
        kind, value, _ = self.peek()
        return (kind == "name" and value.upper() in words) or (kind == "op" and value in words)

    def node(self, **fields) -> dict:
        self.nodes += 1
        if self.nodes > MAX_NODES:
            raise FormulaError("This formula is too long to work out; split it into two fields.")
        return fields

    def parse(self) -> dict:
        if self.peek()[0] == "end":
            raise FormulaError("Write a formula.", 0)
        tree = self.either()
        kind, value, at = self.peek()
        if kind != "end":
            raise FormulaError(f"Something is missing before “{value}”: an operator such as + or &, or a comma inside a function.", at)
        return tree

    def either(self):
        left = self.both()
        while self.word("OR", "||"):
            at = self.take()[2]
            left = self.node(t="bin", op="OR", l=left, r=self.both(), at=at)
        return left

    def both(self):
        left = self.negation()
        while self.word("AND", "&&"):
            at = self.take()[2]
            left = self.node(t="bin", op="AND", l=left, r=self.negation(), at=at)
        return left

    def negation(self):
        if self.word("NOT"):
            at = self.take()[2]
            return self.node(t="not", x=self.negation(), at=at)
        return self.comparison()

    def comparison(self):
        left = self.joined()
        if self.word("=", "<>", "!=", "<", "<=", ">", ">="):
            _, op, at = self.take()
            left = self.node(t="bin", op="<>" if op == "!=" else op, l=left, r=self.joined(), at=at)
        return left

    def joined(self):
        left = self.additive()
        while self.word("&"):
            at = self.take()[2]
            left = self.node(t="bin", op="&", l=left, r=self.additive(), at=at)
        return left

    def additive(self):
        left = self.multiplicative()
        while self.word("+", "-"):
            _, op, at = self.take()
            left = self.node(t="bin", op=op, l=left, r=self.multiplicative(), at=at)
        return left

    def multiplicative(self):
        left = self.unary()
        while self.word("*", "/"):
            _, op, at = self.take()
            left = self.node(t="bin", op=op, l=left, r=self.unary(), at=at)
        return left

    def unary(self):
        if self.word("-"):
            at = self.take()[2]
            return self.node(t="neg", x=self.unary(), at=at)
        return self.primary()

    def primary(self):
        kind, value, at = self.take()
        if kind == "num":
            number = float(value)
            return self.node(t="num", v=int(number) if number.is_integer() and "." not in value else number, at=at)
        if kind == "str":
            return self.node(t="str", v=value[1:-1].replace(value[0] * 2, value[0]), at=at)
        if kind == "field":
            name = " ".join(value[1:-1].split())
            if not name:
                raise FormulaError("Name a field inside the brackets.", at)
            return self.node(t="field", name=name, at=at)
        if kind == "op" and value == "(":
            inner = self.either()
            if self.take()[1] != ")":
                raise FormulaError("A bracket opened here is not closed.", at)
            return inner
        if kind == "name":
            upper = value.upper()
            if upper in ("TRUE", "FALSE"):
                return self.node(t="bool", v=upper == "TRUE", at=at)
            if upper == "BLANK":
                if self.word("("):                                   # BLANK() reads like BLANK
                    self.take()
                    if self.take()[1] != ")":
                        raise FormulaError("BLANK takes nothing between its brackets.", at)
                return self.node(t="null", at=at)
            if upper not in FUNCTIONS:
                raise FormulaError(f"{value} is not a function here. Put a field in brackets, like [{value}].", at)
            if not self.word("("):
                raise FormulaError(f"{upper} needs brackets after it, like {upper}(…).", at)
            self.take()
            args = []
            if not self.word(")"):
                args.append(self.either())
                while self.word(","):
                    self.take()
                    args.append(self.either())
            closing = self.take()
            if closing[1] != ")":
                raise FormulaError(f"{upper}( is not closed: add ) after its last value.", closing[2] if closing[0] != "end" else at)
            fewest, most, _ = FUNCTIONS[upper]
            if len(args) < fewest or (most is not None and len(args) > most):
                wanted = f"{fewest}" if fewest == most else f"{fewest} or more" if most is None else f"{fewest} to {most}"
                raise FormulaError(f"{upper} takes {wanted} value{'' if wanted == '1' else 's'}; it has {len(args)}.", at)
            return self.node(t="call", fn=upper, args=args, at=at)
        if kind == "end":
            raise FormulaError("The formula ends too soon: something is missing at the end.", at)
        raise FormulaError(f"“{value}” cannot go here.", at)


def parse(text: str) -> dict:
    if not isinstance(text, str) or not text.strip():
        raise FormulaError("Write a formula.", 0)
    if len(text) > MAX_LENGTH:
        raise FormulaError(f"A formula has up to {MAX_LENGTH:,} characters.")
    return _Parser(text).parse()


# ---------------------------------------------------------------------------------------------------- checking it
class Checked:
    """the formula understood: its tree (fields resolved, types known, calculated measures inlined), its type, the fields it
    reads, whether it reads personal data, and (a measure) its aggregates in order"""
    def __init__(self, ast, type_, fields, personal, calls):
        self.ast, self.type, self.fields, self.personal, self.calls = ast, type_, fields, personal, calls


def _family(type_):
    return "date" if type_ in ("date", "datetime") else type_


def _unify(types: list[str], at, what: str) -> str:
    known = [t for t in types if t != "null"]
    if not known:
        return "null"
    if len({_family(t) for t in known}) > 1:
        raise FormulaError(f"{what} gives values of different kinds ({' and '.join(sorted(KIND_WORDS[_family(t)] for t in set(known)))}); make them the same, for example with TEXT().", at)
    return "datetime" if "datetime" in known else known[0]


KIND_WORDS = {"number": "a number", "string": "text", "boolean": "a yes/no condition", "date": "a date"}


def _need(node: dict, families: tuple, what: str):
    if node["type"] != "null" and _family(node["type"]) not in families:
        raise FormulaError(f"{what} needs {' or '.join(KIND_WORDS[f] for f in families)}; this is {KIND_WORDS[_family(node['type'])]}.", node["at"])


def _find(dataset: dict, name: str, at: int) -> dict:
    wanted = name.lower()
    for field in dataset["fields"]:                                    # a label first (what people see), then a key
        if " ".join(field["label"].split()).lower() == wanted:
            return field
    for field in dataset["fields"]:
        if field["key"].lower() == wanted:
            return field
    for locked in dataset.get("locked", []):
        if locked["key"].lower() == wanted or locked["label"].lower() == wanted:
            raise FormulaError(f"[{locked['label']}] is personal data: a formula on it needs the report administration right.", at)
    raise FormulaError(f"There is no field called [{name}] in this dataset.", at)


def _calculated(field: dict, at: int) -> dict:
    """a calculated measure as a tree: a measure formula's own, or a catalogue formula (ratio, difference, sum, product)"""
    if field.get("expression"):
        return _relocate(parse(field["expression"]["text"]), at)
    formula = field["formula"]

    def side(part):
        if "field" not in part:
            return {"t": "num", "v": part["value"], "at": at}
        fn = {"sum": "SUM", "avg": "AVERAGE", "min": "MIN", "max": "MAX", "count": "COUNT", "count_distinct": "DISTINCTCOUNT"}.get(part["aggregate"])
        inner = {"t": "field", "name": part["field"], "at": at}
        return {"t": "call", "fn": fn, "args": [inner], "at": at} if fn else inner
    left, right = side(formula["left"]), side(formula["right"])
    op = {"ratio": "/", "difference": "-", "sum": "+", "product": "*"}[formula["op"]]
    tree = {"t": "bin", "op": op, "l": left, "r": right, "at": at}
    scale = formula.get("scale")
    return {"t": "bin", "op": "*", "l": tree, "r": {"t": "num", "v": scale, "at": at}, "at": at} if scale not in (None, 1) else tree


def _relocate(node, at):
    """a copy of an inlined tree, every position the reference's (an error inside it points at the reference)"""
    if isinstance(node, dict):
        return {k: (at if k == "at" else _relocate(v, at)) for k, v in node.items()}
    if isinstance(node, list):
        return [_relocate(v, at) for v in node]
    return node


def check(text: str, dataset: dict, *, measure: bool) -> Checked:
    tree = parse(text)
    used: dict[str, dict] = {}
    calls: list[dict] = []

    def visit(node: dict, inside: str | None, depth: int = 0) -> dict:
        if depth > 60:
            raise FormulaError("This formula nests too deeply.", node.get("at"))
        t = node["t"]
        if t == "num":
            return {**node, "type": "number"}
        if t == "str":
            return {**node, "type": "string"}
        if t == "bool":
            return {**node, "type": "boolean"}
        if t == "null":
            return {**node, "type": "null"}
        if t == "field":
            field = _find(dataset, node["name"], node["at"])
            calculated = field["role"] == "measure" and field.get("aggregates") == ["calc"]
            if calculated:
                if not measure or inside:
                    raise FormulaError(f"[{field['label']}] is a measure worked out over many rows; use it in a measure formula, outside SUM and the other aggregates.", node["at"])
                return visit(_calculated(field, node["at"]), inside, depth + 1)
            if measure and not inside:
                raise FormulaError(f"Put [{field['label']}] inside SUM, AVERAGE, MIN, MAX or COUNT: a measure formula works over many rows.", node["at"])
            used[field["key"]] = field
            return {"t": "field", "key": field["key"], "type": field["type"], "at": node["at"]}
        if t == "neg":
            x = visit(node["x"], inside, depth + 1)
            _need(x, ("number",), "A minus sign")
            return {**node, "x": x, "type": "number"}
        if t == "not":
            x = visit(node["x"], inside, depth + 1)
            _need(x, ("boolean",), "NOT")
            return {**node, "x": x, "type": "boolean"}
        if t == "bin":
            left, right = visit(node["l"], inside, depth + 1), visit(node["r"], inside, depth + 1)
            op = node["op"]
            out = {**node, "l": left, "r": right}
            if op in ("+", "-", "*", "/"):
                if op == "+" and "string" in (left["type"], right["type"]):
                    raise FormulaError("“+” adds numbers: join text with &.", node["at"])
                for side in (left, right):
                    _need(side, ("number",), f"“{op}”")
                return {**out, "type": "number"}
            if op == "&":
                return {**out, "type": "string"}
            if op in ("AND", "OR"):
                for side in (left, right):
                    _need(side, ("boolean",), op)
                return {**out, "type": "boolean"}
            if "null" in (left["type"], right["type"]):
                raise FormulaError("Use ISBLANK(…) to ask whether a value is empty.", node["at"])
            if _family(left["type"]) != _family(right["type"]):
                raise FormulaError(f"“{op}” compares values of one kind; this compares {KIND_WORDS[_family(left['type'])]} with {KIND_WORDS[_family(right['type'])]}.", node["at"])
            if left["type"] == "boolean" and op not in ("=", "<>"):
                raise FormulaError("Yes/no values are only equal or not.", node["at"])
            return {**out, "type": "boolean"}
        # a function
        fn, at = node["fn"], node["at"]
        kind = FUNCTIONS[fn][2]
        if kind == "aggregate":
            if not measure:
                raise FormulaError(f"{fn} works over many rows: use it in a measure formula, not in a formula for each row.", at)
            if inside:
                raise FormulaError(f"{fn} cannot go inside {inside}.", at)
            raw = node["args"]
            if fn == "COUNTROWS":
                value, condition = {"t": "num", "v": 1, "type": "number", "at": at}, (visit(raw[0], fn, depth + 1) if raw else None)
            else:
                value = visit(raw[0], fn, depth + 1)
                condition = visit(raw[1], fn, depth + 1) if len(raw) > 1 else None
                if fn in ("SUM", "AVERAGE"):
                    _need(value, ("number",), fn)
                if fn in ("MIN", "MAX"):
                    _need(value, ("number", "date"), fn)
            if condition is not None:
                _need(condition, ("boolean",), f"The condition of {fn}")
            type_ = value["type"] if fn in ("MIN", "MAX") else "number"
            call = {"t": "agg", "fn": fn, "x": value, "when": condition, "n": len(calls), "type": type_, "at": at}
            calls.append(call)
            return call
        args = [visit(a, inside, depth + 1) for a in node["args"]]
        out = {**node, "args": args}
        if fn == "IF":
            _need(args[0], ("boolean",), "The first value of IF")
            return {**out, "type": _unify([a["type"] for a in args[1:]], at, "IF")}
        if fn == "SWITCH":
            pairs = args[1:]
            for value in pairs[0:len(pairs) - len(pairs) % 2:2]:
                if value["type"] != "null" and _family(value["type"]) != _family(args[0]["type"]):
                    raise FormulaError("SWITCH compares its first value with values of the same kind.", value["at"])
            results = pairs[1::2] + ([pairs[-1]] if len(pairs) % 2 else [])
            return {**out, "type": _unify([r["type"] for r in results], at, "SWITCH")}
        if fn == "ISBLANK":
            return {**out, "type": "boolean"}
        if fn == "COALESCE":
            return {**out, "type": _unify([a["type"] for a in args], at, "COALESCE")}
        if fn in ("DIVIDE", "ABS", "FLOOR", "CEILING", "ROUND"):
            for a in args[:1 if fn in ("ROUND",) else len(args)]:
                _need(a, ("number",), fn)
            if fn == "ROUND" and len(args) > 1 and not (args[1]["t"] == "num" and isinstance(args[1]["v"], int) and 0 <= args[1]["v"] <= 10):
                raise FormulaError("ROUND takes the number of decimal places as a whole number from 0 to 10.", args[1]["at"])
            return {**out, "type": "number"}
        if fn in ("UPPER", "LOWER", "TRIM", "LEN"):
            _need(args[0], ("string",), fn)
            return {**out, "type": "number" if fn == "LEN" else "string"}
        if fn in ("LEFT", "RIGHT"):
            _need(args[0], ("string",), fn)
            _need(args[1], ("number",), f"The length in {fn}")
            return {**out, "type": "string"}
        if fn in ("CONTAINS", "REPLACE"):
            for a in args:
                _need(a, ("string",), fn)
            return {**out, "type": "boolean" if fn == "CONTAINS" else "string"}
        if fn in ("CONCAT", "TEXT"):
            return {**out, "type": "string"}
        if fn in ("YEAR", "MONTH", "DAY"):
            _need(args[0], ("date",), fn)
            return {**out, "type": "number"}
        if fn == "TODAY":
            return {**out, "type": "date"}
        unit = args[2]
        if unit["t"] != "str" or unit["v"].lower() not in UNITS:
            raise FormulaError(f'{fn} takes the unit as "day", "month" or "year".', unit["at"])
        args[2] = {**unit, "v": unit["v"].lower()}
        if fn == "DATEDIFF":
            _need(args[0], ("date",), fn)
            _need(args[1], ("date",), fn)
            return {**out, "args": args, "type": "number"}
        _need(args[0], ("date",), fn)
        _need(args[1], ("number",), f"The amount in {fn}")
        return {**out, "args": args, "type": args[0]["type"] if args[0]["type"] != "null" else "date"}

    checked = visit(tree, None)
    if measure:
        if not calls:
            raise FormulaError("A measure formula adds up rows: use SUM, AVERAGE, MIN, MAX, COUNT, DISTINCTCOUNT or COUNTROWS.", 0)
        if checked["type"] not in ("number", "date", "datetime"):
            raise FormulaError("A measure formula works out a number (or a date).", 0)
    elif checked["type"] == "null":
        raise FormulaError("This formula is always empty.", 0)
    personal = any(f.get("sensitivity") == "PII" for f in used.values())
    return Checked(checked, checked["type"], used, personal, calls)


# ---------------------------------------------------------------------------------------------------- writing the SQL
def _lit(value, dialect: str) -> str:
    from .derived import _literal
    return _literal(value, dialect)


def _zone_literal(dialect: str) -> str:
    zone = ZONE.get()
    if not re.match(r"^[A-Za-z0-9_+\-/]+$", zone):
        zone = "UTC"
    return _lit(zone, dialect)


def _nullif(dialect: str) -> str:
    return "nullIf" if dialect == "clickhouse" else "NULLIF"


def _join_text(parts: list[str], dialect: str) -> str:
    if dialect == "clickhouse":
        return "concat(" + ", ".join(f"ifNull(toString({p}), '')" for p in parts) + ")"
    if dialect == "mysql":
        return "CONCAT_WS('', " + ", ".join(parts) + ")"
    return "CONCAT(" + ", ".join(parts) + ")"


def render(node: dict, dialect: str, column, agg=None) -> str:
    """SQL for a checked tree: `column(key)` writes a field's column, `agg(call)` an aggregate (a measure formula only)"""
    def r(n):
        return render(n, dialect, column, agg)

    def local(n):                                                      # a date and time read in the workspace's zone
        if n["type"] != "datetime":
            return r(n)
        if dialect == "postgresql":
            return f"({r(n)} AT TIME ZONE {_zone_literal(dialect)})"
        if dialect == "clickhouse":
            return f"toTimeZone({r(n)}, {_zone_literal(dialect)})"
        return r(n)

    t = node["t"]
    if t == "num":
        return repr(node["v"])
    if t == "str":
        return _lit(node["v"], dialect)
    if t == "bool":
        return "TRUE" if node["v"] else "FALSE"
    if t == "null":
        return "NULL"
    if t == "field":
        return column(node["key"])
    if t == "agg":
        return agg(node)
    if t == "neg":
        return f"(-{r(node['x'])})"
    if t == "not":
        return f"(NOT {r(node['x'])})"
    if t == "bin":
        op, left, right = node["op"], node["l"], node["r"]
        if op == "/":
            return f"(({r(left)}) * 1.0 / {_nullif(dialect)}(({r(right)}), 0))"
        if op == "&":
            return _join_text([r(left), r(right)], dialect)
        return f"({r(left)} {op} {r(right)})"
    fn, args = node["fn"], node["args"]
    a = [r(x) for x in args]
    if fn == "IF":
        return f"(CASE WHEN {a[0]} THEN {a[1]} ELSE {a[2] if len(a) > 2 else 'NULL'} END)"
    if fn == "SWITCH":
        pairs = a[1:]
        whens = " ".join(f"WHEN {a[0]} = {pairs[i]} THEN {pairs[i + 1]}" for i in range(0, len(pairs) - 1, 2))
        return f"(CASE {whens} ELSE {pairs[-1] if len(pairs) % 2 else 'NULL'} END)"
    if fn == "ISBLANK":
        return f"({a[0]} IS NULL)"
    if fn == "COALESCE":
        return f"coalesce({', '.join(a)})"
    if fn == "DIVIDE":
        divided = f"(({a[0]}) * 1.0 / {_nullif(dialect)}(({a[1]}), 0))"
        return f"coalesce({divided}, {a[2]})" if len(a) > 2 else divided
    if fn == "ROUND":
        places = a[1] if len(a) > 1 else "0"
        return f"ROUND(CAST({a[0]} AS numeric), {places})" if dialect == "postgresql" else f"round({a[0]}, {places})"
    if fn in ("ABS", "FLOOR"):
        return f"{fn.lower()}({a[0]})"
    if fn == "CEILING":
        return {"postgresql": "CEIL({})", "mysql": "CEILING({})", "clickhouse": "ceil({})"}[dialect].format(a[0])
    if fn == "CONCAT":
        return _join_text(a, dialect)
    if fn in ("UPPER", "LOWER"):
        return f"{fn.lower()}UTF8({a[0]})" if dialect == "clickhouse" else f"{fn}({a[0]})"
    if fn == "TRIM":
        return f"trimBoth({a[0]})" if dialect == "clickhouse" else f"TRIM({a[0]})"
    if fn in ("LEFT", "RIGHT"):
        if dialect == "clickhouse":
            return f"{fn.lower()}UTF8({a[0]}, toInt64({a[1]}))"
        return f"{fn}({a[0]}, CAST({a[1]} AS {'int' if dialect == 'postgresql' else 'SIGNED'}))"
    if fn == "LEN":
        return f"lengthUTF8({a[0]})" if dialect == "clickhouse" else f"char_length({a[0]})"
    if fn == "CONTAINS":
        if dialect == "clickhouse":
            return f"(positionCaseInsensitiveUTF8({a[0]}, {a[1]}) > 0)"
        if dialect == "mysql":
            return f"(LOCATE(LOWER({a[1]}), LOWER({a[0]})) > 0)"
        return f"(strpos(lower({a[0]}), lower({a[1]})) > 0)"
    if fn == "REPLACE":
        return f"replaceAll({a[0]}, {a[1]}, {a[2]})" if dialect == "clickhouse" else f"REPLACE({a[0]}, {a[1]}, {a[2]})"
    if fn == "TEXT":
        return {"postgresql": "CAST({} AS text)", "mysql": "CAST({} AS CHAR)", "clickhouse": "toString({})"}[dialect].format(a[0])
    if fn in ("YEAR", "MONTH", "DAY"):
        when = local(args[0])
        if dialect == "clickhouse":
            return f"{ {'YEAR': 'toYear', 'MONTH': 'toMonth', 'DAY': 'toDayOfMonth'}[fn] }({when})"
        if dialect == "mysql":
            return f"{fn}({when})"
        return f"CAST(EXTRACT({fn} FROM {when}) AS int)"
    if fn == "TODAY":
        if dialect == "clickhouse":
            return f"toDate(now(), {_zone_literal(dialect)})"
        if dialect == "mysql":
            return "CURDATE()"
        return f"CAST((now() AT TIME ZONE {_zone_literal(dialect)}) AS date)"
    unit = args[2]["v"]
    if fn == "DATEDIFF":
        start, end = local(args[0]), local(args[1])
        if dialect == "clickhouse":
            return f"dateDiff('{unit}', toDate({start}), toDate({end}))"
        if dialect == "mysql":
            return f"TIMESTAMPDIFF({unit.upper()}, {start}, {end})"
        if unit == "day":
            return f"(CAST({end} AS date) - CAST({start} AS date))"
        age = f"age(CAST({end} AS date), CAST({start} AS date))"
        return f"CAST(EXTRACT(YEAR FROM {age}) AS int)" if unit == "year" else f"CAST(EXTRACT(YEAR FROM {age}) * 12 + EXTRACT(MONTH FROM {age}) AS int)"
    # DATEADD
    if dialect == "clickhouse":
        return f"add{unit.capitalize()}s({a[0]}, toInt64({a[1]}))"
    if dialect == "mysql":
        return f"DATE_ADD({a[0]}, INTERVAL CAST({a[1]} AS SIGNED) {unit.upper()})"
    moved = f"({a[0]} + make_interval({unit}s => CAST({a[1]} AS int)))"
    return f"CAST({moved} AS date)" if args[0]["type"] == "date" else moved


def operand_sql(call: dict, dialect: str, column) -> str:
    """what an aggregate of a measure formula reads, for each row: its value, or empty where its condition does not hold"""
    value = render(call["x"], dialect, column)
    if call["when"] is None:
        return value
    return f"(CASE WHEN {render(call['when'], dialect, column)} THEN {value} END)"


def aggregate_sql(call: dict, operand: str) -> str:
    return AGGREGATE_SQL[call["fn"]].format(x=operand)


# ---------------------------------------------------------------------------------------------------- the editor's check
from drf_spectacular.utils import extend_schema  # noqa: E402
from rest_framework.exceptions import NotFound  # noqa: E402
from rest_framework.response import Response  # noqa: E402
from rest_framework.views import APIView  # noqa: E402


class FormulaCheckView(APIView):
    """POST /insights/formulas/check/ {dataset, derived: the custom fields before it, field: {key?, label, kind, expression, role?,
    format?}}: the field as it would be saved (its type and use), or what is wrong and where in the text. Nothing runs."""

    def get_permissions(self):
        from .api import VIEW
        return [permission() for permission in VIEW]

    @extend_schema(responses={200: None})
    def post(self, request, version=None):
        from . import catalog, derived
        from .api import _can_see_pii, _tenant
        body = request.data if isinstance(request.data, dict) else {}
        dataset = catalog.dataset(_tenant().pk, str(body.get("dataset") or ""), _can_see_pii(request))
        if dataset is None:
            raise NotFound("No such dataset.")
        before = body.get("derived") if isinstance(body.get("derived"), list) else []
        item = body.get("field") if isinstance(body.get("field"), dict) else {}
        try:
            specs = derived.check(dataset, [*before, item])
        except derived.DerivedError as exc:
            mine = exc.field.startswith(f"derived[{len(before)}]")
            return Response({"ok": False, "message": str(exc), "at": exc.at if mine else None, "where": exc.field.split(".", 1)[-1] if mine else exc.field})
        spec = specs[-1]
        field = next(f for f in derived.augment(dataset, {"derived": specs})["fields"] if f["key"] == spec["key"])
        reads = field["expression"]["checked"].fields if field.get("expression") else field["derived"]["checked"].fields
        return Response({"ok": True, "spec": spec, "role": field["role"], "personal": field["sensitivity"] == "PII",
                         "uses": [f["label"] for f in reads.values()]})
