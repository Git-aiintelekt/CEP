"""The workspace's fiscal year (Settings → Fiscal Year): the month it starts in, and whether a fiscal year is named by the calendar
year it ends in (FY2027 for April 2026 to March 2027) or starts in. Stored in tenant.settings["insights_calendar"].

    GET, PUT /workspace/fiscal-year/      {start: 1-12, named_by: "end" | "start"} (anyone reads; user.admin changes)

The engine reads it three ways: the fiscal_quarter and fiscal_year buckets (the start of the fiscal quarter or year a date is in),
the date filters this_fiscal_year, last_fiscal_year, this_fiscal_quarter and last_fiscal_quarter (turned into a between rule
before the query, `prepare`), and year and quarter to date, which start at the fiscal year's start. A definition that uses
one of them carries the start as `_fiscal`, so the result cache tells workspaces with different years apart.
"""
from datetime import date, timedelta

from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .compare import add_months

SETTINGS_KEY = "insights_calendar"
DEFAULT = {"start": 1, "named_by": "end"}
BUCKETS = ("fiscal_quarter", "fiscal_year")
OPERATORS = ("this_fiscal_year", "last_fiscal_year", "this_fiscal_quarter", "last_fiscal_quarter")
_day = timedelta(days=1)
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")


def settings_of(tenant) -> dict:
    stored = ((getattr(tenant, "settings", None) or {}).get(SETTINGS_KEY)) or {}
    start = stored.get("start") if isinstance(stored.get("start"), int) and 1 <= stored.get("start") <= 12 else 1
    return {"start": start, "named_by": "start" if stored.get("named_by") == "start" else "end"}


def year_start(day: date, start: int) -> date:
    return date(day.year if day.month >= start else day.year - 1, start, 1)


def quarter_start(day: date, start: int) -> date:
    first = year_start(day, start)
    months = (day.month - start) % 12
    return add_months(first, months - months % 3)


def span(operator: str, today: date, start: int) -> tuple[date, date]:
    """the first and last day of this or last fiscal year or quarter"""
    if operator.endswith("year"):
        first = year_start(today, start)
        if operator.startswith("last"):
            first = add_months(first, -12)
        return first, add_months(first, 12) - _day
    first = quarter_start(today, start)
    if operator.startswith("last"):
        first = add_months(first, -3)
    return first, add_months(first, 3) - _day



def uses(definition: dict) -> bool:
    def rules(node) -> bool:
        return any(rules(r) if "rules" in r else r.get("operator") in OPERATORS for r in (node or {}).get("rules", []))
    return any(c.get("bucket") in BUCKETS for c in definition.get("columns", [])) or rules(definition.get("filters"))


def prepare(definition: dict, settings: dict, today: date) -> dict:
    """the definition as the compiler takes it: fiscal period filters turned into dates, and the start carried when it matters"""
    if not uses(definition):
        return definition
    start = settings["start"]

    def resolve(node: dict) -> dict:
        out = []
        for rule in node.get("rules", []):
            if "rules" in rule:
                out.append(resolve(rule))
            elif rule.get("operator") in OPERATORS:
                first, last = span(rule["operator"], today, start)
                out.append({"field": rule["field"], "operator": "between", "value": [first.isoformat(), last.isoformat()]})
            else:
                out.append(rule)
        return {**node, "rules": out}

    filters = definition.get("filters") or {"combinator": "and", "rules": []}
    return {**definition, "filters": resolve(filters), "_fiscal": start}


def prepared(tenant, definition: dict) -> dict:
    """prepare() with the workspace's year and today in its time zone"""
    from django.utils import timezone
    from apps.reporting import reports
    return prepare(definition, settings_of(tenant), timezone.now().astimezone(reports.zone_of(tenant)).date())


def name(day: date, bucket: str, meta: dict | None) -> str:
    """FY2027 for a fiscal year, FY2027 Q1 for its first quarter (named by the year it ends in, unless the workspace says start)"""
    start = int((meta or {}).get("start") or 1)
    first = year_start(day, start)
    year = first.year + (1 if (meta or {}).get("named_by", "end") == "end" and start != 1 else 0)
    if bucket == "fiscal_year":
        return f"FY{year}"
    return f"FY{year} Q{((day.month - start) % 12) // 3 + 1}"


def label_of(settings: dict) -> dict:
    """what a fiscal bucket's column carries so the browser can name it (FY2027 Q1)"""
    return {"start": settings["start"], "named_by": settings["named_by"]}


# ---------------------------------------------------------------------------------------------------- the API
class FiscalYearView(APIView):
    permission_classes = [IsAuthenticated]

    def _tenant(self):
        from .api import _tenant
        return _tenant()

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response({**settings_of(self._tenant()), "months": MONTHS})

    @extend_schema(responses={200: None})
    def put(self, request, version=None):
        from api.permissions import HasPermissionCode
        if not HasPermissionCode.for_("user.admin")().has_permission(request, None):
            raise PermissionDenied("Changing the fiscal year needs the workspace administration right.")
        body = request.data if isinstance(request.data, dict) else {}
        start = body.get("start")
        if isinstance(start, bool) or not isinstance(start, int) or not 1 <= start <= 12:
            raise ValidationError({"start": "A month, 1 (January) to 12 (December)."})
        named_by = body.get("named_by", "end")
        if named_by not in ("end", "start"):
            raise ValidationError({"named_by": "By the year it ends in, or the year it starts in."})
        tenant = self._tenant()
        tenant.settings = {**(tenant.settings or {}), SETTINGS_KEY: {"start": start, "named_by": named_by}}
        tenant.save(update_fields=["settings"])
        from apps.platform_ops import params
        params.invalidate(tenant.pk)
        from django.core.cache import cache
        cache.delete(f"cep:insights:fiscal:{tenant.pk}")
        return Response({**settings_of(tenant), "months": MONTHS})
