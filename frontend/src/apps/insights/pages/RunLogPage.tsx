/**
 * Insights → Run Log (docs/mockups/insights-admin-pages.html), for report administrators: every preview, run and export in the
 * workspace with how it went, over the last 7 or 30 days, the period's figures on top. Search, Period, Outcome and Person narrow
 * it (kept in the address); a run that did not go OK opens on its row to say why. Pages of 20, 50 or 100; Export CSV takes
 * every run the filters show.
 */
import { ChevronDown, Download } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { ClearFiltersLink, SelectFilter } from '@/components/FilterChip'
import { buttonSecondary } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { SearchField } from '@/components/SearchField'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { formatDateTime, formatNumber } from '@/lib/format'
import { useRunLog } from '../api'
import { downloadCsv } from '../components/csvFile'
import { listCardClass, listHeadClass, listRowClass, useListParams } from '../components/listParams'
import { PAGE_SIZES, rememberedSize } from '../components/paging'
import { Pager } from '../components/ResultGrid'
import type { RunLogEntry, RunOutcome } from '../types'

const PERIODS: { value: '7' | '30'; label: string }[] = [{ value: '7', label: '7 Days' }, { value: '30', label: '30 Days' }]
const OUTCOMES: { value: RunOutcome | ''; label: string }[] = [{ value: '', label: 'All Outcomes' }, { value: 'OK', label: 'OK' }, { value: 'TIMEOUT', label: 'Timed Out' }, { value: 'REFUSED', label: 'Refused' }, { value: 'FAILED', label: 'Failed' }]
const OUTCOME_WORDS: Record<RunOutcome, { label: string; tone: 'success' | 'error' | 'warning' }> = {
  OK: { label: 'OK', tone: 'success' }, TIMEOUT: { label: 'Timed Out', tone: 'error' }, REFUSED: { label: 'Refused', tone: 'warning' }, FAILED: { label: 'Failed', tone: 'error' },
}
const KIND: Record<string, string> = { preview: 'Preview', run: 'Run', export: 'Export', delivery: 'Delivery' }
const SIZE_KEY = 'insights.runs.rows'

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-36 flex-col rounded-md border border-line px-4 py-2.5">
      <span className="cep-num font-display text-section-title font-semibold text-ink-900">{value}</span>
      <span className="text-xs text-ink-800">{label}</span>
    </div>
  )
}

function exportRuns(runs: RunLogEntry[], days: string) {
  downloadCsv(`Run Log, last ${days} days`, ['When', 'Report', 'Dataset', 'Version', 'Kind', 'Who', 'Outcome', 'Why', 'Rows', 'Time (ms)'],
    runs.map((r) => [r.started_at, r.report_name ?? (r.report_id ? 'A deleted report' : 'A draft'), r.dataset_label ?? r.dataset, r.report_version, KIND[r.kind] ?? r.kind, r.user_name, OUTCOME_WORDS[r.outcome].label, r.outcome === 'OK' ? null : r.detail, r.row_count, r.duration_ms]))
}

export function RunLogPage() {
  const list = useListParams(['q', 'days', 'outcome', 'person'] as const, { days: '7' })
  const days: '7' | '30' = list.get('days') === '30' ? '30' : '7'
  const outcome = (OUTCOMES.find((o) => o.value && o.value === list.get('outcome'))?.value ?? '') as RunOutcome | ''
  const person = list.get('person')
  const q = list.get('q')
  const log = useRunLog({ days, outcome: outcome || undefined, user: person || undefined, q: q.trim() || undefined })
  const [open, setOpen] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(() => rememberedSize(SIZE_KEY))
  const summary = log.data?.summary
  const runs = log.data?.runs ?? []
  const pages = Math.max(1, Math.ceil(runs.length / size))
  const shownPage = Math.min(page, pages - 1)
  const pageRuns = runs.slice(shownPage * size, (shownPage + 1) * size)
  const resize = (next: number) => { setSize(next); setPage(0); try { window.localStorage.setItem(SIZE_KEY, String(next)) } catch { /* the default next visit */ } }
  const filter = (next: Parameters<typeof list.set>[0]) => { setPage(0); setOpen(null); list.set(next) }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Run Log" description="Every preview, run and export, with how it went." help={<PageHelp chapter="insights" />}
        actions={runs.length > 0 ? <button type="button" className={buttonSecondary} onClick={() => exportRuns(runs, days)}><Download size={16} strokeWidth={1.5} aria-hidden />Export CSV</button> : undefined} />
      {summary && (
        <div role="group" aria-label={`The last ${days} days`} className="flex flex-wrap gap-2.5">
          <Figure value={formatNumber(summary.runs)} label={`${summary.runs === 1 ? 'Run' : 'Runs'} in ${days} days`} />
          <Figure value={formatNumber(summary.timed_out)} label="Timed out" />
          <Figure value={formatNumber(summary.refused)} label="Refused" />
          <Figure value={formatNumber(summary.failed)} label="Failed" />
          <Figure value={summary.median_ms === null ? '—' : `${formatNumber(summary.median_ms)} ms`} label="Median time" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SearchField label="Search by report" value={q} onChange={(next) => filter({ q: next })} />
        <SelectFilter label="Period" options={PERIODS} value={days} defaultValue="7" showValue onChange={(next) => filter({ days: next })} />
        <SelectFilter label="Outcome" options={OUTCOMES} value={outcome} onChange={(next) => filter({ outcome: next })} />
        <SelectFilter label="Person" value={person} onChange={(next) => filter({ person: next })} options={[{ value: '', label: 'Anyone' }, ...(log.data?.people ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        {list.filtering && <ClearFiltersLink onClick={() => { setPage(0); list.clear() }} />}
      </div>
      {log.isPending ? <Spinner label="Loading the run log" /> : log.isError ? <ErrorState error={log.error} onRetry={() => log.refetch()} /> : runs.length === 0 ? (
        <EmptyState title="No Runs in This Period" hint="Previews, runs and exports show up here as people use Insights." />
      ) : (
        <div className={listCardClass}>
          <table className="w-full text-sm" aria-label="Runs">
            <thead>
              <tr className={listHeadClass}>
                <th className="px-3 py-2">When</th><th className="px-3 py-2">Report</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {pageRuns.map((run) => {
                const said = OUTCOME_WORDS[run.outcome]
                const why = run.outcome !== 'OK' && run.detail
                const isOpen = open === run.id
                return (
                  <Fragment key={run.id}>
                    <tr className={listRowClass}>
                      <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(run.started_at)}</td>
                      <td className="px-3 py-2">
                        {run.report_id ? <Link to={`/insights/reports/${run.report_id}`} className="font-medium text-ink-900 hover:underline">{run.report_name ?? 'A deleted report'}</Link> : <span className="font-medium text-ink-900">A draft</span>}
                        <span className="block text-xs text-ink-800">{run.dataset_label ?? run.dataset}{run.report_version ? ` · v${run.report_version}` : ''}</span>
                      </td>
                      <td className="px-3 py-2 text-ink-800">{KIND[run.kind] ?? run.kind}</td>
                      <td className="px-3 py-2 text-ink-800">{run.user_name ?? '—'}</td>
                      <td className="px-3 py-2">
                        {why ? (
                          <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : run.id)} className="inline-flex items-center gap-1 rounded-sm hover:opacity-80" aria-label={`${said.label}: show why`}>
                            <Tag tone={said.tone}>{said.label}</Tag><ChevronDown size={14} strokeWidth={1.5} aria-hidden className={`text-ink-800 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </button>
                        ) : <Tag tone={said.tone}>{said.label}</Tag>}
                      </td>
                      <td className="cep-num px-3 py-2 text-right text-ink-800">{run.row_count === null ? '—' : formatNumber(run.row_count)}</td>
                      <td className="cep-num px-3 py-2 text-right whitespace-nowrap text-ink-800">{run.duration_ms === null ? '—' : `${formatNumber(run.duration_ms)} ms`}</td>
                    </tr>
                    {isOpen && why && (
                      <tr className="bg-surface-subtle">
                        <td colSpan={7} className="px-3 py-2.5 text-sm text-ink-900">
                          <span className="font-semibold">Why:</span> {run.detail}
                          {run.report_id && <Link to={`/insights/reports/${run.report_id}`} className="ml-3 font-semibold text-brand-800 hover:underline">Open the Report</Link>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {runs.length > PAGE_SIZES[0] && <Pager page={shownPage} pages={pages} size={size} rows={runs.length} onPage={setPage} onSize={resize} />}
        </div>
      )}
    </div>
  )
}
