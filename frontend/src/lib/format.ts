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

/** PRODUCTION_PUBLISHED -> Production published */
export function humanize(code: string | null | undefined): string {
  if (!code) return '—'
  const text = code.replace(/_/g, ' ').toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
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
