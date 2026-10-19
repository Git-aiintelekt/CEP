/** The workspace's fiscal year (Settings → Fiscal Year): how a fiscal quarter or year is named, and where one starts. */
import type { FiscalYear } from '../types'

export const FISCAL_OPERATORS = ['this_fiscal_year', 'last_fiscal_year', 'this_fiscal_quarter', 'last_fiscal_quarter']
export const CALENDAR: FiscalYear = { start: 1, named_by: 'end' }
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** the first day of the fiscal year a date is in, as a UTC date */
export function fiscalYearStart(date: Date, start: number): Date {
  const month = date.getUTCMonth() + 1
  return new Date(Date.UTC(month >= start ? date.getUTCFullYear() : date.getUTCFullYear() - 1, start - 1, 1))
}

export function fiscalQuarterStart(date: Date, start: number): Date {
  const first = fiscalYearStart(date, start)
  const months = (date.getUTCMonth() + 1 - start + 12) % 12
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + months - (months % 3), 1))
}

/** "FY2027" for a fiscal year from April 2026, "FY2027 Q1" for its first quarter; named by the year it starts in when the workspace says so */
export function fiscalName(value: string, bucket: 'fiscal_quarter' | 'fiscal_year', fiscal: FiscalYear = CALENDAR): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  const first = fiscalYearStart(date, fiscal.start)
  const year = first.getUTCFullYear() + (fiscal.named_by === 'end' && fiscal.start !== 1 ? 1 : 0)
  if (bucket === 'fiscal_year') return `FY${year}`
  return `FY${year} Q${Math.floor(((date.getUTCMonth() + 1 - fiscal.start + 12) % 12) / 3) + 1}`
}

/** "FY2027 runs from April 2026 to March 2027; today is in FY2027 Q3." */
export function fiscalExample(fiscal: FiscalYear, today = new Date()): string {
  const now = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  const first = fiscalYearStart(now, fiscal.start)
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 11, 1))
  const iso = now.toISOString().slice(0, 10)
  return `${fiscalName(iso, 'fiscal_year', fiscal)} runs from ${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()} to ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}; today is in ${fiscalName(iso, 'fiscal_quarter', fiscal)}.`
}
