/**
 * A published drip's campaign page through the real app against the in-memory API: the banners, the Resume, Stop and
 * Retry pop-ups, the Series Timeline's states and the Skipped drawer, Message Comparison, the Content tab's message list,
 * Recipients' stopped-early rows and the Activity log's drip entries. Today's cards and tabs stay (StatusMatrix and the
 * other detail tests cover them).
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { Campaign, DripStep, DripStepRun } from '@/lib/types'
import { installMockApi, makeCampaign, makeStep, runRecipients, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

type Call = { method: string; url: string; body: unknown }
const tpl = (id: string, channel: 'EMAIL' | 'SMS' = 'EMAIL') => ({ id, name: `Loyalty Welcome · ${id}`, channel, status: 'ACTIVE' })
const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
const result = (overrides: Partial<DripStepRun> = {}): DripStepRun => ({
  id: 'r1', status: 'COMPLETED', scheduled_at: '2026-10-12T14:00:00Z', started_at: '2026-10-12T14:00:00Z', completed_at: '2026-10-12T14:20:00Z',
  sent: 12094, delivered: 12000, opened: 5796, clicked: 744, unsubscribed: 26, open_rate: 48.3, click_rate: 6.2, unsubscribe_rate: 0.2,
  skipped: { total: 236, by_reason: [{ reason: 'UNSUBSCRIBED', count: 26 }, { reason: 'FREQUENCY_CAP', count: 210 }] }, ab: null, ...overrides,
})
const unsent = (id: string, overrides: Partial<DripStepRun> = {}) => result({ id, status: 'SCHEDULED', started_at: null, completed_at: null, sent: 0, delivered: 0, opened: 0, clicked: 0, unsubscribed: 0,
  open_rate: 0, click_rate: 0, skipped: { total: 0, by_reason: [] }, scheduled_at: later(2), ...overrides })
const winnerB = { variants: [
  { variant_key: 'A' as const, subject_line: 'Welcome to Rewards', allocation_pct: 10, is_winner: false, winner_metric: 'OPEN_RATE' as const, metric_value: 41.2, open_rate: 41.2, click_rate: 5, waiting_for_winner: 0, decide_at: null },
  { variant_key: 'B' as const, subject_line: 'Your card is ready', allocation_pct: 10, is_winner: true, winner_metric: 'OPEN_RATE' as const, metric_value: 48.1, open_rate: 48.1, click_rate: 6, waiting_for_winner: 0, decide_at: null },
], decide_at: '2026-10-12T18:00:00Z' }

const running = (): DripStep[] => [
  makeStep({ id: 's1', day: 0, name: 'Welcome', template: tpl('t1'), subject_line: 'Welcome to Rewards', run: result({ ab: winnerB }),
    ab_config: { enabled: true, subject_b: 'Your card is ready', sample_pct: 20, metric: 'OPEN_RATE', decide_after_minutes: 240 } }),
  makeStep({ id: 's2', day: 3, name: 'How Points Work', template: tpl('t2'), subject_line: '3 ways to earn points', run: unsent('r2', { status: 'SENDING', started_at: '2026-10-15T14:00:00Z', sent: 40 }) }),
  makeStep({ id: 's3', day: 7, name: 'First Reward', template: tpl('t3'), subject_line: 'Your first reward', run: unsent('r3') }),
  makeStep({ id: 's4', day: 14, name: 'Reminder', template: tpl('t4'), subject_line: 'Last call', run: unsent('r4', { scheduled_at: later(9) }) }),
]
const runsOf = (steps: DripStep[]) => steps.flatMap((step) => (step.run ? [{ id: step.run.id, campaign: 'c1', tenant: 't1', run_number: step.position, run_type: 'DRIP_INSTANCE', status: step.run.status,
  test_mode: false, scheduled_at: step.run.scheduled_at, started_at: step.run.started_at, completed_at: step.run.completed_at, sequence_label: `Day ${step.day}`, drip_step: step.id,
  created_at: '2026-10-12T14:00:00Z', updated_at: '2026-10-12T14:00:00Z', row_version: 1 }] : []))
const drip = (steps: DripStep[], overrides: Partial<Campaign> = {}) => makeCampaign({
  name: 'Loyalty Welcome', campaign_type: 'DRIP', send_type: 'DRIP', status: 'ACTIVE', scheduled_at: '2026-10-12T14:00:00Z', send_timezone: 'America/Chicago', audience_size: 90,
  runs: runsOf(steps) as never, drip_progress: { total: 4, sent: 1, failed: 0, cancelled: 0, next: { position: 3, name: 'First Reward', scheduled_at: later(2) } }, ...overrides,
})
const card = (position: number) => document.querySelector<HTMLElement>(`[data-timeline-card="${position}"]`)!
/** waits until the selector matches */
const found = (selector: string) => vi.waitFor(() => {
  const element = document.querySelector<HTMLElement>(selector)
  expect(element).toBeTruthy()
  return element!
})
const posts = (calls: Call[], part: string) => calls.filter((call) => call.method === 'POST' && call.url.includes(part))

/** the fixtures are dated around Mon 12 Oct 2026 and read the clock for "today"; only Date is faked so waits and timers stay real */
beforeEach(() => {
  window.localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-09T16:00:00Z') })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('the Series Timeline: sent with its figures, skips and A/B winner; sending with progress; next up; scheduled; the calendar; and the Skipped drawer', async () => {
  const steps = running()
  installMockApi({ campaign: drip(steps), dripSteps: { c1: steps } })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')

  await vi.waitFor(() => expect(card(4)).toBeTruthy())
  expect([1, 2, 3, 4].map((position) => card(position).getAttribute('data-step-state'))).toEqual(['sent', 'sending', 'next', 'scheduled'])
  expect(document.querySelector('[data-start-marker]')?.textContent).toBe('Started · Mon 12 Oct 2026 · 90 contacts')
  expect(card(1).textContent).toContain('Message 1 of 4 · Day 0 · Mon 12 Oct, 09:00 CT')
  expect(card(1).querySelector('[data-step-figures]')?.textContent).toBe('Sent12,094Opened48.3%Clicked6.2%Unsubscribed26')
  expect(card(1).querySelector('[data-step-skipped]')?.textContent).toBe('Skipped 236: unsubscribed 26, over frequency limit 210.')
  expect(card(1).textContent).toContain('A/B winner: Subject B, 48.1% open rate.')
  expect(card(2).textContent).toContain('40 of 90 sent')
  expect(within(card(2)).getByRole('progressbar')).toBeTruthy()
  expect(card(3).textContent).toMatch(/Next UpSends (today|tomorrow|in \d+ days) to about 90 contacts\. Consent and limits are checked at send time\./)
  expect(card(4).textContent).toContain('Scheduled')
  expect(document.querySelector('[data-today-marker]')).toBeTruthy()
  expect(screen.getByRole('gridcell', { name: 'Mon 12 Oct 2026, message 1, sent' }).getAttribute('data-send')).toBe('sent')
  expect(screen.getByRole('gridcell', { name: /^Mon 19 Oct 2026, message 3/ }).getAttribute('data-send')).toBe('upcoming')
  // the Metrics card gains the drip's progress
  expect((await screen.findByText('Messages Sent')).parentElement?.textContent).toContain('1 of 4')
  expect(screen.getByText('Next Message')).toBeTruthy()

  await user.click(within(card(1)).getByRole('button', { name: 'Skipped 236' }))
  const drawer = await screen.findByRole('dialog', { name: 'Skipped for Message 1' })
  expect(within(drawer).getAllByRole('row').map((row) => row.textContent)).toEqual(['ReasonPeople', 'Unsubscribed26', 'Over Frequency Limit210', 'Total Skipped236'])
  expect(within(drawer).getByText("Skipped people stay in the drip and get later messages if they're eligible then. Unsubscribed people get nothing more.")).toBeTruthy()
})

test('the Skipped drawer: View People lists who the message left out, with search, a reason filter and pages', async () => {
  const steps = running()
  const many = Array.from({ length: 30 }, (_, index) => ({ party_id: `P-${index + 1}`, first_name: `Person${index + 1}`, last_name: 'Lee', address: `p${index + 1}@example.com`,
    reason: index % 3 === 0 ? 'UNSUBSCRIBED' : 'FREQUENCY_CAP' }))
  const calls = installMockApi({ campaign: drip(steps), dripSteps: { c1: steps }, skippedPeople: many }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')
  await vi.waitFor(() => expect(card(1)).toBeTruthy())
  await user.click(within(card(1)).getByRole('button', { name: 'Skipped 236' }))
  const drawer = await screen.findByRole('dialog', { name: 'Skipped for Message 1' })
  await user.click(within(drawer).getByRole('button', { name: 'View People' }))

  const list = await within(drawer).findByRole('list', { name: 'People skipped for message 1' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(25)
  expect(within(list).getAllByRole('listitem')[0].textContent).toBe('Person1 LeeUnsubscribedp1@example.com')
  expect(within(drawer).getByText('30 people · page 1 of 2')).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/campaign-runs/r1/skipped/'))).toBe(true)
  await user.click(within(drawer).getByRole('button', { name: 'Next' }))
  expect(await within(drawer).findByText('30 people · page 2 of 2')).toBeTruthy()

  const reason = within(drawer).getByLabelText('Reason')
  expect([...reason.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['All Reasons', 'Unsubscribed (10)', 'Over Frequency Limit (20)'])
  await user.selectOptions(reason, 'UNSUBSCRIBED')
  expect(await within(drawer).findByText('10 people · page 1 of 1')).toBeTruthy()
  await user.type(within(drawer).getByLabelText('Search'), 'p4@')
  await vi.waitFor(() => expect(within(drawer).getByText('1 person · page 1 of 1')).toBeTruthy())
  expect(calls.some((call) => call.url.includes('reason=UNSUBSCRIBED') && call.url.includes('q=p4%40'))).toBe(true)

  await user.click(within(drawer).getByRole('button', { name: 'Back to Reasons' }))
  expect(within(drawer).getByRole('table', { name: 'Skipped for message 1' })).toBeTruthy()
})

test('paused: the banner says when and by whom, every waiting message is on hold, and Resume shows the plan before posting', async () => {
  const steps = running().map((step) => (step.id === 's2' ? { ...step, run: result({ id: 'r2', started_at: '2026-10-15T14:00:00Z' }) } : step))
  const calls = installMockApi({ campaign: drip(steps, { status: 'PAUSED', paused: { at: '2026-10-17T15:00:00Z', by_name: 'Maria Chen' }, drip_progress: { total: 4, sent: 2, failed: 0, cancelled: 0, next: { position: 3, name: 'First Reward', scheduled_at: '2026-10-19T14:00:00Z' } } }),
    dripSteps: { c1: steps },
    resumePlan: {
      missed: [{ position: 3, name: 'First Reward', was_due: '2026-10-19T14:00:00Z', will_send: '2026-10-22T14:00:00Z' }],
      moved: [{ position: 4, name: 'Reminder', was_due: '2026-10-26T23:00:00Z', will_send: '2026-10-23T14:00:00Z' }], unchanged: [] } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')

  expect((await screen.findByText(/^Paused Sat 17 Oct by Maria Chen\./)).textContent).toBe('Paused Sat 17 Oct by Maria Chen. Message 3 is due Mon 19 Oct. It waits until you resume.')
  await vi.waitFor(() => expect(card(3).getAttribute('data-step-state')).toBe('on-hold'))
  expect(card(3).textContent).toContain('Waiting. Sends when the drip is resumed.')
  expect(screen.queryByText(/^This campaign is paused\./)).toBeNull()
  expect(calls.some((call) => call.url.includes('/activity/'))).toBe(false)                           // who paused comes from campaign.paused

  await user.click(screen.getByRole('button', { name: 'Resume' }))
  const dialog = await screen.findByRole('dialog', { name: 'Resume the drip?' })
  expect(await within(dialog).findByText('Message 3 · First Reward · was due Mon 19 Oct · sends Thu 22 Oct, 09:00 CT')).toBeTruthy()
  expect(within(dialog).getByText('Message 4 · Reminder moves to Fri 23 Oct, 09:00 CT to keep a day between messages')).toBeTruthy()
  expect(within(dialog).getByText('Messages 3 and 4 will be 1 day apart.')).toBeTruthy()
  expect(within(dialog).queryByRole('button', { name: /Skip/ })).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'Resume' }))
  await vi.waitFor(() => expect(posts(calls, '/campaigns/c1/resume/')).toHaveLength(1))
})

test('resume with nothing missed says so', async () => {
  const steps = running()
  installMockApi({ campaign: drip(steps, { status: 'PAUSED' }), dripSteps: { c1: steps } })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')
  await user.click(await screen.findByRole('button', { name: 'Resume' }))
  const dialog = await screen.findByRole('dialog', { name: 'Resume the drip?' })
  expect(await within(dialog).findByText('The remaining messages send on their days.')).toBeTruthy()
})

test('Pause goes at once; Stop Remaining Messages asks first, worded for a running and a paused drip, then cancels', async () => {
  const steps = running()
  const calls = installMockApi({ campaign: drip(steps), dripSteps: { c1: steps } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')

  await user.click(await screen.findByRole('button', { name: 'More Actions' }))
  const stop = within(screen.getByRole('region', { name: 'More Actions' })).getByRole('button', { name: 'Stop Remaining Messages' })
  expect(stop.querySelector('.text-danger-text')).toBeTruthy()
  await user.click(stop)
  const dialog = await screen.findByRole('dialog', { name: 'Stop the remaining 2 messages?' })
  expect(dialog.textContent).toContain("Messages 3 and 4 will be cancelled and won't send. Messages already sent stay in reports. This can't be undone. To send again, clone the campaign.")
  expect(within(dialog).getByRole('button', { name: 'Keep Running' })).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Stop Remaining Messages' }))
  await vi.waitFor(() => expect(posts(calls, '/campaigns/c1/stop/')).toHaveLength(1))

  cleanup()
  const second = installMockApi({ campaign: drip(running()), dripSteps: { c1: running() } }) as Call[]
  await renderAppAt('/campaigns/c1')
  await user.click(await screen.findByRole('button', { name: 'Pause' }))
  await vi.waitFor(() => expect(posts(second, '/campaigns/c1/pause/')).toHaveLength(1))
  expect(screen.queryByRole('dialog')).toBeNull()

  cleanup()
  installMockApi({ campaign: drip(running(), { status: 'PAUSED' }), dripSteps: { c1: running() } })
  await renderAppAt('/campaigns/c1')
  await user.click(await screen.findByRole('button', { name: 'More Actions' }))
  await user.click(within(screen.getByRole('region', { name: 'More Actions' })).getByRole('button', { name: 'Stop Remaining Messages' }))
  expect(within(await screen.findByRole('dialog', { name: /^Stop the remaining/ })).getByRole('button', { name: 'Keep Paused' })).toBeTruthy()
})

test('stopped early: the grey banner, cancelled messages in the timeline, and Clone as the main action', async () => {
  const steps = running().map((step) => (step.position > 2 || ['s3', 's4'].includes(step.id) ? { ...step, run: { ...step.run!, status: 'CANCELLED', completed_at: '2026-10-17T15:00:00Z' } } : step.id === 's2' ? { ...step, run: result({ id: 'r2' }) } : step))
  installMockApi({ campaign: drip(steps, { status: 'COMPLETED', stopped_early: { at: '2026-10-17T15:00:00Z', by_name: 'Maria Chen', cancelled: 2 } }), dripSteps: { c1: steps } })
  await renderAppAt('/campaigns/c1')

  const banner = await found('[data-drip-banner="stopped"]')
  expect(banner.textContent).toBe('Stopped early. Stopped Sat 17 Oct by Maria Chen. 2 messages were cancelled.')
  await vi.waitFor(() => expect(card(3).getAttribute('data-step-state')).toBe('cancelled'))
  expect(card(3).textContent).toContain('Cancelled Sat 17 Oct. Not sent.')
  expect(card(3).className).toContain('border-dashed')
  expect(document.querySelector('[data-today-marker]')).toBeNull()
  const header = screen.getByRole('heading', { level: 1 }).closest('header')!
  expect(within(header).getAllByRole('button', { name: 'Clone' })).toHaveLength(1)
})

test('a failed message: the banner names it and offers Retry when nobody got it; Retry asks, then posts; a 409 shows the API’s reason', async () => {
  const steps = running().map((step) => (step.id === 's2' ? { ...step, run: unsent('r2', { status: 'FAILED', started_at: '2026-10-15T14:00:00Z' }) } : step))
  const calls = installMockApi({ campaign: drip(steps), dripSteps: { c1: steps },
    activity: [{ id: 'a1', event_type: 'RUN_FAILED', severity: 'ERROR', message: 'The email provider returned 503. 0 of 12,180 sent.', detail: null, actor_name: null, campaign_run_id: 'r2', occurred_at: '2026-10-15T14:04:00Z' }] }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')

  const banner = (await screen.findByText('Message 2 failed')).closest('[role="alert"]') as HTMLElement
  expect(await within(banner).findByText('The email provider returned 503. 0 of 12,180 sent.')).toBeTruthy()
  expect(within(banner).getByRole('button', { name: 'View Run' })).toBeTruthy()
  await vi.waitFor(() => expect(card(2).getAttribute('data-step-state')).toBe('failed'))
  await user.click(within(banner).getByRole('button', { name: 'Retry Message' }))
  const dialog = await screen.findByRole('dialog', { name: 'Retry message 2?' })
  expect(dialog.textContent).toContain("Send message 2 again now? It goes to the people on message 1's list who are still eligible.")
  await user.click(within(dialog).getByRole('button', { name: 'Retry Message' }))
  await vi.waitFor(() => expect(posts(calls, '/campaigns/c1/steps/s2/retry/')).toHaveLength(1))

  // part of it went out: no Retry, the reason instead
  cleanup()
  const partial = running().map((step) => (step.id === 's2' ? { ...step, run: unsent('r2', { status: 'FAILED', sent: 300 }) } : step))
  installMockApi({ campaign: drip(partial), dripSteps: { c1: partial } })
  await renderAppAt('/campaigns/c1')
  const second = (await screen.findByText('Message 2 failed')).closest('[role="alert"]') as HTMLElement
  expect(within(second).queryByRole('button', { name: 'Retry Message' })).toBeNull()
  expect(within(second).getByText("Part of message 2 went out, so it can't be retried.")).toBeTruthy()
})

test('Retry refused by the API (409) says why in the pop-up', async () => {
  const steps = running().map((step) => (step.id === 's2' ? { ...step, run: unsent('r2', { status: 'FAILED' }) } : step))
  const state = { c1: steps }
  installMockApi({ campaign: drip(steps), dripSteps: state })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')
  const banner = (await screen.findByText('Message 2 failed')).closest('[role="alert"]') as HTMLElement
  // someone else's send reached people meanwhile
  state.c1 = state.c1.map((step) => (step.id === 's2' ? { ...step, run: { ...step.run!, sent: 12 } } : step))
  await user.click(within(banner).getByRole('button', { name: 'Retry Message' }))
  const dialog = await screen.findByRole('dialog', { name: 'Retry message 2?' })
  await user.click(within(dialog).getByRole('button', { name: 'Retry Message' }))
  expect(await within(dialog).findByText("Part of message 2 went out, so it can't be retried.")).toBeTruthy()
})

test('before the start: the scheduled banner in drip words, Cancel Schedule worded for a drip', async () => {
  const steps = running().map((step) => ({ ...step, run: unsent(`r${step.position}`, { scheduled_at: '2026-10-12T14:00:00Z' }) }))
  installMockApi({ campaign: drip(steps, { status: 'PRODUCTION_PUBLISHED', runs: runsOf(steps).map((item) => ({ ...item, scheduled_at: later(5) })) as never,
    drip_progress: { total: 4, sent: 0, failed: 0, cancelled: 0, next: { position: 1, name: 'Welcome', scheduled_at: '2026-10-12T14:00:00Z' } } }), dripSteps: { c1: steps } })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')
  expect((await found('[data-drip-banner="scheduled"]')).textContent).toBe('Message 1 sends Mon 12 Oct at 09:00 CT. Until then you can cancel the schedule and edit the drip.')
  await vi.waitFor(() => expect(document.querySelector('[data-start-marker]')?.textContent).toBe('Starts · Mon 12 Oct 2026 · 90 contacts'))
  const header = screen.getByRole('heading', { level: 1 }).closest('header')!
  await user.click(within(header).getByRole('button', { name: 'Cancel Schedule' }))
  const dialog = await screen.findByRole('dialog', { name: "Cancel the drip's schedule?" })
  expect(dialog.textContent).toContain('Nothing has been sent. It goes back to a draft so you can edit it.')
})

test('Performance: Message Comparison, a row per message without conversions or revenue, rows open to the run, and the per-message chart', async () => {
  const steps = running()
  installMockApi({ campaign: drip(steps), dripSteps: { c1: steps } })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?tab=performance')

  const table = await screen.findByRole('table', { name: 'Message Comparison' })
  const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent)
  expect(headers).toEqual(expect.arrayContaining(['Message', 'Sent On', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Unsubscribed', 'Skipped']))
  expect(headers.some((text) => /Conversion|Revenue/.test(text ?? ''))).toBe(false)
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows[0].textContent).toContain('12,094')
  expect(rows[2].textContent).toContain('Not sent yet')
  await user.click(within(rows[0]).getByRole('button', { name: 'Results of message 1' }))
  expect(within(rows[0]).getByRole('button', { name: 'Results of message 1' }).getAttribute('aria-expanded')).toBe('true')
  expect(within(document.querySelector<HTMLElement>('[data-message-chart]')!).getByRole('table', { hidden: true })).toBeTruthy()
  // today's cards stay
  expect(screen.getByRole('heading', { name: 'Results' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Engagement over Time' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Runs' })).toBeTruthy()
})

test('an SMS drip: the timeline and the comparison speak of delivered, replies and opted out, never opens; the excerpt, without a preview request per card', async () => {
  const steps = running().map((step) => ({ ...step, template: tpl(`x${step.position}`, 'SMS'), subject_line: null, ab_config: null, text_excerpt: `Hi {{first_name}}, message ${step.id}. Reply STOP to opt out.`,
    run: step.run && { ...step.run, ab: null, replied: 31, opted_out: 9 } }))
  const calls = installMockApi({ campaign: drip(steps, { channel: 'SMS', sender_profile: 'snd-sms' }), dripSteps: { c1: steps } }) as Call[]
  await renderAppAt('/campaigns/c1')
  await vi.waitFor(() => expect(card(1).querySelector('[data-step-figures]')?.textContent).toBe('Sent12,094Delivered12,000Clicked6.2%Replies31Opted Out9'))
  expect(card(2).textContent).toContain("Hi {{first_name}}, message s2. Reply STOP to opt out.")
  expect(calls.filter((call) => /\/templates\/x\d\/(message|preview)/.test(call.url) || call.url.includes('/preview/'))).toHaveLength(0)

  cleanup()
  installMockApi({ campaign: drip(steps, { channel: 'SMS', sender_profile: 'snd-sms' }), dripSteps: { c1: steps } })
  await renderAppAt('/campaigns/c1?tab=performance')
  const table = await screen.findByRole('table', { name: 'Message Comparison' })
  const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent)
  expect(headers).not.toContain('Opened')
  expect(headers).toContain('Opted Out')
  expect(headers).toContain('Replies')
  expect(headers.indexOf('Replies')).toBeLessThan(headers.indexOf('Opted Out'))
})

test('stopped while a message was half sent: Not Sent is its own figure and column, never inside Failed', async () => {
  const steps = running().map((step) => (step.id === 's2' ? { ...step, run: result({ id: 'r2', status: 'COMPLETED', started_at: '2026-10-15T14:00:00Z', sent: 40, not_sent: 50 }) } : step))
  installMockApi({ campaign: drip(steps, { status: 'COMPLETED', stopped_early: { at: '2026-10-16T15:00:00Z', by_name: 'Maria Chen', cancelled: 2 } }), dripSteps: { c1: steps } })
  await renderAppAt('/campaigns/c1')
  await vi.waitFor(() => expect(card(2).querySelector('[data-step-figures]')?.textContent).toContain('Not Sent50'))
  expect(card(2).querySelector('[data-step-figures]')?.textContent).not.toMatch(/Failed/)
  expect(card(1).querySelector('[data-step-figures]')?.textContent).not.toContain('Not Sent')

  cleanup()
  installMockApi({ campaign: drip(steps, { status: 'COMPLETED' }), dripSteps: { c1: steps } })
  await renderAppAt('/campaigns/c1?tab=performance')
  const table = await screen.findByRole('table', { name: 'Message Comparison' })
  const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent)
  expect(headers).toContain('Not Sent')
  expect(headers).not.toContain('Failed')
})

test('a regular campaign’s paused banner says when and by whom, from campaign.paused', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'PAUSED', send_timezone: 'America/Chicago', paused: { at: '2026-10-17T15:00:00Z', by_name: 'Maria Chen' } }) })
  await renderAppAt('/campaigns/c1')
  expect((await screen.findByText(/This campaign is paused\./)).textContent)
    .toBe('Paused Sat 17 Oct by Maria Chen. This campaign is paused. Nothing more goes out, and sends that come due wait, until it is resumed.')
})

test('Content: the messages listed with their day, each previewed by its own step, the shared sender line and the lock note', async () => {
  const steps = running()
  const calls = installMockApi({ campaign: drip(steps), dripSteps: { c1: steps } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?tab=content')

  const nav = await screen.findByRole('navigation', { name: 'Messages' })
  expect(within(nav).getAllByRole('button').map((item) => item.textContent)).toEqual(['1. WelcomeDay 0 · Mon 12 Oct', '2. How Points WorkDay 3 · Thu 15 Oct', '3. First RewardDay 7 · Mon 19 Oct', '4. ReminderDay 14 · Mon 26 Oct'])
  expect(document.querySelector('[data-drip-shared]')?.textContent).toContain('Sender Northwind Rewards rewards@northwind.example')
  await user.click(within(nav).getByRole('button', { name: /How Points Work/ }))
  expect(await screen.findByRole('heading', { name: 'Message 2 · How Points Work' })).toBeTruthy()
  expect(screen.getByText('3 ways to earn points')).toBeTruthy()
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/campaigns/c1/preview/') && call.url.includes('step=s2'))).toBe(true))
  expect(screen.getByText('Messages are locked after publishing. To change one, stop the remaining messages and clone the campaign.')).toBeTruthy()
})

test('Recipients: the run picker names messages, and rows a stop left unsent read Not Sent by their code, never Failed', async () => {
  const steps = running()
  const stopped = { ...runRecipients[2], id: 9, address: 'kai@example.com', status: 'NOT_SENT', not_sent_reason: 'STOPPED_EARLY', status_reason: 'Not sent: the drip was stopped early.' }
  const lookalike = { ...runRecipients[2], id: 10, address: 'lee@example.com', status: 'FAILED', status_reason: 'Not sent: the drip was stopped early.' }   // the text alone means nothing
  const calls = installMockApi({ campaign: drip(steps), dripSteps: { c1: steps }, recipientRows: [runRecipients[0], runRecipients[2], stopped, lookalike] }) as Call[]
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?tab=recipients')

  const picker = await screen.findByLabelText('Run')
  await vi.waitFor(() => expect([...picker.querySelectorAll('option')].map((option) => option.textContent)).toContain('Message 1 · Welcome · Mon 12 Oct · Completed'))
  const table = await screen.findByRole('table', { name: /Recipients of run/ })
  const kai = within(table).getByText('kai@example.com').closest('tr')!
  expect(within(kai).getByText('Not Sent · Stopped early').className).not.toContain('danger')
  const maria = within(table).getByText('maria.chen@example.com').closest('tr')!
  expect(within(maria).getByText('Failed')).toBeTruthy()
  expect(within(within(table).getByText('lee@example.com').closest('tr')!).getByText('Failed')).toBeTruthy()

  const status = screen.getByLabelText('Status')
  expect([...status.querySelectorAll('option')].map((option) => option.textContent)).toContain('Not Sent (1)')
  await user.selectOptions(status, 'NOT_SENT')
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/recipients/') && call.url.includes('status=NOT_SENT'))).toBe(true))
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: /Recipients of run/ })).queryByText('maria.chen@example.com')).toBeNull())
  expect(screen.getByText('kai@example.com')).toBeTruthy()
})

test('Activity log: the drip’s own events get plain titles', async () => {
  const steps = running()
  installMockApi({ campaign: drip(steps), dripSteps: { c1: steps }, activity: [
    { id: 'a1', event_type: 'STOPPED_EARLY', severity: 'INFO', message: 'Stopped early by Maria Chen. 2 messages were cancelled.', detail: null, actor_name: 'Maria Chen', campaign_run_id: null, occurred_at: '2026-10-17T15:00:00Z' },
    { id: 'a2', event_type: 'MESSAGE_RETRIED', severity: 'INFO', message: 'Message 2 (How Points Work) will be sent again now.', detail: null, actor_name: 'Maria Chen', campaign_run_id: null, occurred_at: '2026-10-16T15:00:00Z' },
    { id: 'a3', event_type: 'RESUMED', severity: 'INFO', message: 'Resumed.', detail: null, actor_name: 'Maria Chen', campaign_run_id: null, occurred_at: '2026-10-15T15:00:00Z' },
    { id: 'a4', event_type: 'PAUSED', severity: 'INFO', message: 'Paused.', detail: null, actor_name: 'Maria Chen', campaign_run_id: null, occurred_at: '2026-10-14T15:00:00Z' },
  ] })
  await renderAppAt('/campaigns/c1?tab=activity')
  const log = await found('[data-activity-log]')
  for (const title of ['Stopped Early', 'Message Retried', 'Resumed', 'Paused']) expect(within(log).getByText(title)).toBeTruthy()
})

test('Clone in the header opens the Clone pop-up for a drip, with the count of messages', async () => {
  const steps = running()
  installMockApi({ campaign: drip(steps, { drip_summary: { count: 4, last_day: 14, first_send_at: null, last_send_at: null, ready: true } }), dripSteps: { c1: steps } })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')
  await user.click(await screen.findByRole('button', { name: 'Clone' }))
  const dialog = await screen.findByRole('dialog', { name: 'Clone Loyalty Welcome' })
  expect((within(dialog).getByLabelText('Campaign Name') as HTMLInputElement).value).toBe('Copy of Loyalty Welcome')
  expect(within(dialog).getByText(/^All 4 messages are copied/)).toBeTruthy()
})
