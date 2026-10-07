import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { Campaign, CampaignRun, DripReview } from '@/lib/types'

import { whenInZone, type Series } from '../dripSequence'

/** the publish's state, shared by the button in the column and the one in the narrow footer */
export function useDripPublish(campaign: Campaign, review: DripReview | undefined, series: Series, beforePublish: () => Promise<boolean>) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const publish = useMutation({
    mutationFn: () => api.post<CampaignRun>(`/campaigns/${campaign.id}/publish/`),
    onSuccess: async () => {
      const first = whenInZone(review?.summary.first_send_at, series.zone)
      toast.success(first ? `Scheduled. Message 1 sends ${first.day} at ${first.time} ${series.zoneShort}.` : 'Published.')
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      navigate(`/campaigns/${campaign.id}`)
    },
    onSettled: () => setConfirming(false),
  })
  const open = async () => { publish.reset(); if (await beforePublish()) setConfirming(true) }
  return { publish, confirming, setConfirming, open }
}
export type DripPublishController = ReturnType<typeof useDripPublish>

