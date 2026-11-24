/**
 * Cost on a text campaign's results: the actual figure, counted from the parts each message used (SMS, MMS) or from Meta's
 * delivery reports (WhatsApp), next to the estimate made at publish. While it is still sending, the figure so far.
 */
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { formatNumber } from '@/lib/format'
import type { CampaignActualCost } from '@/lib/types'

import { DetailCard } from '../campaigns/parts'
import { useCampaignCost } from './data'
import { costMoney, unitMoney, useSeesCosts } from './money'

function difference(actual: CampaignActualCost): { text: string; tone: 'neutral' | 'warning' } | null {
  if (actual.sending || actual.estimate === null) return null
  const gap = Number(actual.total) - Number(actual.estimate)
  if (Math.abs(gap) < 0.005) return { text: 'As Estimated', tone: 'neutral' }
  return gap < 0 ? { text: `${costMoney(-gap, actual.currency)} Under Estimate`, tone: 'neutral' } : { text: `${costMoney(gap, actual.currency)} Over Estimate`, tone: 'warning' }
}

export function CostResult({ actual }: { actual: CampaignActualCost }) {
  const currency = actual.currency
  const whatsapp = actual.channel === 'WHATSAPP'
  return (
    <div className="flex flex-col gap-3" data-campaign-cost>
      <dl className="cep-num flex flex-col gap-1 text-sm">
        {actual.lines.map((line) => (
          <div key={`${line.label}-${line.each}`} className="flex justify-between gap-3">
            <dt className="text-ink-800">{whatsapp || line.label === 'Carrier fees' || line.label.startsWith('Platform') ? `${line.label}, ${formatNumber(line.units)} × ${unitMoney(line.each, currency)}` : `${formatNumber(line.units)} ${line.label} × ${unitMoney(line.each, currency)}`}</dt>
            <dd className="text-ink-900">{costMoney(line.total, currency)}</dd>
          </div>
        ))}
        {whatsapp && actual.not_charged > 0 && <div className="flex justify-between gap-3"><dt className="text-ink-800">Not delivered (not on WhatsApp, blocked), {formatNumber(actual.not_charged)}</dt><dd className="text-ink-900">{costMoney(0, currency)}</dd></div>}
        {whatsapp && actual.free > 0 && <div className="flex justify-between gap-3"><dt className="text-ink-800">Free: the customer wrote in the last 24 hours, {formatNumber(actual.free)}</dt><dd className="text-ink-900">{costMoney(0, currency)}</dd></div>}
        <div className="flex justify-between gap-3 border-t border-line-subtle pt-1 font-semibold"><dt className="text-ink-900">{actual.sending ? 'So far' : 'Actual cost'}</dt><dd className="text-ink-900">{costMoney(actual.total, currency)}</dd></div>
      </dl>
      <p className="text-helper text-ink-800">
        {actual.estimate !== null && <>Estimated {costMoney(actual.estimate, currency)} at publish. </>}
        {actual.failed_included > 0 && `${formatNumber(actual.failed_included)} failed message${actual.failed_included === 1 ? ' is' : 's are'} included: carriers charge for attempts. `}
        {!whatsapp && actual.not_charged > 0 && `${formatNumber(actual.not_charged)} failed message${actual.not_charged === 1 ? ' is' : 's are'} not charged. `}
        {actual.unpriced > 0 && `${formatNumber(actual.unpriced)} went to a country with no price and are not counted.`}
      </p>
    </div>
  )
}

export function CampaignCostCard({ campaignId }: { campaignId: string }) {
  const sees = useSeesCosts()
  const cost = useCampaignCost(campaignId)
  const actual = cost.data?.actual
  if (!sees || !actual) return null
  const gap = difference(actual)
  return (
    <DetailCard title="Cost" tag={actual.sending ? <StatusBadge status="SENDING" label="Sending" /> : gap ? <Tag tone={gap.tone}>{gap.text}</Tag> : undefined}
      description={actual.channel === 'WHATSAPP' ? "From Meta's delivery reports." : 'Counted from the parts each message used.'}>
      <CostResult actual={actual} />
    </DetailCard>
  )
}
