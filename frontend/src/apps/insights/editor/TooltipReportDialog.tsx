/**
 * Tooltip Report: the report a chart shows when someone rests the pointer on one of its values, filtered to that value. It is
 * one of the detail reports on the same dataset that take the chart's field along the bottom (a detail report says which fields
 * it can be opened through, in its own editor's Detail Report).
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { insightsApi } from '../api'

export function TooltipReportDialog({ dataset, field, fieldLabel, reportId, current, onApply, onClose }: {
  dataset: string; field: string; fieldLabel: string; reportId?: string; current?: string; onApply: (tooltip: string | undefined) => void; onClose: () => void
}) {
  const [picked, setPicked] = useState(current ?? '')
  const reports = useQuery({ queryKey: ['insights', 'reports', { dataset, detail_for: field }], queryFn: () => insightsApi.reports({ dataset, detail_for: field }) })
  const offered = (reports.data?.reports ?? []).filter((r) => r.id !== reportId)
  const choice = (selected: boolean) => `flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 ${selected ? 'border-brand-600 bg-brand-100/40' : 'border-line hover:bg-surface-hover'}`
  return (
    <Modal title="Tooltip Report" subtitle={`Shown on hover over a value of ${fieldLabel}`} onClose={onClose} size="picker"
      footer={<div className="flex justify-end gap-2"><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="button" className={buttonPrimary} onClick={() => onApply(picked || undefined)}>Apply</button></div>}>
      {reports.isPending ? <Spinner label="Finding detail reports" /> : reports.isError ? <ErrorState error={reports.error} onRetry={() => reports.refetch()} /> : (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Tooltip report</legend>
          <label className={choice(picked === '')}>
            <input type="radio" name="tooltip" value="" checked={picked === ''} onChange={() => setPicked('')} className="sr-only" />
            <span className="text-sm font-semibold text-ink-900">None</span><span className="text-xs text-ink-800">The chart's own tooltip only</span>
          </label>
          {offered.map((report) => (
            <label key={report.id} className={choice(picked === report.id)}>
              <input type="radio" name="tooltip" value={report.id} checked={picked === report.id} onChange={() => setPicked(report.id)} className="sr-only" />
              <span className="text-sm font-semibold text-ink-900">{report.name}</span><span className="text-xs text-ink-800">{report.owner_name ?? 'No owner'}</span>
            </label>
          ))}
          {offered.length === 0 && <p className="text-sm text-ink-800">No detail report takes {fieldLabel} yet. Open the report to show on hover, press Detail Report and tick {fieldLabel}.</p>}
        </fieldset>
      )}
    </Modal>
  )
}
