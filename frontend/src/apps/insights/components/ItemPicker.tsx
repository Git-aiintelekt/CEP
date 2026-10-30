/** Pick a report, or a dashboard too, from a searchable list: step 1 of New Schedule and New Alert on Insights → Scheduled. */
import { FileBarChart, LayoutGrid, Search } from 'lucide-react'
import { useState } from 'react'

import { ErrorState, Spinner } from '@/components/States'
import { useDashboards, useReports } from '../api'

export interface PickedItem { kind: 'report' | 'dashboard'; id: string; name: string }

export function ItemPicker({ value, onChange, dashboards = true }: { value: PickedItem | null; onChange: (item: PickedItem) => void; dashboards?: boolean }) {
  const [q, setQ] = useState('')
  const reports = useReports({})
  const boards = useDashboards()
  const term = q.trim().toLowerCase()
  const items: (PickedItem & { detail: string })[] = [
    ...(reports.data?.reports ?? []).map((r) => ({ kind: 'report' as const, id: r.id, name: r.name, detail: `Report · ${r.dataset_label}` })),
    ...(dashboards ? (boards.data?.dashboards ?? []).map((d) => ({ kind: 'dashboard' as const, id: d.id, name: d.name, detail: `Dashboard · ${d.tiles} tile${d.tiles === 1 ? '' : 's'}` })) : []),
  ].filter((item) => !term || item.name.toLowerCase().includes(term))
  const loading = reports.isPending || (dashboards && boards.isPending)
  return (
    <div className="flex flex-col gap-3">
      <label className="relative">
        <span className="sr-only">{dashboards ? 'Search reports and dashboards' : 'Search reports'}</span>
        <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-800" />
        <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder={dashboards ? 'Search reports and dashboards' : 'Search reports'} autoFocus
          className="h-10 w-full rounded-pill border border-transparent bg-surface-sunken pr-3 pl-9 text-sm text-ink-900 placeholder:text-ink-300 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
      </label>
      {loading ? <Spinner label="Loading" /> : reports.isError ? <ErrorState error={reports.error} onRetry={() => reports.refetch()} /> : (
        <ul aria-label={dashboards ? 'Reports and dashboards' : 'Reports'} className="flex flex-col overflow-hidden rounded-md border border-line">
          {items.length === 0 && <li className="p-4 text-center text-sm text-ink-800">Nothing matches “{q.trim()}”.</li>}
          {items.map((item) => {
            const on = value?.kind === item.kind && value.id === item.id
            const Icon = item.kind === 'dashboard' ? LayoutGrid : FileBarChart
            return (
              <li key={`${item.kind}:${item.id}`} className="border-t border-line-subtle first:border-t-0">
                <button type="button" aria-pressed={on} onClick={() => onChange({ kind: item.kind, id: item.id, name: item.name })}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${on ? 'bg-brand-100' : 'hover:bg-surface-hover'}`}>
                  <Icon size={16} strokeWidth={1.5} aria-hidden className={on ? 'text-brand-800' : 'text-ink-800'} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-900">{item.name}</span><span className="block text-xs text-ink-800">{item.detail}</span></span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** the picked item at the top of step 2, with Change back to step 1 */
export function PickedLine({ item, onChange }: { item: PickedItem; onChange?: () => void }) {
  const Icon = item.kind === 'dashboard' ? LayoutGrid : FileBarChart
  return (
    <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
      <Icon size={16} strokeWidth={1.5} aria-hidden className="text-brand-600" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-900">{item.name}</span><span className="block text-xs text-ink-800">{item.kind === 'dashboard' ? 'Dashboard' : 'Report'}</span></span>
      {onChange && <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={onChange}>Change</button>}
    </div>
  )
}
