/** The campaign module's fixed wording. Status labels are locked (see CLAUDE.md): they are never re-spelled per screen. */
import type { Campaign } from '@/lib/types'

import { formatInZone } from './zone'

export const CAMPAIGN_TYPES = [
  { value: 'REGULAR_MARKETING', label: 'Regular Marketing', hint: 'One-time, scheduled or recurring send to a chosen audience.', badge: 'Most common' },
  { value: 'DRIP', label: 'Drip', hint: 'A scheduled series of messages sent over time. Each step is its own run.' },
  { value: 'E_RECEIPT', label: 'E-Receipt', hint: 'Transactional email triggered by a purchase. No contact list needed.' },
  { value: 'OTHER', label: 'Other', hint: 'Service or legal notices.' },
] as const

export const CHANNELS = [
  { value: 'EMAIL', label: 'Email', hint: 'Designed in the visual builder or the code editor.' },
  { value: 'SMS', label: 'SMS', hint: 'Plain text with personalization tags.' },
  { value: 'MMS', label: 'MMS', hint: 'SMS plus media and images.' },
  { value: 'MULTI', label: 'Multiple channels', hint: 'One campaign, more than one channel.' },
] as const

export const SOLICITATION = [
  { value: 'MARKETING', label: 'Marketing', hint: 'Needs consent; frequency limits and unsubscribe apply.' },
  { value: 'TRANSACTIONAL', label: 'Transactional', hint: 'Needs a valid contact point only; exempt from frequency limits.' },
  { value: 'SERVICE', label: 'Service', hint: 'Account or service notices.' },
  { value: 'LEGAL', label: 'Legal', hint: 'Mandatory notices; sent regardless of marketing preferences.' },
] as const

export const SEND_TYPES = [
  { value: 'IMMEDIATE', label: 'Send immediately', hint: 'The send starts when you publish to production.' },
  { value: 'SCHEDULED', label: 'Schedule for later', hint: 'One send at a date and time you choose.' },
  { value: 'RECURRING', label: 'Recurring', hint: 'Daily, weekly or monthly. Each occurrence is its own run.' },
  { value: 'DRIP', label: 'Drip series', hint: 'A run per step, on the days you set.' },
] as const

export const WEEKDAYS = [
  { value: 'MO', label: 'Mon' }, { value: 'TU', label: 'Tue' }, { value: 'WE', label: 'Wed' }, { value: 'TH', label: 'Thu' },
  { value: 'FR', label: 'Fri' }, { value: 'SA', label: 'Sat' }, { value: 'SU', label: 'Sun' },
] as const

/** filter options of the list: the locked four, then the rest of the life cycle */
export const STATUS_FILTERS = [
  { value: 'DRAFT', label: 'Draft' }, { value: 'TEST_PUBLISHED', label: 'Test Published' }, { value: 'PRODUCTION_PUBLISHED', label: 'Production Published' },
  { value: 'SCHEDULED', label: 'Scheduled' }, { value: 'ACTIVE', label: 'Active' }, { value: 'PAUSED', label: 'Paused' }, { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ARCHIVED', label: 'Archived' },
]

/** which template / sender channels fit a campaign channel (same table as the API) */
export const TEMPLATE_FIT: Record<string, string[]> = { EMAIL: ['EMAIL', 'E_RECEIPT'], SMS: ['SMS'], MMS: ['MMS'], MULTI: ['EMAIL', 'E_RECEIPT', 'SMS', 'MMS'] }
export const SENDER_FIT: Record<string, string[]> = { EMAIL: ['EMAIL'], SMS: ['SMS'], MMS: ['MMS', 'SMS'], MULTI: ['EMAIL', 'SMS', 'MMS'] }

export const typeLabel = (value: string) => CAMPAIGN_TYPES.find((item) => item.value === value)?.label ?? value
export const channelLabel = (value: string) => CHANNELS.find((item) => item.value === value)?.label ?? value
export const sendTypeLabel = (value: string) => SEND_TYPES.find((item) => item.value === value)?.label ?? value

export const isText = (campaign: Pick<Campaign, 'channel'>) => campaign.channel === 'SMS' || campaign.channel === 'MMS'
export const hasAction = (campaign: Pick<Campaign, 'actions'>, action: Campaign['actions'][number]) => campaign.actions.includes(action)

/** "Every week on Mon, Thu at 09:00" */
export function describeRecurrence(config: Campaign['recurring_config']): string {
  if (!config) return 'Not set'
  const every = config.interval && config.interval > 1 ? `Every ${config.interval} ` : 'Every '
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' }[config.frequency]
  const plural = config.interval && config.interval > 1 ? 's' : ''
  const on =
    config.frequency === 'WEEKLY' && config.weekdays?.length
      ? ` on ${config.weekdays.map((day) => WEEKDAYS.find((item) => item.value === day)?.label ?? day).join(', ')}`
      : config.frequency === 'MONTHLY' && config.day_of_month ? ` on day ${config.day_of_month}` : ''
  const end = config.max_runs ? `, ${config.max_runs} times` : config.end_date ? `, until ${config.end_date}` : ''
  return `${every}${unit}${plural}${on} at ${config.time}${end}`
}

/** when the campaign goes out, in words */
export function whenText(campaign: Campaign, zone: string): string {
  if (campaign.campaign_type === 'E_RECEIPT') return 'When a purchase arrives'
  if (campaign.send_type === 'SCHEDULED') return campaign.scheduled_at ? formatInZone(campaign.scheduled_at, zone) : 'Not set'
  if (campaign.send_type === 'RECURRING') return describeRecurrence(campaign.recurring_config)
  if (campaign.send_type === 'DRIP') {
    const steps = campaign.drip_config?.steps ?? []
    return steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'}: day ${steps.map((step) => step.day).join(', ')} at ${campaign.drip_config?.time ?? '09:00'}` : 'No steps yet'
  }
  return 'As soon as it is published'
}
