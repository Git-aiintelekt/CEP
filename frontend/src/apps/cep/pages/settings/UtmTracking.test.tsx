/** UTM tracking: Settings → UTM Tracking (channels, values, your sites, the example), the campaign's Link Tracking card, and a text's
 * links counted as short links. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, signIn } from '@/test/mockApi'

import { withShortLinks } from './utm'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('switching a channel on asks for your sites, shows the values and the example address, and saves', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/utm-tracking')

  expect(await screen.findByText(/Switch a channel on to choose the values/)).toBeTruthy()
  await user.click(screen.getByRole('switch', { name: 'Email Campaigns' }))
  const params = screen.getByRole('table', { name: 'Parameters' })
  expect(within(params).getByText('utm_source')).toBeTruthy()
  expect(within(params).getByText('email or sms, by the campaign’s channel')).toBeTruthy()
  expect(within(params).getAllByText('GA4')).toHaveLength(4)

  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Add at least one of your sites: only links to them are tagged.')).toBeTruthy()

  await user.type(screen.getByRole('textbox', { name: 'Add a domain' }), 'https://Shop.Northwind.example/fall{Enter}')
  expect(within(screen.getByRole('list', { name: 'Your sites' })).getByText('shop.northwind.example')).toBeTruthy()
  expect(screen.getByText(/^https:\/\/shop\.northwind\.example\/fall\?utm_source=c360&utm_medium=email&utm_campaign=fall-launch-new-arrivals&utm_id=cmp-2026-0042&utm_content=hero-cta-b/)).toBeTruthy()

  await user.selectOptions(screen.getByRole('combobox', { name: 'utm_source value' }), 'text')
  await user.clear(screen.getByRole('textbox', { name: 'utm_source text' }))
  await user.type(screen.getByRole('textbox', { name: 'utm_source text' }), 'Northwind News')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('UTM tracking saved')).toBeTruthy()
  const saved = calls.filter((call) => call.url.includes('/workspace/utm/') && call.method === 'PUT').at(-1)?.body
  expect(saved).toMatchObject({ email: true, sms: false, domains: ['shop.northwind.example'], params: { utm_source: { kind: 'text', value: 'Northwind News' } } })
})

test('the campaign’s Content step has a Link Tracking row whose Edit goes to Settings → UTM Tracking; nothing is edited there', async () => {
  const calls = installMockApi({ utm: { email: true, domains: ['shop.northwind.example'] }, campaign: makeCampaign({ status: 'DRAFT', setup_step: 2 }) })
  await renderAppAt('/campaigns/c1/edit?step=content')

  const row = within((await screen.findByRole('heading', { name: 'Link Tracking' })).closest('[data-link-tracking]') as HTMLElement)
  const edit = row.getByRole('link', { name: /^Edit/ })
  expect([edit.getAttribute('href'), edit.getAttribute('target')]).toEqual(['/settings/utm-tracking', '_blank'])
  expect(screen.queryByRole('table', { name: 'Links' })).toBeNull()                                         // the links table and its switch are gone from the step
  expect(screen.queryByRole('switch', { name: 'Tag Links in This Campaign' })).toBeNull()
  expect(calls.some((call) => call.url.includes('/link-tracking/'))).toBe(false)                            // the step does not call it at all
})

test('a text is counted with its links to your sites as short links', () => {
  const settings = { sms: true, ready: true, domains: ['northwind.example'], short_base: 'https://c.example/api/v1/l/NWA' }
  const text = 'Sale: https://shop.northwind.example/weekend?x=1 and https://instagram.com/nw. Unsubscribe: https://northwind.example/unsubscribe'
  expect(withShortLinks(text, settings)).toBe('Sale: https://c.example/api/v1/l/NWA/xxxxxxx/ and https://instagram.com/nw. Unsubscribe: https://northwind.example/unsubscribe')
  expect(withShortLinks(text, { ...settings, sms: false })).toBe(text)
  expect(withShortLinks(text, { ...settings, ready: false })).toBe(text)
})
