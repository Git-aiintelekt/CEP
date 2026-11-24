/**
 * Estimated Cost (docs/mockups/sms-mms-costs.html, option A): beside Estimated Recipients on the Audience step, and again on Review &
 * Publish. Only people who can receive the campaign are counted; once the template is picked, each one's own text is filled in and
 * its parts counted. Before that it is a "from" price, one part each. Shown to people with View Message Costs, once the platform
 * team has set prices: until then nothing at all appears.
 */
import { SkeletonLine } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { formatDate, formatNumber } from '@/lib/format'

import { CardError, DetailCard } from '../campaigns/parts'
import { limitTag, useCostEstimate, type ReadyEstimate } from './data'
import { costMoney, unitMoney, useSeesCosts } from './money'

type Ready = ReadyEstimate

const TAG_TONE = { warning: 'warning', danger: 'error', ok: 'neutral' } as const

export function CostTag({ estimate }: { estimate: Ready }) {
  const tag = limitTag(estimate)
  if (!tag) return null
  return <span data-cost-tag={tag.tone}><Tag tone={TAG_TONE[tag.tone]}>{tag.text}</Tag></span>
}

function lineWords(line: { label: string; units: number; each: string }, currency: string | null, channel: string): string {
  if (channel === 'WHATSAPP') return `${line.label}, ${formatNumber(line.units)} × ${unitMoney(line.each, currency)}`
  if (line.label === 'Carrier fees') return `Carrier fees, ${formatNumber(line.units)} × ${unitMoney(line.each, currency)}`
  return `${formatNumber(line.units)} ${line.label} × ${unitMoney(line.each, currency)}`
}

export function CostBreakdown({ estimate }: { estimate: Ready }) {
  const currency = estimate.currency
  const prefix = estimate.from_price ? 'From ' : estimate.upto ? 'Up to ' : ''
  const check = estimate.check
  return (
    <div className="flex flex-col gap-4" data-cost-estimate>
      <p className="cep-num font-display text-kpi font-semibold text-ink-900">{prefix}{costMoney(estimate.total, currency)}</p>
      {estimate.from_price ? (
        <p className="text-helper text-ink-800">
          {formatNumber(estimate.recipients)} recipients × 1 part × ({unitMoney(estimate.each, currency)}{estimate.lines.some((line) => line.label === 'Carrier fees') ? ' + carrier fee' : ''}).
          Pick the template to see the exact figure: an emoji or a long message adds parts.
        </p>
      ) : (
        <>
          {estimate.parts.length > 1 && (
            <table className="cep-num w-full text-sm" aria-label="Parts each">
              <thead><tr className="text-left text-helper text-ink-800"><th className="font-semibold">Parts Each</th><th className="text-right font-semibold">People</th><th className="text-right font-semibold">Parts</th></tr></thead>
              <tbody>
                {estimate.parts.map((row) => (
                  <tr key={row.parts} className="border-t border-line-subtle"><td className="py-1">{row.parts} part{row.parts === 1 ? '' : 's'}</td><td className="py-1 text-right">{formatNumber(row.people)}</td><td className="py-1 text-right">{formatNumber(row.units)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <dl className="cep-num flex flex-col gap-1 text-sm">
            {estimate.lines.map((line) => (
              <div key={`${line.label}-${line.each}`} className="flex justify-between gap-3"><dt className="text-ink-800">{lineWords(line, currency, estimate.channel)}</dt><dd className="text-ink-900">{costMoney(line.total, currency)}</dd></div>
            ))}
            <div className="flex justify-between gap-3 border-t border-line-subtle pt-1 font-semibold"><dt className="text-ink-900">Estimated total</dt><dd className="text-ink-900">{costMoney(estimate.total, currency)}</dd></div>
          </dl>
          <p className="text-helper text-ink-800">
            {estimate.per_recipient && <>About {unitMoney(estimate.per_recipient, currency)} a recipient. </>}
            {estimate.channel === 'WHATSAPP'
              ? `${titleOf(estimate.category)} template, charged per delivered message. If everyone receives it: undelivered messages cost nothing, so the actual is usually lower.`
              : `${estimate.sender} price on ${formatDate(estimate.price_date)}.`}
            {!estimate.exact && ` Counted from a sample of ${formatNumber(estimate.counted)} people.`}
          </p>
        </>
      )}
      {estimate.unpriced > 0 && <p className="text-helper text-warning-text">{formatNumber(estimate.unpriced)} {estimate.unpriced === 1 ? 'person has a number' : 'people have numbers'} in a country with no price: not counted here.</p>}
      {(estimate.country_not_chosen ?? 0) > 0 && <p className="text-helper text-ink-800">{formatNumber(estimate.country_not_chosen ?? 0)} in a country not chosen for WhatsApp (Settings → Message Costs) are left out.</p>}
      {check && (check.message || check.after) && (
        <p className={`text-helper ${check.state === 'OK' ? 'text-ink-800' : check.state === 'BLOCK' ? 'font-medium text-danger-text' : 'text-warning-text'}`} data-cost-check={check.state}>
          {check.state === 'APPROVAL' && 'An approver signs it off before Publish to Production. '}
          {check.state === 'BLOCK' && 'Publishing is blocked until the budget allows it. '}
          {check.message}
          {check.after && check.monthly_budget && ` This month after this: ${costMoney(check.after, currency)} of ${costMoney(check.monthly_budget, currency)}.`}
        </p>
      )}
    </div>
  )
}

function titleOf(category?: string) {
  return category ? category.charAt(0) + category.slice(1).toLowerCase() : 'Marketing'
}

/** the card on the Audience and Review steps; nothing for people without the permission or before prices are set */
export function CostEstimateCard({ campaignId, include, exclude, enabled = true }: { campaignId?: string; include?: string[]; exclude?: string[]; enabled?: boolean }) {
  const sees = useSeesCosts()
  const estimate = useCostEstimate(campaignId, include, exclude, enabled)
  if (!sees || !campaignId || !enabled) return null
  if (estimate.isError) return <DetailCard title="Estimated Cost"><CardError what="the estimate" error={estimate.error} onRetry={() => void estimate.refetch()} /></DetailCard>
  if (!estimate.data) return <DetailCard title="Estimated Cost"><div aria-busy className="flex flex-col gap-3"><SkeletonLine width="40%" /><SkeletonLine width="90%" /></div></DetailCard>
  const data = estimate.data
  if (!data.available) return null
  return (
    <DetailCard title="Estimated Cost" tag={<CostTag estimate={data} />} description="Only people who can receive it are counted.">
      <div className={`transition-opacity duration-base ${estimate.isFetching ? 'opacity-60' : ''}`} aria-busy={estimate.isFetching || undefined}>
        <CostBreakdown estimate={data} />
      </div>
    </DetailCard>
  )
}
