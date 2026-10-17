/**
 * The dashboard's slicers, under the period: one filter chip per slicer (a dimension of the tiles' datasets) whose menu
 * offers the field's values over the period, with a search; picking values narrows every tile whose dataset has the
 * field. A cross-filter (a value clicked on a tile whose field is not a saved slicer) appears as a chip with a cross.
 * Editing a dashboard, the bar lists the saved slicers with a cross each and Add Slicer with the dimensions to choose from.
 */
import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@/components/Button'
import { FilterChip, MultiSelectMenu } from '@/components/FilterChip'
import { Select } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import type { DashboardSlicer, SlicerCandidate, SlicerSelection, SlicerValues } from '../types'
import { MAX_SLICERS, slicerWords, valueWords } from './layout'

export function SlicerBar({ slicers, selection, onChange, extra = [], onRemoveExtra, loadValues, queryKey }: {
  slicers: DashboardSlicer[]
  selection: SlicerSelection
  onChange: (field: string, values: unknown[]) => void
  /** cross-filters on fields that are not saved slicers; each can be taken off */
  extra?: DashboardSlicer[]
  onRemoveExtra?: (field: string) => void
  loadValues: (field: string) => Promise<SlicerValues>
  /** the query key the values are cached under, the period included */
  queryKey: readonly unknown[]
}) {
  const all = [...slicers, ...extra]
  if (all.length === 0) return null
  const picked = all.filter((slicer) => (selection[slicer.field] ?? []).length > 0)
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Slicers">
      {all.map((slicer) => (
        <span key={slicer.field} className="inline-flex items-center gap-1">
          <SlicerChip slicer={slicer} values={selection[slicer.field] ?? []} onChange={(values) => onChange(slicer.field, values)} loadValues={loadValues} queryKey={queryKey} />
          {extra.some((item) => item.field === slicer.field) && onRemoveExtra && <IconButton label={`Remove the ${slicer.label} filter`} icon={X} size="xs" onClick={() => onRemoveExtra(slicer.field)} />}
        </span>
      ))}
      {picked.length > 0 && (
        <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={() => picked.forEach((slicer) => onChange(slicer.field, []))}>Clear</button>
      )}
    </div>
  )
}

function SlicerChip({ slicer, values, onChange, loadValues, queryKey }: { slicer: DashboardSlicer; values: unknown[]; onChange: (values: unknown[]) => void; loadValues: (field: string) => Promise<SlicerValues>; queryKey: readonly unknown[] }) {
  return (
    <FilterChip label={slicerWords(slicer, values)} active={values.length > 0} menuLabel={`${slicer.label} values`} menuWidth={280}>
      {({ close }) => <SlicerMenu slicer={slicer} values={values} onApply={(next) => { onChange(next); close() }} loadValues={loadValues} queryKey={queryKey} />}
    </FilterChip>
  )
}

/** the menu's body, mounted only while the chip is open, so the values are read when first asked for */
function SlicerMenu({ slicer, values, onApply, loadValues, queryKey }: { slicer: DashboardSlicer; values: unknown[]; onApply: (values: unknown[]) => void; loadValues: (field: string) => Promise<SlicerValues>; queryKey: readonly unknown[] }) {
  const query = useQuery({ queryKey: [...queryKey, 'slicer', slicer.field], queryFn: () => loadValues(slicer.field), staleTime: 60_000 })
  if (query.isPending) return <div className="p-3"><Spinner size="sm" label={`Loading ${slicer.label} values`} /></div>
  if (query.isError) return <div className="p-3"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div>
  const offered = query.data.values
  const options = [...offered, ...values.filter((value) => !offered.some((item) => String(item) === String(value)))]   // a value picked by a click stays offered even when the period no longer has it
  const raw = new Map(options.map((value) => [String(value), value]))
  return (
    <MultiSelectMenu label={slicer.label} searchLabel={`Search ${slicer.label}`} options={options.map((value) => ({ value: String(value), label: valueWords(value) }))}
      value={values.map(String)} onApply={(next) => onApply(next.map((key) => raw.get(key) ?? key))}
      note={offered.length >= 200 ? 'The first 200 values of the period' : undefined} />
  )
}

/** Editing: the saved slicers with a cross each, and Add Slicer over the dimensions the tiles' datasets share. */
export function SlicerEditor({ slicers, candidates, onChange }: { slicers: DashboardSlicer[]; candidates: SlicerCandidate[]; onChange: (slicers: DashboardSlicer[]) => void }) {
  const [adding, setAdding] = useState(false)
  const left = candidates.filter((candidate) => !slicers.some((slicer) => slicer.field === candidate.field))
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Slicers">
      <span className="text-xs text-ink-800">Slicers</span>
      {slicers.length === 0 && !adding && <span className="text-xs text-ink-700">None yet. A slicer filters every tile by one of their dimensions.</span>}
      {slicers.map((slicer) => (
        <span key={slicer.field} className="inline-flex h-8 items-center gap-1 rounded-control-md border border-line bg-surface pr-1 pl-3 text-sm text-ink-900">
          {slicer.label}
          <IconButton label={`Remove the ${slicer.label} slicer`} icon={X} size="xs" onClick={() => onChange(slicers.filter((item) => item.field !== slicer.field))} />
        </span>
      ))}
      {adding ? (
        <span className="w-56"><Select aria-label="Slicer field" controlSize="sm" value="" autoFocus onChange={(event) => {
          const candidate = left.find((item) => item.field === event.target.value)
          if (candidate) onChange([...slicers, { field: candidate.field, label: candidate.label }])
          setAdding(false)
        }} onBlur={() => setAdding(false)}>
          <option value="">Choose a dimension</option>
          {left.map((candidate) => <option key={candidate.field} value={candidate.field}>{candidate.label}{candidate.datasets.length > 1 ? ` · ${candidate.datasets.length} datasets` : ''}</option>)}
        </Select></span>
      ) : (
        <button type="button" disabled={left.length === 0 || slicers.length >= MAX_SLICERS} onClick={() => setAdding(true)}
          className="inline-flex h-8 items-center gap-1 rounded-control-md border border-dashed border-line-control px-2.5 text-sm font-semibold text-ink-800 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
          <Plus size={14} strokeWidth={1.5} aria-hidden />Add Slicer
        </button>
      )}
      {left.length === 0 && candidates.length === 0 && slicers.length === 0 && <span className="text-xs text-ink-700">Add a tile first.</span>}
    </div>
  )
}
