/**
 * An upload in numbers that add up, so it can be reconciled against its source:
 *   rows in the file = held back + ready;   ready = the governance lines;   after the import: ready = added + already in the list.
 * The governance lines are how a marketing email send would judge each contact today (same rules as the send engine).
 */
import { Download } from 'lucide-react'
import { useState } from 'react'

import { buttonSecondary } from '@/components/Form'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { ListImport, UploadSummary } from '@/lib/types'

import { problemText } from './problem'

function Line({ label, value, strong = false, indent = false, muted = false }: { label: string; value: number; strong?: boolean; indent?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 ${indent ? 'pl-4' : ''} ${strong ? 'font-semibold text-ink-900' : muted ? 'text-ink-500' : 'text-ink-700'}`}>
      <dt className="text-sm">{label}</dt>
      <dd className="cep-num text-sm">{formatNumber(value)}</dd>
    </div>
  )
}

export function GovernanceLines({ statuses, total, sendable }: { statuses: UploadSummary['governance']['statuses']; total: number; sendable: number }) {
  const shown = statuses.filter((line) => line.count > 0 || line.sendable)
  return (
    <div>
      <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-line-subtle" role="img" aria-label={`${formatNumber(sendable)} of ${formatNumber(total)} can receive marketing email today`}>
        <div className="bg-success" style={{ width: `${total ? (sendable * 100) / total : 0}%` }} />
        <div className="bg-warning" style={{ width: `${total ? ((total - sendable) * 100) / total : 0}%` }} />
      </div>
      <dl>
        {shown.map((line) => (
          <div key={line.code} className="flex items-baseline justify-between gap-4 py-1 text-sm">
            <dt className="flex items-center gap-2 text-ink-700">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${line.sendable ? 'bg-success' : 'bg-warning'}`} />
              {line.label}
            </dt>
            <dd className="cep-num text-ink-900">{formatNumber(line.count)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function UploadReport({ job }: { job: ListImport }) {
  const [problem, setProblem] = useState('')
  const summary = job.summary
  if (!summary) return null
  const { held_back: held, ready, governance, result } = summary

  const download = async () => {
    setProblem('')
    try {
      const blob = await api.download(`/contact-lists/${job.contact_list}/imports/${job.id}/report/`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${job.file_name.replace(/\.csv$/i, '')} - upload report.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setProblem(problemText(error))
    }
  }

  return (
    <section aria-label="Upload report" className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-line p-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-700">The file</h3>
          <dl>
            <Line label="Rows in the file" value={summary.rows} strong />
            <Line label="Held back" value={held.total} />
            {held.reasons.filter((reason) => reason.count > 0).map((reason) => <Line key={reason.code} label={reason.label} value={reason.count} indent muted />)}
            <Line label={result ? 'Imported' : 'Ready to import'} value={ready.total} strong />
            <Line label="New to CEP" value={ready.new} indent muted />
            <Line label="Already known" value={ready.existing} indent muted />
            {result && (
              <>
                <Line label="Added to the list" value={result.added} />
                <Line label="Already in the list" value={result.already_in_list} />
              </>
            )}
          </dl>
        </div>
        <div className="rounded-lg border border-line p-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-700">Governance check · marketing email, as of today</h3>
          <GovernanceLines statuses={governance.statuses} total={ready.total} sendable={governance.sendable} />
          {summary.mobile && (
            <p className="mt-2 border-t border-line-subtle pt-2 text-xs text-ink-500">
              Text messages: {formatNumber(summary.mobile.with_number)} with a usable mobile number, {formatNumber(summary.mobile.blocked)} of them blocked (STOP reply or do-not-disturb registry).
            </p>
          )}
        </div>
      </div>
      <p className={`text-xs ${summary.balanced ? 'text-ink-500' : 'font-medium text-danger-plain'}`}>
        {summary.balanced
          ? `${formatNumber(summary.rows)} rows = ${formatNumber(held.total)} held back + ${formatNumber(ready.total)} ${result ? 'imported' : 'ready'}. Of those ${formatNumber(ready.total)}, ${formatNumber(governance.sendable)} can receive marketing email today and ${formatNumber(governance.not_sendable)} cannot${result ? `; ${formatNumber(result.added)} were added to the list and ${formatNumber(result.already_in_list)} were in it already` : ''}.`
          : 'These numbers do not add up. Download the row-by-row report and tell support.'}
        {' '}Everyone ready is imported whatever their status: the list is the audience, and every send checks again.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonSecondary} onClick={() => void download()}>
          <Download size={16} strokeWidth={1.5} aria-hidden /> Download the row-by-row report
        </button>
        {problem && <span role="alert" className="text-sm font-medium text-danger-plain">{problem}</span>}
      </div>
    </section>
  )
}
