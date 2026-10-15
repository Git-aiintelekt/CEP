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
    "date":     ["=", "!=", ">", ">=", "<", "<=", "between", "last_days", "is_null", "is_not_null"],
    "datetime": ["=", "!=", ">", ">=", "<", "<=", "between", "last_days", "is_null", "is_not_null"],
    "boolean":  ["=", "is_null", "is_not_null"],
}
BUCKETS = ["day", "week", "month", "quarter", "year"]
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
        return {"engine": "postgresql", "status": "ACTIVE", "freshness_sla": "LIVE", "limits": dict(DEFAULT_LIMITS)}
    engine, status, freshness, limits = row[0]
    limits = (json.loads(limits) if isinstance(limits, str) else limits) or {}
    return {"engine": engine, "status": status, "freshness_sla": freshness, "limits": {**DEFAULT_LIMITS, **limits}}


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
    fields = _rows("""SELECT dataset_key, key, label, column_name, type, role, aggregates, display_format, sensitivity
                        FROM report_field ORDER BY dataset_key, sort_order, key""")
    by_dataset: dict[str, list[dict]] = {}
    for dataset_key, key, label, column, type_, role, aggregates, display_format, sensitivity in fields:
        aggregates = (json.loads(aggregates) if isinstance(aggregates, str) else aggregates) or []
        by_dataset.setdefault(dataset_key, []).append({"key": key, "label": label, "column": column, "type": type_, "role": role, "aggregates": aggregates,
                                                       "operators": OPERATORS[type_], "buckets": BUCKETS if type_ in ("date", "datetime") else [],
                                                       "format": display_format, "sensitivity": sensitivity})
    data = [{"key": key, "label": label, "description": description, "component": {"key": component_key, "name": component_name}, "primary_key": primary_key,
             "time_field": time_field, "freshness": freshness, "source": source, "workspace_field": workspace_field, "fields": by_dataset.get(key, [])}
            for key, label, description, component_key, component_name, primary_key, time_field, freshness, source, workspace_field in datasets]
    cache.set(key, data, TTL)
    return data


def _visible(dataset: dict, can_see_pii: bool) -> dict:
    offered = [f for f in dataset["fields"] if f["sensitivity"] != "CONFIDENTIAL"]
    fields = [f for f in offered if can_see_pii or f["sensitivity"] != "PII"]
    locked = [{"key": f["key"], "label": f["label"]} for f in offered if f not in fields]
    return {**dataset, "fields": fields, "locked": locked}


def for_tenant(tenant_id, can_see_pii: bool = False) -> list[dict]:
    engine = engine_of(tenant_id)
    return [_visible(d, can_see_pii) for d in _load(engine["engine"])]


def dataset(tenant_id, key: str, can_see_pii: bool = False) -> dict | None:
    for d in for_tenant(tenant_id, can_see_pii):
        if d["key"] == key:
            return d
    return None


def invalidate() -> None:
    for engine in ("postgresql", "clickhouse"):
        cache.delete(f"cep:insights:catalog:{engine}")
