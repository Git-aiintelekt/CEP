/** The Campaigns list filters, and the Date created presets as the date_from / date_to the API filters on (in the workspace time zone). */

export type CreatedRange = '' | 'last7' | 'last30' | 'quarter' | 'custom'

export const EMPTY_FILTERS = { status: '', type: '', channel: '', triggered_by: '', tag: '', owner: '', created: '' as CreatedRange, date_from: '', date_to: '' }
export type Filters = typeof EMPTY_FILTERS

export const CREATED_RANGES: { value: Exclude<CreatedRange, 'custom'>; label: string }[] = [
  { value: '', label: 'Any Time' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'quarter', label: 'This Quarter' },
]

/** '2026-09-24': the calendar date it is now in `zone` */
export function todayIn(zone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

function daysBefore(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date - days)).toISOString().slice(0, 10)
}

/** "Last 7 days" is the seven calendar days ending today, today included */
export function rangeDates(range: Exclude<CreatedRange, 'custom'>, zone: string, now = new Date()): { date_from: string; date_to: string } {
  if (range === '') return { date_from: '', date_to: '' }
  const today = todayIn(zone, now)
  if (range === 'last7') return { date_from: daysBefore(today, 6), date_to: today }
  if (range === 'last30') return { date_from: daysBefore(today, 29), date_to: today }
  const [year, month] = today.split('-').map(Number)
  const firstMonth = Math.floor((month - 1) / 3) * 3 + 1
  return { date_from: `${year}-${String(firstMonth).padStart(2, '0')}-01`, date_to: today }
}
