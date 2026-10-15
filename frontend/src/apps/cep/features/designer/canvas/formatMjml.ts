/**
 * The editor writes MJML on one line, which makes line numbers useless. This puts each element on its own line,
 * indented by depth — and changes nothing else.
 *
 * Only the whitespace between structural elements is touched, where MJML ignores it. An element that carries text
 * or markup (mj-text, mj-button, mj-raw, mj-style …) is copied whole, byte for byte: its words, its inline HTML, its
 * {{tags}}. Every tag is copied as written, so attribute values never change. Anything the formatter does not
 * understand — text loose between blocks, a tag closed out of order — returns the code exactly as it came in.
 */

/** Elements whose content is text or markup, not other blocks: copied whole, opening tag to closing tag. */
const VERBATIM = new Set([
  'mj-text', 'mj-button', 'mj-raw', 'mj-table', 'mj-social-element', 'mj-navbar-link', 'mj-accordion-title', 'mj-accordion-text',
  'mj-style', 'mj-title', 'mj-preview', 'mj-html-attribute',
])

const INDENT = '  '

/** An mj-* tag or the root, or a comment. A quoted attribute value may hold a >, so quotes are read as a whole. */
const TOKEN = /<!--[\s\S]*?-->|<(\/?)(mjml|mj-[a-z-]+)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/gi

interface Token {
  kind: 'open' | 'close' | 'self' | 'comment'
  name: string
  text: string
  start: number
  end: number
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  for (const match of source.matchAll(TOKEN)) {
    const start = match.index ?? 0
    const text = match[0]
    const end = start + text.length
    if (text.startsWith('<!--')) tokens.push({ kind: 'comment', name: '', text, start, end })
    else tokens.push({ kind: match[1] ? 'close' : match[3] ? 'self' : 'open', name: match[2].toLowerCase(), text, start, end })
  }
  return tokens
}

export function formatMjml(source: string): string {
  const tokens = tokenize(source)
  const lines: string[] = []
  const open: string[] = []
  let at = 0 // where in source the next unconsumed character is

  /** only whitespace may sit between structural elements; anything else means the code is not what we think */
  const gapIsBlank = (to: number) => source.slice(at, to).trim() === ''

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.start < at) continue // inside an element already copied whole
    if (!gapIsBlank(token.start)) return source
    const pad = INDENT.repeat(open.length)

    if (token.kind === 'comment' || token.kind === 'self') {
      lines.push(pad + token.text)
      at = token.end
      continue
    }

    if (token.kind === 'close') {
      if (open.at(-1) !== token.name) return source
      open.pop()
      lines.push(INDENT.repeat(open.length) + token.text)
      at = token.end
      continue
    }

    // an element that carries content: from its opening tag to its closing tag, exactly as written
    if (VERBATIM.has(token.name)) {
      const closing = new RegExp(`</${token.name}\\s*>`, 'gi')
      closing.lastIndex = token.end
      const found = closing.exec(source)
      if (!found) return source
      lines.push(pad + source.slice(token.start, found.index + found[0].length))
      at = found.index + found[0].length
      continue
    }

    // a container with nothing in it (mj-image, mj-divider, mj-all …) stays on one line
    const next = tokens[index + 1]
    if (next?.kind === 'close' && next.name === token.name && source.slice(token.end, next.start).trim() === '') {
      lines.push(pad + source.slice(token.start, next.end))
      at = next.end
      index++
      continue
    }

    lines.push(pad + token.text)
    open.push(token.name)
    at = token.end
  }

  if (open.length > 0 || !gapIsBlank(source.length)) return source
  return lines.join('\n')
}
