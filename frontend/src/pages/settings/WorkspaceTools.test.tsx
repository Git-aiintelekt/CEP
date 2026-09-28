import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const writes = (calls: { url: string; method: string; body: unknown }[], part: string, method = 'PUT') => calls.filter((call) => call.method === method && call.url.includes(part))

// ---------------------------------------------------------------------------------------------------- Suppressions

test('suppressions: the three new tabs are in Settings; counts per reason, and every held-back contact with why and since when', async () => {
  installMockApi()
  await renderAppAt('/settings/suppressions')

  const tabs = await screen.findByRole('navigation', { name: 'Settings sections' })
  for (const name of ['Suppressions', 'Notifications', 'Approvals']) expect(within(tabs).getByRole('link', { name })).toBeTruthy()
  expect(await screen.findByText('4 addresses and numbers held back · 1 added this week')).toBeTruthy()
  const table = await screen.findByRole('table', { name: 'Suppressed addresses and numbers' })
  expect(within(table).getByText('d.alvarez@northwind.example')).toBeTruthy()
  expect(within(table).getByText('5.1.1 user unknown')).toBeTruthy()
  // a bounce or a block can be undone; an opt-out or a complaint cannot
  expect(within(table).getByRole('button', { name: 'Unblock d.alvarez@northwind.example' })).toBeTruthy()
  expect(within(table).queryByRole('button', { name: 'Unblock +14045550002' })).toBeNull()
  expect(within(table).queryByRole('button', { name: 'Unblock j.lee@fabrikam.example' })).toBeNull()
})

test('suppressions: a reason tile, the channel and the search filter the list through the API', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/suppressions')
  const table = await screen.findByRole('table', { name: 'Suppressed addresses and numbers' })

  await user.click(screen.getByRole('button', { name: /Bounced/ }))
  await vi.waitFor(() => expect(within(table).queryByText('j.lee@fabrikam.example')).toBeNull())
  expect(calls.filter((call) => call.url.includes('/suppressions/?')).at(-1)?.url).toContain('reason=BOUNCED')
  await user.click(screen.getByRole('button', { name: /Bounced/ }))                                        // again: every reason

  await user.click(screen.getByRole('radio', { name: 'Phone' }))
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Suppressed addresses and numbers' })).queryByText('d.alvarez@northwind.example')).toBeNull())
  await user.click(screen.getByRole('radio', { name: 'All' }))
  await user.type(screen.getByRole('searchbox', { name: 'Search suppressions' }), 'competitor')
  await vi.waitFor(() => expect(calls.filter((call) => call.url.includes('/suppressions/?')).at(-1)?.url).toContain('search=competitor'))
  expect(await screen.findByText('promo@competitor.example')).toBeTruthy()
})

test('suppressions: Unblock asks first, then the contact leaves the list', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/suppressions')
  await user.click(await screen.findByRole('button', { name: 'Unblock d.alvarez@northwind.example' }))
  const dialog = await screen.findByRole('dialog', { name: 'Unblock this contact?' })
  expect(within(dialog).getByText(/hard bounce \(5\.1\.1 user unknown\)/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Unblock' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(writes(calls, '/suppressions/CONTACT_POINT/cp-1/unblock/', 'POST')).toHaveLength(1)
  await vi.waitFor(() => expect(screen.queryByText('d.alvarez@northwind.example')).toBeNull())
})

test('suppressions: an import blocks what is new, and says what was already blocked and what was not an address', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/suppressions')
  await user.click(await screen.findByRole('button', { name: 'Import Suppressions' }))
  const dialog = await screen.findByRole('dialog', { name: 'Import Suppressions' })
  await user.type(within(dialog).getByLabelText(/Addresses and Numbers/), 'new@example.com\npromo@competitor.example\nnot-an-address')
  await user.type(within(dialog).getByLabelText('Note'), 'legal hold')
  await user.click(within(dialog).getByRole('button', { name: 'Block Them' }))
  expect(await within(dialog).findByText(/blocked, /)).toBeTruthy()
  expect(within(dialog).getByText('not-an-address')).toBeTruthy()
  expect(writes(calls, '/suppressions/block/', 'POST')[0].body).toEqual({ values: ['new@example.com', 'promo@competitor.example', 'not-an-address'], note: 'legal hold' })
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))
  expect(await screen.findByText('new@example.com')).toBeTruthy()
})

test('suppressions: without consent.edit the list is read only', async () => {
  installMockApi({ me: { principal: { ...me.principal, kind: 'user' as const, permissions: me.principal.permissions.filter((code) => code !== 'consent.edit') } } })
  await renderAppAt('/settings/suppressions')
  await screen.findByRole('table', { name: 'Suppressed addresses and numbers' })
  expect(screen.queryByRole('button', { name: /^Unblock/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Import Suppressions' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
})

// ---------------------------------------------------------------------------------------------------- Notifications

test('notifications: the event × channel matrix, recipients and webhook are saved together; the test waits for the save', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/notifications')

  const matrix = await screen.findByRole('table', { name: 'Which channels each event is sent to' })
  expect((within(matrix).getByRole('checkbox', { name: 'Send failed: Recipients by Email' }) as HTMLInputElement).checked).toBe(true)
  await user.click(within(matrix).getByRole('checkbox', { name: 'Weekly report: Webhook' }))
  await user.type(screen.getByLabelText(/Email Addresses/), 'ops@example.com, ops@example.com')
  await user.type(screen.getByLabelText('Webhook URL'), 'hooks.slack.com/services/T0')
  const test = screen.getByRole('button', { name: 'Send a Test Message' }) as HTMLButtonElement
  expect(test.disabled).toBe(true)
  expect(screen.getByText('Save first: the test uses the saved settings.')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('The webhook must be an http:// or https:// address.')).toBeTruthy()
  await user.clear(screen.getByLabelText('Webhook URL'))
  await user.type(screen.getByLabelText('Webhook URL'), 'https://hooks.slack.com/services/T0')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Saved')).toBeTruthy()
  const saved = writes(calls, '/workspace/notifications/').at(-1)?.body as { emails: string[]; webhook_url: string; events: Record<string, { webhook: boolean }> }
  expect(saved.emails).toEqual(['ops@example.com'])
  expect(saved.webhook_url).toBe('https://hooks.slack.com/services/T0')
  expect(saved.events.weekly_report.webhook).toBe(true)

  await user.click(screen.getByRole('button', { name: 'Send a Test Message' }))
  expect(await screen.findByText('Test email sent to 1 of 1 recipient. The webhook accepted the test message.')).toBeTruthy()
  expect(await screen.findByText('Working')).toBeTruthy()
})

// ---------------------------------------------------------------------------------------------------- Approvals

test('approvals: switching the requirement on, who can approve, and a link to what waits', async () => {
  const calls = installMockApi({ workspaceTools: { approvals: { require_approval: true, permission: 'campaign.approve', awaiting: 2, approvers: [{ id: 'u3', name: 'Maria Chen', email: 'maria@example.com' }] } } })
  const user = userEvent.setup()
  await renderAppAt('/settings/approvals')

  const approvers = await screen.findByRole('list', { name: 'Approvers' })
  expect(within(approvers).getByText('Maria Chen')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open Them' }).getAttribute('href')).toBe('/campaigns?saved=approval')
  const toggle = screen.getByRole('switch', { name: 'Require Approval Before a Production Publish' })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  await user.click(toggle)
  await vi.waitFor(() => expect(writes(calls, '/workspace/approvals/').at(-1)?.body).toEqual({ require_approval: false }))
})

test('approvals: with nobody able to approve, it cannot be switched on and says what to do', async () => {
  installMockApi({ workspaceTools: { approvals: { require_approval: false, permission: 'campaign.approve', awaiting: 0, approvers: [] } } })
  await renderAppAt('/settings/approvals')
  expect(await screen.findByText('Nobody can approve yet. Give a role the campaign.approve permission under Roles first.')).toBeTruthy()
  expect((screen.getByRole('switch', { name: 'Require Approval Before a Production Publish' }) as HTMLButtonElement).disabled).toBe(true)
})
