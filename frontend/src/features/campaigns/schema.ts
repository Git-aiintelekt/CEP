/**
 * The campaign form: one Zod schema for all seven steps, the fields each step owns, and the two conversions
 * (API -> form, form -> API). Numbers stay text while they are typed and are converted on the way out, so an
 * empty box is "not set" and never 0. The API stays the authority: its field messages land on the same fields.
 */
import { z } from 'zod'

import type { Campaign, CampaignInput, CampaignTargets, Channel, DripConfig, RecurringConfig } from '@/lib/types'

import { isoToZoned, zonedToIso } from './zone'

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/
export const TAG_PATTERN = /^[\w .&/+-]{1,40}$/u
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

const money = z.string().trim().regex(/^(\d{1,12}(\.\d{1,2})?)?$/, 'Enter an amount such as 2500 or 2500.50.')
const count = z.string().trim().regex(/^\d{0,9}$/, 'Enter a whole number, zero or more.')

export const campaignSchema = z
  .object({
    name: z.string().trim().min(3, 'Use at least 3 characters.').max(200, 'Use 200 characters or fewer.'),
    code: z.string().trim().refine((value) => value === '' || CODE_PATTERN.test(value.toUpperCase()), '3 to 40 characters: capital letters, digits, hyphen or underscore.'),
    description: z.string().max(2000, 'Use 2,000 characters or fewer.'),
    campaign_type: z.enum(['REGULAR_MARKETING', 'DRIP', 'E_RECEIPT', 'OTHER']),
    channel: z.enum(['EMAIL', 'SMS', 'MMS', 'MULTI']),
    solicitation_type: z.enum(['MARKETING', 'TRANSACTIONAL', 'SERVICE', 'LEGAL']),
    owner_user: z.string(),
    tags: z.array(z.string().regex(TAG_PATTERN, 'A tag is up to 40 letters, digits and spaces.')).max(20, 'Up to 20 tags.'),
    contact_lists: z.array(z.string()),
    excluded_lists: z.array(z.string()),
    template: z.string(),
    sender_profile: z.string(),
    /** blank = the template's */
    subject_line: z.string().max(300, 'Use 300 characters or fewer.'),
    preheader: z.string().max(300, 'Use 300 characters or fewer.'),
    /** the preference-centre topic; '' = none yet */
    topic: z.string(),
    send_type: z.enum(['IMMEDIATE', 'SCHEDULED', 'RECURRING', 'DRIP']),
    /** the wall clock in send_timezone, as a date-time input holds it */
    scheduled_at: z.string(),
    send_timezone: z.string(),
    recurring: z.object({
      frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
      interval: z.string().trim(),
      weekdays: z.array(z.string()),
      day_of_month: z.string().trim(),
      time: z.string(),
      ends: z.enum(['NEVER', 'ON', 'AFTER']),
      end_date: z.string(),
      max_runs: z.string().trim(),
    }),
    drip: z.object({ time: z.string(), steps: z.array(z.object({ day: z.string().trim(), label: z.string().trim().max(60, 'Use 60 characters or fewer.') })) }),
    respect_governance: z.boolean(),
    rate_limit_per_hour: count,
    timezone_optimization: z.boolean(),
    targets: z.object({
      target_revenue: money, target_opens: count, target_clicks: count, target_conversions: count, target_redemptions: count,
      planned_cost: money, planned_offer_cost: money, notes: z.string().max(1000, 'Use 1,000 characters or fewer.'),
    }),
  })
  .superRefine((values, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    if (values.send_type === 'SCHEDULED') {
      const at = zonedToIso(values.scheduled_at, values.send_timezone)
      if (!at) issue(['scheduled_at'], 'Choose the date and time of the send.')
      else if (new Date(at).getTime() <= Date.now()) issue(['scheduled_at'], 'Choose a time in the future.')
    }
    if (values.send_type === 'RECURRING') {
      const every = Number(values.recurring.interval || '1')
      if (!Number.isInteger(every) || every < 1 || every > 52) issue(['recurring', 'interval'], 'Between 1 and 52.')
      if (!CLOCK.test(values.recurring.time)) issue(['recurring', 'time'], 'Choose the time of day.')
      if (values.recurring.frequency === 'WEEKLY' && values.recurring.weekdays.length === 0) issue(['recurring', 'weekdays'], 'Choose at least one day of the week.')
      if (values.recurring.frequency === 'MONTHLY') {
        const day = Number(values.recurring.day_of_month)
        if (!Number.isInteger(day) || day < 1 || day > 31) issue(['recurring', 'day_of_month'], 'Between 1 and 31.')
      }
      if (values.recurring.ends === 'ON' && !/^\d{4}-\d{2}-\d{2}$/.test(values.recurring.end_date)) issue(['recurring', 'end_date'], 'Choose the last day.')
      if (values.recurring.ends === 'AFTER') {
        const runs = Number(values.recurring.max_runs)
        if (!Number.isInteger(runs) || runs < 1 || runs > 999) issue(['recurring', 'max_runs'], 'Between 1 and 999.')
      }
    }
    if (values.send_type === 'DRIP') {
      if (!CLOCK.test(values.drip.time)) issue(['drip', 'time'], 'Choose the time of day.')
      if (values.drip.steps.length === 0) issue(['drip', 'steps'], 'Add at least one step to the series.')
      const seen = new Set<number>()
      values.drip.steps.forEach((step, index) => {
        const day = Number(step.day)
        if (step.day === '' || !Number.isInteger(day) || day < 0 || day > 365) issue(['drip', 'steps', index, 'day'], 'A day between 0 and 365 (0 = the first day).')
        else if (seen.has(day)) issue(['drip', 'steps', index, 'day'], 'Another step is already on this day.')
        seen.add(day)
      })
    }
  })

export type CampaignFormValues = z.infer<typeof campaignSchema>

/** RHF names of what each step owns: "Continue" validates these and nothing else. */
export const STEP_FIELDS = [
  ['name', 'code', 'description', 'campaign_type', 'channel', 'solicitation_type', 'owner_user', 'tags'],
  ['contact_lists', 'excluded_lists'],
  ['template', 'sender_profile', 'subject_line', 'preheader', 'topic'],
  ['send_type', 'scheduled_at', 'send_timezone', 'recurring', 'drip', 'respect_governance', 'rate_limit_per_hour', 'timezone_optimization'],
  ['targets'],
  [],
  [],
] as const satisfies readonly (readonly (keyof CampaignFormValues)[])[]

/** which step shows the field the API complained about */
const API_FIELD_STEP: Record<string, number> = {
  name: 0, code: 0, description: 0, campaign_type: 0, channel: 0, solicitation_type: 0, owner_user: 0, tags: 0, contact_lists: 1, excluded_lists: 1, template: 2, sender_profile: 2, subject_line: 2, preheader: 2, topic: 2,
  send_type: 3, scheduled_at: 3, send_timezone: 3, recurring_config: 3, drip_config: 3, respect_governance: 3, rate_limit_per_hour: 3, timezone_optimization: 3, targets: 4,
}
export const stepOfApiField = (field: string): number => API_FIELD_STEP[field] ?? 0
/** the form names a nested group differently from the API */
export const formFieldOf = (field: string): string => ({ recurring_config: 'recurring.frequency', drip_config: 'drip.steps' })[field] ?? field

export function emptyValues(zone: string, owner: string): CampaignFormValues {
  return {
    name: '', code: '', description: '', campaign_type: 'REGULAR_MARKETING', channel: 'EMAIL', solicitation_type: 'MARKETING', owner_user: owner, tags: [],
    contact_lists: [], excluded_lists: [], template: '', sender_profile: '', subject_line: '', preheader: '', topic: '', send_type: 'IMMEDIATE', scheduled_at: '', send_timezone: zone,
    recurring: { frequency: 'WEEKLY', interval: '1', weekdays: [], day_of_month: '1', time: '09:00', ends: 'NEVER', end_date: '', max_runs: '' },
    drip: { time: '09:00', steps: [{ day: '0', label: '' }] },
    respect_governance: true, rate_limit_per_hour: '', timezone_optimization: false,
    targets: { target_revenue: '', target_opens: '', target_clicks: '', target_conversions: '', target_redemptions: '', planned_cost: '', planned_offer_cost: '', notes: '' },
  }
}

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? '' : String(value))
/** "25000.00" -> "25000", "900.50" stays */
const plainMoney = (value: string | null | undefined) => text(value).replace(/\.00$/, '')

export function fromCampaign(campaign: Campaign, workspaceZone: string): CampaignFormValues {
  const zone = campaign.send_timezone || workspaceZone
  const base = emptyValues(zone, campaign.owner_user ?? '')
  const recurring = campaign.recurring_config
  const drip = campaign.drip_config
  const targets = campaign.targets
  return {
    ...base,
    name: campaign.name, code: campaign.code ?? '', description: campaign.description ?? '',
    campaign_type: campaign.campaign_type as CampaignFormValues['campaign_type'], channel: campaign.channel as CampaignFormValues['channel'],
    solicitation_type: campaign.solicitation_type as CampaignFormValues['solicitation_type'],
    tags: campaign.tags ?? [], contact_lists: campaign.contact_lists, excluded_lists: campaign.excluded_lists ?? [],
    template: campaign.template ?? '', sender_profile: campaign.sender_profile ?? '', subject_line: campaign.subject_line ?? '', preheader: campaign.preheader ?? '', topic: campaign.topic ?? '',
    send_type: campaign.send_type ?? 'IMMEDIATE', scheduled_at: isoToZoned(campaign.scheduled_at, zone),
    recurring: recurring
      ? {
          frequency: recurring.frequency, interval: text(recurring.interval ?? 1), weekdays: recurring.weekdays ?? [], day_of_month: text(recurring.day_of_month ?? 1),
          time: recurring.time || '09:00', ends: recurring.max_runs ? 'AFTER' : recurring.end_date ? 'ON' : 'NEVER', end_date: recurring.end_date ?? '', max_runs: text(recurring.max_runs),
        }
      : base.recurring,
    drip: drip?.steps?.length ? { time: drip.time || '09:00', steps: drip.steps.map((step) => ({ day: text(step.day), label: step.label ?? '' })) } : base.drip,
    respect_governance: campaign.respect_governance ?? true, rate_limit_per_hour: text(campaign.rate_limit_per_hour), timezone_optimization: campaign.timezone_optimization ?? false,
    targets: targets
      ? {
          target_revenue: plainMoney(targets.target_revenue), target_opens: text(targets.target_opens), target_clicks: text(targets.target_clicks),
          target_conversions: text(targets.target_conversions), target_redemptions: text(targets.target_redemptions), planned_cost: plainMoney(targets.planned_cost),
          planned_offer_cost: plainMoney(targets.planned_offer_cost), notes: targets.notes ?? '',
        }
      : base.targets,
  }
}

const whole = (value: string) => (value.trim() === '' ? null : Number(value))
const amount = (value: string) => (value.trim() === '' ? null : value.trim())

export function toInput(values: CampaignFormValues, rowVersion?: number): CampaignInput {
  const receipt = values.campaign_type === 'E_RECEIPT'
  const texts = values.channel === 'SMS' || values.channel === 'MMS'
  const sendType = receipt ? 'IMMEDIATE' : values.send_type
  const recurring: RecurringConfig | null =
    sendType === 'RECURRING'
      ? {
          frequency: values.recurring.frequency, interval: Number(values.recurring.interval || '1'), time: values.recurring.time,
          ...(values.recurring.frequency === 'WEEKLY' ? { weekdays: values.recurring.weekdays } : {}),
          ...(values.recurring.frequency === 'MONTHLY' ? { day_of_month: Number(values.recurring.day_of_month) } : {}),
          end_date: values.recurring.ends === 'ON' ? values.recurring.end_date : null,
          max_runs: values.recurring.ends === 'AFTER' ? Number(values.recurring.max_runs) : null,
        }
      : null
  const drip: DripConfig | null =
    sendType === 'DRIP'
      ? { time: values.drip.time, steps: values.drip.steps.map((step) => ({ day: Number(step.day), ...(step.label ? { label: step.label } : {}) })).sort((a, b) => a.day - b.day) }
      : null
  const targets: CampaignTargets = {
    target_revenue: amount(values.targets.target_revenue), target_opens: whole(values.targets.target_opens), target_clicks: whole(values.targets.target_clicks),
    target_conversions: whole(values.targets.target_conversions), target_redemptions: whole(values.targets.target_redemptions), planned_cost: amount(values.targets.planned_cost),
    planned_offer_cost: amount(values.targets.planned_offer_cost), notes: values.targets.notes.trim() || null,
  }
  return {
    name: values.name.trim().replace(/\s+/g, ' '),
    code: values.code.trim().toUpperCase() || undefined,
    description: values.description.trim() || null,
    campaign_type: values.campaign_type,
    channel: values.channel as Channel,
    solicitation_type: values.solicitation_type,
    owner_user: values.owner_user || null,
    tags: values.tags,
    contact_lists: receipt ? [] : values.contact_lists,
    excluded_lists: receipt ? [] : values.excluded_lists,
    template: values.template || null,
    sender_profile: values.sender_profile || null,
    subject_line: texts ? null : values.subject_line.trim() || null,
    preheader: texts ? null : values.preheader.trim() || null,
    topic: receipt ? null : values.topic || null,
    send_type: sendType,
    scheduled_at: sendType === 'SCHEDULED' ? zonedToIso(values.scheduled_at, values.send_timezone) : null,
    send_timezone: values.send_timezone || null,
    recurring_config: recurring,
    drip_config: drip,
    respect_governance: values.respect_governance,
    rate_limit_per_hour: whole(values.rate_limit_per_hour),
    timezone_optimization: values.timezone_optimization,
    targets,
    row_version: rowVersion,
  }
}
