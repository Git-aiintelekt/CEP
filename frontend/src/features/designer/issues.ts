/**
 * One list of everything wrong with an email design, merged from what the editor can see right now
 * and what the server said at the last save or the last failed activate.
 *
 * The server is the authority: an issue is an error only when the API would refuse the save or the
 * activate (see backend design.py activation_blockers and DesignSaveSerializer). Everything else is advice.
 */
import type { DesignFindings, PersonalizationTag } from '@/lib/types'

import { asToken, extractTags, unknownTags } from './tags'

export type IssueSeverity = 'error' | 'warning'

/** A block target names the block by tag and position, since the review reads the MJML, not the component tree. */
export interface BlockTarget {
  tag: string
  nth: number
  /** the setting the reader came here to fix */
  setting: string
}

export type IssueTarget =
  | { kind: 'field'; field: 'subject' | 'preheader' }
  | { kind: 'design' }
  | { kind: 'block'; block: BlockTarget }

export interface Issue {
  id: string
  severity: IssueSeverity
  message: string
  target: IssueTarget
  source: 'live' | 'saved'
  stale: boolean
}

export interface IssueInput {
  channel: string
  subject: string
  preheader: string
  tags: PersonalizationTag[]
  /** 0 = never saved */
  savedVersion: number
  dirty: boolean
  findings?: DesignFindings
  blockers?: Record<string, string>
  /** images in the design carrying no alt text; advice only, the server never checks it */
  imagesWithoutAlt?: { id: string; label: string; nth: number }[]
  /** images still showing a stand-in; advice only, and never a reason to refuse a save or an activate */
  placeholderImages?: { id: string; label: string; nth: number }[]
}

/** Inboxes truncate a subject around here. Advice only — the server saves it happily. */
export const SUBJECT_ADVISORY = 60
/** The preheader is cut off later than the subject, so its own advisory sits higher. */
export const PREHEADER_ADVISORY = 90
/** The server's own max_length, so anything longer is refused outright. */
export const SUBJECT_MAX = 300
export const PREHEADER_MAX = 300
export const PLACEHOLDER_IMAGE_MESSAGE = 'This image is still a placeholder.'

/**
 * An issue reads "what is wrong. what to do.", so a row shows the first sentence as its title and the rest as its
 * detail. A single sentence is a title alone. The full message stays the one source of the words.
 */
export function issueLines(message: string): { title: string; detail: string | null } {
  const at = message.indexOf('. ')
  if (at === -1) return { title: message.replace(/\.$/, ''), detail: null }
  return { title: message.slice(0, at), detail: message.slice(at + 2).trim() || null }
}

const SUBJECT: IssueTarget = { kind: 'field', field: 'subject' }
const PREHEADER: IssueTarget = { kind: 'field', field: 'preheader' }
const DESIGN: IssueTarget = { kind: 'design' }

export function computeIssues(input: IssueInput): Issue[] {
  const { channel, subject, preheader, tags, savedVersion, dirty, findings, blockers, imagesWithoutAlt, placeholderImages } = input

  // Findings describe a version that exists; before the first save there is nothing for them to describe.
  const saved = savedVersion === 0 ? undefined : findings
  const issue = (id: string, severity: IssueSeverity, message: string, target: IssueTarget, source: 'live' | 'saved'): Issue => ({
    id,
    severity,
    message,
    target,
    source,
    stale: source === 'saved' && dirty,
  })

  const errors: Issue[] = []
  const warnings: Issue[] = []

  const subjectEmpty = subject.trim() === ''
  const subjectMissingOnServer = Boolean(saved?.missing_subject) || blockers?.subject_line !== undefined
  if (subjectEmpty || subjectMissingOnServer) {
    errors.push(issue('subject-missing', 'error', 'The subject line is empty. Add one before activating.', SUBJECT, subjectEmpty ? 'live' : 'saved'))
  }

  if (subject.length > SUBJECT_MAX) {
    errors.push(issue('subject-too-long', 'error', `The subject line is ${subject.length} characters. Shorten it to ${SUBJECT_MAX} or fewer.`, SUBJECT, 'live'))
  }

  if (preheader.length > PREHEADER_MAX) {
    errors.push(issue('preheader-too-long', 'error', `The preheader is ${preheader.length} characters. Shorten it to ${PREHEADER_MAX} or fewer.`, PREHEADER, 'live'))
  }

  errors.push(...unknownTagIssues(subject, preheader, tags, saved, issue))

  // A tags blocker is the server's own wording for the same problem; only fall back to it when findings are absent.
  if (blockers?.tags !== undefined && saved === undefined) {
    errors.push(issue('unknown-tags', 'error', blockers.tags, DESIGN, 'saved'))
  }

  if (savedVersion === 0 || blockers?.design !== undefined) {
    errors.push(issue('not-saved', 'error', 'Save the email once before continuing.', DESIGN, savedVersion === 0 ? 'live' : 'saved'))
  }

  if (subject.length > SUBJECT_ADVISORY && subject.length <= SUBJECT_MAX) {
    warnings.push(
      issue('subject-long', 'warning', `The subject line is ${subject.length} characters. Many inboxes cut a subject off after about ${SUBJECT_ADVISORY} characters.`, SUBJECT, 'live'),
    )
  }

  // E_RECEIPT is transactional (BRD section 12): a receipt carries no unsubscribe link.
  if (saved?.missing_unsubscribe && channel !== 'E_RECEIPT') {
    warnings.push(issue('missing-unsubscribe', 'warning', `No ${asToken('unsubscribe_url')} link yet. Add one before a marketing campaign uses this template.`, DESIGN, 'saved'))
  }

  if (saved?.may_be_clipped) {
    warnings.push(issue('may-be-clipped', 'warning', `The HTML is ${Math.round(saved.html_bytes / 1024)} KB. Gmail clips messages over 102 KB.`, DESIGN, 'saved'))
  }

  for (const image of imagesWithoutAlt ?? []) {
    const target: IssueTarget = { kind: 'block', block: { tag: 'mj-image', nth: image.nth, setting: 'alt' } }
    warnings.push(issue(image.id, 'warning', `${image.label} has no alt text. Add one so the message still reads with images turned off.`, target, 'live'))
  }

  for (const image of placeholderImages ?? []) {
    const target: IssueTarget = { kind: 'block', block: { tag: 'mj-image', nth: image.nth, setting: 'src' } }
    warnings.push(issue(image.id, 'warning', PLACEHOLDER_IMAGE_MESSAGE, target, 'live'))
  }

  // Per-token fallback issues would be appended here once the server reports them.

  return [...errors, ...warnings]
}

type MakeIssue = (id: string, severity: IssueSeverity, message: string, target: IssueTarget, source: 'live' | 'saved') => Issue

/** One issue per unknown key. A key seen in a field keeps that field's target, even when the server also reported it. */
function unknownTagIssues(subject: string, preheader: string, tags: PersonalizationTag[], saved: DesignFindings | undefined, issue: MakeIssue): Issue[] {
  const byKey = new Map<string, Issue>()
  const message = (key: string) => `${asToken(key)} is not a personalization tag in this workspace. Remove it or choose one from the tag list.`

  for (const key of unknownTags(extractTags(subject), tags)) {
    byKey.set(key, issue(`unknown-tag:${key}`, 'error', message(key), SUBJECT, 'live'))
  }
  for (const key of unknownTags(extractTags(preheader), tags)) {
    if (!byKey.has(key)) byKey.set(key, issue(`unknown-tag:${key}`, 'error', message(key), PREHEADER, 'live'))
  }
  for (const key of saved?.unknown_tags ?? []) {
    if (!byKey.has(key)) byKey.set(key, issue(`unknown-tag:${key}`, 'error', message(key), DESIGN, 'saved'))
  }
  return [...byKey.values()]
}

export function summarise(issues: Issue[]): { errors: number; warnings: number; canContinue: boolean; note: string } {
  const errors = issues.filter((item) => item.severity === 'error').length
  const warnings = issues.length - errors
  return {
    errors,
    warnings,
    canContinue: errors === 0,
    note:
      errors > 0 ? `${errors} ${errors === 1 ? 'error' : 'errors'} must be fixed.`
      : warnings > 0 ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'} · advisory only.`
      : 'No errors.',
  }
}

/** Where a link row sends the reader: the block it belongs to, and the setting to put right. */
export function blockTargetForLink(link: { block: { tag: string; nth: number } | null }): BlockTarget | null {
  return link.block === null ? null : { ...link.block, setting: 'href' }
}

/** Where an issue row sends the reader, when it names a block at all. */
export function blockTargetForIssue(issue: Issue): BlockTarget | null {
  return issue.target.kind === 'block' ? issue.target.block : null
}
