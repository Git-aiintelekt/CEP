import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { formatCompactMoney, formatPercent, formatPercentChange, formatPointChange } from '@/lib/format'

import { ChannelIcon } from '../components/ChannelIcon'
import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import { CountUp, IntroBar } from '../intro'
import type { HomeFilters, MessageChannel, TopBottom as TopBottomData, TopBottomRow } from '../data/types'

const SHOWN = 3
const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }

/** "Email · $41.2K · +22.0%" or "SMS · 7.2% click rate · +0.4 pt": the channel, a drip's progress, the figure, the change */
function context(row: TopBottomRow, mode: TopBottomData['mode']): string {
  const figure = mode === 'target' ? formatCompactMoney(row.figure) : `${formatPercent(row.value)} click rate`
  const change = row.change === null ? null : mode === 'target' ? formatPercentChange(row.change) : formatPointChange(row.change)
  return [CHANNEL_LABEL[row.channel], row.progress, figure, change].filter(Boolean).join(' · ')
}

const valueText = (value: number, mode: TopBottomData['mode']) => (mode === 'target' ? `${Math.round(value)}%` : formatPercent(value))

/** a bar either side of a centre tick (100% of target, or the average click rate): over runs right in blue, under runs left in red */
function DivergingBar({ row }: { row: TopBottomRow }) {
  const under = row.deviation < 0
  return (
    <span aria-hidden className="relative h-2 w-16 shrink-0">
      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-line" />
      <IntroBar className={`absolute inset-y-0 rounded-pill ${under ? 'right-1/2 bg-danger' : 'left-1/2 bg-brand-600'}`} percent={Math.max(4, row.scale * 50)} />
    </span>
  )
}

function Row({ row, mode, under }: { row: TopBottomRow; mode: TopBottomData['mode']; under: boolean }) {
  return (
    <li data-campaign={row.id} className="flex min-h-14 items-center gap-2.5 px-6 py-2">
      <span aria-hidden className="flex shrink-0"><ChannelIcon channel={row.channel} /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <Link to={`/campaigns/${row.id}`} className="min-w-0 rounded-sm text-sm font-semibold text-ink-900 hover:underline"><TruncatedText text={row.name} /></Link>
        <span data-context className="truncate text-xs text-ink-800">{context(row, mode)}</span>
      </span>
      <DivergingBar row={row} />
      <span data-figure className={`w-11 shrink-0 text-right text-sm font-semibold cep-num ${under ? 'text-danger-text' : 'text-ink-900'}`}>
        <CountUp value={valueText(row.value, mode)} />
      </span>
    </li>
  )
}

/** The three campaigns furthest over their revenue target and the three furthest under (or by click rate, without attribution), the rest counted between. */
export function TopCampaigns({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const result = source.useTopBottom(filters)
  if (result.status === 'unavailable') return null
  const data = result.status === 'ready' ? result.data : null
  const top = data ? data.top.slice(0, SHOWN) : []
  const bottom = data ? data.bottom.slice(-SHOWN) : []
  const mode = data?.mode ?? 'target'
  return (
    <HomeCard title="Top and Bottom Campaigns" helper={mode === 'target' ? 'Revenue vs. target' : 'Click rate vs. average'} flush
      actions={<Link to="/campaigns" className={buttonClass({ variant: 'secondary', size: 'sm' })}>View All</Link>}>
      {result.status === 'loading' ? (
        <div data-top-campaigns="loading" className="flex flex-col px-6 pb-6">
          {Array.from({ length: SHOWN }, (_, index) => <div key={index} className="flex h-14 items-center"><SkeletonLine width={`${90 - index * 12}%`} /></div>)}
        </div>
      ) : result.status === 'error' ? (
        <div className="px-6 pb-6"><ErrorState error={result.error} onRetry={result.retry} title="The campaign ranking could not be loaded" /></div>
      ) : top.length === 0 && bottom.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-ink-800">
          {mode === 'target' ? 'No campaigns with a revenue target have results in this period.' : 'No campaign reached 50 people in this period, so there is nothing to rank yet.'}
        </p>
      ) : (
        <div className="border-t border-line-subtle">
          <ol aria-label={mode === 'target' ? 'Top campaigns by revenue against target' : 'Top campaigns by click rate'} className="divide-y divide-line-subtle">
            {top.map((row) => <Row key={row.id} row={row} mode={mode} under={false} />)}
          </ol>
          {data!.middle.count > 0 && (
            <p data-middle className="border-y border-line-subtle bg-surface-subtle px-6 py-2.5 text-helper text-ink-800">
              <span className="whitespace-nowrap">{data!.middle.count} more</span> campaign{data!.middle.count === 1 ? '' : 's'} between {valueText(data!.middle.min, mode)} and {valueText(data!.middle.max, mode)}{mode === 'target' ? ' of target' : ''} · <Link to="/campaigns" className="font-semibold text-link hover:text-link-hover hover:underline">View All</Link>
            </p>
          )}
          {bottom.length > 0 && (
            <ol aria-label={mode === 'target' ? 'Bottom campaigns by revenue against target' : 'Bottom campaigns by click rate'} className={`divide-y divide-line-subtle ${data!.middle.count > 0 ? '' : 'border-t border-line-subtle'}`}>
              {bottom.map((row) => <Row key={row.id} row={row} mode={mode} under={row.deviation < 0} />)}
            </ol>
          )}
        </div>
      )}
    </HomeCard>
  )
}
