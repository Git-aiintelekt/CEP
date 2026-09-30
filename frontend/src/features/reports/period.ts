import { formatPercent } from '@/lib/format'

/** The report's period: presets counted in the workspace's time zone, dates as YYYY-MM-DD (what the API takes). */
export type PeriodKey = 'week' | 'month' | 'last_month' | 'custom'

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'week', label: 'Last 7 Days' },
  { value: 'month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'custom', label: 'Custom' },
]

export interface Period {
  from: string
  to: string
}

/** Today in `zone`, as YYYY-MM-DD. en-CA writes dates in that order. */
export function todayIn(zone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

const iso = (date: Date) => date.toISOString().slice(0, 10)
const parse = (day: string) => new Date(`${day}T00:00:00Z`)

export function addDays(day: string, count: number): string {
  const date = parse(day)
  date.setUTCDate(date.getUTCDate() + count)
  return iso(date)
}

export function periodFor(key: Exclude<PeriodKey, 'custom'>, zone: string, now = new Date()): Period {
  const today = todayIn(zone, now)
  if (key === 'week') return { from: addDays(today, -6), to: today }
  const first = `${today.slice(0, 8)}01`
  if (key === 'month') return { from: first, to: today }
  const lastOfPrevious = addDays(first, -1)
  return { from: `${lastOfPrevious.slice(0, 8)}01`, to: lastOfPrevious }
}

/** Every day from `from` to `to`, so a quiet day shows as a zero rather than being skipped. Capped at the API's 366. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to && days.length < 366; day = addDays(day, 1)) days.push(day)
  return days
}

/** "1 Sep 2026" for a YYYY-MM-DD: the date is the workspace's, so it is formatted as UTC, never shifted by the browser's zone. */
export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(parse(day))
}

export const percent = (value: number | null | undefined) => formatPercent(value)
