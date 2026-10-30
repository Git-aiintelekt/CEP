/**
 * The editor's Data pane (docs/mockups/report-editor-workspace.html): the data the report reads, a search, and its fields
 * in four groups, Dimensions, Measures, the report's Custom Fields and its Linked Measures (when the data has links). A
 * field already in the report says In Use; any other one shows a + on hover and goes where it belongs when clicked, or
 * can be dragged. Custom fields and linked measures are made and changed in their own dialogs, opened from here. The pane
 * folds to a 48px strip (the editor folds it in a narrow window), so the canvas keeps its room.
 */
import { Calendar, Database, Hash, Link2, PanelLeftClose, PanelLeftOpen, Plus, Search, Sigma, ToggleLeft, Type } from 'lucide-react'
import { useState, type DragEvent, type ReactNode } from 'react'

import type { CatalogDataset, CatalogField, ReportDefinition } from '../types'
import { addField, inUse } from './definition'
import { SharedFieldMark } from './SharedFieldMark'

const TYPE_ICON = { string: Type, number: Hash, date: Calendar, datetime: Calendar, boolean: ToggleLeft } as const

function FieldRow({ field, used, onAdd }: { field: CatalogField; used: boolean; onAdd: () => void }) {
  const Icon = field.custom ? Sigma : TYPE_ICON[field.type]
  return (
    <li>
      <button type="button" draggable={!used} onDragStart={(event: DragEvent) => event.dataTransfer.setData('text/x-field', field.key)} onClick={onAdd} disabled={used}
        aria-label={`${field.label}${used ? ', in use' : ', add'}`}
        className={`group flex h-8 w-full items-center gap-2 px-4 text-left text-sm transition-colors ${used ? 'font-medium text-brand-800' : 'cursor-grab text-ink-900 hover:bg-surface-hover'}`}>
        <Icon size={14} strokeWidth={1.5} aria-hidden className={`shrink-0 ${used ? 'text-brand-800' : 'text-ink-800'}`} />
        <span className="min-w-0 flex-1 truncate">{field.label}</span>
        <SharedFieldMark field={field} />
        {field.sensitivity === 'PII' && <span className="shrink-0 text-xs font-semibold text-ink-700 group-hover:hidden">PII</span>}
        {used
          ? <span className="shrink-0 text-xs font-semibold text-brand-800">In Use</span>
          : <Plus size={14} strokeWidth={1.5} aria-hidden className="hidden shrink-0 text-brand-600 group-hover:block" />}
      </button>
    </li>
  )
}

function Group({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="flex items-center px-4 pt-3.5 pb-1 text-sm font-semibold text-ink-900">
        {title}
        {onAdd && (
          <button type="button" aria-label={addLabel} title={addLabel} onClick={onAdd} className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-sm text-brand-600 hover:bg-brand-100">
            <Plus size={14} strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

const footLink = 'inline-flex h-7 items-center gap-1.5 text-helper font-medium text-brand-600 hover:underline'

export function DataPane({ dataset, base, definition, onChange, onCustom, onLink, folded = false, onFold }: {
  /** the report's data with its custom fields among the fields */
  dataset: CatalogDataset
  /** the data as the catalogue has it: its links name the linked measures */
  base: CatalogDataset
  definition: ReportDefinition
  onChange: (next: ReportDefinition) => void
  onCustom: () => void
  /** set when the data has links */
  onLink?: () => void
  folded?: boolean
  /** set when the pane can fold */
  onFold?: (folded: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const shown = dataset.fields.filter((field) => !term || field.label.toLowerCase().includes(term))
  const row = (field: CatalogField) => <FieldRow key={field.key} field={field} used={inUse(definition, field.key)} onAdd={() => onChange(addField(definition, field))} />
  const dims = shown.filter((field) => field.role === 'dimension' && !field.custom)
  const meas = shown.filter((field) => field.role === 'measure' && !field.custom)
  const customs = shown.filter((field) => field.custom)
  const link = base.links?.find((l) => l.to === definition.blend?.dataset)
  const linked = (definition.blend?.columns ?? []).map((column) => ({ key: column.field, label: column.label ?? link?.measures.find((m) => m.key === column.field)?.label ?? column.field, from: link?.to_label }))
    .filter((measure) => !term || measure.label.toLowerCase().includes(term))
  const nothing = term && dims.length + meas.length + customs.length + linked.length === 0
  if (folded && onFold) {
    return (
      <aside aria-label="Fields" className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-line bg-surface pt-3">
        <button type="button" aria-label="Show Fields" title="Show Fields" onClick={() => onFold(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-800 hover:bg-surface-hover">
          <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden />
        </button>
        <Database size={16} strokeWidth={1.5} aria-hidden className="text-brand-600" />
      </aside>
    )
  }
  return (
    <aside aria-label="Fields" className="flex min-h-0 w-62 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex flex-col gap-2.5 border-b border-line-subtle px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-ink-800">Data</p>
          {onFold && (
            <button type="button" aria-label="Hide Fields" title="Hide Fields" onClick={() => onFold(true)} className="-mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-800 hover:bg-surface-hover">
              <PanelLeftClose size={14} strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-900"><Database size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-brand-600" />{dataset.label}</p>
          {dataset.description && <p className="text-xs text-ink-800">{dataset.description}</p>}
        </div>
        <label className="relative">
          <span className="sr-only">Search fields</span>
          <Search size={14} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-800" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search fields"
            className="h-8 w-full rounded-pill border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-300 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {nothing ? <p className="px-4 pt-4 text-sm text-ink-800">No fields match “{search.trim()}”.</p> : (
          <>
            {dims.length > 0 && <Group title="Dimensions">{dims.map(row)}</Group>}
            {meas.length > 0 && <Group title="Measures">{meas.map(row)}</Group>}
            {(customs.length > 0 || !term) && (
              <Group title="Custom Fields" onAdd={onCustom} addLabel="Add a Custom Field">
                {customs.map(row)}
              </Group>
            )}
            {onLink && (linked.length > 0 || !term) && (
              <Group title="Linked Measures" onAdd={onLink} addLabel="Add a Linked Measure">
                {linked.map((measure) => (
                  <li key={measure.key} className="flex h-8 items-center gap-2 px-4 text-sm font-medium text-brand-800">
                    <Link2 size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate" title={measure.from ? `From ${measure.from}` : undefined}>{measure.label}</span>
                    <span className="shrink-0 text-xs font-semibold">In Use</span>
                  </li>
                ))}
              </Group>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col items-start gap-0.5 border-t border-line-subtle px-4 py-2.5">
        <button type="button" className={footLink} onClick={onCustom}><Sigma size={14} strokeWidth={1.5} aria-hidden />New Custom Field</button>
        {onLink && <button type="button" className={footLink} onClick={onLink}><Link2 size={14} strokeWidth={1.5} aria-hidden />Link a Measure</button>}
      </div>
    </aside>
  )
}
