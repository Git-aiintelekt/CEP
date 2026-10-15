/** Save feedback (docs/mockups/save-feedback.html): every save says that it worked or why it did not, in C360's words. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, problem, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

/** Answers the matching request with `answer` (a response, or a rejection as the browser gives when nothing answers); the mock API answers the rest. */
function failWhen(match: (url: string, method: string) => boolean, answer: () => Promise<Response>) {
  const mocked = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return match(url, (init.method ?? 'GET').toUpperCase()) ? answer() : mocked(input, init)
  })
}

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('a Settings dialog that closes on save says so in a toast: New Tag → "Tag saved"', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/tags')
  await screen.findByRole('table', { name: 'Personalization tags' }, { timeout: 5000 })
  await user.click(screen.getByRole('button', { name: 'Add Tag' }))
  const dialog = await screen.findByRole('dialog', { name: 'New Tag' })
  await user.type(within(dialog).getByLabelText(/^Tag Key/), 'store_total')
  await user.type(within(dialog).getByLabelText(/^Label/), 'Store total')
  await user.selectOptions(within(dialog).getByLabelText(/^Reads From/), 'TRANSACTION')
  await user.selectOptions(within(dialog).getByLabelText(/^Data Point/), 'grand_total')
  await user.click(within(dialog).getByRole('button', { name: 'Add Tag' }))

  const toast = (await screen.findByText('Tag saved')).closest('[role="status"]') as HTMLElement
  expect(toast.textContent).toContain('Templates can use {{store_total}}.')
  expect(screen.queryByRole('dialog', { name: 'New Tag' })).toBeNull()
}, 40_000)                                                                                            // the app's cold import and the typing

test('an instant setting confirms beside its own control: Click Window shows "Saved", the other windows do not', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/attribution')
  const rules = await screen.findByRole('region', { name: 'Attribution Rules' }, { timeout: 5000 })
  const rowOf = (name: string) => within(rules).getByRole('combobox', { name }).closest('.grid') as HTMLElement
  expect(within(rowOf('Click Window')).queryByText('Saved')).toBeNull()                              // room kept, nothing shown yet

  await user.selectOptions(within(rules).getByRole('combobox', { name: 'Click Window' }), '14')
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ click_days: 14 }))
  await vi.waitFor(() => expect(within(rowOf('Click Window')).getByText('Saved').className).not.toContain('invisible'))
  expect(within(rowOf('Open Window')).queryByText('Saved')).toBeNull()
  expect(screen.queryByText('Click Window saved')).toBeNull()                                          // option A: no toast for an instant setting
})

test('C360\'s own problem (500) names what failed, the time and the reference, never the server\'s words', async () => {
  installMockApi({ onSettingsWrite: (call) => (call.url.endsWith('/users/') ? problem(500, { title: 'Internal Server Error', reference: 'ER-42' }) : null) })
  const user = userEvent.setup()
  await renderAppAt('/settings/users')
  await user.click(await screen.findByRole('button', { name: 'Add User' }, { timeout: 5000 }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a User' })
  await user.type(within(dialog).getByLabelText(/^Email/), 'new.person@example.com')
  await user.type(within(dialog).getByLabelText(/^Name/), 'New Person')
  await user.click(within(dialog).getByRole('button', { name: 'Add User' }))

  const banner = await within(dialog).findByRole('alert')
  expect(within(banner).getByText('The user was not saved')).toBeTruthy()
  expect(banner.textContent).toMatch(/C360 had a problem at \d{1,2}:\d{2} [AP]M\. Your entries are still here; try again\. If it happens again, give your administrator the reference ER-42\./)
  expect(document.body.textContent).not.toContain('Internal Server Error')
  expect((within(dialog).getByLabelText(/^Email/) as HTMLInputElement).value).toBe('new.person@example.com')
})

test('no answer at all reads "C360 could not be reached", not the browser\'s "Failed to fetch"', async () => {
  installMockApi()
  failWhen((url, method) => method === 'PUT' && url.endsWith('/attribution/settings/'), () => Promise.reject(new TypeError('Failed to fetch')))
  const user = userEvent.setup()
  await renderAppAt('/settings/attribution')
  const email = await screen.findByLabelText(/^Email, per 1,000 Delivered/, undefined, { timeout: 5000 })
  await user.type(email, '0.85')
  await user.click(screen.getByRole('button', { name: 'Save Costs' }))

  const banner = await screen.findByText('C360 could not be reached')
  expect(banner.closest('[role="alert"]')?.textContent).toContain('The costs were not saved. Your changes are still here; check your connection and try again.')
  expect(document.body.textContent).not.toContain('Failed to fetch')
})

test('a failure that used to pass in silence now speaks: Rotate Address', async () => {
  installMockApi()
  failWhen((url, method) => method === 'POST' && url.endsWith('/rotate-webhook/'), async () => problem(500, { title: 'Internal Server Error' }))
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')
  const engines = await screen.findByRole('table', { name: 'Sending Engines' }, { timeout: 5000 })
  await user.click(within(engines).getAllByRole('button', { name: 'Rotate Address' })[0])

  const alert = (await screen.findByText('The callback address was not rotated')).closest('[role="alert"]') as HTMLElement
  expect(alert.textContent).toMatch(/C360 had a problem at \d{1,2}:\d{2} [AP]M\..*If it happens again, tell your administrator\./)
  expect(screen.queryByText(/the callback address was rotated/)).toBeNull()
})

test('turning off two-step sign-in: a failure that is not about the code says why instead of nothing', async () => {
  installMockApi({ mfaEnabled: true })
  failWhen((url, method) => method === 'POST' && url.endsWith('/auth/mfa/'), async () => problem(500, { title: 'Internal Server Error', reference: 'ER-7' }))
  const user = userEvent.setup()
  await renderAppAt('/account/security')
  await user.click(await screen.findByRole('button', { name: 'Turn Off' }, { timeout: 5000 }))
  await user.type(screen.getByLabelText(/^Current Code/), '123456')
  await user.click(screen.getAllByRole('button', { name: 'Turn Off' }).at(-1) as HTMLElement)

  const alert = (await screen.findByText('Multi-factor authentication was not turned off')).closest('[role="alert"]') as HTMLElement
  expect(alert.textContent).toContain('ER-7')
})
