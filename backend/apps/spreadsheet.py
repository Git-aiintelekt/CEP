"""Cells for a file people open in a spreadsheet (CSV exports): text that a spreadsheet would run as a formula is neutralised."""
import re

FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
PLAIN_NUMBER = re.compile(r"[\d\s().,+-]+\Z")                        # -12.50, +1 (555) 010-0100: no function can be called from these


def safe_cell(value):
    """the value as a CSV cell: empty for None; text starting = + - @ tab or carriage return gets a leading apostrophe,
    unless it is a plain number or phone number"""
    if value is None:
        return ""
    if isinstance(value, str) and value.startswith(FORMULA_START) and not PLAIN_NUMBER.match(value):
        return "'" + value
    return value


def safe_row(values) -> list:
    return [safe_cell(v) for v in values]
