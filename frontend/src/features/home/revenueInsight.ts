import { formatCompactMoney, formatPercent } from '@/lib/format'

import type { RevenueCostSeries } from './data/types'

export interface RevenueInsight {
  title: string
  detail: string
}

/**
 * One sentence on the period: revenue against the target's pace when there is a target, otherwise against cost. Nothing
 * without attributed revenue, or with nothing sent.
 */
export function revenueInsight(data: RevenueCostSeries): RevenueInsight | null {
  const { revenue, cost, roi } = data.summary
  if (revenue === null || data.points.length === 0) return null
  const pace = data.points.reduce<number | null>((total, point) => (point.targetPace === null ? total : (total ?? 0) + point.targetPace), null)
  const spend = cost > 0 ? `from ${formatCompactMoney(cost)} campaign cost${roi === null ? '' : ` (${roi.toFixed(1)}× return)`}` : 'with no campaign cost recorded'
  if (pace !== null && pace > 0) {
    const ahead = revenue >= pace
    return {
      title: ahead ? 'Revenue is ahead of target pace' : 'Revenue is behind target pace',
      detail: `Attributed revenue is ${formatCompactMoney(revenue)} ${spend}, ${formatPercent((revenue / pace) * 100, 0)} of the ${formatCompactMoney(pace)} expected by now. ${
        ahead ? 'Consider scaling the best-performing audience before the next send window.' : 'Review the campaigns furthest under target before the next send window.'}`,
    }
  }
  return {
    title: roi !== null && roi >= 2 ? 'Revenue is well ahead of cost' : 'Revenue against cost',
    detail: `Attributed revenue is ${formatCompactMoney(revenue)} ${spend}. Set revenue targets on campaigns to track pace here.`,
  }
}
