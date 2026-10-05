import { TrendingUp } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorState } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { formatNumber } from '@/lib/format'

import { SeverityIcon } from '../components/HomeTags'
import type { Attention, AttentionGroup, FunnelChannel, SectionResult } from '../data/types'
import { insightFrom, type Insight } from '../insightFrom'
import { rankGroups } from '../rankGroups'

const SHOWN = 3
const CARD = 'flex min-h-[88px] items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3'

/** "1 Delivery Failure", "4 Campaigns Awaiting Production Publish": the count with the group's category */
function title(group: AttentionGroup): string {
  return `${formatNumber(group.count)}${group.atLeast ? '+' : ''} ${group.category}`
}

function AlertCard({ group }: { group: AttentionGroup }) {
  return (
    <li className={CARD} data-alert={group.id}>
      <SeverityIcon severity={group.severity} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-semibold text-ink-900">{title(group)}</span>
        <span data-severity={group.severity} className="truncate text-helper text-ink-800">{group.label}</span>
      </span>
      <Link to={group.href} className="shrink-0 text-sm font-semibold text-brand-600 hover:underline">{group.actionLabel}</Link>
    </li>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <li className={CARD} data-insight>
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md bg-brand-100 text-brand-800"><TrendingUp size={16} strokeWidth={1.5} /></span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-sm font-semibold text-ink-900">{insight.title}</span>
        <span className="text-helper text-ink-800">{insight.detail}</span>
      </span>
      <Link to={insight.href} className="shrink-0 text-sm font-semibold text-brand-600 hover:underline">View Insight</Link>
    </li>
  )
}

/**
 * The alert groups as cards under the greeting, most severe first, with the opportunity card after them; three cards show
 * until View All. The page leaves the section out when there are no groups (see homeLayout).
 */
export function NeedsAttention({ result, funnel }: { result: SectionResult<Attention>; funnel?: SectionResult<FunnelChannel[]> }) {
  const [all, setAll] = useState(false)
  const titleId = useId()
  const gridId = useId()
  const groups = result.status === 'ready' ? rankGroups(result.data.groups) : []
  const insight = funnel?.status === 'ready' ? insightFrom(funnel.data) : null
  // the opportunity card takes one of the three slots when there is one
  const room = insight ? SHOWN - 1 : SHOWN
  const more = groups.length > room
  const shown = all ? groups : groups.slice(0, room)

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <h2 id={titleId} className="sr-only">Needs Attention</h2>
      {result.status === 'error' ? <ErrorState error={result.error} onRetry={result.retry} title="Alerts could not be loaded" />
        : result.status === 'loading' ? (
          <div data-attention="loading" className="grid grid-cols-1 gap-4 @min-[768px]:grid-cols-2 @min-[1100px]:grid-cols-3">
            {Array.from({ length: SHOWN }, (_, index) => <div key={index} aria-hidden className={`${CARD} animate-pulse`}><span className="h-8 w-8 rounded-control-md bg-surface-sunken" /><span className="h-4 flex-1 rounded-sm bg-surface-sunken" /></div>)}
          </div>
        ) : (
          <ul id={gridId} className="grid grid-cols-1 gap-4 @min-[768px]:grid-cols-2 @min-[1100px]:grid-cols-3">
            {shown.map((group) => <AlertCard key={group.id} group={group} />)}
            {insight && <InsightCard insight={insight} />}
          </ul>
        )}
      {result.status === 'ready' && (
        <p className="flex items-center gap-3 text-helper text-ink-800">
          <span className="inline-flex items-center gap-2"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />{result.data.freshness}</span>
          {more && (
            <button type="button" aria-expanded={all} aria-controls={gridId} className={`${buttonClass({ variant: 'link', size: 'sm' })} -ml-1`} onClick={() => setAll(!all)}>
              {all ? 'Show Fewer' : `View All (${groups.length})`}
            </button>
          )}
        </p>
      )}
    </section>
  )
}
