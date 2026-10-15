/** A drip's messages (GET /campaigns/{id}/steps/): one query and one cache key for every screen that reads them. */
import { api } from '@/lib/api'
import type { DripStep } from '@/lib/types'

export const dripStepsKey = (campaignId: string) => ['campaigns', 'steps', campaignId] as const

export const dripStepsQuery = (campaignId: string) => ({
  queryKey: dripStepsKey(campaignId),
  queryFn: ({ signal }: { signal: AbortSignal }) => api.get<DripStep[]>(`/campaigns/${campaignId}/steps/`, undefined, signal),
})
