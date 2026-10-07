/**
 * "Run #n failed": shown while the latest production run is the failed one. A run carries no error of its own; the
 * send engine writes it to the activity log against the run, so the banner reads it from there (the Activity log
 * tab's own request, shared).
 */
import { useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { api } from '@/lib/api'
import type { Campaign, CampaignActivity, CampaignRun } from '@/lib/types'

/** A drip names the message: `title` "Message 3 failed", `extra` Retry Message, `note` why it can't be retried */
export function FailedRunBanner({ campaign, run, onView, title, extra, note }: {
  campaign: Campaign; run: Pick<CampaignRun, 'id' | 'run_number'>; onView?: () => void; title?: string; extra?: ReactNode; note?: string | null
}) {
  const activity = useQuery({
    queryKey: ['campaigns', 'activity', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignActivity[]>(`/campaigns/${campaign.id}/activity/`, undefined, signal),
  })
  const reason = activity.data?.filter((entry) => entry.campaign_run_id === run.id && entry.severity === 'ERROR')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0]?.message
  return (
    <Notice tone="error" layout="banner" icon={CircleAlert} iconTile title={title ?? `Run #${run.run_number} failed`}
      action={(onView || extra) && <span className="flex flex-wrap gap-2">{extra}{onView && <Button size="sm" onClick={onView}>View Run</Button>}</span>}>
      <p>{reason ?? 'The send stopped before it finished.'}</p>
      {note && <p className="mt-1">{note}</p>}
    </Notice>
  )
}
