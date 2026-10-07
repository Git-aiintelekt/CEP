/**
 * The quick view's two columns for a drip. The thumbnail shows one message at a time, labelled with its place and state
 * ("Message 3 of 4 · Next, Mon 19 Oct"), with ‹ › to the others. The details list every message (each row picks the
 * thumbnail), the key figures ("–" until there are results) and the sender, topic and the shown message's subject.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { IconButton } from '@/components/Button'
import { SkeletonLine } from '@/components/States'
import { resolvedText, usePreviewContent } from '@/features/templates/preview/usePreviewContent'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Campaign, CampaignMetrics, DripStep } from '@/lib/types'

import { Detail } from './CampaignPreviewDetails'
import { NoContent, TextThumbnail } from './CampaignThumbnail'
import { StepTag } from './detail/StepTag'
import { previewState, stepWhen, thumbnailLabel } from './dripPeek'
import { messageTitle, type Series } from './dripSequence'
import { MessagePreview } from './MessagePreview'
import { templateItem } from './sequence/messageContent'
import { hasResults } from './vocabulary'

const LIST_KIND: Record<string, string> = { STATIC: 'Static List', DYNAMIC: 'Dynamic List', SEGMENT: 'Segment', DERIVED: 'Derived List' }

function StepText({ campaign, step }: { campaign: Campaign; step: DripStep }) {
  const content = usePreviewContent(templateItem(step.template!))
  if (content.data?.kind === 'message' && content.tagsReady) {
    return <TextThumbnail channel={campaign.channel} data={content.data} tags={content.tags} sender={campaign.sender_profile_name ?? 'Your brand'} />
  }
  return <SkeletonLine width="100%" height={240} />
}

interface ColumnProps {
  campaign: Campaign
  steps: DripStep[] | undefined
  index: number
  onIndex: (index: number) => void
  series: Series
}

export function DripThumbnailColumn({ campaign, steps, index, onIndex, series }: ColumnProps) {
  if (!steps) return <div aria-busy className="flex w-full flex-col gap-3"><SkeletonLine width="60%" /><SkeletonLine width="100%" height={240} /></div>
  const step = steps[index]
  if (!step) return <NoContent />
  const texts = campaign.channel === 'SMS' || campaign.channel === 'MMS'
  return (
    <div className="flex w-full flex-col gap-3" data-drip-thumbnail>
      <div className="flex items-center justify-between gap-2">
        <span className="cep-num min-w-0 text-helper font-semibold text-ink-900" aria-live="polite" data-thumb-label>{thumbnailLabel(campaign, step, steps.length, series)}</span>
        <span className="flex shrink-0">
          <IconButton label="Previous Message" icon={ChevronLeft} size="sm" softDisabled={index === 0} onClick={() => index > 0 && onIndex(index - 1)} />
          <IconButton label="Next Message" icon={ChevronRight} size="sm" softDisabled={index >= steps.length - 1} onClick={() => index < steps.length - 1 && onIndex(index + 1)} />
        </span>
      </div>
      {!step.template ? <NoContent text="This message has no template yet" />
      : texts ? <StepText key={step.id} campaign={campaign} step={step} />
      : <div className="w-full"><MessagePreview key={step.id} campaignId={campaign.id} stepId={step.id} compact /></div>}
    </div>
  )
}

/** the shown message's subject, with sample values as the rest of the quick view reads */
function StepSubject({ step }: { step: DripStep }) {
  const content = usePreviewContent(templateItem(step.template ?? { id: '', name: '', channel: 'EMAIL', status: '' }), { enabled: Boolean(step.template) })
  if (!step.subject_line) return <Detail label={`Subject Line · Message ${step.position}`} state="missing" text="Uses the template’s subject line" />
  return <Detail label={`Subject Line · Message ${step.position}`} state="ready" value={content.tagsReady ? resolvedText(step.subject_line, content.tags) : step.subject_line} />
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-helper text-ink-800">{label}</dt>
      <dd className="cep-num text-card-title font-semibold text-ink-900">{value}</dd>
    </div>
  )
}

export function DripPreviewDetails({ campaign, steps, index, onIndex, series }: ColumnProps) {
  const texts = campaign.channel === 'SMS' || campaign.channel === 'MMS'
  const results = hasResults(campaign)
  const metrics = useQuery({
    queryKey: ['campaigns', 'metrics', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignMetrics>(`/campaigns/${campaign.id}/metrics/`, undefined, signal),
    enabled: results,
  })
  // nothing sent yet reads "–", never "0"
  const went = results && Boolean(metrics.data?.counts.sent)
  const rate = (value: number | undefined) => (went && value !== undefined ? `${value}%` : '–')
  const step = steps?.[index]
  const lists = campaign.contact_list_details.filter((list) => list.role !== 'EXCLUDE')
  const listCount = Math.max(lists.length, campaign.contact_lists.length)

  return (
    <div className="flex flex-col gap-[18px]">
      <section aria-label="Messages" className="flex flex-col gap-2">
        <span className="text-helper font-semibold text-ink-800">Messages</span>
        {!steps ? <SkeletonLine width="100%" /> : (
          <ol className="flex flex-col divide-y divide-line-subtle rounded-lg border border-line">
            {steps.map((item, at) => {
              const when = stepWhen(item, series)
              return (
                <li key={item.id}>
                  <button type="button" aria-current={at === index || undefined} onClick={() => onIndex(at)} data-preview-message={item.position}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors duration-fast ease-standard ${at === index ? 'bg-fill-subtle' : 'hover:bg-surface-subtle'}`}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-ink-900">{item.position} · {messageTitle(item)}</span>
                      <span className="cep-num text-xs text-ink-800">{when ? when.day : `Day ${item.day}`}</span>
                    </span>
                    <StepTag state={previewState(campaign, item)} />
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <dl className="grid grid-cols-3 gap-3" data-preview-figures>
        <Figure label="Campaign List" value={campaign.audience_size === null ? '–' : formatNumber(campaign.audience_size)} />
        {texts ? <Figure label="Click Rate" value={rate(metrics.data?.rates.click)} /> : <Figure label="Open Rate" value={rate(metrics.data?.rates.open)} />}
        <Figure label="Conversions" value={went && metrics.data ? formatNumber(metrics.data.conversions) : '–'} />
      </dl>

      {campaign.campaign_type !== 'E_RECEIPT' && (
        <Detail label="Contact List" {...(lists[0]
          ? { state: 'ready' as const, value: `${lists[0].name}${listCount > 1 ? ` and ${listCount - 1} more` : ''}`, secondary: [LIST_KIND[lists[0].list_kind] ?? lists[0].list_kind, lists[0].list_environment === 'TEST' ? 'Test' : 'Production'].join(' · ') }
          : { state: 'missing' as const, hint: 'Choose contact lists on the Audience step' })} />
      )}
      <Detail label="Sender" {...(campaign.sender_profile_name ? { state: 'ready' as const, value: campaign.sender_profile_name } : { state: 'missing' as const, hint: 'Choose a sender on the Drip Campaign Setup step' })} />
      {campaign.topic_name && <Detail label="Topic" state="ready" value={campaign.topic_name} />}
      {!texts && step && <StepSubject key={step.id} step={step} />}
    </div>
  )
}
