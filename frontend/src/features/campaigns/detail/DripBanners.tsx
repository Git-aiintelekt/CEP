/**
 * A published drip's banners, in today's banner styles: scheduled (not started), paused (who and when, campaign.paused),
 * stopped early, and a failed message with Retry when nobody got it.
 */
import { Clock, OctagonX, Pause } from 'lucide-react'

import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import type { Campaign, DripStep } from '@/lib/types'

import { whenInZone, zoneShort } from '../dripSequence'
import { FailedRunBanner } from './FailedRunBanner'
import { pausedLine, retryState } from './dripDetail'

interface DripBannersProps {
  campaign: Campaign
  steps: DripStep[]
  zone: string
  canPublish: boolean
  canCancel: boolean
  busy: boolean
  onCancelSchedule: () => void
  onRetry: (step: DripStep) => void
  onView?: (runId: string) => void
}

export function DripBanners({ campaign, steps, zone, canPublish, canCancel, busy, onCancelSchedule, onRetry, onView }: DripBannersProps) {
  const paused = campaign.status === 'PAUSED'
  const short = zoneShort(zone)
  const day = (iso: string | null | undefined) => whenInZone(iso, zone)?.day
  const next = campaign.drip_progress?.next ?? null
  const failed = [...steps].reverse().find((step) => step.run?.status === 'FAILED')
  const retry = failed ? retryState(campaign, failed, canPublish) : null

  const first = steps[0]
  const firstAt = whenInZone(first?.run?.scheduled_at ?? campaign.next_run_at, zone)

  return (
    <>
      {campaign.display_status === 'SCHEDULED' && (
        <Notice tone="warning" layout="banner" icon={Clock} iconTile title="Scheduled"
          action={canCancel && <Button size="sm" disabled={busy} onClick={onCancelSchedule}>Cancel Schedule</Button>}>
          <p data-drip-banner="scheduled">{firstAt ? `Message 1 sends ${firstAt.day} at ${firstAt.time} ${short}. ` : ''}Until then you can cancel the schedule and edit the drip.</p>
        </Notice>
      )}
      {paused && (
        <Notice tone="warning" layout="banner" icon={Pause} iconTile title="Paused">
          <p data-drip-banner="paused">
            {pausedLine(campaign.paused, zone) || 'Paused. '}
            {next ? `Message ${next.position} is due ${day(next.scheduled_at) ?? 'on its day'}. It waits until you resume.` : 'Nothing more goes out until you resume.'}
          </p>
        </Notice>
      )}
      {campaign.stopped_early && (
        <div role="status" data-drip-banner="stopped" className="flex items-start gap-3 rounded-lg border border-line bg-surface-subtle px-4 py-3 text-helper text-ink-800">
          <OctagonX size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-ink-800" />
          <p>
            <span className="font-semibold text-ink-900">Stopped early.</span> Stopped {day(campaign.stopped_early.at)}{campaign.stopped_early.by_name ? ` by ${campaign.stopped_early.by_name}` : ''}.
            {` ${campaign.stopped_early.cancelled} ${campaign.stopped_early.cancelled === 1 ? 'message was' : 'messages were'} cancelled.`}
          </p>
        </div>
      )}
      {failed?.run && (
        <FailedRunBanner campaign={campaign} run={{ id: failed.run.id, run_number: 0 }} title={`Message ${failed.position} failed`}
          onView={onView ? () => onView(failed.run!.id) : undefined}
          extra={retry === 'allowed' && <Button size="sm" variant="secondary" onClick={() => onRetry(failed)}>Retry Message</Button>}
          note={retry && retry !== 'allowed' ? retry : null} />
      )}
    </>
  )
}
