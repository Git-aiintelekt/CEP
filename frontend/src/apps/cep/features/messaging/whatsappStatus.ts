/** Where Meta's review of a WhatsApp template stands, as a tag: the words and the tone every screen uses. */
import type { TagTone } from '@/components/StatusBadge'
import type { WhatsAppStatus } from '@/lib/types'

export const META_STATUS: Record<WhatsAppStatus, { label: string; tone: TagTone }> = {
  DRAFT: { label: 'Not Submitted', tone: 'neutral' },
  PENDING: { label: 'In Review', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'error' },
  PAUSED: { label: 'Paused by Meta', tone: 'warning' },
  DISABLED: { label: 'Disabled by Meta', tone: 'error' },
}
