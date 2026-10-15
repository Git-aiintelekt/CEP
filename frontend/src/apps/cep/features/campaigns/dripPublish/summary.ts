import { formatNumber } from '@/lib/format'
import type { DripReview } from '@/lib/types'

import { whenInZone, type Series } from '../dripSequence'

/** "4 messages to about 12,480 people. First Mon 12 Oct, 09:00 CT. Last Mon 26 Oct, 18:00 CT." */
export function reviewSummary(review: DripReview, series: Series): string {
  const { count, estimated_recipients: people } = review.summary
  const first = whenInZone(review.summary.first_send_at, series.zone)
  const last = whenInZone(review.summary.last_send_at, series.zone)
  const at = (when: typeof first) => (when ? `${when.day}, ${when.time} ${series.zoneShort}` : 'once a start date is chosen')
  return `${count} ${count === 1 ? 'message' : 'messages'} to about ${formatNumber(people)} people. First ${at(first)}.${count > 1 ? ` Last ${at(last)}.` : ''}`
}
