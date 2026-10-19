/** A KPI card's or a gauge's figure: the first value over the whole run, from the engine's grand total when it gave one. */
import { exact, split } from '../components/shape'
import type { RunResult } from '../types'

/** the first value over the whole run, the measure, and its trend along a date when the report has one */
export function figureOf(result: RunResult) {
  const { dims, meas } = split(result)
  const measure = meas[0]
  if (!measure) return null
  const m = 0
  const whole = exact(result, {}, m) ?? (result.rows.length === 1 && dims.length === 0 ? Number(result.rows[0][measure.index]) : null)
  const date = dims.find(({ column }) => column.type === 'date' || column.type === 'datetime')
  const trend = date && dims.length === 1 ? result.rows.map((row) => Number(row[measure.index])).filter(Number.isFinite) : null
  const summed = whole ?? (measure.column.aggregate === 'sum' || measure.column.aggregate === 'count' ? result.rows.reduce((sum, row) => sum + (Number(row[measure.index]) || 0), 0) : null)
  return { measure: measure.column, value: summed, trend }
}
