/**
 * "Run #n failed": shown while the latest production run is the failed one. A run carries no error of its own; the
 * send engine writes it to the activity log against the run, so the banner reads it from there (the Activity log
 * tab's own request, shared).
 */
import { useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'

import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { api } from '@/lib/api'
import type { Campaign, CampaignActivity, CampaignRun } from '@/lib/types'

export function FailedRunBanner({ campaign, run, onView }: { campaign: Campaign; run: CampaignRun; onView?: () => void }) {
  const activity = useQuery({
    queryKey: ['campaigns', 'activity', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignActivity[]>(`/campaigns/${campaign.id}/activity/`, undefined, signal),
  })
  const reason = activity.data?.filter((entry) => entry.campaign_run_id === run.id && entry.severity === 'ERROR')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0]?.message
  return (
    <Notice tone="error" layout="banner" icon={CircleAlert} iconTile title={`Run #${run.run_number} failed`}
      action={onView && <Button size="sm" onClick={onView}>View Run</Button>}>
      <p>{reason ?? 'The send stopped before it finished.'}</p>
    </Notice>
  )
}
