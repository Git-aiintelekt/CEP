"""Starter journeys: CEP's ten ready-made retail journeys, the same set for every tenant.

A starter is only a beginning: choosing one creates an ordinary journey whose version 1 is this graph (saved through the
same path as the canvas), which the tenant then edits freely. The starter itself never changes.

Each starter: key, name, category (LIFECYCLE / COMMERCE / LOYALTY / ENGAGEMENT), description, goal, population_mode,
reentry_policy, reentry_after_days and graph (the format in graph.py). Content steps arrive unconfigured: Email / SMS
have no template_id, Issue Coupon no coupon_id, Update Segment no segment_id — those are tenant-specific, so the tenant
chooses them in Build. A step's optional config.label is the title the canvas shows for it ("Cart reminder").
Entry triggers use the Setup modal's vocabulary (frontend entryTriggers.ts, listing.EVENT_FAMILY). At most one
Condition per path, and each Condition's two branches end in their own Exit, which is the shape the canvas reads back.
"""
from rest_framework.exceptions import ValidationError

from . import graph

X_STEP, Y_STEP = 280, 150


class _Builder:
    """Turns a nested step list into graph.py's wire format, laid out the way the canvas's toWireGraph lays it out."""

    def __init__(self):
        self.nodes = [{"key": "start", "type": "START", "config": {}, "position": {"x": 0, "y": 0}}]
        self.connections = []
        self.used: dict[str, int] = {}

    def _key(self, node_type: str) -> str:
        self.used[node_type] = self.used.get(node_type, 0) + 1
        return f"{node_type.lower().replace('_', '-')}-{self.used[node_type]}"

    def chain(self, steps, incoming, x, y):
        pending, cur_y = incoming, y
        for step in steps:
            node_type, config = step[0], step[1]
            key = config.pop("_key", None) or self._key(node_type)
            self.nodes.append({"key": key, "type": node_type, "config": config, "position": {"x": x, "y": cur_y}})
            for source, branch in pending:
                self.connections.append({"from": source, "to": key, "branch_key": branch, "label": None})
            cur_y += Y_STEP
            if node_type == "CONDITION":
                yes, no = step[2], step[3]
                yes_ends, yes_y = self.chain(yes, [(key, "YES")], x - X_STEP, cur_y)
                no_ends, no_y = self.chain(no, [(key, "NO")], x + X_STEP, cur_y)
                pending, cur_y = yes_ends + no_ends, max(yes_y, no_y) + Y_STEP
                continue
            pending = [] if node_type == "EXIT" else [(key, None)]
        return pending, cur_y


def _graph(entry_type: str, rule_definition: dict, steps: list) -> dict:
    builder = _Builder()
    builder.chain(steps, [("start", None)], 0, Y_STEP)
    return {"entry_rules": [{"entry_type": entry_type, "rule_definition": rule_definition}],
            "nodes": builder.nodes, "connections": builder.connections}


def _event(event_type: str) -> tuple[str, dict]:
    return "EVENT", {"event_type": event_type}


def wait(duration: int, unit: str = "DAYS"):
    return ("WAIT", {"duration": duration, "unit": unit})


def email(label: str, key: str | None = None):
    return ("EMAIL", {"label": label, **({"_key": key} if key else {})})


def sms(label: str):
    return ("SMS", {"label": label})


def coupon(label: str | None = None):
    return ("COUPON_ISSUE", {"label": label} if label else {})


def segment(action: str, label: str):
    return ("SEGMENT_UPDATE", {"action": action, "label": label})


def condition(check: str, yes: list, no: list, **config):
    return ("CONDITION", {"check": check, **config}, yes, no)


def _exit():
    return ("EXIT", {})


def _starter(key, name, category, description, goal, population_mode, reentry_policy, reentry_after_days, entry, steps):
    entry_type, rule_definition = entry
    return {"key": key, "name": name, "category": category, "description": description, "goal": goal,
            "population_mode": population_mode, "reentry_policy": reentry_policy, "reentry_after_days": reentry_after_days,
            "graph": _graph(entry_type, rule_definition, steps)}


STARTERS: list[dict] = [
    _starter(
        "welcome-series", "Welcome Series", "LIFECYCLE",
        "Greet new customers, then nudge the ones who haven't opened with an SMS and a first-purchase offer.",
        "First purchase within 30 days", "EVENT_TRIGGERED", "NEVER", None, _event("CUSTOMER_CREATED"),
        [email("Welcome", key="email-welcome"), wait(2),
         condition("OPENED", [email("Our story"), _exit()],
                   [sms("Welcome nudge"), wait(5), coupon("Welcome offer"), email("First-purchase offer"), _exit()],
                   message_step="email-welcome")]),
    _starter(
        "abandoned-cart-recovery", "Abandoned Cart Recovery", "COMMERCE",
        "Remind shoppers about their cart, then follow up with a coupon if they haven't bought.",
        "Order placed within 3 days", "EVENT_TRIGGERED", "AFTER_X_DAYS", 7, _event("CART_ABANDON"),
        [wait(1, "HOURS"), email("Cart reminder"), wait(1),
         condition("PURCHASED", [_exit()], [coupon(), sms("SMS with code"), _exit()])]),
    _starter(
        "post-purchase-thank-you", "Post-Purchase Thank You & Review", "COMMERCE",
        "Thank customers a few days after they buy, then ask them to review what they bought.",
        "Review submitted", "EVENT_TRIGGERED", "AFTER_X_DAYS", 30, _event("PURCHASE"),
        [wait(3), email("Thank you"), wait(7), email("Review request"), _exit()]),
    _starter(
        "first-to-second-purchase", "First to Second Purchase", "LIFECYCLE",
        "Turn first-time buyers into repeat customers with a coupon if they haven't come back in two weeks.",
        "Second purchase within 30 days", "EVENT_TRIGGERED", "NEVER", None, _event("FIRST_PURCHASE"),
        [wait(14), condition("PURCHASED", [_exit()], [coupon(), email("Something you'll love"), _exit()])]),
    _starter(
        "win-back-lapsed", "Win-Back Lapsed Customers", "ENGAGEMENT",
        "Bring lapsed customers back with a reminder, then an offer and a last-chance SMS if they don't return.",
        "Return purchase within 21 days", "CONTINUOUSLY_QUALIFYING", "AFTER_X_DAYS", 180,
        ("SEGMENT_CHANGE", {"change": "JOINED", "setup_note": "Choose your Lapsed segment"}),
        [email("We miss you"), wait(7),
         condition("PURCHASED", [segment("REMOVE", "Remove from Lapsed"), _exit()],
                   [coupon(), email("20% off offer"), wait(7), sms("Last chance"), _exit()])]),
    _starter(
        "birthday-reward", "Birthday Reward", "LIFECYCLE",
        "Send a birthday gift coupon, then remind customers by SMS before it expires.",
        "Birthday coupon redeemed", "EVENT_TRIGGERED", "AFTER_X_DAYS", 365, _event("BIRTHDAY"),
        [coupon("Birthday gift"), email("Happy birthday"), wait(7),
         condition("REDEEMED", [_exit()], [sms("Your gift expires soon"), _exit()])]),
    _starter(
        "loyalty-tier-upgrade", "Loyalty Tier Upgrade", "LOYALTY",
        "Welcome customers to their new loyalty tier, add them to your VIP segment and tell them about their perks.",
        "Tier perk used within 14 days", "EVENT_TRIGGERED", "EVERY_QUALIFYING_EVENT", None, _event("LOYALTY_TIER_CHANGE"),
        [email("Welcome to your new tier"), segment("ADD", "Add to VIP"), wait(3), sms("Your perks"), _exit()]),
    _starter(
        "coupon-expiry-reminder", "Coupon Expiry Reminder", "COMMERCE",
        "Remind customers to use a coupon before it expires, by SMS and then on its last day by email.",
        "Coupon redeemed before expiry", "EVENT_TRIGGERED", "EVERY_QUALIFYING_EVENT", None, _event("COUPON_ISSUED"),
        [wait(11), condition("REDEEMED", [_exit()], [sms("Expires in 3 days"), wait(2), email("Last day"), _exit()])]),
    _starter(
        "membership-anniversary", "Membership Anniversary", "LOYALTY",
        "Celebrate each membership anniversary with a message and a reward coupon.",
        "Repeat visit within 30 days", "EVENT_TRIGGERED", "AFTER_X_DAYS", 365, _event("ANNIVERSARY"),
        [email("Happy anniversary"), coupon("Anniversary reward"), _exit()]),
    _starter(
        "re-engagement-sunset", "Re-Engagement / Sunset", "ENGAGEMENT",
        "Ask unresponsive customers if they still want to hear from you, and move the silent ones to a sunset segment.",
        "Opens or clicks again", "EVENT_TRIGGERED", "AFTER_X_DAYS", 90, _event("NO_RESPONSE"),
        [email("Still want to hear from us?", key="email-still-want"), wait(5),
         condition("OPENED", [_exit()], [segment("ADD", "Add to Sunset"), _exit()], message_step="email-still-want")]),
]

BY_KEY = {starter["key"]: starter for starter in STARTERS}

COMMUNICATION = ("EMAIL", "SMS", "MMS")


def summary(graph_doc: dict) -> dict:
    """step_count (every step after the entry trigger) and channels (the message channels it sends on)."""
    nodes = [node for node in graph_doc.get("nodes", []) if node.get("type") != "START"]
    channels = sorted({node["type"] for node in nodes if node.get("type") in COMMUNICATION})
    return {"step_count": len(nodes), "channels": channels}


def catalogue() -> list[dict]:
    return [{"key": starter["key"], "name": starter["name"], "category": starter["category"], "description": starter["description"],
             "goal": starter["goal"], "population_mode": starter["population_mode"], "reentry_policy": starter["reentry_policy"],
             "reentry_after_days": starter["reentry_after_days"], "graph": starter["graph"], **summary(starter["graph"])}
            for starter in STARTERS]


def apply(journey, user_id, key: str):
    """Version 1 of a freshly created journey, saved through the same path as the canvas."""
    starter = BY_KEY.get(key)
    if starter is None:
        raise ValidationError({"starter": "Unknown starter."})
    return graph.create_first(journey, user_id, starter["graph"])
