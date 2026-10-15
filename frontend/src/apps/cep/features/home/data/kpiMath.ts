/** The Marketing Performance figures from raw counts, shared by the sample and live sources so both follow the same rules. */
import type { Kpis } from './types'

export interface Figures {
  delivered: number
  /** email only: opens and the email deliveries they are counted against */
  opened: number
  emailDelivered: number
  clicked: number
  conversions: number
  /** null when no campaign has attributed revenue */
  revenue: number | null
}

export interface CampaignFigures extends Figures {
  tracksOpens: boolean
}

const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

export function sumFigures(rows: Figures[]): Figures {
  const revenues = rows.map((row) => row.revenue).filter((value): value is number => value !== null)
  return {
    delivered: rows.reduce((total, row) => total + row.delivered, 0),
    opened: rows.reduce((total, row) => total + row.opened, 0),
    emailDelivered: rows.reduce((total, row) => total + row.emailDelivered, 0),
    clicked: rows.reduce((total, row) => total + row.clicked, 0),
    conversions: rows.reduce((total, row) => total + row.conversions, 0),
    revenue: revenues.length ? revenues.reduce((total, value) => total + value, 0) : null,
  }
}

interface BuildKpis {
  now: Figures
  before: Figures | null
  /** something in scope reports opens (email) */
  tracksOpens: boolean
  days: number
  revenueTarget: number | null
  storeRevenue: { now: number; before: number | null } | null
}

export function buildKpis({ now, before, tracksOpens, days, revenueTarget, storeRevenue }: BuildKpis): Kpis {
  const earlier = before && before.delivered > 0 ? before : null
  const share = (revenue: number | null, store: number | null | undefined) => (revenue !== null && store ? rate(revenue, store) : null)
  return {
    delivered: { value: now.delivered, previous: before ? before.delivered : null },
    openRate: tracksOpens
      ? { value: rate(now.opened, now.emailDelivered), previous: earlier ? rate(earlier.opened, earlier.emailDelivered) : null, opened: now.opened }
      : { value: 'not_tracked', previous: null, opened: null },
    clickRate: { value: rate(now.clicked, now.delivered), previous: earlier ? rate(earlier.clicked, earlier.delivered) : null, clicked: now.clicked },
    conversions: { value: now.conversions, previous: before ? before.conversions : null, percentOfClicks: rate(now.conversions, now.clicked) },
    attributedRevenue: { value: now.revenue, previous: before?.revenue ?? null },
    contribution: { value: share(now.revenue, storeRevenue?.now), previous: share(before?.revenue ?? null, storeRevenue?.before) },
    attributionSetUp: now.revenue !== null,
    revenueTarget,
    storeRevenue: storeRevenue?.now ?? null,
    perDayDelivered: Math.round(now.delivered / days),
  }
}
