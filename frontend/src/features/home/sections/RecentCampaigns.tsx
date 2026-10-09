import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ClearFiltersLink, FilterChip, SingleSelectMenu } from '@/components/FilterChip'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState, SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { formatCompactMoney, formatNumber, formatPercent } from '@/lib/format'

import { ChannelIcon } from '../components/ChannelIcon'
import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, MessageChannel, RecentCampaignRow, RecentStatus } from '../data/types'
import { sortRecent, type RecentSort as Sort } from '../sortRecent'

const SORTS: { value: Sort; label: string }[] = [{ value: 'recent', label: 'Most Recent' }, { value: 'best', label: 'Best Performing' }, { value: 'attention', label: 'Needs Attention' }]
const STATUSES: { value: RecentStatus; label: string }[] = [{ value: 'ALL', label: 'All Statuses' }, { value: 'LIVE', label: 'Live' }, { value: 'SCHEDULED', label: 'Scheduled' }, { value: 'DRAFT', label: 'Draft' }]
/** the Campaigns list's own status values for each option */
const LIST_STATUS: Record<RecentStatus, string | null> = { ALL: null, LIVE: 'PRODUCTION_PUBLISHED,ACTIVE', SCHEDULED: 'SCHEDULED', DRAFT: 'DRAFT' }
const SHOWN = 6
const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }

const HEAD = 'h-10 px-3 text-left text-label font-semibold whitespace-nowrap text-ink-900'
const NUMBER_HEAD = 'h-10 px-3 text-right text-label font-semibold whitespace-nowrap text-ink-900'
// by the card's own width (it is the full page or two thirds of it), not the window's
const WIDE = 'hidden @min-[760px]:table-cell'
const MID = 'hidden @min-[600px]:table-cell'
/** in a narrow card the status goes under the name, so the name keeps its room */
const STATUS = 'hidden @min-[480px]:table-cell'

/** "Maria Chen" → "MC" */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('')

function RevenueCell({ row, attributed }: { row: RecentCampaignRow; attributed: boolean }) {
  if (!attributed) return <span className="text-helper text-ink-800">Not Set Up</span>
  if (row.revenue === null) return <>—</>
  const percent = row.target ? Math.round((row.revenue / row.target) * 100) : null
  return (
    <span className="inline-flex items-center justify-end gap-2.5">
      <span className="font-semibold">{formatCompactMoney(row.revenue)}</span>
      {percent !== null && (
        <>
          <span aria-hidden className="hidden h-1.5 w-16 overflow-hidden rounded-pill bg-fill-subtle @min-[600px]:block"><span className="block h-full rounded-pill bg-brand-600" style={{ width: `${Math.min(100, percent)}%` }} /></span>
          <span data-target-share className="w-10 text-left text-helper text-ink-800">{percent}%<span className="sr-only"> of target</span></span>
        </>
      )}
    </span>
  )
}

function Row({ row, attributed }: { row: RecentCampaignRow; attributed: boolean }) {
  return (
    <tr data-campaign={row.id} className="h-16">
      <td className="pr-3 pl-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex min-w-0 flex-col items-start">
            <Link to={`/campaigns/${row.id}`} className="max-w-full min-w-0 rounded-sm text-sm font-semibold text-ink-900 hover:underline"><TruncatedText text={row.name} /></Link>
            <TruncatedText text={row.contextLine} className="text-xs text-ink-800" />
            <span className="mt-1 @min-[480px]:hidden"><StatusBadge status={row.status} label={row.statusLabel} /></span>
          </div>
        </div>
      </td>
      <td className={`${STATUS} px-3`}><StatusBadge status={row.status} label={row.statusLabel} /></td>
      <td className={`${MID} px-3 text-sm text-ink-900`}><span className="inline-flex items-center gap-1.5"><span aria-hidden className="flex"><ChannelIcon channel={row.channel} /></span>{CHANNEL_LABEL[row.channel]}</span></td>
      <td className={`${MID} px-3 text-right text-sm text-ink-900 cep-num`}>{row.delivered === null ? '—' : formatNumber(row.delivered)}</td>
      <td className={`${WIDE} px-3 text-right text-sm cep-num`}>
        {row.openRate === 'not_tracked' ? <span className="whitespace-nowrap text-ink-800">Not Tracked</span> : <span className="text-ink-900">{row.openRate === null ? '—' : formatPercent(row.openRate)}</span>}
      </td>
      <td className="px-3 text-right text-sm text-ink-900 cep-num"><RevenueCell row={row} attributed={attributed} /></td>
      <td className={`${WIDE} pr-6 pl-3 text-sm text-ink-900`}>
        <span className="flex min-w-0 items-center gap-2">
          {row.owner && <span aria-hidden className="bg-brand-600 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-on-brand">{initials(row.owner)}</span>}
          <TruncatedText text={row.owner ?? '—'} />
        </span>
      </td>
    </tr>
  )
}

/** The latest campaigns with this period's figures, sorted and narrowed by the card's own chips. */
export function RecentCampaigns({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const [sort, setSort] = useState<Sort>('recent')
  const [status, setStatus] = useState<RecentStatus>('ALL')
  const result = source.useRecentCampaigns(filters, status)
  if (result.status === 'unavailable') return null

  const changed = sort !== 'recent' || status !== 'ALL'
  const clear = () => { setSort('recent'); setStatus('ALL') }
  const params = new URLSearchParams()
  if (LIST_STATUS[status]) params.set('status', LIST_STATUS[status]!)
  if (filters.channel !== 'ALL') params.set('channel', filters.channel)
  const viewAll = `/campaigns${params.size ? `?${params.toString()}` : ''}`
  const data = result.status === 'ready' ? result.data : null
  const rows = data ? sortRecent(data.rows, sort, data.attributionSetUp).slice(0, SHOWN) : []

  return (
    <HomeCard title="Recent Campaigns" flush
      helper={data ? `Showing ${rows.length} of ${data.total}` : undefined}
      actions={(
        <div role="group" aria-label="Recent Campaigns Options" className="flex flex-wrap items-center gap-3">
          <FilterChip label={`Sort: ${SORTS.find((option) => option.value === sort)!.label}`} menuLabel="Sort" menuWidth={200}>
            {({ close }) => <SingleSelectMenu label="Sort" options={SORTS} value={sort} onChange={(value) => { setSort(value); close() }} />}
          </FilterChip>
          <FilterChip label={STATUSES.find((option) => option.value === status)!.label} active={status !== 'ALL'} menuLabel="Status" menuWidth={200}>
            {({ close }) => <SingleSelectMenu label="Status" options={STATUSES} value={status} onChange={(value) => { setStatus(value); close() }} />}
          </FilterChip>
          {changed && <ClearFiltersLink onClick={clear} />}
          <Link to={viewAll} className={buttonClass({ variant: 'secondary', size: 'sm' })}>View All Campaigns</Link>
        </div>
      )}>
      {result.status === 'loading' ? (
        <div data-recent="loading" className="flex flex-col gap-6 px-6 pb-6">{[80, 65, 72, 58, 70, 60].map((width) => <SkeletonLine key={width} width={`${width}%`} />)}</div>
      ) : result.status === 'error' ? (
        <div className="px-6 pb-6"><ErrorState error={result.error} onRetry={result.retry} title="Recent campaigns could not be loaded" /></div>
      ) : rows.length === 0 ? (
        <p className="flex flex-wrap items-center gap-2 px-6 pb-6 text-sm text-ink-800">No campaigns match these filters.{changed && <ClearFiltersLink onClick={clear} />}</p>
      ) : (
        <div className="@container">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">Recent campaigns</caption>
          <thead className="bg-surface-subtle">
            <tr className="border-y border-line-subtle">
              <th scope="col" className={`${HEAD} pl-6`}>Campaign</th>
              <th scope="col" className={`${HEAD} ${STATUS} w-[150px]`}>Status</th>
              <th scope="col" className={`${HEAD} ${MID} w-[100px]`}>Channel</th>
              <th scope="col" className={`${NUMBER_HEAD} ${MID} w-[96px]`}>Delivered</th>
              <th scope="col" className={`${NUMBER_HEAD} ${WIDE} w-[96px]`}>Open Rate</th>
              <th scope="col" className={`${NUMBER_HEAD} w-[120px] @min-[600px]:w-[210px]`}>Revenue vs. Target</th>
              <th scope="col" className={`${HEAD} ${WIDE} w-[170px]`}>Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((row) => <Row key={row.id} row={row} attributed={data!.attributionSetUp} />)}
          </tbody>
        </table>
        </div>
      )}
    </HomeCard>
  )
}
