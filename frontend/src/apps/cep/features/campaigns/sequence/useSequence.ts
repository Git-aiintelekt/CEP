/**
 * Every save the Sequence step makes, and where it goes:
 *   a message's name, day, send time, subject, preheader, A/B test, template  → PATCH /campaigns/{id}/steps/{step}/ (with row_version)
 *   add, copy as next, remove                                                 → POST /steps/, POST /steps/{step}/copy-as-next/, DELETE /steps/{step}/
 *   the series' start date, time and zone, the sender and the topic            → PATCH /campaigns/{id}/ with only those fields
 *   a text message's words and picture                                          → POST /templates/{template}/message/ (the composer's save)
 * After any of them the messages and the campaign are read again: a day change re-sorts, names re-number, drip_summary moves.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError } from '@/lib/api'
import type { Campaign, DripStep, DripStepCreate, DripStepUpdate, Message, MessageSaveInput } from '@/lib/types'

import { dripStepsKey } from '../dripSteps'

export const campaignKey = (id: string) => ['campaigns', 'detail', id] as const
export const CHANGED_ELSEWHERE = 'This message changed somewhere else. The latest version is shown.'

export const isConflict = (error: unknown) => error instanceof ApiError && error.status === 409

function useRefresh(campaignId: string) {
  const queryClient = useQueryClient()
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: dripStepsKey(campaignId) }),
    queryClient.invalidateQueries({ queryKey: campaignKey(campaignId) }),
  ])
}

/** the saved message goes straight into the list (its new row_version with it), before the list is read again */
function useKeepSaved(campaignId: string) {
  const queryClient = useQueryClient()
  return (saved: DripStep) => queryClient.setQueryData<DripStep[]>(dripStepsKey(campaignId), (steps) => steps?.map((step) => (step.id === saved.id ? { ...saved, position: step.position } : step)))
}

/** one mutation for every field of a message, so each field's SaveTick answers its own save (variables carry the field) */
export type StepPatch = DripStepUpdate & { id: string }

export function useStepPatch(campaignId: string) {
  const refresh = useRefresh(campaignId)
  const keep = useKeepSaved(campaignId)
  return useMutation({
    mutationFn: ({ id, ...values }: StepPatch) => api.patch<DripStep>(`/campaigns/${campaignId}/steps/${id}/`, values),
    onSuccess: (saved) => { keep(saved); void refresh() },
    onError: (error) => { if (isConflict(error)) void refresh() },
  })
}

export function useStepAdd(campaignId: string) {
  const refresh = useRefresh(campaignId)
  return useMutation({
    mutationFn: (input: DripStepCreate) => api.post<DripStep>(`/campaigns/${campaignId}/steps/`, input),
    onSuccess: () => void refresh(),
  })
}

export function useStepCopyAsNext(campaignId: string) {
  const refresh = useRefresh(campaignId)
  return useMutation({
    mutationFn: (stepId: string) => api.post<DripStep>(`/campaigns/${campaignId}/steps/${stepId}/copy-as-next/`),
    onSuccess: () => void refresh(),
  })
}

export function useStepRemove(campaignId: string) {
  const refresh = useRefresh(campaignId)
  return useMutation({
    mutationFn: (stepId: string) => api.delete(`/campaigns/${campaignId}/steps/${stepId}/`),
    onSettled: () => void refresh(),
  })
}

/** the fields of the campaign the Sequence step owns; nothing else is ever sent from here */
export type SeriesFields = Partial<Pick<Campaign, 'scheduled_at' | 'send_timezone' | 'sender_profile' | 'topic'>> & {
  /** the series time alone: the API leaves the messages as they are */
  drip_config?: { time: string }
}

export function useSeriesPatch(campaign: Campaign) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fields: SeriesFields) => api.patch<Campaign>(`/campaigns/${campaign.id}/`, { ...fields, row_version: campaign.row_version }),
    onSuccess: (saved) => {
      queryClient.setQueryData(campaignKey(saved.id), saved)
      void queryClient.invalidateQueries({ queryKey: dripStepsKey(saved.id) })
      void queryClient.invalidateQueries({ queryKey: ['campaigns'], refetchType: 'none' })
    },
    onError: (error) => { if (isConflict(error)) void queryClient.invalidateQueries({ queryKey: campaignKey(campaign.id) }) },
  })
}

/** a text message's words and picture live in its template copy: saved as the message composer saves them */
export function useTextSave(campaignId: string, templateId: string) {
  const queryClient = useQueryClient()
  const refresh = useRefresh(campaignId)
  return useMutation({
    mutationFn: (input: MessageSaveInput) => api.post<Message>(`/templates/${templateId}/message/`, input),
    onSuccess: (saved) => {
      queryClient.setQueryData(['templates', 'message', templateId], saved)
      void queryClient.invalidateQueries({ queryKey: ['template-preview', 'template', templateId] })
      void refresh()
    },
  })
}
