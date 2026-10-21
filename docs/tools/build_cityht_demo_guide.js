// Builds docs/manuals/C360_ClickHouse_Demo_Guide.docx: how to present the City HT (CITYHT) ClickHouse demo, step by step.
//   node docs/tools/build_cityht_demo_guide.js
// The text is read from the Platform Guide chapter docs/manuals/platform-guide/18a-clickhouse-demo.md, so the Word copy
// follows the help: edit the chapter, then rebuild.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { parse } = require('./build_manuals')

function loadDocx() {
  try { return require('docx') } catch { /* fall through to the global folder */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'docx'))
}
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat, AlignmentType,
  PageBreak, Header, Footer, PageNumber } = loadDocx()

const REPO = path.resolve(__dirname, '..', '..')
const SOURCE = path.join(REPO, 'docs', 'manuals', 'platform-guide', '18a-clickhouse-demo.md')
const OUT = path.join(REPO, 'docs', 'manuals', 'C360_ClickHouse_Demo_Guide.docx')
const FONT = 'Arial'
const INK = '1F2440'
const MUTED = '555B6E'
const LINE = 'D9DBE3'
const ACCENT = '2753E4'
const PAGE_WIDTH = 12240 - 2 * 1080                                                        // US Letter, 0.75" margins

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
function runs(text, base = {}) {
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

const fit = (head, rows) => head.map((h, i) => Math.max(8, Math.sqrt(Math.max(h.length, ...rows.map((r) => (r[i] || '').length)))))
const NUMERIC = /^[\d.,]+\s*(s|M)?$/

function table(head, rows, widths = fit(head, rows)) {
  const total = widths.reduce((a, b) => a + b, 0)
  const scaled = widths.map((w) => Math.round((w / total) * PAGE_WIDTH))
  scaled[scaled.length - 1] += PAGE_WIDTH - scaled.reduce((a, b) => a + b, 0)
  const numeric = head.map((_, i) => rows.every((r) => !r[i] || NUMERIC.test(r[i].trim())))
  const cell = (text, i, header) => new TableCell({ width: { size: scaled[i], type: WidthType.DXA }, margins: { top: 70, bottom: 70, left: 110, right: 110 },
    shading: header ? { type: ShadingType.CLEAR, fill: 'EEF1FA', color: 'auto' } : undefined,
    children: [new Paragraph({ alignment: numeric[i] ? AlignmentType.RIGHT : AlignmentType.LEFT, children: runs(text || '', header ? { bold: true, size: 18, color: INK } : { size: 19 }) })] })
  return new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: scaled,
    rows: [new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, true)) }), ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, false)) }))],
    borders: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE }, left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E6E8EF' }, insideVertical: { style: BorderStyle.NONE } } })
}

function callout(title, text) {
  return new Paragraph({ spacing: { before: 60, after: 200, line: 276 }, indent: { left: 120, right: 120 }, shading: { type: ShadingType.CLEAR, fill: 'F1F4FD', color: 'auto' },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
    children: [new TextRun({ text: `${title}  `, bold: true, font: FONT, size: 20, color: INK }), ...runs(text, { size: 20 })] })
}

/** the four large tables on the cover, read from the chapter's data table: "25,012,727" → "25M" */
function keyFigures(dataTable) {
  const big = dataTable.rows.filter((r) => /^[\d,]+$/.test(r[1].trim()) && Number(r[1].replace(/,/g, '')) >= 100000)
  const cellWidth = Math.floor(PAGE_WIDTH / big.length)
  const none = { style: BorderStyle.NONE }
  return new Table({ width: { size: cellWidth * big.length, type: WidthType.DXA }, columnWidths: big.map(() => cellWidth),
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: LINE } },
    rows: [new TableRow({ children: big.map((r) => {
      const millions = Number(r[1].replace(/,/g, '')) / 1e6
      return new TableCell({ width: { size: cellWidth, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 160, right: 160 }, children: [
        new Paragraph({ children: [new TextRun({ text: `${Math.round(millions * 10) / 10}M`, bold: true, size: 48, color: INK, font: FONT })] }),
        new Paragraph({ children: [new TextRun({ text: r[0].replace(/\s*\(.*\)$/, ''), size: 18, color: MUTED, font: FONT })] }),
      ] })
    }) })] })
}

const blocks = parse(fs.readFileSync(SOURCE, 'utf8'))
const title = blocks.find((b) => b.kind === 'heading' && b.level === 1).text
const where = blocks.find((b) => b.kind === 'paragraph' && b.text.startsWith('**Where:**'))
const dataTable = blocks.find((b) => b.kind === 'table')
const purpose = blocks[blocks.findIndex((b) => b.kind === 'heading' && b.text === 'What this is for') + 1]

let listInstance = 0
let stepCount = 0
const body = []
for (const block of blocks) {
  if (block === where || (block.kind === 'heading' && block.level === 1)) continue
  if (block.kind === 'heading') {
    const breakBefore = block.text === 'Step by step'
    const text = block.text === 'Related chapters' ? 'Related chapters in the Platform Guide' : block.text
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: breakBefore, keepNext: true, children: [new TextRun({ text, font: FONT })] }))
    continue
  }
  const step = block.kind === 'paragraph' && /^\*\*(\d+)\.\s+(.*)\*\*$/.exec(block.text)
  if (step) {
    stepCount += 1
    listInstance += 1
    body.push(new Paragraph({ spacing: { before: 280, after: 20 }, keepNext: true,
      children: [new TextRun({ text: `STEP ${step[1]}`, bold: true, size: 17, color: ACCENT, font: FONT, characterSpacing: 30 })] }))
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [new TextRun({ text: step[2], font: FONT })] }))
    continue
  }
  if (block.kind === 'paragraph') body.push(p(block.text))
  else if (block.kind === 'list') {
    if (!stepCount || !block.ordered) listInstance += 1
    const last = block.items.length - 1
    block.items.forEach((item, i) => body.push(new Paragraph({ children: runs(item), spacing: { after: i === last ? 160 : 80, line: 276 }, keepLines: true,
      numbering: { reference: block.ordered ? 'steps' : 'bullets', level: 0, instance: listInstance }, keepNext: i < last && block.items.length <= 4 })))
  } else if (block.kind === 'table') {
    body.push(table(block.head, block.rows))
    body.push(new Paragraph({ spacing: { after: 160 }, children: [] }))
  } else if (block.kind === 'quote') body.push(callout('Note', block.text))
}

const children = [
  new Paragraph({ spacing: { before: 2200, after: 120 }, children: [new TextRun({ text: 'C360 INSIGHTS  ·  PLATFORM DEMO', bold: true, size: 22, color: ACCENT, font: FONT, characterSpacing: 40 })] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'ClickHouse Demo Guide', bold: true, size: 60, color: INK, font: FONT })] }),
  new Paragraph({ spacing: { after: 480 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 12 } },
    children: [new TextRun({ text: 'The City HT workspace: how to open it, what to show, and how fast Insights answers on 25 million messages', size: 26, color: MUTED, font: FONT })] }),
  keyFigures(dataTable),
  new Paragraph({ spacing: { after: 360 }, children: [] }),
  p(purpose.text, { run: { size: 22 }, paragraph: { spacing: { after: 240, line: 300 } } }),
  callout('Where', where.text.replace(/^\*\*Where:\*\*\s*/, '')),
  p(`${stepCount} demo steps. Built ${new Date().toISOString().slice(0, 10)} from the Platform Guide chapter "${title}", so it matches the back-office help. Names in **bold** are what you see on the screen: a button, a menu item or a field.`,
    { run: { color: MUTED, size: 19 } }),
  new Paragraph({ children: [new PageBreak()] }),
  ...body,
]

const document = new Document({
  creator: 'C360', title: 'C360 Insights: ClickHouse Demo Guide (City HT)', description: 'How to present the City HT ClickHouse demo, step by step',
  styles: { default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, font: FONT, color: INK },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, font: FONT, color: INK },
        paragraph: { spacing: { before: 0, after: 100 }, outlineLevel: 1 } },
    ] },
  numbering: { config: [
    { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { run: { bold: true, color: ACCENT }, paragraph: { indent: { left: 460, hanging: 360 } } } }] },
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 300 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080, header: 500, footer: 500 } }, titlePage: true },
    headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } },
      children: [new TextRun({ text: 'C360 Insights  ·  ClickHouse Demo Guide (City HT)', size: 16, color: MUTED, font: FONT })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16, color: MUTED, font: FONT })] })] }) },
    children,
  }],
})

Packer.toBuffer(document).then((buffer) => {
  fs.writeFileSync(OUT, buffer)
  console.log(`C360_ClickHouse_Demo_Guide.docx: ${stepCount} steps (${Math.round(buffer.length / 1024)} KB)`)
}).catch((error) => { console.error(error); process.exit(1) })
