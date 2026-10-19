/**
 * A tooltip report: hovering a chart's value for a moment shows another report filtered to that value (the report's view names
 * it, view.tooltip; the editor's Tooltip Report picks one of the detail reports that take the chart's field). The card shows the
 * first rows of that report, under its name.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { Spinner } from '@/components/States'
import { insightsApi, useReport } from '../api'
import { formatCell } from './resultWords'

const WAIT_MS = 400
const ROWS = 6

export function TooltipReport({ reportId, field, value, valueWords, x }: { reportId: string; field: string; value: unknown; valueWords: string; x: number }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {                                      // a new value remounts the card (its key), so the wait starts again
    const timer = window.setTimeout(() => setReady(true), WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [])
  const report = useReport(ready ? reportId : undefined)
  const run = useQuery({ queryKey: ['insights', 'tooltip', reportId, field, value], queryFn: () => insightsApi.run(reportId, { limit: ROWS, through: [{ field, value }] }), enabled: ready, retry: false, staleTime: 60_000 })
  if (!ready) return null
  return (
    <div role="tooltip" data-tooltip-report className="pointer-events-none absolute top-10 z-30 w-80 rounded-lg border border-line bg-surface-overlay p-3 shadow-toast"
      style={{ left: Math.max(0, x - 160) }}>
      <p className="mb-2 text-xs font-semibold text-ink-900">{report.data?.name ?? 'Tooltip report'} · {valueWords}</p>
      {run.isPending ? <Spinner size="sm" label="Running" /> : run.isError ? <p className="text-xs text-ink-800">The tooltip report did not run.</p> : (
        <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{run.data.columns.map((c) => <th key={c.key} scope="col" className={`pb-1 font-semibold text-ink-800 ${c.aggregate ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr></thead>
          <tbody>
            {run.data.rows.slice(0, ROWS).map((row, r) => (
              <tr key={r} className="border-t border-line-subtle">{run.data.columns.map((c, i) => <td key={c.key} className={`py-1 text-ink-900 ${c.aggregate ? 'text-right' : ''}`}>{formatCell(c, row[i])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
