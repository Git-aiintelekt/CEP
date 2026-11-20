/** A schedule being made or changed, pure: its draft from a saved one, the body the API takes, and the sentence that sums it up. */
import type { Schedule, ScheduleBody, ScheduleEvery, ScheduleFormat } from '../types'

export type ScheduleKind = 'report' | 'dashboard'

export interface ScheduleDraft {
  every: ScheduleEvery
  onDay: number
  at: string
  format: ScheduleFormat
  recipients: string[]
  /** an address typed and not yet added */
  typed: string
  subject: string
  note: string
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const FORMAT_WORDS: Record<ScheduleFormat, string> = { xlsx: 'an Excel file', csv: 'a CSV file', pdf: 'a PDF', pptx: 'a PowerPoint' }

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/** a dashboard goes as PDF or PowerPoint */
export const formatFits = (kind: ScheduleKind, format: ScheduleFormat) => kind === 'report' || format === 'pdf' || format === 'pptx'

export function draftOf(existing: Schedule | null, kind: ScheduleKind): ScheduleDraft {
  return {
    every: existing?.every ?? 'week', onDay: existing?.on_day ?? 1, at: existing?.at_time ?? '08:00',
    format: existing?.format ?? (kind === 'dashboard' ? 'pdf' : 'xlsx'), recipients: existing?.recipients ?? [], typed: '',
    subject: existing?.subject ?? '', note: existing?.note ?? '',
  }
}

/** the addresses, with what is typed added: split on commas, spaces and semicolons, lower case, once each */
export function allRecipients(draft: ScheduleDraft): string[] {
  const more = draft.typed.split(/[,\s;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean)
  return Array.from(new Set([...draft.recipients, ...more]))
}

export function scheduleBody(draft: ScheduleDraft, kind: ScheduleKind, itemId: string): ScheduleBody {
  return {
    kind, item_id: itemId, every: draft.every, on_day: draft.every === 'week' || draft.every === 'month' ? draft.onDay : null, at_time: draft.at,
    format: draft.format, recipients: allRecipients(draft), subject: draft.subject.trim() || null, note: draft.note.trim() || null,
  }
}

/** “Every Monday at 08:00, Campaign Overview goes to 3 people as a PDF.” */
export function scheduleSentence(draft: ScheduleDraft, name: string): string {
  const when = draft.every === 'day' ? 'Every day' : draft.every === 'weekday' ? 'Every weekday' : draft.every === 'week' ? `Every ${WEEKDAYS[draft.onDay - 1] ?? 'Monday'}` : `On the ${ordinal(draft.onDay)} of every month`
  const people = allRecipients(draft).length
  const to = people === 0 ? 'nobody yet' : `${people} ${people === 1 ? 'person' : 'people'}`
  return `${when} at ${draft.at}, ${name} goes to ${to} as ${FORMAT_WORDS[draft.format]}.`
}
