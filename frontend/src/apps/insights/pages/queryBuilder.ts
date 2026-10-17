/** The visual builder's model and the SQL it writes (Query a Database). Identifiers are quoted by the engine's dialect; the server checks the whole. */
import type { Aggregate } from '../types'

export const CALC: Record<'' | Aggregate, string> = { '': '—', sum: 'SUM', count: 'COUNT', count_distinct: 'COUNT DISTINCT', avg: 'AVG', min: 'MIN', max: 'MAX' }
export const OPS = ['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'IS NULL', 'IS NOT NULL'] as const
export type Op = (typeof OPS)[number]
export type VisualJoin = { table: string; alias: string; type: 'JOIN' | 'LEFT JOIN'; left: string; right: string }
export type VisualColumn = { expr: string; calc: '' | Aggregate; alias: string }
export type VisualWhere = { expr: string; op: Op; value: string }
export type Visual = { base: string; joins: VisualJoin[]; columns: VisualColumn[]; where: VisualWhere[]; order: { expr: string; dir: 'ASC' | 'DESC' }[] }
export const EMPTY_VISUAL: Visual = { base: '', joins: [], columns: [], where: [], order: [] }

/** the SQL the visual builder writes: identifiers quoted by the engine's dialect, values as literals (the server checks the whole) */
export function visualSql(v: Visual, quote: (name: string) => string): string {
  if (!v.base) return ''
  const q = (ref: string) => ref.split('.').map(quote).join('.')
  const alias = (i: number) => (i === 0 ? 'b' : `j${i}`)
  const col = (c: VisualColumn) => {
    const inner = c.expr === '*' ? '*' : q(c.expr)
    const expr = c.calc === 'count_distinct' ? `COUNT(DISTINCT ${inner})` : c.calc ? `${CALC[c.calc]}(${inner})` : inner
    return c.alias ? `${expr} AS ${quote(c.alias)}` : expr
  }
  const lines = [`SELECT ${v.columns.length ? v.columns.map(col).join(',\n       ') : '*'}`, `FROM ${quote(v.base)} ${alias(0)}`]
  v.joins.forEach((j, i) => lines.push(`${j.type} ${quote(j.table)} ${alias(i + 1)} ON ${q(j.left)} = ${q(j.right)}`))
  const where = v.where.filter((w) => w.expr).map((w) => (w.op === 'IS NULL' || w.op === 'IS NOT NULL' ? `${q(w.expr)} ${w.op}` : `${q(w.expr)} ${w.op} ${literal(w.value)}`))
  if (where.length) lines.push(`WHERE ${where.join('\n  AND ')}`)
  const groups = v.columns.filter((c) => !c.calc && c.expr && c.expr !== '*')
  if (v.columns.some((c) => c.calc) && groups.length) lines.push(`GROUP BY ${groups.map((c) => q(c.expr)).join(', ')}`)
  if (v.order.length) lines.push(`ORDER BY ${v.order.map((o) => `${o.expr.includes('.') ? q(o.expr) : quote(o.expr)} ${o.dir}`).join(', ')}`)
  return lines.join('\n')
}

function literal(value: string): string {
  const trimmed = value.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  if (/^(true|false|null)$/i.test(trimmed)) return trimmed.toUpperCase()
  return `'${trimmed.replace(/'/g, "''")}'`
}
