"""Template tags from the list (docs/mockups/list-tag-values.html, option A with B's Tag Check).

An upload keeps the file's columns the mapping does not use, on each list entry under its own name (lower case, spaces as
underscores: "Store Name" -> store_name), up to MAX_EXTRA columns: a template tag of the same name finds them at send.

The Tag Values step (an upload made from a campaign, or checked against a template by hand) says where each of a template's tags
gets each person's value:
    FILE        a column of the file
    ATTRIBUTE   a Customer Attribute (Settings -> Customer Attributes): read afresh from its source's database for the file's people
                when the source is a Report Database, else the values C360 already keeps
    CUSTOMER    the customer record (first name, last name ...): read at send, as today
    DEFAULT     the tag's default value: everyone gets the same words
The choice goes with the mapping to the check (imports.review), which counts, for the rows that can be imported, how many have a
value and shows the first one. The import (imports.apply) then stores FILE and ATTRIBUTE values with each list entry under the
tag's key, where the send already looks first: what was reviewed is what is sent. Database values also go into the customer's
attribute values, so the next campaign has them too.

tag_check() is B's card on the campaign's Audience and Review steps: for the people of the chosen lists, how many have a value for
each of the template's tags, and from where, in the order the send looks (list entry, customer attributes, customer record).
"""
from __future__ import annotations

import json
import re

from django.db import connections

from apps.delivery.engine import session
from apps.tenants import context

FROM = ("FILE", "ATTRIBUTE", "CUSTOMER", "DEFAULT")
MAX_EXTRA = 50
PREFIX = "tag:"
EXTERNAL = "tag-id:"                                      # the person's ID in an attribute source's system, by source id
# tags every message fills itself: never asked about
SYSTEM_KEYS = {"unsubscribe_url", "preference_url", "current_year", "today", "campaign_name", "email", "phone"}
# sources that give everyone the same value; a receipt or store tag outside an e-receipt falls back to the list, so it is asked about
SAME_FOR_EVERYONE = ("CAMPAIGN", "CAMPAIGN_RUN", "SYSTEM", "STATIC", "INNER_TEMPLATE")
# the list entry's fixed keys (imports.apply): a file column of the same name is that property, not an extra
MEMBER_KEYS = {"first_name", "last_name", "postal_code", "loyalty_tier", "timezone", "last_order_date"}
# tags the customer record answers, and the upload property that fills it for a new person
RECORD = {"first_name": "first_name", "last_name": "last_name", "party_id": "party_id", "postal_code": "postal_code", "loyalty_tier": "loyalty_tier"}


class TagValuesError(Exception):
    """Something the uploader can fix: shown as is."""


def _conn():
    return connections[context.require().db_alias]


def norm(name: str) -> str:
    """A file column as a key: "Store Name" -> store_name, "Coupon #" -> coupon."""
    key = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")[:60]
    if key and key[0].isdigit():
        key = ("c_" + key)[:60]
    return key


def extra_columns(record) -> list[dict]:
    """The file's columns no property uses, with the key each is kept under: [{col, norm}]."""
    mapped = set((record.column_mapping or {}).values()) | {(record.lookup or {}).get("id_column")}
    out, used = [], set(MEMBER_KEYS)
    for column in record.file_columns or []:
        name = column.get("name") or ""
        if column.get("virtual") or name in mapped or name.startswith("c360:"):
            continue
        key = norm(name)
        if not key or key in used:
            continue
        used.add(key)
        out.append({"col": name, "norm": key})
        if len(out) >= MAX_EXTRA:
            break
    return out


# ---------------------------------------------------------------------------------------------------- the template's tags
def _template(template_id):
    from apps.templates.models import TemplateMaster
    if not template_id:
        return None
    try:
        return TemplateMaster.objects.filter(pk=template_id, deleted_at__isnull=True).first()
    except (ValueError, TypeError):
        return None


def template_tags(template) -> list[dict]:
    """The tags of the template's latest content whose value depends on the person: [{key, label, default, reads, path}]."""
    from apps.templates.design import extract_tags
    from apps.templates.models import PersonalizationTag, RenderedTemplateContent
    content = RenderedTemplateContent.objects.filter(template=template).order_by("-version_number").first()
    if content is None:
        return []
    used = [key for key in extract_tags(content.subject_line, content.preheader, content.html_content, content.sms_body) if key not in SYSTEM_KEYS]
    catalogue = {tag.tag_key.strip("{} "): tag for tag in PersonalizationTag.objects.filter(is_active=True, deleted_at__isnull=True)}
    out = []
    for key in used:
        tag = catalogue.get(key)
        if tag is not None and tag.resolution_source in SAME_FOR_EVERYONE:
            continue                                          # the campaign, a receipt, a static value: the same for everyone
        out.append({"key": key, "label": tag.label if tag is not None else key.replace("_", " ").title(), "default": tag.default_value if tag is not None else None,
                    "reads": tag.resolution_source if tag is not None else None, "path": tag.source_path if tag is not None else None})
    return out


def _attribute_of(tag: dict, keys: set[str]) -> str | None:
    if tag.get("reads") == "CUSTOMER_ATTRIBUTE" and tag.get("path") in keys:
        return tag["path"]
    return tag["key"] if tag["key"] in keys else None


def suggest(record, tags: list[dict], mapping: dict | None = None) -> dict:
    """A first answer for each tag: a file column of the same name, an attribute it reads, the customer record, else the default."""
    from apps.customers import attributes
    mapping = mapping if mapping is not None else (record.column_mapping or {})
    mapped = set(mapping.values()) | {(record.lookup or {}).get("id_column")}
    columns = {norm(c["name"]): c["name"] for c in record.file_columns or [] if not c.get("virtual") and c["name"] not in mapped}
    keys = {d.key for d in attributes.definitions() if d.scope == "CUSTOMER"}
    out = {}
    for tag in tags:
        key = tag["key"]
        path = (tag.get("path") or "").split(".")[-1]
        if key in columns or (path and path in columns):
            out[key] = {"from": "FILE", "column": columns.get(key) or columns[path]}
        elif _attribute_of(tag, keys):
            out[key] = {"from": "ATTRIBUTE", "attribute": _attribute_of(tag, keys)}
        elif key in RECORD or tag.get("reads") == "CUSTOMER_MASTER":
            out[key] = {"from": "CUSTOMER"}
        else:
            out[key] = {"from": "DEFAULT"}
    return out


def options(record, template_id=None, mapping: dict | None = None) -> dict:
    """What the Tag Values step shows: the template, its tags with a suggested source, the file's free columns, the attributes."""
    from apps.customers import attributes
    template = _template(template_id or (record.tag_values or {}).get("template_id"))
    tags = template_tags(template) if template is not None else []
    mapped = set((mapping if mapping is not None else record.column_mapping or {}).values()) | {(record.lookup or {}).get("id_column")}
    saved = (record.tag_values or {}).get("tags") or {} if template is not None and str(template.pk) == str((record.tag_values or {}).get("template_id")) else {}
    suggested = suggest(record, tags, mapping)
    return {
        "template": {"id": str(template.pk), "name": template.name, "channel": template.channel} if template is not None else None,
        "tags": [{**tag, "suggested": suggested.get(tag["key"]), "chosen": saved.get(tag["key"])} for tag in tags],
        "columns": [{"name": c["name"], "sample": (c.get("samples") or [""])[0] if c.get("samples") else ""}
                    for c in record.file_columns or [] if not c.get("virtual") and c["name"] not in mapped],
        "attributes": [{"key": d.key, "label": d.label, "source": d.source.name if d.source else None, "kind": d.source.kind if d.source else None,
                        "reads_database": bool(d.source and d.source.kind == "DATABASE" and d.source.is_active and d.source_field)}
                       for d in attributes.definitions() if d.scope == "CUSTOMER"],
    }


def clean(record, body: dict | None) -> dict | None:
    """The step's answer, checked: {template_id, template_name, tags: {key: {from, column?, attribute?}}}; None when skipped."""
    from apps.customers import attributes
    if not body or not body.get("template_id"):
        return None
    template = _template(body.get("template_id"))
    if template is None:
        raise TagValuesError("That template is not in this workspace any more. Choose another one.")
    known = {tag["key"] for tag in template_tags(template)}
    columns = {c["name"] for c in record.file_columns or [] if not c.get("virtual")}
    keys = {d.key for d in attributes.definitions() if d.scope == "CUSTOMER"}
    tags = {}
    for key, choice in (body.get("tags") or {}).items():
        if key not in known or not isinstance(choice, dict):
            continue
        source = str(choice.get("from") or "DEFAULT").upper()
        if source not in FROM:
            raise TagValuesError(f"Choose where {{{{{key}}}}} comes from.")
        if source == "FILE":
            column = choice.get("column") or ""
            if column not in columns:
                raise TagValuesError(f"Choose the file's column for {{{{{key}}}}}.")
            tags[key] = {"from": "FILE", "column": column}
        elif source == "ATTRIBUTE":
            attribute = choice.get("attribute") or ""
            if attribute not in keys:
                raise TagValuesError(f"Choose the customer attribute for {{{{{key}}}}}.")
            tags[key] = {"from": "ATTRIBUTE", "attribute": attribute}
        else:
            tags[key] = {"from": source}
    return {"template_id": str(template.pk), "template_name": template.name, "tags": tags}


# ---------------------------------------------------------------------------------------------------- the check (imports.review)
def _definitions() -> dict:
    from apps.customers import attributes
    return {d.key: d for d in attributes.definitions()}


def check(record, mapping: dict, v: dict, base: dict, mine: str, reader=None) -> dict | None:
    """After the rows are checked: reads the database attributes for the rows that can be imported (into each staged row, under
    tag:<key>), then counts per tag how many have a value. `v` are the import's SQL expressions over r."""
    from apps.customers import attributes
    config = record.tag_values or {}
    tags = config.get("tags") or {}
    if not tags:
        return None
    defs = _definitions()
    ready = f"{mine} AND r.match_status IN ('MATCHED', 'UNMATCHED')"
    # database attributes, a batch of rows at a time: the person's ID in the source's system, then the source's table
    wanted: dict[str, list[tuple[str, object]]] = {}
    for key, choice in tags.items():
        definition = defs.get(choice.get("attribute") or "") if choice.get("from") == "ATTRIBUTE" else None
        if definition is not None:
            wanted.setdefault(str(definition.source_id) if definition.source_id else "", []).append((key, definition))
    the_reader = attributes.Reader(reader) if not isinstance(reader, attributes.Reader) else reader
    party_column = mapping.get("party_id")
    try:
        for source_id, pairs in wanted.items():
            source = pairs[0][1].source
            reads = source is not None and source.kind == "DATABASE" and source.is_active
            last = 0
            while True:
                params = {**base, "after": last, "system": source.system if source is not None else "", "party_col": party_column or ""}
                ext = (f"COALESCE({attributes.id_sql(source.system)}, NULLIF(btrim(r.raw ->> %(party_col)s), ''))" if reads and party_column
                       else attributes.id_sql(source.system) if reads else "NULL")
                with session.tx(), _conn().cursor() as cursor:
                    cursor.execute(f"""SELECT r.row_number, r.matched_party_id, {ext}
                                         FROM contact_list_import_row r LEFT JOIN customer_master cm ON cm.tenant_id = r.tenant_id AND cm.party_id = r.matched_party_id
                                        WHERE {ready} AND r.row_number > %(after)s ORDER BY r.row_number LIMIT 1000""", params)
                    page = cursor.fetchall()
                if not page:
                    break
                last = page[-1][0]
                found: dict[str, dict] = {}
                if reads:
                    people = [(party, str(x).strip()) for _, party, x in page if x and str(x).strip()]
                    found = attributes.read_people(source, [d for _, d in pairs], people, the_reader)
                stored = attributes.values_of([party for _, party, _ in page])
                updates = []
                for line, party, external in page:
                    values = {}
                    for key, definition in pairs:
                        value = (found.get(party) or {}).get(definition.key)
                        if value in (None, ""):
                            value = (stored.get(party) or {}).get(definition.key)
                        if value not in (None, ""):
                            values[PREFIX + key] = value if isinstance(value, (str, int, float, bool)) else str(value)
                    if external and reads:
                        values[EXTERNAL + source_id] = str(external).strip()
                    if values:
                        updates.append({"n": line, "v": values})
                if updates:
                    with session.tx(), _conn().cursor() as cursor:
                        cursor.execute("""UPDATE contact_list_import_row r SET raw = r.raw || u.v
                                            FROM (SELECT (e ->> 'n')::int AS n, e -> 'v' AS v FROM jsonb_array_elements(%s::jsonb) e) u
                                           WHERE r.tenant_id = %s AND r.import_id = %s AND r.row_number = u.n""", [json.dumps(updates), base["tenant"], base["imp"]])
    finally:
        if not isinstance(reader, attributes.Reader):
            the_reader.close()
    # the counts, every tag in one pass over the rows: who has a value, and the line of the first one; then those lines' values
    result = {key: {"with_value": 0, "sample": None} for key in tags}
    counted = [(index, key, value_sql(index, key, choice, mapping, v)) for index, (key, choice) in enumerate(tags.items())]
    counted = [(index, key, expression) for index, key, expression in counted if expression is not None]
    params = dict(base)
    for index, (key, choice) in enumerate(tags.items()):
        params.update(_params(index, key, choice))
    with session.tx(), _conn().cursor() as cursor:
        figures = "".join(f""", count(*) FILTER (WHERE NULLIF(btrim(({expression})::text), '') IS NOT NULL),
                               min(r.row_number) FILTER (WHERE NULLIF(btrim(({expression})::text), '') IS NOT NULL)""" for _, _, expression in counted)
        cursor.execute(f"""SELECT count(*){figures} FROM contact_list_import_row r
                             LEFT JOIN customer_master cm ON cm.tenant_id = r.tenant_id AND cm.party_id = r.matched_party_id
                            WHERE {ready}""", params)
        row = cursor.fetchone()
        total, firsts = row[0], {}
        for position, (index, key, expression) in enumerate(counted):
            result[key]["with_value"] = int(row[1 + position * 2])
            if row[2 + position * 2] is not None:
                firsts[key] = (index, expression, row[2 + position * 2])
        for key, (index, expression, line) in firsts.items():
            cursor.execute(f"""SELECT ({expression})::text FROM contact_list_import_row r
                                  LEFT JOIN customer_master cm ON cm.tenant_id = r.tenant_id AND cm.party_id = r.matched_party_id
                                 WHERE {mine} AND r.row_number = %(line)s""", {**params, "line": line})
            found = cursor.fetchone()
            result[key]["sample"] = str(found[0])[:80] if found and found[0] is not None else None
    return {"ready": int(total), "tags": result}


def _params(index: int, key: str, choice: dict) -> dict:
    return {f"tagcol_{index}": choice.get("column") or "", f"tagkey_{index}": PREFIX + key}


def value_sql(index: int, key: str, choice: dict, mapping: dict, v: dict) -> str | None:
    """SQL for the tag's value of a staged row r (with customer_master cm joined), or None for the default. Its parameters are
    _params(index, ...): named by position, since a tag key may hold a dot."""
    source = choice.get("from")
    if source == "FILE":
        return f"r.raw ->> %(tagcol_{index})s"
    if source == "ATTRIBUTE":
        return f"r.raw ->> %(tagkey_{index})s"
    if source == "CUSTOMER":
        field = RECORD.get(key)
        record_sql = {"first_name": "cm.first_name", "last_name": "cm.last_name", "party_id": "cm.party_id",
                      "postal_code": "cm.primary_address ->> 'postal_code'"}.get(key, f"cm.custom_attributes ->> '{key}'" if re.match(r"^[a-z][a-z0-9_]*$", key) else "NULL")
        from_file = v.get(field) if field and field in mapping else None
        return f"COALESCE(NULLIF(btrim({record_sql}), ''), {from_file})" if from_file else record_sql
    return None


def member_sql(record) -> tuple[str, dict]:
    """The jsonb a list entry gets on top of its fixed keys: the file's extra columns, then the tag values (FILE and ATTRIBUTE)."""
    extras = extra_columns(record)
    params = {"tv_extras": json.dumps(extras)}
    parts = ["""(SELECT COALESCE(jsonb_object_agg(k.norm, btrim(r.raw ->> k.col)) FILTER (WHERE NULLIF(btrim(r.raw ->> k.col), '') IS NOT NULL), '{}'::jsonb)
                  FROM jsonb_to_recordset(%(tv_extras)s::jsonb) AS k(col text, norm text))"""]
    tags = (record.tag_values or {}).get("tags") or {}
    pairs = []
    for index, (key, choice) in enumerate(tags.items()):
        if choice.get("from") == "FILE":
            params[f"tv_k{index}"], params[f"tv_c{index}"] = key, choice.get("column") or ""
            pairs.append(f"%(tv_k{index})s, NULLIF(btrim(r.raw ->> %(tv_c{index})s), '')")
        elif choice.get("from") == "ATTRIBUTE":
            params[f"tv_k{index}"], params[f"tv_a{index}"] = key, PREFIX + key
            pairs.append(f"%(tv_k{index})s, r.raw -> %(tv_a{index})s")
    # PostgreSQL takes at most 100 arguments a function call: 40 tags (80 arguments) a jsonb_build_object, as many calls as needed
    for start in range(0, len(pairs), 40):
        parts.append(f"jsonb_strip_nulls(jsonb_build_object({', '.join(pairs[start:start + 40])}))")
    return " || ".join(parts), params


def remember(record) -> None:
    """After the import: database values read for the file's people go into their attribute values, and the IDs matched are kept."""
    from apps.customers import attributes
    tags = (record.tag_values or {}).get("tags") or {}
    defs = _definitions()
    by_source: dict[str, list[tuple[str, object]]] = {}
    for key, choice in tags.items():
        definition = defs.get(choice.get("attribute") or "") if choice.get("from") == "ATTRIBUTE" else None
        if definition is not None and definition.source is not None and definition.source.kind == "DATABASE":
            by_source.setdefault(str(definition.source_id), []).append((key, definition))
    if not by_source:
        return
    from apps.customers.models import CustomerAttributeSyncRun
    from django.utils import timezone
    for source_id, pairs in by_source.items():
        source = pairs[0][1].source
        with session.tx():
            run = CustomerAttributeSyncRun.objects.create(tenant_id=record.tenant_id, source=source, trigger="IMPORT", status="RUNNING", started_at=timezone.now(),
                                                          params={"import_id": str(record.pk), "file": record.file_name})
        last = changed = matched = 0
        while True:
            with session.tx(), _conn().cursor() as cursor:
                cursor.execute("""SELECT r.row_number, r.matched_party_id, r.raw FROM contact_list_import_row r
                                   WHERE r.tenant_id = %s AND r.import_id = %s AND r.match_status IN ('MATCHED', 'UNMATCHED') AND r.row_number > %s
                                     AND r.raw ? %s ORDER BY r.row_number LIMIT 2000""", [str(record.tenant_id), str(record.pk), last, EXTERNAL + source_id])
                page = cursor.fetchall()
            if not page:
                break
            last = page[-1][0]
            rows, ids = {}, []
            for _, party, raw in page:
                raw = json.loads(raw) if isinstance(raw, str) else (raw or {})
                values = {definition.key: raw.get(PREFIX + key) for key, definition in pairs if raw.get(PREFIX + key) not in (None, "")}
                if values:
                    rows[party] = values
                    ids.append((raw[EXTERNAL + source_id], party))
            with session.tx():
                changed += attributes.store(source_id, rows, run.pk, replace=False)
                attributes.remember_ids(source.system, ids)
            matched += len(rows)
        with session.tx():
            CustomerAttributeSyncRun.objects.filter(pk=run.pk).update(status="DONE", finished_at=timezone.now(), people_read=matched, people_matched=matched,
                                                                      values_changed=changed)


# ---------------------------------------------------------------------------------------------------- B: the Tag Check
def tag_check(template, include: list[str], exclude: list[str], sample_above: int = 200_000) -> dict:
    """For the people of the chosen lists (after the lists left out and lists waiting for approval), each of the template's tags:
    how many have a value and where it comes from, in the order the send looks."""
    from apps.campaigns import service
    from apps.customers import attributes
    tags = template_tags(template)
    base = {"tenant": str(context.require().tenant_id), "include": [str(i) for i in include] or [""], "exclude": [str(i) for i in exclude] or [""]}
    if not tags:
        return {"template": {"id": str(template.pk), "name": template.name}, "people": 0, "tags": [], "short": 0, "fillable": []}
    defs = {d.key: d for d in attributes.definitions()}
    has_values = attributes.present()
    columns, params = [], dict(base)
    for index, tag in enumerate(tags):
        key = tag["key"]
        path = (tag.get("path") or key)
        member_key = path.split(".")[-1] if tag.get("reads") == "CAMPAIGN_LIST_MEMBER" else (path if tag.get("reads") == "CUSTOMER_ATTRIBUTE" else key)
        attribute = path if tag.get("reads") == "CUSTOMER_ATTRIBUTE" else key
        params[f"m{index}"], params[f"k{index}"], params[f"a{index}"] = member_key, key, attribute
        member = f"""EXISTS (SELECT 1 FROM contact_list_member m WHERE m.tenant_id = %(tenant)s AND m.party_id = p.party_id AND m.contact_list_id::text = ANY(%(include)s)
                              AND (NULLIF(btrim(m.custom_attributes ->> %(m{index})s), '') IS NOT NULL OR NULLIF(btrim(m.custom_attributes ->> %(k{index})s), '') IS NOT NULL))"""
        attr = (f"""EXISTS (SELECT 1 FROM customer_attribute_values av WHERE av.tenant_id = %(tenant)s AND av.party_id = p.party_id
                                  AND NULLIF(btrim(av.data ->> %(a{index})s), '') IS NOT NULL)""" if has_values and attribute in defs else "FALSE")
        if tag.get("reads") == "CUSTOMER_MASTER" and tag.get("path"):
            parts = tag["path"].split(".")
            if parts[0] in ("first_name", "last_name", "party_id") and len(parts) == 1:
                record = f"NULLIF(btrim(cm.{parts[0]}), '') IS NOT NULL"
            elif parts[0] in ("primary_address", "custom_attributes") and len(parts) == 2 and re.match(r"^[A-Za-z0-9_]+$", parts[1]):
                record = f"NULLIF(btrim(cm.{parts[0]} ->> '{parts[1]}'), '') IS NOT NULL"
            else:
                record = "FALSE"
        elif key in ("first_name", "last_name", "party_id"):
            record = f"NULLIF(btrim(cm.{key}), '') IS NOT NULL"
        else:
            record = f"NULLIF(btrim(cm.custom_attributes ->> %(k{index})s), '') IS NOT NULL"
        columns.append(f"count(*) FILTER (WHERE {member}), count(*) FILTER (WHERE NOT {member} AND {attr}), "
                       f"count(*) FILTER (WHERE NOT {member} AND NOT {attr} AND {record})")
    with _conn().cursor() as cursor:
        cursor.execute(service.AUDIENCE_BASE + " SELECT count(*) FROM kept", base)
        people = cursor.fetchone()[0]
        limit = f" ORDER BY md5(k.party_id) LIMIT {int(sample_above)}" if people > sample_above else ""
        cursor.execute(service.AUDIENCE_BASE + f""" SELECT {', '.join(columns)}
                             FROM (SELECT k.party_id FROM kept k{limit}) p LEFT JOIN customer_master cm ON cm.tenant_id = %(tenant)s AND cm.party_id = p.party_id""", params)
        counts = cursor.fetchone() if people else [0] * (3 * len(tags))
    scale = people / sample_above if people > sample_above else 1
    out, short, fillable = [], 0, []
    for index, tag in enumerate(tags):
        on_list, from_attributes, from_record = (int(round(n * scale)) for n in counts[index * 3:index * 3 + 3])
        with_value = min(people, on_list + from_attributes + from_record)
        sources = [("LIST", on_list), ("ATTRIBUTE", from_attributes), ("CUSTOMER", from_record)]
        main = max(sources, key=lambda pair: pair[1])
        attribute = defs.get((tag.get("path") if tag.get("reads") == "CUSTOMER_ATTRIBUTE" else None) or tag["key"])
        missing = people - with_value
        if missing > 0:
            short += 1
        out.append({"key": tag["key"], "label": tag["label"], "default": tag["default"], "with_value": with_value, "missing": max(0, missing),
                    "from": main[0] if main[1] else None, "by_source": {name: n for name, n in sources},
                    "attribute": attribute.key if attribute is not None else None})
    reading = [d for d in defs.values() if d.scope == "CUSTOMER" and d.source is not None and d.source.kind == "DATABASE" and d.source.is_active and d.source_field]
    for item in out:
        if item["missing"] > 0:
            fillable.append({"tag": item["key"], "attribute": item["attribute"] if item["attribute"] in {d.key for d in reading} else None})
    return {"template": {"id": str(template.pk), "name": template.name}, "people": people, "sampled": people > sample_above, "tags": out, "short": short,
            "fillable": fillable, "attributes": [{"key": d.key, "label": d.label, "source": d.source.name, "field": d.source_field} for d in reading]}
