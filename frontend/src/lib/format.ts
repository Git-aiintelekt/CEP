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
