"""How reports treat a Report Database: how long one report may read it and how many may read it at once
(docs/mockups/report-database-limits.html, option B). Workspace administrators pick a preset in the Connect a Database / Edit
dialog, or Custom with the two values; the next report uses them, nothing restarts.

    effective(connection, workspace_limits) -> {"profile", "timeout_s", "concurrent"}

Standard follows the workspace's own limits (15 seconds and 4 reports unless the back-office raised them); the other presets
are fixed. The columns arrive with patch 0074: a connection read before it has none, and counts as Standard.
"""
PROFILES = ("STANDARD", "LARGE", "LIVE", "CUSTOM")
PRESETS = {"LARGE": (60, 2), "LIVE": (60, 1)}                         # seconds, reports at once
TIMEOUT_RANGE = (5, 110)                                               # under the 120 s the web server allows a request
CONCURRENT_RANGE = (1, 4)


def effective(connection: dict, workspace_limits: dict) -> dict:
    profile = connection.get("limit_profile") or "STANDARD"
    standard = (max(1, int(workspace_limits.get("statement_timeout_ms", 15_000)) // 1000), min(CONCURRENT_RANGE[1], int(workspace_limits.get("concurrent", 4))))
    if profile in PRESETS:
        timeout_s, concurrent = PRESETS[profile]
    elif profile == "CUSTOM":
        timeout_s = connection.get("query_timeout_s") or standard[0]
        concurrent = connection.get("max_concurrent") or standard[1]
    else:
        profile, (timeout_s, concurrent) = "STANDARD", standard
    return {"profile": profile, "timeout_s": int(timeout_s), "concurrent": int(concurrent)}


def own_timeout_s(connection: dict) -> int:
    """The time limit the connection sets itself (0 for Standard, which follows the workspace): reading the database's catalogue
    takes at least this long."""
    profile = connection.get("limit_profile") or "STANDARD"
    if profile in PRESETS:
        return PRESETS[profile][0]
    if profile == "CUSTOM":
        return int(connection.get("query_timeout_s") or 0)
    return 0


def parse(body: dict, current: dict | None) -> tuple[dict, dict]:
    """The limits from a save: (values, errors). Only Custom keeps its own numbers; a preset stores none."""
    errors = {}
    profile = str(body.get("limit_profile") or (current or {}).get("limit_profile") or "STANDARD").upper()
    if profile not in PROFILES:
        errors["limit_profile"] = "Standard, Large or Slow, Live Production Database, or Custom."
        profile = "STANDARD"
    timeout_s = concurrent = None
    if profile == "CUSTOM":
        timeout_s = _number(body.get("query_timeout_s", (current or {}).get("query_timeout_s")), TIMEOUT_RANGE, "query_timeout_s", "A time limit from 5 to 110 seconds.", errors)
        concurrent = _number(body.get("max_concurrent", (current or {}).get("max_concurrent")), CONCURRENT_RANGE, "max_concurrent", "From 1 to 4 reports at once.", errors)
    return {"limit_profile": profile, "query_timeout_s": timeout_s, "max_concurrent": concurrent}, errors


def _number(value, bounds: tuple[int, int], key: str, words: str, errors: dict) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        errors[key] = words
        return None
    if not bounds[0] <= number <= bounds[1]:
        errors[key] = words
        return None
    return number
