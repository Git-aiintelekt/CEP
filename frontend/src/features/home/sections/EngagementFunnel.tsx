import { useState } from 'react'

import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, SkeletonLine } from '@/components/States'
import { formatPercent } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import { CountUp, IntroBar } from '../intro'
import type { HomeFilters, MessageChannel } from '../data/types'
import { funnelSteps, type FunnelStep } from '../funnelSteps'

const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }
/** One step: its name and count, a thin blue bar against Delivered, then its note and the drop to the next step in small text. */
function Step({ step }: { step: FunnelStep }) {
  return (
    <li data-step={step.key} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-ink-900">{step.label}</span>
        <span data-value className={`font-semibold cep-num ${step.value === null ? 'text-sm text-ink-800' : 'text-sm text-ink-900'}`}>{step.value === null ? step.valueText : <CountUp value={step.valueText} />}</span>
      </div>
      {step.value !== null && (
        <div aria-hidden className="h-2 overflow-hidden rounded-pill bg-fill-subtle"><IntroBar as="div" className="rounded-pill bg-brand-600" percent={Math.max(step.share > 0 ? 1.5 : 0, Math.min(100, step.share))} /></div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-ink-800">
        <span>{step.chip ?? ''}</span>
        <span>{step.note}</span>
      </div>
    </li>
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
  const steps = current && current.delivered > 0 ? funnelSteps(current) : []

  return (
    <HomeCard title="Engagement Funnel"
      actions={showToggle && current ? (
        <SegmentedControl label="Funnel Channel" variant="joined" options={channels.map((item) => ({ value: item.channel, label: CHANNEL_LABEL[item.channel] }))} value={current.channel} onChange={setPicked} />
      ) : undefined}>
      <div data-funnel-body className="flex h-full flex-col">
        {result.status === 'loading' ? (
          <div className="flex flex-col gap-5">{[100, 70, 45, 30].map((width) => <SkeletonLine key={width} width={`${width}%`} />)}</div>
        ) : result.status === 'error' ? (
          <ErrorState error={result.error} onRetry={result.retry} title="The funnel could not be loaded" />
        ) : steps.length === 0 ? (
          <p className="text-sm text-ink-800">Nothing was delivered in this period.</p>
        ) : (
          <ol aria-label={`${CHANNEL_LABEL[current!.channel]} engagement funnel`} className="mb-5 flex flex-col gap-4">
            {steps.map((step) => <Step key={step.key} step={step} />)}
          </ol>
        )}
        {steps.length > 0 && current!.converted !== null && (
          <p data-funnel-total className="-mx-6 mt-auto -mb-6 border-t border-line-subtle px-6 py-3.5 text-helper text-ink-800">
            Delivered to converted: <span className="font-semibold text-ink-900 cep-num">{formatPercent((current!.converted / current!.delivered) * 100, 2)}</span>
          </p>
        )}
      </div>
    </HomeCard>
  )
}
