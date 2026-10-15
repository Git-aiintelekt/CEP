/**
 * Why someone was left out, in words: one map for the Audience tab, the run results and anything else that names a reason,
 * so they always agree. Consent reads by channel: "No Email Consent", "No Text Consent", "No MMS Consent".
 */
import { titleize } from '@/lib/format'

const CONSENT: Record<string, string> = { EMAIL: 'No Email Consent', E_RECEIPT: 'No Email Consent', SMS: 'No Text Consent', MMS: 'No MMS Consent' }

const REASONS: Record<string, string> = {
  EXCLUDED_LIST: 'In an Excluded List', UNKNOWN_PARTY: 'Not a Known Customer', UNSUBSCRIBED: 'Unsubscribed', SUPPRESSED: 'Suppressed', DUPLICATES: 'In Several Lists (Counted Once)',
  NO_EMAIL: 'No Email Address', INVALID_ADDRESS: 'Invalid Address', BLOCKED_ADDRESS: 'Address Blocked (Bounce or Complaint)', DUPLICATE_ADDRESS: 'Same Address as Someone Else in the Run',
  NO_PHONE: 'No Mobile Number', INVALID_NUMBER: 'No Mobile Number in International Format', BLOCKED_NUMBER: 'Number Blocked (STOP Reply, Registry or Undeliverable)',
  DUPLICATE_NUMBER: 'Same Number as Someone Else in the Run', HARD_BOUNCE: 'Hard Bounce', SOFT_BOUNCE: 'Soft Bounce',
  COMPLAINT: 'Marked as Spam', BLOCKED: 'Blocked', FREQUENCY_CAP: 'Over Frequency Limit', TOPIC_OPTED_OUT: 'Opted Out of This Topic',
  LIST_NOT_APPROVED: 'In a List Awaiting Approval',
}

/** `channel`: the campaign's (EMAIL, SMS, MMS, E_RECEIPT, MULTI); unknown or mixed channels say "No Consent". Short labels; each place that shows one explains it in its own line */
export function exclusionReason(code: string, channel?: string | null): string {
  if (code === 'NO_CONSENT') return CONSENT[channel ?? ''] ?? 'No Consent'
  return REASONS[code] ?? titleize(code)
}

export const isKnownReason = (code: string) => code === 'NO_CONSENT' || code in REASONS
