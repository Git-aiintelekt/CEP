"""Report filters every report asks (docs/mockups/report-filters-period.html, option B), first in the bar and in this order:

    Campaign   any of several, the latest campaign by default            a dataset with a campaign field (and a time field)
    Channel    any of several, every channel by default                  a dataset with a channel field
    Period     7, 15 or 30 days, a quarter, half a year, a year or a     a dataset with a time field that takes a range;
               custom range on the time field; 7 days by default         always asked, so no report reads a whole table

The author's own filters follow. A report's stored definition gets them when it is created, drafted by AI Reports or saved, and a
saved report read before then is shown and run with them (with_standard_filters on the way out); add_to_reports writes them into
the reports made before (python manage.py insights_report_filters --tenant NWA [--apply]). Campaign and Channel are ordinary
parameters, changed or removed under Edit -> Report Filters; Period can take another default, never be removed. A question the
author already asks on the campaign or channel field keeps its place in that slot; one on the time field gives way to Period.
On a dashboard tile the dashboard's own period stands in for Period (dashboards.tile_result).
"""
import json

from apps.delivery.engine import session
from . import catalog
from .definition import DefinitionError, validate
from .parameters import LATEST, MAX_PARAMETERS, period_allowed

NOTE = "Report filters added"
PERIOD_DEFAULT = "7d"


def _choosable(field: dict) -> bool:
    return field["type"] == "string" and field["role"] == "dimension" and "in" in field["operators"]


def campaign_field(dataset: dict) -> dict | None:
    """the dataset's campaign: the text dimension campaign_name, else the first whose key or label says campaign and is not an id"""
    usable = [f for f in dataset["fields"] if _choosable(f)]
    exact = next((f for f in usable if f["key"] == "campaign_name"), None)
    if exact:
        return exact
    return next((f for f in usable if "campaign" in f"{f['key']} {f['label']}".lower() and not f["key"].endswith("_id")), None)


def channel_field(dataset: dict) -> dict | None:
    return next((f for f in dataset["fields"] if _choosable(f) and f["key"] == "channel"), None)


def time_field(dataset: dict) -> dict | None:
    field = next((f for f in dataset["fields"] if f["key"] == dataset.get("time_field")), None)
    return field if field is not None and period_allowed(field) else None


def standard_filters(dataset: dict) -> list[dict]:
    """Campaign, Channel and Period, those the dataset has fields for"""
    out = []
    campaign, channel, when = campaign_field(dataset), channel_field(dataset), time_field(dataset)
    if campaign is not None and dataset.get("time_field"):
        out.append({"key": "campaign", "label": "Campaign", "field": campaign["key"], "operator": "in", "required": False, "default": dict(LATEST)})
    if channel is not None:
        out.append({"key": "channel", "label": "Channel", "field": channel["key"], "operator": "in", "required": False})
    if when is not None:
        out.append({"key": "period", "label": "Period", "field": when["key"], "operator": "period", "required": True, "default": PERIOD_DEFAULT})
    return out


def with_standard_filters(dataset: dict, definition: dict) -> dict:
    """the definition with the standard filters first, in order, then the author's own (within the most a report asks); the same
    definition when nothing changes"""
    standard = standard_filters(dataset)
    if not standard:
        return definition
    own = [dict(p) for p in definition.get("parameters") or [] if isinstance(p, dict)]
    first = []
    for question in standard:
        if question["operator"] == "period":                         # always asked; the author's label and default are kept
            kept = next((p for p in own if p.get("field") == question["field"] and p.get("operator") == "period"), None)
            first.append({**question, **({"label": kept.get("label") or "Period", "default": kept.get("default") or PERIOD_DEFAULT} if kept else {})})
        else:
            first.append(next((p for p in own if p.get("field") == question["field"]), None) or dict(question))
    taken = {q["field"] for q in first}
    rest = [p for p in own if p.get("field") not in taken]
    for item in first:                                                 # a key the author used elsewhere: the standard one moves aside
        if any(p.get("key") == item["key"] for p in rest):
            n = 2
            while any(p.get("key") == f"{item['key']}_{n}" for p in [*rest, *first]):
                n += 1
            item["key"] = f"{item['key']}_{n}"
    asked = [*first, *rest][:MAX_PARAMETERS]
    if asked == list(definition.get("parameters") or []):
        return definition
    return {**definition, "parameters": asked}


def add_to_reports(tenant_id, user_id=None, *, apply: bool = False) -> list[dict]:
    """The workspace's reports without the standard filters: listed, and with apply each saved as a new version. -> [{id, name, added}]"""
    from .api import _q
    out = []
    with session.tenant_scope(tenant_id), session.tx():
        rows = _q("SELECT id::text, name, dataset_key, definition, view_type, version FROM report WHERE tenant_id = %s AND deleted_at IS NULL ORDER BY name", [str(tenant_id)])
        limits = catalog.engine_of(tenant_id)["limits"]
        for row in rows:
            dataset = catalog.dataset(tenant_id, row["dataset_key"], True)
            if dataset is None:
                continue
            definition = json.loads(row["definition"]) if isinstance(row["definition"], str) else row["definition"]
            changed = with_standard_filters(dataset, definition)
            if changed is definition:
                continue
            try:
                checked = validate(dataset, changed, max_limit=limits["run_rows"])
            except DefinitionError:
                continue
            before = {(p.get("key"), p.get("operator")) for p in definition.get("parameters") or []}
            added = [p["label"] for p in checked.get("parameters", []) if (p["key"], p["operator"]) not in before]
            out.append({"id": row["id"], "name": row["name"], "added": added})
            if apply:
                _q("UPDATE report SET definition = %s, version = version + 1, row_version = row_version + 1, updated_at = now() WHERE id = %s",
                   [json.dumps(checked), row["id"]])
                _q("INSERT INTO report_version (tenant_id, report_id, version, definition, view_type, note, changed_by) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                   [str(tenant_id), row["id"], row["version"] + 1, json.dumps(checked), row["view_type"], NOTE, str(user_id) if user_id else None])
    return out
