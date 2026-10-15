/** How a result reads: a cell by its column's format, and the run in one line. */
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format'
import type { ResultColumn, RunResult } from '../types'

const monthYear = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })

/** a bucketed date reads as its bucket: Sep 2026, Q3 2026, 2026; a day or a week as the day it starts */
function bucketWords(bucket: ResultColumn['bucket'], value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  switch (bucket) {
    case 'month': return monthYear.format(date)
    case 'quarter': return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`
    case 'year': return String(date.getUTCFullYear())
    default: return formatDate(value)
  }
}

export function formatCell(column: ResultColumn, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (column.masked) return String(value)
  if (column.bucket) return bucketWords(column.bucket, String(value))
  switch (column.format) {
    case 'integer': return formatNumber(Number(value))
    case 'decimal': return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
    case 'money': return formatMoney(value as number)
    case 'percent': return `${Number(value).toFixed(1)}%`
    case 'date': return formatDate(String(value))
    case 'datetime': return column.type === 'date' || column.bucket ? formatDate(String(value)) : formatDateTime(String(value))
    default: return column.type === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  }
}

/** which columns are masked for this reader, in one sentence; empty when none is */
export function maskedWords(info: RunResult): string {
  const names = info.columns.filter((column) => column.masked).map((column) => column.label)
  if (names.length === 0) return ''
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${list} ${names.length === 1 ? 'is' : 'are'} masked: personal data needs the report administration right.`
}

/** what the run says, in one line: rows, time, freshness, cache */
export function runWords(info: RunResult): string {
  const rows = `${formatNumber(info.row_count)} row${info.row_count === 1 ? '' : 's'}${info.truncated ? ` of more, the first ${formatNumber(info.limit)} shown` : ''}`
  const fresh = info.freshness === 'LIVE' ? 'live data' : `data as of the last ${info.freshness.toLowerCase().replace('_', ' ')}`
  return `${rows} · ${info.duration_ms} ms · ${fresh}${info.cached ? ' · from the last minute' : ''}`
}
