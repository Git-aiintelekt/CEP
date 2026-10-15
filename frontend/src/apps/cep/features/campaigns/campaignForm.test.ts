import { expect, test } from 'vitest'

import { makeCampaign } from '@/test/mockApi'

import { campaignSchema, emptyValues, fromCampaign, toInput } from './schema'
import { describeRecurrence, whenText } from './vocabulary'
import { isoToZoned, zonedToIso } from './zone'

test('a send time is a clock time in the campaign time zone, whatever the browser is set to, across daylight saving', () => {
  expect(zonedToIso('2026-11-02T09:00', 'America/Chicago')).toBe('2026-11-02T15:00:00.000Z') // CST, UTC-6
  expect(zonedToIso('2026-07-02T09:00', 'America/Chicago')).toBe('2026-07-02T14:00:00.000Z') // CDT, UTC-5
  expect(zonedToIso('2026-11-02T09:00', 'Asia/Kolkata')).toBe('2026-11-02T03:30:00.000Z')
  expect(isoToZoned('2026-11-02T15:00:00Z', 'America/Chicago')).toBe('2026-11-02T09:00')
  expect(isoToZoned(zonedToIso('2026-03-08T09:30', 'America/New_York'), 'America/New_York')).toBe('2026-03-08T09:30') // the day the clocks change
  expect(zonedToIso('not a date', 'America/Chicago')).toBeNull()
  expect(zonedToIso('2026-11-02T09:00', 'Mars/Olympus')).toBeNull()
})

test('the schema checks each send type for what it needs, and nothing else', () => {
  const base = { ...emptyValues('America/New_York', 'u1'), name: 'Fall Launch' }
  const problems = (values: typeof base) => {
    const result = campaignSchema.safeParse(values)
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
  }
  expect(problems(base)).toEqual({})
  expect(problems({ ...base, name: 'ab' })).toEqual({ name: 'Use at least 3 characters.' })
  expect(problems({ ...base, send_type: 'SCHEDULED' })).toEqual({ scheduled_at: 'Choose the date and time of the send.' })
  expect(problems({ ...base, send_type: 'SCHEDULED', scheduled_at: '2020-01-01T09:00' })).toEqual({ scheduled_at: 'Choose a time in the future.' })
  expect(problems({ ...base, send_type: 'SCHEDULED', scheduled_at: '2099-01-01T09:00' })).toEqual({})
  expect(problems({ ...base, send_type: 'RECURRING' })).toEqual({ 'recurring.weekdays': 'Choose at least one day of the week.' })
  expect(problems({ ...base, send_type: 'RECURRING', recurring: { ...base.recurring, frequency: 'MONTHLY', day_of_month: '32', ends: 'AFTER', max_runs: '' } }))
    .toEqual({ 'recurring.day_of_month': 'Between 1 and 31.', 'recurring.max_runs': 'Between 1 and 999.' })
  // a drip's messages, days and times are rows the API owns (the Sequence step): the form checks nothing of them
  expect(problems({ ...base, campaign_type: 'DRIP', send_type: 'DRIP' })).toEqual({})
  expect(problems({ ...base, targets: { ...base.targets, target_revenue: '12.345', target_clicks: '-4' } }))
    .toEqual({ 'targets.target_revenue': 'Enter an amount such as 2500 or 2500.50.', 'targets.target_clicks': 'Enter a whole number, zero or more.' })
})

test('form -> API: empty boxes are "not set", the schedule is converted from the campaign time zone, only the chosen send type carries its settings', () => {
  const values = {
    ...emptyValues('America/New_York', 'u1'), name: '  Fall   Launch ', code: 'fall-26', tags: ['Fall'], contact_lists: ['cl-master'], excluded_lists: ['cl-ga'], send_type: 'SCHEDULED' as const,
    scheduled_at: '2026-11-02T09:00', send_timezone: 'America/Chicago', rate_limit_per_hour: '5000',
    targets: { ...emptyValues('UTC', '').targets, target_revenue: '25000', target_clicks: '40' },
  }
  expect(toInput(values, 7)).toMatchObject({
    name: 'Fall Launch', code: 'FALL-26', description: null, owner_user: 'u1', tags: ['Fall'], contact_lists: ['cl-master'], excluded_lists: ['cl-ga'], template: null, send_type: 'SCHEDULED',
    scheduled_at: '2026-11-02T15:00:00.000Z', send_timezone: 'America/Chicago', recurring_config: null, drip_config: null, rate_limit_per_hour: 5000, row_version: 7,
    targets: { target_revenue: '25000', target_clicks: 40, target_opens: null, planned_cost: null, notes: null },
  })
  const weekly = toInput({ ...values, send_type: 'RECURRING', recurring: { ...values.recurring, weekdays: ['MO', 'TH'], ends: 'AFTER', max_runs: '6' } })
  expect(weekly).toMatchObject({ scheduled_at: null, recurring_config: { frequency: 'WEEKLY', interval: 1, weekdays: ['MO', 'TH'], time: '09:00', end_date: null, max_runs: 6 } })
  // a drip leaves out its series, template, subject, preheader and start date: the API owns the messages, and the start is set on Sequence
  const series = toInput({ ...values, campaign_type: 'DRIP', send_type: 'DRIP', template: 't1', subject_line: 'Hello', preheader: 'Hi', sender_profile: 'sp-1' })
  for (const key of ['drip_config', 'template', 'subject_line', 'preheader', 'scheduled_at']) expect(series).not.toHaveProperty(key)
  expect(series).toMatchObject({ campaign_type: 'DRIP', send_type: 'DRIP', sender_profile: 'sp-1', contact_lists: ['cl-master'], row_version: undefined })
  expect(toInput({ ...values, campaign_type: 'E_RECEIPT' })).toMatchObject({ contact_lists: [], excluded_lists: [], send_type: 'IMMEDIATE', scheduled_at: null })
})

test('API -> form -> API is stable, and the wording of a schedule reads like a sentence', () => {
  const stored = makeCampaign({
    send_type: 'RECURRING', send_timezone: 'America/Chicago', tags: ['VIP'], excluded_lists: ['cl-ga'],
    recurring_config: { frequency: 'WEEKLY', interval: 2, weekdays: ['MO', 'TH'], time: '08:30', end_date: '2026-12-31', max_runs: null },
    targets: { target_revenue: '25000.00', target_opens: null, target_clicks: 40, target_conversions: null, target_redemptions: null, planned_cost: '900.50', planned_offer_cost: null, notes: 'Q4' },
  })
  const form = fromCampaign(stored, 'America/New_York')
  expect(form.recurring).toMatchObject({ frequency: 'WEEKLY', interval: '2', weekdays: ['MO', 'TH'], time: '08:30', ends: 'ON', end_date: '2026-12-31' })
  expect(form.targets).toMatchObject({ target_revenue: '25000', planned_cost: '900.50', target_clicks: '40', target_opens: '' })
  expect(toInput(form).recurring_config).toEqual({ frequency: 'WEEKLY', interval: 2, weekdays: ['MO', 'TH'], time: '08:30', end_date: '2026-12-31', max_runs: null })
  expect(describeRecurrence(stored.recurring_config)).toBe('Every 2 weeks on Mon, Thu at 08:30, until 2026-12-31')
  expect(whenText(makeCampaign({ send_type: 'DRIP', drip_config: { time: '10:00', steps: [{ day: 0 }, { day: 3 }] } }), 'UTC')).toBe('2 steps: day 0, 3 at 10:00')
  expect(whenText(makeCampaign({}), 'UTC')).toBe('As soon as it is published')
})
