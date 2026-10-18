/**
 * A measure's time comparisons in the editor: each one a small token with a cross, and Add a Comparison with the ones
 * left. An option the report cannot take says why (no date in the report, or a measure that does not add up).
 */
import { X } from 'lucide-react'

import { Select, TextInput } from '@/components/Form'
import type { CatalogDataset, CompareKind, ReportColumn, ReportDefinition } from '../types'
import { compareOptions, MAX_COMPARISONS, setCompare, setTarget, TARGET_KINDS } from './definition'

export function CompareControl({ dataset, definition, column, onChange, label }: { dataset: CatalogDataset; definition: ReportDefinition; column: ReportColumn; onChange: (next: ReportDefinition) => void; label: string }) {
  const options = compareOptions(dataset, definition, column)
  const current = column.compare ?? []
  const left = options.filter((option) => !current.includes(option.kind))
  const words = (kind: CompareKind) => options.find((option) => option.kind === kind)?.label ?? kind
  return (
    <div className="flex flex-wrap items-center gap-1">
      {current.map((kind) => (
        <span key={kind} className="inline-flex h-6 items-center gap-1 rounded-sm bg-brand-100 px-1.5 text-[11px] font-semibold text-brand-800">
          {words(kind)}
          <button type="button" aria-label={`Remove ${words(kind)} from ${label}`} onClick={() => onChange(setCompare(definition, column.field, current.filter((k) => k !== kind)))} className="text-brand-800 hover:text-ink-900"><X size={11} strokeWidth={1.5} aria-hidden /></button>
        </span>
      ))}
      {current.some((kind) => TARGET_KINDS.includes(kind)) && (
        <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-800">
          Target
          <span className="w-24"><TextInput aria-label={`${label} target`} controlSize="sm" type="number" step="any" value={column.target ?? ''}
            onChange={(event) => onChange(setTarget(definition, column.field, event.target.value === '' ? undefined : Number(event.target.value)))} /></span>
        </label>
      )}
      {current.length < MAX_COMPARISONS && left.length > 0 && (
        <span className="w-44"><Select aria-label={`Add a comparison to ${label}`} controlSize="sm" value="" onChange={(event) => { if (event.target.value) onChange(setCompare(definition, column.field, [...current, event.target.value as CompareKind])) }}>
          <option value="">Add a Comparison</option>
          {left.map((option) => <option key={option.kind} value={option.kind} disabled={Boolean(option.reason)}>{option.reason ? `${option.label} (${option.reason})` : option.label}</option>)}
        </Select></span>
      )}
    </div>
  )
}
