/** Settings → Governance (docs/mockups/governance.html, option A): the last 30 days, the platform's caps locked beside the
 * workspace's own, and adding, switching off and removing a cap of the workspace's own. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('the platform cap is locked, the workspace adds, switches off and removes its own, and the figures and fixed rules are shown', async () => {
  const calls = installMockApi({ me: { principal: { ...me.principal, kind: 'user' as const, permissions: [...me.principal.permissions, 'governance.edit'] } } as never })
  const user = userEvent.setup()
  await renderAppAt('/settings/governance')
  const table = await screen.findByRole('table', { name: 'Frequency Caps' })
  expect(screen.getByText('212,480')).toBeTruthy()
  expect(screen.getByText('98.2%')).toBeTruthy()

  const platformRow = within(table).getByText('3 emails per 7 days').closest('tr') as HTMLElement
  expect(within(platformRow).getByText('Platform')).toBeTruthy()
  expect(within(platformRow).getByText('Locked')).toBeTruthy()
  expect(within(platformRow).queryByRole('button', { name: 'Edit' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Add Cap' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Cap' })
  await user.selectOptions(within(dialog).getByLabelText(/^Channel/), 'ALL')
  await user.clear(within(dialog).getByLabelText(/^Most/))
  await user.type(within(dialog).getByLabelText(/^Most/), '5')
  await user.click(within(dialog).getByRole('button', { name: 'Add Cap' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/workspace/governance/caps/'))?.body).toEqual({ channel: 'ALL', max_messages: 5, period_days: 7 })
  expect(await within(table).findByText('5 messages per 7 days')).toBeTruthy()

  const ownRow = within(table).getByText('4 texts per 30 days').closest('tr') as HTMLElement
  await user.click(within(ownRow).getByRole('switch', { name: '4 texts per 30 days in use' }))
  await vi.waitFor(() => expect(calls.find((call) => call.method === 'PATCH' && call.url.endsWith('/caps/cap-own/'))?.body).toEqual({ is_active: false }))
  await user.click(within(ownRow).getByRole('button', { name: 'Remove' }))
  await vi.waitFor(() => expect(within(table).queryByText('4 texts per 30 days')).toBeNull())

  expect(screen.getByText(/quiet hours/).textContent).toContain('21:00–08:00')
  expect(within(screen.getByRole('heading', { name: 'List Hygiene' }).closest('section') as HTMLElement).getByRole('link', { name: 'Suppressions' }).getAttribute('href')).toBe('/settings/suppressions')
})

test('without governance.edit the page is read-only: no Add Cap, no Edit, no Remove', async () => {
  installMockApi()
  await renderAppAt('/settings/governance')
  const table = await screen.findByRole('table', { name: 'Frequency Caps' })
  expect(screen.queryByRole('button', { name: 'Add Cap' })).toBeNull()
  expect(within(table).queryByRole('button', { name: 'Edit' })).toBeNull()
  expect(within(table).queryByRole('switch')).toBeNull()
})
