/**
 * Highlights, written by rules from a report's rows (docs/mockups/report-page.html): how the main measure moved between
 * the first and last date, the top value and the runner-up (with its share of the total when it is a large one), and the
 * lowest. Only from a whole result (no part of the rows) and only for a sum or a count, so every figure is true.
 */
import type { ResultColumn, RunResult } from '../types'
import { formatCell } from './resultWords'

export interface Highlight {
  /** the part in bold */
  lead: string
  rest: string
  tone: 'up' | 'down' | 'plain'
}

const MAX = 4
/** a share this large earns its words */
const BIG_SHARE = 0.3

const dated = (column: ResultColumn) => column.type === 'date' || column.type === 'datetime'
const percent = (share: number) => `${Math.round(share * 100)}%`

function totalsBy(result: RunResult, at: number, measure: number): { value: unknown; total: number }[] {
  const groups = new Map<string, { value: unknown; total: number }>()
  for (const row of result.rows) {
    const key = String(row[at] ?? '')
    const group = groups.get(key) ?? { value: row[at], total: 0 }
    group.total += typeof row[measure] === 'number' ? (row[measure] as number) : 0
    groups.set(key, group)
  }
  return [...groups.values()]
}

export function highlights(result: RunResult): Highlight[] {
  const whole = !result.truncated && result.offset === 0 && result.rows.length === result.row_count
  const measure = result.columns.findIndex((column) => (column.aggregate === 'sum' || column.aggregate === 'count') && !column.compare)
  if (!whole || measure < 0 || result.rows.length < 2) return []
  const m = result.columns[measure]
  const money = (value: number) => formatCell(m, value)
  const dims = result.columns.map((column, index) => ({ column, index })).filter(({ column }) => !column.aggregate)
  const time = dims.find(({ column }) => dated(column) && column.bucket)
  const group = dims.find(({ column }) => !dated(column)) ?? time
  const name = (column: ResultColumn, value: unknown) => {
    const words = formatCell(column, value)
    return value === null || value === undefined || value === '' || words === '—' ? `Rows with no ${column.label}` : words
  }
  const out: Highlight[] = []

  if (time) {
    const points = totalsBy(result, time.index, measure).filter((point) => point.value !== null && point.value !== undefined)
      .sort((a, b) => String(a.value).localeCompare(String(b.value)))
    const first = points[0]
    const last = points.at(-1)
    if (first && last && points.length > 1 && first.total !== 0) {
      const change = (last.total - first.total) / Math.abs(first.total)
      if (Math.abs(change) >= 0.01) {
        out.push({ lead: `${m.label} ${change > 0 ? 'rose' : 'fell'} ${percent(Math.abs(change))} from ${formatCell(time.column, first.value)} to ${formatCell(time.column, last.value)}`,
          rest: `, from ${money(first.total)} to ${money(last.total)}.`, tone: change > 0 ? 'up' : 'down' })
      }
    }
  }

  if (group) {
    const ranked = totalsBy(result, group.index, measure).sort((a, b) => b.total - a.total)
    const sum = ranked.reduce((total, item) => total + item.total, 0)
    const [top, second] = ranked
    if (top && second && top.total > 0) {
      const share = sum > 0 ? top.total / sum : 0
      out.push({ lead: `${name(group.column, top.value)} is top for ${m.label}`,
        rest: ` at ${money(top.total)}${share >= BIG_SHARE && ranked.length > 2 ? ` (${percent(share)} of the total)` : ''}, then ${name(group.column, second.value)} at ${money(second.total)}.`, tone: 'plain' })
    }
    const lowest = ranked.filter((item) => item.total > 0).at(-1)
    if (lowest && ranked.length > 2 && lowest !== top && lowest !== second) {
      out.push({ lead: `${name(group.column, lowest.value)} has the least ${m.label}`, rest: ` at ${money(lowest.total)}.`, tone: 'plain' })
    }
    const named = ranked.filter((item) => item.value !== null && item.value !== undefined && item.value !== '')
    if (named.length > 2) {
      const unnamed = sum - named.reduce((total, item) => total + item.total, 0)
      out.push({ lead: `${named.length} ${group.column.label} values`, rest: ` share ${money(sum - unnamed)}${unnamed ? `, with ${money(unnamed)} on rows with none` : ''}.`, tone: 'plain' })
    }
  }
  return out.slice(0, MAX)
}
