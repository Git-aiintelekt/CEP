/**
 * Option 1, field wells: three columns like a spreadsheet pivot. Left, the dataset's fields, searchable, a field in use
 * highlighted; a click (or a drag) puts it in the well it belongs to. Middle, the result, live. Right, the wells: Rows
 * (one line per value), Columns (the pivot's spread, with the pivot view to come), Values (numbers to add up, each with
 * its calculation) and Filters (keep only matching rows), then Sort and Limit.
 */
import { ArrowDown, ArrowUp, Hash, Search, Type, X, Calendar, ToggleLeft } from 'lucide-react'
import { useState, type DragEvent, type ReactNode } from 'react'

import { Select } from '@/components/Form'
import type { CatalogDataset, CatalogField, ReportDefinition } from '../types'
import { addField, AGGREGATE_LABEL, BUCKET_LABEL, dimensions, fieldOf, inUse, measures, moveField, removeField, rules, setAcross, setAggregate, setBucket, setLimit, setRules, setSort, viewOf } from './definition'
import { FilterBuilder } from './FilterBuilder'

const TYPE_ICON = { string: Type, number: Hash, date: Calendar, datetime: Calendar, boolean: ToggleLeft } as const

export interface EditorLayoutProps {
  dataset: CatalogDataset
  definition: ReportDefinition
  onChange: (next: ReportDefinition) => void
  /** the live result, between the panes */
  result: ReactNode
}

function FieldRow({ field, used, onAdd }: { field: CatalogField; used: boolean; onAdd: () => void }) {
  const Icon = TYPE_ICON[field.type]
  return (
    <li>
      <button type="button" draggable onDragStart={(event: DragEvent) => event.dataTransfer.setData('text/x-field', field.key)} onClick={onAdd} disabled={used}
        aria-label={`${field.label}${used ? ', in use' : ', add'}`}
        className={`flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm transition-colors ${used ? 'bg-brand-100/60 font-medium text-brand-800' : 'text-ink-900 hover:bg-surface-hover'}`}>
        <Icon size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />
        <span className="min-w-0 flex-1 truncate">{field.label}</span>
        {field.sensitivity === 'PII' && <span className="text-[10px] font-semibold text-ink-700 uppercase">PII</span>}
      </button>
    </li>
  )
}

function Well({ title, hint, children, onDrop, empty }: { title: string; hint: string; children: ReactNode; onDrop?: (key: string) => void; empty: boolean }) {
  const [over, setOver] = useState(false)
  return (
    <section aria-label={title}
      onDragOver={onDrop ? (event) => { event.preventDefault(); setOver(true) } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop ? (event) => { event.preventDefault(); setOver(false); const key = event.dataTransfer.getData('text/x-field'); if (key) onDrop(key) } : undefined}
      className={`rounded-md border p-2.5 transition-colors ${over ? 'border-brand-600 bg-brand-100/30' : 'border-line bg-surface'}`}>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-800 uppercase">{title}</h3>
      {empty ? <p className="text-xs text-ink-700">{hint}</p> : <ul className="flex flex-col gap-1">{children}</ul>}
    </section>
  )
}

/** a field in a well: its name with the move and remove controls, and under it, when the field has one, its calculation or bucket */
function Chip({ children, control, onRemove, label, onUp, onDown }: { children: ReactNode; control?: ReactNode; onRemove: () => void; label: string; onUp?: () => void; onDown?: () => void }) {
  return (
    <li className="flex flex-col gap-1 rounded-sm bg-surface-subtle px-2 py-1.5 text-sm text-ink-900">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-medium">{children}</span>
        {onUp && <button type="button" aria-label={`Move ${label} up`} onClick={onUp} className="text-ink-700 hover:text-ink-900"><ArrowUp size={12} strokeWidth={1.5} aria-hidden /></button>}
        {onDown && <button type="button" aria-label={`Move ${label} down`} onClick={onDown} className="text-ink-700 hover:text-ink-900"><ArrowDown size={12} strokeWidth={1.5} aria-hidden /></button>}
        <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="text-ink-700 hover:text-ink-900"><X size={12} strokeWidth={1.5} aria-hidden /></button>
      </div>
      {control}
    </li>
  )
}

export function FieldWells({ dataset, definition, onChange, result }: EditorLayoutProps) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const shown = dataset.fields.filter((field) => !term || field.label.toLowerCase().includes(term))
  const dims = dimensions(definition)
  const meas = measures(definition)
  const current = rules(definition)
  const add = (key: string) => { const field = fieldOf(dataset, key); if (field) onChange(addField(definition, field)) }
  const across = viewOf(definition).across
  const spread = dims.find((column) => column.field === across)
  const rowDims = dims.filter((column) => column.field !== across)
  const addAcross = (key: string) => { const field = fieldOf(dataset, key); if (field?.role === 'dimension') onChange(setAcross(addField(definition, field), key)) }
  const sort = definition.orderBy?.[0]
  const dimChip = (column: (typeof dims)[number], movable: boolean) => {
    const field = fieldOf(dataset, column.field)
    return (
      <Chip key={column.field} label={field?.label ?? column.field} onRemove={() => onChange(removeField(definition, column.field))}
        onUp={movable ? () => onChange(moveField(definition, column.field, -1)) : undefined} onDown={movable ? () => onChange(moveField(definition, column.field, 1)) : undefined}
        control={field && field.buckets.length > 0 ? (
          <Select aria-label={`${field.label} bucket`} controlSize="sm" value={column.bucket ?? ''} onChange={(event) => onChange(setBucket(definition, column.field, (event.target.value || null) as never))}>
            <option value="">as is</option>{field.buckets.map((bucket) => <option key={bucket} value={bucket}>{BUCKET_LABEL[bucket]}</option>)}
          </Select>
        ) : undefined}>
        {field?.label}
      </Chip>
    )
  }
  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
      <aside aria-label="Fields" className="flex min-h-0 flex-col gap-2 rounded-md border border-line bg-surface p-2.5">
        <label className="relative">
          <span className="sr-only">Search fields</span>
          <Search size={14} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-700" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search fields" className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-2 pl-7 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
        </label>
        <p className="text-xs font-semibold text-ink-900">{dataset.label}</p>
        <ul aria-label="Dimensions" className="flex flex-col gap-0.5">{shown.filter((f) => f.role === 'dimension').map((field) => <FieldRow key={field.key} field={field} used={inUse(definition, field.key)} onAdd={() => add(field.key)} />)}</ul>
        <p className="mt-1 text-[10.5px] font-semibold tracking-wide text-ink-700 uppercase">Measures</p>
        <ul aria-label="Measures" className="flex flex-col gap-0.5">{shown.filter((f) => f.role === 'measure').map((field) => <FieldRow key={field.key} field={field} used={inUse(definition, field.key)} onAdd={() => add(field.key)} />)}</ul>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        {definition.columns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-line p-8 text-center">
            <p className="text-sm font-semibold text-ink-900">Drag a field into Rows or Values to start</p>
            <p className="mt-1 max-w-sm text-sm text-ink-800">Rows lists one line per value, such as each channel. Values adds up a number for each line, such as messages sent.</p>
          </div>
        ) : result}
      </div>

      <aside aria-label="Wells" className="flex flex-col gap-2.5">
        <Well title="Rows" hint="One line per value" empty={rowDims.length === 0} onDrop={add}>
          {rowDims.map((column) => dimChip(column, true))}
        </Well>
        <Well title="Columns" hint="Spread one dimension across: the pivot's columns, the chart's series" empty={!spread} onDrop={addAcross}>
          {spread && dimChip(spread, false)}
        </Well>
        <Well title="Values" hint="Numbers to add up" empty={meas.length === 0} onDrop={add}>
          {meas.map((column) => {
            const field = fieldOf(dataset, column.field)
            return (
              <Chip key={column.field} label={field?.label ?? column.field} onRemove={() => onChange(removeField(definition, column.field))}
                onUp={() => onChange(moveField(definition, column.field, -1))} onDown={() => onChange(moveField(definition, column.field, 1))}
                control={(
                  <Select aria-label={`${field?.label} calculation`} controlSize="sm" value={column.aggregate} onChange={(event) => onChange(setAggregate(definition, column.field, event.target.value as never))}>
                    {(field?.aggregates ?? []).map((aggregate) => <option key={aggregate} value={aggregate}>{AGGREGATE_LABEL[aggregate]}</option>)}
                  </Select>
                )}>
                {field?.label}
              </Chip>
            )
          })}
        </Well>
        <section aria-label="Filters" className="rounded-md border border-line bg-surface p-2.5">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-800 uppercase">Filters</h3>
          {current.length === 0 && <p className="mb-1.5 text-xs text-ink-700">Keep only matching rows</p>}
          <FilterBuilder dataset={dataset} rules={current} combinator={definition.filters?.combinator ?? 'and'} onChange={(next, combinator) => onChange(setRules(definition, next, combinator))} compact />
        </section>
        <section aria-label="Sort and Limit" className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2.5">
          <h3 className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Sort and Limit</h3>
          <div className="flex gap-1.5">
            <span className="min-w-0 flex-1"><Select aria-label="Sort by" controlSize="sm" value={sort?.field ?? ''} onChange={(event) => onChange(setSort(definition, event.target.value || null, sort?.direction ?? 'asc'))}>
              <option value="">No sort</option>{definition.columns.map((column) => <option key={column.field} value={column.field}>{fieldOf(dataset, column.field)?.label ?? column.field}</option>)}
            </Select></span>
            <span className="w-24 shrink-0"><Select aria-label="Sort direction" controlSize="sm" value={sort?.direction ?? 'asc'} disabled={!sort} onChange={(event) => onChange(setSort(definition, sort?.field ?? null, event.target.value as 'asc' | 'desc'))}>
              <option value="asc">A to Z</option><option value="desc">Z to A</option>
            </Select></span>
          </div>
          <Select aria-label="Limit" controlSize="sm" value={String(definition.limit ?? '')} onChange={(event) => onChange(setLimit(definition, Number(event.target.value) || undefined))}>
            <option value="">All rows (up to the engine's cap)</option>{[100, 500, 1000, 5000].map((n) => <option key={n} value={n}>First {n.toLocaleString()} rows</option>)}
          </Select>
        </section>
      </aside>
    </div>
  )
}
