/**
 * A production run's subject line test: A and B side by side with their figures, the one that won, or, while the rest of
 * the audience waits, when the winner will be chosen and the option to choose it now (campaign.publish).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trophy } from 'lucide-react'
import { useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { CampaignRun, CampaignRunDetail, CampaignRunVariant } from '@/lib/types'

import { metricText } from '../subjectTest'
import { dateTimeInZone } from '../zone'

const rate = (value: number | undefined) => (value === undefined ? '—' : `${value.toFixed(1)}%`)

export function SubjectTestResults({ campaignId, run, zone }: { campaignId: string; run: CampaignRun; zone: string }) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [choosing, setChoosing] = useState<CampaignRunVariant | null>(null)
  const detail = useQuery({
    queryKey: ['campaigns', 'run', campaignId, run.id],
    queryFn: ({ signal }) => api.get<CampaignRunDetail>(`/campaigns/${campaignId}/runs/${run.id}/`, undefined, signal),
  })
  const choose = useMutation({
    mutationFn: (variant: 'A' | 'B') => api.post(`/campaigns/${campaignId}/runs/${run.id}/choose-winner/`, { variant }),
    onSuccess: async () => {
      setChoosing(null)
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })

  const variants = detail.data?.variants ?? []
  if (detail.isError) return <ErrorState title="The subject line test could not be loaded" error={detail.error} onRetry={() => void detail.refetch()} />
  if (variants.length === 0) return null
  const decided = variants.some((variant) => variant.is_winner)
  const waiting = variants[0].waiting_for_winner
  const metric = variants[0].winner_metric ?? 'OPEN_RATE'

  return (
    <section aria-labelledby={`ab-${run.id}`} className="mb-4 rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
        <h3 id={`ab-${run.id}`} className="font-display text-card-heading font-semibold text-ink-900">Subject Line Test</h3>
        {decided ? <Tag tone="success">Winner Chosen</Tag> : <Tag tone="warning">Deciding</Tag>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Subject line A and B with their results</caption>
          <thead>
            <tr className="border-b border-line bg-surface-subtle">
              {['Variant', 'Subject', 'Sent', 'Open Rate', 'Click Rate'].map((label, index) => (
                <th key={label} scope="col" className={`h-10 px-4 text-xs font-semibold text-ink-700 ${index >= 2 ? 'text-right' : 'text-left'}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => (
              <tr key={variant.variant_key} className={`border-b border-line-subtle last:border-b-0 ${variant.is_winner ? 'bg-success-bg' : ''}`}>
                <th scope="row" className="h-12 px-4 text-left font-semibold text-ink-900">
                  <span className="inline-flex items-center gap-1.5">{variant.variant_key}{variant.is_winner && <Trophy size={14} strokeWidth={1.5} className="text-success-text" aria-label="Winner" />}</span>
                </th>
                <td className="px-4 text-ink-900">{variant.subject_line ?? '—'}</td>
                <td className="cep-num px-4 text-right">{formatNumber(variant.sent ?? 0)}</td>
                <td className="cep-num px-4 text-right">{rate(variant.open_rate)}</td>
                <td className="cep-num px-4 text-right">{rate(variant.click_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle px-4 py-3 text-sm text-ink-700">
        {decided ? (
          <p>{variants.find((variant) => variant.is_winner)?.variant_key} won on {metricText(metric)} and went to the other {formatNumber(waiting)} people.</p>
        ) : (
          <p className="cep-num">
            {formatNumber(waiting)} people wait for the winner, chosen by {metricText(metric)}{variants[0].decide_at ? ` at ${dateTimeInZone(variants[0].decide_at, zone)}` : ''}. If the two are within 1 point, A wins.
          </p>
        )}
        {!decided && can('campaign.publish') && (
          <div className="flex gap-2">
            {variants.map((variant) => (
              <button key={variant.variant_key} type="button" className={buttonSecondary} onClick={() => setChoosing(variant)}>Send {variant.variant_key} to the Rest</button>
            ))}
          </div>
        )}
      </div>
      {choosing && (
        <Modal title={`Send ${choosing.variant_key} to the rest now?`} onClose={() => setChoosing(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setChoosing(null)}>Keep Waiting</button>
              <button type="button" className={buttonPrimary} disabled={choose.isPending} onClick={() => choose.mutate(choosing.variant_key)}>
                {choose.isPending && <Spinner size="sm" tone="onBrand" />}Send {choosing.variant_key}
              </button>
            </>
          }>
          <div className="space-y-2 text-sm text-ink-700">
            <p>The other <span className="cep-num">{formatNumber(waiting)}</span> people get subject {choosing.variant_key}: <strong className="text-ink-900">{choosing.subject_line}</strong></p>
            <p>This ends the test now instead of waiting for the {metricText(metric)}. It cannot be undone.</p>
            {choose.isError && <ErrorState title="The winner was not chosen" error={choose.error} />}
          </div>
        </Modal>
      )}
    </section>
  )
}
