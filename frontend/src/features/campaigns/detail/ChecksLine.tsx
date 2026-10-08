/** Whether the content is ready to send, in one line: the checklist's verdict, or why it no longer applies. */
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Lock } from 'lucide-react'

import { SkeletonLine } from '@/components/States'
import { api } from '@/lib/api'
import type { Campaign, CampaignChecklist } from '@/lib/types'

import { hasAction } from '../vocabulary'

export function ChecksLine({ campaign }: { campaign: Campaign }) {
  const locked = campaign.is_journey_generated || !hasAction(campaign, 'edit')
  const checklist = useQuery({
    queryKey: ['campaigns', 'checklist', campaign.id, campaign.row_version],
    queryFn: ({ signal }) => api.get<CampaignChecklist>(`/campaigns/${campaign.id}/checklist/`, undefined, signal),
    enabled: !locked,
  })
  const line = (Icon: typeof Lock, iconClass: string, text: string) => (
    <p className="flex items-center gap-2 text-helper font-semibold text-ink-900" data-testid="checks-line">
      <Icon size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 ${iconClass}`} />{text}
    </p>
  )
  if (locked) return line(Lock, 'text-ink-300', campaign.is_journey_generated ? 'Managed by the journey' : 'Sent as shown')
  if (checklist.isPending) return <SkeletonLine width="44%" />
  if (checklist.isError) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-helper text-ink-800">
        Couldn’t load the checks
        <button type="button" onClick={() => void checklist.refetch()} className="font-semibold text-link hover:underline">Retry</button>
      </p>
    )
  }
  const failing = checklist.data.items.find((item) => !item.ok && !item.advisory)
  if (checklist.data.ready || !failing) return line(CircleCheck, 'text-success', 'No errors')
  return line(CircleAlert, 'text-warning', failing.label)
}
