"""Report parameters: questions a report asks before it runs ("Which store?", "Which dates?"), each answered into one filter rule.
The viewer calls them Report Filters. Saved in the definition as `parameters`, up to eight:

    {"key": "store", "label": "Store", "field": "store_name", "operator": "in", "required": true, "default": null}

"period" asks a span of the time field: a preset (7d, 15d, 30d, quarter, half, year: the last 7, 15 or 30 days, 3, 6 or 12 months)
answered as the last that many days, or a custom [from, to] answered as those days (apps/insights/report_filters.py asks it on every
report with a time field, 7 days by default).

A default may be {"latest": true} on a dataset with a time field: a text or number parameter then takes the value of the newest row
(the latest campaign sent), a date parameter the day of the newest row with the other answers applied (that campaign's last send);
apps/insights/runner.py looks them up. A date range asked with "between" may be answered with one day as [day, day].

The viewer, the editor's preview and the exports send the answers as `params` ({"store": ["Downtown"]}, in the body, or as JSON in
the address of a file). A report run by itself (a dashboard tile, a schedule, an alert, an embed) uses the defaults, and a
parameter with no default and no answer leaves its rule out. Only the viewer insists on a required answer (`require`).

    POST /insights/parameters/values/     {dataset, field, q?, offset?, limit?} -> the field's values to choose from, the person's rows only

A page of values, A to Z: `limit` of them (VALUES unless asked, at most MAX_VALUES_PAGE) from `offset`, `more` when there are
others after them. `q` keeps the text values that contain it, any case, so a long list (thousands of customers) is searched
whole rather than only the page in the menu.
"""
import re

from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

MAX_PARAMETERS = 8
OPERATORS = ("=", "in", ">=", "<=", "between", "last_days", "period")
PERIODS = {"7d": 7, "15d": 15, "30d": 30, "quarter": 91, "half": 182, "year": 365}
KEY = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
VALUES = 200
MAX_VALUES_PAGE = 500
MAX_SEARCH = 100
CHOOSABLE = ("string", "number", "boolean")
LATEST = {"latest": True}


def period_allowed(field: dict) -> bool:
    """a period is a span of a date or a date and time that can be asked as the last days and as a range"""
    return field["type"] in ("date", "datetime") and "last_days" in field["operators"] and "between" in field["operators"]


def period_value(value, where: str):
    """a preset key, or [from, to] as two dates in order; DefinitionError otherwise"""
    from datetime import date
    from .definition import DefinitionError
    if isinstance(value, str) and value in PERIODS:
        return value
    if isinstance(value, (list, tuple)) and len(value) == 2:
        try:
            start, end = date.fromisoformat(str(value[0])[:10]), date.fromisoformat(str(value[1])[:10])
        except ValueError:
            raise DefinitionError(where, "Give two dates like 2026-09-01.") from None
        if start > end:
            raise DefinitionError(where, "The first date comes before the second.")
        return [start.isoformat(), end.isoformat()]
    raise DefinitionError(where, f"Give one of {', '.join(PERIODS)}, or two dates.")


def period_rule(field_key: str, value) -> dict:
    """the filter rule a period answers to: the last so many days, or the days from one date to another"""
    if isinstance(value, str):
        return {"field": field_key, "operator": "last_days", "value": PERIODS[value]}
    return {"field": field_key, "operator": "between", "value": list(value)}


def is_latest(value) -> bool:
    return isinstance(value, dict) and value.get("latest") is True


def latest_allowed(dataset: dict, field: dict, operator: str) -> bool:
    """the newest value can be a default: the dataset says which field orders its rows, and the parameter picks a value or a day"""
    if not dataset.get("time_field"):
        return False
    if field["type"] in ("date", "datetime"):
        return operator in ("=", "between")
    return field["type"] in ("string", "number") and operator in ("=", "in")


class ParameterError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


def check(dataset: dict, raw) -> list[dict]:
    """the definition's parameters, normalised, or DefinitionError (raised by the caller) naming the one at fault"""
    from .definition import DefinitionError, _check_value, _field_of
    if raw in (None, []):
        return []
    if not isinstance(raw, list) or len(raw) > MAX_PARAMETERS:
        raise DefinitionError("parameters", f"A report asks up to {MAX_PARAMETERS} questions.")
    out, keys, fields = [], set(), set()
    for i, item in enumerate(raw):
        at = f"parameters[{i}]"
        if not isinstance(item, dict):
            raise DefinitionError(at, "A parameter names a field and how it filters.")
        key = item.get("key")
        if not isinstance(key, str) or not KEY.match(key):
            raise DefinitionError(f"{at}.key", "A key is lower-case letters, digits and _, starting with a letter.")
        if key in keys:
            raise DefinitionError(f"{at}.key", "Each parameter has its own key.")
        keys.add(key)
        field = _field_of(dataset, item.get("field"), f"{at}.field")
        if field["key"] in fields:
            raise DefinitionError(f"{at}.field", f"{field['label']} already has a parameter.")
        fields.add(field["key"])
        operator = item.get("operator", "=")
        if operator == "period" and not period_allowed(field):
            raise DefinitionError(f"{at}.operator", f"{field['label']} cannot be asked as a period: it needs a date that takes the last days and a range.")
        if operator != "period" and (operator not in OPERATORS or operator not in field["operators"]):
            usable = [o for o in OPERATORS if o in field["operators"]]
            raise DefinitionError(f"{at}.operator", f"{field['label']} can be asked with {', '.join(usable)}." if usable else f"{field['label']} cannot be a parameter.")
        label = item.get("label") if item.get("label") not in (None, "") else field["label"]
        if not isinstance(label, str) or len(label) > 60:
            raise DefinitionError(f"{at}.label", "A label is text of up to 60 characters.")
        required = item.get("required", False)
        if not isinstance(required, bool):
            raise DefinitionError(f"{at}.required", "Required is on or off.")
        default = item.get("default")
        if operator == "period":
            default = period_value(default, f"{at}.default") if default not in (None, "", []) else None
        elif is_latest(default):
            if not latest_allowed(dataset, field, operator):
                raise DefinitionError(f"{at}.default", f"{field['label']} cannot default to the latest: that needs a dataset with a time field, and a value or a date to pick.")
            default = dict(LATEST)
        elif default not in (None, "", []):
            default = _check_value(field, operator, default, f"{at}.default")
        else:
            default = None
        out.append({"key": key, "label": label.strip() or field["label"], "field": field["key"], "operator": operator, "required": required,
                    **({"default": default} if default is not None else {})})
    return out


def _answered(value) -> bool:
    return value not in (None, "", []) and not (isinstance(value, list) and all(v in (None, "") for v in value))


def require(definition: dict, values: dict | None) -> None:
    """the viewer's check: every required parameter has an answer or a default"""
    for parameter in definition.get("parameters", []):
        if parameter["required"] and not _answered((values or {}).get(parameter["key"])) and parameter.get("default") is None:
            raise ParameterError(parameter["key"], f"Choose {parameter['label']} first.")


def bind(dataset: dict, definition: dict, values: dict | None) -> dict:
    """the definition with each parameter's answer (else its default) and-ed onto its filters as one rule; `params` keeps the
    answers used, so the result cache tells them apart"""
    from .definition import DefinitionError, _check_value
    asked = definition.get("parameters") or []
    if not asked:
        return definition
    values = values if isinstance(values, dict) else {}
    fields = {f["key"]: f for f in dataset["fields"]}
    rules, used = [], {}
    for parameter in asked:
        field = fields.get(parameter["field"])
        if field is None:
            continue
        value = values.get(parameter["key"]) if _answered(values.get(parameter["key"])) else parameter.get("default")
        if value is None or is_latest(value):                            # the latest not looked up (no rows yet): no rule
            continue
        if parameter["operator"] == "period":
            try:
                value = period_value(value, parameter["key"])
            except DefinitionError as exc:
                raise ParameterError(parameter["key"], f"{parameter['label']}: {exc}") from None
            rules.append(period_rule(field["key"], value))
            used[parameter["key"]] = value
            continue
        if parameter["operator"] == "in" and not isinstance(value, list):
            value = [value]
        try:
            value = _check_value(field, parameter["operator"], value, parameter["key"])
        except DefinitionError as exc:
            raise ParameterError(parameter["key"], f"{parameter['label']}: {exc}") from None
        rules.append({"field": field["key"], "operator": parameter["operator"], "value": value})
        used[parameter["key"]] = value
    if not rules:
        return definition
    filters = definition.get("filters") or {"combinator": "and", "rules": []}
    if filters.get("combinator", "and") == "and":
        combined = {**filters, "rules": [*filters.get("rules", []), *rules]}
    else:
        combined = {"combinator": "and", "rules": [filters, *rules]}
    return {**definition, "filters": combined, "_params": used}


def from_request(request) -> dict:
    """the answers: `params` in a POST body, or JSON in the address (?params={...}) of a file"""
    import json
    raw = None
    if request.method == "GET":
        text = request.query_params.get("params")
        if text:
            try:
                raw = json.loads(text)
            except ValueError:
                raise ValidationError({"params": "The answers are JSON, like {\"store\": [\"Downtown\"]}."}) from None
    elif isinstance(request.data, dict):
        raw = request.data.get("params")
    if raw in (None, ""):
        return {}
    if not isinstance(raw, dict) or len(raw) > MAX_PARAMETERS:
        raise ValidationError({"params": "The answers are an object, one per parameter."})
    return raw


def words(definition: dict) -> list[dict]:
    """what the parameters were answered with, for the note above the rows and the first page of a file; latest: the default's
    newest value was used"""
    used = definition.get("_params") or {}
    latest = set(definition.get("_latest") or [])
    return [{"key": p["key"], "label": p["label"], "value": used[p["key"]], **({"latest": True} if p["key"] in latest else {})}
            for p in definition.get("parameters", []) if p["key"] in used]


class ParameterValuesView(APIView):
    """The values a parameter offers: the field's distinct values, read with the person's own row access."""
    def get_permissions(self):
        from .api import VIEW
        return [permission() for permission in VIEW]

    @extend_schema(responses={200: None})
    def post(self, request, version=None):
        from . import catalog, runner
        from .api import _can_see_pii, _tenant
        from .definition import DefinitionError, validate
        tenant = _tenant()
        body = request.data if isinstance(request.data, dict) else {}
        dataset = catalog.dataset(tenant.pk, str(body.get("dataset") or ""), _can_see_pii(request))
        if dataset is None:
            raise NotFound("No such dataset.")
        key = str(body.get("field") or "")
        field = next((f for f in dataset["fields"] if f["key"] == key), None)
        if field is None or field["type"] not in CHOOSABLE or field["role"] != "dimension":
            return Response({"field": key, "values": [], "choosable": False})
        page, offset, search = _page(body)
        measure = next((f for f in dataset["fields"] if f["role"] == "measure" and f["aggregates"]), None)
        rules = [{"field": key, "operator": "is_not_null"}]
        if search and field["type"] == "string":
            rules.append({"field": key, "operator": "contains", "value": search})
        # one row past the page says whether there are more
        raw = {"columns": [{"field": key}, *([{"field": measure["key"], "aggregate": measure["aggregates"][0]}] if measure else [])],
               "filters": {"combinator": "and", "rules": rules}, "orderBy": [{"field": key, "direction": "asc"}], "limit": offset + page + 1}
        try:
            result = runner.run(tenant, request.user, dataset, validate(dataset, raw), "run", limit=page + 1, offset=offset, mask_pii=not _can_see_pii(request))
        except DefinitionError:
            return Response({"field": key, "values": [], "choosable": False})
        except runner.RunRefused as exc:
            return Response({"type": "about:blank", "title": "The values could not be read", "status": 422, "detail": exc.reason}, status=422)
        values = list(dict.fromkeys(r[0] for r in result["rows"] if r[0] is not None))
        return Response({"field": key, "label": field["label"], "values": values[:page], "choosable": True, "more": len(values) > page,
                         "offset": offset, "limit": page, "q": search})


def _page(body: dict) -> tuple[int, int, str]:
    """how many values, from where, containing what: VALUES from the first unless asked otherwise"""
    try:
        page = int(body.get("limit") or VALUES)
        offset = int(body.get("offset") or 0)
    except (TypeError, ValueError):
        raise ValidationError({"limit": "Give the limit and offset as whole numbers."})
    if not 1 <= page <= MAX_VALUES_PAGE or offset < 0:
        raise ValidationError({"limit": f"Ask for 1 to {MAX_VALUES_PAGE} values from an offset of 0 or more."})
    search = str(body.get("q") or "").strip()[:MAX_SEARCH]
    return page, offset, search
