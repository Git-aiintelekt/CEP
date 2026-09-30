/** Top and Bottom Campaigns: the ranking, shared by the sample and live sources. */
import type { MessageChannel, TopBottom, TopBottomMode, TopBottomRow } from './types'

export interface RankCandidate {
  id: string
  name: string
  channel: MessageChannel
  delivered: number
  clicked: number
  /** attributed revenue; null when the campaign has none */
  revenue: number | null
  /** the campaign's revenue target */
  target: number | null
  previousRevenue: number | null
  /** the click rate in the previous period, in percent */
  previousClickRate: number | null
}

const GROUP = 3
/** a click rate over fewer deliveries says little (the rule Reports uses for its highlights) */
const MIN_DELIVERED = 50
const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * target: campaigns with a target and a result, by revenue ÷ target. clickRate: campaigns with 50+ delivered, by click rate
 * against `average`. The best three first, the weakest three last (weakest last); with fewer than six, the best half
 * (rounded up) and the rest, with nothing between.
 */
export function rankTopBottom({ mode, candidates, average = null }: { mode: TopBottomMode; candidates: RankCandidate[]; average?: number | null }): TopBottom {
  const centre = mode === 'target' ? 100 : average ?? 0
  const ranked = candidates
    .flatMap((item) => {
      if (mode === 'target') {
        if (!item.target || item.target <= 0 || item.revenue === null || item.delivered <= 0) return []
        const change = item.previousRevenue ? round1(((item.revenue - item.previousRevenue) / item.previousRevenue) * 100) : null
        return [{ item, value: Math.round((item.revenue / item.target) * 100), figure: item.revenue, change }]
      }
      if (item.delivered < MIN_DELIVERED) return []
      const rate = round1((item.clicked / item.delivered) * 100)
      return [{ item, value: rate, figure: rate, change: item.previousClickRate === null ? null : round1(rate - item.previousClickRate) }]
    })
    .sort((a, b) => b.value - a.value)

  const count = ranked.length
  const topCount = count >= GROUP * 2 ? GROUP : Math.ceil(count / 2)
  const bottomCount = count >= GROUP * 2 ? GROUP : Math.floor(count / 2)
  const top = ranked.slice(0, topCount)
  const bottom = ranked.slice(count - bottomCount)
  const middle = ranked.slice(topCount, count - bottomCount)
  const shown = [...top, ...bottom]
  const widest = Math.max(0, ...shown.map((row) => Math.abs(row.value - centre)))
  const row = ({ item, value, figure, change }: (typeof ranked)[number]): TopBottomRow => {
    const deviation = round1(value - centre)
    return { id: item.id, name: item.name, channel: item.channel, value, deviation, scale: widest ? Math.abs(deviation) / widest : 0, figure, change }
  }
  return {
    mode,
    top: top.map(row),
    middle: { count: middle.length, min: middle.length ? Math.min(...middle.map((item) => item.value)) : 0, max: middle.length ? Math.max(...middle.map((item) => item.value)) : 0 },
    bottom: bottom.map(row),
    average: mode === 'clickRate' ? average : null,
  }
}
