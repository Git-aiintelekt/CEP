/**
 * What a campaign's message is made of, as the quick view and the Content tab's Details card both show it: sender,
 * subject and preheader with sample values (the campaign's own when it has them, else the template's), a text's length,
 * a receipt's layout. Each detail is ready, missing, still loading, or failed, and the caller draws it.
 */
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { smsMetrics } from '@/features/messaging/sms'
import { PRESET_CARDS } from '@/features/receipt/receiptPresets'
import { resolvedText, type PreviewContent } from '@/features/templates/preview/usePreviewContent'
import { api } from '@/lib/api'
import type { Campaign, PersonalizationTag, SenderProfile } from '@/lib/types'

import { SAMPLED, withSamples } from './sampleText'

export type DetailState =
  | { state: 'ready'; value: ReactNode; secondary?: ReactNode }
  | { state: 'missing'; hint?: string; text?: string }
  | { state: 'loading'; width: string }
  | { state: 'error'; onRetry: () => void }

export interface ContentQuery { data?: PreviewContent; isPending: boolean; isError: boolean; refetch: () => unknown }

/** tags that stand for the order a receipt is sent for (see receiptTags.ts) */
/** said under a subject or preheader the campaign has instead of the template's */
const OWN = 'Set for this campaign'

const ORDER_TAGS = new Set(['order_number', 'transaction_date', 'store_name', 'receipt_number', 'grand_total', 'subtotal', 'payment_method', 'shipping_address', 'store_address', 'delivery_estimate'])

/** each detail that waits on a request takes its state from it */
function fromContent(content: ContentQuery, width: string, ready: (data: PreviewContent) => DetailState): DetailState {
  if (content.isError) return { state: 'error', onRetry: () => void content.refetch() }
  if (content.isPending || !content.data) return { state: 'loading', width }
  return ready(content.data)
}

export function useMessageDetails({ campaign, channel, content, tags }: { campaign: Campaign; channel: string | null; content: ContentQuery; tags: PersonalizationTag[] }) {
  const senders = useQuery({
    queryKey: ['sender-profiles', 'options'],
    queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal),
    enabled: Boolean(campaign.sender_profile),
  })
  const hasTemplate = Boolean(campaign.template)
  const isText = channel === 'SMS' || channel === 'MMS'

  const sender = (): DetailState => {
    if (!campaign.sender_profile) return { state: 'missing', hint: 'Choose a sender on the Content step' }
    if (senders.isError) return { state: 'error', onRetry: () => void senders.refetch() }
    const found = senders.data?.find((item) => item.id === campaign.sender_profile)
    if (senders.isPending) return { state: 'loading', width: '62%' }
    const name = campaign.sender_profile_name ?? found?.display_name ?? 'Chosen'
    if (isText) return found?.sender_id ? { state: 'ready', value: found.sender_id, secondary: name } : { state: 'ready', value: name }
    return { state: 'ready', value: name, secondary: found?.from_address ?? undefined }
  }

  const subject = (receipt: boolean): DetailState =>
    !hasTemplate ? { state: 'missing', hint: 'Write a subject line on the Content step' }
    : fromContent(content, '78%', (data) => {
      const text = campaign.subject_line?.trim() || (data.kind === 'email' ? data.subject.trim() : '')
      if (data.kind !== 'email' || !text) return { state: 'missing', hint: 'Write a subject line on the Content step' }
      const fromOrder = receipt && Array.from(text.matchAll(/\{\{\s*([\w.]+)/g), (match) => match[1]).some((tag) => ORDER_TAGS.has(tag))
      const { value, sampled } = withSamples(text, tags)
      return { state: 'ready', value, secondary: [campaign.subject_line?.trim() && OWN, fromOrder && 'Generated from the order', sampled && SAMPLED].filter(Boolean).join(' · ') || undefined }
    })

  const preheader = (): DetailState =>
    !hasTemplate ? { state: 'missing', hint: 'Add the preview text shown after the subject' }
    : fromContent(content, '66%', (data) => {
      const text = campaign.preheader?.trim() || (data.kind === 'email' ? data.preheader.trim() : '')
      if (data.kind !== 'email' || !text) return { state: 'missing', hint: 'Add the preview text shown after the subject' }
      const { value, sampled } = withSamples(text, tags)
      return { state: 'ready', value, secondary: [campaign.preheader?.trim() && OWN, sampled && SAMPLED].filter(Boolean).join(' · ') || undefined }
    })

  const length = (): DetailState =>
    !hasTemplate ? { state: 'missing' }
    : fromContent(content, '58%', (data) => {
      if (data.kind !== 'message') return { state: 'missing' }
      const metrics = smsMetrics(resolvedText(data.body, tags))
      return { state: 'ready', value: `${metrics.units} characters · ${metrics.segments} segment${metrics.segments === 1 ? '' : 's'}`, secondary: metrics.encoding === 'UCS-2' ? 'Unicode' : undefined }
    })

  const receiptLayout = (): DetailState =>
    !hasTemplate ? { state: 'missing', hint: 'Choose a template on the Content step' }
    : fromContent(content, '72%', (data) => {
      const receipt = data.kind === 'email' ? data.receipt : undefined
      if (!receipt) return { state: 'missing' }
      const shown = [...receipt.sections].sort((a, b) => a.order - b.order).filter((section) => section.locked || section.visible).map((section) => section.label)
      const names = shown.map((label, index) => (index === 0 ? label : label.toLowerCase())).join(', ')
      return { state: 'ready', value: PRESET_CARDS.find((card) => card.value === receipt.preset)?.title ?? receipt.preset, secondary: names }
    })

  const loading = (hasTemplate && channel !== null && content.isPending) || (Boolean(campaign.sender_profile) && senders.isPending)
  return { sender, subject, preheader, length, receiptLayout, loading }
}
