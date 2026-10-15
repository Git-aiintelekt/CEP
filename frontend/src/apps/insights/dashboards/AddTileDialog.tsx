/**
 * Add Tile, two steps: pick one of the reports you can open, then how to show it: one of its views, or one of its
 * totalled columns as a figure, and the title on the dashboard.
 */
import { Search } from 'lucide-react'
import { useState } from 'react'

import { buttonPrimary, buttonSecondary, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useCatalog, useReport, useReports } from '../api'
import { AGGREGATE_LABEL } from '../editor/definition'
import type { DashboardTile, ReportSummary, TileShow, ViewType } from '../types'
import { SHOW_LABEL } from './layout'

const VIEWS: { value: ViewType; hint: string }[] = [
  { value: 'grid', hint: 'The rows, as saved' }, { value: 'chart', hint: 'The first dimension along the bottom' },
  { value: 'hierarchy', hint: 'Groups that fold, with subtotals' }, { value: 'pivot', hint: 'Needs a dimension across' },
]

export function AddTileDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (tile: Omit<DashboardTile, 'id'>) => void }) {
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<ReportSummary | null>(null)
  const [show, setShow] = useState<TileShow>('grid')
  const [measure, setMeasure] = useState<string>('')
  const [title, setTitle] = useState('')
  const reports = useReports({ q: q.trim() || undefined })
  const report = useReport(chosen?.id)
  const catalog = useCatalog()
  const dataset = catalog.data?.datasets.find((d) => d.key === chosen?.dataset)
  const measures = (report.data?.definition.columns ?? []).filter((column) => column.aggregate).map((column) => ({
    key: column.field, label: column.label ?? dataset?.fields.find((f) => f.key === column.field)?.label ?? column.field, aggregate: column.aggregate as keyof typeof AGGREGATE_LABEL,
  }))
  const ready = chosen && (show !== 'figure' || measure)

  function add() {
    if (!chosen || !ready) return
    onAdd({ report_id: chosen.id, show, title: title.trim() || undefined, ...(show === 'figure' ? { measure } : {}) })
  }

  return (
    <Modal title="Add Tile" subtitle={chosen ? `Step 2 of 2 · ${chosen.name}` : 'Step 1 of 2 · Pick a report'} onClose={onClose} size="picker"
      footer={(
        <div className="flex justify-end gap-2">
          {chosen ? <button type="button" className={buttonSecondary} onClick={() => setChosen(null)}>Back</button> : <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>}
          {chosen && <button type="button" className={buttonPrimary} onClick={add} disabled={!ready}>Add to Dashboard</button>}
        </div>
      )}>
      {!chosen ? (
        <div className="flex flex-col gap-3">
          <label className="relative">
            <span className="sr-only">Search reports</span>
            <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
            <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search reports" autoFocus
              className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
          </label>
          {reports.isPending ? <Spinner label="Loading the reports" /> : reports.isError ? <ErrorState error={reports.error} onRetry={() => reports.refetch()} /> : (
            <ul aria-label="Reports" className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {reports.data.reports.length === 0 && <li className="p-3 text-center text-sm text-ink-800">No report matches.</li>}
              {reports.data.reports.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => { setChosen(item); setShow(item.view_type); setTitle('') }}
                    className="flex w-full items-center gap-3 rounded-md border border-line px-3 py-2 text-left hover:bg-surface-hover">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-900">{item.name}</span><span className="block text-xs text-ink-800">{item.dataset_label} · {item.owner_name ?? 'no owner'}</span></span>
                    <Tag tone="brand">{SHOW_LABEL[item.view_type]}</Tag>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink-900">Show it as</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {VIEWS.map((view) => (
                <label key={view.value} className={choice(show === view.value)}>
                  <input type="radio" name="show" value={view.value} checked={show === view.value} onChange={() => setShow(view.value)} className="sr-only" />
                  <span className="text-sm font-semibold">{SHOW_LABEL[view.value]}</span><span className="text-xs text-ink-800">{view.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink-900">Or one figure</legend>
            {report.isPending ? <Spinner label="Loading the report" /> : measures.length === 0 ? <p className="text-sm text-ink-800">This report has no totalled column to show as a figure.</p> : (
              <div className="grid gap-2 sm:grid-cols-3">
                {measures.map((item) => (
                  <label key={item.key} className={choice(show === 'figure' && measure === item.key)}>
                    <input type="radio" name="show" value={`figure:${item.key}`} checked={show === 'figure' && measure === item.key} onChange={() => { setShow('figure'); setMeasure(item.key) }} className="sr-only" />
                    <span className="text-sm font-semibold">{item.label}</span><span className="text-xs text-ink-800">{AGGREGATE_LABEL[item.aggregate]} over the period</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-ink-900">Title on the dashboard</span>
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder={chosen.name} maxLength={100} />
          </label>
        </div>
      )}
    </Modal>
  )
}

function choice(on: boolean): string {
  return `flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 transition-colors ${on ? 'border-brand-600 bg-brand-100/40' : 'border-line bg-surface hover:bg-surface-hover'}`
}
