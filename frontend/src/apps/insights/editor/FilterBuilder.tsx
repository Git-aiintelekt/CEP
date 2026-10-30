/**
 * The rule builder of the editor's Only Include: one row per rule (field, operator, value), and/or across them, two levels
 * at most on the server. Operators and value controls follow the field's type; a list is comma-separated, a range is
 * "from..to", last days is a number.
 */
import { Plus, X } from 'lucide-react'

import { Select, TextInput } from '@/components/Form'
import type { CatalogDataset, FilterRule } from '../types'
import { coerceValue, fieldOf, OPERATOR_LABEL, valueless, valueText } from './definition'

export interface FilterBuilderProps {
  dataset: CatalogDataset
  rules: FilterRule[]
  combinator: 'and' | 'or'
  onChange: (rules: FilterRule[], combinator: 'and' | 'or') => void
  /** the row to start with when + Add a Rule is pressed: the dataset's time field, else its first field */
  compact?: boolean
}

export function FilterBuilder({ dataset, rules, combinator, onChange, compact = false }: FilterBuilderProps) {
  const fields = dataset.fields
  function update(index: number, patch: Partial<FilterRule>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)), combinator)
  }
  function add() {
    const first = fieldOf(dataset, dataset.time_field ?? '') ?? fields[0]
    if (!first) return
    const operator = first.operators.includes('last_days') ? 'last_days' : first.operators[0]
    onChange([...rules, { field: first.key, operator, value: operator === 'last_days' ? 30 : '' }], combinator)
  }
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Rules">
      {rules.map((rule, index) => {
        const field = fieldOf(dataset, rule.field) ?? fields[0]
        const noValue = valueless(rule.operator)
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            {index > 0 && (
              <span className="w-20 shrink-0"><Select aria-label="Combine with" controlSize="sm" value={combinator} onChange={(event) => onChange(rules, event.target.value as 'and' | 'or')}>
                <option value="and">and</option><option value="or">or</option>
              </Select></span>
            )}
            <span className={compact ? 'min-w-0 flex-1' : 'w-44'}><Select aria-label={`Rule ${index + 1} field`} controlSize="sm" value={rule.field}
              onChange={(event) => { const next = fieldOf(dataset, event.target.value); if (!next) return; const operator = next.operators.includes(rule.operator) ? rule.operator : next.operators[0]; update(index, { field: next.key, operator, value: operator === 'last_days' ? 30 : '' }) }}>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select></span>
            {compact && <span aria-hidden className="h-0 basis-full" />}
            <span className={compact ? 'w-36 shrink-0' : 'w-40'}><Select aria-label={`Rule ${index + 1} operator`} controlSize="sm" value={rule.operator}
              onChange={(event) => update(index, { operator: event.target.value, value: event.target.value === 'last_days' ? 30 : noValue || valueless(event.target.value) ? '' : rule.value })}>
              {field.operators.map((op) => <option key={op} value={op}>{OPERATOR_LABEL[op] ?? op}</option>)}
            </Select></span>
            {!noValue && (field.type === 'boolean' ? (
              <span className="w-28"><Select aria-label={`Rule ${index + 1} value`} controlSize="sm" value={String(rule.value ?? 'true')} onChange={(event) => update(index, { value: event.target.value === 'true' })}>
                <option value="true">Yes</option><option value="false">No</option>
              </Select></span>
            ) : (
              <span className={compact ? 'min-w-0 flex-1' : 'w-52'}><TextInput aria-label={`Rule ${index + 1} value`} controlSize="sm"
                type={rule.operator === 'last_days' || (field.type === 'number' && !['in', 'between'].includes(rule.operator)) ? 'number' : field.type === 'date' && !['in', 'between'].includes(rule.operator) ? 'date' : 'text'}
                placeholder={rule.operator === 'between' ? 'from..to' : rule.operator === 'in' ? 'one, two, three' : field.type === 'datetime' ? 'YYYY-MM-DD' : ''}
                value={valueText(rule)} onChange={(event) => update(index, { value: coerceValue(field, rule.operator, event.target.value) })} /></span>
            ))}
            <button type="button" aria-label={`Remove rule ${index + 1}`} onClick={() => onChange(rules.filter((_, i) => i !== index), combinator)} className="flex h-8 w-8 items-center justify-center rounded-control-md text-ink-800 hover:bg-fill-subtle"><X size={14} strokeWidth={1.5} aria-hidden /></button>
          </div>
        )
      })}
      <button type="button" onClick={add} className="inline-flex h-8 w-fit items-center gap-1.5 rounded-control-md border border-dashed border-line-control px-2.5 text-xs font-semibold text-ink-900 hover:bg-surface-hover"><Plus size={14} strokeWidth={1.5} aria-hidden />Add a Rule</button>
    </div>
  )
}
