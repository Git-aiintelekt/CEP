/** A text message's template content, the tag catalogue, and the counter the drawer shows under the text. */
import { useQuery } from '@tanstack/react-query'

import { renderWithSamples, smsMetrics } from '@/apps/cep/features/messaging/sms'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Message, Page, PersonalizationTag } from '@/lib/types'

export function useTemplateMessage(templateId: string | null) {
  return useQuery({
    queryKey: ['templates', 'message', templateId],
    queryFn: ({ signal }) => api.get<Message>(`/templates/${templateId}/message/`, undefined, signal),
    enabled: Boolean(templateId),
  })
}

export function usePersonalizationTags() {
  return useQuery({
    queryKey: ['personalization-tags', 'all'],
    queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal),
  })
}

/** "60 / 160 · 1 part" for SMS, "60 / 1,600" for MMS: counted with each tag's sample value, as the composer counts */
export function counterText(text: string, tags: PersonalizationTag[], mms: boolean): { text: string; over: boolean } {
  const metrics = smsMetrics(renderWithSamples(text, tags))
  if (mms) return { text: `${formatNumber(metrics.units)} / 1,600`, over: metrics.units > 1600 }
  const single = metrics.encoding === 'GSM-7' ? 160 : 70
  const parts = Math.max(1, metrics.segments)
  return { text: `${formatNumber(metrics.units)} / ${single} · ${parts} ${parts === 1 ? 'part' : 'parts'}`, over: parts > 1 }
}
