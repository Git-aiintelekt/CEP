/**
 * The quick view's details column: what the campaign is built from, never what its row already says. Subject and
 * preheader read with sample values, as the thumbnail does. Template and contact list come with the row; the rest
 * waits on the template's content and the sender list, and shows a grey bar until then.
 */
import { ExternalLink, Workflow } from 'lucide-react'

import { SkeletonLine } from '@/components/States'
import type { Campaign, PersonalizationTag } from '@/lib/types'

import { useMessageDetails, type ContentQuery, type DetailState } from './messageDetails'

/** the contact list's kind; the source wording ("Upload", "BI Extract") isn't in the campaign's list details */
const LIST_KIND: Record<string, string> = { STATIC: 'Static List', DYNAMIC: 'Dynamic List', SEGMENT: 'Segment', DERIVED: 'Derived List' }

export function Detail({ label, ...detail }: { label: string } & DetailState) {
  return (
    <div className="flex flex-col gap-1" data-detail={label}>
      <span className="text-helper font-semibold text-ink-500">{label}</span>
      {detail.state === 'loading' ? <SkeletonLine width={detail.width} />
      : detail.state === 'error' ? (
        <span className="flex flex-wrap items-center gap-2 text-helper text-ink-500">
          Couldn’t load this
          <button type="button" onClick={detail.onRetry} className="font-semibold text-brand-600 hover:underline">Retry</button>
        </span>
      ) : detail.state === 'missing' ? (
        <>
          <span className="text-card-title text-ink-500">{detail.text ?? 'Not set yet'}</span>
          {detail.hint && <span className="text-helper text-ink-500">{detail.hint}</span>}
        </>
      ) : (
        <>
          <span className="cep-num text-card-title break-words text-ink-900">{detail.value}</span>
          {detail.secondary && <span className="cep-num text-helper break-words text-ink-500">{detail.secondary}</span>}
        </>
      )}
    </div>
  )
}

interface DetailsProps {
  campaign: Campaign
  /** the template's channel (a multi-channel campaign's is known once the preview answers); null while unknown */
  channel: string | null
  content: ContentQuery
  tags: PersonalizationTag[]
}

export function CampaignPreviewDetails({ campaign, channel, content, tags }: DetailsProps) {
  const details = useMessageDetails({ campaign, channel, content, tags })
  const journey = campaign.is_journey_generated
  const isText = channel === 'SMS' || channel === 'MMS'
  const lists = campaign.contact_list_details.filter((list) => list.role !== 'EXCLUDE')
  const listCount = Math.max(lists.length, campaign.contact_lists.length)
  const noTemplate: DetailState = { state: 'missing', hint: 'Choose a template on the Content step' }

  return (
    <div aria-busy={details.loading || undefined} className="flex flex-col gap-[18px]">
      {journey && (
        <div className="flex flex-col gap-2 border-b border-line-subtle pb-[18px]">
          <span className="flex items-center gap-2 text-helper text-ink-500"><Workflow size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />Journey-Generated · Read Only</span>
          <a href="/journeys" target="_blank" rel="noreferrer" aria-label="View Journey (opens in a new tab)"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
            View Journey
            <ExternalLink size={16} strokeWidth={1.5} aria-hidden />
          </a>
        </div>
      )}

      <Detail label="Template" {...(campaign.template_name ? { state: 'ready', value: `Based on ${campaign.template_name}` } : noTemplate)} />

      {campaign.campaign_type !== 'E_RECEIPT' && (
        <Detail label="Contact List" {...(
          lists[0] ? { state: 'ready', value: `${lists[0].name}${listCount > 1 ? ` and ${listCount - 1} more` : ''}`, secondary: [LIST_KIND[lists[0].list_kind] ?? lists[0].list_kind, lists[0].list_environment === 'TEST' ? 'Test' : 'Production'].join(' · ') }
          : journey ? { state: 'missing', text: 'Managed by the journey' }
          : { state: 'missing', hint: 'Choose contact lists on the Audience step' }
        ) as DetailState} />
      )}

      {channel === 'EMAIL' && (
        <>
          <Detail label="Subject Line" {...details.subject(false)} />
          <Detail label="Preheader" {...details.preheader()} />
          <Detail label="Sender" {...details.sender()} />
        </>
      )}

      {isText && (
        <>
          <Detail label="Sender" {...details.sender()} />
          {channel === 'SMS' && campaign.template && <Detail label="Length" {...details.length()} />}
        </>
      )}

      {channel === 'E_RECEIPT' && (
        <>
          <Detail label="Subject Line" {...details.subject(true)} />
          <Detail label="Sender" {...details.sender()} />
          <Detail label="Receipt Layout" {...details.receiptLayout()} />
        </>
      )}
    </div>
  )
}
