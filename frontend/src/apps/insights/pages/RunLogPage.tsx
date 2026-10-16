/**
 * Insights → Run Log, for report administrators: every preview, run and export in the workspace with how it went,
 * over the last 7 or 30 days, by outcome and by person; a timed-out, refused or failed run shows its reason.
 */
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Select } from '@/components/Form'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { formatDateTime, formatNumber } from '@/lib/format'
import { useRunLog } from '../api'
import type { RunOutcome } from '../types'

const OUTCOMES: { value: RunOutcome | ''; label: string }[] = [{ value: '', label: 'All' }, { value: 'OK', label: 'OK' }, { value: 'TIMEOUT', label: 'Timed Out' }, { value: 'REFUSED', label: 'Refused' }, { value: 'FAILED', label: 'Failed' }]
const OUTCOME_WORDS: Record<RunOutcome, { label: string; tone: 'success' | 'error' | 'warning' }> = {
  OK: { label: 'OK', tone: 'success' }, TIMEOUT: { label: 'Timed Out', tone: 'error' }, REFUSED: { label: 'Refused', tone: 'warning' }, FAILED: { label: 'Failed', tone: 'error' },
}
const KIND: Record<string, string> = { preview: 'Preview', run: 'Run', export: 'Export', delivery: 'Delivery' }

export function RunLogPage() {
  const [days, setDays] = useState<'7' | '30'>('7')
  const [outcome, setOutcome] = useState<RunOutcome | ''>('')
  const [person, setPerson] = useState('')
  const [q, setQ] = useState('')
  const log = useRunLog({ days, outcome: outcome || undefined, user: person || undefined, q: q.trim() || undefined })
  const summary = log.data?.summary
  const words = summary ? `${formatNumber(summary.runs)} run${summary.runs === 1 ? '' : 's'} · ${summary.timed_out} timed out · ${summary.refused} refused · ${summary.failed} failed${summary.median_ms !== null ? ` · median ${formatNumber(summary.median_ms)} ms` : ''}` : undefined
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Run Log" description={words ?? 'Every preview, run and export, with how it went.'} help={<PageHelp chapter="insights" />} />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl label="Period" options={[{ value: '7', label: '7 Days' }, { value: '30', label: '30 Days' }]} value={days} onChange={setDays} />
        <div role="group" aria-label="Outcome" className="flex flex-wrap gap-1.5">
          {OUTCOMES.map((item) => (
            <button key={item.value} type="button" aria-pressed={outcome === item.value} onClick={() => setOutcome(item.value)}
              className={`h-7 rounded-control-md border px-2.5 text-xs font-semibold transition-colors ${outcome === item.value ? 'border-brand-100 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`}>{item.label}</button>
          ))}
        </div>
        <span className="w-44"><Select aria-label="Person" controlSize="sm" value={person} onChange={(event) => setPerson(event.target.value)}>
          <option value="">Anyone</option>
          {(log.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select></span>
        <label className="relative">
          <span className="sr-only">Search by report</span>
          <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search by report"
            className="h-8 w-52 rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
        </label>
      </div>
      {log.isPending ? <Spinner label="Loading the run log" /> : log.isError ? <ErrorState error={log.error} onRetry={() => log.refetch()} /> : log.data.runs.length === 0 ? (
        <EmptyState title="No Runs in This Period" hint="Previews, runs and exports show up here as people use Insights." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-sm" aria-label="Runs">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                <th className="px-3 py-2">When</th><th className="px-3 py-2">Report</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {log.data.runs.map((run) => {
                const said = OUTCOME_WORDS[run.outcome]
                return (
                  <tr key={run.id} className="border-t border-line-subtle">
                    <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(run.started_at)}</td>
                    <td className="px-3 py-2">
                      {run.report_id ? <Link to={`/insights/reports/${run.report_id}`} className="font-medium text-ink-900 hover:underline">{run.report_name ?? 'A deleted report'}</Link> : <span className="font-medium text-ink-900">A draft</span>}
                      <span className="block text-xs text-ink-800">{run.dataset_label ?? run.dataset}{run.report_version ? ` · v${run.report_version}` : ''}</span>
                    </td>
                    <td className="px-3 py-2 text-ink-800">{KIND[run.kind] ?? run.kind}</td>
                    <td className="px-3 py-2 text-ink-800">{run.user_name ?? '—'}</td>
                    <td className="px-3 py-2"><Tag tone={said.tone}>{said.label}</Tag>{run.detail && run.outcome !== 'OK' && <span className="block max-w-xs text-xs text-ink-800">{run.detail}</span>}</td>
                    <td className="cep-num px-3 py-2 text-right text-ink-800">{run.row_count === null ? '—' : formatNumber(run.row_count)}</td>
                    <td className="cep-num px-3 py-2 text-right whitespace-nowrap text-ink-800">{run.duration_ms === null ? '—' : `${formatNumber(run.duration_ms)} ms`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
