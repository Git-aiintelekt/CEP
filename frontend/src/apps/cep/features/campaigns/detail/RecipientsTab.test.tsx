import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, runRecipients, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

const run = { id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null,
              started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z', created_at: '2026-09-18T09:59:00Z', updated_at: '2026-09-18T10:02:00Z', row_version: 1 }
const completed = () => makeCampaign({ status: 'COMPLETED', completed_at: '2026-09-18T10:02:00Z', runs: [run] as never })

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('Recipients: every recipient of the run with status, reason and times; filter by status, search, open one for its timeline and ask the engine', async () => {
  const calls = installMockApi({ campaigns: [completed()] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?tab=recipients')

  await user.click(await screen.findByRole('tab', { name: 'Recipients' }))
  expect(await screen.findByText('brianna.garcia@example.com')).toBeTruthy()
  const bounced = screen.getByText('devon.okafor@example.com').closest('tr') as HTMLElement
  expect(within(bounced).getByText('Bounced')).toBeTruthy()
  expect(within(bounced).getByText('550 5.1.1 The email account does not exist')).toBeTruthy()
  const failed = screen.getByText('maria.chen@example.com').closest('tr') as HTMLElement
  expect(within(failed).getByText('Failed')).toBeTruthy()
  expect(screen.getByText(/4 recipients/)).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Status' }))
  await user.click(await screen.findByRole('option', { name: /^Bounced/ }))
  expect(await screen.findByText(/1 recipient ·/)).toBeTruthy()
  expect(screen.queryByText('brianna.garcia@example.com')).toBeNull()
  const listCall = calls.filter((call) => call.url.includes('/recipients/') && call.url.includes('status=BOUNCED')).at(-1)
  expect(listCall).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /^Status: Bounced/ }))
  await user.click(await screen.findByRole('option', { name: 'All Statuses' }))

  await user.type(screen.getByPlaceholderText('Address, name or customer ID'), 'sam')
  await waitFor(() => expect(screen.queryByText('brianna.garcia@example.com')).toBeNull())      // the search settles after a pause
  expect(screen.getByText('sam.lee@example.com')).toBeTruthy()
  await user.clear(screen.getByPlaceholderText('Address, name or customer ID'))

  await user.click(await screen.findByRole('button', { name: /brianna.garcia@example.com/ }))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('Handed to the engine')).toBeTruthy()
  expect(within(dialog).getByText(/Engine said: MessageDelivered/)).toBeTruthy()
  expect(within(dialog).getByText(/2 callbacks from the engine/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Check with the Engine' }))
  expect(await within(dialog).findByText('Postal (self-hosted) Says')).toBeTruthy()
  expect(within(dialog).getByText(/accepted by mx.example.com/)).toBeTruthy()
  expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/recipients/1/check/')).length).toBe(1)
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))

  await user.click(screen.getByRole('button', { name: 'Export CSV' }))
  expect(calls.filter((call) => call.url.includes('/recipients/export.csv')).length).toBe(1)
})

test('Blocked & Unsubscribed: the campaign\'s held-back people with reason, source and since; a reason chip filters; CSV', async () => {
  const calls = installMockApi({ campaigns: [completed()] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?tab=recipients')

  await user.click(await screen.findByRole('tab', { name: 'Recipients' }))
  await user.click(await screen.findByRole('radio', { name: 'Blocked & Unsubscribed' }))
  expect(await screen.findByText(/People on this campaign's lists who cannot be sent to/)).toBeTruthy()
  const chips = screen.getByRole('list', { name: 'By reason' })
  expect(within(chips).getByRole('button', { name: /Bounced/ })).toBeTruthy()
  const table = await screen.findByRole('table', { name: 'Blocked and unsubscribed' })
  expect(within(table).getAllByRole('row').length).toBeGreaterThan(1)
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Contact', 'Channel', 'Reason', 'Source', 'Since'])

  await user.click(within(chips).getByRole('button', { name: /Bounced/ }))
  const filtered = calls.filter((call) => call.url.includes('/suppressions/') && call.url.includes('reason=BOUNCED')).at(-1)
  expect(filtered).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Export CSV' }))
  expect(calls.filter((call) => call.url.includes('/suppressions/export.csv')).length).toBe(1)
})

test('Resend Interrupted: the notice says how many and when, Show Them filters to them, and the dialog says what may happen before anything is sent again', async () => {
  const interrupted = { ...runRecipients[2], id: 9, address: 'lena.ortiz@example.com', status: 'INTERRUPTED', status_reason: 'Interrupted before the provider confirmed the message' }
  const calls = installMockApi({
    campaigns: [completed()], recipientRows: [...runRecipients, interrupted],
    interrupted: { engine: 'Postal', interrupted: 3, delivered_since: 1, held_back: 0, to_send: 2, first_at: '2026-09-18T10:01:00Z', last_at: '2026-09-18T10:01:00Z' },
  })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?tab=recipients')
  await user.click(await screen.findByRole('tab', { name: 'Recipients' }))

  const notice = (await screen.findByText(/3 messages were interrupted/)).closest('[role="status"]') as HTMLElement
  expect(notice.textContent).toMatch(/before Postal confirmed them.*Some may have reached the inbox\. They were not sent again\./)
  const row = screen.getByText('lena.ortiz@example.com').closest('tr') as HTMLElement
  expect(within(row).getByText('Interrupted')).toBeTruthy()

  await user.click(within(notice).getByRole('button', { name: 'Show Them' }))
  await waitFor(() => expect(calls.some((call) => call.url.includes('/recipients/') && call.url.includes('status=INTERRUPTED'))).toBe(true))

  await user.click(within(notice).getByRole('button', { name: 'Resend 3' }))
  const dialog = await screen.findByRole('dialog', { name: /Resend 3 Interrupted Messages\?/ })
  expect(within(dialog).getByText(/those people will get the email twice/)).toBeTruthy()
  expect(within(dialog).getByText('Reported delivered by Postal since').nextElementSibling?.textContent).toBe('1 · left out')
  expect(within(dialog).getByText('To be sent again').nextElementSibling?.textContent).toBe('2')
  expect(calls.some((call) => call.method === 'POST' && call.url.includes('/interrupted/'))).toBe(false)

  await user.click(within(dialog).getByRole('button', { name: 'Resend 2' }))
  const post = calls.find((call) => call.method === 'POST' && call.url.includes('/campaign-runs/r1/interrupted/'))
  expect(post?.body).toEqual({ at_window: false })
  expect(await screen.findByText(/2 interrupted messages were sent again on .* by Aby John\./)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Resend/ })).toBeNull()
})
