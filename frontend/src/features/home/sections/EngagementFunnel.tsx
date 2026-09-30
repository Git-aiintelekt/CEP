import { Filter } from 'lucide-react'
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
  const endToEnd = current && current.converted !== null && current.delivered > 0 ? formatPercent((current.converted / current.delivered) * 100, 2) : '—'

  return (
    <HomeCard title="Engagement Funnel by Channel" icon={Filter}
      footer={(
        <div data-funnel-footer className="flex max-w-[720px] items-center justify-between gap-3 text-helper">
          <span className="text-ink-800">Delivered to Converted</span>
          <span className="font-semibold text-ink-900 cep-num">{endToEnd}</span>
        </div>
      )}>
      {/* on a full-width row the funnel stops at 720px, so the counts stay near their labels */}
      <div data-funnel-body className="flex max-w-[720px] flex-col gap-4">
        {showToggle && current && (
          <div className="self-start"><SegmentedControl label="Funnel Channel" variant="outline" options={channels.map((item) => ({ value: item.channel, label: CHANNEL_LABEL[item.channel] }))} value={current.channel} onChange={setPicked} /></div>
        )}
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
      </div>
    </HomeCard>
  )
}
