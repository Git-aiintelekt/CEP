/** What a drip's Test & Publish step reads besides the messages: the review timeline and the checklist. */
import { api } from '@/lib/api'
import type { CampaignChecklist, DripReview } from '@/lib/types'

export const dripReviewQuery = (campaignId: string) => ({
  queryKey: ['campaigns', 'steps-review', campaignId] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => api.get<DripReview>(`/campaigns/${campaignId}/steps/review/`, undefined, signal),
})

/** the drip's own key: what it says follows the messages (a test, a change), not only the campaign's row_version */
export const dripChecklistQuery = (campaignId: string) => ({
  queryKey: ['campaigns', 'checklist', campaignId, 'drip'] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => api.get<CampaignChecklist>(`/campaigns/${campaignId}/checklist/`, undefined, signal),
})
