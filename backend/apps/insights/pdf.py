"""The PDF export (ReportLab, pure Python: no system packages on any server): a report in its saved view, or a dashboard
with its tiles on its period, styled for paper. A4 in portrait, landscape when the table is wide; the C360 header with
the workspace and the date; a bold header row that repeats on every page; totals in bold; page numbers.

    report(name, columns, rows, view, totals, *, workspace, when, subtitle) -> bytes
    dashboard(name, description, period_words, tiles, *, workspace, when) -> bytes
        tiles: [{"title", "kind": "figure" | "view", ...the tile's payload}] in the dashboard's order
    paginated(name, columns, rows, totals, *, size, wide, group, filters, workspace, when) -> bytes
        the print-ready report: every row (up to PRINT_ROWS), A4 or Letter, "Page n of N", optionally a section per value of
        the first dimension with its subtotals, each section on a new page
"""
import io
from xml.sax.saxutils import escape
from datetime import date, datetime

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, LETTER, landscape
from reportlab.pdfgen import canvas as pdf_canvas
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
    if bucket in ("fiscal_quarter", "fiscal_year"):
        from .fiscal import name
        return name(d, bucket, column.get("fiscal"))
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
    rows = [[Paragraph(escape(h), BODY_RIGHT if numeric[i] else BODY) for i, h in enumerate(header)]]
    for r, line in enumerate(body):
        rows.append([Paragraph((" " * 4 * (indents or {}).get(r, 0)) + escape(c or ""), BODY_RIGHT if numeric[i] else BODY) for i, c in enumerate(line)])
    if total:
        rows.append([Paragraph(escape(c or ""), BODY_RIGHT if numeric[i] else BODY) for i, c in enumerate(total)])
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


def _pivot_flowables(columns: list[dict], rows: list[list], across: str | None, totals, measure_key: str | None = None) -> list:
    table = shape.pivot(columns, rows, across, measure_key, totals=totals)
    if "reason" in table:
        return [Paragraph(escape(table["reason"]), SMALL)]
    n = len(table["row_columns"])
    measure = table["measure"]
    header = [*(c["label"] for c in table["row_columns"]), *(cell_text(table["across"], v) for v in table["column_values"]), "Total"]
    numeric = [False] * n + [True] * (len(header) - n)
    body = [[*(cell_text(table["row_columns"][i], v) for i, v in enumerate(line[:n])), *(_number(measure, v) for v in line[n:])] for line in table["rows"]]
    total = _bold(["Total", *([""] * (n - 1)), *(_number(measure, v) for v in table["total"][n:])])
    return [Paragraph(escape(f"{measure['label']} · {', '.join(c['label'] for c in table['row_columns'])} down, {table['across']['label']} across"), SMALL), Spacer(1, 3), _table(header, body, numeric, total=total)]


def _hierarchy_flowables(columns: list[dict], rows: list[list], totals) -> list:
    table = shape.hierarchy(columns, rows, totals=totals)
    if "reason" in table:
        return [Paragraph(escape(table["reason"]), SMALL)]
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
    return [Paragraph(escape(", then ".join(level["label"] for level in table["levels"])), SMALL), Spacer(1, 3), _table(header, body, numeric, total=total, group_rows=groups, indents=indents)]


def _pie_flowables(title: str, header: str, categories: list, values: list[float], measure: dict, width: float) -> list:
    """a pie of the first measure by the first dimension, up to eight slices and Other, the legend with the numbers beside it"""
    if len(categories) > 8:
        categories = [*categories[:8], ("other", "Other")]
        values = [*values[:8], sum(values[8:])]
    height = 64 * mm
    drawing = Drawing(width, height + 12 * mm)
    pie = Pie()
    pie.x, pie.y, pie.width, pie.height = 6 * mm, 4 * mm, height - 4 * mm, height - 4 * mm
    pie.data = [max(0.0, v) for v in values] if any(values) else [1.0]
    pie.labels = None
    pie.slices.strokeColor = colors.white
    pie.slices.strokeWidth = 0.75
    for i in range(len(pie.data)):
        pie.slices[i].fillColor = PALETTE[i % len(PALETTE)] if any(values) else LINE
    drawing.add(pie)
    legend = Legend()
    legend.x, legend.y = height + 10 * mm, height - 2 * mm
    legend.fontName, legend.fontSize = "Helvetica", 7
    legend.alignment = "right"
    legend.columnMaximum = 9
    legend.colorNamePairs = [(PALETTE[i % len(PALETTE)], f"{label}   {_number(measure, v)}") for i, ((_, label), v) in enumerate(zip(categories, values))]
    drawing.add(legend)
    drawing.add(String(6 * mm, height + 7 * mm, title, fontName="Helvetica-Bold", fontSize=8, fillColor=INK))
    total = sum(values)
    body = [[label, _number(measure, v), f"{(v / total * 100):.1f}%" if total else "—"] for (_, label), v in zip(categories, values)]
    return [drawing, Spacer(1, 4), _table([header, measure["label"], "Share"], body, [False, True, True])]


def _funnel_flowables(title: str, header: str, categories: list, values: list[float], measure: dict, width: float) -> list:
    """a funnel: the stages in the report's order as centred bars, each with its number and its share of the first stage"""
    categories, values = categories[:12], values[:12]
    bar, gap, label_w, number_w = 6.5 * mm, 2 * mm, 42 * mm, 34 * mm
    height = len(categories) * (bar + gap) + 2 * mm
    drawing = Drawing(width, height + 10 * mm)
    top = max([v for v in values if v > 0] or [1.0])
    lane = width - label_w - number_w
    first = values[0] if values else 0
    for i, ((_, label), v) in enumerate(zip(categories, values)):
        y = height - (i + 1) * (bar + gap)
        w = lane * max(0.0, v) / top
        drawing.add(Rect(label_w + (lane - w) / 2, y, max(w, 0.5), bar, fillColor=BRAND, strokeColor=None))
        drawing.add(String(label_w - 2 * mm, y + 2 * mm, label[:30], fontName="Helvetica", fontSize=7, fillColor=INK, textAnchor="end"))
        share = f"   {v / first * 100:.0f}%" if first else ""
        drawing.add(String(label_w + lane + 2 * mm, y + 2 * mm, f"{_number(measure, v)}{share}", fontName="Helvetica", fontSize=7, fillColor=INK_800))
    drawing.add(String(0, height + 5 * mm, title, fontName="Helvetica-Bold", fontSize=8, fillColor=INK))
    body = [[label, _number(measure, v), f"{v / first * 100:.1f}%" if first else "—"] for (_, label), v in zip(categories, values)]
    return [drawing, Spacer(1, 4), _table([header, measure["label"], "Of the First"], body, [False, True, True])]


def chart_data(columns: list[dict], rows: list[list], across: str | None, *, most: int = 24) -> dict | None:
    """a chart's shape from the rows: the first dimension along the bottom (up to `most` values), a series per value of the
    dimension across, else per measure (six at most); None when the columns cannot make a chart"""
    dims = [(i, c) for i, c in enumerate(columns) if not c.get("aggregate")]
    meas = [(i, c) for i, c in enumerate(columns) if c.get("aggregate")]
    spread = next(((i, c) for i, c in dims if c["key"] == across), None)
    down = [(i, c) for i, c in dims if not spread or c["key"] != across]
    if not meas or not down:
        return None
    axis_i, axis = down[0]
    m_i, measure = meas[0]
    categories = []
    for row in rows:
        key = str(row[axis_i]) if row[axis_i] is not None else ""
        if key not in [k for k, _ in categories]:
            categories.append((key, cell_text(axis, row[axis_i])))
    categories = categories[:most]
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
    return {"axis": axis, "measure": measure, "categories": categories, "series": series}


def _chart_flowables(columns: list[dict], rows: list[list], across: str | None, width: float, kind: str = "bar") -> list:
    """bars: the first dimension along the bottom, a series per value of the dimension across, else per measure; the numbers under it;
    a pie or a funnel takes the first series alone"""
    data = chart_data(columns, rows, across)
    if data is None:
        return [Paragraph("A chart needs a dimension along the bottom and a value to total.", SMALL)]
    if not rows:
        return [Paragraph("No rows match this report.", SMALL)]
    axis, measure, categories, series = data["axis"], data["measure"], data["categories"], data["series"]
    if kind in ("pie", "funnel") and series:
        title = f"{measure['label']} by {axis['label']}"
        return (_pie_flowables if kind == "pie" else _funnel_flowables)(title, axis["label"], categories, series[0][1], measure, width)
    share = kind == "stacked100"
    if share:                                                         # each category's series as their share of it
        sums = [sum(values[i] for _, values in series) for i in range(len(categories))]
        series = [(label, [values[i] / sums[i] * 100 if sums[i] else 0.0 for i in range(len(categories))]) for label, values in series]
    combo = kind == "combo" and len(series) > 1
    height = 70 * mm
    drawing = Drawing(width, height + 20 * mm)                      # the legend and the title sit above the plot, never on it
    chart = VerticalBarChart()
    chart.x, chart.y, chart.width, chart.height = 14 * mm, 12 * mm, width - 20 * mm, height - 6 * mm
    chart.data = [series[0][1]] if combo else [values for _, values in series]
    chart.categoryAxis.categoryNames = [label for _, label in categories]
    if kind in ("stacked", "stacked100"):
        chart.categoryAxis.style = "stacked"
    if share:
        chart.valueAxis.valueMax = 100
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
    if combo:                                                         # the other measures as lines, on their own scale read on the right
        from reportlab.graphics.charts.linecharts import HorizontalLineChart
        lines = HorizontalLineChart()
        lines.x, lines.y, lines.width, lines.height = chart.x, chart.y, chart.width, chart.height
        lines.data = [values for _, values in series[1:]]
        lines.categoryAxis.visible = False
        lines.valueAxis.valueMin = 0
        lines.valueAxis.visibleAxis = False
        lines.valueAxis.visibleGrid = False
        lines.valueAxis.labels.fontName, lines.valueAxis.labels.fontSize = "Helvetica", 7
        lines.valueAxis.labels.boxAnchor = "w"
        lines.valueAxis.labels.dx = chart.width + 4
        for i in range(len(series) - 1):
            lines.lines[i].strokeColor = PALETTE[(i + 1) % len(PALETTE)]
            lines.lines[i].strokeWidth = 1.5
        drawing.add(lines)
    if not series or not any(any(v for v in values) for _, values in series):
        chart.valueAxis.valueMax = 1                                  # an all-zero chart still needs an axis to draw
    if len(series) > 1:
        legend = Legend()
        legend.x, legend.y = 14 * mm, height + 13 * mm
        legend.fontName, legend.fontSize = "Helvetica", 7
        legend.alignment = "right"
        legend.columnMaximum = 1
        legend.colorNamePairs = [(PALETTE[i % len(PALETTE)], label) for i, (label, _) in enumerate(series)]
        drawing.add(legend)
    drawing.add(String(14 * mm, height + 10 * mm if len(series) <= 1 else height + 17 * mm, f"{measure['label']} by {axis['label']}", fontName="Helvetica-Bold", fontSize=8, fillColor=INK))
    header = [axis["label"], *(label for label, _ in series)]
    cell = (lambda value: f"{value:.1f}%") if share else (lambda value: _number(measure, value))
    body = [[label, *(cell(values[i]) for _, values in series)] for i, (_, label) in enumerate(categories)]
    return [drawing, Spacer(1, 4), _table(header, body, [False] + [True] * len(series))]


def _grand(columns: list[dict], rows: list[list], totals, at: int):
    """the whole period's value of the measure at `at` among the measures: the engine's grand total, else the one row"""
    entry = next((t for t in totals or [] if not t.get("keys")), None)
    if entry is not None and at < len(entry.get("values", [])):
        return entry["values"][at]
    measures = [i for i, c in enumerate(columns) if c.get("aggregate")]
    return rows[0][measures[at]] if len(rows) == 1 and at < len(measures) else None


def _figure_flowables(columns: list[dict], rows: list[list], totals, view: dict) -> list:
    """a KPI card or a gauge: the first value over the whole period, its target and how far it got"""
    measure = next((c for c in columns if c.get("aggregate")), None)
    if measure is None:
        return [Paragraph("A KPI card needs a value to total.", SMALL)]
    value = _grand(columns, rows, totals, 0)
    target = view.get("target")
    words = [Paragraph(escape(measure["label"]), SMALL), Paragraph(escape(_number(measure, value)), FIGURE)]
    if target is not None and value is not None:
        try:
            words.append(Paragraph(f"Target {_number(measure, target)} · {float(value) / float(target) * 100:.1f}% of target", SMALL))
        except (TypeError, ValueError, ZeroDivisionError):
            words.append(Paragraph(f"Target {_number(measure, target)}", SMALL))
    return words


def _waterfall_flowables(columns: list[dict], rows: list[list]) -> list:
    dims = [i for i, c in enumerate(columns) if not c.get("aggregate")]
    measures = [i for i, c in enumerate(columns) if c.get("aggregate")]
    if not dims or not measures:
        return [Paragraph("A waterfall needs a dimension along the bottom and a value to total.", SMALL)]
    d, m = dims[0], measures[0]
    running, body = 0.0, []
    for row in rows:
        step = float(row[m] or 0)
        running += step
        body.append([cell_text(columns[d], row[d]), _number(columns[m], step), _number(columns[m], running)])
    return [Paragraph(escape(f"{columns[m]['label']}, step by step by {columns[d]['label']}"), SMALL), Spacer(1, 3),
            _table([columns[d]["label"], columns[m]["label"], "Running Total"], body, [False, True, True], total=_bold(["Total", "", _number(columns[m], running)]))]


ON_SCREEN = {"scatter": "a scatter chart", "bubble": "a bubble chart", "treemap": "a treemap", "map": "a map", "influencers": "Key Influencers", "decomposition": "a Decomposition Tree"}


def _view_flowables(columns, rows, view: dict | None, totals, width: float) -> list:
    kind = (view or {}).get("type", "grid")
    across = (view or {}).get("across")
    chart = (view or {}).get("chart") or "bar"
    if kind == "pivot" and (view or {}).get("matrix"):                # every value as its own pivot
        out = []
        for column in [c for c in columns if c.get("aggregate") and not c.get("compare")]:
            out += [*_pivot_flowables(columns, rows, across, totals, column["key"]), Spacer(1, 6)]
        return out
    if kind == "pivot":
        return _pivot_flowables(columns, rows, across, totals)
    if kind == "hierarchy":
        return _hierarchy_flowables(columns, rows, totals)
    if kind == "chart" and chart in ("kpi", "gauge"):
        return _figure_flowables(columns, rows, totals, view or {})
    if kind == "chart" and chart == "waterfall":
        return _waterfall_flowables(columns, rows)
    if kind in ON_SCREEN or (kind == "chart" and chart in ON_SCREEN):
        return [Paragraph(f"Shown on screen as {ON_SCREEN.get(kind) or ON_SCREEN[chart]}; here as its rows.", SMALL), Spacer(1, 3), *_grid_flowables(columns, rows)]
    if kind == "chart":
        return _chart_flowables(columns, rows, None if chart in ("pie", "funnel", "combo") else across, width, chart)   # a pie, a funnel or a combo: the measures by one dimension
    return _grid_flowables(columns, rows)


VIEW_WORDS = {"grid": "Grid", "chart": "Chart", "hierarchy": "Hierarchy", "pivot": "Pivot", "influencers": "Key Influencers", "decomposition": "Decomposition Tree"}


# ---------------------------------------------------------------------------------------------------- the documents
def report(name: str, columns: list[dict], rows: list[list], view: dict | None, totals=None, *, workspace: str, when: str, subtitle: str | None = None) -> bytes:
    kind = (view or {}).get("type", "grid")
    wide = kind in ("grid", "pivot") and (len(columns) > 6 or (kind == "pivot" and len(rows) > 0))
    buffer = io.BytesIO()
    doc = _document(buffer, wide)
    width = doc.width
    story = [Paragraph(escape(name), TITLE), Paragraph(escape(subtitle or f"{VIEW_WORDS.get(kind, 'Grid')} · {len(rows):,} row{'s' if len(rows) != 1 else ''}"), SUB)]
    story += _view_flowables(columns, rows, view, totals, width)
    frame = _page(workspace, when)
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return buffer.getvalue()


def dashboard(name: str, description: str | None, period_words: str, tiles: list[dict], *, workspace: str, when: str) -> bytes:
    """tiles: {"title", "kind": "figure" | "view" | "missing" | "refused", and the tile payload (value/previous/column or view/result)}"""
    buffer = io.BytesIO()
    doc = _document(buffer, False)
    width = doc.width
    story = [Paragraph(escape(name), TITLE), Paragraph(escape(f"{description + ' · ' if description else ''}{period_words}"), SUB)]
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
        block = [Paragraph(escape(tile["title"]), H2)]
        if tile.get("kind") == "view":
            result = tile["result"]
            own = " · own dates" if tile.get("own_dates") else ""
            block.append(Paragraph(f"{VIEW_WORDS.get(tile['view'].get('type', 'grid'), 'Grid')} · {result['row_count']:,} row{'s' if result['row_count'] != 1 else ''}{own}", SMALL))
            block += _view_flowables(result["columns"], result["rows"], tile["view"], result.get("totals"), width)
        elif tile.get("kind") == "text":
            block += [Paragraph(escape(part).replace("\n", "<br/>"), BODY) for part in tile["text"].split("\n\n") if part.strip()]
        elif tile.get("kind") == "summary":
            block.append(Paragraph("Written by AI from the rows" if tile.get("summary") else "Summary", SMALL))
            if tile.get("summary"):
                block += [Paragraph(escape(tile["summary"]), BODY), *(Paragraph(f"• {escape(point)}", BODY) for point in tile.get("points") or [])]   # the model's words, never markup
            else:
                block.append(Paragraph(escape(tile.get("detail") or "No summary yet."), SMALL))
        else:
            block.append(Paragraph(escape(tile.get("detail") or "This tile could not be run."), SMALL))
        story.append(KeepTogether(block[:2]))
        story += block[2:]
        story.append(Spacer(1, 8))
    frame = _page(workspace, when)
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return buffer.getvalue()




# ---------------------------------------------------------------------------------------------------- print-ready
PRINT_ROWS = 20_000
PAGE_SIZES = {"a4": A4, "letter": LETTER}
ADDITIVE = ("sum", "count", "min", "max")


def _numbered(name: str, workspace: str, when: str):
    """a canvas that knows the page count once every page is laid out: "Page 3 of 12" on each, and the report's name above"""
    class Numbered(pdf_canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._pages = []

        def showPage(self):
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._pages)
            for state in self._pages:
                self.__dict__.update(state)
                self._decorate(total)
                super().showPage()
            super().save()

        def _decorate(self, total: int):
            width, height = self._pagesize
            self.saveState()
            self.setFont("Helvetica-Bold", 9)
            self.setFillColor(BRAND)
            self.drawString(14 * mm, height - 12 * mm, "C360 Insights")
            self.setFont("Helvetica", 8)
            self.setFillColor(INK_700)
            self.drawRightString(width - 14 * mm, height - 12 * mm, f"{name[:80]} · {workspace} · {when}")
            self.setStrokeColor(LINE_SUBTLE)
            self.line(14 * mm, height - 14 * mm, width - 14 * mm, height - 14 * mm)
            self.drawRightString(width - 14 * mm, 9 * mm, f"Page {self._pageNumber} of {total}")
            self.restoreState()
    return Numbered


def _combined(column: dict, values: list):
    numbers = [float(v) for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    aggregate = column.get("aggregate") if not column.get("compare") else None
    if not numbers or aggregate not in ADDITIVE:
        return None
    return {"sum": sum, "count": sum, "min": min, "max": max}[aggregate](numbers)


def _print_table(columns: list[dict], rows: list[list], total: list | None):
    header = [escape(c["label"] + (" (masked)" if c.get("masked") else "")) for c in columns]
    numeric = [_is_numeric(c) for c in columns]
    body = [[escape(cell_text(c, row[i])) for i, c in enumerate(columns)] for row in rows]
    total_cells = None
    if total is not None:
        total_cells = _bold([("Total" if i == 0 else "") if not c.get("aggregate") else (_number(c, total[i]) if total[i] is not None else "") for i, c in enumerate(columns)])
    return _table(header, body, numeric, total=total_cells)


def paginated(name: str, columns: list[dict], rows: list[list], totals=None, *, size: str = "a4", wide: bool = False, group: bool = False,
              filters: list[str] | None = None, workspace: str, when: str) -> bytes:
    buffer = io.BytesIO()
    page = PAGE_SIZES.get(size, A4)
    doc = SimpleDocTemplate(buffer, pagesize=landscape(page) if wide else page, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=20 * mm, bottomMargin=16 * mm, title=name)
    capped = rows[:PRINT_ROWS]
    story = [Paragraph(escape(name), TITLE), Paragraph(f"{len(rows):,} row{'s' if len(rows) != 1 else ''}{' · the first ' + format(PRINT_ROWS, ',') + ' printed' if len(rows) > PRINT_ROWS else ''}", SUB)]
    if filters:
        story.append(Paragraph("Filters: " + escape("; ".join(filters)), SMALL))
        story.append(Spacer(1, 4))
    engine_total = next((t for t in totals or [] if not t.get("keys")), None)
    measures = [i for i, c in enumerate(columns) if c.get("aggregate")]

    def grand_of(lines: list[list]) -> list:
        out = [None] * len(columns)
        for k, i in enumerate(measures):
            if engine_total is not None and lines is capped and k < len(engine_total.get("values", [])):
                out[i] = engine_total["values"][k]
            else:
                out[i] = _combined(columns[i], [line[i] for line in lines])
        return out

    dims = [i for i, c in enumerate(columns) if not c.get("aggregate")]
    if group and dims and len(columns) > 1:
        g = dims[0]
        kept = [c for i, c in enumerate(columns) if i != g]
        sections: dict[str, list] = {}
        for row in capped:
            sections.setdefault(str(row[g]) if row[g] is not None else "", []).append(row)
        for n, (key, lines) in enumerate(sections.items()):
            if n:
                story.append(PageBreak())
            story.append(Paragraph(escape(f"{columns[g]['label']}: {cell_text(columns[g], lines[0][g])}"), H2))
            story.append(Paragraph(f"{len(lines):,} row{'s' if len(lines) != 1 else ''}", SMALL))
            sub = grand_of(lines)
            story.append(_print_table(kept, [[v for i, v in enumerate(line) if i != g] for line in lines], [v for i, v in enumerate(sub) if i != g] if measures else None))
        if measures:
            story += [PageBreak(), Paragraph("Total", H2)]
            grand = grand_of(capped)
            story.append(_print_table([columns[i] for i in measures], [[grand[i] for i in measures]], None))
    else:
        story.append(_print_table(columns, capped, grand_of(capped) if measures and dims else None))
    doc.build(story, canvasmaker=_numbered(name, workspace, when))
    return buffer.getvalue()


__all__ = ["report", "dashboard", "paginated", "PageBreak"]
