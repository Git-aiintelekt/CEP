/**
 * A published drip's messages as the campaign page reads them: each message's state from its latest run, whether it can
 * be retried, and who paused it. One place, so the timeline, the banners and the tables agree.
 */
import { exclusionReason } from '@/apps/cep/features/delivery/exclusionReasons'
import { formatNumber } from '@/lib/format'
import type { Campaign, DripStep } from '@/lib/types'

import { whenInZone } from '../dripSequence'

/** "3", "3 and 4", "3, 4 and 5" */
export function numbers(positions: number[]): string {
  return positions.length <= 1 ? positions.join('') : `${positions.slice(0, -1).join(', ')} and ${positions[positions.length - 1]}`
}

/** the messages a Stop would cancel: everything not sent and not sending */
export const remainingOf = (steps: DripStep[]) => steps.filter((step) => !step.run || ['SCHEDULED', 'PAUSED'].includes(step.run.status))

export type StepState = 'sent' | 'sending' | 'next' | 'scheduled' | 'on-hold' | 'cancelled' | 'failed'

export function stepState(campaign: Campaign, step: DripStep): StepState {
  const status = step.run?.status
  if (status === 'COMPLETED') return 'sent'
  if (status === 'SENDING' || status === 'PREPARING') return 'sending'
  if (status === 'FAILED') return 'failed'
  if (status === 'CANCELLED') return 'cancelled'
  if (campaign.status === 'PAUSED' || status === 'PAUSED') return 'on-hold'
  if (campaign.drip_progress?.next?.position === step.position) return 'next'
  return 'scheduled'
}

/** has the drip started sending (the Today marker and the "Started" wording) */
export const hasStarted = (steps: DripStep[]) => steps.some((step) => step.run && !['SCHEDULED'].includes(step.run.status))

/**
 * A failed message can be sent again only when nobody got it (POST steps/{step}/retry/ refuses otherwise): null when it
 * didn't fail, 'allowed', or the reason it can't be, in the API's words.
 */
export function retryState(campaign: Campaign, step: DripStep, canPublish: boolean): null | 'allowed' | string {
  if (step.run?.status !== 'FAILED') return null
  if (step.run.sent > 0 || step.run.delivered > 0) return `Part of message ${step.position} went out, so it can't be retried.`
  if (campaign.stopped_early) return 'The drip was stopped early. Clone it to send its messages again.'
  if (!canPublish) return 'Retrying a message needs the campaign.publish permission.'
  return 'allowed'
}

/** "Skipped 236: unsubscribed 26, over frequency limit 210." in the Audience tab's words */
export function skippedLine(step: DripStep, channel: string): string | null {
  const skipped = step.run?.skipped
  if (!skipped || skipped.total === 0) return null
  const reasons = skipped.by_reason.map((item) => `${exclusionReason(item.reason, channel).toLowerCase()} ${formatNumber(item.count)}`)
  return `${reasons.join(', ')}.`
}

/** "Paused Mon 12 Oct by Maria Chen. ", from campaign.paused; empty when the API doesn't say */
export function pausedLine(paused: Campaign['paused'], zone: string): string {
  if (!paused) return ''
  const day = whenInZone(paused.at, zone)?.day
  return `Paused${day ? ` ${day}` : ''}${paused.by_name ? ` by ${paused.by_name}` : ''}. `
}
