"""The smaller steps (phase 5 of the journey gaps): what each needs, and what it does.

    PROFILE_UPDATE   {attribute, value}                                sets customer_master.custom_attributes[attribute] = value
                                                                       (Update Loyalty Tier stays the tier-specific step)
    LIST_ADD         {contact_list_id, contact_list_name}              adds the customer to the list (membership_source JOURNEY)
    LIST_REMOVE      {contact_list_id, contact_list_name}              removes them from it
    SPLIT            {by: ATTRIBUTE | RANDOM, attribute?, paths: [{key, label, values | share}], otherwise_label?}
                     ATTRIBUTE: the first path whose values hold the attribute's value (case-insensitive), else the OTHERWISE
                     path (always there). RANDOM: percentages that add up to 100, rolled once per customer and step and kept
                     (state_data.splits), so a retry never rolls again. The engine's older LOYALTY_TIER / CUSTOMER_TYPE splits
                     still run (steps._split).
"""
import re

ATTRIBUTE_KEY = re.compile(r"^[A-Za-z0-9_ .-]{1,100}$")
PATH_KEY = re.compile(r"^[A-Z0-9_]{1,50}$")
OTHERWISE = "OTHERWISE"
MAX_PATHS = 6
MAX_VALUE = 200


def profile_problem(config: dict) -> str | None:
    attribute = config.get("attribute")
    if not isinstance(attribute, str) or not attribute.strip():
        return "Choose the attribute to set."
    if not ATTRIBUTE_KEY.match(attribute.strip()):
        return "The attribute's name is letters, digits, spaces, dots, dashes and underscores."
    value = config.get("value")
    if value is None or (isinstance(value, str) and not value.strip()):
        return "Enter the value to set."
    if isinstance(value, bool) or not isinstance(value, (str, int, float)) or len(str(value)) > MAX_VALUE:
        return f"The value is text or a number of at most {MAX_VALUE} characters."
    return None


def list_problem(config: dict) -> str | None:
    return None if config.get("contact_list_id") else "Choose the contact list."


def split_paths(config: dict) -> list[dict]:
    return [path for path in (config.get("paths") or []) if isinstance(path, dict)]


def split_problem(config: dict) -> str | None:
    by = str(config.get("by") or "ATTRIBUTE").upper()
    if by in ("LOYALTY_TIER", "CUSTOMER_TYPE"):
        return None                                       # the engine's earlier form
    if by not in ("ATTRIBUTE", "RANDOM"):
        return "by is ATTRIBUTE or RANDOM."
    paths = split_paths(config)
    if not 1 <= len(paths) <= MAX_PATHS:
        return f"A split has 1 to {MAX_PATHS} paths besides Everyone Else."
    keys = set()
    total = 0.0
    for path in paths:
        key = str(path.get("key") or "").upper()
        if not PATH_KEY.match(key) or key == OTHERWISE:
            return "Each path has a key of capital letters, digits and underscores."
        if key in keys:
            return f"The path key {key} is used twice."
        keys.add(key)
        if by == "ATTRIBUTE":
            values = path.get("values")
            if not isinstance(values, list) or not values or any(not isinstance(v, (str, int, float)) or isinstance(v, bool) or str(v).strip() == "" for v in values):
                return "Each path lists the values that take it."
        else:
            share = path.get("share")
            if isinstance(share, bool) or not isinstance(share, (int, float)) or share <= 0:
                return "Each path has a share above 0."
            total += float(share)
    if by == "ATTRIBUTE":
        attribute = config.get("attribute")
        if not isinstance(attribute, str) or not ATTRIBUTE_KEY.match(attribute.strip()):
            return "Choose the attribute to split on."
    elif abs(total - 100) > 0.01:
        return "The shares add up to 100."
    return None


def configured(node_type: str, config: dict) -> bool:
    if node_type == "PROFILE_UPDATE":
        return profile_problem(config) is None
    if node_type in ("LIST_ADD", "LIST_REMOVE"):
        return list_problem(config) is None
    if node_type == "SPLIT":
        return split_problem(config) is None
    return True


def branch_keys(config: dict) -> list[str]:
    """The split's branch keys in order, Everyone Else last (ATTRIBUTE), or just the paths (RANDOM)."""
    keys = [str(path.get("key") or "").upper() for path in split_paths(config)]
    return keys + [OTHERWISE] if str(config.get("by") or "ATTRIBUTE").upper() == "ATTRIBUTE" else keys


def describe(node_type: str, config: dict) -> str:
    if node_type == "PROFILE_UPDATE":
        return f"Set {config.get('attribute') or 'an attribute'} to {config.get('value') if config.get('value') not in (None, '') else '?'}"
    if node_type == "LIST_ADD":
        return f"Add to {config.get('contact_list_name') or 'a list'}"
    if node_type == "LIST_REMOVE":
        return f"Remove from {config.get('contact_list_name') or 'a list'}"
    if node_type == "SPLIT":
        by = str(config.get("by") or "ATTRIBUTE").upper()
        n = len(split_paths(config))
        return f"Split at random, {n} paths" if by == "RANDOM" else f"Split by {str(config.get('attribute') or 'an attribute').replace('_', ' ')}, {n + 1} paths"
    return node_type.title()
