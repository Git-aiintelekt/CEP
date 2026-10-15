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

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('Events: the last 7 days by type, where to send events, and the coupon requests waiting for C360', async () => {
  installMockApi()
  await renderAppAt('/settings/events')
  const summary = await screen.findByRole('region', { name: 'Last 7 Days' })
  expect(screen.getByRole('heading', { name: 'Events', level: 2 })).toBeTruthy()
  expect(summary.textContent).toContain('3 events')
  expect(summary.textContent).toContain('Abandoned Cart')
  expect(summary.textContent).toContain('1 event names a customer C360 does not have yet')

  expect(screen.getByText('https://cep.example.com/api/v1/events/')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Send Events' }).closest('section')!.textContent).toContain('1 active key has it.')
  const coupons = screen.getByRole('heading', { name: 'Coupon Requests for C360' }).closest('section')!
  expect(within(coupons).getByText('Waiting').nextElementSibling?.textContent).toBe('2')
  expect(coupons.textContent).toContain('no key has it yet')
  expect(screen.getByRole('heading', { name: 'Raised by C360 Itself' })).toBeTruthy()
})

test('Events: the latest events filter by type and search; tracking-only types are not offered', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/events')
  const table = await screen.findByRole('table', { name: 'Latest events' })
  expect(within(table).getByText('Jane Doe')).toBeTruthy()
  expect(within(table).getByText('Not in the customer records yet')).toBeTruthy()

  const latest = screen.getByRole('heading', { name: 'Latest Events' }).closest('section')!
  const type = within(latest).getByRole('combobox', { name: 'Type' }) as HTMLSelectElement
  expect([...type.options].map((option) => option.textContent)).toEqual(['All', 'Purchase', 'Abandoned Cart'])
  await user.selectOptions(type, 'PURCHASE')
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/workspace/events/recent/') && call.url.includes('type=PURCHASE'))).toBe(true))
  await vi.waitFor(() => expect(screen.queryByText('Jane Doe')).toBeNull())

  await user.selectOptions(type, '')
  await user.type(within(latest).getByRole('searchbox', { name: 'Search' }), 'nobody')
  await screen.findByText('Nothing matches these filters.')
})
