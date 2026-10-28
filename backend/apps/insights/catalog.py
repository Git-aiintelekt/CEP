"""The semantic catalogue as a workspace sees it: the datasets its engine has a source for, each with its fields, the
operators and aggregates a field allows, and what the person may see. Authoring with a PII field needs report.admin or
user.admin; without the right the field is hidden from the catalogue (kept as `locked`, so a draft naming it is told why)
and a saved report that has it runs with that column masked (runner.mask).

    catalog.for_tenant(tenant_id, can_see_pii) -> [{key, label, description, component, time_field, freshness, fields: [...]}]
    catalog.dataset(tenant_id, key, can_see_pii) -> one of those, with its source, or None
"""
from django.conf import settings
from django.core.cache import cache
from django.db import connections

TTL = 60
OPERATORS = {
    "string":   ["=", "!=", "contains", "starts_with", "in", "is_null", "is_not_null"],
    "number":   ["=", "!=", ">", ">=", "<", "<=", "between", "in", "is_null", "is_not_null"],
    "date":     ["=", "!=", ">", ">=", "<", "<=", "between", "last_days", "this_fiscal_year", "last_fiscal_year", "this_fiscal_quarter", "last_fiscal_quarter", "is_null", "is_not_null"],
    "datetime": ["=", "!=", ">", ">=", "<", "<=", "between", "last_days", "this_fiscal_year", "last_fiscal_year", "this_fiscal_quarter", "last_fiscal_quarter", "is_null", "is_not_null"],
    "boolean":  ["=", "is_null", "is_not_null"],
}
BUCKETS = ["day", "week", "month", "quarter", "year"]
FISCAL_BUCKETS = ["fiscal_quarter", "fiscal_year"]
ALL_BUCKETS = [*BUCKETS, *FISCAL_BUCKETS]
CALC = "calc"
FORMULA_OPS = ("ratio", "difference", "sum", "product")
DEFAULT_LIMITS = {"statement_timeout_ms": 15_000, "preview_rows": 200, "run_rows": 5_000, "export_rows": 100_000, "concurrent": 4}


def _rows(sql, args=()):
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchall()


def engine_of(tenant_id) -> dict:
    """The workspace's engine setting, or the defaults (PostgreSQL) when it has none yet."""
    row = _rows("SELECT engine, status, freshness_sla, query_limits FROM report_engine_setting WHERE tenant_id = %s", [str(tenant_id)])
    import json
    if not row:
        return {"engine": "postgresql", "status": "ACTIVE", "freshness_sla": "LIVE", "limits": dict(DEFAULT_LIMITS), "dialect": "postgresql"}
    engine, status, freshness, limits = row[0]
    limits = (json.loads(limits) if isinstance(limits, str) else limits) or {}
    # the engine that runs the reports now: ClickHouse only once it is active; while it is MIGRATING the runs stay on PostgreSQL
    dialect = engine if engine == "clickhouse" and status in ("ACTIVE", "READ_ONLY") else "postgresql"
    return {"engine": engine, "status": status, "freshness_sla": freshness if dialect == engine else "LIVE", "limits": {**DEFAULT_LIMITS, **limits}, "dialect": dialect}


def _load(engine: str) -> list[dict]:
    key = f"cep:insights:catalog:{engine}"
    data = cache.get(key)
    if data is not None:
        return data
    import json
    datasets = _rows("""SELECT d.key, d.label, d.description, d.component_key, c.name, d.primary_key, d.time_field, d.freshness_policy, s.source_name, d.workspace_field
                          FROM report_dataset d JOIN suite_component c ON c.key = d.component_key
                          JOIN report_dataset_source s ON s.dataset_key = d.key AND s.engine = %s AND s.status = 'ACTIVE'
                         WHERE d.status = 'ACTIVE' ORDER BY d.sort_order, d.key""", [engine])
    fields = _rows("""SELECT f.dataset_key, f.key, f.label, f.column_name, f.type, f.role, f.aggregates, f.display_format, f.sensitivity, to_jsonb(f) -> 'formula'
                        FROM report_field f ORDER BY f.dataset_key, f.sort_order, f.key""")    # to_jsonb: the formula column may not be there yet (patch 0059)
    by_dataset: dict[str, list[dict]] = {}
    for dataset_key, key, label, column, type_, role, aggregates, display_format, sensitivity, formula in fields:
        aggregates = (json.loads(aggregates) if isinstance(aggregates, str) else aggregates) or []
        formula = json.loads(formula) if isinstance(formula, str) else formula
        field = {"key": key, "label": label, "column": column, "type": type_, "role": role, "aggregates": aggregates,
                 "operators": OPERATORS[type_], "buckets": BUCKETS if type_ in ("date", "datetime") else [], "format": display_format, "sensitivity": sensitivity}
        by_dataset.setdefault(dataset_key, []).append(calculated(field, formula) if formula else field)
    for dataset_key, items in by_dataset.items():                       # a calculated measure whose formula does not fit its dataset is not offered broken
        by_dataset[dataset_key] = [f for f in items if not f.get("formula") or formula_error(items, f["formula"]) is None]
    data = [{"key": key, "label": label, "description": description, "component": {"key": component_key, "name": component_name}, "primary_key": primary_key,
             "time_field": time_field, "freshness": freshness, "source": source, "workspace_field": workspace_field, "fields": by_dataset.get(key, [])}
            for key, label, description, component_key, component_name, primary_key, time_field, freshness, source, workspace_field in datasets]
    cache.set(key, data, TTL)
    return data


def components_of(tenant_id) -> list[str]:
    """the components the workspace has (its plan, trials and add-ons): Insights shows only what belongs to them"""
    from apps.platform_ops import components
    return [c["key"] for c in components.for_tenant(tenant_id)]


def home_component(tenant_id) -> str:
    """where the workspace's own data (its databases, its uploads) is listed: Engagement when it has it, else Insights"""
    return "cep" if "cep" in components_of(tenant_id) else "insights"


def component_name(key: str) -> str:
    names = cache.get("cep:insights:component-names")
    if names is None:
        names = dict(_rows("SELECT key, name FROM suite_component"))
        cache.set("cep:insights:component-names", names, TTL)
    return names.get(key, key)


def formula_error(fields: list[dict], formula, *, depth: int = 0) -> str | None:
    """Why a calculated measure's formula cannot be used with these fields, or None when it can: an op, a left and a right
    side, each a measure field with one of its aggregates (a calculated one nests two deep at most) or a number, and an
    optional scale."""
    if not isinstance(formula, dict) or formula.get("op") not in FORMULA_OPS:
        return "A formula is a ratio, a difference, a sum or a product of two sides."
    for name in ("left", "right"):
        side = formula.get(name)
        if not isinstance(side, dict):
            return f"The {name} side names a measure or a number."
        if "field" in side:
            field = next((f for f in fields if f["key"] == side["field"]), None)
            if field is None or field.get("role") != "measure":
                return f"The {name} side names a measure of this dataset."
            if side.get("aggregate") not in field.get("aggregates", []):
                return f"{field['label']} does not take {side.get('aggregate') or 'that calculation'}."
            if field.get("formula"):
                if depth >= 2:
                    return "A formula nests calculated measures two deep at most."
                nested = formula_error(fields, field["formula"], depth=depth + 1)
                if nested:
                    return nested
        elif isinstance(side.get("value"), bool) or not isinstance(side.get("value"), (int, float)):
            return f"The {name} side names a measure or a number."
    scale = formula.get("scale")
    if scale is not None and (isinstance(scale, bool) or not isinstance(scale, (int, float)) or scale == 0):
        return "The scale is a number other than zero."
    return None


def formula_fields(formula) -> set[str]:
    """the keys of the measures a formula reads, this level only"""
    return {side["field"] for side in (formula.get("left"), formula.get("right")) if isinstance(side, dict) and "field" in side}


def calculated(field: dict, formula: dict) -> dict:
    """a calculated measure as the catalogue offers it: a number, a measure, no column, the one aggregate calc"""
    return {**field, "column": None, "formula": formula, "type": "number", "role": "measure", "aggregates": [CALC]}


def _visible(dataset: dict, can_see_pii: bool) -> dict:
    offered = [f for f in dataset["fields"] if f["sensitivity"] != "CONFIDENTIAL"]
    fields = [f for f in offered if can_see_pii or f["sensitivity"] != "PII"]
    locked = [{"key": f["key"], "label": f["label"]} for f in offered if f not in fields]
    keys = {f["key"] for f in fields}
    for _ in range(3):                                                 # a calculated measure over a field this reader cannot see goes with it
        fields = [f for f in fields if not f.get("formula") or formula_fields(f["formula"]) <= keys]
        keys = {f["key"] for f in fields}
    return {**dataset, "fields": fields, "locked": locked}


def for_tenant(tenant_id, can_see_pii: bool = False) -> list[dict]:
    """the platform's datasets on the workspace's engine for the components it has, then the datasets the workspace mapped from
    its own databases and uploads"""
    from apps.insights import databases, links
    engine = engine_of(tenant_id)
    from apps.insights import uploads
    has = set(components_of(tenant_id))
    platform = links.attach([_visible(d, can_see_pii) for d in _load(engine["dialect"]) if d["component"]["key"] in has], links.load())     # the platform's datasets carry their links
    out = [*platform, *[_visible(d, can_see_pii) for d in databases.custom_datasets(tenant_id)], *[_visible(d, can_see_pii) for d in uploads.custom_datasets(tenant_id)]]
    from apps.insights import dataset_formulas
    out = dataset_formulas.attach(out, tenant_id, can_see_pii)          # each dataset's shared formulas among its fields
    if _fiscal_start(tenant_id) != 1:                                  # a fiscal year that is not the calendar's: its quarters and years to group by
        out = [{**d, "fields": [{**f, "buckets": [*f["buckets"], *FISCAL_BUCKETS]} if f.get("buckets") else f for f in d["fields"]]} for d in out]
    return out


def _fiscal_start(tenant_id) -> int:
    key = f"cep:insights:fiscal:{tenant_id}"
    known = cache.get(key)
    if known is None:
        from apps.insights.fiscal import settings_of
        from apps.tenants.models import Tenant
        found = Tenant.objects.filter(pk=tenant_id).first()
        known = settings_of(found)["start"] if found else 1
        cache.set(key, known, TTL)
    return known


def dataset(tenant_id, key: str, can_see_pii: bool = False) -> dict | None:
    for d in for_tenant(tenant_id, can_see_pii):
        if d["key"] == key:
            return d
    return None


def invalidate() -> None:
    for engine in ("postgresql", "clickhouse"):
        cache.delete(f"cep:insights:catalog:{engine}")
