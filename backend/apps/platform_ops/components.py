"""The suite's components: what exists (the registry), what each plan includes, and what a workspace has.

    components.resolve(registry, plan_keys, own, today)   -> the components a workspace can open, in suite order (pure)
    components.for_tenant(tenant_id)                      -> the same, cached with the workspace's features (params.context_for)
    components.registry()                                  -> suite_component rows, in suite order
    components.coming(registry)                            -> what exists but is not released: the launcher's "coming" line

Tables (patch 0048): suite_component (key, name, tagline, release RELEASED | BETA | PLANNED, needs), plan_component
(plan_id, component_key) and tenant_component (tenant_id, component_key, access TRIAL | ADDON | OFF, until). A workspace
gets a component when its plan includes it, or a trial (until a date) or an add-on adds it; OFF hides a plan component.
PLANNED is never offered. The shell builds the launcher and the left navigation from the list GET /me/ returns.
"""
from datetime import date, datetime

from django.conf import settings
from django.db import connections

OFFERABLE = ("RELEASED", "BETA")
# what a plan includes when the plan_component table has nothing for it (an installation that has not run patch 0048's seed)
FALLBACK_PLAN = ["cep", "insights"]
FALLBACK_REGISTRY = [
    {"key": "cep", "name": "Engagement", "tagline": "Customer Engagement", "release": "RELEASED", "needs": []},
    {"key": "insights", "name": "Insights", "tagline": "Reports, dashboards, datasets", "release": "PLANNED", "needs": []},
]


def _day(value) -> date | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def resolve(registry: list[dict], plan_keys: list[str] | None, own: dict[str, dict] | None, today: date | None = None) -> list[dict]:
    """Pure resolution. `registry`: suite_component rows in suite order; `plan_keys`: the plan's component keys (None = the
    fallback set); `own`: {key: {"access": TRIAL | ADDON | OFF, "until": date}} from tenant_component."""
    today = today or date.today()
    included = set(FALLBACK_PLAN if plan_keys is None else plan_keys)
    own = own or {}
    out = []
    for spec in registry:
        key = spec["key"]
        if spec.get("release") not in OFFERABLE:
            continue
        entry = own.get(key) or {}
        access = str(entry.get("access") or "").upper()
        until = _day(entry.get("until"))
        if access == "OFF":
            on = False
        elif access in ("TRIAL", "ADDON"):
            on = not (until and until < today)
        else:
            on, access = key in included, "PLAN"
        if on:
            out.append({"key": key, "name": spec["name"], "tagline": spec.get("tagline") or "", "access": access, "until": until.isoformat() if until else None})
    return out


def coming(registry: list[dict]) -> list[dict]:
    return [{"key": spec["key"], "name": spec["name"], "tagline": spec.get("tagline") or ""} for spec in registry if spec.get("release") not in OFFERABLE]


def _rows(sql, args=()):
    """On the platform connection: the back-office writes these tables there, so a decision is seen at once (also inside a test)."""
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchall()


def _table_exists(name: str) -> bool:
    return bool(_rows("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = %s", [name]))


def registry() -> list[dict]:
    """suite_component in suite order; the fallback until patch 0048 has run."""
    if not _table_exists("suite_component"):
        return [dict(spec) for spec in FALLBACK_REGISTRY]
    import json
    rows = _rows("SELECT key, name, tagline, release, needs FROM suite_component ORDER BY sort_order, key")
    return [{"key": key, "name": name, "tagline": tagline, "release": release, "needs": (json.loads(needs) if isinstance(needs, str) else needs) or []}
            for key, name, tagline, release, needs in rows]


def inputs_for(tenant_id, plan_id) -> tuple[list[dict], list[str] | None, dict[str, dict]]:
    """What resolve() needs for one workspace, read from the tables: the registry, the plan's keys, the workspace's own entries."""
    reg = registry()
    if not _table_exists("plan_component"):
        return reg, None, {}
    plan_keys = [row[0] for row in _rows("SELECT component_key FROM plan_component WHERE plan_id = %s", [str(plan_id)])] if plan_id else []
    own = {row[0]: {"access": row[1], "until": row[2]} for row in _rows("SELECT component_key, access, until FROM tenant_component WHERE tenant_id = %s", [str(tenant_id)])}
    return reg, (plan_keys if plan_keys or plan_id else None), own


def plan_keys(plan_id) -> list[str]:
    """the components a plan includes (the fallback set before patch 0048)"""
    if not _table_exists("plan_component"):
        return list(FALLBACK_PLAN)
    return [row[0] for row in _rows("SELECT component_key FROM plan_component WHERE plan_id = %s", [str(plan_id)])]


def for_tenant(tenant_id) -> list[dict]:
    from apps.platform_ops import params
    return params.context_for(tenant_id)["components"]
