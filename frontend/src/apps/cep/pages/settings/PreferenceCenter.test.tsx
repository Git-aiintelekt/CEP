import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, signIn } from '@/test/mockApi'

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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('off by default: the tab is in Settings, the switch explains what off means, the topics and the page words are kept; switching on is one PUT', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/preference-center')

  expect(await screen.findByRole('heading', { name: 'Preference Centre' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Preference Centre' })).toBeTruthy()                           // the Settings tab
  const toggle = screen.getByRole('switch', { name: 'Offer a Preference Centre' })
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(screen.getByText(/Only the unsubscribe link exists/)).toBeTruthy()
  expect(screen.getByText('Rewards and offers')).toBeTruthy()                                             // topics wait while off
  expect(screen.getByText('{{preference_url}}')).toBeTruthy()
  expect(screen.getByText('1,284')).toBeTruthy()                                                          // page opened, last 30 days

  await user.click(toggle)
  expect((await screen.findByRole('switch', { name: 'Offer a Preference Centre' })).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText(/filed under a topic/)).toBeTruthy()
  expect(calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/workspace/preference-center/')).at(-1)?.body).toEqual({ enabled: true })
})

test('a topic is added in a dialog and appears in the table with its channels; the page words save as one PUT and a bad privacy link lands on its field', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/preference-center')

  await user.click(await screen.findByRole('button', { name: 'Add Topic' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText(/^Name/), 'Store events')
  await user.type(within(dialog).getByLabelText(/^Description/), 'Openings and events near you.')
  await user.click(within(dialog).getByLabelText('Texts'))                                                // email only
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Store events')).toBeTruthy()
  const post = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/subscription-topics/')).at(-1)
  expect(post?.body).toEqual({ name: 'Store events', description: 'Openings and events near you.', channels: ['EMAIL'], is_shown: true })
  const row = screen.getByText('Store events').closest('tr') as HTMLElement
  expect(within(row).getByText('Email')).toBeTruthy()
  expect(within(row).getByText('Shown')).toBeTruthy()

  await user.clear(screen.getByLabelText(/^Privacy Notice Link/))
  await user.type(screen.getByLabelText(/^Privacy Notice Link/), 'www.example.com/privacy')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('A full address, starting with https://.')).toBeTruthy()

  await user.clear(screen.getByLabelText(/^Privacy Notice Link/))
  await user.type(screen.getByLabelText(/^Privacy Notice Link/), 'https://example.com/privacy')
  await user.type(screen.getByLabelText(/^Footer/), '1200 Peachtree St NE, Atlanta')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Saved')).toBeTruthy()
  const put = calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/workspace/preference-center/')).at(-1)
  expect(put?.body).toMatchObject({ heading: 'Choose what you receive', footer: '1200 Peachtree St NE, Atlanta', privacy_url: 'https://example.com/privacy', allow_opt_in: true })
  expect(put?.body).not.toHaveProperty('enabled')
})
