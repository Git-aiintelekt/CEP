import { useQuery } from '@tanstack/react-query'

import { usePreviewContent } from '@/apps/cep/features/templates/preview/usePreviewContent'
import { api } from '@/lib/api'
import type { Campaign, CampaignPreview, Template } from '@/lib/types'

/** GET /campaigns/:id/preview/, shared by everything that shows the message so it is fetched once. 409 means no content yet. */
/** `stepId`: one message of a drip (?step=) */
export function useCampaignPreview(campaignId: string, { templateId = '', party = '', stepId = '', enabled = true }: { templateId?: string; party?: string; stepId?: string; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['campaigns', 'preview', campaignId, templateId, party, stepId],
    queryFn: ({ signal }) => api.get<CampaignPreview & { channel?: string }>(`/campaigns/${campaignId}/preview/`, { template: templateId || undefined, party_id: party, step: stepId || undefined }, signal),
    retry: false,
    enabled,
  })
}

export interface SampleCustomer { party_id: string; name: string; address: string | null }

/** the audience's first customers, for "Preview as" */
export function useSampleCustomers(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['campaigns', 'sample-customers', campaignId],
    queryFn: ({ signal }) => api.get<SampleCustomer[]>(`/campaigns/${campaignId}/sample-customers/`, undefined, signal),
    enabled,
  })
}

/** the template's channel (a multi-channel campaign's is known once the preview call reports it), the preview and the template's content */
export function useCampaignMessage(campaign: Campaign) {
  const known = campaign.campaign_type === 'E_RECEIPT' ? 'E_RECEIPT' : campaign.channel === 'MULTI' ? null : campaign.channel
  const isTextCampaign = known === 'SMS' || known === 'MMS'
  const preview = useCampaignPreview(campaign.id, { enabled: Boolean(campaign.template) && !isTextCampaign })
  const channel = known ?? (preview.data as { channel?: string } | undefined)?.channel ?? null
  const templateItem = { kind: 'template' as const, template: { id: campaign.template ?? '', name: campaign.template_name ?? '', channel: channel ?? '' } as Template }
  const content = usePreviewContent(templateItem, { enabled: Boolean(campaign.template && channel) })
  return { channel, preview, content }
}

export type CampaignMessage = ReturnType<typeof useCampaignMessage>
