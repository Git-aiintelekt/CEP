/** The campaign's results, as Overview's Metrics card and the Performance tab both ask for them, and the line saying how fresh they are. */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import type { Campaign, CampaignMetrics } from '@/lib/types'

import { dateInZone } from '../zone'

export function useCampaignMetrics(campaign: Campaign, live: boolean) {
  return useQuery({
    queryKey: ['campaigns', 'metrics', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignMetrics>(`/campaigns/${campaign.id}/metrics/`, undefined, signal),
    refetchInterval: live ? 5000 : false,
  })
}

/** "Last sent 18 Sept 2026 · updated 2 minutes ago" */
export function resultsStamp(campaign: Campaign, zone: string, updatedAt: number | null): string {
  const lastSent = campaign.runs.filter((run) => !run.test_mode && run.started_at).map((run) => run.started_at!).sort().at(-1)
  return [lastSent && `Last sent ${dateInZone(lastSent, zone)}`, updatedAt && `updated ${formatRelative(new Date(updatedAt).toISOString())}`].filter(Boolean).join(' · ')
}
