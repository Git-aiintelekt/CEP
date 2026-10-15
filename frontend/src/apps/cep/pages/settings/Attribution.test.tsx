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

test('Attribution: the switch and windows save one by one, store sales wait for attribution, the costs save together', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/attribution')
  const rules = await screen.findByRole('region', { name: 'Attribution Rules' })
  expect(screen.getByRole('heading', { name: 'Attribution', level: 2 })).toBeTruthy()

  const store = within(rules).getByRole('switch', { name: 'Count Store Sales' })
  expect(store.hasAttribute('disabled')).toBe(true)                                      // nothing to count into while attribution is off
  const enabled = within(rules).getByRole('switch', { name: 'Attribution' })
  expect(enabled.getAttribute('aria-checked')).toBe('false')
  await user.click(enabled)
  await vi.waitFor(() => expect(calls.find((call) => call.method === 'PUT' && call.url.endsWith('/attribution/settings/'))?.body).toEqual({ enabled: true }))
  await vi.waitFor(() => expect(within(rules).getByRole('switch', { name: 'Attribution' }).getAttribute('aria-checked')).toBe('true'))
  expect(within(rules).getByRole('switch', { name: 'Count Store Sales' }).hasAttribute('disabled')).toBe(false)

  const click = within(rules).getByRole('combobox', { name: 'Click Window' }) as HTMLSelectElement
  expect([...click.options].map((option) => option.textContent)).toEqual(['1 day', '3 days', '7 days', '14 days', '30 days'])
  await user.selectOptions(click, '14')
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ click_days: 14 }))
  const open = within(rules).getByRole('combobox', { name: 'Open Window' }) as HTMLSelectElement
  expect(open.options[0].textContent).toBe('Opens Do Not Count')
  await user.selectOptions(open, '0')
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ open_days: 0 }))

  const save = screen.getByRole('button', { name: 'Save Costs' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  await user.type(screen.getByLabelText(/^Email, per 1,000 Delivered/), '0.85')
  await user.click(save)
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ email_cost_per_1000: '0.85', text_cost_per_1000: null }))
})

test('Attribution: the last 30 days, how to send orders, and the latest orders with the campaign credited or the reason', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/attribution')
  const summary = await screen.findByRole('region', { name: 'Last 30 Days' })
  expect(summary.textContent).toContain('75.0% of orders')
  expect(within(summary).getByRole('link', { name: 'Fall Launch' }).getAttribute('href')).toBe('/campaigns/cmp-1')
  expect(screen.getByText('https://cep.example.com/api/v1/orders/')).toBeTruthy()
  expect(screen.getByText(/No key has it yet/)).toBeTruthy()

  const table = await screen.findByRole('table', { name: 'Latest orders' })
  expect(within(table).getByRole('link', { name: 'Fall Launch' })).toBeTruthy()
  expect(table.textContent).toContain('No person: no customer id')
  await user.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'ATTRIBUTED')
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/attribution/orders/') && call.url.includes('status=ATTRIBUTED'))).toBe(true))
  await vi.waitFor(() => expect(screen.getByRole('table', { name: 'Latest orders' }).textContent).not.toContain('No person'))
})

test('Settings menu lists Attribution under Integrations, and Home links Set Up Attribution there', async () => {
  installMockApi()
  await renderAppAt('/settings/attribution')
  await screen.findByRole('region', { name: 'Attribution Rules' })
  const link = screen.getAllByRole('link', { name: /Attribution/ }).find((item) => item.getAttribute('href') === '/settings/attribution')
  expect(link).toBeTruthy()
})
