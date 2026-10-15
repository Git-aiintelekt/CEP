/** The Activity log tab: the filter, severity markers and tags, day groups in the campaign's zone, and its states. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { CampaignActivity } from '@/lib/types'
import { cepReady, installMockApi, makeCampaign, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

const now = Date.now()
const hoursAgo = (hours: number) => new Date(now - hours * 3600_000).toISOString()
const entry = (overrides: Partial<CampaignActivity>): CampaignActivity => ({ id: 'a', event_type: 'EDITED', severity: 'INFO', message: 'Changed.', detail: null, actor_name: 'Aby John', campaign_run_id: null, occurred_at: hoursAgo(1), ...overrides })
const log: CampaignActivity[] = [
  entry({ id: 'a1', event_type: 'RUN_FAILED', severity: 'ERROR', message: 'Run #2 stopped: the email provider refused the connection.', actor_name: null, occurred_at: hoursAgo(0.1) }),
  entry({ id: 'a2', event_type: 'GOVERNANCE_OFF', severity: 'WARNING', message: 'Corporate frequency limits are switched off.', occurred_at: hoursAgo(24) }),
  entry({ id: 'a3', event_type: 'CREATED', message: 'Created as a draft.', occurred_at: '2026-09-01T15:00:00Z' }),
]

async function openLog(options: Parameters<typeof installMockApi>[0] = {}, campaign = makeCampaign({ status: 'DRAFT', send_timezone: 'America/Chicago' })) {
  const calls = installMockApi({ campaign, activity: log, ...options })
  await renderAppAt('/campaigns/c1?tab=activity')
  return { calls, card: await screen.findByRole('region', { name: 'Activity Log' }) }
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('one card: the intro as its description, the Show filter in its header', async () => {
  const { card } = await openLog()
  expect(within(card).getByText('Who did what, and what the send engine did, newest first. Entries are never changed or removed.')).toBeTruthy()
  const show = within(card).getByRole('radiogroup', { name: 'Show' })
  expect(within(show).getAllByRole('radio').map((option) => option.textContent)).toEqual(['Everything', 'Warnings', 'Errors'])
  expect(within(show).getByRole('radio', { name: 'Everything' }).getAttribute('aria-checked')).toBe('true')
})

test('day groups newest first, in the campaign zone: Today, Yesterday, then the date', async () => {
  const { card } = await openLog()
  await within(card).findAllByRole('listitem')
  expect(within(card).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Today', 'Yesterday', expect.stringMatching(/2026/)])
  expect(within(card).getAllByRole('heading', { level: 3 })[0].className).toContain('text-helper')
  const items = within(card).getAllByRole('listitem')
  expect(items.map((item) => item.getAttribute('data-severity'))).toEqual(['ERROR', 'WARNING', 'INFO'])
  expect(within(items[0]).getByText(/^System · .+, \d{1,2}:\d{2}.* C[SD]T$/)).toBeTruthy()
  expect(within(items[1]).getByText(/^Aby John · .+ C[SD]T$/)).toBeTruthy()
})

test('severity: a grey dot for info, a warning triangle and tag, an error circle and tag', async () => {
  const { card } = await openLog()
  const [error, warning, info] = await within(card).findAllByRole('listitem')
  expect(error.querySelector('[data-marker="error"]')!.getAttribute('class')).toContain('text-danger')
  expect(within(error).getByText('Error').className).toContain('text-danger-text')
  expect(within(error).getByText('Run Failed').className).toContain('font-semibold')
  expect(warning.querySelector('[data-marker="warning"]')!.getAttribute('class')).toContain('text-warning')
  expect(within(warning).getByText('Warning').className).toContain('text-warning-text')
  expect(info.querySelector('[data-marker="info"]')!.className).toContain('bg-ink-300')
  expect(within(info).queryByText('Info')).toBeNull()
})

test('the filter: warnings only, errors only, and "Nothing of that kind"', async () => {
  const user = userEvent.setup()
  const { card } = await openLog()
  await within(card).findAllByRole('listitem')
  await user.click(within(card).getByRole('radio', { name: 'Warnings' }))
  expect(within(card).getAllByRole('listitem').map((item) => item.getAttribute('data-severity'))).toEqual(['WARNING'])
  await user.click(within(card).getByRole('radio', { name: 'Errors' }))
  expect(within(card).getAllByRole('listitem').map((item) => item.getAttribute('data-severity'))).toEqual(['ERROR'])

  cleanup()
  const quiet = await openLog({ activity: [log[2]] })
  await within(quiet.card).findAllByRole('listitem')
  await user.click(within(quiet.card).getByRole('radio', { name: 'Errors' }))
  expect(within(quiet.card).getByText('Nothing of that kind')).toBeTruthy()
})

test('empty, loading and error states inside the card', { timeout: 15_000 }, async () => {
  const user = userEvent.setup()
  const empty = await openLog({ activity: [] })
  expect(await within(empty.card).findByText('Nothing recorded yet')).toBeTruthy()

  cleanup()
  const failed = await openLog({ activityFails: true })
  const alert = await within(failed.card).findByRole('alert', undefined, { timeout: 6000 })             // after the client's two retries of a 5xx
  expect(alert.textContent).toMatch(/^Couldn’t load the activity log\./)
  const before = failed.calls.filter((call) => call.url.includes('/activity/')).length
  await user.click(within(alert).getByRole('button', { name: 'Retry' }))
  await vi.waitFor(() => expect(failed.calls.filter((call) => call.url.includes('/activity/')).length).toBeGreaterThan(before))
})

test('while a run is sending, the log refreshes every 10 seconds', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const sending = makeCampaign({ status: 'ACTIVE', runs: [{ id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'SENDING', test_mode: false, scheduled_at: null,
    started_at: hoursAgo(0.1), completed_at: null, created_at: hoursAgo(0.1), updated_at: hoursAgo(0.1), row_version: 1 }] as never })
  const { calls, card } = await openLog({}, sending)
  await within(card).findAllByRole('listitem')
  const count = () => calls.filter((call) => call.url.includes('/activity/')).length
  const first = count()
  await vi.advanceTimersByTimeAsync(10_500)
  await vi.waitFor(() => expect(count()).toBeGreaterThan(first))
})
