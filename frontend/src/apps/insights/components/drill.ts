/** Drill-down in words and steps: what a breadcrumb says for a value clicked, and the step a click adds. */
import type { DrillInfo, DrillStep, FiscalYear, ResultColumn } from '../types'
import { formatCell } from './resultWords'

/** "2026", "Q3 2026", "Sep 2026", "FY2027 Q1", "EMAIL", "Empty" */
export function stepWords(step: DrillStep, fiscal?: FiscalYear): string {
  if (step.value === null || step.value === undefined || step.value === '') return 'Empty'
  if (step.bucket) return formatCell({ key: step.field, label: '', type: 'date', format: 'date', bucket: step.bucket, fiscal }, step.value)
  if (step.value === true) return 'Yes'
  if (step.value === false) return 'No'
  return String(step.value)
}

/** whether a click on this column can drill: the result is at a level with one below it, and the column is that level */
export function canDrill(info: DrillInfo | undefined, column?: ResultColumn): boolean {
  if (!info || info.depth >= info.levels.length - 1) return false
  return !column || column.key === info.levels[info.depth].field
}

/** the address of a detail report opened through a value of another report */
export function throughPath(reportId: string, field: string, value: unknown, from: string): string {
  return `/insights/reports/${reportId}?through=${encodeURIComponent(JSON.stringify([{ field, value }]))}&from=${encodeURIComponent(from)}`
}

/** a value a right-click can open a detail report through: a text, yes/no or number dimension, not a date */
export function throughable(column: { bucket?: string; type: string; aggregate?: string; masked?: boolean }): boolean {
  return !column.aggregate && !column.bucket && !column.masked && column.type !== 'date' && column.type !== 'datetime'
}

/** the path one level further down, through the value clicked */
export function deeper(info: DrillInfo, value: unknown): DrillStep[] {
  const level = info.levels[info.depth]
  return [...info.path, { field: level.field, ...(level.bucket ? { bucket: level.bucket } : {}), value: value as DrillStep['value'] }]
}
