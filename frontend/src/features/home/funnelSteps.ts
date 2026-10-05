import { formatNumber, formatPercent } from '@/lib/format'

import type { FunnelChannel, MessageChannel } from './data/types'

const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }

export interface FunnelStep {
  key: string
  label: string
  /** null: not tracked on this channel, or can't be split out */
  value: number | null
  valueText: string
  /** the bar's share of Delivered, 0 to 100 */
  share: number
  note: string
  /** the drop to the next tracked step, or for the last step its share of Delivered */
  chip: string | null
}

const rate = (value: number, of: number) => (of > 0 ? (value / of) * 100 : 0)

/**
 * Delivered, Opened, Clicked, Converted against Delivered. Each tracked step says how much is lost by the next tracked
 * one; a channel with no opens skips Opened, so the drop runs from Delivered to Clicked.
 */
export function funnelSteps(channel: FunnelChannel): FunnelStep[] {
  const { delivered, opened, clicked, converted } = channel
  const steps: Omit<FunnelStep, 'chip'>[] = [
    { key: 'delivered', label: 'Delivered', value: delivered, valueText: formatNumber(delivered), share: delivered > 0 ? 100 : 0, note: 'Messages that reached people' },
    opened === null
      ? { key: 'opened', label: 'Opened', value: null, valueText: 'Not Tracked', share: 0, note: `${CHANNEL_LABEL[channel.channel]} does not report opens` }
      : { key: 'opened', label: 'Opened', value: opened, valueText: formatNumber(opened), share: rate(opened, delivered), note: `${formatPercent(rate(opened, delivered))} open rate` },
    { key: 'clicked', label: 'Clicked', value: clicked, valueText: formatNumber(clicked), share: rate(clicked, delivered), note: `${formatPercent(rate(clicked, delivered))} click rate` },
    converted === null
      ? { key: 'converted', label: 'Converted', value: null, valueText: '—', share: 0, note: 'Conversions can’t be split out for this channel' }
      : { key: 'converted', label: 'Converted', value: converted, valueText: formatNumber(converted), share: rate(converted, delivered), note: `${formatPercent(rate(converted, clicked))} of clickers converted` },
  ]
  return steps.map((step, index) => {
    if (step.value === null) return { ...step, chip: null }
    const nextIndex = steps.findIndex((later, place) => place > index && later.value !== null)
    if (nextIndex === -1) return { ...step, chip: index === 0 ? null : `${formatPercent(step.share)} of Delivered` }
    const next = steps[nextIndex]
    if (step.value === 0) return { ...step, chip: null }
    const drop = formatPercent(((step.value - next.value!) / step.value) * 100)
    return { ...step, chip: `Drop-off ${drop}${nextIndex - index > 1 ? ` to ${next.label}` : ''}` }
  })
}
