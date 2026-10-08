import { Filter } from 'lucide-react'
import { useState } from 'react'

import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, SkeletonLine } from '@/components/States'

import { HomeCard } from '../components/HomeCard'
import { PlumChip } from '../components/RingKpi'
import { useHomeData } from '../data/homeDataContext'
import { CountUp, IntroBar } from '../intro'
import type { HomeFilters, MessageChannel } from '../data/types'
import { funnelSteps, type FunnelStep } from '../funnelSteps'

const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }
/** each step's dot and bar, blue through periwinkle into plum */
const STEP_LOOK = [
  { dot: 'bg-brand-600', bar: 'cep-home-step-1' },
  { dot: 'bg-callout-icon', bar: 'cep-home-step-2' },
  { dot: 'bg-plum-500', bar: 'cep-home-step-3' },
  { dot: 'bg-plum-500', bar: 'cep-home-step-4' },
]

function Step({ step, index, last }: { step: FunnelStep; index: number; last: boolean }) {
  const look = STEP_LOOK[index]
  return (
    <li data-step={step.key} className={`flex flex-col gap-2 rounded-lg border p-3 ${last ? 'cep-home-strip border-plum-200' : 'border-line-subtle bg-surface'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-900"><span aria-hidden className={`h-2 w-2 rounded-full ${look.dot}`} />{step.label}</span>
        <span data-value className={`font-semibold cep-num ${step.value === null ? 'text-sm text-ink-800' : 'text-base text-ink-900'}`}>{step.value === null ? step.valueText : <CountUp value={step.valueText} />}</span>
      </div>
      {step.value !== null && (
        <div aria-hidden className="h-2 overflow-hidden rounded-pill bg-fill-subtle"><IntroBar as="div" className={`rounded-pill ${look.bar}`} percent={Math.min(100, step.share)} /></div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-800">{step.note}</span>
        {step.chip && <PlumChip>{step.chip}</PlumChip>}
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
    <HomeCard title="Engagement Funnel" icon={Filter}
      actions={showToggle && current ? (
        <SegmentedControl label="Funnel Channel" variant="outline" options={channels.map((item) => ({ value: item.channel, label: CHANNEL_LABEL[item.channel] }))} value={current.channel} onChange={setPicked} />
      ) : undefined}>
      <div data-funnel-body className="flex h-full flex-col">
        {result.status === 'loading' ? (
          <div className="flex flex-col gap-2.5">{[100, 70, 45, 30].map((width) => <div key={width} className="rounded-lg border border-line-subtle p-3"><SkeletonLine width={`${width}%`} /></div>)}</div>
        ) : result.status === 'error' ? (
          <ErrorState error={result.error} onRetry={result.retry} title="The funnel could not be loaded" />
        ) : steps.length === 0 ? (
          <p className="text-sm text-ink-800">Nothing was delivered in this period.</p>
        ) : (
          <ol aria-label={`${CHANNEL_LABEL[current!.channel]} engagement funnel`} className="flex flex-col gap-2.5">
            {steps.map((step, index) => <Step key={step.key} step={step} index={index} last={index === steps.length - 1} />)}
          </ol>
        )}
      </div>
    </HomeCard>
  )
}
