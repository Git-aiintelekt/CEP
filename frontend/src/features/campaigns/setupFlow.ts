/**
 * The campaign setup flow: the Create Campaign pop-up, then Audience → Content → Test → Targets → Review & Publish.
 * Targets comes after Test, so the path to a test send is short; Targets can be skipped for now and filled in later.
 * A drip goes Audience → Sequence → Targets → Test & Publish: its messages (each with its own template) are set up on
 * Sequence, and every message is test-sent and the whole series published on the last step.
 * The API still counts progress 0–6 (only ever moving forward, complete at 6); every place that reads or writes it,
 * or links into the setup, goes through this module.
 */
import type { Campaign } from '@/lib/types'

export type FlowStep = 'audience' | 'content' | 'sequence' | 'test' | 'targets' | 'publish'
export type PublishSection = 'schedule' | 'review'

export const FLOW_STEPS: { key: FlowStep; label: string; next?: string }[] = [
  { key: 'audience', label: 'Audience', next: 'Continue to Content' },
  { key: 'content', label: 'Content', next: 'Continue to Test' },
  { key: 'test', label: 'Test', next: 'Continue to Targets' },
  { key: 'targets', label: 'Targets', next: 'Continue to Review & Publish' },
  { key: 'publish', label: 'Review & Publish' },
]

export const DRIP_STEPS: { key: FlowStep; label: string; next?: string }[] = [
  { key: 'audience', label: 'Audience', next: 'Continue to Sequence' },
  { key: 'sequence', label: 'Sequence', next: 'Continue to Targets' },
  { key: 'targets', label: 'Targets', next: 'Continue to Test & Publish' },
  { key: 'publish', label: 'Test & Publish' },
]
const ALL_KEYS: FlowStep[] = ['audience', 'content', 'sequence', 'test', 'targets', 'publish']

export const PUBLISH_SECTIONS: { key: PublishSection; label: string }[] = [
  { key: 'schedule', label: 'When and How It Goes Out' },
  { key: 'review', label: 'Summary and Publish' },
]

/** setup_step once each part is done; the API keeps the highest value it has seen. Tested = the Test step was passed
 *  (a test sent, or Continue); Targets passed or skipped records 5; the schedule saved on Review & Publish completes
 *  the setup (an e-receipt, having no schedule, is complete once its Targets step is passed).
 *  A drip: created 1, Audience 2, Sequence 3, Targets 5, and complete (6) once its messages were test-sent. */
export const PROGRESS = { created: 1, audience: 2, content: 3, sequence: 3, tested: 4, targets: 5, schedule: 6 } as const
export const SETUP_DONE = PROGRESS.schedule

const typeOf = (campaign: Pick<Campaign, 'campaign_type'> | string) => (typeof campaign === 'string' ? campaign : campaign.campaign_type)
const isReceipt = (campaign: Pick<Campaign, 'campaign_type'> | string) => typeOf(campaign) === 'E_RECEIPT'
export const isDrip = (campaign: Pick<Campaign, 'campaign_type'> | string) => typeOf(campaign) === 'DRIP'

/** the steps a campaign goes through: e-receipts have no audience to choose; a drip has its own four */
export function stepsFor(campaignType: string) {
  if (isDrip(campaignType)) return DRIP_STEPS
  return FLOW_STEPS.filter((step) => step.key !== 'audience' || !isReceipt(campaignType))
}

/** the step that finishing `step` records */
export function progressAfter(step: Exclude<FlowStep, 'publish'>, campaignType: string): number {
  if (step === 'test') return isDrip(campaignType) ? SETUP_DONE : PROGRESS.tested          // a drip is tested on its last step
  if (step === 'targets') return isReceipt(campaignType) ? SETUP_DONE : PROGRESS.targets
  return PROGRESS[step]
}

/** where an unfinished setup picks up again */
export function resumeStep(progress: number, campaignType: string): FlowStep {
  if (isDrip(campaignType)) {
    if (progress >= PROGRESS.targets) return 'publish'
    if (progress >= PROGRESS.sequence) return 'targets'
    if (progress >= PROGRESS.audience) return 'sequence'
    return 'audience'
  }
  if (progress >= PROGRESS.targets) return 'publish'
  if (progress >= PROGRESS.tested) return 'targets'
  if (progress >= PROGRESS.content) return 'test'
  if (progress >= PROGRESS.audience) return 'content'
  return isReceipt(campaignType) ? 'content' : 'audience'
}

export interface SetupPlace {
  step: FlowStep
  section?: PublishSection
  /** the Edit details pop-up, open over the step */
  details?: boolean
}

/** the old wizard's ?step=1..7, from bookmarks and older links */
const OLD_STEP: Record<number, SetupPlace | 'first'> = {
  1: 'first', 2: { step: 'audience' }, 3: { step: 'content' }, 4: { step: 'publish', section: 'schedule' },
  5: { step: 'targets' }, 6: { step: 'test' }, 7: { step: 'publish', section: 'review' },
}

/** a drip's places for the steps it doesn't have: its messages' content is on Sequence, its test on Test & Publish */
const DRIP_PLACE: Partial<Record<FlowStep, FlowStep>> = { content: 'sequence', test: 'publish' }

/** `step` as this type of campaign has it (a drip's old ?step=content opens Sequence, ?step=test opens Test & Publish) */
export function stepForType(step: FlowStep, campaignType: string): FlowStep {
  return isDrip(campaignType) ? DRIP_PLACE[step] ?? step : step
}

/** reads ?step= (a step key, or an old number), ?section= and ?details= */
export function placeFromParams(params: URLSearchParams, campaignType: string): SetupPlace | null {
  const raw = params.get('step')
  const first = stepsFor(campaignType)[0].key
  const details = params.get('details') === '1'
  const section = PUBLISH_SECTIONS.find((item) => item.key === params.get('section'))?.key
  if (raw && /^\d+$/.test(raw)) {
    const old = OLD_STEP[Number(raw)]
    if (!old) return null
    if (old === 'first') return { step: first, details: true }
    const step = stepForType(old.step, campaignType)
    return isDrip(campaignType) ? { step, ...(step === 'publish' && old.section === 'review' ? { section: old.section } : {}) } : old
  }
  const known = ALL_KEYS.find((item) => item === raw)
  const step = known ? stepForType(known, campaignType) : undefined
  if (!step && !details) return null
  const fits = step && stepsFor(campaignType).some((item) => item.key === step) ? step : first
  const shown = section && !(isDrip(campaignType) && section === 'schedule') ? section : undefined      // a drip's start and times are on Sequence
  return { step: fits, ...(fits === 'publish' && shown ? { section: shown } : {}), ...(details ? { details: true } : {}) }
}

export function setupHref(campaignId: string, place: SetupPlace): string {
  const query = new URLSearchParams({ step: place.step })
  if (place.section) query.set('section', place.section)
  if (place.details) query.set('details', '1')
  return `/campaigns/${campaignId}/edit?${query.toString()}`
}

/** a draft's type and channel can change until its content (template or sender) is chosen. A drip's messages each have
 *  a template: campaign.template is only message 1's, so the pop-up also asks the steps (dripHasTemplate). */
export const typeCanChange = (campaign: Pick<Campaign, 'status' | 'template' | 'sender_profile' | 'is_journey_generated'>) =>
  campaign.status === 'DRAFT' && !campaign.template && !campaign.sender_profile && !campaign.is_journey_generated

/** a drip whose messages already carry a template: its type and channel are fixed */
export const dripHasTemplate = (steps: { template: unknown }[] | undefined) => Boolean(steps?.some((step) => step.template))

/** how many of the campaign's steps are done */
export function stepsDone(campaign: Pick<Campaign, 'setup_step' | 'campaign_type'>): number {
  return stepsFor(campaign.campaign_type).findIndex((step) => step.key === resumeStep(campaign.setup_step, campaign.campaign_type))
}

/** "Step 2 of 4 · Content": how far an unfinished setup has got, for the campaign page's note */
export function setupProgressText(campaign: Pick<Campaign, 'setup_step' | 'campaign_type'>): string {
  const steps = stepsFor(campaign.campaign_type)
  const next = resumeStep(campaign.setup_step, campaign.campaign_type)
  const index = steps.findIndex((step) => step.key === next)
  return `step ${index + 1} of ${steps.length}, ${steps[index].label.toLowerCase()}`
}
