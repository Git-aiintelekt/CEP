/** The Economics card's numbers: each target beside what happened, the difference, and the headline over them. */
import { formatMoney, formatNumber } from '@/lib/format'
import type { CampaignMetrics, CampaignTargets } from '@/lib/types'

export type Tone = 'better' | 'worse' | 'none'

export interface EconomicsRow {
  measure: string
  target: string
  actual: string
  difference: string
  tone: Tone
}

const MINUS = '−'
const toNumber = (value: string | number | null | undefined) => (value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value))

interface Measure {
  measure: string
  target: number | null
  actual: number | null
  money?: boolean
  /** costs: the lower, the better */
  lowerIsBetter?: boolean
}

function row({ measure, target, actual, money = false, lowerIsBetter = false }: Measure): EconomicsRow {
  const show = (value: number | null) => (value === null ? '—' : money ? formatMoney(value) : formatNumber(value))
  if (target === null || actual === null) return { measure, target: show(target), actual: show(actual), difference: '—', tone: 'none' }
  const difference = actual - target
  const size = money ? formatMoney(Math.abs(difference)) : formatNumber(Math.abs(difference))
  const better = lowerIsBetter ? difference <= 0 : difference >= 0
  return { measure, target: show(target), actual: show(actual), difference: difference === 0 ? size : `${difference > 0 ? '+' : MINUS}${size}`, tone: better ? 'better' : 'worse' }
}

/** what the campaign really cost; the API doesn't report it yet, so today it is always null */
export interface ActualCosts { campaign: number | null; offer: number | null }

export function economicsRows(targets: CampaignTargets, metrics: CampaignMetrics, { texts, costs }: { texts: boolean; costs: ActualCosts }): EconomicsRow[] {
  return [
    { measure: 'Opens', target: targets.target_opens, actual: texts ? null : metrics.counts.opened },
    { measure: 'Clicks', target: targets.target_clicks, actual: metrics.counts.clicked },
    { measure: 'Conversions', target: targets.target_conversions, actual: metrics.conversions },
    { measure: 'Revenue', target: toNumber(targets.target_revenue), actual: toNumber(metrics.revenue), money: true },
    { measure: 'Offer Redemptions', target: targets.target_redemptions, actual: null },
    { measure: 'Campaign Cost', target: toNumber(targets.planned_cost), actual: costs.campaign, money: true, lowerIsBetter: true },
    { measure: 'Offer Cost', target: toNumber(targets.planned_offer_cost), actual: costs.offer, money: true, lowerIsBetter: true },
  ].map(row)
}

export function economicsHeadline(metrics: CampaignMetrics, costs: ActualCosts): string {
  const revenue = toNumber(metrics.revenue)
  const spent = costs.campaign === null && costs.offer === null ? null : (costs.campaign ?? 0) + (costs.offer ?? 0)
  if (revenue !== null && spent !== null) {
    const each = metrics.conversions > 0 ? ` · ${formatMoney(spent / metrics.conversions)} per conversion` : ''
    return `Spent ${formatMoney(spent)} to earn ${formatMoney(revenue)}${each}`
  }
  const conversions = metrics.conversions
  return `${formatNumber(conversions)} conversion${conversions === 1 ? '' : 's'} from ${formatNumber(metrics.counts.delivered)} delivered`
}

/** "Against a planned spend of $5,000.00 and a target of 400 conversions.", leaving out what has no target; null when neither has one */
export function economicsSubline(targets: CampaignTargets): string | null {
  const planned = [toNumber(targets.planned_cost), toNumber(targets.planned_offer_cost)].filter((value): value is number => value !== null)
  const parts = [
    planned.length > 0 && `a planned spend of ${formatMoney(planned.reduce((sum, value) => sum + value, 0))}`,
    targets.target_conversions !== null && targets.target_conversions !== undefined && `a target of ${formatNumber(targets.target_conversions)} conversion${targets.target_conversions === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return parts.length ? `Against ${parts.join(' and ')}.` : null
}

/** targets that were saved but hold nothing count as none */
export function hasTargets(targets: CampaignTargets | null): targets is CampaignTargets {
  if (!targets) return false
  const { notes, ...measures } = targets
  return Boolean(notes?.trim()) || Object.values(measures).some((value) => value !== null && value !== undefined && value !== '')
}
