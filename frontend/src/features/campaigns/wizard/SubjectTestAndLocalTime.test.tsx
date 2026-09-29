/**
 * The A/B subject line test (Test step, test sends, the review summary, the result on the campaign's runs) and sending at
 * each recipient's local time (the count on Review & Publish). Through the real app against the in-memory API.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, signIn } from '@/test/mockApi'
import { waitingVariants } from '@/test/mockCampaigns'

import { testSummary, waitText } from '../subjectTest'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const TEST_STEP = '/campaigns/c1/edit?step=test'
const card = async () => within((await screen.findByRole('heading', { name: 'Subject Line Test' })).closest('section') as HTMLElement)
const patches = (calls: { url: string; method: string; body: unknown }[]) => calls.filter((call) => call.method === 'PATCH' && /\/campaigns\/c1\/$/.test(call.url))
const AB = { enabled: true, subject_b: 'A reward just landed for you', sample_pct: 20, metric: 'OPEN_RATE' as const, decide_after_minutes: 240 }

test('the wording: waits, and the one-line summary', () => {
  expect([waitText(30), waitText(60), waitText(240), waitText(1440), waitText(4320)]).toEqual(['30 minutes', '1 hour', '4 hours', '1 day', '3 days'])
  expect(testSummary(null)).toBe('One subject line, from the template')
  expect(testSummary({ enabled: true, subject_b: '  ' })).toBe('One subject line, from the template')
  expect(testSummary(AB)).toBe('A/B test, 20% sample, winner by open rate after 4 hours')
})

test('the Test step: a second subject, the sample, the metric and the wait are saved on the campaign', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 3 }) })
  const user = userEvent.setup()
  await renderAppAt(TEST_STEP)

  const box = await card()
  expect(box.queryByLabelText(/^B/)).toBeNull()                                                              // off by default
  await user.click(box.getByRole('switch', { name: 'Test a Second Subject Line' }))
  expect(await box.findByDisplayValue('Fall is here, Jordan')).toBeTruthy()                                  // A: the template's, with sample values
  expect((box.getByRole('button', { name: 'Save Subject Test' }) as HTMLButtonElement).disabled).toBe(true) // no B yet
  await user.type(box.getByLabelText(/^B/), 'A reward just landed for you')
  await user.selectOptions(box.getByLabelText('Sample'), '30')
  await user.selectOptions(box.getByLabelText('Winner Decided By'), 'Click Rate')
  await user.selectOptions(box.getByLabelText('Decide After'), '1 hour')
  expect(box.getByText(/The winner is chosen by click rate 1 hour after the sample sends, then it goes to the other 70%/)).toBeTruthy()
  expect(await box.findByText('About 26 people. The rest wait for the winner.')).toBeTruthy()                // 30% of 88
  await user.click(box.getByRole('button', { name: 'Save Subject Test' }))
  await vi.waitFor(() => expect(patches(calls).at(-1)?.body).toMatchObject({ ab_config: { enabled: true, subject_b: 'A reward just landed for you', sample_pct: 30, metric: 'CLICK_RATE', decide_after_minutes: 60 } }))
  expect(await (await card()).findByText('Saved')).toBeTruthy()
})

test('a test send with the subject test on goes out with both subjects, and says so', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 3, ab_config: AB }) })
  const user = userEvent.setup()
  await renderAppAt(TEST_STEP)
  const send = within(await screen.findByRole('group', { name: 'Send a Test' }))
  expect(send.getByText(/each address gets both, marked \[TEST A\] and \[TEST B\]/)).toBeTruthy()
  await user.click(send.getByRole('button', { name: 'Send Test' }))
  const results = await screen.findByRole('list', { name: 'Test results' })
  expect(within(results).getAllByRole('listitem').map((item) => item.textContent?.trim())).toEqual(['Sent to aby.john@aiintelekt.com (subject A)', 'Sent to aby.john@aiintelekt.com (subject B)'])
})

test('a text or an e-receipt has no subject line test', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 3, channel: 'SMS', template: 'tpl-sms' }) })
  await renderAppAt(TEST_STEP)
  await screen.findByRole('group', { name: 'Send a Test' })
  expect(screen.queryByRole('heading', { name: 'Subject Line Test' })).toBeNull()
})

test('Review & Publish: the summary names the test and the local time, and ticking local time counts who has a known zone', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6, ab_config: AB, runs: [{ id: 'rt', test_mode: true, status: 'COMPLETED', run_number: 1 }] as never }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=publish&section=review')

  expect(await screen.findByText('A/B test, 20% sample, winner by open rate after 4 hours')).toBeTruthy()
  expect(screen.getByText('One time for everyone')).toBeTruthy()
  await user.click(await screen.findByRole('checkbox', { name: /Each Recipient's Local Time/ }))
  expect(await screen.findByText(/70 of 88 people have a known time zone\. The other 18 get it at the chosen time in/)).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/campaigns/c1/audience/?local_time=1'))).toBe(true)          // counted before the setting is saved
})

test('the campaign page: a run with a subject line test shows A and B, and a person can send one to the rest', async () => {
  const calls = installMockApi({
    runVariants: waitingVariants,
    campaign: makeCampaign({ status: 'ACTIVE', setup_step: 6, ab_config: AB, published_at: '2026-09-29T10:00:00Z',
      runs: [{ id: 'r1', campaign: 'c1', run_number: 1, run_type: 'ONE_TIME', status: 'SENDING', test_mode: false, started_at: '2026-09-29T10:00:00Z', scheduled_at: null, completed_at: null, sequence_label: null }] as never }),
  })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?tab=performance')

  const table = await screen.findByRole('table', { name: 'Subject line A and B with their results' })
  expect(within(table).getByText('A reward just landed for you')).toBeTruthy()
  expect(within(table).getByText('66.7%')).toBeTruthy()
  const section = table.closest('section') as HTMLElement
  expect(within(section).getByText('Deciding')).toBeTruthy()
  expect(within(section).getByText(/24 people wait for the winner, chosen by open rate/)).toBeTruthy()

  await user.click(within(section).getByRole('button', { name: 'Send B to the Rest' }))
  const dialog = await screen.findByRole('dialog', { name: 'Send B to the rest now?' })
  await user.click(within(dialog).getByRole('button', { name: 'Send B' }))
  await vi.waitFor(() => expect(calls.find((call) => call.method === 'POST' && call.url.includes('/runs/r1/choose-winner/'))?.body).toEqual({ variant: 'B' }))
  expect(await screen.findByText('Winner Chosen')).toBeTruthy()
})
