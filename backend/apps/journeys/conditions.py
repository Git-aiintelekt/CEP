"""Conditions: one rule, read in three places — a Condition step (Yes / No), an entry rule's "Only Customers Where"
filters, and the Customer Attribute Matches trigger ({change_trigger: ATTRIBUTE_MATCH, rule}). A rule is a group:

    {"all": true, "conditions": [condition | group, ...]}          all: every condition must hold; false: any one

and a condition names a field, an operator and (usually) a value:

    {"field": "customer:country",   "op": "is",        "value": "US"}
    {"field": "attr:loyalty_tier",  "op": "in",        "value": ["GOLD", "PLATINUM"]}
    {"field": "attr:renewal_date",  "op": "older_than_days", "value": 90}
    {"field": "message:welcome-3",  "op": "delivered_not_opened"}        this journey's message step (node key, or * for any)
    {"field": "step:cond-1",        "op": "yes"}                         a prior Condition step's answer
    {"field": "event:PURCHASE",     "op": "happened", "days": 30, "props": [{"key": "store", "op": "is", "value": "Lakeside"}]}
    {"field": "list:<uuid>",        "op": "in"}       {"field": "segment:<uuid>", "op": "not_in"}

Field kinds and their operators are in OPERATORS. `customer:` fields are the standard columns of customer_master
(CUSTOMER_FIELDS); `attr:` fields are custom_attributes keys, read as text, number or date by the operator chosen.
`message:` and `step:` fields need a journey around the customer, so entry filters and the attribute trigger refuse them.

Everything compiles to one SQL predicate over `cm` (customer_master) and, inside a journey, `e` (journey_enrollment),
so the same rule enrols, filters and branches without a second evaluator. An event without a number of days looks back
to when the customer entered the journey; at entry, to the beginning.
"""
import re
import uuid

from django.core.cache import cache

from apps.delivery.engine import session

from . import events

MAX_CONDITIONS = 20
MAX_DEPTH = 2                                             # the rule itself, and one group inside it
MAX_VALUES = 50
MAX_TEXT = 200
MAX_DAYS = 3650
ATTRIBUTE_MATCH = "ATTRIBUTE_MATCH"
NODE_KEY = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
ATTRIBUTE_KEY = re.compile(r"^[A-Za-z0-9_ .-]{1,100}$")
PROPERTY_KEY = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
DATE_TEXT = r"^\d{4}-\d{2}-\d{2}"
NUMBER_TEXT = r"^-?\d+(\.\d+)?$"

OPERATORS = {
    "text": ("is", "is_not", "in", "not_in", "contains", "not_contains", "starts_with", "is_set", "is_not_set"),
    "number": ("eq", "neq", "gte", "lte", "between", "is_set", "is_not_set"),
    "date": ("before", "after", "between_dates", "within_days", "older_than_days", "is_set", "is_not_set"),
    "message": ("sent", "delivered", "opened", "clicked", "bounced", "delivered_not_opened", "not_sent"),
    "step": ("yes", "no"),
    "event": ("happened", "not_happened"),
    "membership": ("in", "not_in"),
    "goal": ("reached", "not_reached"),
}
NO_VALUE = {"is_set", "is_not_set"}
VALUELESS_KINDS = {"message", "step", "event", "list", "segment", "goal"}                                # their operators carry no value
LIST_VALUE = {"in", "not_in", "between", "between_dates"}
NUMBER_OPS = set(OPERATORS["number"]) - {"is_set", "is_not_set"}
DATE_OPS = set(OPERATORS["date"]) - {"is_set", "is_not_set"}
DAYS_OPS = {"within_days", "older_than_days"}

# the standard fields: key -> (label, type, SQL over cm)
PURCHASES = "(SELECT {what} FROM journey_event je WHERE je.tenant_id = cm.tenant_id AND je.party_id = cm.party_id AND je.event_type = 'PURCHASE')"
CUSTOMER_FIELDS = {
    "first_name": ("First Name", "text", "cm.first_name"),
    "last_name": ("Last Name", "text", "cm.last_name"),
    "email": ("Email Address", "text", "(cm.emails -> 0 ->> 'address')"),
    "phone": ("Phone Number", "text", "(cm.phones -> 0 ->> 'number')"),
    "country": ("Country", "text", "(cm.primary_address ->> 'country')"),
    "state": ("State or Region", "text", "(cm.primary_address ->> 'state')"),
    "city": ("City", "text", "(cm.primary_address ->> 'city')"),
    "postal_code": ("Postal Code", "text", "(cm.primary_address ->> 'postal_code')"),
    "source_system": ("Source System", "text", "cm.source_system"),
    "synced_at": ("Record Updated", "date", "cm.synced_at"),
    "last_purchase_at": ("Last Purchase Date", "date", PURCHASES.format(what="max(je.occurred_at)")),
    "purchase_count": ("Number of Purchases", "number", PURCHASES.format(what="count(*)")),
}


class RuleError(ValueError):
    """The rule cannot be read; the message says why, in words a user can act on."""


# ---------------------------------------------------------------------------------------------------- reading a rule
def field_kind(field: str) -> tuple[str, str] | None:
    """("customer" | "attr" | "message" | "step" | "event" | "list" | "segment", the rest), or None for an unknown field."""
    prefix, _, rest = str(field or "").partition(":")
    if prefix in ("customer", "attr", "message", "step", "event", "list", "segment", "goal") and rest:
        return prefix, rest
    return None


def _operators(prefix: str, rest: str) -> tuple[str, ...]:
    if prefix == "customer":
        found = CUSTOMER_FIELDS.get(rest)
        return OPERATORS[found[1]] if found else ()
    if prefix == "attr":
        return OPERATORS["text"] + OPERATORS["number"] + OPERATORS["date"]
    if prefix in ("list", "segment"):
        return OPERATORS["membership"]
    return OPERATORS[prefix]


def _days(value) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value or not 1 <= int(value) <= MAX_DAYS:
        raise RuleError(f"A number of days is a whole number from 1 to {MAX_DAYS}.")
    return int(value)


def _number(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RuleError("The value must be a number.")
    return float(value)


def _date(value) -> str:
    if not isinstance(value, str) or not re.match(DATE_TEXT + "$", value.strip()):
        raise RuleError("The value must be a date, written YYYY-MM-DD.")
    return value.strip()


def _text(value) -> str:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise RuleError("The value must be text.")
    text = str(value).strip()
    if not text or len(text) > MAX_TEXT:
        raise RuleError(f"The value is text of 1 to {MAX_TEXT} characters.")
    return text


def _values(value, one) -> list:
    if not isinstance(value, list) or not value or len(value) > MAX_VALUES:
        raise RuleError(f"Give a list of 1 to {MAX_VALUES} values.")
    return [one(item) for item in value]


def _clean_condition(raw: dict, in_journey: bool) -> dict:
    kind = field_kind(raw.get("field"))
    if kind is None:
        raise RuleError("Choose a field.")
    prefix, rest = kind
    if prefix in ("message", "step", "goal") and not in_journey:
        raise RuleError("Fields about this journey's messages and steps can only be checked inside the journey, not at entry.")
    if prefix == "customer" and rest not in CUSTOMER_FIELDS:
        raise RuleError(f"There is no customer field '{rest}'.")
    if prefix == "attr" and not ATTRIBUTE_KEY.match(rest):
        raise RuleError("The custom attribute's name is letters, digits, spaces, dots, dashes and underscores.")
    if prefix in ("message", "step") and rest != "*" and not NODE_KEY.match(rest):
        raise RuleError("The step is named by its key.")
    if prefix == "step" and rest == "*":
        raise RuleError("Name which Condition step to look at.")
    if prefix == "event" and not events.TYPE.match(rest):
        raise RuleError("An event type is capital letters, digits and underscores, starting with a letter.")
    if prefix in ("list", "segment"):
        try:
            rest = str(uuid.UUID(rest))
        except ValueError:
            raise RuleError("Choose which list or segment.") from None
    op = str(raw.get("op") or "")
    if op not in _operators(prefix, rest):
        raise RuleError(f"'{op or 'no operator'}' cannot be used with this field.")
    condition = {"field": f"{prefix}:{rest}", "op": op}
    if op in DAYS_OPS:
        condition["value"] = _days(raw.get("value"))
    elif op not in NO_VALUE and prefix not in VALUELESS_KINDS:
        value = raw.get("value")
        kind_of_value = CUSTOMER_FIELDS[rest][1] if prefix == "customer" else "number" if op in NUMBER_OPS else "date" if op in DATE_OPS else "text"
        one = {"number": _number, "date": _date, "text": _text}[kind_of_value]
        if op in LIST_VALUE:
            values = _values(value, one)
            if op in ("between", "between_dates") and len(values) != 2:
                raise RuleError("Between needs two values: from and to.")
            condition["value"] = values
        else:
            condition["value"] = one(value)
    if prefix == "event":
        if raw.get("days") not in (None, ""):
            condition["days"] = _days(raw.get("days"))
        props = raw.get("props") or []
        if not isinstance(props, list) or len(props) > 10:
            raise RuleError("An event can be filtered on at most 10 of its properties.")
        condition["props"] = []
        for prop in props:
            prop = prop if isinstance(prop, dict) else {}
            key = str(prop.get("key") or "").strip()
            if not PROPERTY_KEY.match(key):
                raise RuleError("Name the event property to filter on.")
            prop_op = str(prop.get("op") or "")
            if prop_op not in OPERATORS["text"] + OPERATORS["number"]:
                raise RuleError(f"'{prop_op or 'no operator'}' cannot be used with an event property.")
            cleaned = {"key": key, "op": prop_op}
            if prop_op not in NO_VALUE:
                one = _number if prop_op in NUMBER_OPS else _text
                cleaned["value"] = _values(prop.get("value"), one) if prop_op in LIST_VALUE else one(prop.get("value"))
                if prop_op == "between" and len(cleaned["value"]) != 2:
                    raise RuleError("Between needs two values: from and to.")
            condition["props"].append(cleaned)
    return condition


def clean(rule, *, in_journey: bool, depth: int = 1, counter: list | None = None) -> dict:
    """The rule in canonical form, or a RuleError. Empty groups are allowed while a rule is being written; `is_complete`
    says whether there is anything to evaluate."""
    counter = counter if counter is not None else [0]
    if not isinstance(rule, dict):
        raise RuleError("A rule is an object with all and conditions.")
    if depth > MAX_DEPTH:
        raise RuleError("A group cannot hold another group.")
    conditions = rule.get("conditions", [])
    if not isinstance(conditions, list):
        raise RuleError("conditions must be a list.")
    cleaned = []
    for raw in conditions:
        if not isinstance(raw, dict):
            raise RuleError("Each condition is an object.")
        if "conditions" in raw:
            cleaned.append(clean(raw, in_journey=in_journey, depth=depth + 1, counter=counter))
            continue
        counter[0] += 1
        if counter[0] > MAX_CONDITIONS:
            raise RuleError(f"A rule holds at most {MAX_CONDITIONS} conditions.")
        cleaned.append(_clean_condition(raw, in_journey))
    return {"all": rule.get("all", True) is not False, "conditions": cleaned}


def problem(rule, *, in_journey: bool) -> str | None:
    try:
        clean(rule, in_journey=in_journey)
    except RuleError as error:
        return str(error)
    return None


def is_complete(rule) -> bool:
    """At least one condition, and nothing wrong with the rule."""
    if not isinstance(rule, dict):
        return False
    try:
        cleaned = clean(rule, in_journey=True)
    except RuleError:
        return False
    return count_conditions(cleaned) > 0


def count_conditions(rule: dict) -> int:
    return sum(count_conditions(item) if "conditions" in item else 1 for item in rule.get("conditions") or [])


def references(rule) -> list[tuple[str, str]]:
    """The (kind, node key) pairs a rule names: ("message", "welcome-3"), ("step", "cond-1"). For graph.clean to check."""
    found = []
    for item in (rule.get("conditions") if isinstance(rule, dict) else None) or []:
        if not isinstance(item, dict):
            continue
        if "conditions" in item:
            found.extend(references(item))
            continue
        kind = field_kind(item.get("field"))
        if kind and kind[0] in ("message", "step"):
            found.append(kind)
    return found


# ---------------------------------------------------------------------------------------------------- SQL
class _Params:
    def __init__(self, args: dict, prefix: str):
        self.args, self.prefix, self.n = args, prefix, 0

    def add(self, value) -> str:
        self.n += 1
        name = f"{self.prefix}{self.n}"
        self.args[name] = value
        return f"%({name})s"


def _like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _text_predicate(expr: str, op: str, value, p: _Params) -> str:
    if op == "is_set":
        return f"({expr} IS NOT NULL AND {expr} <> '')"
    if op == "is_not_set":
        return f"({expr} IS NULL OR {expr} = '')"
    if op == "is":
        return f"lower({expr}) = lower({p.add(value)})"
    if op == "is_not":
        return f"(lower({expr}) IS DISTINCT FROM lower({p.add(value)}))"
    if op == "in":
        return f"lower({expr}) = ANY({p.add([str(v).lower() for v in value])})"
    if op == "not_in":
        return f"(lower({expr}) IS NULL OR NOT lower({expr}) = ANY({p.add([str(v).lower() for v in value])}))"
    if op == "contains":
        return f"{expr} ILIKE {p.add('%' + _like(value) + '%')}"
    if op == "not_contains":
        return f"({expr} IS NULL OR {expr} NOT ILIKE {p.add('%' + _like(value) + '%')})"
    if op == "starts_with":
        return f"{expr} ILIKE {p.add(_like(value) + '%')}"
    raise RuleError(f"Unknown operator '{op}'.")


def _number_predicate(expr: str, op: str, value, p: _Params) -> str:
    if op == "is_set":
        return f"{expr} IS NOT NULL"
    if op == "is_not_set":
        return f"{expr} IS NULL"
    if op == "between":
        return f"{expr} BETWEEN {p.add(value[0])} AND {p.add(value[1])}"
    sign = {"eq": "=", "neq": "<>", "gte": ">=", "lte": "<="}[op]
    if op == "neq":
        return f"({expr} IS NULL OR {expr} <> {p.add(value)})"
    return f"{expr} {sign} {p.add(value)}"


def _date_predicate(expr: str, op: str, value, p: _Params) -> str:
    if op == "is_set":
        return f"{expr} IS NOT NULL"
    if op == "is_not_set":
        return f"{expr} IS NULL"
    if op == "before":
        return f"{expr} < {p.add(value)}::date"
    if op == "after":
        return f"{expr} >= ({p.add(value)}::date + 1)"
    if op == "between_dates":
        return f"({expr} >= {p.add(value[0])}::date AND {expr} < ({p.add(value[1])}::date + 1))"
    if op == "within_days":
        return f"{expr} >= now() - make_interval(days => {p.add(value)})"
    if op == "older_than_days":
        return f"{expr} < now() - make_interval(days => {p.add(value)})"
    raise RuleError(f"Unknown operator '{op}'.")


def _typed(expr: str, kind: str, op: str, value, p: _Params) -> str:
    if kind == "number":
        return _number_predicate(expr, op, value, p)
    if kind == "date":
        return _date_predicate(expr, op, value, p)
    return _text_predicate(expr, op, value, p)


def _attribute(key: str, op: str, value, p: _Params) -> str:
    raw = f"(cm.custom_attributes ->> {p.add(key)})"
    if op in NUMBER_OPS:
        return _number_predicate(f"(CASE WHEN {raw} ~ '{NUMBER_TEXT}' THEN {raw}::numeric END)", op, value, p)
    if op in DATE_OPS:
        return _date_predicate(f"(CASE WHEN {raw} ~ '{DATE_TEXT}' THEN left({raw}, 10)::date END)", op, value, p)
    return _text_predicate(raw, op, value, p)


MAIL_SENT = "(x.submitted_at IS NOT NULL OR x.status IN ('SUBMITTED', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED'))"
MAIL_DELIVERED = "(x.delivered_at IS NOT NULL OR x.status IN ('DELIVERED', 'OPENED', 'CLICKED'))"
MAIL_OPENED = "(x.opened_at IS NOT NULL OR x.status IN ('OPENED', 'CLICKED'))"
MAIL = {
    "sent": MAIL_SENT, "delivered": MAIL_DELIVERED, "opened": MAIL_OPENED,
    "clicked": "(x.clicked_at IS NOT NULL OR x.status = 'CLICKED')",
    "bounced": "(x.bounced_at IS NOT NULL OR x.status = 'BOUNCED')",
    "delivered_not_opened": f"({MAIL_DELIVERED} AND NOT {MAIL_OPENED})",
}
SMS_SENT = "(x.submitted_at IS NOT NULL OR x.status IN ('SUBMITTED', 'DELIVERED', 'RESPONDED'))"
SMS_DELIVERED = "(x.delivered_at IS NOT NULL OR x.status IN ('DELIVERED', 'RESPONDED'))"
SMS = {"sent": SMS_SENT, "delivered": SMS_DELIVERED, "delivered_not_opened": SMS_DELIVERED, "bounced": "x.status = 'FAILED'"}
MESSAGE_ROWS = """EXISTS (SELECT 1 FROM {table} x
          JOIN journey_generated_campaign g ON g.tenant_id = x.tenant_id AND g.campaign_id = x.campaign_id
          JOIN journey_node n ON n.id = g.journey_node_id
         WHERE x.tenant_id = e.tenant_id AND x.party_id = e.party_id AND g.journey_id = e.journey_id
           AND ({any} OR n.node_key = {key}) AND x.created_at >= e.enrolled_at - interval '1 day' AND {test})"""


def _message(key: str, op: str, p: _Params) -> str:
    """This journey's message step(s) for the enrolled customer: every send after they entered (a day's grace for a
    run prepared just before)."""
    any_step, node_key = p.add(key == "*"), p.add(key)
    wanted = "sent" if op == "not_sent" else op
    parts = [MESSAGE_ROWS.format(table="mailer_execution", any=any_step, key=node_key, test=MAIL[wanted])]
    if wanted in SMS:
        parts.append(MESSAGE_ROWS.format(table="sms_execution", any=any_step, key=node_key, test=SMS[wanted]))
    inner = " OR ".join(parts)
    return f"NOT ({inner})" if op == "not_sent" else f"({inner})"


def _step(key: str, op: str, p: _Params) -> str:
    return f"""EXISTS (SELECT 1 FROM journey_node_execution x JOIN journey_node n ON n.id = x.journey_node_id
             WHERE x.tenant_id = e.tenant_id AND x.journey_enrollment_id = e.id AND n.node_key = {p.add(key)}
               AND x.result_data ->> 'met' = {p.add('true' if op == 'yes' else 'false')})"""


def _event(event_type: str, condition: dict, p: _Params, in_journey: bool) -> str:
    where = [f"je.tenant_id = cm.tenant_id", "je.party_id = cm.party_id", f"je.event_type = {p.add(event_type)}"]
    if condition.get("days"):
        where.append(f"je.occurred_at >= now() - make_interval(days => {p.add(int(condition['days']))})")
    elif in_journey:
        where.append("je.occurred_at >= e.enrolled_at")
    for prop in condition.get("props") or []:
        raw = f"(je.event_payload ->> {p.add(prop['key'])})"
        if prop["op"] in NUMBER_OPS:
            where.append(_number_predicate(f"(CASE WHEN {raw} ~ '{NUMBER_TEXT}' THEN {raw}::numeric END)", prop["op"], prop.get("value"), p))
        else:
            where.append(_text_predicate(raw, prop["op"], prop.get("value"), p))
    inner = f"EXISTS (SELECT 1 FROM journey_event je WHERE {' AND '.join(where)})"
    return f"NOT {inner}" if condition["op"] == "not_happened" else inner


def _membership(prefix: str, target: str, op: str, p: _Params) -> str:
    if prefix == "list":
        inner = f"EXISTS (SELECT 1 FROM contact_list_member m WHERE m.tenant_id = cm.tenant_id AND m.party_id = cm.party_id AND m.contact_list_id = {p.add(target)}::uuid)"
    else:
        inner = f"EXISTS (SELECT 1 FROM customer_segment_membership m WHERE m.tenant_id = cm.tenant_id AND m.party_id = cm.party_id AND m.segment_id = {p.add(target)}::uuid)"
    return f"NOT {inner}" if op == "not_in" else inner


def _predicate(condition: dict, p: _Params, in_journey: bool) -> str:
    prefix, rest = field_kind(condition["field"])
    op, value = condition["op"], condition.get("value")
    if prefix == "customer":
        _label, kind, expr = CUSTOMER_FIELDS[rest]
        return _typed(expr, kind, op, value, p)
    if prefix == "attr":
        return _attribute(rest, op, value, p)
    if prefix == "message":
        return _message(rest, op, p)
    if prefix == "step":
        return _step(rest, op, p)
    if prefix == "goal":
        return "e.converted_at IS NOT NULL" if op == "reached" else "e.converted_at IS NULL"
    if prefix == "event":
        return _event(rest, condition, p, in_journey)
    return _membership(prefix, rest, op, p)


def _group(rule: dict, p: _Params, in_journey: bool) -> str:
    parts = [_group(item, p, in_journey) if "conditions" in item else _predicate(item, p, in_journey) for item in rule["conditions"]]
    parts = [part for part in parts if part]
    if not parts:
        return ""
    return "(" + (" AND " if rule["all"] else " OR ").join(parts) + ")"


def compile_where(rule, args: dict, *, in_journey: bool, prefix: str = "c") -> str | None:
    """The rule as a SQL predicate over cm (and e inside a journey), its parameters added to `args`; None when the rule
    cannot be read or has no conditions. SQL is built from fixed fragments only: every user value is a parameter."""
    try:
        cleaned = clean(rule, in_journey=in_journey)
    except RuleError:
        return None
    where = _group(cleaned, _Params(args, prefix), in_journey)
    return where or None


# ---------------------------------------------------------------------------------------------------- evaluating
IN_JOURNEY = """FROM journey_enrollment e JOIN customer_master cm ON cm.tenant_id = e.tenant_id AND cm.party_id = e.party_id"""


def evaluate(rule, enrollment) -> bool:
    """Does the rule hold for this enrolled customer right now? A RuleError when the rule cannot be read."""
    args = {"enrollment": str(enrollment.pk)}
    where = compile_where(rule, args, in_journey=True)
    if where is None:
        raise RuleError(problem(rule, in_journey=True) or "The condition has nothing to check.")
    with session.connection().cursor() as cursor:
        cursor.execute(f"SELECT EXISTS (SELECT 1 {IN_JOURNEY} WHERE e.id = %(enrollment)s AND {where})", args)
        return bool(cursor.fetchone()[0])


COUNT_SAMPLE = 10000


def count_in_journey(tenant_id, journey_id, rule) -> dict:
    """{matching, total, sampled}: of the customers in the journey now (the newest COUNT_SAMPLE active enrollments), how
    many the rule holds for."""
    args = {"tenant": str(tenant_id), "journey": str(journey_id), "limit": COUNT_SAMPLE}
    where = compile_where(rule, args, in_journey=True)
    if where is None:
        raise RuleError(problem(rule, in_journey=True) or "The condition has nothing to check.")
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(f"""SELECT count(*) FILTER (WHERE {where}), count(*)
                             FROM (SELECT * FROM journey_enrollment WHERE tenant_id = %(tenant)s AND journey_id = %(journey)s AND status = 'ACTIVE'
                                   ORDER BY enrolled_at DESC LIMIT %(limit)s) e
                             JOIN customer_master cm ON cm.tenant_id = e.tenant_id AND cm.party_id = e.party_id""", args)
        matching, total = cursor.fetchone()
    return {"matching": matching, "total": total, "sampled": total >= COUNT_SAMPLE}


def count_customers(tenant_id, rule, filters=None) -> dict:
    """{matching, total}: of the workspace's customers, how many the rule (and the filters, when given) hold for now: the
    attribute trigger's and the entry filters' "would enter now"."""
    args = {"tenant": str(tenant_id)}
    parts = []
    for name, part, prefix in (("rule", rule, "c"), ("filters", filters, "f")):
        if part is None:
            continue
        where = compile_where(part, args, in_journey=False, prefix=prefix)
        if where is None:
            raise RuleError(problem(part, in_journey=False) or f"The {name} have nothing to check.")
        parts.append(where)
    if not parts:
        raise RuleError("The rule has nothing to check.")
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(f"SELECT count(*) FILTER (WHERE {' AND '.join(parts)}), count(*) FROM customer_master cm WHERE cm.tenant_id = %(tenant)s", args)
        matching, total = cursor.fetchone()
    return {"matching": matching, "total": total, "sampled": False}


# ---------------------------------------------------------------------------------------------------- the field catalogue
ATTRIBUTES_SQL = """
SELECT e.key, count(*), count(*) FILTER (WHERE e.value ~ %(date)s), count(*) FILTER (WHERE e.value ~ %(number)s), count(DISTINCT e.value)
  FROM customer_master cm, jsonb_each_text(cm.custom_attributes) AS e(key, value)
 WHERE cm.tenant_id = %(tenant)s AND jsonb_typeof(cm.custom_attributes) = 'object' AND e.value IS NOT NULL AND e.value <> ''
 GROUP BY e.key ORDER BY count(*) DESC, e.key LIMIT 60"""
VALUES_SQL = """
SELECT e.key, e.value, count(*)
  FROM customer_master cm, jsonb_each_text(cm.custom_attributes) AS e(key, value)
 WHERE cm.tenant_id = %(tenant)s AND jsonb_typeof(cm.custom_attributes) = 'object' AND e.key = ANY(%(keys)s) AND e.value <> ''
 GROUP BY e.key, e.value ORDER BY e.key, count(*) DESC, e.value"""
EVENTS_SQL = """
SELECT event_type, count(*) FROM journey_event
 WHERE tenant_id = %(tenant)s AND ingested_at >= now() - interval '90 days'
 GROUP BY event_type ORDER BY count(*) DESC LIMIT 50"""
PROPERTIES_SQL = """
SELECT s.event_type, s.key, count(*)
  FROM (SELECT event_type, jsonb_object_keys(event_payload) AS key
          FROM (SELECT event_type, event_payload FROM journey_event
                 WHERE tenant_id = %(tenant)s AND ingested_at >= now() - interval '90 days' AND jsonb_typeof(event_payload) = 'object'
                 ORDER BY ingested_at DESC LIMIT 20000) recent) s
 GROUP BY s.event_type, s.key ORDER BY s.event_type, count(*) DESC"""
CHOICE_VALUES = 12
CACHE_SECONDS = 600


def attribute_label(key: str) -> str:
    return str(key or "").replace("_", " ").strip().title()


def fields(tenant_id) -> dict:
    """What the builder offers: the standard customer fields, the workspace's custom attributes (with a type guess and the
    values when there are few), the events seen lately (with their property keys), its lists and segments. Cached."""
    key = f"journeys:condition-fields:{tenant_id}"
    found = cache.get(key)
    if found is not None:
        return found
    from apps.contact_lists.models import ContactList
    from apps.customers.models import LoyaltyTier, Segment

    tenant = str(tenant_id)
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(ATTRIBUTES_SQL, {"tenant": tenant, "date": DATE_TEXT, "number": NUMBER_TEXT})
        attributes = []
        for name, total, dates, numbers, distinct in cursor.fetchall():
            kind = "date" if dates == total else "number" if numbers == total else "text"
            attributes.append({"key": f"attr:{name}", "label": attribute_label(name), "type": kind, "customers": total, "values": None,
                               "_distinct": distinct})
        few = [item["key"][5:] for item in attributes if item["type"] == "text" and item["_distinct"] <= CHOICE_VALUES]
        values: dict[str, list] = {}
        if few:
            cursor.execute(VALUES_SQL, {"tenant": tenant, "keys": few})
            for name, value, _count in cursor.fetchall():
                values.setdefault(name, []).append(value)
        tiers = list(LoyaltyTier.objects.filter(tenant_id=tenant_id).order_by("rank", "name").values_list("code", flat=True))
        for item in attributes:
            del item["_distinct"]
            name = item["key"][5:]
            item["values"] = values.get(name)
            if name == "loyalty_tier" and tiers:
                item["values"] = tiers + [code for code in values.get(name, []) if code not in tiers]
        cursor.execute(EVENTS_SQL, {"tenant": tenant})
        seen = {event_type: count for event_type, count in cursor.fetchall()}
        cursor.execute(PROPERTIES_SQL, {"tenant": tenant})
        properties: dict[str, list] = {}
        for event_type, prop, _count in cursor.fetchall():
            if len(properties.setdefault(event_type, [])) < 10:
                properties[event_type].append(prop)
    event_rows = [{"key": f"event:{event_type}", "label": events.label(event_type), "seen": seen.get(event_type, 0), "properties": properties.get(event_type, [])}
                  for event_type in list(seen) + [known for known in events.KNOWN if known not in seen]]
    found = {
        "customer": [{"key": f"customer:{name}", "label": label, "type": kind} for name, (label, kind, _sql) in CUSTOMER_FIELDS.items()],
        "attributes": attributes,
        "events": event_rows,
        "lists": [{"key": f"list:{pk}", "label": name} for pk, name in ContactList.objects.filter(
            tenant_id=tenant_id, deleted_at__isnull=True).order_by("name").values_list("id", "name")],
        "segments": [{"key": f"segment:{pk}", "label": name} for pk, name in Segment.objects.filter(tenant_id=tenant_id).order_by("name").values_list("id", "name")],
    }
    cache.set(key, found, CACHE_SECONDS)
    return found


def describe_entry(rule) -> str:
    """"customers whose record matches 2 conditions": the readiness summary's words for an attribute trigger."""
    n = count_conditions(clean(rule, in_journey=False)) if problem(rule, in_journey=False) is None else 0
    return f"customers whose record matches {n} condition{'' if n == 1 else 's'}" if n else "customers whose record matches (no conditions yet)"
