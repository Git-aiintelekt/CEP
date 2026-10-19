/**
 * How a run's grouped rows become the other three views, in the browser: the chart (categories and series), the
 * hierarchy (groups that fold, with subtotals) and the pivot (one dimension spread across the columns, with totals).
 * Subtotals are the engine's when the run carries them (exact, whatever the aggregate, whatever was truncated); else they
 * come from the rows shown: sums and counts add up, minimums and maximums compare, averages and distinct counts cannot
 * be combined and read as an em dash.
 */
import type { Aggregate, ResultColumn, RunResult } from '../types'
import { formatCell } from './resultWords'

export type ViewType = 'grid' | 'chart' | 'hierarchy' | 'pivot'

export function isDimension(column: ResultColumn): boolean {
  return !column.aggregate
}

/** the measure columns, the dimension columns, and among the dimensions the one spread across (when it is one) */
export function split(result: RunResult, across?: string) {
  const dims = result.columns.map((column, index) => ({ column, index })).filter(({ column }) => isDimension(column))
  const meas = result.columns.map((column, index) => ({ column, index })).filter(({ column }) => !isDimension(column))
  const spread = dims.find(({ column }) => column.key === across) ?? null
  const down = spread ? dims.filter(({ column }) => column.key !== across) : dims
  return { dims, meas, spread, down }
}

const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

/** the engine's total for these dimension keys, when it computed one */
export function exact(result: RunResult, keys: Record<string, unknown>, measureIndex: number): number | null {
  const names = Object.keys(keys)
  const entry = result.totals?.find((item) => Object.keys(item.keys).length === names.length && names.every((name) => name in item.keys && same(item.keys[name], keys[name])))
  const value = entry?.values[measureIndex]
  return typeof value === 'number' ? value : value === null || value === undefined ? null : Number(value)
}

/** the aggregate a subtotal combines by; a time comparison (a running total, a change, a share) is never combined */
const agg = (column: ResultColumn): Aggregate | undefined => (column.compare ? undefined : column.aggregate)

export function combine(aggregate: Aggregate | undefined, values: unknown[]): number | null {
  const numbers = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (numbers.length === 0) return null
  switch (aggregate) {
    case 'sum': case 'count': return numbers.reduce((a, b) => a + b, 0)
    case 'min': return Math.min(...numbers)
    case 'max': return Math.max(...numbers)
    default: return null                                   // avg, count_distinct: not combinable from the rows
  }
}

export function cellText(column: ResultColumn, value: unknown): string {
  return formatCell(column, value)
}

/** every distinct value of a column, in the order the rows gave them */
export function distinct(result: RunResult, index: number): unknown[] {
  const seen = new Map<string, unknown>()
  for (const row of result.rows) {
    const key = String(row[index] ?? '')
    if (!seen.has(key)) seen.set(key, row[index])
  }
  return [...seen.values()]
}

// ---------------------------------------------------------------------------------------------------- chart

export interface ChartShape {
  categoryHeader: string
  /** value: as the run gave it, for a filter on the dimension */
  categories: { key: string; label: string; value: unknown }[]
  series: { key: string; label: string; values: number[] }[]
  measure: ResultColumn
  /** the dimension along the bottom */
  axis: ResultColumn
  /** why the chart cannot be drawn from these columns, when it cannot */
  reason?: string
}

/** x: the first dimension down; series: one per value of the dimension across, else one per measure */
export function chartShape(result: RunResult, across?: string): ChartShape {
  const { meas, spread, down } = split(result, across)
  const measure = meas[0]
  const empty = { categoryHeader: '', categories: [], series: [], measure: measure?.column ?? result.columns[0], axis: down[0]?.column ?? result.columns[0] }
  if (!measure) return { ...empty, reason: 'A chart needs a value: add a number to total, such as Sent Count.' }
  if (down.length === 0) return { ...empty, reason: spread ? 'A chart needs a row field under the series: add a second dimension, such as Sent by Month.' : 'A chart needs a dimension along the bottom: add one, such as Sent by Month or Channel.' }
  const axis = down[0]
  const categoryValues = distinct(result, axis.index)
  const categories = categoryValues.map((value) => ({ key: String(value ?? ''), label: cellText(axis.column, value), value }))
  const at = new Map(categoryValues.map((value, i) => [String(value ?? ''), i]))
  const series: ChartShape['series'] = []
  if (spread) {
    for (const value of distinct(result, spread.index)) {
      const values = new Array<number>(categories.length).fill(0)
      for (const row of result.rows) {
        if (String(row[spread.index] ?? '') !== String(value ?? '')) continue
        const index = at.get(String(row[axis.index] ?? '')) as number
        values[index] += Number(row[measure.index] ?? 0) || 0
      }
      series.push({ key: String(value ?? ''), label: cellText(spread.column, value), values })
    }
  } else {
    for (const item of meas.slice(0, 6)) {
      const values = new Array<number>(categories.length).fill(0)
      for (const row of result.rows) values[at.get(String(row[axis.index] ?? '')) as number] += Number(row[item.index] ?? 0) || 0
      series.push({ key: item.column.key, label: item.column.label, values })
    }
  }
  return { categoryHeader: axis.column.label, categories, series, measure: measure.column, axis: axis.column }
}

// ---------------------------------------------------------------------------------------------------- hierarchy

export interface HierarchyNode {
  key: string
  label: string
  depth: number
  /** the measures, combined from the rows beneath */
  totals: (number | null)[]
  children: HierarchyNode[]
  /** a leaf: the row's own measures, as the run gave them */
  row?: unknown[]
  rows: number
  /** the value as the run gave it, for a drill */
  value: unknown
}

export interface HierarchyShape {
  levels: ResultColumn[]
  measures: ResultColumn[]
  roots: HierarchyNode[]
  grand: (number | null)[]
  reason?: string
}

/** the dimensions in their order as levels, each group folding over the next, every measure totalled per group */
export function hierarchyShape(result: RunResult): HierarchyShape {
  const { dims, meas } = split(result)
  const empty = { levels: dims.map((d) => d.column), measures: meas.map((m) => m.column), roots: [], grand: [] }
  if (dims.length < 2) return { ...empty, reason: 'A hierarchy needs two or more dimensions, such as Channel, then Campaign.' }
  if (meas.length === 0) return { ...empty, reason: 'A hierarchy needs a value to total per group: add a number, such as Sent Count.' }
  const roots: HierarchyNode[] = []
  const paths = new Map<HierarchyNode, Record<string, unknown>>()
  for (const row of result.rows) {
    let siblings = roots
    let node: HierarchyNode | undefined
    dims.forEach(({ column, index }, depth) => {
      const key = String(row[index] ?? '')
      node = siblings.find((n) => n.key === key)
      if (!node) {
        node = { key, label: cellText(column, row[index]), depth, totals: [], children: [], rows: 0, value: row[index] }
        siblings.push(node)
        paths.set(node, Object.fromEntries(dims.slice(0, depth + 1).map((d) => [d.column.key, row[d.index]])))
      }
      node.rows += 1
      siblings = node.children
    })
    if (node) node.row = meas.map(({ index }) => row[index])
  }
  const total = (nodes: HierarchyNode[]): void => {
    for (const node of nodes) {
      if (node.children.length) {
        total(node.children)
        node.totals = meas.map(({ column }, m) => exact(result, paths.get(node) ?? {}, m) ?? combine(agg(column), node.children.map((child) => (child.row ? child.row[m] : child.totals[m]))))
      } else {
        node.totals = meas.map((_, m) => (typeof node.row?.[m] === 'number' ? (node.row[m] as number) : null))
      }
    }
  }
  total(roots)
  const grand = meas.map(({ column }, m) => exact(result, {}, m) ?? combine(agg(column), roots.map((node) => node.totals[m])))
  return { levels: dims.map((d) => d.column), measures: meas.map((m) => m.column), roots, grand }
}

// ---------------------------------------------------------------------------------------------------- pivot

export interface PivotShape {
  rowHeader: string
  columns: { key: string; label: string }[]
  /** value: the first row dimension's, as the run gave it, for a drill */
  rows: { key: string; label: string; cells: (number | null)[]; total: number | null; value?: unknown }[]
  /** the first dimension down the rows */
  rowColumn?: ResultColumn
  columnTotals: (number | null)[]
  grand: number | null
  measure: ResultColumn
  reason?: string
}

/** the dimension across becomes the columns, the others the rows, one measure in the cells, totals on both edges */
export function pivotShape(result: RunResult, across: string | undefined, measureKey?: string): PivotShape {
  const { meas, spread, down } = split(result, across)
  const measure = meas.find(({ column }) => column.key === measureKey) ?? meas[0]
  const empty = { rowHeader: '', columns: [], rows: [], columnTotals: [], grand: null, measure: measure?.column ?? result.columns[0] }
  if (!measure) return { ...empty, reason: 'A pivot needs a value for its cells: add a number to total, such as Sent Count.' }
  if (!spread) return { ...empty, reason: 'A pivot needs a dimension to spread across the columns: put one in Columns, such as Sent by Month.' }
  if (down.length === 0) return { ...empty, reason: 'A pivot needs a dimension down the rows as well, such as Channel.' }
  const columnValues = distinct(result, spread.index)
  const columns = columnValues.map((value) => ({ key: String(value ?? ''), label: cellText(spread.column, value) }))
  const at = new Map(columnValues.map((value, i) => [String(value ?? ''), i]))
  const rows = new Map<string, { key: string; label: string; cells: (number | null)[]; total: number | null; keys: Record<string, unknown>; value: unknown }>()
  for (const row of result.rows) {
    const key = down.map(({ index }) => String(row[index] ?? '')).join('\u001f')
    let line = rows.get(key)
    if (!line) {
      line = { key, label: down.map(({ column, index }) => cellText(column, row[index])).join(' · '), cells: new Array(columns.length).fill(null), total: null,
               keys: Object.fromEntries(down.map(({ column, index }) => [column.key, row[index]])), value: row[down[0].index] }
      rows.set(key, line)
    }
    const value = row[measure.index]
    const column = at.get(String(row[spread.index] ?? '')) as number
    line.cells[column] = combine(agg(measure.column), [line.cells[column], value])
  }
  const m = meas.findIndex((item) => item.index === measure.index)
  const lines = [...rows.values()].map(({ keys, ...line }) => ({ ...line, total: exact(result, keys, m) ?? combine(agg(measure.column), line.cells) }))
  const columnTotals = columns.map((_, c) => exact(result, { [spread.column.key]: columnValues[c] }, m) ?? combine(agg(measure.column), lines.map((line) => line.cells[c])))
  return { rowHeader: down.map(({ column }) => column.label).join(' · '), columns, rows: lines, columnTotals, grand: exact(result, {}, m) ?? combine(agg(measure.column), columnTotals), measure: measure.column, rowColumn: down[0].column }
}
