// Builds the two manuals from their chapters: docs/manuals/CEP_User_Guide.md + .docx and CEP_Platform_Guide.md + .docx.
//   node docs/tools/build_manuals.js
// Needs the docx package (npm install docx in any folder on the path, or npm install -g docx).
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function loadDocx() {
  try { return require('docx') } catch { /* fall through to the global folder */ }
  const globalRoot = execSync('npm root -g').toString().trim()
  return require(path.join(globalRoot, 'docx'))
}
const docx = loadDocx()
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat, AlignmentType, PageBreak } = docx

const ROOT = path.resolve(__dirname, '..', 'manuals')
const GUIDES = [
  { folder: 'user-guide', title: 'CEP User Guide', subtitle: 'For everyone who signs in to a workspace', out: 'CEP_User_Guide' },
  { folder: 'platform-guide', title: 'CEP Platform Guide', subtitle: 'For the platform team in the back-office', out: 'CEP_Platform_Guide' },
]

// ---------------------------------------------------------------- the Markdown subset (the same one frontend/src/help/markdown.tsx renders)
const cells = (line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
const isSeparator = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line)
const isRow = (line) => line.trim().startsWith('|')
const isItem = (line) => /^(\s*)([-*]|\d+\.)\s+/.test(line)

function parse(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') { i += 1; continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() }); i += 1; continue }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push({ kind: 'rule' }); i += 1; continue }
    if (line.startsWith('```')) {
      const text = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) { text.push(lines[i]); i += 1 }
      i += 1
      blocks.push({ kind: 'code', text: text.join('\n') })
      continue
    }
    if (isRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && isRow(lines[i])) { rows.push(cells(lines[i])); i += 1 }
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    if (isItem(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items = []
      while (i < lines.length && (isItem(lines[i]) || (lines[i].startsWith('  ') && items.length > 0))) {
        if (isItem(lines[i])) items.push(lines[i].replace(/^(\s*)([-*]|\d+\.)\s+/, ''))
        else items[items.length - 1] += ' ' + lines[i].trim()
        i += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    if (line.startsWith('>')) {
      const text = []
      while (i < lines.length && lines[i].startsWith('>')) { text.push(lines[i].replace(/^>\s?/, '')); i += 1 }
      blocks.push({ kind: 'quote', text: text.join(' ') })
      continue
    }
    const text = []
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6})\s/.test(lines[i]) && !isRow(lines[i]) && !isItem(lines[i]) && !lines[i].startsWith('```') && !lines[i].startsWith('>')) {
      text.push(lines[i].trim())
      i += 1
    }
    blocks.push({ kind: 'paragraph', text: text.join(' ') })
  }
  return blocks
}

// ---------------------------------------------------------------- Word
const FONT = 'Arial'
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g

function runs(text, base = {}) {
  return text.split(INLINE).filter(Boolean).map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) return new TextRun({ text: part.slice(2, -2), bold: true, font: FONT, ...base })
    if (part.startsWith('`') && part.endsWith('`')) return new TextRun({ text: part.slice(1, -1), font: 'Consolas', ...base })
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) return new TextRun({ text: link[1], underline: {}, color: '2753E4', font: FONT, ...base })
    return new TextRun({ text: part, font: FONT, ...base })
  })
}

const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 }
const PAGE_WIDTH = 12240 - 2 * 1080                                                        // US Letter, 0.75" margins

function tableOf(block) {
  const columns = Math.max(block.head.length, ...block.rows.map((row) => row.length))
  const first = Math.min(2600, Math.round(PAGE_WIDTH / columns))
  const rest = Math.floor((PAGE_WIDTH - first) / Math.max(columns - 1, 1))
  const widths = Array.from({ length: columns }, (_, index) => (index === 0 ? first : rest))
  const cell = (text, index, head) => new TableCell({
    width: { size: widths[index], type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, fill: 'EEEFF5', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [new Paragraph({ children: runs(text || '', head ? { bold: true, size: 18 } : { size: 19 }) })],
  })
  const rows = []
  if (block.head.some(Boolean)) rows.push(new TableRow({ tableHeader: true, children: block.head.map((text, index) => cell(text, index, true)) }))
  for (const row of block.rows) rows.push(new TableRow({ children: Array.from({ length: columns }, (_, index) => cell(row[index], index, false)) }))
  return new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: widths, rows,
    borders: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D9DBE3' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9DBE3' }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E6E8EF' }, insideVertical: { style: BorderStyle.NONE } } })
}

function chaptersOf(folder) {
  const dir = path.join(ROOT, folder)
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort().map((name) => ({ name, source: fs.readFileSync(path.join(dir, name), 'utf8') }))
}

function build(guide) {
  const chapters = chaptersOf(guide.folder)
  const children = [
    new Paragraph({ children: [new TextRun({ text: guide.title, bold: true, size: 56, font: FONT })], spacing: { before: 2400, after: 200 } }),
    new Paragraph({ children: [new TextRun({ text: guide.subtitle, size: 28, font: FONT, color: '555B6E' })], spacing: { after: 200 } }),
    new Paragraph({ children: [new TextRun({ text: `Built ${new Date().toISOString().slice(0, 10)} from docs/manuals/${guide.folder}`, size: 20, font: FONT, color: '555B6E' })] }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Contents', font: FONT })] }),
  ]
  for (const chapter of chapters) {
    for (const block of parse(chapter.source)) {
      if (block.kind === 'heading' && block.level <= 2) children.push(new Paragraph({ children: runs(block.text, { size: block.level === 1 ? 22 : 20 }), indent: { left: block.level === 1 ? 0 : 400 }, spacing: { after: 40 } }))
    }
  }
  children.push(new Paragraph({ children: [new PageBreak()] }))
  const merged = []
  for (const chapter of chapters) {
    const blocks = parse(chapter.source)
    for (const block of blocks) {
      switch (block.kind) {
        case 'heading':
          if (block.level === 1 && merged.length) children.push(new Paragraph({ children: [new PageBreak()] }))
          children.push(new Paragraph({ heading: HEADINGS[Math.min(block.level, 4)], children: runs(block.text), spacing: { before: block.level === 1 ? 0 : 240, after: 120 } }))
          break
        case 'paragraph':
          children.push(new Paragraph({ children: runs(block.text, { size: 21 }), spacing: { after: 120 } }))
          break
        case 'list':
          block.items.forEach((item) => children.push(new Paragraph({ children: runs(item, { size: 21 }), numbering: { reference: block.ordered ? 'numbers' : 'bullets', level: 0 }, spacing: { after: 60 } })))
          break
        case 'table':
          children.push(tableOf(block), new Paragraph({ spacing: { after: 120 } }))
          break
        case 'quote':
          children.push(new Paragraph({ children: runs(block.text, { size: 21, italics: true }), indent: { left: 400 }, spacing: { after: 120 } }))
          break
        case 'code':
          block.text.split('\n').forEach((line) => children.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 18 })], shading: { type: ShadingType.CLEAR, fill: 'F3F4F8', color: 'auto' } })))
          children.push(new Paragraph({ spacing: { after: 120 } }))
          break
        case 'rule':
          children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9DBE3' } }, spacing: { after: 120 } }))
          break
      }
      merged.push(block)
    }
  }
  const document = new Document({
    styles: { default: { document: { run: { font: FONT, size: 21 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: true, font: FONT, color: '1F2440' }, paragraph: { spacing: { before: 0, after: 160 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: FONT, color: '1F2440' }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: FONT, color: '2A3052' }, paragraph: { spacing: { before: 200, after: 80 } } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 21, bold: true, font: FONT, color: '555B6E' }, paragraph: { spacing: { before: 160, after: 60 } } },
      ] },
    numbering: { config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    ] },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }],
  })
  const toc = chapters.flatMap((chapter) => parse(chapter.source).filter((block) => block.kind === 'heading' && block.level <= 2)
    .map((block) => `${block.level === 1 ? '- ' : '  - '}${block.text}`)).join('\n')
  const markdown = `# ${guide.title}\n\n${guide.subtitle}. Built from \`docs/manuals/${guide.folder}\`; edit the chapters there, not this file.\n\n## Contents\n\n${toc}\n\n---\n\n` +
    chapters.map((chapter) => chapter.source.trim()).join('\n\n---\n\n') + '\n'
  fs.writeFileSync(path.join(ROOT, `${guide.out}.md`), markdown)
  return Packer.toBuffer(document).then((buffer) => {
    fs.writeFileSync(path.join(ROOT, `${guide.out}.docx`), buffer)
    console.log(`${guide.out}: ${chapters.length} chapters -> ${guide.out}.md, ${guide.out}.docx (${Math.round(buffer.length / 1024)} KB)`)
  })
}

Promise.all(GUIDES.map(build)).catch((error) => { console.error(error); process.exit(1) })
