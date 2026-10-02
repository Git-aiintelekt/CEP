import { ArrowDownToLine } from 'lucide-react'
import { useState } from 'react'

import { SegmentedControl } from '@/components/SegmentedControl'
import { BarList, type BarListRow } from '@/components/charts/BarList'
import { formatNumber, formatPercent } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { FunnelChannel, HomeFilters, MessageChannel } from '../data/types'

const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }

function Connector({ text }: { text: string }) {
  return <p data-drop-off className="mt-1 ml-2 border-l border-line-subtle py-1 pl-3 text-helper text-ink-800">{text}</p>
}

/**
 * Delivered, Opened, Clicked, Converted as bars against Delivered. Each tracked step says how much was lost since the
 * last tracked one; a channel with no opens skips Opened, so Clicked is measured from Delivered.
 */
function funnelRows(channel: FunnelChannel): BarListRow[] {
  const steps: { key: string; label: string; value: number | null; missing: string }[] = [
    { key: 'delivered', label: 'Delivered', value: channel.delivered, missing: '—' },
    { key: 'opened', label: 'Opened', value: channel.opened, missing: 'Not Tracked' },
    { key: 'clicked', label: 'Clicked', value: channel.clicked, missing: '—' },
    { key: 'converted', label: 'Converted', value: channel.converted, missing: '—' },
  ]
  let lastTracked: { label: string; value: number; index: number } | null = null
  const rows: BarListRow[] = steps.map((step) => ({ key: step.key, label: step.label, value: step.value, valueText: step.value === null ? step.missing : undefined }))
  steps.forEach((step, index) => {
    if (step.value === null) return
    if (lastTracked && lastTracked.value > 0) {
      const skipped = index - lastTracked.index > 1
      const drop = formatPercent(((lastTracked.value - step.value) / lastTracked.value) * 100)
      rows[index - 1] = { ...rows[index - 1], after: <Connector text={`Drop-off ${drop}${skipped ? ` from ${lastTracked.label}` : ''}`} /> }
    }
    lastTracked = { label: step.label, value: step.value, index }
  })
  return rows
}

/** the two end-to-end rates under the funnel: delivered to converted, delivered to opened (or clicked where opens aren't tracked) */
function Rates({ channel }: { channel: FunnelChannel | undefined }) {
  const rate = (value: number | null | undefined) => (channel && value !== null && value !== undefined && channel.delivered > 0 ? formatPercent((value / channel.delivered) * 100, 2) : '—')
  const engagement = channel?.opened === null ? ['Delivered → Clicked', rate(channel?.clicked)] : ['Delivered → Opened', rate(channel?.opened)]
  const tiles: [string, string][] = [['Delivered → Converted', rate(channel?.converted)], [engagement[0], engagement[1]]]
  return (
    <dl data-funnel-rates className="grid grid-cols-2 gap-3">
      {tiles.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-subtle px-3 py-2.5">
          <dd className="font-display text-xl leading-tight font-semibold text-ink-900 cep-num">{value}</dd>
          <dt className="text-helper text-ink-800">{label}</dt>
        </div>
      ))}
    </dl>
  )
}

/** One channel's engagement funnel, picked with a toggle when more than one channel has data and the page isn't filtered to one. */
export function EngagementFunnel({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const result = source.useFunnel(filters)
  const [picked, setPicked] = useState<MessageChannel | null>(null)
  if (result.status === 'unavailable') return null

  const channels = result.status === 'ready' ? result.data : []
  const current = filters.channel !== 'ALL'
    ? channels.find((item) => item.channel === filters.channel)
    : channels.find((item) => item.channel === picked) ?? channels[0]
  const showToggle = filters.channel === 'ALL' && channels.length > 1

  return (
    <HomeCard title="Engagement Funnel" icon={ArrowDownToLine}
      actions={showToggle && current ? (
        <SegmentedControl label="Funnel Channel" variant="outline" options={channels.map((item) => ({ value: item.channel, label: CHANNEL_LABEL[item.channel] }))} value={current.channel} onChange={setPicked} />
      ) : undefined}>
      <div data-funnel-body className="flex h-full flex-col gap-4">
        <BarList
          title={current ? `${CHANNEL_LABEL[current.channel]} engagement funnel` : 'Engagement funnel'}
          rows={current ? funnelRows(current) : []}
          max={current?.delivered}
          formatValue={formatNumber}
          loading={result.status === 'loading'}
          error={result.status === 'error' ? result.error : undefined}
          onRetry={result.status === 'error' ? result.retry : undefined}
          emptyText="Nothing was delivered in this period."
        />
        {result.status === 'ready' && current && <div className="mt-auto"><Rates channel={current} /></div>}
      </div>
    </HomeCard>
  )
}
