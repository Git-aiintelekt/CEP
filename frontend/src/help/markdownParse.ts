/** The Markdown subset the manuals are written in, parsed into blocks; `markdown.tsx` renders them. */
export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }

const cells = (line: string) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
const isSeparator = (line: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line)
const isRow = (line: string) => line.trim().startsWith('|')
const isItem = (line: string) => /^(\s*)([-*]|\d+\.)\s+/.test(line)

export function parse(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') { i += 1; continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() }); i += 1; continue }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push({ kind: 'rule' }); i += 1; continue }
    if (line.startsWith('```')) {
      const text: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) { text.push(lines[i]); i += 1 }
      i += 1
      blocks.push({ kind: 'code', text: text.join('\n') })
      continue
    }
    if (isRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isRow(lines[i])) { rows.push(cells(lines[i])); i += 1 }
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    if (isItem(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && (isItem(lines[i]) || (lines[i].startsWith('  ') && items.length > 0))) {
        if (isItem(lines[i])) items.push(lines[i].replace(/^(\s*)([-*]|\d+\.)\s+/, ''))
        else items[items.length - 1] += ' ' + lines[i].trim()
        i += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    if (line.startsWith('>')) {
      const text: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) { text.push(lines[i].replace(/^>\s?/, '')); i += 1 }
      blocks.push({ kind: 'quote', text: text.join(' ') })
      continue
    }
    const text: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6})\s/.test(lines[i]) && !isRow(lines[i]) && !isItem(lines[i]) && !lines[i].startsWith('```') && !lines[i].startsWith('>')) {
      text.push(lines[i].trim())
      i += 1
    }
    blocks.push({ kind: 'paragraph', text: text.join(' ') })
  }
  return blocks
}

/** the chapter's title: its first H1 */
export function titleOf(source: string): string | null {
  const match = /^#\s+(.*)$/m.exec(source.replace(/\r\n?/g, '\n'))
  return match ? match[1].trim() : null
}
