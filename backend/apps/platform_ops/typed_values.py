"""A global parameter's value as a person types and reads it, rather than as the JSONB column stores it.

`platform_setting.value` is one JSON column that holds text, numbers, yes/no, lists and small objects; `value_type`
says which. The back-office form shows each kind with a fitting field (a number box, a switch, one line per list
entry, one labelled box per object key) and these functions turn typed text into the stored value and back.
"""
from __future__ import annotations

import json

KINDS = (
    ("STRING", "Text"),
    ("INTEGER", "Whole number"),
    ("DECIMAL", "Number"),
    ("BOOLEAN", "Yes / no"),
    ("LIST", "List"),
    ("OBJECT", "Several values"),
)
KIND_NAMES = dict(KINDS)

YES = {"yes", "y", "true", "on", "1"}
NO = {"no", "n", "false", "off", "0"}


def kind_of(value) -> str:
    """The kind a stored value is, for an object member that has no declared type of its own."""
    if isinstance(value, bool):
        return "BOOLEAN"
    if isinstance(value, int):
        return "INTEGER"
    if isinstance(value, float):
        return "DECIMAL"
    if isinstance(value, list):
        return "LIST"
    if isinstance(value, dict):
        return "OBJECT"
    return "STRING"


class ValueProblem(ValueError):
    """Why typed text cannot be the value asked for, in words for the form."""


def parse_scalar(kind: str, text: str | None):
    """Typed text as a STRING / INTEGER / DECIMAL / BOOLEAN value; empty text is the empty string, or nothing for a number."""
    raw = (text or "").strip()
    if kind == "STRING":
        return raw
    if raw == "":
        return None
    if kind == "INTEGER":
        try:
            return int(raw)
        except ValueError as error:
            raise ValueProblem("A whole number, such as 72.") from error
    if kind == "DECIMAL":
        try:
            number = float(raw)
        except ValueError as error:
            raise ValueProblem("A number, such as 0.5.") from error
        return int(number) if number.is_integer() and "." not in raw else number
    if kind == "BOOLEAN":
        if raw.lower() in YES:
            return True
        if raw.lower() in NO:
            return False
        raise ValueProblem("Yes or no.")
    raise ValueProblem(f"Unknown kind {kind}.")


def parse_lines(text: str | None) -> list:
    """A LIST typed one entry per line (commas work too); blank lines are skipped, entries are text."""
    return [part.strip() for chunk in (text or "").splitlines() for part in chunk.split(",") if part.strip()]


def parse_loose(text: str) -> object:
    """A member value typed without a declared kind: yes/no, a number, nothing, else the text as it is."""
    raw = text.strip()
    if raw == "":
        return None
    if raw.lower() in YES - {"1"} or raw.lower() in NO - {"0"}:
        return raw.lower() in YES
    if raw.lower() in ("null", "none"):
        return None
    for cast in (int, float):
        try:
            return cast(raw)
        except ValueError:
            pass
    return raw


def parse_object_lines(text: str | None) -> dict:
    """An OBJECT typed as `key: value` lines, for the add form where no keys exist yet to show boxes for."""
    result: dict = {}
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        key, separator, value = line.partition(":")
        if not separator or not key.strip():
            raise ValueProblem("One value per line, written as key: value.")
        result[key.strip()] = parse_loose(value)
    return result


def parse_typed(kind: str, text: str | None):
    """The add form: one text box read according to the kind chosen beside it."""
    if kind == "LIST":
        return parse_lines(text)
    if kind == "OBJECT":
        raw = (text or "").strip()
        if raw.startswith("{"):
            try:
                return json.loads(raw)
            except json.JSONDecodeError as error:
                raise ValueProblem("Not valid JSON; or write it as key: value lines.") from error
        return parse_object_lines(text)
    value = parse_scalar(kind, text)
    if value is None and kind != "STRING":
        raise ValueProblem("Type the value.")
    return value


def describe(kind: str, value) -> str:
    """What the list column shows: the value as words, never as JSON."""
    if value is None:
        return "—"
    if kind == "BOOLEAN" or isinstance(value, bool):
        return "Yes" if value else "No"
    if kind == "LIST" or isinstance(value, list):
        return ", ".join(str(item) for item in value) if value else "none"
    if kind == "OBJECT" or isinstance(value, dict):
        return ", ".join(f"{key}: {describe(kind_of(item), item)}" for key, item in value.items()) if value else "none"
    text = str(value)
    return text if text != "" else "—"
