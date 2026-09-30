import { ArrowUpDown } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { formatCompactMoney, formatPercent, formatPercentChange, formatPointChange } from '@/lib/format'

import { ChannelIcon } from '../components/ChannelIcon'
import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, TopBottom as TopBottomData, TopBottomRow } from '../data/types'


const HEAD = 'h-10 px-2 text-xs font-semibold text-ink-900'
const CHANGE_CELL = 'hidden min-[768px]:table-cell'
// a bar never takes the whole half: its label sits beside it
const LABEL_ROOM = '3rem'

const TEXT = {
  target: { under: 'Under Target', over: 'Over Target', figure: 'Revenue', caption: 'Campaigns ranked by revenue against target', between: 'of target' },
  clickRate: { under: 'Below Average', over: 'Above Average', figure: 'Click Rate', caption: 'Campaigns ranked by click rate against the account average', between: 'click rate' },
}

function Bar({ row, side, mode }: { row: TopBottomRow; side: 'under' | 'over'; mode: TopBottomData['mode'] }) {
  const over = row.deviation >= 0
  if ((side === 'over') !== over) return null
  const label = mode === 'target' ? `${row.value}%` : formatPercent(row.value)
  const bar = (
    <span aria-hidden data-bar={over ? 'over' : 'under'} className={`block h-3 shrink-0 ${over ? 'rounded-r-xs bg-chart-1' : 'rounded-l-xs bg-danger'}`}
      style={{ width: `calc((100% - ${LABEL_ROOM}) * ${row.scale})` }} />
  )
  const text = <span data-percent className={`shrink-0 text-helper font-semibold cep-num ${over ? 'text-brand-800' : 'text-danger-text'}`}>{label}</span>
  return <span className={`flex items-center gap-1.5 ${over ? '' : 'justify-end'}`}>{over ? <>{bar}{text}</> : <>{text}{bar}</>}</span>
}

function Row({ row, mode }: { row: TopBottomRow; mode: TopBottomData['mode'] }) {
  const change = row.change === null ? null : mode === 'target' ? formatPercentChange(row.change) : formatPointChange(row.change)
  return (
    <tr data-campaign={row.id} className="h-[46px]">
      <td className="px-2">
        <span className="flex min-w-0 items-center gap-2">
          <ChannelIcon channel={row.channel} />
          <Link to={`/campaigns/${row.id}`} className="min-w-0 rounded-sm text-sm text-ink-900 hover:underline"><TruncatedText text={row.name} /></Link>
        </span>
      </td>
      <td className="border-r border-line pl-2"><Bar row={row} side="under" mode={mode} /></td>
      <td className="pr-2"><Bar row={row} side="over" mode={mode} /></td>
      <td className="px-2 text-right text-sm text-ink-900 cep-num">{mode === 'target' ? formatCompactMoney(row.figure) : formatPercent(row.figure)}</td>
      <td className={`${CHANGE_CELL} px-2 text-right text-sm cep-num ${row.change === null ? 'text-ink-800' : row.change < 0 ? 'text-danger-text' : 'text-success-text'}`}>{change ?? '—'}</td>
    </tr>
  )
}

function Table({ data }: { data: TopBottomData }) {
  const text = TEXT[data.mode]
  const { count, min, max } = data.middle
  const unit = (value: number) => (data.mode === 'target' ? `${value}%` : formatPercent(value))
  return (
    <table className="w-full table-fixed border-collapse">
      <caption className="sr-only">{text.caption}</caption>
      <thead>
        <tr className="border-b border-line-subtle">
          <th scope="col" className={`${HEAD} w-[34%] text-left`}>Campaign</th>
          <th scope="col" className={`${HEAD} w-[22%] text-right`}>{text.under}</th>
          <th scope="col" className={`${HEAD} w-[22%] text-left`}>{text.over}</th>
          <th scope="col" className={`${HEAD} w-[11%] text-right`}>{text.figure}</th>
          <th scope="col" className={`${HEAD} ${CHANGE_CELL} w-[11%] text-right`}>Change</th>
        </tr>
      </thead>
      <tbody>
        {data.top.map((row) => <Row key={row.id} row={row} mode={data.mode} />)}
        {count > 0 && (
          <tr data-middle className="border-y border-line-subtle">
            <td colSpan={5} className="px-2 py-2.5 text-helper text-ink-800">
              {count} more campaign{count === 1 ? '' : 's'} between {unit(min)} and {unit(max)} {text.between} ·{' '}
              <Link to="/campaigns" className="font-semibold text-brand-800 hover:underline">View All</Link>
            </td>
          </tr>
        )}
      </tbody>
      {data.bottom.length > 0 && (
        <tbody className={count > 0 ? '' : 'border-t border-line-subtle'}>
          {data.bottom.map((row) => <Row key={row.id} row={row} mode={data.mode} />)}
        </tbody>
      )}
    </table>
  )
}

/** The three campaigns furthest over their revenue target and the three furthest under (or click rate against the average, without attribution). */
export function TopBottom({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const result = source.useTopBottom(filters)
  if (result.status === 'unavailable') return null
  return (
    <HomeCard title="Top and Bottom Campaigns" icon={ArrowUpDown}
      actions={<Link to="/campaigns" className={`${buttonClass({ variant: 'link', size: 'sm' })} -mr-3`}>View All Campaigns</Link>}>
      {result.status === 'loading' ? (
        <div data-top-bottom="loading" className="flex flex-col">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex h-[46px] items-center"><SkeletonLine width={`${90 - index * 8}%`} /></div>)}
        </div>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.retry} title="The campaign ranking could not be loaded" />
      ) : result.data.top.length === 0 ? (
        <p className="text-sm text-ink-800">
          {result.data.mode === 'target' ? 'No campaigns with a revenue target have results in this period.' : 'No campaign reached 50 people in this period, so there is nothing to rank yet.'}
        </p>
      ) : (
        <Table data={result.data} />
      )}
    </HomeCard>
  )
}
