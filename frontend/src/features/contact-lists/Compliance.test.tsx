import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { contactLists, installMockApi, me, signIn } from '@/test/mockApi'

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

const awaiting = contactLists.map((item) => (item.id === 'cl-master' ? { ...item, approval_status: 'AWAITING' as const } : item))

test('a list awaiting approval: the card says so, Approve records the note and lifts it; the compliance record shows the declaration, the policy and today’s consent', async () => {
  const calls = installMockApi({ lists: awaiting })
  const user = userEvent.setup()
  await renderAppAt('/contact-lists/cl-master')

  const approval = await screen.findByRole('region', { name: 'Approval' })
  expect(within(approval).getByText('Awaiting Approval')).toBeTruthy()
  expect(approval.textContent).toContain('none will send to it until someone with Consent · Edit approves it')
  await user.type(within(approval).getByLabelText(/^Note/), 'Form checked')
  await user.click(within(approval).getByRole('button', { name: 'Approve List' }))
  await vi.waitFor(() => expect(calls.find((call) => call.url.endsWith('/contact-lists/cl-master/approve/'))?.body).toEqual({ note: 'Form checked' }))
  await vi.waitFor(() => expect(within(screen.getByRole('region', { name: 'Approval' })).getByText('Approved')).toBeTruthy())
  expect(screen.getByRole('region', { name: 'Approval' }).textContent).toContain('Approved by Aby John')
  expect(screen.getByRole('region', { name: 'Approval' }).textContent).toContain('“Form checked”')
  expect(within(screen.getByRole('region', { name: 'Approval' })).queryByRole('button', { name: 'Approve List' })).toBeNull()

  const record = await screen.findByRole('region', { name: 'Compliance Record' })
  expect(record.textContent).toContain('Upload leads.csv')
  expect(record.textContent).toContain('Signed up on our website or app')
  expect(record.textContent).toContain('Fall sign-up form')
  expect(record.textContent).toContain('Attested by')
  expect(record.textContent).toContain('Maya Patel')
  expect(record.textContent).toContain('Hold back without consent · Approval before first send · Lifetime 2 years')
  const line = (key: string) => record.querySelector(`[data-consent-line="${key}"]`)!.textContent
  expect([line('opted_in_from_file'), line('confirmed_since'), line('no_consent'), line('unsubscribed')]).toEqual(['Opted in (from the file)3', 'Confirmed since0', 'No consent on record1', 'Unsubscribed0'])
  await user.click(within(record).getByRole('button', { name: 'Show Details' }))
  expect(record.textContent).toContain('I confirm these people agreed to receive marketing from Northwind Apparel')
  expect(record.textContent).toContain('leads.csv')
  expect(record.textContent).toContain('6 rows, 4 added, 3 consents recorded')
})

test('a list that needs no approval has no approval card; a reader without consent.edit sees the awaiting card without the buttons', async () => {
  installMockApi()
  await renderAppAt('/contact-lists/cl-master')
  await screen.findByRole('region', { name: 'Compliance Record' })
  expect(screen.queryByRole('region', { name: 'Approval' })).toBeNull()
  cleanup()

  installMockApi({ lists: awaiting, me: { principal: { ...me.principal, kind: 'user' as const, permissions: ['list.view', 'list.edit', 'campaign.view'] } } })
  await renderAppAt('/contact-lists/cl-master')
  const approval = await screen.findByRole('region', { name: 'Approval' })
  expect(within(approval).getByText('Awaiting Approval')).toBeTruthy()
  expect(within(approval).queryByRole('button', { name: 'Approve List' })).toBeNull()
})
