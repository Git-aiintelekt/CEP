/**
 * What stands between hand-edited MJML and the design: the checks run on Apply, in order, stopping at the first
 * problem. Pure — the compiler is handed in — so every rule is tested without GrapesJS.
 *
 * Step b mirrors the server's own refusals (backend apps/templates/design.py, FORBIDDEN and MAX_MJML_BYTES), so a
 * person learns about them here rather than from a failed save.
 */
import type { PersonalizationTag } from '@/lib/types'

import { asToken, extractTags, unknownTags } from '../tags'

/** The server refuses a design over this many bytes of MJML. */
export const MAX_MJML_BYTES = 512 * 1024

/** The server's FORBIDDEN patterns, word for word in what they match; the messages are ours. */
export const FORBIDDEN: readonly { pattern: RegExp; message: string }[] = [
  { pattern: /<\s*script\b/i, message: 'Scripts aren’t allowed in an email. Remove the <script> tag.' },
  { pattern: /<\s*mj-include\b/i, message: 'mj-include isn’t allowed. Paste the included code in its place.' },
  { pattern: /\son[a-z]+\s*=\s*["']/i, message: 'Event handlers such as onclick aren’t allowed in an email. Remove them.' },
  { pattern: /javascript\s*:/i, message: 'javascript: links aren’t allowed. Use a web address instead.' },
]

export const EMPTY_MESSAGE = 'There is no code to apply. Paste or write the email’s MJML first.'
export const NOT_MJML_MESSAGE = 'This isn’t valid MJML. Check that the code starts with <mjml> and ends with </mjml>.'
export const tooLargeMessage = (bytes: number) =>
  `The code is ${Math.ceil(bytes / 1024)} KB. The server accepts up to ${MAX_MJML_BYTES / 1024} KB. Move large images to the image library.`
export const unknownFieldMessage = (keys: string[]) => `Unknown field${keys.length > 1 ? 's' : ''}: ${keys.map(asToken).join(', ')}`
export const moreProblems = (count: number) => (count === 1 ? 'and 1 more problem' : `and ${count} more problems`)

/** What mjml-browser reports for each problem it finds. */
export interface CompileError {
  line?: number
  message?: string
  formattedMessage?: string
  tagName?: string
}

export type Compile = (mjml: string) => { html?: string; errors?: CompileError[] }

export type CheckResult =
  | { ok: true }
  | {
      ok: false
      /** one plain line */
      message: string
      /** where to put the caret, when the problem has a line */
      line?: number
      /** "and 2 more problems", when there are */
      more?: string
      /** the compiler's own words, behind Show details */
      details: string[]
    }

/** "Line 8 of . (mj-text) — …" -> the compiler text without the empty file name the plugin leaves in. */
export function rawDetail(error: CompileError): string {
  return (error.formattedMessage ?? error.message ?? '').replace(/^Line (\d+) of \S*\s*/, 'Line $1 ')
}

const PARENT = /^(mj-[a-z-]+) cannot be used inside (mj-[a-z-]+)/
const MISSING = /^Element (mj-[a-z-]+) doesn't exist or is not registered$/
const ATTRIBUTE = /^Attribute ([\w-]+) has invalid value: (.*) for type/
const UNKNOWN_ATTRIBUTE = /^Attribute ([\w-]+) is illegal$/

const where = (tag: string) => (tag === 'mj-body' ? 'the body' : tag)

/** The compiler's sentence in plain words, without its line. */
export function plainProblem(error: CompileError): string {
  const message = (error.message ?? '').trim()
  let match = PARENT.exec(message)
  if (match) return `${match[1]} can’t sit directly in ${where(match[2])}.`
  match = MISSING.exec(message)
  if (match) return `${match[1]} isn’t an MJML element. Check the spelling, or remove it.`
  match = ATTRIBUTE.exec(message)
  if (match) return `${error.tagName ?? 'An element'} has a ${match[1]} value MJML can’t read: ${match[2]}.`
  match = UNKNOWN_ATTRIBUTE.exec(message)
  if (match) return `${error.tagName ?? 'An element'} doesn’t take a ${match[1]} attribute.`
  return message === '' ? 'The code has a problem MJML can’t describe.' : message
}

/** "Line 8: mj-text can't sit directly in the body." — the first problem, in one line. */
export function plainLine(error: CompileError): string {
  const problem = plainProblem(error)
  return error.line ? `Line ${error.line}: ${problem}` : problem
}

/** a, b, c and d, in that order; the first that finds something is the answer */
export function checkMjml(text: string, { compile, catalogue }: { compile: Compile; catalogue: PersonalizationTag[] }): CheckResult {
  // a. nothing to apply — and the plugin would quietly compile the current design in its place
  if (text.trim() === '') return { ok: false, message: EMPTY_MESSAGE, details: [] }

  // b. what the server refuses outright
  for (const rule of FORBIDDEN) {
    const found = rule.pattern.exec(text)
    if (found) return { ok: false, message: rule.message, line: lineOf(text, found.index), details: [] }
  }
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_MJML_BYTES) return { ok: false, message: tooLargeMessage(bytes), details: [] }

  // c. what MJML makes of it
  let errors: CompileError[]
  try {
    errors = compile(text).errors ?? []
  } catch (error) {
    return { ok: false, message: NOT_MJML_MESSAGE, details: [error instanceof Error ? error.message : String(error)] }
  }
  if (errors.length > 0) {
    // the compiler reports in the order it walks the tree, not by line: the first problem is the highest up
    const ordered = [...errors].sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity))
    const [first] = ordered
    return {
      ok: false,
      message: plainLine(first),
      line: first.line,
      more: errors.length > 1 ? moreProblems(errors.length - 1) : undefined,
      details: ordered.map(rawDetail),
    }
  }

  // d. fields the workspace has never heard of; the server would refuse to activate the template
  const unknown = unknownTags(extractTags(text), catalogue)
  if (unknown.length > 0) {
    const at = text.search(new RegExp(`\\{\\{\\s*${unknown[0].replace(/\./g, '\\.')}\\s*\\}\\}`))
    return { ok: false, message: unknownFieldMessage(unknown), line: at >= 0 ? lineOf(text, at) : undefined, details: [] }
  }

  return { ok: true }
}

/** 1-based line of a character offset. */
export function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
}
