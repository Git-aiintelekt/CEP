// Builds docs/manuals/C360_Insights_User_Guide.docx: the report engine's features, step by step, grouped by what people do.
//   node docs/tools/build_insights_guide.js
// The steps are read from the help chapters (docs/manuals/user-guide/59-insights.md and 60-report-databases.md) by their
// bold titles, and the function reference from the formula editor's list (frontend/src/apps/insights/editor/formulaHelp.ts),
// so the guide follows the help: edit the chapters, then rebuild. A step block the outline does not place is reported.
// The screenshots are docs/manuals/insights-guide-shots/*.png, taken from the /dev playgrounds by capture_insights_shots.py.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { parse } = require('./build_manuals')

function loadDocx() {
  try { return require('docx') } catch { /* fall through to the global folder */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'docx'))
}
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat, AlignmentType,
  PageBreak, Header, Footer, PageNumber, ImageRun } = loadDocx()

const REPO = path.resolve(__dirname, '..', '..')
const OUT = path.join(REPO, 'docs', 'manuals', 'C360_Insights_User_Guide.docx')
const FONT = 'Arial'
const INK = '1F2440'
const MUTED = '555B6E'
const LINE = 'D9DBE3'
const ACCENT = '2753E4'
const PAGE_WIDTH = 12240 - 2 * 1080                                                        // US Letter, 0.75" margins
const SHOTS = path.join(REPO, 'docs', 'manuals', 'insights-guide-shots')

/** the screenshot shown under a topic's heading, before its steps: [file, caption] */
const FIGURES = {
  make: [['editor-wells', 'The report editor with Field Wells: the fields on the left, the result in the middle, Rows, Columns, Values and Filters on the right.'],
    ['editor-steps', 'The same report in the Steps editor: Data, Filter, Summarize, Group By, Sort and Limit, with the result underneath.']],
  views: [['view-pivot', 'The Pivot view: Sent by month down the side, Channel across, a total on both edges.']],
  'Compare a measure with an earlier period': [['compare', 'Sent Count with Previous Month and Change vs Last Year: each comparison is a column after its measure.']],
  'Colour the numbers': [['format', 'Rules colour Sent Count good, warning or bad; data bars sit behind Opened.']],
  'Stack the bars, or combine bars and a line': [['chart-stacked', 'A stacked chart: each month one bar, the channels on top of each other. Combo and 100% Stacked sit beside it.']],
  'Show a report as a pie or a funnel': [['chart-pie', 'A pie by campaign: the total in the middle, each value with its share in the legend.']],
  'Use a scatter, bubble, treemap or waterfall chart': [['chart-treemap', 'A treemap from More Charts: boxes sized by their share, the largest first.']],
  'Show one figure: a KPI card or a gauge': [['chart-kpi', 'A KPI card with a target: the value, the share of target and a small trend line.']],
  'Put the numbers on a map': [['chart-map', 'A map of US states: darker blue is more, grey has no data; Map Of picks states or countries.']],
  'Show every value side by side in a pivot (matrix)': [['matrix', 'All Values and Trend Column: every value under each month, with a total for each.']],
  'Repeat a chart per value (small multiples)': [['multiples', 'Repeat By Channel: one small chart per value, all on one scale.']],
  'Drill in a pivot or a hierarchy': [['view-hierarchy', 'The Hierarchy view: each channel folds over its months, with a subtotal per group.']],
  'Write a measure formula, such as a rate or a filtered total': [['formula', 'A measure formula in Custom Fields: the line under it says what it works out; fields and functions to put in sit below.']],
  'Show a share of the total, a rank, year to date or last year in a measure formula': [['shared-edit', 'A share of the total with CALCULATE and ALL. The check says it is worked out over the report\'s rows.']],
  'Share a formula with every report on a dataset': [['shared', 'Insights → Shared Formulas: each formula with its kind, its Certified mark and the reports that use it.']],
  'Ask a question before a report runs (Parameters)': [['params', 'The questions above a report: pick the answers and press Run Report.']],
  'Report on a CSV or Excel file (Uploaded Files)': [['upload-review', 'Review the Columns: each column\'s label, type and use, with the first rows of the file.']],
  'Set your fiscal year (Settings → Fiscal Year)': [['fiscal', 'Settings → Fiscal Year: the month it starts in and how the year is named, with an example.']],
  dashboards: [['dashboard', 'A dashboard: figures, charts, a grid, a pivot and a hierarchy on one period, with a Channel slicer under it.']],
  'Add slicers to a dashboard': [['dashboard-edit', 'The dashboard editor: Add Tile, the row controls and each tile\'s controls.']],
  'Lay a dashboard out freely (Free Canvas)': [['dashboard-canvas', 'Free Canvas: drag a tile by its grip to move it and by its handle to resize it.']],
  'See and shape the phone layout': [['dashboard-phone', 'The phone layout: the tiles stacked top to bottom, tiles hidden on a phone left out.']],
  'Give a dashboard a theme': [['dashboard-theme', 'The Navy theme: every chart on the dashboard takes its colours.']],
  'Ask for a Report': [['ask', 'Ask for a Report above the report list, with the model to use and your recent prompts.']],
}
let figureNumber = 0

/** a screenshot, framed, at the page's width (or less for a tall one), and its caption */
function figure([name, caption]) {
  const file = path.join(SHOTS, `${name}.png`)
  if (!fs.existsSync(file)) throw new Error(`no screenshot ${name}.png: run docs/tools/capture_insights_shots.py`)
  const data = fs.readFileSync(file)
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  const scale = Math.min(650 / width, 560 / height)
  figureNumber += 1
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const side = { style: BorderStyle.SINGLE, size: 4, color: LINE }
  const frameWidth = Math.round((w + 8) * 15)                         // pixels at 96 dpi to twentieths of a point, and a little room
  return [
    new Table({ alignment: AlignmentType.CENTER, width: { size: frameWidth, type: WidthType.DXA }, columnWidths: [frameWidth],
      borders: { top: side, left: side, bottom: side, right: side, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
      rows: [new TableRow({ cantSplit: true, children: [new TableCell({ width: { size: frameWidth, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 40, right: 40 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [new ImageRun({ type: 'png', data, transformation: { width: w, height: h },
          altText: { title: caption, description: caption, name } })] })] })] })] }),
    new Paragraph({ spacing: { before: 80, after: 200 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Figure ${figureNumber}. `, bold: true, size: 17, color: MUTED, font: FONT }), new TextRun({ text: caption, italics: true, size: 17, color: MUTED, font: FONT })] }),
  ]
}
const figures = (key) => (FIGURES[key] ?? []).flatMap(figure)

// ---------------------------------------------------------------- the help, read
const chapter = (name) => parse(fs.readFileSync(path.join(REPO, 'docs', 'manuals', 'user-guide', name), 'utf8'))
const blocks = [...chapter('59-insights.md'), ...chapter('60-report-databases.md')]
const TITLE = /^\*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?$/

/** the step blocks: a paragraph that is a bold title (and an optional role), then what follows up to the next title or heading */
const steps = new Map()
for (let i = 0; i < blocks.length; i += 1) {
  const block = blocks[i]
  const title = block.kind === 'paragraph' && TITLE.exec(block.text)
  if (!title) continue
  const body = []
  for (let j = i + 1; j < blocks.length && blocks[j].kind !== 'heading' && !(blocks[j].kind === 'paragraph' && TITLE.test(blocks[j].text)); j += 1) body.push(blocks[j])
  if (!steps.has(title[1])) steps.set(title[1], { role: title[2], body })
}
/** the blocks under a heading, up to the next heading of its level or above */
function section(text) {
  const at = blocks.findIndex((b) => b.kind === 'heading' && b.text === text)
  if (at < 0) throw new Error(`no heading "${text}" in the help`)
  const out = []
  for (let j = at + 1; j < blocks.length && !(blocks[j].kind === 'heading' && blocks[j].level <= blocks[at].level); j += 1) out.push(blocks[j])
  return out
}

/** the formula editor's functions, by group, as it lists them */
function functionList() {
  const source = fs.readFileSync(path.join(REPO, 'frontend', 'src', 'apps', 'insights', 'editor', 'formulaHelp.ts'), 'utf8')
  const unquote = (s) => s.slice(1, -1).replace(/\\'/g, "'").replace(/\\n/g, ' ')
  const groups = []
  const pattern = /group: '([^']+)'|\{ name: '([^']+)', usage: ('(?:[^'\\]|\\.)*'), words: ('(?:[^'\\]|\\.)*'|"[^"]*")(, measureOnly: true)?/g
  for (const m of source.matchAll(pattern)) {
    if (m[1]) groups.push({ group: m[1], items: [] })
    else groups[groups.length - 1].items.push({ name: m[2], usage: unquote(m[3]), words: unquote(m[4]), measure: Boolean(m[5]) })
  }
  return groups
}

// ---------------------------------------------------------------- the outline
const PARTS = [
  { title: 'Getting Started', intro: 'What Insights is, who can use which part of it, the data it reports on, and how a report is made and read.', items: [
    { custom: 'about' }, { custom: 'who' }, { custom: 'datasets' }, { custom: 'make' }, { custom: 'views' }, { custom: 'viewer' }] },
  { title: 'Measures and Comparisons', intro: 'Totals, rates and the comparisons that set a number against an earlier period, a target or the rest.', items: [
    'Use a calculated measure in a report', 'Compare a measure with an earlier period', 'Year to date, a moving average, a rank, a target',
    'Keep the top values and fold the rest into Others (Top N)', 'Set your fiscal year (Settings → Fiscal Year)', 'Add measures from a linked dataset'] },
  { title: 'Custom Fields and Formulas', intro: 'Fields of your own: groups, bands and labels, formulas for each row, measure formulas, and formulas shared with every report on a dataset.', items: [
    'Group values into a field of your own (Custom Fields)', 'Work out a value for each row with a formula', 'Write a measure formula, such as a rate or a filtered total',
    'Show a share of the total, a rank, year to date or last year in a measure formula', { custom: 'mysql57' },
    'Share a formula with every report on a dataset', 'Certify a shared formula', 'The formula language at a glance', { custom: 'functions' }] },
  { title: 'Charts and Views', intro: 'Every way a report can be drawn, and how to colour, forecast and flag its numbers.', items: [
    'Stack the bars, or combine bars and a line', 'Show a report as a pie or a funnel', 'Use a scatter, bubble, treemap or waterfall chart',
    'Show one figure: a KPI card or a gauge', 'Put the numbers on a map', 'Show every value side by side in a pivot (matrix)', 'Repeat a chart per value (small multiples)',
    'Colour the numbers', 'Add a forecast line, or flag unusual points'] },
  { title: 'Exploring the Data', intro: 'Going down a level, opening the rows behind a value, asking a question before a report runs, and finding what drives a number.', items: [
    'Drill down in a chart', 'Drill in a pivot or a hierarchy', 'Open a detail report from a value (drill-through)', 'Show another report when someone hovers a value (Tooltip Report)',
    'Find what drives a value (Key Influencers)', 'Break a value down step by step (Decomposition Tree)', 'Ask a question before a report runs (Parameters)', 'Show the SQL'] },
  { title: 'Your Own Data', intro: 'Reports on a CSV or Excel file, and on a MySQL, PostgreSQL or ClickHouse database of your own, read-only.', items: [
    'Report on a CSV or Excel file (Uploaded Files)', 'Connect a database', 'Connect a database from New Report', 'Map a dataset from a table', 'Join tables in a dataset', 'Add a calculated measure',
    'Build a report from a query'] },
  { title: 'Dashboards', intro: 'Pages of tiles on one period, with slicers, cross-filtering, saved views, pages, a free canvas, a phone layout and themes.', items: [
    { custom: 'dashboards' }, 'Add slicers to a dashboard', 'Filter a dashboard with slicers', 'Slice a dashboard by a range of numbers or dates', 'Cross-filter by clicking',
    'Save a dashboard view (bookmarks)', 'Spread a dashboard over pages', 'Lay a dashboard out freely (Free Canvas)', 'See and shape the phone layout', 'Give a dashboard a theme',
    'Add text to a dashboard', 'Add a button that opens a saved view, a page or a report', 'Add a written summary to a dashboard'] },
  { title: 'AI Features', intro: 'Reports from a sentence, explanations of a report, and changes to a report in words. Each is there once your platform offers an AI provider and your workspace allows it.', items: [
    'Ask for a Report', 'Add images to a prompt', 'Use AI in your workspace', 'Explain This Report, with AI', 'Change a report with a prompt, with AI'] },
  { title: 'Sharing, Delivery and Exports', intro: 'Who sees what, links for other sites, comments, alerts, scheduled emails and every file a report can become.', items: [
    'Share a report or a dashboard', 'Limit what a person sees (Report Access)', 'Embed a report or a dashboard on another site',
    'Comment on a report or a dashboard, and pin a note to a value', 'Get an email when a value crosses a threshold (Alerts)', { custom: 'schedule' },
    'Export to PowerPoint', 'Print a report on numbered pages (Print-Ready PDF)'] },
  { title: 'Administration and Troubleshooting', intro: 'What people open, every run, how fresh the data is, and what the messages mean.', items: [
    'See what people open (Usage)', { custom: 'runlog' }, { custom: 'fresh' }, { custom: 'trouble' }] },
]
const CUSTOM_TITLE = { about: 'What Insights Is For', who: 'Who Can Use It', datasets: 'The Datasets', make: 'Make a Report', views: 'The Four Views', viewer: 'Read a Report (the Viewer)',
  mysql57: 'On a MySQL 5.7 Database', functions: 'Function Reference', dashboards: 'How a Dashboard Works', schedule: 'Email a Report on a Schedule', runlog: 'The Run Log',
  fresh: 'How Fresh Is the Data', trouble: 'When Something Does Not Run' }
const featureTitle = (item) => (typeof item === 'string' ? item : CUSTOM_TITLE[item.custom])

// ---------------------------------------------------------------- Word pieces
const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
/** the help's pointers to other chapters, as this guide's parts */
const POINTERS = [[/\(Report Databases chapter\)/g, '(Part 6)'], [/in the Report Databases chapter/g, 'in Part 6, Build a report from a query'],
  [/\(the steps are at the top of this chapter\)/g, '(Part 2)']]
function runs(text, base = {}) {
  text = POINTERS.reduce((t, [from, to]) => t.replace(from, to), text)
  return text.split(INLINE).filter(Boolean).map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) return new TextRun({ text: part.slice(2, -2), bold: true, font: FONT, ...base })
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return new TextRun({ text: part.slice(1, -1), italics: true, font: FONT, ...base })
    if (part.startsWith('`') && part.endsWith('`')) return new TextRun({ text: part.slice(1, -1), font: 'Consolas', color: '2A3052', ...base, size: (base.size ?? 21) - 1 })
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) return new TextRun({ text: link[1], font: FONT, ...base })
    return new TextRun({ text: part, font: FONT, ...base })
  })
}
const p = (text, options = {}) => new Paragraph({ children: runs(text, options.run ?? {}), spacing: { after: 120, line: 276 }, ...options.paragraph })
let listInstance = 0

/** column widths from the text they hold: the square root of each column's longest cell, at least a short word's room */
const fit = (head, rows) => head.map((h, i) => Math.max(8, Math.sqrt(Math.max(h.length, ...rows.map((r) => (r[i] || '').length)))))

function table(head, rows, widths = fit(head, rows)) {
  const total = widths.reduce((a, b) => a + b, 0)
  const scaled = widths.map((w) => Math.round((w / total) * PAGE_WIDTH))
  scaled[scaled.length - 1] += PAGE_WIDTH - scaled.reduce((a, b) => a + b, 0)
  const cell = (text, i, header) => new TableCell({ width: { size: scaled[i], type: WidthType.DXA }, margins: { top: 70, bottom: 70, left: 110, right: 110 },
    shading: header ? { type: ShadingType.CLEAR, fill: 'EEF1FA', color: 'auto' } : undefined,
    children: (text || '').split('\n').map((line, n) => new Paragraph({ children: runs(line, header ? { bold: true, size: 18, color: INK } : n ? { size: 16, color: MUTED } : { size: 19 }) })) })
  return new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: scaled,
    rows: [new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, true)) }), ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, false)) }))],
    borders: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE }, left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E6E8EF' }, insideVertical: { style: BorderStyle.NONE } } })
}

function render(list) {
  const out = []
  for (const block of list) {
    if (block.kind === 'paragraph') out.push(p(block.text))
    else if (block.kind === 'list') {
      listInstance += 1
      const last = block.items.length - 1
      block.items.forEach((item, i) => out.push(new Paragraph({ children: runs(item), spacing: { after: i === last ? 160 : 80, line: 276 }, keepLines: true,
        numbering: { reference: block.ordered ? 'steps' : 'bullets', level: 0, instance: listInstance }, keepNext: i < last && block.items.length <= 4 })))
    } else if (block.kind === 'table') {
      out.push(table(block.head, block.rows))
      out.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
    }
  }
  return out
}

function who(role) {
  if (!role) return []
  const words = role.charAt(0).toUpperCase() + role.slice(1)
  return [new Paragraph({ spacing: { after: 100 }, keepNext: true, children: [new TextRun({ text: 'Who: ', bold: true, size: 18, color: MUTED, font: FONT }), new TextRun({ text: words, size: 18, color: MUTED, font: FONT })] })]
}

function callout(title, text) {
  return new Paragraph({ spacing: { before: 60, after: 160, line: 276 }, indent: { left: 120, right: 120 }, shading: { type: ShadingType.CLEAR, fill: 'F1F4FD', color: 'auto' },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
    children: [new TextRun({ text: `${title}  `, bold: true, font: FONT, size: 20, color: INK }), ...runs(text, { size: 20 })] })
}

const feature = (title, children) => [new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, pageBreakBefore: title === CUSTOM_TITLE.functions, children: [new TextRun({ text: title, font: FONT })] }), ...children]

// ---------------------------------------------------------------- the custom sections
function custom(key) {
  const list = (text) => text.split('\n').filter(Boolean)
  switch (key) {
    case 'about': return [...render(section('What Insights is for')), p('**Where to find it:** Insights, in the app launcher (the grid icon at the top left), and the Insights item in Engagement\'s menu, which opens the same reports.'),
      p('Its menu: **Reports**, **Dashboards**, **Scheduled**, **Uploaded Files** and **Shared Formulas** (for people who build reports), and **Run Log** and **Usage** (for report administrators).')]
    case 'who': return render(section('Who can use it'))
    case 'datasets': return [...render(section('The datasets')), p('Your workspace can add its own datasets too: uploaded CSV and Excel files, and tables or queries from its own databases (Part 6).')]
    case 'make': return [
      ...who('anyone who can build reports'), ...figures('make'),
      ...render([{ kind: 'list', ordered: true, items: list(`Open Insights → Reports and press **New Report**. Pick a dataset and give the report a name. It opens in the editor with the dataset's first columns.
Choose an editor at the top right; your choice is remembered. **Field Wells**: the fields on the left, the result in the middle, the wells on the right. **Steps**: the question written as numbered steps (Data, Filter, Summarize, Group By, Sort and Limit), each with an Add button.
Click or drag a field into **Rows** (one line per value), **Columns** (one dimension spread across, for the pivot and the chart's series) or **Values** (a number to total). Group a date **by Day, Week, Month, Quarter or Year**.
Pick each measure's calculation: Sum, Count, Distinct Count, Average, Min or Max. **Add a Comparison** sits under it (Part 2).
Add **Filters**: one rule per row (field, operator, value), joined with **and** or **or**. A list is comma-separated, a range is from..to, and "in the last days" takes a number. Dates are in the workspace's time zone.
Watch the preview: it runs as you build. The line above it says how many rows, how long the run took and how fresh the data is.
Press **Save** to write a new version, or **Cancel** to drop the changes.`) }]),
      p('**Find it later:** Insights → Reports lists every report you can open, grouped by the component whose data it uses. Press the star on a row to make it a favourite (favourites come first); folder chips at the top filter the list, and the search finds a report by name.')]
    case 'views': return [...figures('views'), ...render(section('The four views'))]
    case 'viewer': return render(section('The viewer'))
    case 'mysql57': return [callout('MySQL 5.7.', 'A dataset from a MySQL 5.7 database cannot run CALCULATE with ALL, RANKX or the time functions (TOTALYTD, TOTALQTD, SAMEPERIODLASTYEAR, PREVIOUSPERIOD, PARALLELPERIOD): that version has no window functions. The formula editor leaves them out of its list there, and the line under the formula says so if one is typed. CALCULATE with a condition, SUMX and the other functions work. A database on MySQL 8.0 or PostgreSQL runs them all.')]
    case 'functions': {
      const out = [p('Every function the formula editor lists, by group. **Measure only** means it adds up the rows of a group, so it goes in a measure formula.', { paragraph: { keepNext: true } })]
      for (const g of functionList()) {
        out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, children: [new TextRun({ text: g.group, font: FONT })] }))
        out.push(table(['Function', 'Written as', 'What it gives'], g.items.map((f) => [`**${f.name}**${f.measure ? '\nMeasure only' : ''}`, `\`${f.usage}\``, f.words]), [1.3, 2.3, 2.6]))
        out.push(new Paragraph({ spacing: { after: 80 }, children: [] }))
      }
      return out
    }
    case 'dashboards': return [...figures('dashboards'), ...render(section('Dashboards'))]
    case 'schedule': return [...who('anyone who can build reports'), ...render(section('Scheduled delivery'))]
    case 'runlog': return render(section('Run Log'))
    case 'fresh': return render(section('How fresh is the data'))
    case 'trouble': return render(section('When something does not run'))
    default: throw new Error(`no custom section ${key}`)
  }
}

// ---------------------------------------------------------------- the document
const used = new Set()
const children = [
  new Paragraph({ spacing: { before: 2600, after: 120 }, children: [new TextRun({ text: 'C360 INSIGHTS', bold: true, size: 22, color: ACCENT, font: FONT, characterSpacing: 40 })] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Report Engine User Guide', bold: true, size: 60, color: INK, font: FONT })] }),
  new Paragraph({ spacing: { after: 480 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 12 } },
    children: [new TextRun({ text: 'Step by step, for every feature: reports, formulas, charts, dashboards, AI, sharing and delivery', size: 26, color: MUTED, font: FONT })] }),
  p(`${PARTS.length} parts, ${PARTS.reduce((n, part) => n + part.items.length, 0)} topics. Built ${new Date().toISOString().slice(0, 10)} from the in-app help, so it matches what the help panel shows.`, { run: { color: MUTED, size: 20 } }),
  p('Each topic says who can use it, then the steps in order. Names in **bold** are what you see on the screen: a button, a menu item or a field. The screenshots show the screens with sample data.', { run: { color: MUTED, size: 20 } }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Contents', font: FONT })] }),
]
PARTS.forEach((part, n) => {
  children.push(new Paragraph({ spacing: { before: 160, after: 40 }, keepNext: true, children: [new TextRun({ text: `Part ${n + 1}  `, bold: true, color: ACCENT, size: 20, font: FONT }), new TextRun({ text: part.title, bold: true, size: 22, color: INK, font: FONT })] }))
  children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 720 }, children: [new TextRun({ text: part.items.map(featureTitle).join('  ·  '), size: 18, color: MUTED, font: FONT })] }))
})
PARTS.forEach((part, n) => {
  children.push(new Paragraph({ children: [new PageBreak()] }))
  children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `PART ${n + 1}`, bold: true, size: 20, color: ACCENT, font: FONT, characterSpacing: 30 })] }))
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: part.title, font: FONT })] }))
  children.push(p(part.intro, { run: { color: MUTED, size: 22 }, paragraph: { spacing: { after: 240 } } }))
  for (const item of part.items) {
    if (typeof item !== 'string') { children.push(...feature(CUSTOM_TITLE[item.custom], custom(item.custom))); continue }
    const found = steps.get(item)
    if (!found) throw new Error(`no step block "${item}" in the help`)
    used.add(item)
    children.push(...feature(item, [...who(found.role), ...figures(item), ...render(found.body)]))
  }
})
const unplaced = [...steps.keys()].filter((t) => !used.has(t))

const document = new Document({
  creator: 'C360', title: 'C360 Insights: Report Engine User Guide', description: 'Every report engine feature, step by step',
  styles: { default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 40, bold: true, font: FONT, color: INK }, paragraph: { spacing: { before: 0, after: 120 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 27, bold: true, font: FONT, color: INK },
        paragraph: { spacing: { before: 320, after: 80 }, outlineLevel: 1, border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E6E8EF', space: 10 } } } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, font: FONT, color: '2A3052' }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ] },
  numbering: { config: [
    { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { run: { bold: true, color: ACCENT }, paragraph: { indent: { left: 460, hanging: 360 } } } }] },
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 300 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080, header: 500, footer: 500 } }, titlePage: true },
    headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } },
      children: [new TextRun({ text: 'C360 Insights  ·  Report Engine User Guide', size: 16, color: MUTED, font: FONT })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16, color: MUTED, font: FONT })] })] }) },
    children,
  }],
})

Packer.toBuffer(document).then((buffer) => {
  fs.writeFileSync(OUT, buffer)
  console.log(`C360_Insights_User_Guide.docx: ${PARTS.length} parts, ${used.size} step topics from the help, ${figureNumber} screenshots (${Math.round(buffer.length / 1024)} KB)`)
  const unshown = Object.keys(FIGURES).filter((key) => !CUSTOM_TITLE[key] && !used.has(key))
  if (unshown.length) console.log(`screenshots for topics not in the outline: ${unshown.join(' | ')}`)
  if (unplaced.length) console.log(`not placed in the outline: ${unplaced.join(' | ')}`)
}).catch((error) => { console.error(error); process.exit(1) })
