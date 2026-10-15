/** The calendar's own address state: ?mode=week&start=2026-10-05&journeys=0, each left out at its default (month, today, on). */
import type { CalendarSpan } from '@/lib/types'

export type CalendarMode = 'month' | 'week'

export interface CalendarView {
  mode: CalendarMode
  /** the week's first day (week mode) */
  start: string
  /** journey runs shown */
  journeys: boolean
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const isDay = (value: string | null): value is string => Boolean(value && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))

export function calendarViewOf(params: URLSearchParams, today: string): CalendarView {
  const start = params.get('start')
  return { mode: params.get('mode') === 'week' ? 'week' : 'month', start: isDay(start) ? start : today, journeys: params.get('journeys') !== '0' }
}

export function withCalendarView(current: URLSearchParams, patch: Partial<CalendarView>, today: string): URLSearchParams {
  const next = new URLSearchParams(current)
  const view = { ...calendarViewOf(current, today), ...patch }
  if (view.mode === 'week') next.set('mode', 'week'); else next.delete('mode')
  if (view.mode === 'week' && view.start !== today) next.set('start', view.start); else next.delete('start')
  if (view.journeys) next.delete('journeys'); else next.set('journeys', '0')
  return next
}

/** journey runs come as journey-generated campaigns: the switch keeps them or drops them */
export const withJourneys = (spans: CalendarSpan[], journeys: boolean) => (journeys ? spans : spans.filter((span) => !span.is_journey_generated))

const shortDate = (day: string, withYear: boolean) =>
  `${Number(day.slice(8))} ${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))}${withYear ? ` ${day.slice(0, 4)}` : ''}`

/** "30 Sep – 6 Oct 2026", or "29 Dec 2026 – 4 Jan 2027" across a new year */
export function weekTitle(start: string, end: string): string {
  const crosses = start.slice(0, 4) !== end.slice(0, 4)
  return `${shortDate(start, crosses)} – ${shortDate(end, true)}`
}
