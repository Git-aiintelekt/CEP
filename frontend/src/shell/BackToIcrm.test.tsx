/** Back to iCRM, beside the workspace in the top bar: shown only to a session opened from iCRM, disabled until the iCRM
 * URL is set; it goes to the address the API answers (the iCRM page with the person's externalLoginKey). */
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
  expect(screen.queryByRole('button', { name: 'Back to iCRM' })).toBeNull()
})

test('a session not opened from iCRM has no Back to iCRM', async () => {
  await renderAppAt('/', { me: { icrm: { from_icrm: false, address_set: true } } as never })
  await screen.findByRole('button', { name: /^Account:/ })
  expect(screen.queryByRole('button', { name: 'Back to iCRM' })).toBeNull()
})

test('from iCRM but with no iCRM URL, Back to iCRM stays disabled and names the setting', async () => {
  await renderAppAt('/', { me: { icrm: { from_icrm: true, address_set: false } } as never })
  const back = await screen.findByRole('button', { name: 'Back to iCRM' })
  expect(back.hasAttribute('disabled')).toBe(true)
  expect(back.getAttribute('title')).toContain('iCRM URL')
})

test('from iCRM, Back to iCRM goes to the iCRM page with the externalLoginKey', async () => {
  const user = userEvent.setup()
  const { calls, go } = await renderAppAt('/', { me: { icrm: { from_icrm: true, address_set: true } } as never })
  const back = await screen.findByRole('button', { name: 'Back to iCRM' })
  expect(back.hasAttribute('disabled')).toBe(false)
  await user.click(back)
  await vi.waitFor(() => expect(go).toHaveBeenCalledWith('https://icrm.example.com/customer-portal/control/findCustomer?externalLoginKey=EL945c1f50'))
  expect(calls.some((call) => call.url.endsWith('/auth/sso/ofbiz/back/') && call.method === 'POST')).toBe(true)
})

test('when the API refuses, Back to iCRM says so and stays on the page', async () => {
  const user = userEvent.setup()
  const { go } = await renderAppAt('/', { me: { icrm: { from_icrm: true, address_set: true } } as never, icrmBackFails: true })
  await user.click(await screen.findByRole('button', { name: 'Back to iCRM' }))
  expect(await screen.findByText('iCRM was not opened')).toBeTruthy()
  expect(go).not.toHaveBeenCalled()
})
