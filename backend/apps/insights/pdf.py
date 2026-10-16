"""The PDF export (ReportLab, pure Python: no system packages on any server): a report in its saved view, or a dashboard
with its tiles on its period, styled for paper. A4 in portrait, landscape when the table is wide; the C360 header with
the workspace and the date; a bold header row that repeats on every page; totals in bold; page numbers.

    report(name, columns, rows, view, totals, *, workspace, when, subtitle) -> bytes
    dashboard(name, description, period_words, tiles, *, workspace, when) -> bytes
        tiles: [{"title", "kind": "figure" | "view", ...the tile's payload}] in the dashboard's order
"""
import io
from datetime import date, datetime

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.insights import shape

INK = colors.HexColor("#17181c")
INK_800 = colors.HexColor("#4b4f5b")
INK_700 = colors.HexColor("#6b6f7b")
LINE = colors.HexColor("#cfd2dc")
LINE_SUBTLE = colors.HexColor("#e2e4eb")
SUBTLE = colors.HexColor("#f9fafb")
BRAND = colors.HexColor("#3863db")
PALETTE = [colors.HexColor(c) for c in ("#3863db", "#a8488f", "#418eae", "#9ea2ad", "#b08a6e", "#7570d4")]
MASK = "•••••"
MAX_ROWS = 2_000

_styles = getSampleStyleSheet()
TITLE = ParagraphStyle("c360-title", parent=_styles["Title"], fontName="Helvetica-Bold", fontSize=16, leading=20, alignment=0, textColor=INK, spaceAfter=2)
SUB = ParagraphStyle("c360-sub", parent=_styles["Normal"], fontName="Helvetica", fontSize=9, leading=12, textColor=INK_800, spaceAfter=10)
H2 = ParagraphStyle("c360-h2", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=INK, spaceBefore=8, spaceAfter=4)
BODY = ParagraphStyle("c360-body", parent=_styles["Normal"], fontName="Helvetica", fontSize=8.5, leading=11, textColor=INK)
BODY_RIGHT = ParagraphStyle("c360-body-right", parent=BODY, alignment=TA_RIGHT)
SMALL = ParagraphStyle("c360-small", parent=_styles["Normal"], fontName="Helvetica", fontSize=8, leading=10, textColor=INK_700)
FIGURE = ParagraphStyle("c360-figure", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=INK)


# ---------------------------------------------------------------------------------------------------- words
def _number(column: dict, value) -> str:
    if value is None:
        return "—"
    if column.get("masked"):
        return str(value)
    fmt = column.get("format")
    try:
        if fmt == "integer":
            return f"{int(round(float(value))):,}"
        if fmt in ("decimal", "money"):
            return f"{float(value):,.2f}"
        if fmt == "percent":
            return f"{float(value):.1f}%"
    except (TypeError, ValueError):
        return str(value)
    return str(value)


def _date_words(column: dict, value) -> str:
    text = str(value)
    try:
        d = date.fromisoformat(text[:10])
    except ValueError:
        return text
    bucket = column.get("bucket")
    if bucket == "month":
        return d.strftime("%b %Y")
    if bucket == "quarter":
        return f"Q{(d.month - 1) // 3 + 1} {d.year}"
    if bucket == "year":
        return str(d.year)
    if column.get("type") == "datetime" and not bucket and len(text) > 10:
        try:
            return datetime.fromisoformat(text[:19]).strftime("%d %b %Y %H:%M")
        except ValueError:
            return text
    return d.strftime("%d %b %Y")


def cell_text(column: dict, value) -> str:
    if value is None:
        return "—"
    if column.get("masked"):
        return str(value)
    if column.get("bucket") or column.get("type") in ("date", "datetime"):
        return _date_words(column, value)
    if column.get("type") == "number" or column.get("aggregate"):
        return _number(column, value)
    if column.get("type") == "boolean":
        return "Yes" if value else "No"
    return str(value)


def _is_numeric(column: dict) -> bool:
    return not column.get("masked") and (column.get("type") == "number" or bool(column.get("aggregate")))


# ---------------------------------------------------------------------------------------------------- the frame
def _page(workspace: str, when: str):
    def draw(canvas, doc):
        canvas.saveState()
        width, height = doc.pagesize
        canvas.setFont("Helvetica-Bold", 9)
        canvas.setFillColor(BRAND)
        canvas.drawString(doc.leftMargin, height - 12 * mm, "C360 Insights")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(INK_700)
        canvas.drawRightString(width - doc.rightMargin, height - 12 * mm, f"{workspace} · {when}")
        canvas.setStrokeColor(LINE_SUBTLE)
        canvas.line(doc.leftMargin, height - 14 * mm, width - doc.rightMargin, height - 14 * mm)
        canvas.drawRightString(width - doc.rightMargin, 9 * mm, f"Page {doc.page}")
        canvas.restoreState()
    return draw


def _document(buffer, wide: bool):
    size = landscape(A4) if wide else A4
    return SimpleDocTemplate(buffer, pagesize=size, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=20 * mm, bottomMargin=16 * mm, title="C360 Insights")


def _table(header: list[str], body: list[list[str]], numeric: list[bool], *, total: list[str] | None = None, group_rows: set[int] = frozenset(), indents: dict[int, int] | None = None) -> Table:
    """a paper table: the header repeats, numbers right-aligned, hairlines, bold totals and group rows"""
    rows = [[Paragraph(h, BODY_RIGHT if numeric[i] else BODY) for i, h in enumerate(header)]]
    for r, line in enumerate(body):
        rows.append([Paragraph((" " * 4 * (indents or {}).get(r, 0)) + (c or ""), BODY_RIGHT if numeric[i] else BODY) for i, c in enumerate(line)])
    if total:
        rows.append([Paragraph(c or "", BODY_RIGHT if numeric[i] else BODY) for i, c in enumerate(total)])
    table = Table(rows, repeatRows=1, hAlign="LEFT")
    style = [("LINEBELOW", (0, 0), (-1, 0), 0.8, LINE), ("BACKGROUND", (0, 0), (-1, 0), SUBTLE), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
             ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINE_SUBTLE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
             ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]
    for r in group_rows:
        style.append(("BACKGROUND", (0, r + 1), (-1, r + 1), SUBTLE))
    if total:
        style += [("LINEABOVE", (0, -1), (-1, -1), 0.8, LINE), ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold")]
    table.setStyle(TableStyle(style))
    return table


def _bold(cells: list[str]) -> list[str]:
    return [f"<b>{c}</b>" if c else "" for c in cells]


# ---------------------------------------------------------------------------------------------------- the views
def _grid_flowables(columns: list[dict], rows: list[list]) -> list:
    header = [c["label"] + (" (masked)" if c.get("masked") else "") for c in columns]
    numeric = [_is_numeric(c) for c in columns]
    body = [[cell_text(c, row[i]) for i, c in enumerate(columns)] for row in rows[:MAX_ROWS]]
    out = [_table(header, body, numeric)]
    if len(rows) > MAX_ROWS:
        out.append(Paragraph(f"The first {MAX_ROWS:,} of {len(rows):,} rows. The Excel and CSV exports carry them all.", SMALL))
    return out


def _pivot_flowables(columns: list[dict], rows: list[list], across: str | None, totals) -> list:
    table = shape.pivot(columns, rows, across, totals=totals)
    if "reason" in table:
        return [Paragraph(table["reason"], SMALL)]
    n = len(table["row_columns"])
    measure = table["measure"]
    header = [*(c["label"] for c in table["row_columns"]), *(cell_text(table["across"], v) for v in table["column_values"]), "Total"]
    numeric = [False] * n + [True] * (len(header) - n)
    body = [[*(cell_text(table["row_columns"][i], v) for i, v in enumerate(line[:n])), *(_number(measure, v) for v in line[n:])] for line in table["rows"]]
    total = _bold(["Total", *([""] * (n - 1)), *(_number(measure, v) for v in table["total"][n:])])
    return [Paragraph(f"{measure['label']} · {', '.join(c['label'] for c in table['row_columns'])} down, {table['across']['label']} across", SMALL), Spacer(1, 3), _table(header, body, numeric, total=total)]


def _hierarchy_flowables(columns: list[dict], rows: list[list], totals) -> list:
    table = shape.hierarchy(columns, rows, totals=totals)
    if "reason" in table:
        return [Paragraph(table["reason"], SMALL)]
    measures = table["measures"]
    header = [table["header"][0], *(m["label"] for m in measures)]
    numeric = [False] + [True] * len(measures)
    body, groups, indents = [], set(), {}
    for r, (depth, is_group, cells) in enumerate(table["rows"]):
        label = cell_text(table["levels"][depth], cells[0])
        values = [_number(m, v) for m, v in zip(measures, cells[1:])]
        body.append(_bold([label, *values]) if is_group else [label, *values])
        indents[r] = depth
        if is_group:
            groups.add(r)
    total = _bold(["Total", *(_number(m, v) for m, v in zip(measures, table["total"][1:]))])
    return [Paragraph(", then ".join(level["label"] for level in table["levels"]), SMALL), Spacer(1, 3), _table(header, body, numeric, total=total, group_rows=groups, indents=indents)]


def _chart_flowables(columns: list[dict], rows: list[list], across: str | None, width: float) -> list:
    """bars: the first dimension along the bottom, a series per value of the dimension across, else per measure; the numbers under it"""
    dims = [(i, c) for i, c in enumerate(columns) if not c.get("aggregate")]
    meas = [(i, c) for i, c in enumerate(columns) if c.get("aggregate")]
    spread = next(((i, c) for i, c in dims if c["key"] == across), None)
    down = [(i, c) for i, c in dims if not spread or c["key"] != across]
    if not meas or not down:
        return [Paragraph("A chart needs a dimension along the bottom and a value to total.", SMALL)]
    axis_i, axis = down[0]
    m_i, measure = meas[0]
    categories = []
    for row in rows:
        key = str(row[axis_i]) if row[axis_i] is not None else ""
        if key not in [k for k, _ in categories]:
            categories.append((key, cell_text(axis, row[axis_i])))
    categories = categories[:24]
    at = {k: i for i, (k, _) in enumerate(categories)}
    series = []
    if spread:
        s_i, s_col = spread
        for value in list(dict.fromkeys(str(r[s_i]) if r[s_i] is not None else "" for r in rows))[:6]:
            values = [0.0] * len(categories)
            for row in rows:
                key = str(row[axis_i]) if row[axis_i] is not None else ""
                if (str(row[s_i]) if row[s_i] is not None else "") == value and key in at:
                    values[at[key]] += float(row[m_i] or 0)
            series.append((cell_text(s_col, value), values))
    else:
        for i, c in meas[:6]:
            values = [0.0] * len(categories)
            for row in rows:
                key = str(row[axis_i]) if row[axis_i] is not None else ""
                if key in at:
                    values[at[key]] += float(row[i] or 0)
            series.append((c["label"], values))
    height = 70 * mm
    drawing = Drawing(width, height + 14 * mm)
    chart = VerticalBarChart()
    chart.x, chart.y, chart.width, chart.height = 14 * mm, 12 * mm, width - 20 * mm, height - 6 * mm
    chart.data = [values for _, values in series]
    chart.categoryAxis.categoryNames = [label for _, label in categories]
    chart.categoryAxis.labels.fontName, chart.categoryAxis.labels.fontSize = "Helvetica", 7
    chart.categoryAxis.labels.angle = 30 if len(categories) > 8 else 0
    chart.categoryAxis.labels.dy = -8 if len(categories) > 8 else -2
    chart.valueAxis.labels.fontName, chart.valueAxis.labels.fontSize = "Helvetica", 7
    chart.valueAxis.valueMin = 0
    chart.valueAxis.strokeColor = LINE
    chart.categoryAxis.strokeColor = LINE
    chart.groupSpacing = 6
    chart.barSpacing = 1
    for i in range(len(series)):
        chart.bars[i].fillColor = PALETTE[i % len(PALETTE)]
        chart.bars[i].strokeColor = None
    drawing.add(chart)
    if len(series) > 1:
        legend = Legend()
        legend.x, legend.y = 14 * mm, height + 8 * mm
        legend.fontName, legend.fontSize = "Helvetica", 7
        legend.alignment = "right"
        legend.columnMaximum = 1
        legend.colorNamePairs = [(PALETTE[i % len(PALETTE)], label) for i, (label, _) in enumerate(series)]
        drawing.add(legend)
    drawing.add(String(14 * mm, height + 10 * mm if len(series) <= 1 else height + 13 * mm, f"{measure['label']} by {axis['label']}", fontName="Helvetica-Bold", fontSize=8, fillColor=INK))
    header = [axis["label"], *(label for label, _ in series)]
    body = [[label, *(_number(measure, values[i]) for _, values in series)] for i, (_, label) in enumerate(categories)]
    return [drawing, Spacer(1, 4), _table(header, body, [False] + [True] * len(series))]


def _view_flowables(columns, rows, view: dict | None, totals, width: float) -> list:
    kind = (view or {}).get("type", "grid")
    across = (view or {}).get("across")
    if kind == "pivot":
        return _pivot_flowables(columns, rows, across, totals)
    if kind == "hierarchy":
        return _hierarchy_flowables(columns, rows, totals)
    if kind == "chart":
        return _chart_flowables(columns, rows, across, width)
    return _grid_flowables(columns, rows)


VIEW_WORDS = {"grid": "Grid", "chart": "Chart", "hierarchy": "Hierarchy", "pivot": "Pivot"}


# ---------------------------------------------------------------------------------------------------- the documents
def report(name: str, columns: list[dict], rows: list[list], view: dict | None, totals=None, *, workspace: str, when: str, subtitle: str | None = None) -> bytes:
    kind = (view or {}).get("type", "grid")
    wide = kind in ("grid", "pivot") and (len(columns) > 6 or (kind == "pivot" and len(rows) > 0))
    buffer = io.BytesIO()
    doc = _document(buffer, wide)
    width = doc.width
    story = [Paragraph(name, TITLE), Paragraph(subtitle or f"{VIEW_WORDS.get(kind, 'Grid')} · {len(rows):,} row{'s' if len(rows) != 1 else ''}", SUB)]
    story += _view_flowables(columns, rows, view, totals, width)
    frame = _page(workspace, when)
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return buffer.getvalue()


def dashboard(name: str, description: str | None, period_words: str, tiles: list[dict], *, workspace: str, when: str) -> bytes:
    """tiles: {"title", "kind": "figure" | "view" | "missing" | "refused", and the tile payload (value/previous/column or view/result)}"""
    buffer = io.BytesIO()
    doc = _document(buffer, False)
    width = doc.width
    story = [Paragraph(name, TITLE), Paragraph(f"{description + ' · ' if description else ''}{period_words}", SUB)]
    figures = [t for t in tiles if t.get("kind") == "figure"]
    if figures:
        cells, line = [], []
        for tile in figures:
            column = tile["column"]
            value = _number(column, tile.get("value"))
            change = ""
            if tile.get("compared") and tile.get("previous") not in (None, 0) and tile.get("value") is not None:
                try:
                    delta = (float(tile["value"]) - float(tile["previous"])) / abs(float(tile["previous"]))
                    change = f"{'Up' if delta >= 0 else 'Down'} {abs(delta) * 100:.1f}% vs previous"
                except (TypeError, ValueError, ZeroDivisionError):
                    change = ""
            line.append([Paragraph(tile["title"], SMALL), Paragraph(value, FIGURE), Paragraph(change or " ", SMALL)])
            if len(line) == 4:
                cells.append(line); line = []
        if line:
            cells.append(line + [""] * (4 - len(line)))
        for group in cells:
            table = Table([[Table([[p] for p in cell], hAlign="LEFT") if cell else "" for cell in group]], colWidths=[width / 4] * 4, hAlign="LEFT")
            table.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
            story += [table, Spacer(1, 6)]
    for tile in tiles:
        if tile.get("kind") == "figure":
            continue
        block = [Paragraph(tile["title"], H2)]
        if tile.get("kind") == "view":
            result = tile["result"]
            own = " · own dates" if tile.get("own_dates") else ""
            block.append(Paragraph(f"{VIEW_WORDS.get(tile['view'].get('type', 'grid'), 'Grid')} · {result['row_count']:,} row{'s' if result['row_count'] != 1 else ''}{own}", SMALL))
            block += _view_flowables(result["columns"], result["rows"], tile["view"], result.get("totals"), width)
        else:
            block.append(Paragraph(tile.get("detail") or "This tile could not be run.", SMALL))
        story.append(KeepTogether(block[:2]))
        story += block[2:]
        story.append(Spacer(1, 8))
    frame = _page(workspace, when)
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return buffer.getvalue()


__all__ = ["report", "dashboard", "PageBreak"]
