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

test('POS Receipts: what to tell the point of sale, the campaign choice as one PUT, the stores, and the trail of what was received', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/pos')

  expect(await screen.findByRole('heading', { name: 'POS Receipts' })).toBeTruthy()
  expect(screen.getByText('https://cep.example.com/api/v1/pos/transactions/')).toBeTruthy()
  expect(screen.getByText(/X-Tenant-Key: NWA/)).toBeTruthy()

  await user.selectOptions(screen.getByLabelText(/^Email Receipt/), 'c-receipt')
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/workspace/pos/')).at(-1)?.body).toEqual({ campaign: 'c-receipt' }))
  const textSelect = screen.getByLabelText(/^Text Receipt/) as HTMLSelectElement
  expect([...textSelect.options].map((o) => o.textContent)).toEqual(['The one published text campaign', 'Text Receipt'])          // only SMS-channel campaigns
  expect([...(screen.getByLabelText(/^Email Receipt/) as HTMLSelectElement).options].some((o) => o.textContent === 'Text Receipt')).toBe(false)
  await user.selectOptions(textSelect, 'c-receipt-text')
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/workspace/pos/')).at(-1)?.body).toEqual({ text_campaign: 'c-receipt-text' }))

  const stores = await screen.findByRole('table', { name: 'Stores' })
  expect(within(stores).getByText('801 · Northwind Apparel Buckhead')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add Store' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText(/^Store Number/), '802')
  await user.type(within(dialog).getByLabelText(/^Name/), 'Northwind Apparel Midtown')
  await user.type(within(dialog).getByLabelText(/^City/), 'Atlanta')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('802 · Northwind Apparel Midtown')).toBeTruthy()
  const post = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/stores/')).at(-1)
  expect(post?.body).toMatchObject({ store_number: '802', name: 'Northwind Apparel Midtown', city: 'Atlanta', brand: null, is_active: true })

  const received = screen.getByRole('table', { name: 'Received transactions' })
  expect(within(received).getByText('243309')).toBeTruthy()
  expect(within(received).getByText('S100 Receipt sent')).toBeTruthy()
  expect(within(received).getByText('S101 No email address')).toBeTruthy()
  expect(within(received).getByText('E103 Document refused')).toBeTruthy()
  await user.selectOptions(screen.getByLabelText('Answer'), 'S100')
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Received transactions' })).queryByText('S101 No email address')).toBeNull())
  expect(calls.filter((call) => call.url.includes('/workspace/pos/received/') && call.url.includes('code=S100')).length).toBeGreaterThan(0)
})
