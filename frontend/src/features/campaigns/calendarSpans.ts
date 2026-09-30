/** What the month and week views share about a calendar span: its colour, and what it says to a screen reader. */
import type { CalendarSpan } from '@/lib/types'

const LABEL: Record<string, string> = {
  DRAFT: 'Draft', TEST_PUBLISHED: 'Test Published', PRODUCTION_PUBLISHED: 'Production Published', SCHEDULED: 'Scheduled', ACTIVE: 'Active', PAUSED: 'Paused', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}
export const statusLabel = (status: string) => LABEL[status] ?? status

/** each bar is in its status tag colour; a failed run shows as Failed whatever its status */
export const barStatus = (span: CalendarSpan) => (span.failed ? 'FAILED' : span.display_status)

export const LEGEND = [
  ['DRAFT', 'Draft with a Planned Date'], ['TEST_PUBLISHED', 'Test Published'], ['PRODUCTION_PUBLISHED', 'Production Published'], ['SCHEDULED', 'Scheduled'],
  ['ACTIVE', 'Active or Sending'], ['PAUSED', 'Paused'], ['COMPLETED', 'Completed'], ['FAILED', 'Failed or Cancelled'],
] as const

export function describe(span: CalendarSpan, zone: string): string {
  const next = span.sends.find((send) => send.state === 'WAITING' || send.state === 'PROJECTED' || send.state === 'PLANNED')
  const when = next ? `, next send ${new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(next.at))}` : ''
  return `${span.name}: ${statusLabel(span.display_status)}${span.failed ? ', failed' : ''}${span.ongoing ? ', ongoing' : ''}${span.is_journey_generated ? ', journey run' : ''}${when}`
}

export const dayTitle = (key: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`))
