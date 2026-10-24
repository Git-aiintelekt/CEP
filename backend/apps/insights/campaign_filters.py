"""Campaign filters: every report on a dataset with a campaign and a send time asks two questions before it runs (the request of
2026-10-24): Campaign, any of several, the latest campaign by default; and Send Date, a range, the latest campaign's send day by
default (apps/insights/runner._latest). Drafts from AI Reports and new reports get them; add_to_reports gives them to the reports
made before (python manage.py insights_campaign_filters --tenant NWA [--apply]). A report keeps them as ordinary parameters, so
its author can change or remove them under Edit -> Parameters.
"""
import json

from apps.delivery.engine import session
from . import catalog
from .definition import DefinitionError, validate
from .parameters import LATEST, MAX_PARAMETERS

NOTE = "Campaign filters added"


def campaign_field(dataset: dict) -> dict | None:
    """the dataset's campaign: the text dimension campaign_name, else the first whose key or label says campaign and is not an id"""
    usable = [f for f in dataset["fields"] if f["type"] == "string" and f["role"] == "dimension" and "in" in f["operators"]]
    exact = next((f for f in usable if f["key"] == "campaign_name"), None)
    if exact:
        return exact
    return next((f for f in usable if "campaign" in f"{f['key']} {f['label']}".lower() and not f["key"].endswith("_id")), None)


def campaign_filters(dataset: dict) -> list[dict]:
    """the two questions for a campaign dataset (a campaign field and a time field that takes a range), else none"""
    campaign = campaign_field(dataset)
    time_field = next((f for f in dataset["fields"] if f["key"] == dataset.get("time_field")), None)
    if campaign is None or time_field is None or "between" not in time_field["operators"]:
        return []
    return [{"key": "campaign", "label": "Campaign", "field": campaign["key"], "operator": "in", "required": False, "default": dict(LATEST)},
            {"key": "send_date", "label": "Send Date", "field": time_field["key"], "operator": "between", "required": False, "default": dict(LATEST)}]


def with_campaign_filters(dataset: dict, definition: dict) -> dict:
    """the definition with the campaign questions it lacks (a field already asked about keeps its own question), within five"""
    wanted = campaign_filters(dataset)
    asked = list(definition.get("parameters") or [])
    fields, keys = {p.get("field") for p in asked}, {p.get("key") for p in asked}
    for question in wanted:
        if question["field"] in fields or len(asked) >= MAX_PARAMETERS:
            continue
        key, n = question["key"], 2
        while key in keys:
            key, n = f"{question['key']}_{n}", n + 1
        asked.append({**question, "key": key})
        keys.add(key)
    return {**definition, "parameters": asked} if len(asked) != len(definition.get("parameters") or []) else definition


def add_to_reports(tenant_id, user_id=None, *, apply: bool = False) -> list[dict]:
    """The workspace's campaign reports without the questions: listed, and with apply each saved as a new version. -> [{id, name, added}]"""
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
            changed = with_campaign_filters(dataset, definition)
            if changed is definition:
                continue
            try:
                checked = validate(dataset, changed, max_limit=limits["run_rows"])
            except DefinitionError:
                continue
            added = [p["label"] for p in checked.get("parameters", []) if p["key"] not in {q.get("key") for q in definition.get("parameters") or []}]
            out.append({"id": row["id"], "name": row["name"], "added": added})
            if apply:
                _q("UPDATE report SET definition = %s, version = version + 1, row_version = row_version + 1, updated_at = now() WHERE id = %s",
                   [json.dumps(checked), row["id"]])
                _q("INSERT INTO report_version (tenant_id, report_id, version, definition, view_type, note, changed_by) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                   [str(tenant_id), row["id"], row["version"] + 1, json.dumps(checked), row["view_type"], NOTE, str(user_id) if user_id else None])
    return out
