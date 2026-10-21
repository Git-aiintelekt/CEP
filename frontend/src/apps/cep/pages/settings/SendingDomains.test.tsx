/** Settings → Delivery → Sending Domains: one row per domain with SPF, DMARC and DKIM; a domain that needs changes opens to the
 * record found and the record to publish; Check Now at most once a minute; the DKIM selector; the sender's flag; the quiet states. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { SendingDomains } from '@/lib/types'
import { cepReady, installMockApi, signIn } from '@/test/mockApi'

async function renderDelivery() {
  signIn('/settings/delivery')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

const busy: SendingDomains = {
  checked_at: '2026-10-21T06:00:00Z', ready: true, domains: [
    { domain: 'northwind.example', senders: [{ id: 'snd-email', display_name: 'Northwind Rewards', from_address: 'rewards@northwind.example' }], dkim_selector: null, checked_at: '2026-10-21T06:00:00Z',
      result: { lookup: 'OK', changes: 2,
        spf: { status: 'MISSING', found: [], publish: 'v=spf1 include:spf.emsb.lynxs.ai ~all' },
        dmarc: { status: 'MISSING', found: [], name: '_dmarc.northwind.example', publish: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@northwind.example' },
        dkim: { status: 'NOT_CHECKED', found: [], name: null } } },
    { domain: 'e.aiintelekt.com', senders: [{ id: 'snd-2', display_name: 'C360 Updates', from_address: 'hello@e.aiintelekt.com' }], dkim_selector: null, checked_at: '2026-10-21T06:00:00Z',
      result: { lookup: 'OK', changes: 1, spf: { status: 'PASS', found: ['v=spf1 include:spf.emsb.lynxs.ai ~all'] },
        dmarc: { status: 'MONITOR', found: ['v=DMARC1; p=none'], name: '_dmarc.e.aiintelekt.com', publish: 'v=DMARC1; p=quarantine' }, dkim: { status: 'NOT_CHECKED', found: [] } } },
  ],
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('each domain has its SPF, DMARC and DKIM; the first one that needs changes is open with the records to publish; its sender is flagged', async () => {
  installMockApi({ sendingDomains: busy })
  await renderDelivery()

  const table = await screen.findByRole('table', { name: 'Sending Domains' })
  const first = within(table).getByText('northwind.example').closest('tr') as HTMLElement
  expect(within(first).getAllByText('Missing')).toHaveLength(2)
  expect(within(first).getByText('Not Checked')).toBeTruthy()
  expect(within(first).getByText('2 changes to make')).toBeTruthy()
  expect(within(table).getByText('Monitor Only')).toBeTruthy()
  expect(within(table).queryByText('Passes')?.querySelector('[data-live-dot]') ?? null).toBeNull()   // a passing check is green, never "live"

  expect(within(table).getByText('v=spf1 include:spf.emsb.lynxs.ai ~all')).toBeTruthy()
  expect(within(table).getByText('_dmarc.northwind.example')).toBeTruthy()
  expect(within(table).getByRole('button', { name: 'Copy DMARC record value' })).toBeTruthy()
  expect(within(table).queryByText('v=DMARC1; p=quarantine')).toBeNull()                            // the second domain stays closed

  const senders = screen.getByRole('table', { name: 'Senders' })
  expect(within(senders).getByText(/Its domain needs 2 DNS changes/)).toBeTruthy()
  expect(within(senders).getByRole('link', { name: 'See Sending Domains' }).getAttribute('href')).toBe('#sending-domains')
})

test('Check Now looks the domains up again and says what it found; a second press within the minute is refused', async () => {
  const calls = installMockApi({ sendingDomains: busy })
  const user = userEvent.setup()
  await renderDelivery()

  await user.click(await screen.findByRole('button', { name: 'Check Now' }))
  expect(await screen.findByText('Sending domains looked up: 3 DNS changes to make.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Check Now' }))
  expect(await screen.findByText('The domains were looked up less than a minute ago. Try again shortly.')).toBeTruthy()
  expect(calls.filter((call) => call.url.includes('/sending-domains/check/'))).toHaveLength(2)
})

test('a DKIM selector is checked as written: spaces are refused, a good one shows the key it found', async () => {
  const calls = installMockApi({ sendingDomains: busy })
  const user = userEvent.setup()
  await renderDelivery()

  const selector = await screen.findByLabelText('Selector')
  await user.type(selector, 'postal Xa71Qd')
  await user.click(screen.getByRole('button', { name: 'Save and Check' }))
  expect(await screen.findByText(/A selector is letters, digits/)).toBeTruthy()

  await user.clear(selector)
  await user.type(selector, 'postal-Xa71Qd')
  await user.click(screen.getByRole('button', { name: 'Save and Check' }))
  expect(await screen.findByText('Read at postal-Xa71Qd._domainkey.northwind.example.')).toBeTruthy()
  expect(calls.filter((call) => call.url.includes('/sending-domains/selector/')).at(-1)?.body).toEqual({ domain: 'northwind.example', selector: 'postal-Xa71Qd' })
})

test('an example domain is not looked up; no email domain and a server without the checks say so', async () => {
  installMockApi()
  await renderDelivery()
  const table = await screen.findByRole('table', { name: 'Sending Domains' })
  expect(within(table).getByText('Example domain, not looked up')).toBeTruthy()
  cleanup()

  installMockApi({ sendingDomains: { checked_at: null, ready: true, domains: [] } })
  await renderDelivery()
  expect(await screen.findByText('No email domain to check yet')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Check Now' })).toBeNull()
  cleanup()

  installMockApi({ sendingDomains: { ...busy, ready: false, domains: busy.domains.map((row) => ({ ...row, result: null, checked_at: null })) } })
  await renderDelivery()
  expect(await screen.findByText(/Domain checks are not switched on here yet\. 2 domains will be looked up once they are: northwind\.example, e\.aiintelekt\.com\./)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Check Now' })).toBeNull()
})
