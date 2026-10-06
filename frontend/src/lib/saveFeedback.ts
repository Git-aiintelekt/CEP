/**
 * Save feedback (docs/SAVE_FEEDBACK.md, docs/mockups/save-feedback.html): one way to say why a save failed, everywhere.
 *
 *   saveFailure(error, 'The sender was not saved', shownFields?)  → { title, detail, tone, reference, fields, general }
 *
 * The caller names what failed; the helper says why and what to do, in CEP's words. A browser's ("Failed to fetch"), a
 * server framework's ("Internal Server Error", "Invalid input") or a database's words never reach the screen.
 */
import { ApiError } from './api'

export interface SaveFailure {
  /** the line in bold: what failed, or "Check the highlighted fields" when fields say why */
  title: string
  /** one or two sentences: why, and what to do */
  detail: string
  /** the same, short enough for a toast's one line */
  short: string
  /** warning when nothing was wrong with the entry (no connection, the database busy); error otherwise */
  tone: 'error' | 'warning'
  /** ER-123 for CEP's own problem: the back-office Errors page finds it */
  reference: string | null
  /** field → message, for the fields the form shows */
  fields: Record<string, string>
  /** problems not about a shown field, for the banner */
  general: string[]
}

const DRF_FORBIDDEN = 'You do not have permission to perform this action.'
export const FIELDS_TITLE = 'Check the highlighted fields'

function sentence(text: string): string {
  const trimmed = text.trim()
  return trimmed === '' || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function clock(iso: unknown): string {
  const when = typeof iso === 'string' ? new Date(iso) : new Date()
  return (Number.isNaN(when.getTime()) ? new Date() : when).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** every message in a 400's errors, by field (nested objects flattened to their first message) */
function messagesOf(errors: unknown): [string, string][] {
  if (Array.isArray(errors)) return errors.map((message) => ['non_field_errors', String(message)])
  if (!errors || typeof errors !== 'object') return []
  return Object.entries(errors as Record<string, unknown>).flatMap(([field, value]): [string, string][] => {
    if (Array.isArray(value)) return value.length ? [[field, String(value[0])]] : []
    if (value && typeof value === 'object') return messagesOf(value).map(([, message]) => [field, message])
    return [[field, String(value)]]
  })
}

export function saveFailure(error: unknown, failedTitle: string, shownFields?: string[]): SaveFailure {
  const base: SaveFailure = { title: failedTitle, detail: '', short: '', tone: 'error', reference: null, fields: {}, general: [] }
  const failure = (made: Omit<SaveFailure, 'short'> & { short?: string }): SaveFailure => ({ ...made, short: made.short ?? made.detail })
  if (!(error instanceof ApiError)) {
    // a mistake in the page itself, not the server's answer: its own words would mean nothing to the reader
    return failure({ ...base, detail: 'Your entries are still here; try again. If it happens again, tell your administrator.', short: 'Try again.' })
  }
  const problem = error.problem as typeof error.problem & { reference?: string; at?: string }
  const said = problem.detail ? sentence(String(problem.detail)) : ''
  switch (true) {
    case error.status === 0:
      return failure({ ...base, title: 'CEP could not be reached', tone: 'warning', detail: `${sentence(failedTitle)} Your changes are still here; check your connection and try again.`,
                       short: 'Check your connection and try again.' })
    case error.status === 400: {
      const fields: Record<string, string> = {}
      const general: string[] = []
      for (const [field, message] of messagesOf(problem.errors)) {
        const shown = field !== 'non_field_errors' && !/^\d+$/.test(field) && (!shownFields || shownFields.includes(field))
        if (shown && !(field in fields)) fields[field] = message
        else if (!shown) general.push(sentence(message))
      }
      // a summary that repeats a message already on a field or in the list says nothing new
      if (said && !general.includes(said) && !Object.values(fields).some((message) => sentence(message) === said)) general.unshift(said)
      if (Object.keys(fields).length > 0) {
        return failure({ ...base, title: FIELDS_TITLE, detail: sentence(failedTitle), fields, general, short: [...Object.values(fields).map(sentence), ...general].join(' ') })
      }
      return failure({ ...base, detail: general.join(' ') || 'Check what you entered and try again.' })
    }
    case error.status === 401:
      return failure({ ...base, detail: 'Your session ended. Sign in again to carry on.' })
    case error.status === 403:
      return failure({ ...base, detail: said && said !== DRF_FORBIDDEN ? said : 'You do not have permission to do this. Ask a workspace administrator.' })
    case error.status === 404:
      return failure({ ...base, detail: said || 'It no longer exists. Reload the page to see what is there now.' })
    case error.status === 409:
      return failure({ ...base, detail: said || 'It changed since you opened it. Reload to see the latest, then try again.' })
    case error.status === 429:
      return failure({ ...base, tone: 'warning', detail: 'Too many requests in a short time. Wait a moment and try again.' })
    case error.status === 503: {
      const why = said || `CEP is not answering at ${clock(problem.at)}.`
      return failure({ ...base, tone: 'warning', detail: `${why} Your entries are still here; try again in a minute.`, short: `${why} Try again in a minute.` })
    }
    case error.status >= 500: {
      const reference = typeof problem.reference === 'string' && problem.reference ? problem.reference : null
      const after = reference ? ` If it happens again, give your administrator the reference ${reference}.` : ' If it happens again, tell your administrator.'
      const when = `CEP had a problem at ${clock(problem.at)}.`
      return failure({ ...base, reference, detail: `${when} Your entries are still here; try again.${after}`, short: `${when} Try again.` })
    }
    default:
      return failure({ ...base, detail: said || 'Try again in a moment.' })
  }
}

/** The failure as one line of text, for places that show a single sentence under their own title. */
export function failureText(error: unknown, failedTitle = ''): string {
  const failure = saveFailure(error, failedTitle)
  const fields = Object.values(failure.fields)
  const lead = failure.title === FIELDS_TITLE ? [...fields, ...failure.general] : [failure.detail, ...failure.general]
  return lead.filter(Boolean).join(' ')
}
