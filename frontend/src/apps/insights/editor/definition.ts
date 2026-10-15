/**
 * The editor's state: one report definition, changed the same way by both editors (field wells, steps). Every change
 * returns a new definition; nothing here talks to the server. The validator on the server has the last word.
 */
import type { Aggregate, Bucket, CatalogDataset, CatalogField, FilterGroup, FilterRule, ReportColumn, ReportDefinition, ReportView } from '../types'

export const AGGREGATE_LABEL: Record<Aggregate, string> = { sum: 'Sum', count: 'Count', count_distinct: 'Distinct Count', avg: 'Average', min: 'Min', max: 'Max' }
export const BUCKET_LABEL: Record<Bucket, string> = { day: 'by Day', week: 'by Week', month: 'by Month', quarter: 'by Quarter', year: 'by Year' }
export const OPERATOR_LABEL: Record<string, string> = {
  '=': 'is', '!=': 'is not', '>': 'more than', '>=': 'at least', '<': 'less than', '<=': 'at most', between: 'between', in: 'is one of',
  contains: 'contains', starts_with: 'starts with', is_null: 'is empty', is_not_null: 'is not empty', last_days: 'in the last days',
}

export const EMPTY: ReportDefinition = { columns: [], filters: { combinator: 'and', rules: [] }, orderBy: [], limit: 500 }

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

/** the field goes, and with it the spread across when it was that field */
export function removeField(definition: ReportDefinition, key: string): ReportDefinition {
  const next = removeColumn(definition, key)
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

export function setAggregate(definition: ReportDefinition, key: string, aggregate: Aggregate): ReportDefinition {
  return { ...definition, columns: definition.columns.map((column) => (column.field === key ? { ...column, aggregate } : column)) }
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
