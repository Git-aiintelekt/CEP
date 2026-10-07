/**
 * A drip in one line or two, wherever campaigns are listed (the Campaigns list and its cards, the quick view, Home):
 * how far it has got (drip_progress, drip_summary, stopped_early) and what it sends next. Times carry their zone.
 */
import { formatDate } from '@/lib/format'
import type { Campaign } from '@/lib/types'

import { whenInZone, zoneShort } from './dripSequence'

/** a drip series of its own (a journey's campaigns are never one) */
export const isDripSeries = (campaign: Pick<Campaign, 'campaign_type' | 'is_journey_generated'>) => campaign.campaign_type === 'DRIP' && !campaign.is_journey_generated

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const UNSENT = new Set(['DRAFT', 'TEST_PUBLISHED'])

/** "2 of 4 messages sent", "5 messages · starts Mon 26 Oct", "Stopped after 2 of 5", "3 messages · draft"; null for other campaigns */
export function dripProgressText(campaign: Pick<Campaign, 'campaign_type' | 'is_journey_generated' | 'status' | 'scheduled_at' | 'send_timezone' | 'drip_progress' | 'drip_summary' | 'stopped_early'>, zone: string): string | null {
  if (!isDripSeries(campaign)) return null
  const progress = campaign.drip_progress
  const total = progress?.total ?? campaign.drip_summary?.count ?? 0
  if (campaign.stopped_early) return `Stopped after ${progress?.sent ?? 0} of ${total}`
  if (UNSENT.has(campaign.status)) return `${plural(total || 1, 'message')} · ${campaign.status === 'DRAFT' ? 'draft' : 'test published'}`
  if (progress && progress.sent === 0 && progress.failed === 0) {
    const start = whenInZone(campaign.drip_summary?.first_send_at ?? progress.next?.scheduled_at ?? campaign.scheduled_at, campaign.send_timezone || zone)
    return `${plural(total, 'message')}${start ? ` · starts ${start.day}` : ''}`
  }
  return `${progress?.sent ?? 0} of ${plural(total, 'message')} sent`
}

/** the Next Send cell of a published drip: the date, and "09:00 CT · Message 3 of 4"; paused "On hold"; done "None". null: show today's cell */
export function dripNextSend(campaign: Campaign, zone: string, now = Date.now()): { day: string; detail: string | null } | null {
  if (!isDripSeries(campaign) || UNSENT.has(campaign.status)) return null
  const progress = campaign.drip_progress
  const next = progress?.next ?? null
  const place = campaign.send_timezone || zone
  if (campaign.status === 'PAUSED') {
    if (!next) return { day: 'On hold', detail: null }
    const due = next.scheduled_at ? whenInZone(next.scheduled_at, place) : null
    const past = next.scheduled_at ? new Date(next.scheduled_at).getTime() <= now : false
    return { day: 'On hold', detail: due ? `Message ${next.position} ${past ? 'was due' : 'due'} ${due.day}` : `Message ${next.position} of ${progress?.total ?? next.position}` }
  }
  if (!next || ['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(campaign.status)) {
    const cancelled = campaign.stopped_early?.cancelled
    return { day: 'None', detail: cancelled ? `${cancelled} cancelled` : null }
  }
  const at = whenInZone(next.scheduled_at, place)
  return { day: next.scheduled_at ? formatDate(next.scheduled_at) : 'Not scheduled', detail: `${at ? `${at.time} ${zoneShort(place)} · ` : ''}Message ${next.position} of ${progress?.total ?? next.position}` }
}
