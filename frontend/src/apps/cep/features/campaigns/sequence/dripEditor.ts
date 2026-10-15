/**
 * A drip message's template, opened from the Sequence step (Edit Template): the template editor's own route with
 * ?drip={campaign}&step={message}. This works out what the editor shows in drip mode: the way back to the message's
 * drawer, the neighbouring messages, the drip's step tracker, the subject and sender it can't change, and the message's
 * own test (POST /campaigns/{id}/steps/{step}/test/).
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { editorPathFor } from '@/lib/editorRoute'
import type { Campaign, DripStep, SenderProfile } from '@/lib/types'
import type { WizardTrackerProps } from '@/apps/cep/features/designer/WizardTracker'

import { dripStepsQuery } from '../dripSteps'
import { setupHref, stepsFor } from '../setupFlow'

/** the editor for a message's template, in drip mode */
export const dripEditorHref = (campaignId: string, step: Pick<DripStep, 'id' | 'template'>) =>
  step.template ? `${editorPathFor(step.template)}?drip=${campaignId}&step=${step.id}` : setupHref(campaignId, { step: 'sequence' })

/** back to the Sequence step with this message's drawer open; `saved`: the editor saved, so the step says so */
export const sequenceHref = (campaignId: string, stepId: string, saved = false) =>
  `${setupHref(campaignId, { step: 'sequence' })}&message=${stepId}${saved ? '&saved=1' : ''}`

export interface DesignerDripMode {
  /** "Loyalty Welcome Series · Message 3 of 4 · " */
  context: string
  /** the message's internal name */
  title: string
  /** the template copy's name, for the strip under the bar */
  templateName: string
  backTo: (saved: boolean) => string
  previous: string | null
  next: string | null
  wizard: WizardTrackerProps
  subject: string
  preheader: string
  sender: string
  /** its content changed after its last test */
  changedSinceTest: boolean
  campaign: Campaign
  step: DripStep
  total: number
}

/** null: not drip mode; undefined: still loading the drip */
export function useDripMode(templateId: string, campaignId: string | null, stepId: string | null): DesignerDripMode | null | undefined {
  const enabled = Boolean(campaignId && stepId)
  const campaign = useQuery({
    queryKey: ['campaigns', 'detail', campaignId ?? ''],
    queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${campaignId}/`, undefined, signal),
    enabled,
  })
  const steps = useQuery({ ...dripStepsQuery(campaignId ?? ''), enabled })
  const senders = useQuery({ queryKey: ['sender-profiles', 'options'], queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal), enabled })
  if (!enabled) return null
  if (!campaign.data || !steps.data) return campaign.isError || steps.isError ? null : undefined
  const list = steps.data
  const index = list.findIndex((item) => item.id === stepId)
  const step = list[index]
  // the address names a message this template no longer belongs to: open it as a plain template
  if (!step || step.template?.id !== templateId) return null
  const near = (other: DripStep | undefined) => (other?.template ? dripEditorHref(campaign.data.id, other) : null)
  const flow = stepsFor('DRIP')
  const sequenceAt = flow.findIndex((item) => item.key === 'sequence')
  const sender = (senders.data ?? []).find((item) => item.id === campaign.data.sender_profile)
  return {
    context: `${campaign.data.name} · Message ${step.position} of ${list.length} · `,
    title: step.name.trim() || 'Untitled Message',
    templateName: step.template.name,
    backTo: (saved) => sequenceHref(campaign.data.id, step.id, saved),
    previous: near(list[index - 1]),
    next: near(list[index + 1]),
    wizard: {
      currentIndex: sequenceAt,
      steps: flow.map((item, at) => ({ label: item.label, href: at < sequenceAt ? setupHref(campaign.data.id, { step: item.key }) : undefined })),
    },
    subject: step.subject_line ?? '',
    preheader: step.preheader ?? '',
    sender: sender ? `${sender.display_name} · ${sender.from_address ?? sender.sender_id ?? ''}` : campaign.data.sender_profile_name ?? '',
    changedSinceTest: step.test?.status === 'CHANGED',
    campaign: campaign.data,
    step,
    total: list.length,
  }
}
