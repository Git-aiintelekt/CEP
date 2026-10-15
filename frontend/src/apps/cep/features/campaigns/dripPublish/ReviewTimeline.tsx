/** Test & Publish, Review Timeline: each message's day and time, subject and the backend's warnings (GET steps/review/), one line each. */
import { TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Column } from '@/components/DataTable'
import { DataTable } from '@/components/DataTable'
import { SkeletonLine } from '@/components/States'
import type { DripReview, DripStep } from '@/lib/types'

import { whenInZone, type Series } from '../dripSequence'
import { reviewSummary } from './summary'
import { CardError, DetailCard } from '../parts'
import { sequenceHref } from '../sequence/dripEditor'

type Row = DripReview['messages'][number]

export function ReviewTimeline({ campaignId, review, steps, series, error, onRetry }: {
  campaignId: string; review: DripReview | undefined; steps: DripStep[]; series: Series; error: unknown; onRetry: () => void
}) {
  const abOf = new Set(steps.filter((step) => step.ab_config?.enabled).map((step) => step.id))
  const columns: Column<Row>[] = [
    { key: 'message', header: 'Message', render: (row) => (
      <span className="flex flex-wrap items-center gap-1.5 font-semibold text-ink-900">
        {row.position}. {row.name || 'Untitled Message'}
        {abOf.has(row.id) && <span className="inline-flex h-5 items-center rounded-sm bg-plum-100 px-1.5 text-xs font-semibold text-plum-800">A/B</span>}
      </span>
    ) },
    { key: 'sends', header: 'Sends', render: (row) => {
      const when = whenInZone(row.scheduled_for, series.zone)
      return (
        <span className="cep-num flex flex-col whitespace-nowrap">
          <span>Day {row.day}{when ? ` · ${when.day}` : ''}</span>
          {when && <span className="text-helper text-ink-800">{when.time} {series.zoneShort}</span>}
        </span>
      )
    } },
    { key: 'subject', header: 'Subject', className: 'min-w-[200px]', render: (row) => <span className="line-clamp-2">{row.subject || 'No subject yet'}</span> },
    { key: 'governance', header: 'Governance', className: 'min-w-[220px]', render: (row) => (row.warnings.length === 0 ? <span className="text-ink-800">No issues</span> : (
      <ul className="flex flex-col gap-1">
        {row.warnings.map((warning) => (
          <li key={warning.code + warning.message} data-warning={warning.code} className="flex items-start gap-1.5 text-helper text-warning-text">
            <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="mt-px shrink-0 text-warning" />{warning.message}
          </li>
        ))}
      </ul>
    )) },
    { key: 'edit', header: 'Edit', align: 'right', render: (row) => (
      <Link to={sequenceHref(campaignId, row.id)} aria-label={`Edit message ${row.position}, ${row.name || 'Untitled Message'}`} className="font-semibold text-link hover:underline">Edit</Link>
    ) },
  ]
  return (
    <DetailCard title="Review Timeline" description="Estimates. Consent, unsubscribes and frequency limits are checked again before each message sends." flush>
      {error ? <div className="p-6"><CardError what="the timeline" error={error} onRetry={onRetry} /></div>
        : !review ? <div aria-busy className="flex flex-col gap-3 p-6"><SkeletonLine width="70%" /><SkeletonLine width="100%" /><SkeletonLine width="85%" /></div>
        : (
          <>
            <p className="cep-num border-b border-line-subtle px-6 py-3 text-sm text-ink-900" data-review-summary>{reviewSummary(review, series)}</p>
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <DataTable caption="Review Timeline" columns={columns} rows={review.messages} rowKey={(row) => row.id} framed={false} inset="card" phone="table" />
              </div>
            </div>
          </>
        )}
    </DetailCard>
  )
}
