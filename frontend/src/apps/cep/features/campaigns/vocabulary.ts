/** The campaign module's fixed wording. Status labels are locked (see CLAUDE.md): they are never re-spelled per screen. */
import type { Campaign, CampaignRun } from '@/lib/types'

import { resumeStep, setupHref, type FlowStep, type SetupPlace } from './setupFlow'
import { formatInZone } from './zone'

export const CAMPAIGN_TYPES = [
  { value: 'REGULAR_MARKETING', label: 'Regular Marketing', short: 'Regular', hint: 'One-time, scheduled or recurring send to a chosen audience.', badge: 'Most Common' },
  { value: 'DRIP', label: 'Drip', hint: 'A scheduled series of messages sent over time. Each step is its own run.' },
  { value: 'E_RECEIPT', label: 'E-Receipt', hint: 'Transactional email triggered by a purchase. No contact list needed.' },
  { value: 'OTHER', label: 'Other', hint: 'Service or legal notices.' },
] as const

export const CHANNELS = [
  { value: 'EMAIL', label: 'Email', hint: 'Designed in the visual builder or the code editor.' },
  { value: 'SMS', label: 'SMS', hint: 'Plain text with personalization tags.' },
  { value: 'MMS', label: 'MMS', hint: 'SMS plus media and images.' },
  { value: 'MULTI', label: 'Multiple Channels', hint: 'One campaign, more than one channel.' },
] as const

export const SOLICITATION = [
  { value: 'MARKETING', label: 'Marketing', hint: 'Needs consent; frequency limits and unsubscribe apply.' },
  { value: 'TRANSACTIONAL', label: 'Transactional', hint: 'Needs a valid contact point only; exempt from frequency limits.' },
  { value: 'SERVICE', label: 'Service', hint: 'Account or service notices.' },
  { value: 'LEGAL', label: 'Legal', hint: 'Mandatory notices; sent regardless of marketing preferences.' },
] as const

export const SEND_TYPES = [
  { value: 'IMMEDIATE', label: 'Send Immediately', hint: 'The send starts when you publish to production.' },
  { value: 'SCHEDULED', label: 'Schedule for Later', hint: 'One send at a date and time you choose.' },
  { value: 'RECURRING', label: 'Recurring', hint: 'Daily, weekly or monthly. Each occurrence is its own run.' },
  { value: 'DRIP', label: 'Drip Series', hint: 'A run per step, on the days you set.' },
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
/** the list page's narrower wording: "Regular" for Regular Marketing; the wizard and campaign page keep typeLabel */
export const typeShortLabel = (value: string) => {
  const type = CAMPAIGN_TYPES.find((item) => item.value === value)
  return type ? ('short' in type ? type.short : type.label) : value
}
export const channelLabel = (value: string) => CHANNELS.find((item) => item.value === value)?.label ?? value
export const sendTypeLabel = (value: string) => SEND_TYPES.find((item) => item.value === value)?.label ?? value

/**
 * Where a campaign opens. An unfinished setup continues where it stopped, for whoever may edit it;
 * everything else, and everyone else, gets the campaign page.
 */
export function campaignHome(campaign: Pick<Campaign, 'id' | 'setup_step' | 'setup_complete' | 'actions' | 'is_journey_generated' | 'campaign_type'>, canEdit: boolean): string {
  const resume = canEdit && !campaign.setup_complete && campaign.actions.includes('edit') && !campaign.is_journey_generated
  return resume ? setupHref(campaign.id, { step: resumeStep(campaign.setup_step, campaign.campaign_type) }) : `/campaigns/${campaign.id}`
}

/** "Edit campaign" (⋮) on the campaign page opens the part of the setup that holds what the tab in view shows */
export const EDIT_PLACE_OF_TAB: Record<string, SetupPlace | 'details'> = {
  overview: 'details', performance: { step: 'targets' }, audience: { step: 'audience' }, content: { step: 'content' }, activity: 'details',
}
/** leaving the setup leads back to the tab that shows what the step was about; once there are results the targets live in Performance */
export function tabOfStep(step: FlowStep, campaign: Pick<Campaign, 'actions' | 'runs'>): string {
  if (step === 'audience' || step === 'content') return step
  return step === 'targets' && hasResults(campaign) ? 'performance' : 'overview'
}

export const isText = (campaign: Pick<Campaign, 'channel'>) => campaign.channel === 'SMS' || campaign.channel === 'MMS'
export const hasAction = (campaign: Pick<Campaign, 'actions'>, action: Campaign['actions'][number]) => campaign.actions.includes(action)
/** results exist: the API allows them, or a production run has started. The Performance tab and Overview's Metrics card both follow this */
export const hasResults = (campaign: Pick<Campaign, 'actions' | 'runs'>) => hasAction(campaign, 'results') || campaign.runs.some((run) => !run.test_mode && Boolean(run.started_at))

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

/** when the campaign goes out, in words; `format` writes a scheduled time (the campaign page uses the short zone name) */
export function whenText(campaign: Campaign, zone: string, format: (iso: string, zone: string) => string = formatInZone): string {
  if (campaign.campaign_type === 'E_RECEIPT') return 'When a purchase arrives'
  if (campaign.send_type === 'SCHEDULED') return campaign.scheduled_at ? format(campaign.scheduled_at, zone) : 'Not set'
  if (campaign.send_type === 'RECURRING') return describeRecurrence(campaign.recurring_config)
  if (campaign.send_type === 'DRIP') {
    const steps = campaign.drip_config?.steps ?? []
    return steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'}: day ${steps.map((step) => step.day).join(', ')} at ${campaign.drip_config?.time ?? '09:00'}` : 'No steps yet'
  }
  return 'As soon as it is published'
}

/** the latest production run, when it failed (test runs don't count): the campaign page's failed-run banner */
export function latestFailedRun(campaign: Campaign): CampaignRun | null {
  const latest = campaign.runs.filter((run) => !run.test_mode).sort((a, b) => b.run_number - a.run_number)[0]
  return latest?.status === 'FAILED' ? latest : null
}
