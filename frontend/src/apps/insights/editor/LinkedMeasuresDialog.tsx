/**
 * Linked Measures: add measures from a dataset this one is linked to (Messages and Attributed Orders share the campaign and
 * the channel, and the send date means the order date's period). Each side is totalled on its own by the report's groups,
 * so the report may group only by what both share. The platform team sets the links (back-office, Dataset Links).
 */
import { useState } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { Select, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import type { Aggregate, Blend, CatalogDataset, ReportDefinition } from '../types'
import { AGGREGATE_LABEL } from './definition'

export function LinkedMeasuresDialog({ dataset, definition, onApply, onClose }: { dataset: CatalogDataset; definition: ReportDefinition; onApply: (blend: Blend | null) => void; onClose: () => void }) {
  const links = dataset.links ?? []
  const [target, setTarget] = useState(definition.blend?.dataset ?? links[0]?.to ?? '')
  const link = links.find((item) => item.to === target)
  const start = definition.blend?.dataset === target ? definition.blend.columns : []
  const [picked, setPicked] = useState<Record<string, Aggregate>>(() => Object.fromEntries(start.map((c) => [c.field, c.aggregate])))
  const labelOf = (key: string) => dataset.fields.find((f) => f.key === key)?.label ?? key
  const shared = link ? [...link.pairs.map(([mine]) => labelOf(mine)), ...(link.time_pair ? [`${labelOf(link.time_pair[0])} by a period`] : [])] : []
  const groups = definition.columns.filter((c) => !c.aggregate)
  const sharedKeys = new Set([...(link?.pairs.map(([mine]) => mine) ?? [])])
  const unshared = groups.filter((c) => !sharedKeys.has(c.field) && !(link?.time_pair?.[0] === c.field && c.bucket))
  const choose = (next: string) => { setTarget(next); setPicked({}) }
  const columns = link ? link.measures.filter((m) => picked[m.key]).map((m) => ({ field: m.key, aggregate: picked[m.key] })) : []
  return (
    <Modal title="Linked Measures" subtitle={`Measures from a dataset linked to ${dataset.label}`} size="lg" onClose={onClose} scrollBody
      footer={(
        <div className="flex justify-between gap-2">
          <button type="button" className={buttonSecondary} onClick={() => onApply(null)} disabled={!definition.blend}>Remove All</button>
          <div className="flex gap-2">
            <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
            <button type="button" className={buttonPrimary} onClick={() => onApply(columns.length ? { dataset: target, columns } : null)}>Apply</button>
          </div>
        </div>
      )}>
      {links.length === 0 ? <p className="text-sm text-ink-800">{dataset.label} is not linked to another dataset.</p> : (
        <div className="flex flex-col gap-4">
          {links.length > 1 && (
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-900">Linked Dataset
              <Select value={target} onChange={(event) => choose(event.target.value)}>{links.map((item) => <option key={item.to} value={item.to}>{item.to_label}</option>)}</Select>
            </label>
          )}
          {link && (
            <>
              <p className="max-w-prose text-sm text-ink-800">
                {link.label}. Both share {shared.join(', ')}; the report may group only by these. Each side is totalled on its own, and filters on other fields apply to {dataset.label} only.
              </p>
              {unshared.length > 0 && (
                <p role="alert" className="text-sm text-danger-text">The report groups by {unshared.map((c) => labelOf(c.field)).join(', ')}, which {link.to_label} does not share. Remove {unshared.length === 1 ? 'it' : 'them'} first, or the preview is refused.</p>
              )}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold text-ink-900">From {link.to_label}</legend>
                {link.measures.map((measure) => (
                  <div key={measure.key} className="flex items-center justify-between gap-3">
                    <Checkbox label={measure.label} checked={Boolean(picked[measure.key])}
                      onChange={(event) => setPicked((now) => { const { [measure.key]: _gone, ...rest } = now; return event.target.checked ? { ...rest, [measure.key]: measure.aggregates[0] } : rest })} />
                    {picked[measure.key] && measure.aggregates.length > 1 && (
                      <span className="w-40"><Select aria-label={`${measure.label} total`} controlSize="sm" value={picked[measure.key]} onChange={(event) => setPicked((now) => ({ ...now, [measure.key]: event.target.value as Aggregate }))}>
                        {measure.aggregates.map((aggregate) => <option key={aggregate} value={aggregate}>{AGGREGATE_LABEL[aggregate]}</option>)}
                      </Select></span>
                    )}
                  </div>
                ))}
              </fieldset>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
