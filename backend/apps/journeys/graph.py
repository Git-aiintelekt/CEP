"""A journey version's graph: its entry rules, nodes and connections, saved as one document.

The canvas sends the whole graph on every save (PUT /journeys/{id}/versions/{n}/graph/). It is checked here, written to
the journey_entry_rule / journey_node / journey_connection rows, and kept verbatim in journey_version.definition_snapshot.
Only a DRAFT version can be changed; a published version is read-only and editing it means starting a new version.

    {"entry_rules": [{"entry_type": "CUSTOMER_LIST", "rule_definition": {...}}],
     "nodes":       [{"key": "start", "type": "START", "config": {}, "position": {"x": 0, "y": 0}}],
     "connections": [{"from": "start", "to": "wait-1", "branch_key": null, "label": null}]}

Saving checks structure only (keys, types, edges). Whether the journey is complete enough to run is the publish check.
"""
import json
import re
import uuid

from django.db import transaction
from rest_framework.exceptions import ValidationError

from api.exceptions import Conflict

from . import conditions, goals, waits
from .models import Journey, JourneyConnection, JourneyEntryRule, JourneyNode, JourneyVersion

# block -> node_type -> node_family. Issue Coupon (COUPON_ISSUE) and Change Loyalty Tier (LOYALTY_CHANGE) invoke the
# cached Coupon/LoyaltyTier references in apps.customers (synced C360 copies, same treatment as Segment — see
# database/patches/0033_coupon_loyalty_tier.sql); config carries which one, same as SEGMENT_UPDATE's segment_id.
NODE_FAMILY = {
    "START": JourneyNode.NodeFamily.ENTRY,
    "WAIT": JourneyNode.NodeFamily.CONTROL,
    "CONDITION": JourneyNode.NodeFamily.LOGIC,         # Check
    "SPLIT": JourneyNode.NodeFamily.LOGIC,
    "EMAIL": JourneyNode.NodeFamily.COMMUNICATION,     # Send message
    "SMS": JourneyNode.NodeFamily.COMMUNICATION,
    "MMS": JourneyNode.NodeFamily.COMMUNICATION,
    "COUPON_ISSUE": JourneyNode.NodeFamily.ACTION,
    "LOYALTY_CHANGE": JourneyNode.NodeFamily.ACTION,
    "SEGMENT_UPDATE": JourneyNode.NodeFamily.ACTION,
    "GOAL": JourneyNode.NodeFamily.CONTROL,            # the outcome the journey is for (apps.journeys.goals)
    "EXIT": JourneyNode.NodeFamily.CONTROL,            # End
}
ENTRY_TYPES = set(JourneyEntryRule.EntryType.values)
MAX_NODES, MAX_CONNECTIONS, MAX_ENTRY_RULES = 200, 400, 10
MAX_CONFIG_BYTES = 64 * 1024
EVENT_TYPE = re.compile(r"^[A-Z][A-Z0-9_]{1,59}$")
# the step settings the canvas edits, checked on every save and published as GET /field-rules/ "journey_step"
STEP_LIMITS = {
    "label": {"max_length": 120},
    "duration": {"min_value": 0, "max_value": 999},
    "days": {"min_value": 0, "max_value": 365},
    "event_type": {"max_length": 60},
    "message_step": {"max_length": 100},
}

BLANK = {"entry_rules": [], "nodes": [{"key": "start", "type": "START", "config": {}, "position": {"x": 0, "y": 0}}], "connections": []}


def _text(value, limit: int, required: bool = False) -> str | None:
    if value is None or value == "":
        return "" if required else None
    if not isinstance(value, str):
        raise TypeError
    value = value.strip()
    if len(value) > limit:
        raise ValueError
    return value or ("" if required else None)


def _step_problem(config: dict) -> str | None:
    """The first setting of a step that breaks STEP_LIMITS, in words; blanks are left to readiness."""
    for name, limits in STEP_LIMITS.items():
        value = config.get(name)
        if value is None or value == "":
            continue
        if "max_length" in limits:
            if not isinstance(value, str) or len(value.strip()) > limits["max_length"]:
                return f"{name} is text of at most {limits['max_length']} characters."
            if name == "event_type" and not EVENT_TYPE.match(value.strip()):
                return "event_type is capital letters, digits and underscores, starting with a letter (e.g. CATEGORY_PURCHASE)."
        elif isinstance(value, bool) or not isinstance(value, int) or not limits["min_value"] <= value <= limits["max_value"]:
            return f"{name} is a whole number from {limits['min_value']} to {limits['max_value']}."
    return None


def _entry_rule_problem(entry_type: str, definition: dict) -> str | None:
    """What is wrong with a rule's conditions: the attribute trigger's rule, or any rule's Only Customers Where filters."""
    if entry_type == "SEGMENT_CHANGE" and str(definition.get("change_trigger") or "").upper() == conditions.ATTRIBUTE_MATCH:
        found = conditions.problem(definition.get("rule"), in_journey=False)
        if found:
            return f"rule: {found}"
    if definition.get("filters") is not None:
        found = conditions.problem(definition["filters"], in_journey=False)
        if found:
            return f"filters: {found}"
    return None


MESSAGE_TYPES = ("EMAIL", "SMS", "MMS")


def _reference_problem(rule: dict, types: dict) -> str | None:
    """A condition naming this journey's message or Condition step must name one that is in the graph."""
    for kind, key in conditions.references(rule):
        if kind == "message" and key != "*" and types.get(key) not in MESSAGE_TYPES:
            return f"The condition names a message step '{key}' that is not in this journey."
        if kind == "step" and types.get(key) != "CONDITION":
            return f"The condition names a Condition step '{key}' that is not in this journey."
    return None


def clean(graph) -> dict:
    """The graph in canonical form, or a ValidationError naming every problem found."""
    if not isinstance(graph, dict):
        raise ValidationError({"graph": "Send the graph as an object with entry_rules, nodes and connections."})
    errors: dict[str, list] = {}

    def problem(section: str, index, message: str):
        errors.setdefault(section, []).append(message if index is None else f"#{index + 1}: {message}")

    rules = []
    raw_rules = graph.get("entry_rules") or []
    if not isinstance(raw_rules, list) or len(raw_rules) > MAX_ENTRY_RULES:
        problem("entry_rules", None, f"Send a list of at most {MAX_ENTRY_RULES} entry rules.")
        raw_rules = []
    for index, rule in enumerate(raw_rules):
        rule = rule if isinstance(rule, dict) else {}
        if rule.get("entry_type") not in ENTRY_TYPES:
            problem("entry_rules", index, f"entry_type must be one of {', '.join(sorted(ENTRY_TYPES))}.")
            continue
        definition = rule.get("rule_definition", {})
        if not isinstance(definition, dict):
            problem("entry_rules", index, "rule_definition must be an object.")
            continue
        rule_problem = _entry_rule_problem(rule["entry_type"], definition)
        if rule_problem:
            problem("entry_rules", index, rule_problem)
            continue
        rules.append({"entry_type": rule["entry_type"], "rule_definition": definition})

    nodes, types = [], {}
    raw_nodes = graph.get("nodes")
    if not isinstance(raw_nodes, list) or not 1 <= len(raw_nodes) <= MAX_NODES:
        problem("nodes", None, f"Send a list of 1 to {MAX_NODES} nodes.")
        raw_nodes = []
    for index, node in enumerate(raw_nodes):
        node = node if isinstance(node, dict) else {}
        try:
            key = _text(node.get("key"), 100, required=True)
        except (TypeError, ValueError):
            key = ""
        if not key:
            problem("nodes", index, "Every node needs a key of 1 to 100 characters.")
            continue
        if key in types:
            problem("nodes", index, f"The key '{key}' is used by more than one node.")
            continue
        node_type = node.get("type")
        if node_type not in NODE_FAMILY:
            problem("nodes", index, f"type must be one of {', '.join(NODE_FAMILY)}.")
            continue
        config = node.get("config") or {}
        if not isinstance(config, dict) or len(json.dumps(config).encode()) > MAX_CONFIG_BYTES:
            problem("nodes", index, "config must be an object of at most 64 KB.")
            continue
        step_problem = _step_problem(config)
        if step_problem:
            problem("nodes", index, f"{key}: {step_problem}")
            continue
        position = node.get("position")
        if position is not None and not (isinstance(position, dict) and all(isinstance(position.get(axis), (int, float)) for axis in ("x", "y"))):
            problem("nodes", index, "position must be {x, y} with numbers.")
            continue
        types[key] = node_type
        nodes.append({"key": key, "type": node_type, "config": config,
                      "position": None if position is None else {"x": position["x"], "y": position["y"]}})
    starts = [key for key, node_type in types.items() if node_type == "START"]
    if raw_nodes and len(starts) != 1:
        problem("nodes", None, "A journey has exactly one Start step.")
    for index, node in enumerate(nodes):
        if node["type"] == "WAIT" and node["config"].get("mode"):
            wait_problem = waits.problem(node["config"])
            if wait_problem:
                problem("nodes", index, f"{node['key']}: {wait_problem}")
        if node["type"] == "GOAL" and node["config"].get("event_type"):
            goal_problem = goals.problem(node["config"])
            if goal_problem:
                problem("nodes", index, f"{node['key']}: {goal_problem}")
        if node["type"] == "CONDITION" and "rule" in node["config"]:
            rule_problem = conditions.problem(node["config"]["rule"], in_journey=True) or _reference_problem(node["config"]["rule"], types)
            if rule_problem:
                problem("nodes", index, f"{node['key']}: {rule_problem}")

    connections, seen = [], set()
    raw_connections = graph.get("connections") or []
    if not isinstance(raw_connections, list) or len(raw_connections) > MAX_CONNECTIONS:
        problem("connections", None, f"Send a list of at most {MAX_CONNECTIONS} connections.")
        raw_connections = []
    for index, edge in enumerate(raw_connections):
        edge = edge if isinstance(edge, dict) else {}
        source, target = edge.get("from"), edge.get("to")
        try:
            branch_key, label = _text(edge.get("branch_key"), 50), _text(edge.get("label"), 200)
        except (TypeError, ValueError):
            problem("connections", index, "branch_key is at most 50 characters and label at most 200.")
            continue
        if source not in types or target not in types:
            problem("connections", index, "from and to must be keys of nodes in this graph.")
        elif source == target:
            problem("connections", index, "A step cannot connect to itself.")
        elif types[target] == "START":
            problem("connections", index, "Nothing can lead into the Start step.")
        elif types[source] == "EXIT":
            problem("connections", index, "Nothing can follow an End step.")
        elif (source, target, branch_key) in seen:
            problem("connections", index, "This connection is listed twice.")
        else:
            seen.add((source, target, branch_key))
            connections.append({"from": source, "to": target, "branch_key": branch_key, "label": label})

    if errors:
        raise ValidationError(errors)
    return {"entry_rules": rules, "nodes": nodes, "connections": connections}


def _write(version: JourneyVersion, user_id, graph: dict) -> None:
    """Makes the version's rows match `graph` (already cleaned). Nodes keep their ids across saves, matched by key."""
    existing = {node.node_key: node for node in JourneyNode.objects.filter(journey_version=version)}
    JourneyConnection.objects.filter(journey_version=version).delete()
    JourneyNode.objects.filter(journey_version=version).exclude(node_key__in=[node["key"] for node in graph["nodes"]]).delete()

    changed, by_key = [], {}
    for node in graph["nodes"]:
        row = existing.get(node["key"])
        values = {"node_type": node["type"], "node_family": NODE_FAMILY[node["type"]], "config": node["config"],
                  "canvas_position": node["position"], "deleted_at": None}
        if row is None:
            row = JourneyNode.objects.create(journey_version=version, node_key=node["key"], created_by_id=user_id, **values)
        elif any(getattr(row, name) != value for name, value in values.items()):
            for name, value in values.items():
                setattr(row, name, value)
            row.updated_by_id = user_id
            changed.append(row)
        by_key[node["key"]] = row
    if changed:
        JourneyNode.objects.bulk_update(changed, ["node_type", "node_family", "config", "canvas_position", "deleted_at", "updated_by"])

    JourneyConnection.objects.bulk_create([
        JourneyConnection(journey_version=version, from_node=by_key[edge["from"]], to_node=by_key[edge["to"]],
                          branch_key=edge["branch_key"], condition_label=edge["label"], created_by_id=user_id)
        for edge in graph["connections"]])

    JourneyEntryRule.objects.filter(journey_version=version).delete()
    JourneyEntryRule.objects.bulk_create([
        JourneyEntryRule(journey_version=version, entry_type=rule["entry_type"], rule_definition=rule["rule_definition"], created_by_id=user_id)
        for rule in graph["entry_rules"]])

    version.definition_snapshot = graph
    version.updated_by_id = user_id
    version.save(update_fields=["definition_snapshot", "updated_by"])


def save(version: JourneyVersion, user_id, graph, row_version) -> JourneyVersion:
    """The whole graph of a DRAFT version, replaced at once. row_version is the one the editor loaded (409 when stale)."""
    cleaned = clean(graph)
    with transaction.atomic():
        locked = JourneyVersion.objects.select_for_update().select_related("journey").get(pk=version.pk)
        if locked.journey.deleted_at is not None or locked.journey.status == Journey.Status.ARCHIVED:
            raise Conflict("An archived journey cannot be changed.")
        if locked.status != JourneyVersion.Status.DRAFT:
            raise Conflict(f"Version {locked.version_number} is {locked.get_status_display().lower()} and can no longer be edited. Start a new version instead.")
        if str(row_version) != str(locked.row_version):
            raise Conflict("Someone else saved this journey after you opened it. Reload to see their changes.")
        _write(locked, user_id, cleaned)
    return JourneyVersion.objects.get(pk=version.pk)


# entry types whose rule names a contact list or segment by id: (rule_definition key, what it names)
REFERENCES = {"CUSTOMER_LIST": ("contact_list_id", "CONTACT_LIST"), "SEGMENT_CHANGE": ("segment_id", "SEGMENT")}


def _reference(rule: dict) -> tuple:
    """(key, kind) of what the rule names; a Date / Time rule names a contact list or a segment, whichever it has."""
    if rule.get("entry_type") == "DATE_TIME":
        definition = rule.get("rule_definition") or {}
        return ("contact_list_id", "CONTACT_LIST") if definition.get("contact_list_id") else ("segment_id", "SEGMENT") if definition.get("segment_id") else (None, None)
    return REFERENCES.get(rule.get("entry_type"), (None, None))


def _uuid(value) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError):
        return None


def name_references(rules: list[dict], tenant_id) -> list[dict]:
    """Gives each rule that names a contact list or segment a `reference_name`: what that list or segment is called
    now, or None when it is deleted or unknown (screens then say "Unknown list" / "Unknown segment", never the id).
    Rules naming nothing are left as they are. Two queries at most, however many rules."""
    from apps.contact_lists.models import ContactList
    from apps.customers.models import Segment

    wanted: dict[str, set[str]] = {"CONTACT_LIST": set(), "SEGMENT": set()}
    for rule in rules:
        key, kind = _reference(rule)
        target = _uuid((rule.get("rule_definition") or {}).get(key)) if key else None
        if target:
            wanted[kind].add(target)
    names: dict[str, dict[str, str]] = {"CONTACT_LIST": {}, "SEGMENT": {}}
    if wanted["CONTACT_LIST"]:
        names["CONTACT_LIST"] = {str(pk): name for pk, name in ContactList.objects.filter(
            tenant_id=tenant_id, pk__in=wanted["CONTACT_LIST"], deleted_at__isnull=True).values_list("id", "name")}
    if wanted["SEGMENT"]:
        names["SEGMENT"] = {str(pk): name for pk, name in Segment.objects.filter(
            tenant_id=tenant_id, pk__in=wanted["SEGMENT"]).values_list("id", "name")}
    for rule in rules:
        key, kind = _reference(rule)
        if key and (rule.get("rule_definition") or {}).get(key):
            rule["reference_name"] = names[kind].get(_uuid(rule["rule_definition"][key]) or "")
    return rules


def read(version: JourneyVersion) -> dict:
    """The graph as stored in the rows, with their ids (what the canvas loads). Entry rules that name a contact list
    or segment also carry its current name (name_references)."""
    nodes = list(JourneyNode.objects.filter(journey_version=version, deleted_at__isnull=True).order_by("created_at", "node_key"))
    keys = {node.id: node.node_key for node in nodes}
    rules = [{"id": str(rule.id), "entry_type": rule.entry_type, "rule_definition": rule.rule_definition}
             for rule in JourneyEntryRule.objects.filter(journey_version=version, deleted_at__isnull=True).order_by("created_at")]
    return {
        "entry_rules": name_references(rules, version.journey.tenant_id),
        "nodes": [{"id": str(node.id), "key": node.node_key, "type": node.node_type, "family": node.node_family,
                   "config": node.config, "position": node.canvas_position} for node in nodes],
        "connections": [{"id": str(edge.id), "from": keys[edge.from_node_id], "to": keys[edge.to_node_id],
                         "branch_key": edge.branch_key, "label": edge.condition_label}
                        for edge in JourneyConnection.objects.filter(journey_version=version, deleted_at__isnull=True).order_by("created_at")
                        if edge.from_node_id in keys and edge.to_node_id in keys],
    }


def _strip_ids(graph: dict) -> dict:
    return {"entry_rules": [{k: v for k, v in rule.items() if k not in ("id", "reference_name")} for rule in graph["entry_rules"]],
            "nodes": [{k: v for k, v in node.items() if k not in ("id", "family")} for node in graph["nodes"]],
            "connections": [{k: v for k, v in edge.items() if k != "id"} for edge in graph["connections"]]}


def create_first(journey: Journey, user_id, graph=None) -> JourneyVersion:
    """Version 1 of a new journey: a starter's graph, or a lone Start step."""
    cleaned = clean(graph if graph is not None else BLANK)
    version = JourneyVersion.objects.create(journey=journey, version_number=1, status=JourneyVersion.Status.DRAFT, created_by_id=user_id)
    _write(version, user_id, cleaned)
    return version


def new_version(journey: Journey, user_id, from_number: int | None = None) -> JourneyVersion:
    """The next version as a DRAFT copy of `from_number` (default: the newest). One draft at a time."""
    with transaction.atomic():
        Journey.objects.select_for_update().get(pk=journey.pk)
        versions = JourneyVersion.objects.filter(journey=journey)
        draft = versions.filter(status=JourneyVersion.Status.DRAFT).order_by("-version_number").first()
        if draft is not None:
            raise Conflict(f"Version {draft.version_number} is still a draft. Edit that one instead of starting another.")
        source = (versions.filter(version_number=from_number) if from_number else versions.order_by("-version_number")).first()
        if source is None:
            raise ValidationError({"from_version": "This journey has no such version."})
        number = (versions.order_by("-version_number").values_list("version_number", flat=True).first() or 0) + 1
        version = JourneyVersion.objects.create(journey=journey, version_number=number, status=JourneyVersion.Status.DRAFT, created_by_id=user_id)
        _write(version, user_id, clean(_strip_ids(read(source))))
    return version
