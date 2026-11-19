/** The Delivery Warm-Up's wording and arithmetic, shared by the page, its dialogs and the tests. */
import type { WarmUp, WarmUpDay, WarmUpPlanDay, WarmUpStatus } from '@/lib/types'

export const WARM_UP_KEY = ['warmup']

const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

/** "5 Nov" for a local date ("2026-11-05"), read as that day wherever the browser is */
export function dayLabel(iso: string | null): string {
  if (!iso) return '—'
  const [year, month, day] = iso.split('-').map(Number)
  return year && month && day ? dayMonth.format(new Date(year, month - 1, day)) : '—'
}

/** the status tag: Warming is live (the dot), Warm is finished */
export const STATUS_TAG: Record<WarmUpStatus, { status: string; label: string }> = {
  WARMING: { status: 'ACTIVE', label: 'Warming' },
  PAUSED: { status: 'PAUSED', label: 'Paused' },
  WARM: { status: 'COMPLETED', label: 'Warm' },
  STOPPED: { status: 'CANCELLED', label: 'Stopped' },
}

export const isOpen = (warmUp: WarmUp | null | undefined) => Boolean(warmUp && (warmUp.status === 'WARMING' || warmUp.status === 'PAUSED'))

export const ipModeLabel = (mode: string) => (mode === 'SHARED' ? 'Shared IP Pool' : 'Dedicated IP')
export const planLabel = (kind: string) => (kind === 'HOURLY' ? 'Hourly Plan' : 'Daily Plan')

/** "08:00 to 21:00" for a daily plan, "round the clock" for an hourly one */
export function windowWords(warmUp: Pick<WarmUp, 'plan_kind' | 'window_start' | 'window_end'>): string {
  return warmUp.plan_kind === 'HOURLY' ? 'round the clock' : `from ${warmUp.window_start} to ${warmUp.window_end}`
}

/** a plan in one line: "15 days, 260 a day to 25,000" */
export function planLine(days: WarmUpPlanDay[], format: (value: number) => string): string {
  if (!days.length) return ''
  return `${days.length} days, ${format(days[0].daily)} a day to ${format(days[days.length - 1].daily)}`
}

/** a day can be changed while the warm-up is open, from today on */
export const changeable = (warmUp: WarmUp, day: WarmUpDay) => isOpen(warmUp) && day.day >= warmUp.current_day

export function rate(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null
}
