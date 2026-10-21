/** Single sign-on lands with a one-time code that only the tab which started the sign-in can exchange; tokens in a link are never taken. */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi } from '@/test/mockApi'

async function renderAt(path: string) {
  window.history.pushState({}, '', path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the tab that started the sign-in exchanges the code and goes where it was headed', async () => {
  const calls = installMockApi()
  window.sessionStorage.setItem('cep.sso.binding', 'tab-binding-1')
  await renderAt('/sso/complete#code=sso-code-1&tenant=NWA')

  await waitFor(() => expect(window.location.pathname).toBe('/campaigns'))
  expect(window.localStorage.getItem('cep.access.NWA')).toBe('access-1')
  expect(window.localStorage.getItem('cep.refresh.NWA')).toBe('refresh-1')
  expect(window.sessionStorage.getItem('cep.sso.binding')).toBeNull()
  expect(window.location.hash).toBe('')
  expect(calls.find((call) => call.url.includes('/auth/sso/exchange/'))?.body).toEqual({ code: 'sso-code-1', binding: 'tab-binding-1' })
})

test('a link opened in a tab that did not start the sign-in signs nobody in', async () => {
  const calls = installMockApi()
  await renderAt('/sso/complete#code=sso-code-1&tenant=NWA')

  expect(await screen.findByText('This sign-in did not finish')).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/auth/sso/exchange/'))).toBe(false)
  expect(window.localStorage.getItem('cep.access.NWA')).toBeNull()
})

test('a code from someone else is refused even with a binding in the tab', async () => {
  installMockApi()
  window.sessionStorage.setItem('cep.sso.binding', 'another-tab')
  await renderAt('/sso/complete#code=sso-code-1&tenant=NWA')

  expect(await screen.findByText('This sign-in did not finish')).toBeTruthy()
  expect(window.localStorage.getItem('cep.access.NWA')).toBeNull()
})

test('tokens placed in the link itself are not taken', async () => {
  installMockApi()
  window.sessionStorage.setItem('cep.sso.binding', 'tab-binding-1')
  await renderAt('/sso/complete#access=someone-elses&refresh=theirs&tenant=NWA')

  expect(await screen.findByText('This sign-in did not finish')).toBeTruthy()
  expect(window.localStorage.getItem('cep.access.NWA')).toBeNull()
})

test('the login page keeps a binding in the tab and sends it with the sign-in', async () => {
  installMockApi({ authOptions: { sso_enabled: true, sso_name: 'Microsoft' } })
  await renderAt('/login')
  const user = userEvent.setup()

  const link = await screen.findByRole('link', { name: 'Log In with Microsoft' })
  const binding = new URL(link.getAttribute('href') ?? '', window.location.origin).searchParams.get('binding') ?? ''
  expect(binding.length).toBeGreaterThanOrEqual(16)
  link.addEventListener('click', (event) => event.preventDefault())
  await user.click(link)
  expect(window.sessionStorage.getItem('cep.sso.binding')).toBe(binding)
})
