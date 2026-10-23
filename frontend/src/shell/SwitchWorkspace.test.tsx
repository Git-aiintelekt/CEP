/** Switch Workspace (docs/mockups/switch-workspace.html, option B): the account menu offers it to platform administrators only; the
 * dialog lists and searches the workspaces and asks a reason; the visit's tokens are kept under the visited workspace; inside a
 * visit the amber line says so and Back to Platform ends it; Settings → Security lists the workspace's Platform Visits. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const platformAdmin = { ...me.principal, display_name: 'Platform Admin', email: 'platform@aiintelekt.com', is_platform_admin: true }

async function renderAppAt(path: string, meOverride: object = {}) {
  const calls = installMockApi({ me: meOverride as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  const navigation = (await import('@/lib/visit')).navigation
  const go = vi.spyOn(navigation, 'go').mockImplementation(() => undefined)
  return { calls, go }
}

async function openAccountMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Account: ${name}` }))
  return screen.findByRole('region', { name: 'Account' })
}

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear() })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('the account menu offers Switch Workspace to platform administrators only', async () => {
  await renderAppAt('/')
  const user = userEvent.setup()
  expect(within(await openAccountMenu(user, 'Aby John')).queryByRole('button', { name: /Switch Workspace/ })).toBeNull()
  cleanup()
  await renderAppAt('/', { principal: platformAdmin })
  expect(within(await openAccountMenu(user, 'Platform Admin')).getByRole('button', { name: /Switch Workspace/ })).toBeTruthy()
})

test('the dialog lists and searches the workspaces, wants a reason, and moves the tab into the chosen one with the visit’s tokens', async () => {
  const { calls, go } = await renderAppAt('/', { principal: platformAdmin })
  const user = userEvent.setup()
  await user.click(within(await openAccountMenu(user, 'Platform Admin')).getByRole('button', { name: /Switch Workspace/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Switch Workspace' })
  const table = await within(dialog).findByRole('table', { name: 'Workspaces' })
  expect(within(table).getAllByRole('radio')).toHaveLength(3)
  expect(within(table).getByText('Suspended')).toBeTruthy()
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search workspaces' }), 'city')
  await vi.waitFor(() => expect(within(within(dialog).getByRole('table', { name: 'Workspaces' })).getAllByRole('radio')).toHaveLength(1))
  await user.clear(within(dialog).getByRole('searchbox', { name: 'Search workspaces' }))
  await vi.waitFor(() => expect(within(within(dialog).getByRole('table', { name: 'Workspaces' })).getAllByRole('radio')).toHaveLength(3))

  await user.click(within(dialog).getByRole('button', { name: 'Switch' }))
  expect(within(dialog).getByRole('alert').textContent).toBe('Choose a workspace.')
  await user.click(within(dialog).getByRole('radio', { name: /DEMO/ }))
  await user.type(within(dialog).getByLabelText(/Reason/), 'hi')
  await user.click(within(dialog).getByRole('button', { name: 'Switch to DEMO' }))
  expect(await within(dialog).findByText(/Say in a few words why you are going in/)).toBeTruthy()
  expect(calls.some((call) => call.url.endsWith('/platform/visits/'))).toBe(false)              // refused before it is sent

  await user.clear(within(dialog).getByLabelText(/Reason/))
  await user.type(within(dialog).getByLabelText(/Reason/), 'Checking the demo before the call')
  await user.click(within(dialog).getByRole('button', { name: 'Switch to DEMO' }))
  await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/'))
  expect(calls.find((call) => call.url.endsWith('/platform/visits/'))?.body).toEqual({ workspace: 'DEMO', reason: 'Checking the demo before the call' })
  expect(window.localStorage.getItem('cep.access.DEMO')).toBe('visit-access')
  expect(window.localStorage.getItem('cep.refresh.DEMO')).toBe('visit-refresh')
  expect(window.sessionStorage.getItem('cep.tenant')).toBe('DEMO')
  expect(window.localStorage.getItem('cep.access.NWA')).toBe('access-1')                        // the home session stays for Back to Platform
})

test('inside a visit: the amber line on every page, no Switch Workspace, and Back to Platform ends the visit and goes home', async () => {
  const { calls, go } = await renderAppAt('/', {
    principal: platformAdmin, workspace: { name: 'Demo', plan: { code: 'INSIGHTS', name: 'Insights' } },
    platform_visit: { home: 'PLATFORM', home_name: 'Platform', started_at: '2026-10-23T14:02:00Z', reason: 'Checking the demo before the call' },
  })
  const user = userEvent.setup()
  const banner = await screen.findByText(/You are in Demo as a platform administrator, with full rights/)
  expect(within(await openAccountMenu(user, 'Platform Admin')).queryByRole('button', { name: /Switch Workspace/ })).toBeNull()
  await user.keyboard('{Escape}')
  await user.click(within(banner.parentElement as HTMLElement).getByRole('button', { name: 'Back to Platform' }))
  await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/'))
  expect(calls.some((call) => call.url.endsWith('/auth/visit/end/') && call.method === 'POST')).toBe(true)
  expect(window.localStorage.getItem('cep.access.NWA')).toBeNull()                              // the visit's tokens are forgotten
  expect(window.sessionStorage.getItem('cep.tenant')).toBe('PLATFORM')
})

test('Settings → Security lists the workspace’s Platform Visits with their reasons', async () => {
  await renderAppAt('/settings/security')
  const section = (await screen.findByRole('heading', { name: 'Platform Visits' })).closest('section') as HTMLElement
  const table = await within(section).findByRole('table', { name: 'Platform Visits' })
  expect(within(table).getByText('Platform Admin')).toBeTruthy()
  expect(within(table).getByText('Checking the demo before the customer call')).toBeTruthy()
})
