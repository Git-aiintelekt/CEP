import type { Feature } from '@/lib/types'

/** Which workspace feature switch a channel depends on (mirrors CHANNEL_FEATURE in the API). */
export const CHANNEL_FEATURE: Record<string, Feature> = { EMAIL: 'email', SMS: 'sms', MMS: 'mms', E_RECEIPT: 'ereceipt' }

/** Channels the workspace may use; `keep` stays listed even when switched off, so an existing record still shows its value. */
export function channelAllowed(has: (feature: Feature) => boolean, channel: string, keep?: string): boolean {
  if (channel === keep) return true
  if (channel === 'MULTI') return [has('email'), has('sms'), has('mms')].filter(Boolean).length > 1
  const feature = CHANNEL_FEATURE[channel]
  return feature ? has(feature) : true
}
