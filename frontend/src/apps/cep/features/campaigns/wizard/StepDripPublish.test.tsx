/**
 * A drip's Test & Publish step through the real app against the in-memory API: the per-message preview, testing every
 * message, the test rows, the review timeline, the backend's checklist and the publish.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { Campaign, DripStep } from '@/lib/types'
import { cepReady, installMockApi, makeCampaign, makeStep, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

type Call = { method: string; url: string; body: unknown }
const PATH = '/campaigns/c1/edit?step=publish'
const tpl = (id: string) => ({ id, name: `Loyalty Welcome · ${id}`, channel: 'EMAIL' as const, status: 'DRAFT' })
const sent = { status: 'SENT' as const, sent_at: '2026-10-07T14:30:00Z', error: null, run_id: 'r1' }
const drip = (overrides: Partial<Campaign> = {}) => makeCampaign({
  name: 'Loyalty Welcome', status: 'DRAFT', campaign_type: 'DRIP', send_type: 'DRIP', setup_step: 5, scheduled_at: '2026-10-12T14:00:00Z', send_timezone: 'America/Chicago',
  drip_config: { steps: [] }, template: 't1', sender_profile: 'snd-email', ...overrides,
})
const three = (tests: Partial<Record<string, DripStep['test']>> = {}): DripStep[] => [
  makeStep({ id: 's1', day: 0, name: 'Welcome', template: tpl('t1'), subject_line: 'Welcome to Rewards', ...(tests.s1 ? { test: tests.s1 } : {}),
    ab_config: { enabled: true, subject_b: 'Your card is ready', sample_pct: 20, metric: 'OPEN_RATE', decide_after_minutes: 240 } }),
  makeStep({ id: 's2', day: 3, name: 'How Points Work', template: tpl('t2'), subject_line: '3 ways to earn points', ...(tests.s2 ? { test: tests.s2 } : {}) }),
  makeStep({ id: 's3', day: 4, name: 'First Reward', template: tpl('t3'), subject_line: 'Your first reward', ...(tests.s3 ? { test: tests.s3 } : {}) }),
]
const allSent = () => three({ s1: sent, s2: sent, s3: sent })
const posts = (calls: Call[], part: string) => calls.filter((call) => call.method === 'POST' && call.url.includes(part))
const row = (position: number) => document.querySelector<HTMLElement>(`[data-test-row="${position}"]`)!
const column = () => vi.waitFor(() => {
  const found = document.querySelector<HTMLElement>('[data-publish-column]')
  expect(found).toBeTruthy()
  return found!
})
const checks = () => [...document.querySelectorAll('[data-check]')].map((item) => item.textContent)

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the page, and the preview: a tab per message, each previewed by its own step; the A/B message previews either subject', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: three() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt(PATH)

  expect(await screen.findByRole('heading', { name: 'Test & Publish' })).toBeTruthy()
  const tabs = await screen.findByRole('tablist', { name: 'Messages' })
  expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['1 · Welcome', '2 · How Points Work', '3 · First Reward'])
  const meta = () => document.querySelector('[data-preview-meta]')?.textContent
  expect(meta()).toBe('Day 0 · Mon 12 Oct, 09:00 CT · Subject: Welcome to Rewards')
  await user.click(screen.getByRole('radio', { name: 'Subject B' }))
  expect(meta()).toContain('Subject: Your card is ready')

  await user.click(within(tabs).getByRole('tab', { name: '2 · How Points Work' }))
  expect(meta()).toBe('Day 3 · Thu 15 Oct, 09:00 CT · Subject: 3 ways to earn points')
  expect(screen.queryByRole('radio', { name: 'Subject B' })).toBeNull()
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/campaigns/c1/preview/') && call.url.includes('step=s2'))).toBe(true))
})

test('Send All: every message to the testers, the rows sent, the toast, the checklist and the status move on, and the setup counts as complete', async () => {
  const calls = installMockApi({ campaign: drip(), dripSteps: { c1: three() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt(PATH)

  expect(await screen.findByText(/All 3 messages go out now, one after another, without waiting for their days\. Each subject starts with its place in the series\. The A\/B message sends both subjects\./)).toBeTruthy()
  expect(row(2).textContent).toContain('Message 2 of 3 · How Points Work')
  expect(row(2).textContent).toContain('[Test 2 of 3 · would send Day 3] 3 ways to earn points')
  expect(row(2).textContent).toContain('Not sent')
  expect(screen.getAllByText('Draft').length).toBeGreaterThan(0)
  await vi.waitFor(() => expect(checks()[2]).toBe('Every message tested: to doSend the test to all 3 messages.'))

  const to = screen.getByLabelText('Other Addresses')
  await user.clear(to)
  await user.type(to, 'qa@example.com')
  await user.click(screen.getByRole('button', { name: 'Send All 3 as a Test' }))
  await vi.waitFor(() => expect(posts(calls, '/campaigns/c1/test-publish/').at(-1)?.body).toEqual({ to: ['qa@example.com'], user_ids: [] }))
  expect(await screen.findByText('Tests of all 3 messages sent.')).toBeTruthy()
  await vi.waitFor(() => expect(row(1).getAttribute('data-status')).toBe('SENT'))
  expect(row(1).textContent).toContain('Sent 09:42 CT')
  await vi.waitFor(() => expect(checks()[2]).toBe('Every message tested: done'))
  await vi.waitFor(() => expect(screen.getAllByText('Test Published').length).toBeGreaterThan(0))
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/campaigns/c1/')).at(-1)?.body).toMatchObject({ setup_step: 6 }))
})

test('the rows: changed, failed with the reason, not sent, and sending (polled); Resend sends that message alone', async () => {
  const calls = installMockApi({ campaign: drip({ status: 'TEST_PUBLISHED' }), dripSteps: { c1: three({
    s1: { status: 'CHANGED', sent_at: '2026-10-06T14:00:00Z', error: null, run_id: 'r1' },
    s2: { status: 'FAILED', sent_at: null, error: 'qa@example.com: 550 mailbox unavailable', run_id: 'r2' },
  }) } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt(PATH)

  await vi.waitFor(() => expect(row(1).getAttribute('data-status')).toBe('CHANGED'))
  expect(row(1).textContent).toContain('Changed since the test · Resend')
  expect(row(2).textContent).toContain('Test failed. qa@example.com: 550 mailbox unavailable')
  expect(row(3).textContent).toContain('Not sent')
  await vi.waitFor(() => expect(checks()[2]).toBe("Every message tested: to doMessage 1 changed after its test. Resend it.Message 2's test failed. Resend it.Message 3 hasn't been tested. Send its test."))

  await user.click(within(row(2)).getByRole('button', { name: 'Resend' }))
  await vi.waitFor(() => expect(posts(calls, '/steps/s2/test/').at(-1)?.body).toMatchObject({ to: ['aby.john@aiintelekt.com'] }))
  expect(posts(calls, '/test-publish/')).toHaveLength(0)
  await vi.waitFor(() => expect(row(2).getAttribute('data-status')).toBe('SENT'))
  expect(await screen.findByText('Test of message 2 sent.')).toBeTruthy()
})

test('a message the API still reports as sending is polled until it settles', async () => {
  const steps = { c1: three({ s1: { status: 'SENDING', sent_at: null, error: null, run_id: 'r1' }, s2: sent, s3: sent }) }
  const calls = installMockApi({ campaign: drip(), dripSteps: steps }) as Call[]
  await renderAppAt(PATH)
  await vi.waitFor(() => expect(row(1).textContent).toContain('Sending'))
  const reads = () => calls.filter((call) => call.method === 'GET' && call.url.endsWith('/campaigns/c1/steps/')).length
  const before = reads()
  steps.c1 = steps.c1.map((step) => (step.id === 's1' ? { ...step, test: sent } : step))
  await vi.waitFor(() => expect(row(1).getAttribute('data-status')).toBe('SENT'), { timeout: 4000 })
  expect(reads()).toBeGreaterThan(before)
})

test('the review timeline: a row per message, warnings one per line in the API’s words, Edit back to the message, and the summary', async () => {
  installMockApi({ campaign: drip(), dripSteps: { c1: three() }, dripWarnings: { s3: [{ code: 'FREQUENCY', message: 'This drip sends 3 emails within 7 days; the limit is 2, so this message will skip people.' }] } })
  await renderAppAt(PATH)

  const table = await screen.findByRole('table', { name: 'Review Timeline' })
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(3)
  expect(rows[0].textContent).toContain('1. WelcomeA/B')
  expect(rows[0].textContent).toContain('Day 0 · Mon 12 Oct09:00 CT')
  expect(rows[0].textContent).toContain('No issues')
  expect([...rows[2].querySelectorAll('[data-warning]')].map((item) => item.textContent)).toEqual(['Only 1 day after message 2.', 'This drip sends 3 emails within 7 days; the limit is 2, so this message will skip people.'])
  expect(within(rows[1]).getByRole('link', { name: 'Edit message 2, How Points Work' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=sequence&message=s2')
  expect(document.querySelector('[data-review-summary]')?.textContent).toBe('3 messages to about 88 people. First Mon 12 Oct, 09:00 CT. Last Fri 16 Oct, 09:00 CT.')
})

test('the checklist in the backend’s order and words; Publish waits for it; a past start date links to the Sequence step', async () => {
  installMockApi({ campaign: drip({ scheduled_at: '2026-10-05T14:00:00Z' }), dripSteps: { c1: three() } })
  await renderAppAt(PATH)

  await vi.waitFor(() => expect(checks()).toHaveLength(6))
  expect(checks().map((text) => text?.split(':')[0])).toEqual(['All 3 messages ready', "Every message's template is sendable", 'Every message tested', 'Start date in the future', 'Campaign List attached', 'Verified sender chosen'])
  const start = document.querySelector<HTMLElement>('[data-check="start_date"]')!
  expect(start.textContent).toContain('The start date, Mon 5 Oct, has passed. Choose a new one.')
  expect(within(start).getByRole('link', { name: 'Change Start Date' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=sequence')
  expect(document.querySelector('[data-checklist-count]')?.textContent).toBe('4 of 6 done')
  const publish = within(await column()).getByRole('button', { name: 'Publish to Production' })
  expect((publish as HTMLButtonElement).disabled).toBe(true)
  expect(within(await column()).getByText('Finish the items marked above first.')).toBeTruthy()
})

test('publish: the confirmation, then the campaign page with the toast', async () => {
  const calls = installMockApi({ campaign: drip({ status: 'TEST_PUBLISHED' }), dripSteps: { c1: allSent() } }) as Call[]
  const user = userEvent.setup()
  await renderAppAt(PATH)

  const side = await column()
  await vi.waitFor(() => expect((within(side).getByRole('button', { name: 'Publish to Production' }) as HTMLButtonElement).disabled).toBe(false))
  await user.click(within(side).getByRole('button', { name: 'Publish to Production' }))
  const confirm = await screen.findByRole('dialog', { name: 'Publish to production?' })
  expect(confirm.textContent).toContain('Loyalty Welcome sends 3 messages to about 88 people.')
  expect(confirm.textContent).toContain('First: Mon 12 Oct 2026, 09:00 CT. Last: Fri 16 Oct 2026, 09:00 CT.')
  expect(within(confirm).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['1. WelcomeDay 0 · Mon 12 Oct', '2. How Points WorkDay 3 · Thu 15 Oct', '3. First RewardDay 4 · Fri 16 Oct'])
  expect(confirm.textContent).toContain('After publishing, the audience and messages can no longer be changed.')
  expect(calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/campaigns/c1/')).at(-1)?.body).toMatchObject({ setup_step: 6 })
  await user.click(within(confirm).getByRole('button', { name: 'Publish' }))
  await vi.waitFor(() => expect(window.location.pathname).toBe('/campaigns/c1'))
  expect(posts(calls, '/campaigns/c1/publish/')).toHaveLength(1)
  expect(await screen.findByText('Scheduled. Message 1 sends Mon 12 Oct at 09:00 CT.')).toBeTruthy()
})

test('publish refused: a 400 names the message, a 409 says why; Try Again opens the confirmation again', async () => {
  const campaign = drip({ status: 'TEST_PUBLISHED', approval_required: true, approval: { status: 'APPROVED', requested_by: 'u2', requested_by_name: 'Devon Okafor', requested_at: '2026-10-06T09:00:00Z', note: null, decided_by_name: 'Maria Chen', decided_at: '2026-10-06T10:00:00Z', decision_note: null } as never })
  const steps = { c1: allSent() }
  installMockApi({ campaign, dripSteps: steps })
  const user = userEvent.setup()
  await renderAppAt(PATH)
  const side = await column()
  await vi.waitFor(() => expect((within(side).getByRole('button', { name: 'Publish to Production' }) as HTMLButtonElement).disabled).toBe(false))

  // meanwhile message 2 is edited elsewhere: the publish's own check names it
  steps.c1 = steps.c1.map((step) => (step.id === 's2' ? { ...step, test: { ...sent, status: 'CHANGED' } } : step))
  await user.click(within(side).getByRole('button', { name: 'Publish to Production' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Publish to production?' })).getByRole('button', { name: 'Publish' }))
  const refusal = await within(side).findByText('The campaign was not published.')
  expect(refusal.parentElement?.textContent).toContain('Message 2 changed after its test. Resend it.')

  // and the approver sends it back meanwhile: the publish says so with a 409
  steps.c1 = allSent()
  await fetch('/api/v1/campaigns/c1/send-back/', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access-1', 'X-Tenant': 'NWA' }, body: JSON.stringify({ note: 'Shorter subject, please.' }) })
  await user.click(within(side).getByRole('button', { name: 'Try Again' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Publish to production?' })).getByRole('button', { name: 'Publish' }))
  expect(await within(side).findByText('This campaign needs approval before a production publish.')).toBeTruthy()
  expect(window.location.pathname).toBe('/campaigns/c1/edit')
})

test('approval required shows today’s Approval card; without campaign.publish there is a note instead of the button', async () => {
  const viewer = { principal: { ...me.principal, permissions: me.principal.permissions.filter((code) => code !== 'campaign.publish') } }
  installMockApi({ campaign: drip({ status: 'TEST_PUBLISHED', approval_required: true, approval: null }), dripSteps: { c1: allSent() }, me: viewer as never })
  await renderAppAt(PATH)
  const side = await column()
  expect(await within(side).findByRole('heading', { name: 'Approval' })).toBeTruthy()
  expect(within(side).queryByRole('button', { name: 'Publish to Production' })).toBeNull()
  expect(within(side).getByText(/Publishing needs the campaign.publish permission/)).toBeTruthy()
  await vi.waitFor(() => expect(checks().at(-1)).toContain('Approved for production'))
})

test('a regular campaign keeps today’s Review & Publish', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 5 }) })
  await renderAppAt(PATH)
  expect(await screen.findByRole('heading', { name: 'When and How It Goes Out' })).toBeTruthy()
  expect(screen.queryByRole('tablist', { name: 'Messages' })).toBeNull()
  expect(document.querySelector('[data-drip-publish]')).toBeNull()
})
