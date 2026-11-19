/** Delivery Warm-Up: starting one sized to the workspace plan, a running one (approve the offered day, change a day's template),
 * and the warm-up's campaigns marked in Campaigns. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { SAMPLE_WARM_UP } from '@/apps/cep/features/warmup/sampleWarmUp'
import { cepReady, installMockApi, makeCampaign, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('starting: the plan is sized to the workspace plan, and Start sends the choices', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery-warmup')

  expect(await screen.findByText('Sized to your workspace plan: Growth, 25,000 contacts')).toBeTruthy()
  expect(await screen.findByText(/same hourly limit, only inside a sending window.*15 days, 260 a day to 25,012/)).toBeTruthy()
  const start = screen.getByRole('button', { name: 'Start Warm-Up' }) as HTMLButtonElement
  expect(start.disabled).toBe(true)

  await user.click(screen.getByRole('checkbox', { name: 'Fall Master Audience' }))
  await user.selectOptions(screen.getByRole('combobox', { name: /Template for Every Day/ }), 'tpl-email')
  await user.click(screen.getByRole('radio', { name: 'Approve Each Step' }))
  await user.click(start)

  const posted = calls.filter((call) => call.url.endsWith('/warmup/') && call.method === 'POST').at(-1)?.body
  expect(posted).toMatchObject({ ip_mode: 'DEDICATED', plan_kind: 'DAILY', window_start: '08:00', window_end: '21:00', advance_mode: 'APPROVE', list_ids: ['cl-master'], template_id: 'tpl-email', sender_profile: 'snd-email' })
  expect(await screen.findByRole('heading', { name: 'Day by Day' })).toBeTruthy()
})

test('running: the offered day is approved, and a later day gets another template', async () => {
  const calls = installMockApi({ warmup: SAMPLE_WARM_UP })
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery-warmup')

  expect(await screen.findByText('Ready for day 10: 5,369 a day')).toBeTruthy()
  const today = document.querySelector('tr[data-day="9"]') as HTMLElement
  expect(today.getAttribute('data-state')).toBe('TODAY')
  expect(within(today).getByRole('link', { name: 'Day 9 · Weekend Offer Preview' })).toBeTruthy()
  expect(within(document.querySelector('tr[data-day="3"]') as HTMLElement).queryByRole('button', { name: 'Change' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Approve Day 10' }))
  expect(calls.some((call) => call.url.endsWith('/warmup/actions/') && (call.body as { action?: string })?.action === 'approve')).toBe(true)

  await user.click(within(document.querySelector('tr[data-day="12"]') as HTMLElement).getByRole('button', { name: 'Change' }))
  const dialog = await screen.findByRole('dialog', { name: 'Change Day 12' })
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Template' }), 'tpl-email')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Apply To' }), '15')
  await user.click(within(dialog).getByRole('button', { name: 'Save Days 12 to 15' }))
  const changed = calls.filter((call) => call.url.endsWith('/warmup/days/')).at(-1)?.body
  expect(changed).toMatchObject({ from_day: 12, to_day: 15, template_id: 'tpl-email', list_ids: ['l1', 'l2'] })
  expect(await within(document.querySelector('tr[data-day="13"]') as HTMLElement).findByText('Fall Email')).toBeTruthy()
})

test('Campaigns: a warm-up campaign carries the Warm-Up marker and says what triggered it', async () => {
  installMockApi({ campaigns: [makeCampaign({ id: 'wc9', name: 'Day 9 · Weekend Offer Preview', campaign_type: 'WARM_UP', triggered_by: 'WARM_UP', status: 'ACTIVE', display_status: 'ACTIVE' })] })
  await renderAppAt('/campaigns')
  const row = (await screen.findByText('Day 9 · Weekend Offer Preview')).closest('tr') as HTMLElement
  expect(row.querySelector('[data-category="warmup"]')?.textContent).toBe('Warm-Up')
  expect(within(row).getByText('Delivery Warm-Up')).toBeTruthy()
})
