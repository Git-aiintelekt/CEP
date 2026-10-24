/** Report parameters (apps/insights/parameters.py): what a field can be asked as, and the answers in the address and in words. */
import type { CatalogDataset, CatalogField, ParameterOperator, ParameterValues, ReportParameter } from '../types'

export const MAX_PARAMETERS = 5

const BY_TYPE: Record<CatalogField['type'], ParameterOperator[]> = {
  string: ['in', '='],
  number: ['in', '=', '>=', '<=', 'between'],
  date: ['between', 'last_days', '>=', '<=', '='],
  datetime: ['between', 'last_days', '>=', '<='],
  boolean: ['='],
}

export const ASKED_AS: Record<ParameterOperator, string> = {
  '=': 'One Value', in: 'Any of Several Values', '>=': 'At Least', '<=': 'At Most', between: 'A Range', last_days: 'The Last Few Days',
}

/** the ways a field can be asked about, the first the usual one */
export function askable(field: CatalogField): ParameterOperator[] {
  return BY_TYPE[field.type].filter((operator) => field.operators.includes(operator))
}

/** a parameter's key from its label, as the server takes it */
export function parameterKey(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'p_$1').slice(0, 28) || 'question'
  let key = /^[a-z]/.test(base) ? base : `p_${base}`
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`
  return key
}

/** a default of {latest: true}: the newest value (the latest campaign), or the newest row's day, looked up when the report runs */
export function isLatest(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { latest?: unknown }).latest === true
}

/** the latest can be a default: the dataset has a time field, and the question picks a value or a date */
export function latestAllowed(dataset: Pick<CatalogDataset, 'time_field'>, field: CatalogField, operator: ParameterOperator): boolean {
  if (!dataset.time_field) return false
  if (field.type === 'date' || field.type === 'datetime') return operator === '=' || operator === 'between'
  return (field.type === 'string' || field.type === 'number') && (operator === '=' || operator === 'in')
}

export function answered(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.some((item) => item !== '' && item !== null && item !== undefined)
  return true
}

/** the required questions without an answer or a default: the viewer waits for them */
export function unanswered(parameters: ReportParameter[], values: ParameterValues): ReportParameter[] {
  return parameters.filter((p) => p.required && !answered(values[p.key]) && !answered(p.default))
}

/** the answers kept in the address (?ask={...}) */
export function readAnswers(raw: string | null): ParameterValues {
  try {
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** the answers worth sending: the empty ones left out */
export function sentAnswers(values: ParameterValues): ParameterValues {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => answered(value)))
}

/** "EMAIL, SMS", "2026-09-01 to 2026-09-30", "the last 30 days", "Yes" */
export function answerWords(operator: ParameterOperator, value: unknown): string {
  if (!answered(value)) return 'Any'
  if (operator === 'last_days') return `the last ${String(value)} days`
  if (operator === 'between' && Array.isArray(value)) return `${String(value[0] ?? '…')} to ${String(value[1] ?? '…')}`
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return `${operator === '>=' ? 'from ' : operator === '<=' ? 'up to ' : ''}${String(value)}`
}
