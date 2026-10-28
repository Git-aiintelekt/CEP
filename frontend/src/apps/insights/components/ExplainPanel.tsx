/**
 * Explain, two tabs (docs/mockups/executive-explain-free.html, option D1). What This Means, the default: the report judged by rules
 * against the workspace's benchmarks, the reasons from the related reports and what to do; free, instant and the same each time,
 * so it shows in every workspace. What the Rows Show: the AI's sentences on the rows, when the workspace allows it; asked for only
 * when the tab is opened, as it counts as one prompt.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { Copy, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { IconButton } from '@/components/Button'
import { buttonClass } from '@/components/buttonStyles'
import { Spinner } from '@/components/States'
import { Tabs } from '@/components/Tabs'
import { tabPanelId } from '@/components/tabIds'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { insightsApi, keys } from '../api'
import type { Explanation, Meaning, MeaningBand, ParameterValues } from '../types'
import { figureNote, meaningNumber, meaningText } from './meaningWords'

type Tab = 'meaning' | 'rows'
const smallButton = buttonClass({ variant: 'secondary', size: 'sm' })

const TONE: Record<MeaningBand | 'none', string> = {
  good: 'bg-success-bg text-success-text',
  watch: 'bg-warning-bg text-warning-text',
  act: 'bg-danger-bg text-danger-text',
  none: 'bg-fill-subtle text-ink-800',
}

function problemOf(error: Error | null): string | null {
  if (!error) return null
  return error instanceof ApiError ? error.problem?.detail ?? error.message : error.message
}

function Chip({ tone, children }: { tone: MeaningBand | 'none'; children: string }) {
  return <span className={`inline-flex h-6 shrink-0 items-center rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${TONE[tone]}`}>{children}</span>
}

function sourceWords(meaning: Meaning): string {
  const parts = [`${meaning.read.reports} ${meaning.read.reports === 1 ? 'report' : 'reports'}`]
  const earlier = meaning.read.earlier
  if (earlier) parts.push(`the ${earlier.campaigns === 1 ? 'campaign' : `${earlier.campaigns} campaigns`} before (${earlier.from} to ${earlier.to})`)
  parts.push(meaning.read.benchmarks ? `${meaning.read.benchmarks} ${meaning.read.benchmarks === 1 ? 'benchmark' : 'benchmarks'}` : 'no benchmarks')
  return `Written by rules from ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]} · instant`
}

function MeaningView({ reportId, reportName, params, meaning }: { reportId: string; reportName: string; params?: ParameterValues; meaning: Meaning }) {
  const toast = useToast()
  const failed = useMutation({
    mutationFn: () => insightsApi.failedCsv(reportId, params),
    onSuccess: (blob) => {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'Hard-failed addresses.csv'
      link.click()
      URL.revokeObjectURL(link.href)
    },
    onError: (error) => toast.failure(error, 'The addresses were not exported'),
  })
  const ask = params && Object.keys(params).length ? `?ask=${encodeURIComponent(JSON.stringify(params))}` : ''
  const copy = () => {
    const done = () => toast.success('Copied', 'Paste it into an email.')
    const refused = () => toast.failure(new Error('The browser did not allow copying.'), 'Not copied')
    if (!navigator.clipboard) return refused()
    navigator.clipboard.writeText(meaningText(reportName, meaning)).then(done, refused)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 text-sm">
        <Chip tone={meaning.verdict.tone}>{meaning.verdict.chip}</Chip>
        <p className="max-w-prose text-ink-900"><span className="font-semibold">{meaning.verdict.title}</span>{meaning.verdict.summary ? ` ${meaning.verdict.summary}` : ''}</p>
      </div>
      {meaning.figures.length > 0 && (
        <ul aria-label="Figures" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {meaning.figures.map((figure) => (
            <li key={figure.key} className="flex flex-col gap-0.5 rounded-md border border-line-subtle bg-surface px-3 py-2.5">
              <span className="text-xs text-ink-800">{figure.label}</span>
              <span className="cep-num text-kpi font-semibold text-ink-900">{figure.estimated ? '≈ ' : ''}{meaningNumber(figure.value, figure.format)}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-800">
                {figure.words && <Chip tone={figure.state === 'judged' && figure.band ? figure.band : 'none'}>{figure.words}</Chip>}
                {figureNote(figure)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {meaning.reasons.length > 0 && (
        <section aria-label="Why" className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-ink-700 uppercase">Why</h3>
          <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5 text-button text-ink-900">
            {meaning.reasons.map((reason, index) => (
              <li key={index}>{reason.text}{reason.report && <> <Link className="font-semibold text-link hover:underline" to={`/insights/reports/${reason.report.id}${ask}`}>{reason.report.name}</Link></>}</li>
            ))}
          </ul>
        </section>
      )}
      {meaning.actions.length > 0 && (
        <section aria-label="Do Next" className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-ink-700 uppercase">Do Next</h3>
          <ol className="flex flex-col gap-2">
            {meaning.actions.map((action, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2.5 rounded-md border border-line-subtle bg-surface px-2.5 py-2 text-button text-ink-900">
                <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-on-brand">{index + 1}</span>
                <span className="min-w-0 flex-1">{action.text}</span>
                {action.kind === 'export_failed' ? (
                  <button type="button" className={smallButton} onClick={() => failed.mutate()} disabled={failed.isPending}>{failed.isPending ? 'Exporting…' : action.label}</button>
                ) : action.report && (
                  <Link className={smallButton} to={`/insights/reports/${action.report.id}${ask}`}>{action.label}</Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {meaning.notes.map((note) => <p key={note} className="text-helper text-ink-800">{note}{meaning.can_set && <> <Link className="font-semibold text-link hover:underline" to="/insights/benchmarks">Set a Benchmark</Link></>}</p>)}
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-700">
        <span className="inline-flex h-5 items-center rounded-sm bg-success-bg px-1.5 font-semibold text-success-text">Free · No AI</span>
        <span>{sourceWords(meaning)}</span>
        <span className="flex-1" />
        <button type="button" className="inline-flex items-center gap-1 font-semibold text-link hover:underline" onClick={copy}><Copy size={14} strokeWidth={1.5} aria-hidden />Copy as Email</button>
      </div>
    </div>
  )
}

function RowsView({ pending, error, explanation, onRetry }: { pending: boolean; error: string | null; explanation: Explanation | null; onRetry: () => void }) {
  if (pending) return <Spinner label="Reading the rows" />
  if (error) return <p role="alert" className="text-sm text-danger-text">{error} <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={onRetry}>Try Again</button></p>
  if (!explanation) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-prose text-sm text-ink-900">{explanation.summary}</p>
      {explanation.points.length > 0 && (
        <ul className="flex max-w-prose list-disc flex-col gap-1 pl-5 text-sm text-ink-900">
          {explanation.points.map((point, index) => <li key={index}>{point}</li>)}
        </ul>
      )}
      {explanation.caution && <p className="max-w-prose text-xs text-ink-800">{explanation.caution}</p>}
      <p className="text-xs text-ink-700">
        {explanation.model ? `Written by ${explanation.model.label} from ${explanation.rows_sent ?? 0} ${explanation.rows_sent === 1 ? 'row' : 'rows'}` : 'Written from the rows'}
        {explanation.left_out?.length ? `, without ${explanation.left_out.join(', ')}` : ''}. Check the figures before you act on them.
      </p>
    </div>
  )
}

export function ExplainPanel({ reportId, reportName, params, ai, onClose }: {
  reportId: string
  reportName: string
  params?: ParameterValues
  /** the AI's explanation, when the workspace allows it: asked for when its tab is first opened */
  ai: { explain: () => void; pending: boolean; error: Error | null; explanation: Explanation | null; asked: boolean } | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('meaning')
  const meaning = useQuery({ queryKey: keys.meaning(reportId, params), queryFn: () => insightsApi.meaning(reportId, params), retry: false, staleTime: 60_000 })
  const open = (next: Tab) => { setTab(next); if (next === 'rows' && ai && !ai.asked) ai.explain() }

  return (
    <section aria-label="Explanation" className="flex flex-col gap-3 rounded-md border border-line bg-surface-subtle px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-button font-semibold text-ink-900"><Sparkles size={16} strokeWidth={1.5} aria-hidden className="text-plum-700" />Explain</h2>
        <IconButton label="Close the explanation" icon={X} size="xs" onClick={onClose} />
      </div>
      {ai && (
        <div className="border-b border-line-subtle">
          <Tabs label="Explain" idPrefix="explain" size="sm" value={tab} onChange={open} tabs={[{ id: 'meaning', label: 'What This Means' }, { id: 'rows', label: 'What the Rows Show' }]} />
        </div>
      )}
      <div role={ai ? 'tabpanel' : undefined} id={ai ? tabPanelId('explain', tab) : undefined}>
        {tab === 'rows' && ai ? <RowsView pending={ai.pending} error={problemOf(ai.error)} explanation={ai.explanation} onRetry={ai.explain} /> : (
          meaning.isPending ? <Spinner label="Reading the figures" /> : meaning.isError ? (
            <p role="alert" className="text-sm text-danger-text">{problemOf(meaning.error)} <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => meaning.refetch()}>Try Again</button></p>
          ) : <MeaningView reportId={reportId} reportName={reportName} params={params} meaning={meaning.data} />
        )}
      </div>
    </section>
  )
}
