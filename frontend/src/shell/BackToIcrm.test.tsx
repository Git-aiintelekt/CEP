/** Back to iCRM, beside the workspace in the top bar: shown only to a session opened from iCRM, disabled until the iCRM
 * URL is set; it opens the address the API answers (the iCRM page with a token for the person) in a new tab. */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, signIn } from '@/test/mockApi'

async function renderAppAt(path: string, options: Parameters<typeof installMockApi>[0] = {}) {
  const calls = installMockApi(options)
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  const navigation = (await import('@/lib/visit')).navigation
  const go = vi.spyOn(navigation, 'go').mockImplementation(() => undefined)
  return { calls, go }
}

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear() })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('a workspace without sign-on from iCRM has no Back to iCRM', async () => {
  await renderAppAt('/')
  await screen.findByRole('button', { name: /^Account:/ })
  expect(screen.queryByRole('button', { name: 'Back to C360' })).toBeNull()
})

test('a session not opened from iCRM has no Back to iCRM', async () => {
  await renderAppAt('/', { me: { icrm: { from_icrm: false, address_set: true } } as never })
  await screen.findByRole('button', { name: /^Account:/ })
  expect(screen.queryByRole('button', { name: 'Back to C360' })).toBeNull()
})

test('from iCRM but with no iCRM URL, Back to iCRM stays disabled and names the setting', async () => {
  await renderAppAt('/', { me: { icrm: { from_icrm: true, address_set: false } } as never })
  const back = await screen.findByRole('button', { name: 'Back to C360' })
  expect(back.hasAttribute('disabled')).toBe(true)
  expect(back.getAttribute('title')).toContain('iCRM URL')
})

function stubNewTab() {
  const tab = { opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() }
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  return { tab, open }
}

test('from iCRM, Back to iCRM opens the iCRM page with a token in a new tab, and CEP stays', async () => {
  const user = userEvent.setup()
  const { calls, go } = await renderAppAt('/', { me: { icrm: { from_icrm: true, address_set: true } } as never })
  const { tab, open } = stubNewTab()
  const back = await screen.findByRole('button', { name: 'Back to C360' })
  expect(back.hasAttribute('disabled')).toBe(false)
  await user.click(back)
  expect(open).toHaveBeenCalledWith('', '_blank')
  await vi.waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://icrm.example.com/customer-portal/control/findCustomer?token=sample-token'))
  expect(tab.opener).toBeNull()
  expect(go).not.toHaveBeenCalled()
  expect(calls.some((call) => call.url.endsWith('/auth/sso/ofbiz/back/') && call.method === 'POST')).toBe(true)
  await vi.waitFor(() => expect(back.hasAttribute('disabled')).toBe(false))
})

test('when a popup blocker stops the new tab, Back to iCRM goes there in this tab', async () => {
  const user = userEvent.setup()
  const { go } = await renderAppAt('/', { me: { icrm: { from_icrm: true, address_set: true } } as never })
  vi.spyOn(window, 'open').mockReturnValue(null)
  await user.click(await screen.findByRole('button', { name: 'Back to C360' }))
  await vi.waitFor(() => expect(go).toHaveBeenCalledWith('https://icrm.example.com/customer-portal/control/findCustomer?token=sample-token'))
})

test('when the API refuses, Back to iCRM closes the new tab and says so', async () => {
  const user = userEvent.setup()
  const { go } = await renderAppAt('/', { me: { icrm: { from_icrm: true, address_set: true } } as never, icrmBackFails: true })
  const { tab } = stubNewTab()
  await user.click(await screen.findByRole('button', { name: 'Back to C360' }))
  expect(await screen.findByText('iCRM was not opened')).toBeTruthy()
  expect(tab.close).toHaveBeenCalled()
  expect(tab.location.replace).not.toHaveBeenCalled()
  expect(go).not.toHaveBeenCalled()
})
