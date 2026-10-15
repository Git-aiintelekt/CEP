import { formatPercent } from '@/lib/format'

import type { FunnelChannel, MessageChannel } from './data/types'

const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }

export interface Insight {
  title: string
  detail: string
  href: string
}

/**
 * The opportunity card: the channel whose delivered messages convert best, against the others. Only when two channels
 * have delivered something in the period and one of them reports conversions; otherwise there is nothing honest to say.
 */
export function insightFrom(channels: FunnelChannel[]): Insight | null {
  const live = channels.filter((channel) => channel.delivered > 0)
  if (live.length < 2) return null
  const rated = live.map((channel) => ({ channel, rate: channel.converted === null ? null : channel.converted / channel.delivered }))
  const known = rated.filter((item): item is { channel: FunnelChannel; rate: number } => item.rate !== null).sort((a, b) => b.rate - a.rate)
  if (known.length === 0 || known[0].rate === 0) return null
  const best = known[0].channel
  const others = live.filter((channel) => channel !== best).map((channel) => CHANNEL_LABEL[channel.channel])
  const engagement = best.opened !== null ? `Open rate is ${formatPercent((best.opened / best.delivered) * 100, 0)}` : `Click rate is ${formatPercent((best.clicked / best.delivered) * 100, 0)}`
  return {
    title: `Opportunity: ${CHANNEL_LABEL[best.channel]} is driving strongest conversion`,
    detail: `${engagement}; ${others.join(' and ')} engagement is lower.`,
    href: '/reports',
  }
}
