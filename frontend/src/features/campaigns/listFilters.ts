/** The Campaigns list filters, and the Date created presets as the date_from / date_to the API filters on (in the workspace time zone). */
import { CAMPAIGN_TYPES, CHANNELS, STATUS_FILTERS } from './vocabulary'

export type CreatedRange = '' | 'last7' | 'last30' | 'quarter' | 'custom'

export const EMPTY_FILTERS = { status: '', type: '', channel: '', triggered_by: '', tag: '', owner: '', created: '' as CreatedRange, date_from: '', date_to: '' }
export type Filters = typeof EMPTY_FILTERS

/** The saved views above the filters: one click, remembered in the address (?saved=). Each is a query the API understands. */
export type SavedView = '' | 'mine' | 'sending_today' | 'attention' | 'approval' | 'drafts'
export const SAVED_VIEWS: { key: SavedView; label: string; query: Record<string, string>; needs?: 'campaign.approve' }[] = [
  { key: '', label: 'All', query: {} },
  { key: 'mine', label: 'Mine', query: { view: 'mine' } },
  { key: 'sending_today', label: 'Sending Today', query: { view: 'sending_today' } },
  { key: 'attention', label: 'Needs Attention', query: { view: 'attention' } },
  { key: 'approval', label: 'Awaiting Approval', query: { approval: 'requested' } },
  { key: 'drafts', label: 'Drafts', query: { status: 'DRAFT,TEST_PUBLISHED' } },
]
export const savedViewOf = (value: string | null): SavedView => (SAVED_VIEWS.some((item) => item.key === value) ? (value as SavedView) : '')

/** Status (one or several), Type and Channel live in the address (?status=DRAFT,TEST_PUBLISHED&type=DRIP&channel=SMS); anything unknown is dropped. */
export type UrlFilters = Pick<Filters, 'status' | 'type' | 'channel'>
export const URL_FILTER_KEYS = ['status', 'type', 'channel'] as const

export function filtersFromParams(params: URLSearchParams): UrlFilters {
  const known = (value: string | null, options: readonly { value: string }[]) => (options.some((option) => option.value === value) ? (value as string) : '')
  const statuses = (params.get('status') ?? '').toUpperCase().split(',')
  return {
    status: STATUS_FILTERS.map((option) => option.value).filter((value) => statuses.includes(value)).join(','),
    type: known(params.get('type')?.toUpperCase() ?? null, CAMPAIGN_TYPES),
    channel: known(params.get('channel')?.toUpperCase() ?? null, CHANNELS),
  }
}

export function withFilterParams(current: URLSearchParams, patch: Partial<UrlFilters>): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of URL_FILTER_KEYS) {
    if (!(key in patch)) continue
    if (patch[key]) next.set(key, patch[key]!); else next.delete(key)
  }
  return next
}

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
