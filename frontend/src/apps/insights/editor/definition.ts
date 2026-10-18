/**
 * The editor's state: one report definition, changed the same way by both editors (field wells, steps). Every change
 * returns a new definition; nothing here talks to the server. The validator on the server has the last word.
 */
import type { Aggregate, Bucket, CatalogDataset, CatalogField, CompareKind, FilterGroup, FilterRule, ReportColumn, ReportDefinition, ReportView } from '../types'

export const AGGREGATE_LABEL: Record<Aggregate, string> = { sum: 'Sum', count: 'Count', count_distinct: 'Distinct Count', avg: 'Average', min: 'Min', max: 'Max', calc: 'Calculated' }
export const BUCKET_LABEL: Record<Bucket, string> = { day: 'by Day', week: 'by Week', month: 'by Month', quarter: 'by Quarter', year: 'by Year' }
export const OPERATOR_LABEL: Record<string, string> = {
  '=': 'is', '!=': 'is not', '>': 'more than', '>=': 'at least', '<': 'less than', '<=': 'at most', between: 'between', in: 'is one of',
  contains: 'contains', starts_with: 'starts with', is_null: 'is empty', is_not_null: 'is not empty', last_days: 'in the last days',
}

export const EMPTY: ReportDefinition = { columns: [], filters: { combinator: 'and', rules: [] }, orderBy: [], limit: 500 }

const UNIT_WORDS: Record<Bucket, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' }
const COMPARE_KINDS: CompareKind[] = ['previous_period', 'previous_year', 'change_previous_period', 'change_previous_year', 'year_to_date', 'quarter_to_date', 'running_total',
  'moving_average', 'percent_of_total', 'rank', 'percent_of_target', 'difference_to_target']
const TIMED: CompareKind[] = ['previous_period', 'previous_year', 'change_previous_period', 'change_previous_year', 'running_total', 'year_to_date', 'quarter_to_date', 'moving_average']
const ADDING: CompareKind[] = ['running_total', 'percent_of_total', 'year_to_date', 'quarter_to_date']
export const TARGET_KINDS: CompareKind[] = ['percent_of_target', 'difference_to_target']
export const MAX_COMPARISONS = 6

/** the report's time axis: its first dimension that is a date (a date field, or a date and time with a bucket), and its bucket */
export function timeAxis(dataset: CatalogDataset, definition: ReportDefinition): { field: string; bucket: Bucket } | null {
  for (const column of dimensions(definition)) {
    const field = fieldOf(dataset, column.field)
    if (field?.type === 'date') return { field: field.key, bucket: column.bucket ?? 'day' }
    if (field?.type === 'datetime' && column.bucket) return { field: field.key, bucket: column.bucket }
  }
  return null
}

/** a comparison's name in the editor and on its column: "Previous Month", "Change vs Last Year" */
export function compareLabel(kind: CompareKind, bucket: Bucket | null): string {
  const unit = bucket ? UNIT_WORDS[bucket] : 'Period'
  return { previous_period: `Previous ${unit}`, previous_year: 'Last Year', change_previous_period: `Change vs Previous ${unit}`, change_previous_year: 'Change vs Last Year',
    running_total: 'Running Total', percent_of_total: '% of Total', year_to_date: 'Year to Date', quarter_to_date: 'Quarter to Date',
    moving_average: `Moving Average (3 ${unit}s)`, rank: 'Rank', percent_of_target: '% of Target', difference_to_target: 'Difference to Target' }[kind]
}

/** every comparison a measure column could take, with why not when it cannot */
export function compareOptions(dataset: CatalogDataset, definition: ReportDefinition, column: ReportColumn): { kind: CompareKind; label: string; reason?: string }[] {
  const axis = timeAxis(dataset, definition)
  return COMPARE_KINDS.map((kind) => {
    const reason = TIMED.includes(kind) && !axis ? 'needs a date by day, week, month, quarter or year'
      : ADDING.includes(kind) && column.aggregate !== 'sum' && column.aggregate !== 'count' ? 'adds up sums and counts only'
      : undefined
    return { kind, label: compareLabel(kind, axis?.bucket ?? null), ...(reason ? { reason } : {}) }
  })
}

/** a measure's comparisons, in the order given; none removes the key */
export function setCompare(definition: ReportDefinition, key: string, kinds: CompareKind[]): ReportDefinition {
  return pruneFormats({ ...definition, columns: definition.columns.map((column) => {
    if (column.field !== key) return column
    const { compare: _old, ...rest } = column
    return kinds.length ? { ...rest, compare: kinds } : rest
  }) })
}

/** the number a measure's % of Target and Difference to Target compare with */
export function setTarget(definition: ReportDefinition, key: string, target: number | undefined): ReportDefinition {
  return { ...definition, columns: definition.columns.map((column) => {
    if (column.field !== key) return column
    const { target: _old, ...rest } = column
    return target === undefined ? rest : { ...rest, target }
  }) }
}

/** the keys a result names the report's totalled columns by: each measure, then <field>__<kind> for its comparisons */
export function measureKeys(definition: ReportDefinition): string[] {
  return measures(definition).flatMap((column) => [column.field, ...(column.compare ?? []).map((kind) => `${column.field}__${kind}`)])
}

/** the view's formatting, kept only for columns the report still has */
export function pruneFormats(definition: ReportDefinition): ReportDefinition {
  const formats = definition.view?.formats
  if (!formats?.length) return definition
  const keys = new Set(measureKeys(definition))
  const kept = formats.filter((format) => keys.has(format.column))
  if (kept.length === formats.length) return definition
  const { formats: _old, ...view } = definition.view as ReportView
  return { ...definition, view: kept.length ? { ...view, formats: kept } : view }
}

/** the report's totalled columns with their names, for Format Values */
export function formattableColumns(dataset: CatalogDataset, definition: ReportDefinition): { key: string; label: string }[] {
  const bucket = timeAxis(dataset, definition)?.bucket ?? null
  return measures(definition).flatMap((column) => {
    const label = column.label ?? fieldOf(dataset, column.field)?.label ?? column.field
    return [{ key: column.field, label }, ...(column.compare ?? []).map((kind) => ({ key: `${column.field}__${kind}`, label: `${label}, ${compareLabel(kind, bucket)}` }))]
  })
}

export function fieldOf(dataset: CatalogDataset, key: string): CatalogField | undefined {
  return dataset.fields.find((field) => field.key === key)
}

export function dimensions(definition: ReportDefinition): ReportColumn[] {
  return definition.columns.filter((column) => !column.aggregate)
}

export function measures(definition: ReportDefinition): ReportColumn[] {
  return definition.columns.filter((column) => Boolean(column.aggregate))
}

export function rules(definition: ReportDefinition): FilterRule[] {
  return ((definition.filters?.rules ?? []).filter((rule) => !('rules' in rule)) as FilterRule[])
}

export function inUse(definition: ReportDefinition, key: string): boolean {
  return definition.columns.some((column) => column.field === key) || rules(definition).some((rule) => rule.field === key)
}

/** a dimension joins the rows; a measure joins the values with its first aggregate */
export function addField(definition: ReportDefinition, field: CatalogField): ReportDefinition {
  if (definition.columns.some((column) => column.field === field.key)) return definition
  const column: ReportColumn = field.role === 'measure' ? { field: field.key, aggregate: field.aggregates[0] } : { field: field.key }
  const columns = field.role === 'measure' ? [...definition.columns, column] : [...dimensions(definition), column, ...measures(definition)]
  const orderBy = definition.orderBy?.length ? definition.orderBy : field.role === 'measure' ? [{ field: field.key, direction: 'desc' as const }] : []
  return { ...definition, columns, orderBy }
}

function removeColumn(definition: ReportDefinition, key: string): ReportDefinition {
  return { ...definition, columns: definition.columns.filter((column) => column.field !== key), orderBy: (definition.orderBy ?? []).filter((item) => item.field !== key) }
}

/** the field goes, and with it the spread across when it was that field, and its formatting */
export function removeField(definition: ReportDefinition, key: string): ReportDefinition {
  const next = pruneFormats(removeColumn(definition, key))
  return next.view?.across === key ? { ...next, view: { ...next.view, across: undefined } } : next
}

export function viewOf(definition: ReportDefinition): ReportView {
  return definition.view ?? { type: 'grid' }
}

export function setView(definition: ReportDefinition, view: ReportView): ReportDefinition {
  return { ...definition, view }
}

/** the dimension spread across the columns (the pivot's columns, the chart's series), or none */
export function setAcross(definition: ReportDefinition, key: string | null): ReportDefinition {
  return { ...definition, view: { ...viewOf(definition), across: key ?? undefined } }
}

/** a new calculation drops the comparisons that only add up sums and counts when it is neither */
export function setAggregate(definition: ReportDefinition, key: string, aggregate: Aggregate): ReportDefinition {
  const additive = aggregate === 'sum' || aggregate === 'count'
  return pruneFormats({ ...definition, columns: definition.columns.map((column) => {
    if (column.field !== key) return column
    const kept = (column.compare ?? []).filter((kind) => additive || !ADDING.includes(kind))
    const { compare: _old, ...rest } = column
    return kept.length ? { ...rest, aggregate, compare: kept } : { ...rest, aggregate }
  }) })
}

export function setBucket(definition: ReportDefinition, key: string, bucket: Bucket | null): ReportDefinition {
  return { ...definition, columns: definition.columns.map((column) => (column.field === key ? (bucket ? { ...column, bucket } : (({ bucket: _b, ...rest }) => rest)(column)) : column)) }
}

/** moves a column one place within its kind (dimensions among dimensions, measures among measures) */
export function moveField(definition: ReportDefinition, key: string, by: -1 | 1): ReportDefinition {
  const dims = dimensions(definition)
  const meas = measures(definition)
  const inDims = dims.some((column) => column.field === key)
  const list = inDims ? [...dims] : [...meas]
  const index = list.findIndex((column) => column.field === key)
  const target = index + by
  if (index < 0 || target < 0 || target >= list.length) return definition
  ;[list[index], list[target]] = [list[target], list[index]]
  return { ...definition, columns: inDims ? [...list, ...meas] : [...dims, ...list] }
}

export function setRules(definition: ReportDefinition, next: FilterRule[], combinator: FilterGroup['combinator'] = definition.filters?.combinator ?? 'and'): ReportDefinition {
  return { ...definition, filters: { combinator, rules: next } }
}

export function setSort(definition: ReportDefinition, field: string | null, direction: 'asc' | 'desc' = 'asc'): ReportDefinition {
  return { ...definition, orderBy: field ? [{ field, direction }] : [] }
}

export function setLimit(definition: ReportDefinition, limit: number | undefined): ReportDefinition {
  const { limit: _old, ...rest } = definition
  return limit ? { ...rest, limit } : rest
}

/** what a rule says, in words: "Channel is EMAIL", "Sent in the last 30 days" */
export function ruleWords(dataset: CatalogDataset, rule: FilterRule): string {
  const field = fieldOf(dataset, rule.field)
  const label = field?.label ?? rule.field
  const value = rule.value
  if (rule.operator === 'is_null' || rule.operator === 'is_not_null') return `${label} ${OPERATOR_LABEL[rule.operator]}`
  if (rule.operator === 'last_days') return `${label} in the last ${String(value ?? '')} days`
  if (rule.operator === 'between' && Array.isArray(value)) return `${label} between ${String(value[0] ?? '')} and ${String(value[1] ?? '')}`
  if (rule.operator === 'in' && Array.isArray(value)) return `${label} is one of ${value.join(', ')}`
  return `${label} ${OPERATOR_LABEL[rule.operator] ?? rule.operator} ${value === undefined || value === '' ? '…' : String(value)}`
}

/** what a column says: "Sum of Amount", "Sent At by Month" */
export function columnWords(dataset: CatalogDataset, column: ReportColumn): string {
  const label = column.label ?? fieldOf(dataset, column.field)?.label ?? column.field
  if (column.aggregate) return `${AGGREGATE_LABEL[column.aggregate]} of ${label}`
  if (column.bucket) return `${label} ${BUCKET_LABEL[column.bucket]}`
  return label
}

/** a rule's value, ready for the server: numbers as numbers, lists as lists, a range as two */
export function coerceValue(field: CatalogField, operator: string, raw: string): unknown {
  if (operator === 'is_null' || operator === 'is_not_null') return undefined
  if (operator === 'last_days') return Number(raw) || 0
  if (operator === 'in') return raw.split(',').map((part) => part.trim()).filter(Boolean).map((part) => (field.type === 'number' ? Number(part) : part))
  if (operator === 'between') {
    const [a, b] = raw.split('..').map((part) => part.trim())
    return field.type === 'number' ? [Number(a), Number(b)] : [a ?? '', b ?? '']
  }
  if (field.type === 'number') return raw === '' ? '' : Number(raw)
  if (field.type === 'boolean') return raw === 'true'
  return raw
}

/** the text form of a rule's value, for the input */
export function valueText(rule: FilterRule): string {
  const value = rule.value
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return rule.operator === 'between' ? value.map(String).join('..') : value.map(String).join(', ')
  return String(value)
}

export function isComplete(dataset: CatalogDataset, definition: ReportDefinition): boolean {
  return definition.columns.length > 0 && rules(definition).every((rule) => {
    const field = fieldOf(dataset, rule.field)
    if (!field) return false
    if (rule.operator === 'is_null' || rule.operator === 'is_not_null') return true
    if (rule.value === undefined || rule.value === '') return false
    if (Array.isArray(rule.value)) return rule.operator === 'between' ? rule.value.length === 2 && rule.value.every((v) => v !== '' && v !== undefined) : rule.value.length > 0
    return true
  })
}
