/** What the month and week views share about a calendar span: its colour, and what it says to a screen reader. */
import type { CalendarSend, CalendarSpan } from '@/lib/types'

import { whenInZone, zoneShort } from './dripSequence'

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
  return `${span.name}: ${statusLabel(span.display_status)}${span.failed ? ', failed' : ''}${span.ongoing ? ', ongoing' : ''}${span.is_journey_generated ? ', journey run' : ''}${onHold(span) ? ', on hold' : ''}${when}`
}

/** a paused drip: its waiting messages are on no day */
export const onHold = (span: CalendarSpan) => (span.on_hold?.length ?? 0) > 0

/** a drip's send names its message: position, count and name come with it */
export const isDripSend = (send: CalendarSend): send is CalendarSend & { position: number; count: number } => typeof send.position === 'number' && typeof send.count === 'number'

/** "Loyalty Welcome Series · Message 3 of 4" */
export const dripSendTitle = (span: CalendarSpan, send: CalendarSend & { position: number; count: number }) => `${span.name} · Message ${send.position} of ${send.count}`

/** "Message 3 of 4 · First Reward · Mon 19 Oct, 09:00 CT", in the zone the calendar's days are in */
export function dripSendTip(send: CalendarSend & { position: number; count: number }, zone: string): string {
  const when = whenInZone(send.at, zone)
  return [`Message ${send.position} of ${send.count}`, send.name || null, when ? `${when.day}, ${when.time} ${zoneShort(zone)}` : null].filter(Boolean).join(' · ')
}

/** a send's state in words, for the day pop-up and the lists */
export const sendState = (send: CalendarSend): { status: string; label: string } =>
  send.state === 'SENT' ? { status: 'COMPLETED', label: 'Sent' } : send.state === 'SENDING' ? { status: 'SENDING', label: 'Sending' } : { status: 'SCHEDULED', label: 'Scheduled' }

export const dayTitle = (key: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`))
