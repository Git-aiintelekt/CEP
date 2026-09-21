/**
 * Turns the compiled email into what the preview shows for one contact.
 *
 * Tags inside words become marked spans, so a reader can tell a sample, a fallback, a blank and an unknown tag apart.
 * Tags inside attributes (a link, an image address, alt text) cannot hold a span, so they take the plain value —
 * and a link that comes out empty is counted, because the recipient would get a dead link.
 *
 * The input is never changed: this works on a parsed copy, and its output only ever reaches the preview iframe.
 */
import type { PersonalizationTag } from '@/lib/types'

import { previewParts, type Fill, type FillKind, type PreviewProfile } from './previewProfiles'

export const NO_VALUE_MARKER = '(no value)'
export const MARKS_STYLE_ID = 'cep-preview-marks'

/** One class per kind of mark. A value for the contact is shown plainly, so it has none. */
export const MARK_CLASS: Record<Exclude<FillKind, 'value'>, string> = {
  sample: 'cep-pv-sample',
  default: 'cep-pv-default',
  blank: 'cep-pv-blank',
  unknown: 'cep-pv-unknown',
}

const TAG = /\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}/

/**
 * The frame is its own document and cannot see the app's custom properties, so the tokens are resolved here and
 * written in (as canvasSkin.ts does). An unreadable token yields an invalid declaration, which the browser drops.
 */
export function marksCss(root: Element = document.documentElement): string {
  const style = getComputedStyle(root)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const chip = 'padding: 0 4px; border-radius: 4px; font-weight: inherit;'
  return `
.${MARK_CLASS.sample} { ${chip} background: ${token('--color-brand-100')}; color: ${token('--color-brand-800')}; }
.${MARK_CLASS.default} { ${chip} background: ${token('--color-line-subtle')}; color: ${token('--color-ink-700')}; }
.${MARK_CLASS.blank} { ${chip} background: ${token('--color-line-subtle')}; color: ${token('--color-ink-500')}; font-style: italic; }
.${MARK_CLASS.unknown} { ${chip} background: ${token('--color-danger-bg')}; color: ${token('--color-danger-text')}; }
`
}

function markFor(doc: Document, fill: Fill): Node {
  if (fill.kind === 'value') return doc.createTextNode(fill.text)
  const span = doc.createElement('span')
  span.className = MARK_CLASS[fill.kind]
  span.textContent = fill.kind === 'blank' ? NO_VALUE_MARKER : fill.text
  if (fill.kind === 'default') span.title = `{{${fill.key}}} has no value for this contact, so its default is used`
  if (fill.kind === 'blank') span.title = `{{${fill.key}}} has no value and no default: the email sends nothing here`
  if (fill.kind === 'unknown') span.title = `{{${fill.key}}} is not a personalization tag in this workspace`
  return span
}

const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE'])

export interface DecoratedPreview {
  html: string
  /** links whose address has a tag that comes out blank for this contact */
  emptyLinks: number
}

/** A phone draws its scrollbar over the content, never beside it: without this, a desktop scrollbar would narrow the email. */
export const PHONE_FRAME_CSS = 'html { scrollbar-width: none; }'

interface DecorateOptions {
  /** where the tokens are read from; the app's root by default */
  root?: Element
  /** drawn at phone width */
  phone?: boolean
}

export function decoratePreview(html: string, catalogue: PersonalizationTag[], profile: PreviewProfile, { root, phone = false }: DecorateOptions = {}): DecoratedPreview {
  if (html.trim() === '') return { html: '', emptyLinks: 0 }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let emptyLinks = 0

  // attributes first, while the tree still holds only the email's own elements
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (!TAG.test(attribute.value)) continue
      const parts = previewParts(attribute.value, catalogue, profile)
      const blankTag = parts.some((part) => typeof part !== 'string' && part.kind === 'blank')
      const filled = parts.map((part) => (typeof part === 'string' ? part : part.text)).join('')
      if (attribute.name === 'href' && (blankTag || filled.trim() === '')) emptyLinks += 1
      element.setAttribute(attribute.name, filled)
    }
  }

  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT)
  const found: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (TAG.test(text.data) && !SKIPPED.has(text.parentElement?.tagName ?? '')) found.push(text)
  }
  for (const text of found) {
    const fragment = doc.createDocumentFragment()
    for (const part of previewParts(text.data, catalogue, profile)) {
      fragment.append(typeof part === 'string' ? doc.createTextNode(part) : markFor(doc, part))
    }
    text.replaceWith(fragment)
  }

  // the title is plain text: it takes values, never marks
  if (doc.title && TAG.test(doc.title)) {
    doc.title = previewParts(doc.title, catalogue, profile).map((part) => (typeof part === 'string' ? part : part.text)).join('')
  }

  const style = doc.createElement('style')
  style.id = MARKS_STYLE_ID
  style.textContent = marksCss(root) + (phone ? PHONE_FRAME_CSS : '')
  doc.head.append(style)

  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, emptyLinks }
}
