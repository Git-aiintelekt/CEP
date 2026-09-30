/** Recent Campaigns' context line: "{type} · {what happened}", dates and times in the workspace zone. */
import { formatClock, formatShortDay, zoneAbbreviation } from '@/lib/format'

/** "28 Sep 2026" for an instant, on the workspace's calendar */
export function dayMonthYear(iso: string, zone: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  return `${formatShortDay(day)} ${day.slice(0, 4)}`
}

export interface CampaignMoments {
  typeLabel: string
  status: string
  editedAt: string
  nextRunAt?: string | null
  testSentAt?: string | null
  lastSentAt?: string | null
  sendingNow?: boolean
}

export function contextLine({ typeLabel, status, editedAt, nextRunAt, testSentAt, lastSentAt, sendingNow }: CampaignMoments, zone: string): string {
  const happened =
    status === 'SCHEDULED' && nextRunAt ? `sends ${dayMonthYear(nextRunAt, zone)}, ${formatClock(nextRunAt, zone)} ${zoneAbbreviation(zone, new Date(nextRunAt))}`
    : status === 'DRAFT' ? `edited ${dayMonthYear(editedAt, zone)}`
    : status === 'TEST_PUBLISHED' ? (testSentAt ? `test sent ${dayMonthYear(testSentAt, zone)}` : `published for test ${dayMonthYear(editedAt, zone)}`)
    : sendingNow ? 'sending now'
    : status === 'PAUSED' ? `paused ${dayMonthYear(editedAt, zone)}`
    : lastSentAt ? `sent ${dayMonthYear(lastSentAt, zone)}`
    : `edited ${dayMonthYear(editedAt, zone)}`
  return `${typeLabel} · ${happened}`
}
