/**
 * A drip's Sequence step through the real app against the in-memory API: the timeline, Series at a Glance, the message
 * drawer (email and SMS), Add and Remove, Continue's problem banner, and what each change sends where.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { DripStep } from '@/lib/types'
import { installMockApi, makeCampaign, makeStep, signIn, tags } from '@/test/mockApi'

import { calendarOf, gapBefore, seriesOf, statusText, sequenceProblems } from '../dripSequence'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

type Call = { method: string; url: string; body: unknown }
const START = '2026-10-12T14:00:00Z'                     // Mon 12 Oct 2026, 09:00 in Chicago
const tpl = (id: string, channel: 'EMAIL' | 'SMS' | 'MMS' = 'EMAIL') => ({ id, name: `Loyalty Welcome · ${id}`, channel, status: 'DRAFT' })
const drip = (overrides = {}) => makeCampaign({
  name: 'Loyalty Welcome', status: 'DRAFT', campaign_type: 'DRIP', send_type: 'DRIP', setup_step: 2, scheduled_at: START, send_timezone: 'America/Chicago',
  drip_config: { steps: [] }, template: 't1', sender_profile: 'snd-email', ...overrides,
})
const four = (): DripStep[] => [
  makeStep({ id: 's1', day: 0, name: 'Welcome', template: tpl('t1'), subject_line: 'Welcome to Rewards', ab_config: { enabled: true, subject_b: 'Your card is ready', sample_pct: 20, metric: 'OPEN_RATE', decide_after_minutes: 240 } }),
  makeStep({ id: 's2', day: 3, name: 'How Points Work', template: tpl('t2'), subject_line: '3 ways to earn points' }),
  makeStep({ id: 's3', day: 4, name: 'First Reward', template: tpl('t3'), subject_line: 'Welcome to Rewards', send_time: '18:00' }),
  makeStep({ id: 's4', day: 14, name: 'Reminder' }),
]
const ready = (): DripStep[] => four().slice(0, 3)
const stepCalls = (calls: Call[]) => calls.filter((call) => call.url.includes('/steps/') && call.method !== 'GET')
const campaignPatches = (calls: Call[]) => calls.filter((call) => call.method === 'PATCH' && /\/campaigns\/c1\/(\?|$)/.test(call.url))
const card = (position: number, name: string) => screen.findByRole('button', { name: `Open message ${position}, ${name}` }, { timeout: 4000 })
const drawer = (name: string) => screen.findByRole('dialog', { name })

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the arithmetic: gaps, a close pair, the calendar weeks and the footer line', () => {
  const steps = four().map((step, index) => ({ ...step, position: index + 1 }))
  const series = seriesOf(drip(), 'America/New_York')
  expect(series).toMatchObject({ start: '2026-10-12', time: '09:00', zoneShort: 'CT' })
  expect(steps.map((_, index) => gapBefore(steps, index).label)).toEqual(['On the start date', '3 days later', '1 day later', '10 days later'])
  expect(gapBefore(steps, 2)).toMatchObject({ close: true, note: 'Close together. Frequency limits may skip some people.' })
  const calendar = calendarOf(steps, series)
  expect(calendar?.title).toBe('October 2026')                                     // the months of the first and last send
  expect(calendar?.cells).toHaveLength(21)                                          // Mon 12 Oct to Sun 1 Nov
  expect(calendar?.cells.filter((cell) => cell.messages.length).map((cell) => cell.name)).toEqual([
    'Mon 12 Oct 2026, message 1', 'Thu 15 Oct 2026, message 2', 'Fri 16 Oct 2026, message 3', 'Mon 26 Oct 2026, message 4'])
  expect(statusText(steps, sequenceProblems(steps, series))).toBe('1 of 4 messages needs attention.')
})

test('the timeline: cards in day order with their eyebrow and tags, gap pills, the start marker, the summary and the calendar', async () => {
  installMockApi({ campaign: drip(), dripSteps: { c1: four() } })
  await renderAppAt('/campaigns/c1/edit?step=sequence')

  await card(1, 'Welcome')
  expect(screen.queryByText(/Every message goes to everyone on the campaign list/)).toBeNull()                 // no description on this step
  const second = await card(2, 'How Points Work')
  expect(second.textContent).toContain('Message 2 of 4 · Day 3 · Thu 15 Oct, 09:00 CT')
  expect(second.textContent).toContain('3 ways to earn points')
  const cards = screen.getAllByRole('button', { name: /^Open message/ })
  expect(cards.map((item) => item.getAttribute('aria-label'))).toEqual(['Open message 1, Welcome', 'Open message 2, How Points Work', 'Open message 3, First Reward', 'Open message 4, Reminder'])
  const tags = (item: HTMLElement) => [...item.querySelectorAll('[data-tag]')].map((tag) => tag.textContent)
  expect(tags(cards[0])).toEqual(['Ready', 'A/B Subject Test'])
  expect(tags(cards[2])).toEqual(['Ready', 'Same Subject as Message 1', 'Own Send Time'])
  expect(cards[2].textContent).toContain('Day 4 · Fri 16 Oct, 18:00 CT')
  expect(tags(cards[3])).toEqual(['Needs Template'])
  expect(cards[3].querySelector('[data-thumb="empty"]')).toBeTruthy()

  const pills = [...document.querySelectorAll('[data-gap]')]
  expect(pills.map((pill) => pill.textContent)).toEqual(['On the start date', '3 days later', '1 day laterClose together. Frequency limits may skip some people.', '10 days later'])
  expect(pills[2].getAttribute('data-gap')).toBe('close')
  expect((await screen.findByText(/contacts start together/)).closest('[data-start-marker]')?.textContent).toBe('Start · Mon 12 Oct 2026 · 88 contacts start together')

  const summary = document.querySelector('[data-series-summary]')
  expect(summary?.textContent).toBe('4 messages over 15 daysLast message sends Mon 26 Oct 2026, 09:00 CT')
  expect(screen.getByRole('gridcell', { name: 'Thu 15 Oct 2026, message 2' }).textContent).toBe('15M2')
  expect(screen.getByRole('gridcell', { name: 'Wed 14 Oct 2026, in the series' })).toBeTruthy()
  expect(screen.getByText('In the Series')).toBeTruthy()
  expect(screen.getByText('Frequency Limits').nextElementSibling?.textContent).toBe('On')
  expect(document.querySelector('[data-sequence-status]')?.textContent).toBe('1 of 4 messages needs attention.')
  expect(screen.getByRole('button', { name: 'Send From: Northwind Rewards · rewards@northwind.example' })).toBeTruthy()
  expect(screen.getByText('Verified senders only.')).toBeTruthy()
})

test('without a start date: the marker and the summary ask for one, and Continue says so instead of moving on', async () => {
  const calls = installMockApi({ campaign: drip({ scheduled_at: null }), dripSteps: { c1: ready() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')

  await card(1, 'Welcome')
  expect(document.querySelector('[data-start-marker]')?.textContent).toBe('Start · Choose a start date')
  expect(document.querySelector('[data-series-summary]')?.textContent).toContain('Choose a start date to see the dates.')
  expect(screen.queryByRole('grid', { name: 'Series Calendar' })).toBeNull()
  expect((await card(2, 'How Points Work')).textContent).toContain('Message 2 of 3 · Day 3 · 09:00 CT')

  await user.click(screen.getByRole('button', { name: /Continue to Targets/ }))
  expect((await screen.findByRole('alert')).textContent).toContain('Choose a start date.')
  expect(campaignPatches(calls)).toHaveLength(0)
  expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Drip Campaign Setup')
})

test('Continue with problems: the banner, the flagged card, Show First Problem; once all are ready it moves on to Targets', async () => {
  const steps = { c1: four() }
  const calls = installMockApi({ campaign: drip(), dripSteps: steps }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')

  const reminder = await card(4, 'Reminder')
  await user.click(screen.getByRole('button', { name: /Continue to Targets/ }))
  const banner = await screen.findByText('1 message needs attention before you continue.')
  expect(banner).toBeTruthy()
  expect(reminder.getAttribute('data-flagged')).toBe('true')
  expect((await card(1, 'Welcome')).getAttribute('data-flagged')).toBeNull()
  expect(campaignPatches(calls)).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Show First Problem' }))
  expect(document.activeElement).toBe(reminder)

  // the last message gets its template: nothing blocks Continue now
  await user.click(reminder)
  const panel = await drawer('Reminder')
  await user.click(within(panel).getByRole('button', { name: 'Copy Message 3' }))
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)).toMatchObject({ method: 'PATCH', body: { template: 't3', row_version: 1 } }))
  await user.type(within(panel).getByLabelText('Subject Line'), 'Your reward ends Sunday')
  await user.click(within(panel).getByRole('button', { name: 'Done' }))                                // Done saves what was typed
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)?.body).toEqual({ subject_line: 'Your reward ends Sunday', row_version: 2 }))
  expect(stepCalls(calls).filter((call) => (call.body as { subject_line?: string }).subject_line)).toHaveLength(1)   // once, not again on Done
  await vi.waitFor(() => expect(document.querySelector('[data-sequence-status]')?.textContent).toBe('All 4 messages are ready.'))
  await user.click(screen.getByRole('button', { name: /Continue to Targets/ }))
  await vi.waitFor(() => expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Targets'))
  expect(campaignPatches(calls).at(-1)?.body).toMatchObject({ setup_step: 3 })
})

test('Add Message: a copy of the last by default; its drawer opens with the subject kept', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: ready() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await card(3, 'First Reward')

  await user.click(screen.getByRole('button', { name: 'Add Message' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Message 4' })
  expect(within(dialog).getByText('It goes on Day 7 (Mon 19 Oct). You can change the day after.')).toBeTruthy()
  expect(within(dialog).getByRole('radio', { name: 'Copy of Message 3' }).getAttribute('aria-checked')).toBe('true')
  expect(within(dialog).getByText('Recommended')).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Add Message' }))
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)).toMatchObject({ method: 'POST', url: expect.stringContaining('/steps/s3/copy-as-next/') }))
  const opened = await screen.findByRole('dialog', { name: 'Untitled Message' })
  expect(within(opened).getByText('Message 4 of 4')).toBeTruthy()
  expect((within(opened).getByLabelText('Subject Line') as HTMLInputElement).value).toBe('Welcome to Rewards')         // a copy keeps the subject
  expect(within(opened).getByText('Message 1 has the same subject. Give each message its own job.')).toBeTruthy()
})

test('Add Message: blank', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: ready() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await card(3, 'First Reward')

  await user.click(screen.getByRole('button', { name: 'Add Message' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Message 4' })
  await user.click(within(dialog).getByRole('radio', { name: 'Blank' }))
  await user.click(within(dialog).getByRole('button', { name: 'Add Message' }))
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)).toMatchObject({ method: 'POST', body: { start_from: 'blank' } }))
  const opened = await screen.findByRole('dialog', { name: 'Untitled Message' })
  expect(within(opened).getByText('Message 4 of 4')).toBeTruthy()
})

test('Add Message: from the gallery, nothing is made until a template is picked', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: ready() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await card(3, 'First Reward')

  await user.click(screen.getByRole('button', { name: 'Add Message' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Message 4' })
  await user.click(within(dialog).getByRole('radio', { name: 'Choose from Template Gallery' }))
  const before = stepCalls(calls).length
  await user.click(within(dialog).getByRole('button', { name: 'Add Message' }))
  const gallery = await screen.findByRole('dialog', { name: 'Choose a Template' })
  await user.click(await within(gallery).findByRole('button', { name: 'Preview Fall Email' }))
  const preview = await screen.findByRole('dialog', { name: 'Fall Email' })
  expect(stepCalls(calls)).toHaveLength(before)                                                       // looking creates nothing
  await user.click(within(preview).getByRole('button', { name: 'Use This Template' }))
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)).toMatchObject({ method: 'POST', body: { start_from: 'template', template: 'tpl-email' } }))
  expect(stepCalls(calls).at(-1)?.body).not.toHaveProperty('consume_source')                            // a saved template is never removed
  const opened = await screen.findByRole('dialog', { name: 'Untitled Message' })
  expect(within(opened).getByText('Message 4 of 4')).toBeTruthy()
})

test('Add Message from a preset: the Draft it makes is consumed once copied (consume_source)', async () => {
  const extra = ['discount_pct', 'shop_url'].map((key) => ({ ...tags[0], id: key, tag_key: key, label: key, platform_tag_id: null }))
  const steps = [makeStep({ id: 'x1', day: 0, name: 'Welcome Text', template: tpl('tx1', 'SMS'), text_excerpt: 'Hi {{first_name}}. Reply STOP to opt out.' })]
  const calls = installMockApi({ campaign: drip({ channel: 'SMS', sender_profile: 'snd-sms', template: 'tx1' }), dripSteps: { c1: steps }, tags: [...tags, ...extra] }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await card(1, 'Welcome Text')

  await user.click(screen.getByRole('button', { name: 'Add Message' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Message 2' })
  await user.click(within(dialog).getByRole('radio', { name: 'Choose from Template Gallery' }))
  await user.click(within(dialog).getByRole('button', { name: 'Add Message' }))
  const gallery = await screen.findByRole('dialog', { name: 'Choose a Template' })
  await user.click(await within(gallery).findByRole('button', { name: 'Preview SMS offer' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'SMS offer' })).getByRole('button', { name: 'Copy This Template' }))
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)).toMatchObject({ method: 'POST', body: { start_from: 'template', consume_source: true } }))
  const made = calls.find((call) => call.method === 'POST' && /\/templates\/$/.test(call.url))
  expect(made).toBeTruthy()
})

test('text cards show the message’s excerpt, with no preview request per card', async () => {
  const steps = [makeStep({ id: 'x1', day: 0, name: 'Welcome Text', template: tpl('tx1', 'SMS'), text_excerpt: 'Hi {{first_name}}, welcome to Rewards. Reply STOP to opt out.' }),
                 makeStep({ id: 'x2', day: 3, name: 'Points Text', template: tpl('tx2', 'SMS'), text_excerpt: null })]
  const calls = installMockApi({ campaign: drip({ channel: 'SMS', sender_profile: 'snd-sms', template: 'tx1' }), dripSteps: { c1: steps } }) as Call[]
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  expect((await card(1, 'Welcome Text')).textContent).toContain('Hi {{first_name}}, welcome to Rewards. Reply STOP to opt out.')
  expect((await card(2, 'Points Text')).textContent).toContain('No message text yet')
  expect(calls.filter((call) => /\/templates\/tx\d/.test(call.url))).toHaveLength(0)
})

test('the send time saves on its own before there is a start date', async () => {
  const calls = installMockApi({ campaign: drip({ scheduled_at: null }), dripSteps: { c1: ready() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await card(1, 'Welcome')
  await user.click(screen.getByRole('button', { name: 'Send Time: 09:00' }))
  await user.click(screen.getByRole('option', { name: '07:30' }))
  await vi.waitFor(() => expect(campaignPatches(calls).at(-1)?.body).toEqual({ drip_config: { time: '07:30' }, row_version: 1 }))
  expect((await card(2, 'How Points Work')).textContent).toContain('Day 3 · 07:30 CT')
  expect(stepCalls(calls)).toHaveLength(0)
})

test('Add Message is off at 30 messages, with the reason', async () => {
  const thirty = Array.from({ length: 30 }, (_, index) => makeStep({ id: `m${index}`, day: index * 2, name: `Message ${index}`, template: tpl(`t${index}`), subject_line: `Subject ${index}` }))
  installMockApi({ campaign: drip(), dripSteps: { c1: thirty } })
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  const add = await screen.findByRole('button', { name: 'Add Message' })
  expect((add as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('This drip has 30 messages, the most it can hold. Remove one to add another.')).toBeTruthy()
})

test('the email drawer: each field saves on leaving it with row_version; a same-day refusal shows under Day; a 409 reloads with the notice', async () => {
  const steps = { c1: four() }
  const calls = installMockApi({ campaign: drip(), dripSteps: steps }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await user.click(await card(2, 'How Points Work'))
  const panel = await drawer('How Points Work')
  expect(within(panel).getByText('Message 2 of 4')).toBeTruthy()
  expect(within(panel).getByText('Sends Thu 15 Oct 2026 at 09:00 CT to everyone on the campaign list who is still subscribed and within frequency limits.')).toBeTruthy()
  expect(within(panel).getByText('Email template · copied for this message')).toBeTruthy()
  expect(within(panel).getByRole('button', { name: 'Edit Template' })).toBeTruthy()

  const name = within(panel).getByLabelText('Internal Name')
  await user.clear(name)
  await user.type(name, 'Earning Points')
  await user.tab()
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)).toMatchObject({ method: 'PATCH', url: expect.stringContaining('/steps/s2/'), body: { name: 'Earning Points', row_version: 1 } }))

  const subject = within(panel).getByLabelText('Subject Line')
  await user.clear(subject)
  await user.type(subject, 'Earn faster')
  const preheader = within(panel).getByLabelText('Preheader')
  await user.click(preheader)
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)?.body).toEqual({ subject_line: 'Earn faster', row_version: 2 }))
  await user.type(preheader, 'Shop, review and refer.')
  await user.tab()
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)?.body).toEqual({ preheader: 'Shop, review and refer.', row_version: 3 }))

  await user.click(within(panel).getByRole('button', { name: 'Send Time: Series time (09:00)' }))
  await user.click(within(panel).getByRole('option', { name: '07:30' }))
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)?.body).toEqual({ send_time: '07:30', row_version: 4 }))

  const day = within(panel).getByLabelText('Day')
  await user.clear(day)
  await user.type(day, '14')
  await user.tab()
  expect((await within(panel).findByRole('alert')).textContent).toBe('Another message is already on this day.')
  expect(day.getAttribute('aria-invalid')).toBe('true')

  // someone else saves this message meanwhile: the next save is refused, the list is read again
  steps.c1 = steps.c1.map((step) => (step.id === 's2' ? { ...step, row_version: 9, name: 'Changed Elsewhere' } : step))
  await user.clear(day)
  await user.type(day, '5')
  await user.tab()
  expect(await within(panel).findByText('This message changed somewhere else. The latest version is shown.')).toBeTruthy()
  await vi.waitFor(() => expect((within(panel).getByLabelText('Internal Name') as HTMLInputElement).value).toBe('Changed Elsewhere'))
})

test('the A/B subject test: on with Subject B, off again, and locked while another message has it', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: four() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')

  await user.click(await card(2, 'How Points Work'))
  let panel = await drawer('How Points Work')
  const locked = within(panel).getByRole('switch', { name: 'A/B Subject Test' })
  expect((locked as HTMLButtonElement).disabled).toBe(true)
  expect(within(panel).getByText('Message 1 is already being tested. One message per drip can have an A/B test.')).toBeTruthy()
  await user.click(within(panel).getByRole('button', { name: 'Done' }))

  await user.click(await card(1, 'Welcome'))
  panel = await drawer('Welcome')
  const toggle = within(panel).getByRole('switch', { name: 'A/B Subject Test' })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect((within(panel).getByLabelText('Subject B') as HTMLInputElement).value).toBe('Your card is ready')
  expect(within(panel).getByText('The winner goes to the rest of the list 4 hours later. Later messages are not tested.')).toBeTruthy()
  await user.click(within(panel).getByRole('button', { name: 'Test Group: 20% of the List' }))
  await user.click(within(panel).getByRole('option', { name: '30% of the List' }))
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)?.body).toEqual({
    ab_config: { enabled: true, subject_b: 'Your card is ready', sample_pct: 30, metric: 'OPEN_RATE', decide_after_minutes: 240 }, row_version: 1 }))
  await user.click(toggle)
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)?.body).toEqual({ ab_config: null, row_version: 2 }))
  expect(within(panel).queryByLabelText('Subject B')).toBeNull()

  // with the test off, another message may have it: switched on, it saves once Subject B is filled in
  await user.click(within(panel).getByRole('button', { name: 'Done' }))
  await user.click(await card(2, 'How Points Work'))
  panel = await drawer('How Points Work')
  await vi.waitFor(() => expect((within(panel).getByRole('switch', { name: 'A/B Subject Test' }) as HTMLButtonElement).disabled).toBe(false))
  const count = stepCalls(calls).length
  await user.click(within(panel).getByRole('switch', { name: 'A/B Subject Test' }))
  expect(within(panel).getByText('The test is saved once Subject B is filled in.')).toBeTruthy()
  expect(stepCalls(calls)).toHaveLength(count)
  await user.type(within(panel).getByLabelText('Subject B'), 'Points, explained')
  await user.tab()
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)?.body).toMatchObject({ ab_config: { enabled: true, subject_b: 'Points, explained', sample_pct: 20, metric: 'OPEN_RATE' } }))
})

test('an SMS message: no subject, the text composed in the drawer with chips, the counter and the phone, saved to the template copy', async () => {
  const steps = [makeStep({ id: 'x1', day: 0, name: 'Welcome Text', template: tpl('tx1', 'SMS') }), makeStep({ id: 'x2', day: 3, name: 'Points Text', template: tpl('tx2', 'SMS') })]
  const calls = installMockApi({ campaign: drip({ channel: 'SMS', sender_profile: 'snd-sms', template: 'tx1' }), dripSteps: { c1: steps } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')

  await user.click(await card(2, 'Points Text'))
  const panel = await drawer('Points Text')
  expect(within(panel).queryByLabelText('Subject Line')).toBeNull()
  expect(within(panel).queryByRole('button', { name: 'Edit Template' })).toBeNull()
  expect(within(panel).getAllByRole('button', { name: 'Edit Text' })).toHaveLength(1)
  expect(within(panel).getByText('A/B testing is available for email only.')).toBeTruthy()
  await vi.waitFor(() => expect(within(panel).getByRole('button', { name: 'Edit Text' }).hasAttribute('disabled')).toBe(false))

  await user.click(within(panel).getByRole('button', { name: 'Edit Text' }))
  const text = within(panel).getByLabelText('Message Text')
  await user.clear(text)
  await user.type(text, 'Earn points 3 ways. Reply STOP to opt out.')
  await user.click(within(panel).getByRole('button', { name: /First name/ }))
  expect((text as HTMLTextAreaElement).value).toBe('Earn points 3 ways. Reply STOP to opt out. {{first_name}}')
  expect(within(panel).getByText(/ \/ 160 · 1 part$/)).toBeTruthy()
  expect(within(panel).getByTestId('drip-sms-preview').textContent).not.toContain('{{')
  expect(within(panel).getByText('Northwind SMS · 55512')).toBeTruthy()

  const before = stepCalls(calls).length
  await user.click(within(panel).getByRole('button', { name: 'Save Text' }))
  await vi.waitFor(() => expect(calls.find((call) => call.method === 'POST' && call.url.includes('/templates/tx2/message/'))?.body)
    .toMatchObject({ sms_body: 'Earn points 3 ways. Reply STOP to opt out. {{first_name}}' }))
  expect(stepCalls(calls)).toHaveLength(before)                                                            // never on the step
  expect(await screen.findByText('Message 2 saved.')).toBeTruthy()
})

test('Remove Message asks first, then deletes; a drip with one message offers no Remove and suggests a scheduled send', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: ready() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await user.click(await card(2, 'How Points Work'))
  const panel = await drawer('How Points Work')
  await user.click(within(panel).getByRole('button', { name: 'Remove Message' }))
  const confirm = await screen.findByRole('dialog', { name: 'Remove “How Points Work”?' })
  expect(within(confirm).getByText('The message and its template copy are removed from this drip. The other messages keep their days.')).toBeTruthy()
  await user.click(within(confirm).getByRole('button', { name: 'Remove Message' }))
  await vi.waitFor(() => expect(stepCalls(calls).at(-1)).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/steps/s2/') }))
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Open message 2, How Points Work' })).toBeNull())
  expect(screen.queryByRole('dialog', { name: 'How Points Work' })).toBeNull()

  cleanup()
  installMockApi({ campaign: drip(), dripSteps: { c1: ready().slice(0, 1) } })
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await user.click(await card(1, 'Welcome'))
  const only = await drawer('Welcome')
  expect(within(only).queryByRole('button', { name: 'Remove Message' })).toBeNull()
  await user.click(within(only).getByRole('button', { name: 'Done' }))
  expect(screen.getByText(/A drip with one message is a scheduled send\. A Regular Marketing campaign may suit it better\./)).toBeTruthy()
  await user.click(within(document.querySelector<HTMLElement>('[data-one-message]')!).getByRole('button', { name: 'Edit Details' }))
  expect(await screen.findByRole('dialog', { name: /Edit Details|Campaign Details/ })).toBeTruthy()
})

test('the start date, the send time and the zone patch only those campaign fields, and never the messages', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: ready() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await card(1, 'Welcome')

  await user.click(screen.getByRole('button', { name: 'Send Time: 09:00' }))
  await user.click(screen.getByRole('option', { name: '18:00' }))
  await vi.waitFor(() => expect(campaignPatches(calls).at(-1)?.body).toEqual({ drip_config: { time: '18:00' }, row_version: 1 }))
  expect(screen.getByRole('button', { name: 'Send Time: 18:00' })).toBeTruthy()
  expect(screen.queryByText('Set when the drip was created.')).toBeNull()

  await user.click(await screen.findByRole('button', { name: /^Time Zone: America\/Chicago/ }))
  await user.click(screen.getByRole('option', { name: 'America/New_York' }))
  await vi.waitFor(() => expect(campaignPatches(calls).at(-1)?.body).toMatchObject({ send_timezone: 'America/New_York' }))
  expect(Object.keys(campaignPatches(calls).at(-1)?.body as object).sort()).toEqual(['row_version', 'scheduled_at', 'send_timezone'])

  await user.click(screen.getByRole('button', { name: /^Start Date/ }))
  await user.click(await screen.findByRole('button', { name: 'Monday, October 19, 2026' }))
  await vi.waitFor(() => expect(Object.keys(campaignPatches(calls).at(-1)?.body as object).sort()).toEqual(['row_version', 'scheduled_at']))

  for (const call of campaignPatches(calls)) {
    for (const key of ['template', 'subject_line', 'preheader', 'ab_config', 'setup_step']) expect(call.body).not.toHaveProperty(key)
    if ('drip_config' in (call.body as object)) expect((call.body as { drip_config: object }).drip_config).toEqual({ time: '18:00' })   // the time alone, never the steps
  }
  expect(stepCalls(calls)).toHaveLength(0)
})

test('Planning Tips hide and stay hidden', async () => {
  installMockApi({ campaign: drip(), dripSteps: { c1: ready() } })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  expect(await screen.findByText(/Build message 1 first/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Hide' }))
  expect(screen.queryByText(/Build message 1 first/)).toBeNull()
  expect(window.localStorage.getItem('cep.drip.planningTips')).toBe('hidden')
  cleanup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  expect(await screen.findByRole('button', { name: 'Show' })).toBeTruthy()
  expect(screen.queryByText(/Build message 1 first/)).toBeNull()
})

test('back from the template editor: the message drawer opens and says it was saved', async () => {
  installMockApi({ campaign: drip(), dripSteps: { c1: four() } })
  await renderAppAt('/campaigns/c1/edit?step=sequence&message=s3&saved=1')
  expect(await drawer('First Reward')).toBeTruthy()
  expect(await screen.findByText('Message 3 saved.')).toBeTruthy()
  await vi.waitFor(() => expect(window.location.search).not.toContain('saved=1'))
  expect(window.location.search).toContain('message=s3')
})

test('leaving two fields one right after the other saves both, in turn, each with the version the last save returned', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: ready() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await user.click(await card(2, 'How Points Work'))
  const panel = await drawer('How Points Work')
  const name = within(panel).getByLabelText('Internal Name')
  const subject = within(panel).getByLabelText('Subject Line')
  fireEvent.change(name, { target: { value: 'Points Explained' } })
  fireEvent.blur(name)
  fireEvent.change(subject, { target: { value: 'Three ways to earn' } })
  fireEvent.blur(subject)                                                                  // before the first save has answered
  await vi.waitFor(() => expect(stepCalls(calls).filter((call) => call.method === 'PATCH')).toHaveLength(2))
  const [first, second] = stepCalls(calls).filter((call) => call.method === 'PATCH').map((call) => call.body as { row_version: number })
  expect(second.row_version).toBe(first.row_version + 1)
  await vi.waitFor(() => expect(within(panel).queryByText('This message changed somewhere else. The latest version is shown.')).toBeNull())
  expect((within(panel).getByLabelText('Subject Line') as HTMLInputElement).value).toBe('Three ways to earn')
})

test('Escape saves what was typed and not yet left, as Done does', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: ready() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await user.click(await card(2, 'How Points Work'))
  const panel = await drawer('How Points Work')
  const subject = within(panel).getByLabelText('Subject Line')
  await user.clear(subject)
  await user.type(subject, 'Earn points three ways')
  await user.keyboard('{Escape}')
  await vi.waitFor(() => expect(stepCalls(calls).filter((call) => call.method === 'PATCH').at(-1)?.body).toMatchObject({ subject_line: 'Earn points three ways' }))
})

test('the step has no description, no help icon and no setup progress line', async () => {
  installMockApi({ campaign: drip({ setup_step: 3 }), dripSteps: { c1: ready() } })
  await renderAppAt('/campaigns/c1/edit?step=sequence')
  await card(1, 'Welcome')
  expect(screen.queryByText(/Every message goes to everyone on the campaign list/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Help for this page' })).toBeNull()
  expect(screen.queryByTestId('setup-progress')).toBeNull()
})
