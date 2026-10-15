import { addDays, todayIn } from '@/apps/cep/features/reports/period'

import type { HomePeriod } from './data/types'

export const PERIOD_DAYS: Record<HomePeriod, number> = { '7d': 7, '30d': 30, '90d': 90 }

export interface HomeRange {
  from: string
  to: string
  previousFrom: string
  previousTo: string
}

/** The last 7, 30 or 90 days up to today in the workspace's zone, and the same number of days just before them. */
export function homePeriod(period: HomePeriod, zone: string, now = new Date()): HomeRange {
  const days = PERIOD_DAYS[period]
  const to = todayIn(zone, now)
  const from = addDays(to, -(days - 1))
  const previousTo = addDays(from, -1)
  return { from, to, previousFrom: addDays(previousTo, -(days - 1)), previousTo }
}
