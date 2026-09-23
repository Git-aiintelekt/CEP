/**
 * What the editor changed about code that passed the checks. GrapesJS reads MJML with the browser's HTML parser and
 * writes back its own copy, so the design can end up a little different from what was typed: an unclosed tag gets
 * closed, a second footer is taken out again, the hide-on-phones rule is added to mj-head. Nothing of that may happen
 * silently, so each is named here.
 */
import { FOOTER_CLASS, HIDE_MOBILE_CLASS } from '../blocks/register'

const TAG = /<(\/?)(mjml|mj-[a-z-]+)\b[^>]*?(\/?)>/gi

/** Comments can hold tags that were commented out; they are not structure. */
const withoutComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '')

/** Elements that hold words or a picture, never other blocks: anything that ends up inside one was swallowed by it. */
const LEAVES = new Set([
  'mj-text', 'mj-button', 'mj-image', 'mj-divider', 'mj-spacer', 'mj-raw', 'mj-table', 'mj-social-element', 'mj-navbar-link',
  'mj-carousel-image', 'mj-accordion-title', 'mj-accordion-text',
])

export interface Unclosed {
  name: string
  /** blocks that now sit inside it although it cannot hold blocks: what the parser's repair moved */
  swallowed: string[]
}

/** mj-* elements opened and never closed, in the order they were opened, with what ended up inside each. */
export function unclosedTags(text: string): Unclosed[] {
  const open: { name: string; children: string[] }[] = []
  const unclosed: { name: string; children: string[] }[] = []
  for (const match of withoutComments(text).matchAll(TAG)) {
    const [, closing, rawName, selfClosing] = match
    const name = rawName.toLowerCase()
    if (!closing) {
      open.at(-1)?.children.push(name)
      if (!selfClosing) open.push({ name, children: [] })
      continue
    }
    const at = open.map((entry) => entry.name).lastIndexOf(name)
    if (at === -1) continue
    // everything opened after the element being closed was left open; the parser closes it here
    unclosed.push(...open.splice(at).slice(1))
  }
  return [...unclosed, ...open].map(({ name, children }) => ({ name, swallowed: LEAVES.has(name) ? children : [] }))
}

function describeUnclosed({ name, swallowed }: Unclosed): string {
  if (swallowed.length === 0) return `closed <${name}>, which was left open`
  const moved = [...new Set(swallowed)].map((child) => `<${child}>`).join(', ')
  return `closed <${name}>, which was left open, so the ${moved} after it ${swallowed.length === 1 ? 'is' : 'are'} now inside it`
}

const footerCount = (text: string) => (withoutComments(text).match(new RegExp(`css-class="[^"]*\\b${FOOTER_CLASS}\\b`, 'g')) ?? []).length

/** The opening mj-* tags in order: the structure, without attributes, text or whitespace. */
function structure(text: string): string[] {
  return [...withoutComments(text).matchAll(TAG)].filter((match) => !match[1]).map((match) => match[2].toLowerCase())
}

const hasPhoneRule = (text: string) => new RegExp(`<mj-style[^>]*>[^<]*\\.${HIDE_MOBILE_CLASS}`).test(text)

/** What the editor did to the typed code, in plain words; empty when it kept it as it was. */
export function describeAdjustments(typed: string, applied: string): string[] {
  const changes: string[] = []

  for (const tag of unclosedTags(typed)) changes.push(describeUnclosed(tag))

  const removedFooters = footerCount(typed) - footerCount(applied)
  if (removedFooters > 0) changes.push(removedFooters === 1 ? 'removed a second footer: an email has only one' : `removed ${removedFooters} extra footers: an email has only one`)

  if (!hasPhoneRule(typed) && hasPhoneRule(applied)) changes.push('added the hide-on-phones rule to mj-head')

  // anything else that moved: compared without the rule just named, which is expected
  const before = structure(typed).filter((name) => name !== 'mj-style')
  const after = structure(applied).filter((name) => name !== 'mj-style')
  if (changes.length === 0 && before.join(' ') !== after.join(' ')) changes.push('changed the structure of the blocks')

  return changes
}

export const adjustedNote = (changes: string[]) => `The editor adjusted the code: ${changes.join('; ')}.`
