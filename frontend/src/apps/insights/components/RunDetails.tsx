/**
 * AI Reports → Run Details (docs/mockups/ai-reports-page.html, option A): below the box, the prompt under way step by step and then
 * its outcome, and the earlier runs of this visit in a list that scrolls: when each started, how long it took, the tokens it used,
 * the model and what came of it, with its steps folded under Show Steps. Kept in the browser tab (sessionStorage), so a run is still
 * there after Open in Editor and back.
 */
import { Link } from 'react-router-dom'
import { useState, type ReactNode } from 'react'

import { Spinner } from '@/components/States'
import { Tag, type TagTone } from '@/components/StatusBadge'
import { formatNumber } from '@/lib/format'
import type { Run } from '../askRuns'
import type { AskResult, AskStep } from '../types'
import { AskProgress } from './AskProgress'

const OUTCOME: Record<AskResult['kind'], { label: string; tone: TagTone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, question: { label: 'Question', tone: 'warning' }, no_field: { label: 'No Field', tone: 'warning' }, failed: { label: 'Failed', tone: 'error' },
}
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

function facts(run: Run): string {
  const result = run.result
  return [clock.format(new Date(run.started_at)), result ? `${(result.duration_ms / 1000).toFixed(1)} s` : null,
    result?.tokens ? `${formatNumber(result.tokens.in)} tokens in, ${formatNumber(result.tokens.out)} out` : null, result?.model ?? null].filter(Boolean).join(' · ')
}

function outcomeOf(run: Run): { label: string; tone: TagTone } {
  if (run.report) return { label: 'Saved', tone: 'success' }
  if (run.failure) return { label: 'Failed', tone: 'error' }
  return run.result ? OUTCOME[run.result.kind] : { label: 'Running', tone: 'neutral' }
}

/** current: the prompt under way or just answered, with its live steps (or its result card as children) */
export function RunDetails({ runs, current, steps, elapsed, pending, children }: {
  runs: Run[]; current: string | null; steps: AskStep[] | undefined; elapsed: number | undefined; pending: boolean; children?: ReactNode
}) {
  const now = runs.find((run) => run.id === current) ?? null
  const earlier = runs.filter((run) => run.id !== current)
  return (
    <section aria-label="Run Details" className="flex flex-col rounded-lg border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line-subtle px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink-900">Run Details</h2>
        <span className="ml-auto text-xs text-ink-800">This visit</span>
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {!now && !earlier.length && <p className="text-xs text-ink-800">The steps of each prompt show here while it runs, and stay while this tab is open.</p>}
        {now && (
          <div className="flex flex-col gap-2" role={pending ? 'status' : undefined}>
            <p className="text-xs text-ink-800"><span className="font-semibold text-ink-900">{now.name || now.result?.name || 'New report'}</span> · {pending ? `started ${clock.format(new Date(now.started_at))}` : facts(now)}</p>
            {pending
              ? steps?.length ? <AskProgress steps={steps} elapsed={elapsed} /> : <p className="flex items-center gap-2 text-xs text-ink-800"><Spinner size="sm" /> Sending your prompt</p>
              : children}
          </div>
        )}
        {earlier.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Earlier This Visit</h3>
            <ol aria-label="Earlier runs" className="max-h-72 overflow-y-auto">
              {earlier.map((run) => <EarlierRun key={run.id} run={run} />)}
            </ol>
          </div>
        )}
      </div>
    </section>
  )
}

function EarlierRun({ run }: { run: Run }) {
  const [open, setOpen] = useState(false)
  const outcome = outcomeOf(run)
  const steps = run.result?.steps ?? []
  return (
    <li className="flex flex-col gap-1 border-t border-line-subtle py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium text-ink-900" title={run.prompt}>{run.report?.name ?? run.name ?? run.result?.name ?? run.prompt}</span>
        <Tag tone={outcome.tone}>{outcome.label}</Tag>
      </div>
      <p className="text-xs text-ink-800">
        {facts(run)}
        {run.report && <> · <Link to={`/insights/reports/${run.report.id}`} className="font-medium text-link hover:underline">Open Report</Link></>}
        {steps.length > 0 && <> · <button type="button" aria-expanded={open} onClick={() => setOpen((was) => !was)} className="font-medium text-link hover:underline">{open ? 'Hide Steps' : 'Show Steps'}</button></>}
      </p>
      {(run.failure || run.result?.message) && (
        <p className={`text-xs ${run.failure || run.result?.kind === 'failed' ? 'text-danger-text' : 'text-ink-800'}`}>{run.failure ?? run.result?.message}</p>
      )}
      {open && <AskProgress steps={steps} label="Steps taken" />}
    </li>
  )
}
