/** The data behind the cost cards: the estimate, a sent campaign's actual cost, the template line's figures, the limit tag. */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { CampaignActualCost, CostEstimate, MessagePrices } from '@/lib/types'

import { costMoney, unitMoney, useSeesCosts } from './money'

export type ReadyEstimate = Extract<CostEstimate, { available: true }>
type Ready = ReadyEstimate

const PER_THOUSAND = 1000

export function useCostEstimate(campaignId: string | undefined, include?: string[], exclude?: string[], enabled = true) {
  const sees = useSeesCosts()
  return useQuery({
    queryKey: ['campaigns', campaignId, 'cost-estimate', include ?? null, exclude ?? null],
    queryFn: () => api.post<CostEstimate>(`/campaigns/${campaignId}/cost/`, include ? { include, exclude: exclude ?? [] } : {}),
    enabled: Boolean(campaignId) && sees && enabled,
    staleTime: 30_000,
    retry: false,
  })
}

/** the tag beside the title: the limit it is over, or Within Limits */
export function limitTag(estimate: Ready): { text: string; tone: 'warning' | 'danger' | 'ok' } | null {
  const check = estimate.check
  if (!check) return null
  const over = check.approval_above && Number(estimate.total) > Number(check.approval_above)
  if (check.state === 'BLOCK') return { text: 'Over Budget', tone: 'danger' }
  if (over) return { text: `Over ${costMoney(check.approval_above, estimate.currency)} Limit`, tone: 'warning' }
  if (check.state === 'APPROVAL' || check.state === 'WARN') return { text: 'Over Budget', tone: 'warning' }
  if (check.approval_above || check.monthly_budget) return { text: 'Within Limits', tone: 'ok' }
  return null
}

export function useCampaignCost(campaignId: string | undefined, enabled = true) {
  const sees = useSeesCosts()
  return useQuery({
    queryKey: ['campaigns', campaignId, 'cost'],
    queryFn: ({ signal }) => api.get<{ actual: CampaignActualCost | null; estimate: { total: string } | null }>(`/campaigns/${campaignId}/cost/`, undefined, signal),
    enabled: Boolean(campaignId) && sees && enabled,
    staleTime: 30_000,
    retry: false,
  })
}

export function textCostLine(prices: MessagePrices | undefined, channel: 'SMS' | 'MMS', segments: number): { headline: string; detail: string } | null {
  const price = channel === 'MMS' ? prices?.mms ?? null : prices?.sms ?? null
  if (!prices || !price) return null
  const each = Number(price.each)
  const fee = Number(price.fee) || 0
  const units = channel === 'MMS' ? 1 : Math.max(segments, 1)
  const total = units * (each + fee)
  const currency = prices.currency
  const headline = `${channel === 'SMS' ? 'About ' : ''}${unitMoney(total, currency)} a recipient · ${costMoney(total * PER_THOUSAND, currency)} per 1,000`
  const feeWords = fee ? ` + ${unitMoney(fee, currency)} carrier fee` : ''
  const detail = channel === 'MMS'
    ? `MMS ${unitMoney(each, currency)}${feeWords}, any length.`
    : `${units} part${units === 1 ? '' : 's'} × (${unitMoney(each, currency)}${feeWords}).`
  return { headline, detail }
}
