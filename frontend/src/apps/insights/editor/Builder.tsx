/**
 * The report builder in the editor's right pane (docs/mockups/report-editor-workspace.html), one way to build a report
 * in place of Field Wells and Steps. Four sections, read top to bottom:
 * - Show: the numbers, each a card with one menu for how it adds up and what it is compared with;
 * - Split By: the fields that break them down; with two or more in a pivot or a chart, each after the first can go
 *   Across the Top (the pivot's columns, the chart's series) instead of down the side;
 * - Only Include: rules that leave rows out;
 * - Order: the sort, how many rows and Top N, folded with its setting in one line.
 * A field dragged in from the Data pane goes where it belongs; cards reorder with ⋯ or by dragging.
 */
import { Calendar, Check, ChevronDown, Hash, Plus, Search, Sigma, ToggleLeft, Type, X } from 'lucide-react'
import { useState, type DragEvent, type ReactNode } from 'react'

import { Select, TextInput } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { SegmentedControl } from '@/components/SegmentedControl'
import type { CatalogDataset, CatalogField, CompareKind, ReportColumn, ReportDefinition } from '../types'
import { BuilderCard, Popover } from './BuilderCard'
import {
  addField, AGGREGATE_LABEL, BUCKET_LABEL, compareOptions, dimensions, fieldOf, MAX_COMPARISONS, measures, moveField, removeField, rules,
  setAcross, setAggregate, setBucket, setCompare, setLimit, setRules, setSort, setTarget, TARGET_KINDS, viewOf,
} from './definition'
import { FilterBuilder } from './FilterBuilder'
import { TopControl } from './TopControl'

const TYPE_ICON = { string: Type, number: Hash, date: Calendar, datetime: Calendar, boolean: ToggleLeft } as const
const LIMITS = [100, 500, 1000, 5000]
const chip = 'inline-flex h-7 shrink-0 items-center gap-1 rounded-pill border border-line bg-surface pr-2 pl-2.5 text-xs font-medium text-ink-900 hover:bg-surface-hover aria-expanded:border-brand-600'
const addLink = 'inline-flex h-7 items-center gap-1.5 text-helper font-medium text-brand-600 hover:underline'

const iconOf = (field: CatalogField | undefined) => (field?.custom ? Sigma : TYPE_ICON[field?.type ?? 'string'])

function Section({ title, question, onDropField, children }: { title: string; question: string; onDropField?: (key: string) => void; children: ReactNode }) {
  const [over, setOver] = useState(false)
  const takes = (event: DragEvent) => Boolean(onDropField) && event.dataTransfer.types.includes('text/x-field')
  return (
    <section aria-label={title}
      onDragOver={(event) => { if (takes(event)) { event.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { setOver(false); const key = event.dataTransfer.getData('text/x-field'); if (onDropField && key) { event.preventDefault(); onDropField(key) } }}
      className={`border-b border-line-subtle px-4 py-3.5 transition-colors ${over ? 'bg-brand-100/40' : ''}`}>
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      <p className="mt-0.5 mb-2.5 text-helper text-ink-800">{question}</p>
      {children}
    </section>
  )
}

/** a searchable list of the fields a section can take */
function AddPicker({ label, fields, onPick }: { label: string; fields: CatalogField[]; onPick: (field: CatalogField) => void }) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const shown = fields.filter((field) => !term || field.label.toLowerCase().includes(term))
  if (fields.length === 0) return null
  return (
    <Popover label={label} align="start" width="w-72" className={addLink} button={<><Plus size={14} strokeWidth={1.5} aria-hidden />{label}</>}>
      {(close) => (
        <>
          <label className="relative mx-2 mt-1 mb-1 block">
            <span className="sr-only">Search fields</span>
            <Search size={14} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-800" />
            <input type="search" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search fields"
              className="h-8 w-full rounded-pill border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-300 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
          </label>
          {shown.length === 0 && <p className="px-3 py-2 text-helper text-ink-800">No fields match “{search.trim()}”.</p>}
          {shown.map((field) => {
            const Icon = iconOf(field)
            return <MenuRow key={field.key} role="menuitem" divider={false} leading={<Icon size={14} strokeWidth={1.5} aria-hidden className="text-ink-800" />} title={field.label} onClick={() => { onPick(field); close() }} />
          })}
        </>
      )}
    </Popover>
  )
}

/** a number's one menu: how it adds up, and what it is compared with */
function CalculationMenu({ dataset, definition, column, field, label, onChange }: { dataset: CatalogDataset; definition: ReportDefinition; column: ReportColumn; field: CatalogField | undefined; label: string; onChange: (next: ReportDefinition) => void }) {
  const options = compareOptions(dataset, definition, column)
  const current = column.compare ?? []
  const full = current.length >= MAX_COMPARISONS
  const aggregates = field?.aggregates ?? []
  return (
    <Popover label={`${label} calculation`} className={chip} button={<>{column.aggregate ? AGGREGATE_LABEL[column.aggregate] : 'Calculation'}<ChevronDown size={12} strokeWidth={1.5} aria-hidden /></>}>
      {() => (
        <>
          {aggregates.length > 1 && (
            <div role="group" aria-label="Add Up As">
              <p className="px-3 pt-1.5 pb-1 text-xs font-semibold text-ink-800">Add Up As</p>
              {aggregates.map((aggregate) => (
                <MenuRow key={aggregate} role="menuitemradio" aria-checked={column.aggregate === aggregate} divider={false} title={AGGREGATE_LABEL[aggregate]}
                  leading={<Check size={14} strokeWidth={1.5} aria-hidden className={column.aggregate === aggregate ? 'text-brand-600' : 'invisible'} />}
                  onClick={() => onChange(setAggregate(definition, column.field, aggregate))} />
              ))}
            </div>
          )}
          {options.length > 0 && (
            <div role="group" aria-label="Compare With" className={aggregates.length > 1 ? 'mt-1 border-t border-line-subtle pt-1' : ''}>
              <p className="px-3 pt-1.5 pb-1 text-xs font-semibold text-ink-800">Compare With</p>
              {options.map((option) => {
                const on = current.includes(option.kind)
                const disabled = Boolean(option.reason) || (!on && full)
                return (
                  <MenuRow key={option.kind} role="menuitemcheckbox" aria-checked={on} divider={false} disabled={disabled} title={option.label}
                    detail={option.reason ?? (!on && full ? `Up to ${MAX_COMPARISONS} comparisons` : undefined)}
                    leading={<Check size={14} strokeWidth={1.5} aria-hidden className={on ? 'text-brand-600' : 'invisible'} />}
                    onClick={() => { if (!disabled) onChange(setCompare(definition, column.field, on ? current.filter((kind) => kind !== option.kind) : [...current, option.kind])) }} />
                )
              })}
            </div>
          )}
        </>
      )}
    </Popover>
  )
}

function Comparisons({ dataset, definition, column, label, onChange }: { dataset: CatalogDataset; definition: ReportDefinition; column: ReportColumn; label: string; onChange: (next: ReportDefinition) => void }) {
  const current = column.compare ?? []
  if (current.length === 0) return null
  const options = compareOptions(dataset, definition, column)
  const words = (kind: CompareKind) => options.find((option) => option.kind === kind)?.label ?? kind
  return (
    <div className="flex flex-wrap items-center gap-1 pl-6">
      {current.map((kind) => (
        <span key={kind} className="inline-flex h-6 items-center gap-1 rounded-sm bg-brand-100 px-1.5 text-xs font-semibold text-brand-800">
          {words(kind)}
          <button type="button" aria-label={`Remove ${words(kind)} from ${label}`} onClick={() => onChange(setCompare(definition, column.field, current.filter((k) => k !== kind)))} className="text-brand-800 hover:text-ink-900"><X size={12} strokeWidth={1.5} aria-hidden /></button>
        </span>
      ))}
      {current.some((kind) => TARGET_KINDS.includes(kind)) && (
        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-800">
          Target
          <span className="w-24"><TextInput aria-label={`${label} target`} controlSize="sm" type="number" step="any" value={column.target ?? ''}
            onChange={(event) => onChange(setTarget(definition, column.field, event.target.value === '' ? undefined : Number(event.target.value)))} /></span>
        </label>
      )}
    </div>
  )
}

/** moves a card to another card's place, one step at a time so the other kind's columns stay where they are */
function moveTo(definition: ReportDefinition, list: ReportColumn[], dragged: string, target: string): ReportDefinition {
  const from = list.findIndex((column) => column.field === dragged)
  const to = list.findIndex((column) => column.field === target)
  if (from < 0 || to < 0) return definition
  let next = definition
  for (let step = 0; step < Math.abs(to - from); step++) next = moveField(next, dragged, to > from ? 1 : -1)
  return next
}

function orderWords(dataset: CatalogDataset, definition: ReportDefinition): string {
  const sort = definition.orderBy?.[0]
  const parts = [
    sort ? `${fieldOf(dataset, sort.field)?.label ?? sort.field} · ${sort.direction === 'desc' ? 'Highest First' : 'Lowest First'}` : 'No Sort',
    definition.limit ? `First ${definition.limit.toLocaleString()}` : 'All Rows',
  ]
  if (definition.top) parts.push(`Top ${definition.top.n}`)
  return parts.join(' · ')
}

export function Builder({ dataset, definition, onChange }: { dataset: CatalogDataset; definition: ReportDefinition; onChange: (next: ReportDefinition) => void }) {
  const [ordering, setOrdering] = useState(false)
  const dims = dimensions(definition)
  const meas = measures(definition)
  const view = viewOf(definition)
  const placeable = dims.length > 1 && (view.type === 'pivot' || view.type === 'chart')
  const unused = (role: CatalogField['role']) => dataset.fields.filter((field) => field.role === role && !definition.columns.some((column) => column.field === field.key))
  const add = (key: string) => { const field = fieldOf(dataset, key); if (field) onChange(addField(definition, field)) }
  const sort = definition.orderBy?.[0]
  const card = (column: ReportColumn, list: ReportColumn[], index: number, control: ReactNode, under?: ReactNode) => {
    const field = fieldOf(dataset, column.field)
    const label = field?.label ?? column.label ?? column.field
    return (
      <BuilderCard key={column.field} cardKey={column.field} label={label} icon={iconOf(field)} control={control} under={under}
        multi={list.length > 1} first={index === 0} last={index === list.length - 1}
        onMove={(by) => onChange(moveField(definition, column.field, by))} onMoveTo={(dragged) => onChange(moveTo(definition, list, dragged, column.field))}
        onRemove={() => onChange(removeField(definition, column.field))} />
    )
  }
  return (
    <div aria-label="Builder" role="group" className="flex flex-col">
      <Section title="Show" question="What should the report count or add up?" onDropField={add}>
        {meas.length === 0
          ? <p className="mb-2 text-helper text-ink-800">Counting rows until you add a number.</p>
          : (
            <ul className="mb-1.5 flex flex-col gap-1.5">
              {meas.map((column, index) => {
                const field = fieldOf(dataset, column.field)
                const label = field?.label ?? column.field
                return card(column, meas, index,
                  <CalculationMenu dataset={dataset} definition={definition} column={column} field={field} label={label} onChange={onChange} />,
                  <Comparisons dataset={dataset} definition={definition} column={column} label={label} onChange={onChange} />)
              })}
            </ul>
          )}
        <AddPicker label="Add a Number" fields={unused('measure')} onPick={(field) => onChange(addField(definition, field))} />
      </Section>

      <Section title="Split By" question="How should it be broken down?" onDropField={add}>
        {dims.length > 0 && (
          <ul className="mb-1.5 flex flex-col gap-1.5">
            {dims.map((column, index) => {
              const field = fieldOf(dataset, column.field)
              const label = field?.label ?? column.field
              const bucket = field && field.buckets.length > 0 ? (
                <span className="w-32 shrink-0"><Select aria-label={`${label} bucket`} controlSize="sm" value={column.bucket ?? ''} onChange={(event) => onChange(setBucket(definition, column.field, (event.target.value || null) as never))}>
                  <option value="">As Is</option>{field.buckets.map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
                </Select></span>
              ) : undefined
              const across = view.across === column.field
              const place = placeable && (index > 0 || across) ? (
                <div className="flex items-center gap-2 pl-6 text-xs text-ink-800">
                  Put It
                  <SegmentedControl label={`Put ${label}`} value={across ? 'top' : 'side'} onChange={(value) => onChange(setAcross(definition, value === 'top' ? column.field : across ? null : view.across ?? null))}
                    options={[{ value: 'side', label: 'Down the Side' }, { value: 'top', label: 'Across the Top' }]} />
                </div>
              ) : undefined
              return card(column, dims, index, bucket, place)
            })}
          </ul>
        )}
        <AddPicker label="Add a Split" fields={unused('dimension')} onPick={(field) => onChange(addField(definition, field))} />
      </Section>

      <Section title="Only Include" question="Leave rows out, e.g. “Channel is Email”.">
        <FilterBuilder dataset={dataset} rules={rules(definition)} combinator={definition.filters?.combinator ?? 'and'} onChange={(next, combinator) => onChange(setRules(definition, next, combinator))} compact />
      </Section>

      <section aria-label="Order" className="px-4 py-3.5">
        <button type="button" aria-expanded={ordering} onClick={() => setOrdering((now) => !now)} className="flex w-full items-center gap-2 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-900">Order</span>
            <span className="block truncate text-helper text-ink-800">{orderWords(dataset, definition)}</span>
          </span>
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 text-ink-800 transition-transform ${ordering ? 'rotate-180' : ''}`} />
        </button>
        {ordering && (
          <div className="mt-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-helper text-ink-800">Sort By</span>
              <span className="min-w-0 flex-1"><Select aria-label="Sort by" controlSize="sm" value={sort?.field ?? ''} onChange={(event) => onChange(setSort(definition, event.target.value || null, sort?.direction ?? 'asc'))}>
                <option value="">No Sort</option>{definition.columns.map((column) => <option key={column.field} value={column.field}>{fieldOf(dataset, column.field)?.label ?? column.field}</option>)}
              </Select></span>
              <span className="w-32 shrink-0"><Select aria-label="Sort direction" controlSize="sm" value={sort?.direction ?? 'asc'} disabled={!sort} onChange={(event) => onChange(setSort(definition, sort?.field ?? null, event.target.value as 'asc' | 'desc'))}>
                <option value="asc">Lowest First</option><option value="desc">Highest First</option>
              </Select></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-helper text-ink-800">Show</span>
              <span className="min-w-0 flex-1"><Select aria-label="Limit" controlSize="sm" value={String(definition.limit ?? '')} onChange={(event) => onChange(setLimit(definition, Number(event.target.value) || undefined))}>
                <option value="">All Rows</option>{LIMITS.map((n) => <option key={n} value={n}>First {n.toLocaleString()}</option>)}
              </Select></span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-16 shrink-0 pt-1.5 text-helper text-ink-800">Values</span>
              <TopControl definition={definition} onChange={onChange} />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
