"""The Excel export (XlsxWriter): a report in its saved view. A grid is one sheet, "Rows", with a bold frozen header, a
filter, column widths and a number format per column; a pivot or a hierarchy comes as its reshaped sheet first, with its
totals, and the grouped rows as "Rows". Masked values are the mask, as text.
"""
import io
from datetime import date, datetime

import xlsxwriter

from apps.insights import shape

MASK = "•••••"
NUMBER_FORMATS = {"integer": "#,##0", "decimal": "#,##0.00", "money": "#,##0.00", "percent": '0.0"%"', "date": "yyyy-mm-dd", "datetime": "yyyy-mm-dd hh:mm"}
BUCKET_FORMATS = {"day": "yyyy-mm-dd", "week": "yyyy-mm-dd", "month": "mmm yyyy", "year": "yyyy"}


def _value(column: dict, value):
    """what goes in the cell: a real date for a date column, a quarter as text, the rest as it is"""
    if value is None or column.get("masked"):
        return value
    if column.get("bucket") == "quarter":
        try:
            d = date.fromisoformat(str(value)[:10])
            return f"Q{(d.month - 1) // 3 + 1} {d.year}"
        except ValueError:
            return value
    if column.get("type") in ("date", "datetime") or column.get("bucket"):
        text = str(value)
        try:
            return datetime.fromisoformat(text[:19]) if len(text) > 10 else date.fromisoformat(text[:10])
        except ValueError:
            return value
    return value


def _width(label: str, column: dict) -> int:
    base = max(12, min(40, len(label) + 4))
    return max(base, 16 if column.get("type") in ("date", "datetime") else base)


def build(name: str, columns: list[dict], rows: list[list], view: dict | None) -> bytes:
    buffer = io.BytesIO()
    book = xlsxwriter.Workbook(buffer, {"in_memory": True, "remove_timezone": True})
    header = book.add_format({"bold": True, "bg_color": "#F2F3F7", "bottom": 1, "border_color": "#CFD2DC"})
    total = book.add_format({"bold": True, "top": 1, "border_color": "#CFD2DC"})
    group = book.add_format({"bold": True, "bg_color": "#F9FAFB"})
    formats = {key: book.add_format({"num_format": value}) for key, value in {**NUMBER_FORMATS, **BUCKET_FORMATS}.items()}
    total_formats = {key: book.add_format({"num_format": value, "bold": True, "top": 1, "border_color": "#CFD2DC"}) for key, value in NUMBER_FORMATS.items()}
    kind = (view or {}).get("type", "grid")
    across = (view or {}).get("across")

    def write_rows_sheet(title: str):
        sheet = book.add_worksheet(title)
        sheet.freeze_panes(1, 0)
        for c, column in enumerate(columns):
            sheet.write(0, c, column["label"] + (" (masked)" if column.get("masked") else ""), header)
            sheet.set_column(c, c, _width(column["label"], column), formats.get(_format_key(column)))
        for r, row in enumerate(rows, start=1):
            for c, column in enumerate(columns):
                value = _value(column, row[c])
                if isinstance(value, (date, datetime)):
                    sheet.write_datetime(r, c, value if isinstance(value, datetime) else datetime(value.year, value.month, value.day), formats.get(_format_key(column)))
                else:
                    sheet.write(r, c, value)
        if rows:
            sheet.autofilter(0, 0, len(rows), len(columns) - 1)
        return sheet

    if kind == "pivot":
        table = shape.pivot(columns, rows, across)
        if "reason" not in table:
            sheet = book.add_worksheet("Pivot")
            sheet.freeze_panes(1, len(table["row_columns"]))
            measure = table["measure"]
            fmt = formats.get(_format_key(measure))
            for c, label in enumerate(table["header"]):
                text = label if isinstance(label, str) else _label(table["across"], label)
                sheet.write(0, c, text, header)
                sheet.set_column(c, c, max(12, min(40, len(str(text)) + 4)))
            for r, row in enumerate(table["rows"], start=1):
                for c, value in enumerate(row):
                    sheet.write(r, c, _value(table["row_columns"][c], value) if c < len(table["row_columns"]) else value, None if c < len(table["row_columns"]) else fmt)
            r = len(table["rows"]) + 1
            for c, value in enumerate(table["total"]):
                sheet.write(r, c, value, total if c < len(table["row_columns"]) else total_formats.get(_format_key(measure), total))
    elif kind == "hierarchy":
        table = shape.hierarchy(columns, rows)
        if "reason" not in table:
            sheet = book.add_worksheet("Hierarchy")
            sheet.freeze_panes(1, 1)
            for c, label in enumerate(table["header"]):
                sheet.write(0, c, label, header)
                sheet.set_column(c, c, 28 if c == 0 else 16)
            for r, (depth, is_group, cells) in enumerate(table["rows"], start=1):
                sheet.write(r, 0, ("    " * depth) + str(_label(table["levels"][depth], cells[0])), group if is_group else None)
                for m, value in enumerate(cells[1:], start=1):
                    fmt = formats.get(_format_key(table["measures"][m - 1]))
                    sheet.write(r, m, value, (book.add_format({"bold": True, "bg_color": "#F9FAFB", "num_format": fmt.num_format}) if is_group and fmt else (group if is_group else fmt)))
            r = len(table["rows"]) + 1
            for c, value in enumerate(table["total"]):
                sheet.write(r, c, value, total if c == 0 else total_formats.get(_format_key(table["measures"][c - 1]), total))
    write_rows_sheet("Rows")
    book.close()
    return buffer.getvalue()


def _format_key(column: dict) -> str | None:
    if column.get("masked"):
        return None
    return column.get("bucket") if column.get("bucket") else (column.get("format") or None)


def _label(column: dict, value) -> str:
    """a dimension's value as text, dates by their bucket"""
    if value is None:
        return ""
    shown = _value(column, value)
    if isinstance(shown, datetime):
        shown = shown.date()
    if isinstance(shown, date):
        bucket = column.get("bucket")
        if bucket == "month":
            return shown.strftime("%b %Y")
        if bucket == "year":
            return str(shown.year)
        return shown.isoformat()
    return str(shown)
