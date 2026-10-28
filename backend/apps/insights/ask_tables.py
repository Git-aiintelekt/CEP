"""Ask for a Report on a Report Database's tables not mapped yet (docs/mockups/ask-for-report-data-and-specs.html, option A). The
model is given the table names (read live and held ten minutes, as Map a Dataset reads them) and the columns of the tables the prompt
or its documents name, at most TABLES_MAX; it may ask for other tables' columns once (kind "need_tables"). A draft on them carries a
new dataset (a base table, its joins, the columns it needs), checked as Map a Dataset checks one and previewed without being stored.
It is mapped only when someone opens the draft (assistant.open_draft). Nothing about the database is kept but that draft.
"""
import re

from apps.insights import catalog, databases, external
from apps.insights.definition import DefinitionError

TABLES_MAX = 20                                                     # tables whose columns are read for one prompt
NAMES_MAX = 2500                                                    # table names given to the model; a bigger database gives the first ones
NEW_KEY = "new_dataset"                                             # the draft's dataset until it is mapped

NEW_DATASET = {"type": "object", "description": "With dataset \"new_dataset\": the dataset to map from tables not mapped yet",
               "properties": {"label": {"type": "string", "description": "The dataset's name, Title Case"},
                              "source": {"type": "string", "description": "The base table (alias t0)"},
                              "joins": {"type": "array", "items": {"type": "object", "properties": {
                                  "table": {"type": "string"}, "type": {"type": "string", "enum": ["left", "inner"]},
                                  "to": {"type": "string", "description": "t0 or an earlier join's alias (t1, t2 … in order)"},
                                  "on": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}, "description": "[[column of the table joined to, column of this table]]"}},
                                  "required": ["table", "on"]}},
                              "fields": {"type": "array", "items": {"type": "object", "properties": {
                                  "table": {"type": "string", "description": "t0 or a join's alias"}, "column": {"type": "string"},
                                  "label": {"type": "string", "description": "Title Case; the field's key is this label in lower case with underscores"}},
                                  "required": ["column"]}}},
               "required": ["source", "fields"]}


def context_for(connection: dict, text: str, asked: list[str] | None = None) -> dict:
    """{connection, names, columns}: the tables by name, and the columns of those the text names (as a word) or the model asked for"""
    held = databases.source_names(connection)
    names = [s["name"] for s in held["sources"] if s.get("mappable")]
    known = {n.lower(): n for n in names}
    wanted = [known[n.lower()] for n in (asked or []) if n.lower() in known]
    lowered = text.lower()
    for name in sorted(names, key=len, reverse=True):                 # a longer name first: sales_lines before sales
        if len(wanted) >= TABLES_MAX:
            break
        if name not in wanted and re.search(rf"(?<![a-z0-9_]){re.escape(name.lower())}(?![a-z0-9_])", lowered):
            wanted.append(name)
    columns = external.columns_of(connection, wanted[:TABLES_MAX]) if wanted else {}
    return {"connection": connection, "names": names, "columns": columns, "read_at": held["read_at"]}


def more(context: dict, tables: list[str]) -> dict:
    """the context with the columns of the tables the model asked for, within TABLES_MAX"""
    known = {n.lower(): n for n in context["names"]}
    add = [known[t.lower()] for t in tables if isinstance(t, str) and t.lower() in known and known[t.lower()] not in context["columns"]]
    room = TABLES_MAX - len(context["columns"])
    if add and room > 0:
        return {**context, "columns": {**context["columns"], **external.columns_of(context["connection"], add[:room])}}
    return context


def words(context: dict, mapped: set[str]) -> str:
    """the system prompt's part on the tables not mapped yet"""
    conn = context["connection"]
    lines = [f"## Tables not mapped yet in the database \"{conn['name']}\" ({external.ENGINES.get(conn['engine'], conn['engine'])})",
             f"   To draft on them, answer kind \"draft\" with dataset \"{NEW_KEY}\" and new_dataset: the base table (t0), up to {databases.MAX_JOINS} joins "
             "(aliases t1, t2 … in order, each on key columns), and the columns the report needs as fields with a Title Case label. In the definition, name a "
             "field by its key: its label in lower case with underscores (Net Amount → net_amount). Only tables whose columns are listed may be used; to use "
             f"another, answer kind \"need_tables\" with up to {TABLES_MAX} table names, once. Prefer a mapped dataset above when one holds the data."]
    for table, cols in context["columns"].items():
        shown = ", ".join(f"{c['column']} {c['column_type']}{' key' if c['key'] else ''}" for c in cols if c["mappable"])
        lines.append(f"   table \"{table}\"{' (mapped already)' if table in mapped else ''}: {shown}")
    others = [n for n in context["names"] if n not in context["columns"]]
    if others:
        listed = others[:NAMES_MAX]
        lines.append(f"   Other tables, names only ({len(others):,}{'' if len(others) <= NAMES_MAX else f', the first {NAMES_MAX:,} listed'}): " + ", ".join(listed))
    return "\n".join(lines)


def _label(name: str) -> str:
    return " ".join(part.capitalize() for part in re.split(r"[_\s]+", name) if part)


def build(context: dict, raw) -> tuple[dict, dict]:
    """(the body Open in Editor maps, the dataset as the catalogue gives it under NEW_KEY) from the model's new_dataset;
    DefinitionError for the retry when it does not fit the tables read"""
    from rest_framework.exceptions import ValidationError
    if not isinstance(raw, dict):
        raise DefinitionError("new_dataset", f"With dataset \"{NEW_KEY}\", give new_dataset: the base table, its joins and the fields.")
    source = str(raw.get("source") or "").strip()
    joins = [j for j in (raw.get("joins") or []) if isinstance(j, dict)]
    tables = [source, *(str(j.get("table") or "").strip() for j in joins)]
    missing = [t for t in tables if t not in context["columns"]]
    if missing:
        context.update(more(context, missing))
        missing = [t for t in tables if t not in context["columns"]]
    if missing:
        raise DefinitionError("new_dataset", f"No columns were read for {', '.join(missing)}: use a table whose columns are listed.")
    by_alias = {"t0": source, **{f"t{i + 1}": str(j.get("table")).strip() for i, j in enumerate(joins)}}
    fields = []
    for item in raw.get("fields") or []:
        if not isinstance(item, dict):
            continue
        alias = str(item.get("table") or "t0")
        if alias not in by_alias and alias in by_alias.values():          # a table's name for its alias
            alias = next(a for a, t in by_alias.items() if t == alias)
        column = next((c for c in context["columns"].get(by_alias.get(alias, ""), []) if c["column"].lower() == str(item.get("column") or "").lower() and c["mappable"]), None)
        if column is None:
            raise DefinitionError("new_dataset.fields", f"{by_alias.get(alias, alias)} has no column {item.get('column')}.")
        fields.append({"column": column["column"], "table": alias, "label": " ".join(str(item.get("label") or _label(column["column"])).split())[:100],
                       "type": column["type"], "role": column["role"], "aggregates": column["aggregates"], "format": column["format"], "sensitivity": "NORMAL"})
    if not fields:
        fields = [{"column": c["column"], "table": "t0", "label": _label(c["column"]), "type": c["type"], "role": c["role"], "aggregates": c["aggregates"], "format": c["format"], "sensitivity": "NORMAL"}
                  for c in context["columns"][source] if c["mappable"]][:databases.MAX_FIELDS]
    body = {"label": " ".join(str(raw.get("label") or _label(source)).split())[:100], "source": source, "fields": fields,
            "joins": [{"table": str(j.get("table")).strip(), "type": str(j.get("type") or "left"), "to": str(j.get("to") or "t0"), "on": j.get("on")} for j in joins]}
    try:
        data = databases._dataset_body(body, None, context["connection"]["engine"])
    except ValidationError as exc:
        first = next(iter(exc.detail.items())) if isinstance(exc.detail, dict) else ("new_dataset", exc.detail)
        raise DefinitionError(f"new_dataset.{first[0]}", str(first[1][0] if isinstance(first[1], list) else first[1])) from None
    keyed = dict(zip(((f["table"], f["column"]) for f in fields), data["fields"]))
    data["time_field"] = next((f["key"] for f in data["fields"] if f["type"] in ("date", "datetime")), None)
    data["primary_key"] = next((keyed[("t0", c["column"])]["key"] for c in context["columns"][source] if c["key"] and ("t0", c["column"]) in keyed), None)
    body = {**body, "time_field": data["time_field"], "primary_key": data["primary_key"]}
    from apps.tenants import context as tenant_context
    current = tenant_context.current()
    home = catalog.home_component(current.tenant_id) if current is not None else "cep"
    entry = databases.catalogue_entry({**data, "key": NEW_KEY, "component_key": home}, context["connection"])
    return body, entry


def remap(definition: dict, view: dict, entry: dict) -> tuple[dict, dict]:
    """the definition and view with a field named by its column, its table.column or its label put to its key"""
    lookup: dict[str, str] = {}
    for f in entry["fields"]:
        for name in (f.get("column"), f"{f.get('table', 't0')}.{f.get('column')}", f["label"].lower()):
            if name and name not in lookup:
                lookup[name] = f["key"]
    for f in entry["fields"]:
        lookup[f["key"]] = f["key"]

    def to_key(name):
        return lookup.get(name, lookup.get(str(name).lower(), name)) if isinstance(name, str) else name

    def rules(group):
        if not isinstance(group, dict):
            return group
        return {**group, "rules": [rules(r) if isinstance(r, dict) and "rules" in r else ({**r, "field": to_key(r.get("field"))} if isinstance(r, dict) else r) for r in group.get("rules") or []]}

    out = dict(definition or {})
    out["columns"] = [{**c, "field": to_key(c.get("field"))} if isinstance(c, dict) else c for c in out.get("columns") or []]
    if isinstance(out.get("orderBy"), list):
        out["orderBy"] = [{**o, "field": to_key(o.get("field"))} if isinstance(o, dict) else o for o in out["orderBy"]]
    if isinstance(out.get("filters"), dict):
        out["filters"] = rules(out["filters"])
    view = dict(view or {})
    if view.get("across"):
        view["across"] = to_key(view["across"])
    return out, view


def summary(body: dict, connection: dict) -> dict:
    """what the draft card says about the dataset Open in Editor maps"""
    return {"connection_id": connection["id"], "database": connection["name"], "label": body["label"], "source": body["source"],
            "joins": [j["table"] for j in body["joins"]], "fields": len(body["fields"])}
