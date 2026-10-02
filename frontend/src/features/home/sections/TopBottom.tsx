import { ArrowUpDown } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { formatCompactMoney, formatPercent, formatPercentChange, formatPointChange } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, MessageChannel, TopBottom as TopBottomData, TopBottomRow } from '../data/types'

const SHOWN = 3
const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }

/** "Email · 118% of target · +22.0%" or "SMS · 7.2% click rate · +0.4 pt": the channel, the ranking figure, the change */
function context(row: TopBottomRow, mode: TopBottomData['mode']): string {
  const figure = mode === 'target' ? `${row.value}% of target` : `${formatPercent(row.value)} click rate`
  const change = row.change === null ? null : mode === 'target' ? formatPercentChange(row.change) : formatPointChange(row.change)
  return [CHANNEL_LABEL[row.channel], figure, change].filter(Boolean).join(' · ')
}

function Row({ row, mode }: { row: TopBottomRow; mode: TopBottomData['mode'] }) {
  return (
    <li data-campaign={row.id} className="flex items-center justify-between gap-4 py-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <Link to={`/campaigns/${row.id}`} className="min-w-0 rounded-sm text-sm font-semibold text-ink-900 hover:underline"><TruncatedText text={row.name} /></Link>
        <span data-context className="truncate text-helper text-ink-800">{context(row, mode)}</span>
      </span>
      <span data-figure className="shrink-0 font-display text-base font-semibold text-brand-800 cep-num">
        {mode === 'target' ? formatCompactMoney(row.figure) : `${formatPercent(row.figure)} clicks`}
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
    <HomeCard title="Top Campaigns" icon={ArrowUpDown}
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
        <ul aria-label={result.data.mode === 'target' ? 'Top campaigns by revenue against target' : 'Top campaigns by click rate'} className="-my-3 divide-y divide-line-subtle">
          {rows.map((row) => <Row key={row.id} row={row} mode={result.data.mode} />)}
        </ul>
      )}
    </HomeCard>
  )
}
