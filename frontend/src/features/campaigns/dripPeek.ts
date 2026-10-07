/** The quick view of a drip: which message it opens on, and the line over that message's thumbnail. */
import type { Campaign, DripStep } from '@/lib/types'

import { stepState, type StepState } from './detail/dripDetail'
import { whenInZone, type Series } from './dripSequence'

const UNPUBLISHED = new Set(['DRAFT', 'TEST_PUBLISHED'])
const FINISHED = new Set(['COMPLETED', 'CANCELLED', 'ARCHIVED'])

/** a draft's messages are planned; a published drip's come from their runs */
export const previewState = (campaign: Campaign, step: DripStep): StepState | 'planned' => (UNPUBLISHED.has(campaign.status) ? 'planned' : stepState(campaign, step))

/** the next message while it runs or waits; message 1 once it is finished, and for a draft */
export function startIndex(campaign: Campaign, steps: DripStep[]): number {
  if (UNPUBLISHED.has(campaign.status) || FINISHED.has(campaign.status) || campaign.stopped_early) return 0
  const next = campaign.drip_progress?.next?.position
  const index = next ? steps.findIndex((step) => step.position === next) : steps.findIndex((step) => !step.run || step.run.status !== 'COMPLETED')
  return Math.max(0, index)
}

/** when the message went or goes: its run once planned (a resume can move it), else the timetable */
export function stepWhen(step: DripStep, series: Series) {
  return whenInZone(step.run?.started_at ?? step.run?.scheduled_at ?? step.scheduled_for, series.zone)
}

/** "Message 3 of 4 · Next, Mon 19 Oct"; "On hold, was due Fri 16 Oct"; "Planned for Mon 2 Nov" */
export function thumbnailLabel(campaign: Campaign, step: DripStep, total: number, series: Series, now = Date.now()): string {
  const when = stepWhen(step, series)
  const day = when?.day ?? `Day ${step.day}`
  const due = step.run?.scheduled_at ?? step.scheduled_for
  const past = due ? new Date(due).getTime() <= now : false
  const words: Record<StepState | 'planned', string> = {
    sent: `Sent, ${day}`, sending: `Sending, ${day}`, next: `Next, ${day}`, scheduled: `Scheduled, ${day}`, failed: `Failed, ${day}`,
    'on-hold': `On hold, ${past ? 'was due' : 'due'} ${day}`, cancelled: `Cancelled, was due ${day}`, planned: `Planned for ${day}`,
  }
  return `Message ${step.position} of ${total} · ${words[previewState(campaign, step)]}`
}
