"""Names in a report's rows that are things of Engagement: the campaign or the journey behind a line, so a dashboard tile can
open it. Only the platform's own datasets carry them (a workspace's own table may have a column of the same key that means
something else). A name two campaigns share gets no link: its line counts both."""
from apps.insights.api import _q

TABLES = {"campaign": "campaign", "journey": "journey"}                 # kind -> its table: id, tenant_id, name, deleted_at
FIELDS = {("messages", "campaign_name"): "campaign", ("attributed_orders", "campaign_name"): "campaign", ("messages", "journey_name"): "journey",
          ("journey_enrollments", "journey_name"): "journey", ("journey_steps", "journey_name"): "journey"}
MAX_NAMES = 500


def for_result(tenant_id, dataset: dict, result: dict) -> list[dict]:
    """[{column, kind, ids: {name: id}}] for the columns of this result that name a campaign or a journey"""
    if dataset.get("external") or dataset.get("component", {}).get("key") != "cep":
        return []
    out = []
    for at, column in enumerate(result.get("columns") or []):
        kind = FIELDS.get((dataset["key"], column["key"]))
        if not kind or column.get("aggregate") or column.get("bucket") or column.get("masked"):
            continue
        names = sorted({row[at] for row in result["rows"] if isinstance(row[at], str) and row[at]})[:MAX_NAMES]
        if not names:
            continue
        rows = _q(f"""SELECT name, min(id::text) AS id FROM {TABLES[kind]}
                       WHERE tenant_id = %s AND deleted_at IS NULL AND name = ANY(%s) GROUP BY name HAVING count(*) = 1""", [str(tenant_id), names])
        if rows:
            out.append({"column": column["key"], "kind": kind, "ids": {row["name"]: row["id"] for row in rows}})
    return out
