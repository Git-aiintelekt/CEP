import { Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { formatCompactMoney, formatPercent, formatPercentChange, formatPointChange } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import { CountUp, IntroBar } from '../intro'
import type { HomeFilters, MessageChannel, TopBottom as TopBottomData, TopBottomRow } from '../data/types'

const SHOWN = 3
const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }

/** "Email · 118% of target · +22.0%" or "SMS · 7.2% click rate · +0.4 pt": the channel, a drip's progress, the ranking figure, the change */
function context(row: TopBottomRow, mode: TopBottomData['mode']): string {
  const figure = mode === 'target' ? `${row.value}% of target` : `${formatPercent(row.value)} click rate`
  const change = row.change === null ? null : mode === 'target' ? formatPercentChange(row.change) : formatPointChange(row.change)
  return [CHANNEL_LABEL[row.channel], row.progress, figure, change].filter(Boolean).join(' · ')
}

const RANK = ['cep-home-rank-1 text-on-brand', 'cep-home-rank-2 text-on-brand', 'cep-home-rank-3 text-plum-800']

/** the bar: how much of its target a campaign reached (capped at the full bar), or its click rate against the best shown */
function share(row: TopBottomRow, mode: TopBottomData['mode'], best: number): number {
  if (mode === 'target') return Math.min(100, Math.max(0, row.value))
  return best > 0 ? (row.figure / best) * 100 : 0
}

function Row({ row, mode, rank, best }: { row: TopBottomRow; mode: TopBottomData['mode']; rank: number; best: number }) {
  return (
    <li data-campaign={row.id} className="flex items-center gap-3">
      <span aria-label={`Rank ${rank + 1}`} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control-md text-helper font-semibold ${RANK[rank]}`}>{rank + 1}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-3">
          <Link to={`/campaigns/${row.id}`} className="min-w-0 rounded-sm text-sm font-semibold text-ink-900 hover:underline"><TruncatedText text={row.name} /></Link>
          <span data-figure className="shrink-0 text-sm font-semibold text-ink-900 cep-num">
            <CountUp value={mode === 'target' ? formatCompactMoney(row.figure) : `${formatPercent(row.figure)} clicks`} />
          </span>
        </span>
        <span aria-hidden className="h-1.5 overflow-hidden rounded-pill bg-fill-subtle"><IntroBar className="cep-home-blend rounded-pill" percent={share(row, mode, best)} /></span>
        <span data-context className="truncate text-xs text-ink-800">{context(row, mode)}</span>
      </span>
    </li>
  )
}

/** The three campaigns furthest over their revenue target (or the highest click rates, without attribution), with View All to the list. */
export function TopCampaigns({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const result = source.useTopBottom(filters)
  if (result.status === 'unavailable') return null
  const rows = result.status === 'ready' ? result.data.top.slice(0, SHOWN) : []
  return (
    <HomeCard title="Top Campaigns" icon={Trophy}
      actions={<Link to="/campaigns" className={`${buttonClass({ variant: 'link', size: 'sm' })} -mr-3`}>View All</Link>}>
      {result.status === 'loading' ? (
        <div data-top-campaigns="loading" className="flex flex-col">
          {Array.from({ length: SHOWN }, (_, index) => <div key={index} className="flex h-14 items-center"><SkeletonLine width={`${90 - index * 12}%`} /></div>)}
        </div>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.retry} title="The campaign ranking could not be loaded" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-800">
          {result.data.mode === 'target' ? 'No campaigns with a revenue target have results in this period.' : 'No campaign reached 50 people in this period, so there is nothing to rank yet.'}
        </p>
      ) : (
        <ol aria-label={result.data.mode === 'target' ? 'Top campaigns by revenue against target' : 'Top campaigns by click rate'} className="flex flex-col gap-4">
          {rows.map((row, index) => <Row key={row.id} row={row} mode={result.data.mode} rank={index} best={Math.max(...rows.map((item) => item.figure))} />)}
        </ol>
      )}
    </HomeCard>
  )
}
