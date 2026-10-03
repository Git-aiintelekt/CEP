/**
 * Settings → Set-Up: the seven steps read from the workspace with the next one explained, Hide Until Later; the Home card for
 * administrators until the workspace is ready; the first sign-in of an administrator landing on the page.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { SAMPLE_SETUP, SAMPLE_SETUP_READY } from '@/features/setup/sampleSetup'
import { FRESH_SIGN_IN_KEY } from '@/features/setup/setup'
import { installMockApi, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const rows = () => [...document.querySelectorAll('[data-step]')] as HTMLElement[]

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the page: seven steps with their state, the next one explained with its primary link, the meter; Hide Until Later hides the Home card', async () => {
  const calls = installMockApi({ setup: SAMPLE_SETUP })
  const user = userEvent.setup()
  await renderAppAt('/settings/setup')

  expect(await screen.findByRole('heading', { level: 2, name: 'Set Up Your Workspace' })).toBeTruthy()
  expect(screen.getByText(/Northwind Apparel \(NWA\) · Growth · America\/New_York\. Work the steps in order/)).toBeTruthy()
  const card = screen.getByRole('region', { name: 'Set-Up' })
  expect(within(card).getByText('3 of 7 done')).toBeTruthy()
  expect(within(card).getByRole('progressbar', { name: 'Set-up progress' }).getAttribute('aria-valuenow')).toBe('43')
  expect(rows().map((row) => row.getAttribute('data-state'))).toEqual(['done', 'done', 'done', 'now', 'todo', 'todo', 'todo'])   // the sender is next: blue, with its hint
  expect(rows().map((row) => row.getAttribute('data-step'))).toEqual(['signin', 'team', 'email_engine', 'email_sender', 'text', 'lists', 'tell'])
  expect(within(card).getAllByText('Done', { selector: ':not(.sr-only)' })).toHaveLength(3)                             // the tag; the tick's own label is for screen readers
  expect(within(card).getAllByText('Optional')).toHaveLength(2)

  const sender = rows()[3]
  expect(within(sender).getByText('Not verified')).toBeTruthy()
  expect(sender.querySelector('[data-why]')!.textContent).toContain('Verify checks SPF and DKIM')
  const verify = within(sender).getByRole('link', { name: 'Verify Sender' })
  expect(verify.getAttribute('href')).toBe('/settings/delivery#senders')
  expect(verify.className).toContain('bg-brand-600')                                                                  // the next step's primary link is the one blue button
  expect(rows()[5].querySelector('[data-why]')).toBeNull()                                                            // only the next step is explained
  expect(within(rows()[5]).getByRole('link', { name: 'Upload a List' }).className).not.toContain('bg-brand-600')
  expect(within(rows()[1]).getByRole('link', { name: 'Users' }).getAttribute('href')).toBe('/settings/users')
  expect(screen.getByText('When steps 1 to 4 and 6 are done, the workspace is ready')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Hide Until Later' }))
  expect(await screen.findByRole('button', { name: 'Show on Home Again' })).toBeTruthy()
  expect(calls.filter((call) => call.url.endsWith('/workspace/setup/') && call.method === 'PUT').map((call) => call.body)).toEqual([{ dismissed: true }])

  // the page sits in the Settings menu's Workspace group
  const menu = screen.getByRole('navigation', { name: 'Settings sections' })
  expect(within(within(menu).getByRole('region', { name: 'Workspace' })).getAllByRole('link').map((link) => link.textContent)[0]).toBe('Set-Up')
})

test('a brand-new workspace greets the administrator by name; a ready one says so and keeps no Hide button', async () => {
  const freshSteps = SAMPLE_SETUP.steps.map((step, index) => (index === 0 ? step : { ...step, state: 'todo' as const, tag: null }))
  installMockApi({ setup: { ...SAMPLE_SETUP, steps: freshSteps, done: 1, next: 'team' } })
  await renderAppAt('/settings/setup')
  expect(await screen.findByRole('heading', { level: 2, name: "Welcome, Aby. Let's set up NWA." })).toBeTruthy()
  expect(screen.getByText(/Seven steps, about an hour/)).toBeTruthy()
  expect(screen.getByText('1 of 7 done')).toBeTruthy()
  expect(rows()[1].getAttribute('data-state')).toBe('now')
  cleanup()

  installMockApi({ setup: SAMPLE_SETUP_READY })
  await renderAppAt('/settings/setup')
  expect(await screen.findByRole('heading', { level: 2, name: 'Set Up Your Workspace' })).toBeTruthy()
  expect(screen.getByText('Your workspace is ready')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Hide Until Later' })).toBeNull()
  expect(rows().every((row) => row.getAttribute('data-state') === 'done')).toBe(true)
})

test('the Home card: for an administrator while the workspace is not ready, gone once ready or hidden, never asked for by anyone else', async () => {
  installMockApi({ setup: SAMPLE_SETUP })
  await renderAppAt('/')
  const card = await screen.findByRole('region', { name: 'Workspace set-up' })
  expect(within(card).getByText('Set Up Your Workspace · 3 of 7 done')).toBeTruthy()
  expect(within(card).getByText(/^Next: Add an email sender and verify it\./)).toBeTruthy()
  expect(within(card).getByRole('link', { name: 'Continue Set-Up' }).getAttribute('href')).toBe('/settings/setup')
  cleanup()

  installMockApi({ setup: SAMPLE_SETUP_READY })
  await renderAppAt('/')
  await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Aby$/ })
  expect(screen.queryByRole('region', { name: 'Workspace set-up' })).toBeNull()
  cleanup()

  installMockApi({ setup: { ...SAMPLE_SETUP, dismissed: true } })
  await renderAppAt('/')
  await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Aby$/ })
  expect(screen.queryByRole('region', { name: 'Workspace set-up' })).toBeNull()
  cleanup()

  const calls = installMockApi({ setup: SAMPLE_SETUP, me: { principal: { ...me.principal, kind: 'user', permissions: me.principal.permissions.filter((code) => code !== 'user.admin') } } })
  await renderAppAt('/')
  await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Aby$/ })
  expect(screen.queryByRole('region', { name: 'Workspace set-up' })).toBeNull()
  expect(calls.some((call) => call.url.endsWith('/workspace/setup/'))).toBe(false)
})

test('a fresh sign-in lands an administrator on Set-Up while the workspace is not ready; the flag is spent, so Home is Home afterwards', async () => {
  installMockApi({ setup: SAMPLE_SETUP })
  window.sessionStorage.setItem(FRESH_SIGN_IN_KEY, '1')
  await renderAppAt('/')
  expect(await screen.findByRole('heading', { level: 2, name: 'Set Up Your Workspace' })).toBeTruthy()
  expect(window.location.pathname).toBe('/settings/setup')
  expect(window.sessionStorage.getItem(FRESH_SIGN_IN_KEY)).toBeNull()
  cleanup()

  await renderAppAt('/')
  expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Aby$/ })).toBeTruthy()
  cleanup()

  // ready, or hidden: the sign-in lands on Home
  installMockApi({ setup: { ...SAMPLE_SETUP, dismissed: true } })
  window.sessionStorage.setItem(FRESH_SIGN_IN_KEY, '1')
  await renderAppAt('/')
  expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Aby$/ })).toBeTruthy()
})
