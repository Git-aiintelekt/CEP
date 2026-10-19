/**
 * Option 2, steps above the result: the question reads top to bottom as numbered steps. 1 Data, 2 Filter, 3 Summarize
 * (the values and their calculations), 4 Group By (the dimensions, a date by day, week or month), 5 Sort and Limit.
 * Each + opens a picker of the dataset's fields. Under the steps, the result. With only the data chosen, the result is
 * the row count, so there is an answer from the first second.
 */
import { Plus, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Popover } from '@/components/Popover'
import { Select } from '@/components/Form'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import type { CatalogField } from '../types'
import { addField, AGGREGATE_LABEL, BUCKET_LABEL, columnWords, dimensions, fieldOf, measures, removeField, rules, setAggregate, setBucket, setLimit, setRules, setSort } from './definition'
import type { EditorLayoutProps } from './FieldWells'
import { CompareControl } from './CompareControl'
import { TopControl } from './TopControl'
import { FilterBuilder } from './FilterBuilder'

function Step({ number, title, children, end }: { number: number; title: string; children: ReactNode; end?: ReactNode }) {
  return (
    <section aria-label={`${number} ${title}`} className="flex flex-wrap items-center gap-2 border-b border-line-subtle py-2.5 last:border-b-0">
      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sidebar text-xs font-semibold text-on-brand">{number}</span>
      <span className="w-24 shrink-0 text-sm font-semibold text-ink-900">{title}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
      {end}
    </section>
  )
}

function Token({ children, onRemove, label }: { children: ReactNode; onRemove?: () => void; label: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-control-md border border-line bg-surface-subtle px-2.5 text-sm whitespace-nowrap text-ink-900">
      {children}
      {onRemove && <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="text-ink-700 hover:text-ink-900"><X size={12} strokeWidth={1.5} aria-hidden /></button>}
    </span>
  )
}

/** + Add …: a picker of the fields a step can take */
function AddPicker({ label, fields, onPick, id }: { label: string; fields: CatalogField[]; onPick: (field: CatalogField) => void; id: string }) {
  const dropdown = useSingleDropdown<'pick'>()
  return (
    <div className="relative">
      <button type="button" {...dropdown.triggerProps('pick')} id={id} className="inline-flex h-8 items-center gap-1.5 rounded-control-md border border-dashed border-line-control px-2.5 text-xs font-semibold text-ink-900 hover:bg-surface-hover" disabled={fields.length === 0}>
        <Plus size={14} strokeWidth={1.5} aria-hidden />{label}
      </button>
      {dropdown.isOpen('pick') && (
        <Popover {...dropdown.panelProps('pick')} label={label} placement="bottom-start" width={240} className="max-h-72 overflow-y-auto py-1">
          <ul>
            {fields.map((field) => (
              <li key={field.key}>
                <button type="button" data-dropdown-item onClick={() => { dropdown.close({ restoreFocus: false }); onPick(field) }} className="flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-sm text-ink-900 hover:bg-surface-hover">
                  <span className="truncate">{field.label}</span>
                  {field.sensitivity === 'PII' && <span className="text-[10px] font-semibold text-ink-700 uppercase">PII</span>}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  )
}

export function Steps({ dataset, definition, onChange, result, rowCount }: EditorLayoutProps & { rowCount?: number }) {
  const dims = dimensions(definition)
  const meas = measures(definition)
  const current = rules(definition)
  const [filtersOpen, setFiltersOpen] = useState(current.length > 0)
  const unused = (role: CatalogField['role']) => dataset.fields.filter((field) => field.role === role && !definition.columns.some((column) => column.field === field.key))
  const sort = definition.orderBy?.[0]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rounded-md border border-line bg-surface px-3">
        <Step number={1} title="Data"><Token label={dataset.label}>{dataset.label}</Token><span className="text-xs text-ink-700">{dataset.description}</span></Step>
        <Step number={2} title="Filter" end={!filtersOpen && current.length === 0 ? (
          <button type="button" onClick={() => setFiltersOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-control-md border border-dashed border-line-control px-2.5 text-xs font-semibold text-ink-900 hover:bg-surface-hover"><Plus size={14} strokeWidth={1.5} aria-hidden />Add Filter</button>
        ) : undefined}>
          {(filtersOpen || current.length > 0) && <FilterBuilder dataset={dataset} rules={current} combinator={definition.filters?.combinator ?? 'and'} onChange={(next, combinator) => onChange(setRules(definition, next, combinator))} compact />}
        </Step>
        <Step number={3} title="Summarize">
          {meas.length === 0 && <Token label="Count of Rows">Count of Rows</Token>}
          {meas.map((column) => {
            const field = fieldOf(dataset, column.field)
            return (
              <Token key={column.field} label={columnWords(dataset, column)} onRemove={() => onChange(removeField(definition, column.field))}>
                <span className="w-32"><Select aria-label={`${field?.label} calculation`} controlSize="sm" value={column.aggregate} onChange={(event) => onChange(setAggregate(definition, column.field, event.target.value as never))}>
                  {(field?.aggregates ?? []).map((aggregate) => <option key={aggregate} value={aggregate}>{AGGREGATE_LABEL[aggregate]}</option>)}
                </Select></span>
                <span>of {field?.label}</span>
                <CompareControl dataset={dataset} definition={definition} column={column} onChange={onChange} label={field?.label ?? column.field} />
              </Token>
            )
          })}
          <AddPicker id="add-value" label="Add Value" fields={unused('measure')} onPick={(field) => onChange(addField(definition, field))} />
        </Step>
        <Step number={4} title="Group By">
          {dims.map((column) => {
            const field = fieldOf(dataset, column.field)
            return (
              <Token key={column.field} label={columnWords(dataset, column)} onRemove={() => onChange(removeField(definition, column.field))}>
                <span>{field?.label}</span>
                {field && field.buckets.length > 0 && (
                  <span className="w-28"><Select aria-label={`${field.label} bucket`} controlSize="sm" value={column.bucket ?? ''} onChange={(event) => onChange(setBucket(definition, column.field, (event.target.value || null) as never))}>
                    <option value="">as is</option>{field.buckets.map((bucket) => <option key={bucket} value={bucket}>{BUCKET_LABEL[bucket]}</option>)}
                  </Select></span>
                )}
              </Token>
            )
          })}
          <AddPicker id="add-grouping" label="Add Grouping" fields={unused('dimension')} onPick={(field) => onChange(addField(definition, field))} />
        </Step>
        <Step number={5} title="Sort and Limit">
          <span className="w-44"><Select aria-label="Sort by" controlSize="sm" value={sort?.field ?? ''} onChange={(event) => onChange(setSort(definition, event.target.value || null, sort?.direction ?? 'asc'))}>
            <option value="">No sort</option>{definition.columns.map((column) => <option key={column.field} value={column.field}>{fieldOf(dataset, column.field)?.label ?? column.field}</option>)}
          </Select></span>
          <span className="w-32"><Select aria-label="Sort direction" controlSize="sm" value={sort?.direction ?? 'asc'} disabled={!sort} onChange={(event) => onChange(setSort(definition, sort?.field ?? null, event.target.value as 'asc' | 'desc'))}>
            <option value="asc">lowest first</option><option value="desc">highest first</option>
          </Select></span>
          <span className="w-36"><Select aria-label="Limit" controlSize="sm" value={String(definition.limit ?? '')} onChange={(event) => onChange(setLimit(definition, Number(event.target.value) || undefined))}>
            <option value="">All rows</option>{[100, 500, 1000, 5000].map((n) => <option key={n} value={n}>First {n.toLocaleString()}</option>)}
          </Select></span>
          <TopControl definition={definition} onChange={onChange} />
        </Step>
      </div>
      {definition.columns.length === 0 ? (
        <div className="flex flex-col items-start gap-1 rounded-md border border-line bg-surface p-5">
          <p className="cep-num font-display text-[28px] font-semibold text-ink-900">{rowCount === undefined ? '…' : rowCount.toLocaleString()}</p>
          <p className="text-sm text-ink-800">{dataset.label.toLowerCase()}, all time. Add a grouping to split them, for example by channel or by month.</p>
        </div>
      ) : result}
    </div>
  )
}
