import type { RecentCampaignRow } from './data/types'

export type RecentSort = 'recent' | 'best' | 'attention'

const byRecency = (a: RecentCampaignRow, b: RecentCampaignRow) => b.lastActivity.localeCompare(a.lastActivity)
const percentOfTarget = (row: RecentCampaignRow) => (row.revenue !== null && row.target ? row.revenue / row.target : null)
const byClickRate = (a: RecentCampaignRow, b: RecentCampaignRow) => (b.clickRate ?? -1) - (a.clickRate ?? -1)

/**
 * Most Recent: the last thing that happened, newest first. Best Performing: revenue against target, then the rest by click
 * rate (by click rate alone without attribution). Needs Attention: failed, waiting for approval, awaiting publish, paused, then by recency.
 */
export function sortRecent(rows: RecentCampaignRow[], sort: RecentSort, attributed: boolean): RecentCampaignRow[] {
  const sorted = [...rows]
  if (sort === 'recent') return sorted.sort(byRecency)
  if (sort === 'attention') return sorted.sort((a, b) => a.attention - b.attention || byRecency(a, b))
  if (!attributed) return sorted.sort(byClickRate)
  return sorted.sort((a, b) => {
    const [left, right] = [percentOfTarget(a), percentOfTarget(b)]
    if (left !== null && right !== null) return right - left
    if (left !== null || right !== null) return left !== null ? -1 : 1
    return byClickRate(a, b)
  })
}
