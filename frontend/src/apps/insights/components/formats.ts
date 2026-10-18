/**
 * Conditional formatting, in the browser: a column's colour scale (light to strong Blue across its values), data bars (a
 * bar behind the number, as long as its share of the largest), or rules (the first that matches gives the cell a status
 * tone). Colours are the design tokens: Blue 600 mixed down for the scale and the bars, the success, warning and danger
 * pairs for rules. Totals and subtotals are never formatted.
 */
import type { CSSProperties } from 'react'

import type { ColumnFormat, FormatRule, FormatTone } from '../types'

export const TONE_CLASS: Record<FormatTone, string> = {
  good: 'bg-success-bg text-success-text',
  warning: 'bg-warning-bg text-warning-text',
  bad: 'bg-danger-bg text-danger-text',
}

export interface Range { min: number; max: number; peak: number }

const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function formatOf(formats: ColumnFormat[] | undefined, key: string): ColumnFormat | undefined {
  return formats?.find((format) => format.column === key)
}

/** the values' lowest, highest and largest size, for the scale and the bars */
export function rangeOf(values: unknown[]): Range | null {
  const numbers = values.map(numeric).filter((n): n is number => n !== null)
  if (numbers.length === 0) return null
  return { min: Math.min(...numbers), max: Math.max(...numbers), peak: Math.max(...numbers.map(Math.abs)) }
}

function matches(rule: FormatRule, value: number): boolean {
  switch (rule.op) {
    case '>': return value > rule.value
    case '>=': return value >= rule.value
    case '<': return value < rule.value
    case '<=': return value <= rule.value
    default: return value === rule.value
  }
}

/** the tone of the first rule a value meets, or none */
export function toneOf(format: ColumnFormat | undefined, value: unknown): FormatTone | null {
  const n = numeric(value)
  if (!format || format.style !== 'rules' || n === null) return null
  return format.rules?.find((rule) => matches(rule, n))?.tone ?? null
}

/** the inline background of a scale or a bar for a value, or none */
export function fillOf(format: ColumnFormat | undefined, value: unknown, range: Range | null): CSSProperties | undefined {
  const n = numeric(value)
  if (!format || !range || n === null) return undefined
  if (format.style === 'scale') {
    const t = range.max === range.min ? 1 : (n - range.min) / (range.max - range.min)
    return { backgroundColor: `color-mix(in srgb, var(--color-brand-600) ${Math.round(6 + t * 34)}%, transparent)` }
  }
  if (format.style === 'bars') {
    const share = range.peak === 0 ? 0 : Math.round((Math.abs(n) / range.peak) * 100)
    return { backgroundImage: `linear-gradient(to right, color-mix(in srgb, var(--color-brand-600) 22%, transparent) ${share}%, transparent ${share}%)` }
  }
  return undefined
}

/** the class a cell takes for its rule's tone */
export function toneClass(format: ColumnFormat | undefined, value: unknown): string {
  const tone = toneOf(format, value)
  return tone ? TONE_CLASS[tone] : ''
}
