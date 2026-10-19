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

Version 2 adds:
    VAR Sales = SUM([Net Sales]) VAR Cost = SUM([Cost]) RETURN DIVIDE(Sales - Cost, Sales)      names for parts (inlined)
    SUMX([Price] * [Units])                         SUMX, AVERAGEX, MINX, MAXX, COUNTX: the aggregates by another name
    DIVIDE(SUM([Sales]), CALCULATE(SUM([Sales]), ALL([Store])))    share of the parent: the total without the Store grouping
    CALCULATE(SUM([Sales]), [Channel] = "EMAIL")    a condition on every aggregate inside
    RANKX(SUM([Sales]))                             the row's rank among the report's rows (a whole formula on its own)
    TOTALYTD(SUM([Sales])), TOTALQTD(...)           year and quarter to date along the report's date (fiscal aware)
    SAMEPERIODLASTYEAR(SUM([Sales])), PREVIOUSPERIOD(...), PARALLELPERIOD(..., -3, "month")   the same measure earlier
The analytic ones (CALCULATE with ALL, RANKX, the time functions) work over the report's grouped rows: the compiler wraps the
grouped query in an outer one with window functions and joins (compiler._compile_analytic); they belong to measure formulas.
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
    # version 2
    "POWER": (2, 2, "math"), "SQRT": (1, 1, "math"), "MOD": (2, 2, "math"), "LN": (1, 1, "math"), "LOG": (1, 2, "math"), "EXP": (1, 1, "math"),
    "INT": (1, 1, "math"), "SIGN": (1, 1, "math"),
    "MID": (3, 3, "text"), "FIND": (2, 2, "text"), "SUBSTITUTE": (3, 3, "text"), "VALUE": (1, 1, "text"),
    "WEEKDAY": (1, 1, "date"), "WEEKNUM": (1, 1, "date"), "QUARTER": (1, 1, "date"), "HOUR": (1, 1, "date"), "EOMONTH": (1, 2, "date"),
    "DATE": (3, 3, "date"), "NOW": (0, 0, "date"),
    "SUMX": (1, 2, "aggregate"), "AVERAGEX": (1, 2, "aggregate"), "MINX": (1, 2, "aggregate"), "MAXX": (1, 2, "aggregate"), "COUNTX": (1, 2, "aggregate"),
    "CALCULATE": (1, None, "analytic"), "ALL": (0, None, "modifier"), "REMOVEFILTERS": (0, None, "modifier"), "RANKX": (1, 2, "analytic"),
    "TOTALYTD": (1, 1, "analytic"), "TOTALQTD": (1, 1, "analytic"), "SAMEPERIODLASTYEAR": (1, 1, "analytic"), "PREVIOUSPERIOD": (1, 1, "analytic"),
    "PARALLELPERIOD": (3, 3, "analytic"),
}
ALIASES = {"SUMX": "SUM", "AVERAGEX": "AVERAGE", "MINX": "MIN", "MAXX": "MAX", "COUNTX": "COUNT", "SUBSTITUTE": "REPLACE", "REMOVEFILTERS": "ALL"}
PERIOD_MONTHS = {"month": 1, "quarter": 3, "year": 12}
AGGREGATE_SQL = {"SUM": "sum({x})", "AVERAGE": "avg({x})", "MIN": "min({x})", "MAX": "max({x})", "COUNT": "count({x})", "DISTINCTCOUNT": "count(DISTINCT {x})", "COUNTROWS": "count({x})"}
KEYWORDS = ("AND", "OR", "NOT", "TRUE", "FALSE", "BLANK", "VAR", "RETURN")


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
        self.names: dict[str, dict] = {}                               # VAR name -> its tree

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
        if self.word("VAR"):
            while self.word("VAR"):
                at = self.take()[2]
                kind, name, where = self.take()
                if kind != "name" or name.upper() in FUNCTIONS or name.upper() in KEYWORDS:
                    raise FormulaError("Give VAR a name of letters and digits that is not a function, such as VAR Sales = SUM([Net Sales]).", where if kind != "end" else at)
                if name.lower() in self.names:
                    raise FormulaError(f"{name} is named twice.", where)
                if self.take()[1] != "=":
                    raise FormulaError(f"Write VAR {name} = and then its value.", where)
                self.names[name.lower()] = self.either()
            if not self.word("RETURN"):
                kind, value, at = self.peek()
                raise FormulaError("After the VARs, write RETURN and the result.", at)
            self.take()
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
            if value.lower() in self.names and not self.word("("):          # a VAR's name: its tree in its place
                return self.names[value.lower()]
            if upper == "RETURN":
                raise FormulaError("RETURN goes after the VARs, once.", at)
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
    reads, whether it reads personal data, and (a measure) its aggregates in order; `analytic` when it works over the report's
    grouped rows (CALCULATE with ALL, RANKX, the time functions), `timed` when it needs the report's date"""
    def __init__(self, ast, type_, fields, personal, calls):
        self.ast, self.type, self.fields, self.personal, self.calls = ast, type_, fields, personal, calls
        found = list(_walk(ast))
        self.analytic = any(n["t"] in ("window", "shift", "rank") for n in found)
        self.timed = any(n["t"] == "shift" or (n["t"] == "window" and n["kind"] != "all") for n in found)
        self.ranked = ast["t"] == "rank"


def _walk(node):
    if isinstance(node, dict):
        if "t" in node:
            yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


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
    if field.get("shared") and field["shared"].get("kind") == "measure":     # a dataset formula not yet worked out
        return _relocate(parse(field["shared"]["expression"]), at)
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


def _walk_has_agg(node) -> bool:
    return any(n["t"] == "agg" for n in _walk(node))


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

    def visit(node: dict, inside: str | None, depth: int = 0, scope: dict | None = None) -> dict:
        """scope (a measure formula, outside the aggregates): the conditions CALCULATE adds to the aggregates within, and
        whether a window or a time shift is already around"""
        scope = scope or {}
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
                return visit(_calculated(field, node["at"]), inside, depth + 1, scope)
            if measure and not inside:
                raise FormulaError(f"Put [{field['label']}] inside SUM, AVERAGE, MIN, MAX or COUNT: a measure formula works over many rows.", node["at"])
            used[field["key"]] = field
            return {"t": "field", "key": field["key"], "type": field["type"], "at": node["at"]}
        if t == "neg":
            x = visit(node["x"], inside, depth + 1, scope)
            _need(x, ("number",), "A minus sign")
            return {**node, "x": x, "type": "number"}
        if t == "not":
            x = visit(node["x"], inside, depth + 1, scope)
            _need(x, ("boolean",), "NOT")
            return {**node, "x": x, "type": "boolean"}
        if t == "bin":
            left, right = visit(node["l"], inside, depth + 1, scope), visit(node["r"], inside, depth + 1, scope)
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
        fn = ALIASES.get(fn, fn)
        if kind == "modifier":
            raise FormulaError(f"{fn} goes inside CALCULATE, after the measure: CALCULATE(SUM([Sales]), ALL([Store])).", at)
        if kind == "analytic":
            return analytic(fn, node, inside, depth, scope)
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
            for extra in scope.get("conditions", []):                  # CALCULATE's conditions narrow every aggregate inside it
                condition = extra if condition is None else {"t": "bin", "op": "AND", "l": extra, "r": condition, "type": "boolean", "at": at}
            if fn == "DISTINCTCOUNT" and scope.get("window"):
                raise FormulaError("DISTINCTCOUNT cannot be added up across groups: use it outside CALCULATE with ALL and the to-date functions.", at)
            type_ = value["type"] if fn in ("MIN", "MAX") else "number"
            call = {"t": "agg", "fn": fn, "x": value, "when": condition, "n": len(calls), "type": type_, "at": at}
            calls.append(call)
            return call
        args = [visit(a, inside, depth + 1, scope) for a in node["args"]]
        out = {**node, "fn": fn, "args": args}
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
        if fn in ("POWER", "SQRT", "MOD", "LN", "LOG", "EXP", "INT", "SIGN"):
            for a in args:
                _need(a, ("number",), fn)
            return {**out, "type": "number"}
        if fn == "MID":
            _need(args[0], ("string",), fn)
            _need(args[1], ("number",), "The start in MID")
            _need(args[2], ("number",), "The length in MID")
            return {**out, "type": "string"}
        if fn == "FIND":
            _need(args[0], ("string",), fn)
            _need(args[1], ("string",), fn)
            return {**out, "type": "number"}
        if fn == "VALUE":
            _need(args[0], ("string",), fn)
            return {**out, "type": "number"}
        if fn in ("WEEKDAY", "WEEKNUM", "QUARTER"):
            _need(args[0], ("date",), fn)
            return {**out, "type": "number"}
        if fn == "HOUR":
            if args[0]["type"] not in ("datetime", "null"):
                raise FormulaError("HOUR needs a date and time.", args[0]["at"])
            return {**out, "type": "number"}
        if fn == "EOMONTH":
            _need(args[0], ("date",), fn)
            if len(args) > 1:
                _need(args[1], ("number",), "The months in EOMONTH")
            return {**out, "type": "date"}
        if fn == "DATE":
            for a in args:
                _need(a, ("number",), fn)
            return {**out, "type": "date"}
        if fn == "NOW":
            return {**out, "type": "datetime"}
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

    def analytic(fn: str, node: dict, inside, depth: int, scope: dict) -> dict:
        at = node["at"]
        if not measure:
            raise FormulaError(f"{fn} works over the report's groups: use it in a measure formula.", at)
        if inside:
            raise FormulaError(f"{fn} cannot go inside {inside}.", at)
        raw = node["args"]
        if fn == "RANKX":
            if scope.get("ranked") is not None or depth > 0:
                raise FormulaError("RANKX is a measure of its own: write it as the whole formula, such as RANKX(SUM([Sales])).", at)
            order = "desc"
            if len(raw) > 1:
                if raw[1]["t"] != "str" or raw[1]["v"].lower() not in ("asc", "desc"):
                    raise FormulaError('RANKX takes the order as "desc" (the largest first) or "asc".', raw[1]["at"])
                order = raw[1]["v"].lower()
            before = len(calls)
            x = visit(raw[0], None, depth + 1, {**scope, "ranked": True})
            if len(calls) == before:
                raise FormulaError("RANKX ranks a measure: put SUM, AVERAGE, COUNT or another aggregate inside it.", at)
            _need(x, ("number", "date"), "RANKX")
            return {"t": "rank", "x": x, "asc": order == "asc", "type": "number", "at": at}
        if fn == "CALCULATE":
            drop, conditions = None, []
            for extra in raw[1:]:
                if extra["t"] == "call" and ALIASES.get(extra["fn"], extra["fn"]) == "ALL":
                    if drop is not None:
                        raise FormulaError("CALCULATE takes one ALL, naming every field to leave out.", extra["at"])
                    drop = []
                    for f in extra["args"]:
                        if f["t"] != "field":
                            raise FormulaError("ALL names fields in brackets, such as ALL([Store]), or nothing for the grand total.", f["at"])
                        found = _find(dataset, f["name"], f["at"])
                        if found["role"] != "dimension":
                            raise FormulaError(f"ALL leaves out a field the report groups by; [{found['label']}] is a measure.", f["at"])
                        drop.append(found["key"])
                else:
                    condition = visit(extra, "CALCULATE", depth + 1)
                    _need(condition, ("boolean",), "A condition in CALCULATE")
                    conditions.append(condition)
            if drop is not None and scope.get("window"):
                raise FormulaError("CALCULATE with ALL, TOTALYTD and TOTALQTD cannot sit inside one another.", at)
            inner_scope = {**scope, "conditions": [*scope.get("conditions", []), *conditions]}
            if drop is not None:
                inner_scope["window"] = True
            before = len(calls)
            x = visit(raw[0], None, depth + 1, inner_scope)
            if len(calls) == before:
                raise FormulaError("CALCULATE works out a measure: put SUM, AVERAGE, COUNT or another aggregate in it.", at)
            if drop is None:
                return x
            return {"t": "window", "kind": "all", "drop": drop, "x": x, "type": x["type"], "at": at}
        if fn in ("TOTALYTD", "TOTALQTD"):
            if scope.get("window"):
                raise FormulaError("CALCULATE with ALL, TOTALYTD and TOTALQTD cannot sit inside one another.", at)
            x = visit(raw[0], None, depth + 1, {**scope, "window": True})
            if not _walk_has_agg(x):
                raise FormulaError(f"{fn} adds up a measure: put SUM, COUNT or another aggregate inside it.", at)
            return {"t": "window", "kind": "ytd" if fn == "TOTALYTD" else "qtd", "x": x, "type": x["type"], "at": at}
        # the time shifts
        if scope.get("shift"):
            raise FormulaError("One time shift at a time: SAMEPERIODLASTYEAR, PREVIOUSPERIOD and PARALLELPERIOD cannot sit inside one another.", at)
        if fn == "PARALLELPERIOD":
            amount, unit = raw[1], raw[2]
            if amount["t"] == "neg" and amount["x"]["t"] == "num":
                amount = {**amount["x"], "v": -amount["x"]["v"]}
            if amount["t"] != "num" or not isinstance(amount["v"], int) or amount["v"] == 0 or abs(amount["v"]) > 120:
                raise FormulaError("PARALLELPERIOD moves by a whole number of periods, such as -1 (the one before) or -12.", raw[1]["at"])
            if unit["t"] != "str" or unit["v"].lower() not in PERIOD_MONTHS:
                raise FormulaError('PARALLELPERIOD takes the unit as "month", "quarter" or "year".', unit["at"])
            shift = {"months": -amount["v"] * PERIOD_MONTHS[unit["v"].lower()]}
        elif fn == "SAMEPERIODLASTYEAR":
            shift = {"year": True}
        else:
            shift = {"period": True}
        x = visit(raw[0], None, depth + 1, {**scope, "shift": True})
        if not _walk_has_agg(x):
            raise FormulaError(f"{fn} moves a measure: put SUM, AVERAGE, COUNT or another aggregate inside it.", at)
        return {"t": "shift", **shift, "x": x, "type": x["type"], "at": at}

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


def render(node: dict, dialect: str, column, agg=None, state: dict | None = None) -> str:
    """SQL for a checked tree: `column(key)` writes a field's column, `agg(call)` an aggregate (a measure formula only). Over the
    report's grouped rows (compiler._compile_analytic) `state` is a dict: `agg(call, state)` then writes the aggregate as that
    query reads it, with the window ("window": the node) or the time shift ("shift": the node) it sits under."""
    def r(n):
        return render(n, dialect, column, agg, state)

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
        return agg(node) if state is None else agg(node, state)
    if t in ("window", "shift", "rank"):
        if state is None:
            raise FormulaError("This measure works over the report's groups; it is worked out with them.", node.get("at"))
        if t == "rank":
            raise FormulaError("RANKX is worked out last, over the report's rows.", node.get("at"))
        return render(node["x"], dialect, column, agg, {**state, t: node})
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
    if fn == "POWER":
        return f"pow({a[0]}, {a[1]})" if dialect == "clickhouse" else f"power({a[0]}, {a[1]})"
    if fn == "SQRT":
        return f"(CASE WHEN {a[0]} >= 0 THEN sqrt({a[0]}) END)"
    if fn == "MOD":
        if dialect == "postgresql":
            return f"mod(CAST({a[0]} AS numeric), {_nullif(dialect)}(CAST({a[1]} AS numeric), 0))"
        return f"modulo({a[0]}, nullIf({a[1]}, 0))" if dialect == "clickhouse" else f"MOD({a[0]}, NULLIF({a[1]}, 0))"
    if fn == "LN":
        return f"(CASE WHEN {a[0]} > 0 THEN {'log' if dialect == 'clickhouse' else 'ln'}({a[0]}) END)"
    if fn == "LOG":
        base = a[1] if len(a) > 1 else "10"
        if dialect == "clickhouse":
            return f"(CASE WHEN {a[0]} > 0 AND {base} > 0 THEN log({a[0]}) / nullIf(log({base}), 0) END)"
        cast = "CAST({} AS numeric)" if dialect == "postgresql" else "{}"
        return f"(CASE WHEN {a[0]} > 0 AND {base} > 0 AND {base} <> 1 THEN log({cast.format(base)}, {cast.format(a[0])}) END)"
    if fn == "EXP":
        return f"exp({a[0]})"
    if fn == "INT":
        return f"floor({a[0]})"
    if fn == "SIGN":
        return f"sign({a[0]})"
    if fn == "MID":
        if dialect == "clickhouse":
            return f"substringUTF8({a[0]}, toInt64({a[1]}), toInt64({a[2]}))"
        kind = "int" if dialect == "postgresql" else "SIGNED"
        return f"SUBSTRING({a[0]}, CAST({a[1]} AS {kind}), CAST({a[2]} AS {kind}))"
    if fn == "FIND":
        if dialect == "clickhouse":
            return f"positionUTF8({a[1]}, {a[0]})"
        return f"LOCATE({a[0]}, {a[1]})" if dialect == "mysql" else f"strpos({a[1]}, {a[0]})"
    if fn == "VALUE":
        if dialect == "clickhouse":
            return f"toFloat64OrNull(trimBoth({a[0]}))"
        if dialect == "mysql":
            return f"(CASE WHEN TRIM({a[0]}) REGEXP '^-?[0-9]+([.][0-9]+)?$' THEN CAST(TRIM({a[0]}) AS DECIMAL(38, 10)) END)"
        return f"(CASE WHEN btrim({a[0]}) ~ '^-?[0-9]+([.][0-9]+)?$' THEN CAST(btrim({a[0]}) AS numeric) END)"
    if fn in ("WEEKDAY", "WEEKNUM", "QUARTER", "HOUR"):
        when = local(args[0])
        if dialect == "clickhouse":
            return {"WEEKDAY": f"(toDayOfWeek({when}) % 7 + 1)", "WEEKNUM": f"toISOWeek({when})", "QUARTER": f"toQuarter({when})", "HOUR": f"toHour({when})"}[fn]
        if dialect == "mysql":
            return {"WEEKDAY": f"DAYOFWEEK({when})", "WEEKNUM": f"WEEK({when}, 3)", "QUARTER": f"QUARTER({when})", "HOUR": f"HOUR({when})"}[fn]
        part = {"WEEKDAY": "DOW", "WEEKNUM": "WEEK", "QUARTER": "QUARTER", "HOUR": "HOUR"}[fn]
        return f"(CAST(EXTRACT({part} FROM {when}) AS int){' + 1' if fn == 'WEEKDAY' else ''})"
    if fn == "EOMONTH":
        months = a[1] if len(a) > 1 else "0"
        when = local(args[0])
        if dialect == "clickhouse":
            return f"addDays(toStartOfMonth(addMonths(toDate({when}), toInt64({months}) + 1)), -1)"
        if dialect == "mysql":
            return f"LAST_DAY(DATE_ADD({when}, INTERVAL CAST({months} AS SIGNED) MONTH))"
        return f"CAST(date_trunc('month', CAST({when} AS date) + make_interval(months => CAST({months} AS int) + 1)) - make_interval(days => 1) AS date)"
    if fn == "DATE":
        if dialect == "clickhouse":
            return f"makeDate(toInt32({a[0]}), toInt32({a[1]}), toInt32({a[2]}))"
        if dialect == "mysql":
            return f"DATE_ADD(DATE_ADD(MAKEDATE(CAST({a[0]} AS SIGNED), 1), INTERVAL CAST({a[1]} AS SIGNED) - 1 MONTH), INTERVAL CAST({a[2]} AS SIGNED) - 1 DAY)"
        return f"make_date(CAST({a[0]} AS int), CAST({a[1]} AS int), CAST({a[2]} AS int))"
    if fn == "NOW":
        return "now()" if dialect != "mysql" else "NOW()"
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
