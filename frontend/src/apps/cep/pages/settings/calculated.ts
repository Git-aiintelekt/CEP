/**
 * Calculated measures on a mapped dataset (Settings → Report Databases → Map a Dataset): a rate, a share or a difference
 * over the dataset's measures, kept as rows the page edits and sent as fields with a `formula`. An operand names a
 * measure by its table and column (`ref`, "t0.amount") while the dataset is being mapped, by its field key once saved,
 * or is a number.
 */
import type { Aggregate, DatasetFormulaSide, FormulaOp, ReportDatasetField } from '@/apps/insights/types'

export type Operand = { ref: string; aggregate: Aggregate } | { field: string; aggregate: Aggregate } | { value: string }

export interface CalcRow {
  label: string
  op: FormulaOp
  left: Operand
  right: Operand
  /** multiplies the result: 100 for a percentage; empty for none */
  scale: string
  format: 'percent' | 'decimal' | 'integer' | 'money'
  sensitivity: ReportDatasetField['sensitivity']
}

/** a measure an operand can name: a used measure column of the dataset */
export interface MeasureChoice {
  ref: string
  key?: string
  label: string
  aggregates: Aggregate[]
}

export const OP_LABEL: Record<FormulaOp, string> = { ratio: '÷', difference: '−', sum: '+', product: '×' }
export const OP_WORDS: Record<FormulaOp, string> = { ratio: 'Divided by', difference: 'Minus', sum: 'Plus', product: 'Times' }
export const NUMBER = '#number'

export function newCalc(): CalcRow {
  return { label: '', op: 'ratio', left: { ref: '', aggregate: 'sum' }, right: { ref: '', aggregate: 'sum' }, scale: '100', format: 'percent', sensitivity: 'NORMAL' }
}

/** the row a saved calculated field becomes */
export function calcFromField(field: ReportDatasetField): CalcRow | null {
  const formula = field.formula
  if (!formula) return null
  const side = (part: DatasetFormulaSide): Operand => {
    if ('value' in part) return { value: String(part.value) }
    if ('field' in part) return { field: part.field, aggregate: part.aggregate }
    return { ref: `${part.table ?? 't0'}.${part.column}`, aggregate: part.aggregate }
  }
  const format = field.format === 'money' || field.format === 'integer' || field.format === 'decimal' ? field.format : 'percent'
  return { label: field.label, op: formula.op, left: side(formula.left), right: side(formula.right), scale: formula.scale ? String(formula.scale) : '', format, sensitivity: field.sensitivity }
}

/** what the select shows for an operand: its ref, the ref of the measure its key names, or the number marker */
export function operandChoice(operand: Operand, measures: MeasureChoice[]): string {
  if ('value' in operand) return NUMBER
  if ('ref' in operand) return operand.ref
  return measures.find((measure) => measure.key === operand.field)?.ref ?? ''
}

export function operandAggregate(operand: Operand): Aggregate | null {
  return 'aggregate' in operand ? operand.aggregate : null
}

/** the field sent to the server, or null while a side is still empty */
export function calcToField(row: CalcRow): ReportDatasetField | null {
  const side = (operand: Operand): DatasetFormulaSide | null => {
    if ('value' in operand) return operand.value.trim() === '' || Number.isNaN(Number(operand.value)) ? null : { value: Number(operand.value) }
    if ('field' in operand) return operand.field ? { field: operand.field, aggregate: operand.aggregate } : null
    if (!operand.ref) return null
    const [table, ...rest] = operand.ref.split('.')
    return { column: rest.join('.'), table, aggregate: operand.aggregate }
  }
  const left = side(row.left), right = side(row.right)
  if (!row.label.trim() || !left || !right) return null
  const scale = row.scale.trim() === '' ? undefined : Number(row.scale)
  return { column: null, label: row.label.trim(), type: 'number', role: 'measure', aggregates: ['calc'], format: row.format, sensitivity: row.sensitivity,
    formula: { op: row.op, left, right, ...(scale && scale !== 1 ? { scale } : {}) } }
}

/** "Delivered ÷ Sent × 100" */
export function calcWords(row: CalcRow, measures: MeasureChoice[]): string {
  const side = (operand: Operand) => {
    if ('value' in operand) return operand.value || '…'
    const ref = operandChoice(operand, measures)
    const measure = measures.find((item) => item.ref === ref)
    return measure ? `${AGG_SHORT[operand.aggregate]} ${measure.label}` : '…'
  }
  return `${side(row.left)} ${OP_LABEL[row.op]} ${side(row.right)}${row.scale.trim() && row.scale.trim() !== '1' ? ` × ${row.scale.trim()}` : ''}`
}

const AGG_SHORT: Record<Aggregate, string> = { sum: 'Sum of', count: 'Count of', count_distinct: 'Distinct', avg: 'Average', min: 'Min', max: 'Max', calc: '' }
