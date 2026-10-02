import { Radar } from 'lucide-react'

import { ErrorState, SkeletonLine } from '@/components/States'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import { PERIOD_OPTIONS } from '../filterLabels'
import type { HomeFilters } from '../data/types'
import { snapshotRows, type SnapshotRow } from '../snapshotRows'

function Row({ row }: { row: SnapshotRow }) {
  return (
    <li data-snapshot={row.key} className="flex items-center gap-3 py-2.5">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md bg-brand-100 text-brand-800"><row.icon size={16} strokeWidth={1.5} /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-ink-900">{row.label}</span>
        <span className="truncate text-helper text-ink-800">{row.detail}</span>
      </span>
      <span data-value className={`shrink-0 text-sm font-semibold cep-num ${row.value === '—' ? 'text-ink-800' : 'text-ink-900'}`}>{row.value}</span>
    </li>
  )
}

/** Each channel at a glance for the period: engagement and its rate, e-receipts, and the journeys touching people this week. */
export function ChannelSnapshot({ filters }: { filters: HomeFilters }) {
  const { source, viewer } = useHomeData()
  const funnel = source.useFunnel(filters)
  const receipts = source.useEReceipts(filters)
  const schedule = source.useSchedule(filters)
  if (funnel.status === 'unavailable') return null
  const workspace = (['EMAIL', 'SMS', 'MMS'] as const).filter((channel) => viewer.has(channel.toLowerCase() as 'email' | 'sms' | 'mms') && (filters.channel === 'ALL' || filters.channel === channel))
  const period = PERIOD_OPTIONS.find((option) => option.value === filters.period)!.label
  return (
    <HomeCard title="Channel Snapshot" icon={Radar} actions={<span className="text-helper text-ink-800">{period}</span>}>
      {funnel.status === 'loading' ? (
        <div data-snapshot="loading" className="flex flex-col gap-4">{[70, 60, 65, 55].map((width) => <SkeletonLine key={width} width={`${width}%`} />)}</div>
      ) : funnel.status === 'error' ? (
        <ErrorState error={funnel.error} onRetry={funnel.retry} title="Channel figures could not be loaded" />
      ) : (
        <ul aria-label="Channels" className="-my-2.5 divide-y divide-line-subtle">
          {snapshotRows(funnel.data, workspace, viewer.has('ereceipt') && receipts.status === 'ready' ? receipts.data : null,
            viewer.has('journeys') && schedule.status === 'ready' && filters.campaignIds.length === 0 ? schedule.data : null).map((row) => <Row key={row.key} row={row} />)}
        </ul>
      )}
    </HomeCard>
  )
}
