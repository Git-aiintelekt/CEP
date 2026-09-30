const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const number = new Intl.NumberFormat()

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateOnly.format(date)
}

/** "just now", "5 min ago", "3 h ago", "2 days ago"; a date once it is more than a week old. */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '—'
  const at = new Date(value).getTime()
  if (Number.isNaN(at)) return '—'
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 8) return days === 1 ? 'yesterday' : `${days} days ago`
  return `on ${formatDate(value)}`
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : number.format(value)
}

/**
 * US dollars as "$25,000.00" in every locale: narrowSymbol keeps a British or Indian browser from writing "US$".
 * `whole` drops the cents, for tiles and meters. Money arrives from the API as a string, so both are accepted.
 */
export function formatMoney(value: number | string | null | undefined, { whole = false }: { whole?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  if (Number.isNaN(amount)) return '—'
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', ...(whole ? { maximumFractionDigits: 0 } : {}) })
}

/** PRODUCTION_PUBLISHED -> Production published */
export function humanize(code: string | null | undefined): string {
  if (!code) return '—'
  const text = code.replace(/_/g, ' ').toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'as', 'via', 'per', 'vs', 'from', 'with', 'into', 'onto', 'over', 'upon'])

/** "add list to leave out" -> "Add List to Leave Out": the UI's label casing (small words lowercase unless first or last; both halves of a hyphenated word) */
export function titleCase(text: string): string {
  const words = text.split(' ')
  return words
    .map((word, index) => {
      const small = SMALL_WORDS.has(word.toLowerCase()) && index > 0 && index < words.length - 1
      if (small) return word.toLowerCase()
      return word.split('-').map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part)).join('-')
    })
    .join(' ')
}

/** ONE_TIME -> "One Time": humanize for a label (a tag, a badge, a table cell); humanize stays for words inside a sentence */
export function titleize(code: string | null | undefined): string {
  if (!code) return '—'
  return titleCase(code.replace(/_/g, ' ').toLowerCase())
}

/** ISO timestamp -> value for <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** <input type="datetime-local"> value -> ISO timestamp (UTC), or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** "04:12 UTC": a 24-hour clock in one named zone, so everyone in a workspace reads the same time. */
export function formatUtcClock(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

const MINUS = '−'
const signed = (value: number, digits: number) => `${value > 0 ? '+' : value < 0 ? MINUS : ''}${Math.abs(value).toFixed(digits)}`

/** "$874", "$312.8K", "$1.39M": whole dollars under a thousand, one decimal in thousands, two in millions and up. */
export function formatCompactMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const size = Math.abs(value)
  if (Math.round(size) < 1000) return `${sign}$${Math.round(size)}`
  const thousands = Math.round(size / 100) / 10
  if (thousands < 1000) return `${sign}$${thousands.toFixed(1)}K`
  const millions = Math.round(size / 10_000) / 100
  if (millions < 1000) return `${sign}$${millions.toFixed(2)}M`
  return `${sign}$${(Math.round(size / 10_000_000) / 100).toFixed(2)}B`
}

/** axis ticks: "$0", "$80K", "$1.2M", whole where it can be */
export function formatAxisMoney(value: number): string {
  const size = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (size < 1000) return `${sign}$${Math.round(size)}`
  if (size < 1_000_000) return `${sign}$${Math.round(size / 1000)}K`
  return `${sign}$${(size / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** "38.4%" */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : `${value.toFixed(decimals)}%`
}

/** "+6.2%" / "−12.4%" / "0.0%", with a true minus sign */
export function formatPercentChange(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : `${signed(value, 1)}%`
}

/** "+1.1 pt" / "−0.3 pt": the change in a rate, in percentage points */
export function formatPointChange(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : `${signed(value, 1)} pt`
}

/** "26 Sep" for a YYYY-MM-DD workspace day, never shifted by the browser's zone */
export function formatShortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getUTCDate()} ${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date)}`
}

const safeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone })
    return zone
  } catch {
    return 'UTC'
  }
}

/** "14:00": a 24-hour clock in the given zone */
export function formatClock(value: string | null | undefined, zone: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: safeZone(zone) }).format(date)
}

/** "EDT": the zone's short name on that date (summer and winter differ); an offset such as "GMT+5:30" where there is none */
export function zoneAbbreviation(zone: string, date: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: safeZone(zone), timeZoneName: 'short' }).formatToParts(date).find((item) => item.type === 'timeZoneName')
  return part?.value ?? zone
}

/** "Good morning" 05:00–11:59, "Good afternoon" 12:00–16:59, "Good evening" otherwise, by the workspace's clock */
export function greetingFor(date: Date, zone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: safeZone(zone) }).format(date))
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}
