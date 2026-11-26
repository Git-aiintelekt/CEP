import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

const attributesTable = () => screen.findByRole('table', { name: 'Customer attributes' }, { timeout: 5000 })

test('Customer Attributes: each field with where it comes from, how fresh, how many people have it and the tags that read it', async () => {
  installMockApi()
  await renderAppAt('/settings/customer-attributes')
  const table = await attributesTable()
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Attribute', 'Comes From', 'Refresh', 'People With a Value', 'Used By', ''])
  const points = within(table).getByText('Points Balance').closest('tr')!
  expect(within(points).getByText('points_balance')).toBeTruthy()
  expect(points.textContent).toContain('points_balance · Number')
  expect(within(points).getByText('CITI iCRM')).toBeTruthy()
  expect(within(points).getByText('POINTS_BALANCE')).toBeTruthy()
  expect(within(points).getByText('Nightly')).toBeTruthy()
  expect(within(points).getByText('1,904,118')).toBeTruthy()
  expect(within(points).getByText('{{points_balance}}')).toBeTruthy()
  const order = within(table).getByText('Last Online Order').closest('tr')!
  expect(within(order).getByText('No tag yet')).toBeTruthy()
  expect(within(order).getByText('On Change')).toBeTruthy()
})

test('Sources: how each matches people and its last sync; Sync Now reads a database source in the background', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/customer-attributes')
  await attributesTable()
  await user.click(screen.getByRole('tab', { name: /Sources/ }))
  const table = await screen.findByRole('table', { name: 'Attribute sources' })
  const icrm = within(table).getByText('CITI iCRM').closest('tr')!
  expect(icrm.textContent).toContain('LOYALTY_ACCOUNT.PARTY_ID → ICRM ID')
  expect(within(icrm).getByText('1,932,410 read, 1,904,118 matched')).toBeTruthy()
  const shop = within(table).getByText('Shopify').closest('tr')!
  expect(within(shop).getByText('Never read')).toBeTruthy()
  expect(within(shop).queryByRole('button', { name: /Sync Now/ })).toBeNull()                        // an API source pushes its own values
  await user.click(within(icrm).getByRole('button', { name: /Sync Now/ }))
  await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/customer-attributes/sources/src-icrm/sync/'))).toBe(true))
  expect(await within(table).findByText('Waiting to be read')).toBeTruthy()
})

test('Add Attribute: the key follows the label, a database source offers its columns with sample values, and a tag can be made with it', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/customer-attributes')
  await attributesTable()
  await user.click(screen.getByRole('button', { name: 'Add Attribute' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Attribute' })
  await user.type(within(dialog).getByLabelText(/^Label/), 'Lifetime Spend')
  expect((within(dialog).getByLabelText(/^Key/) as HTMLInputElement).value).toBe('lifetime_spend')
  await user.selectOptions(within(dialog).getByLabelText(/^Type/), 'NUMBER')
  await user.selectOptions(within(dialog).getByLabelText(/^Comes From/), 'src-icrm')
  await user.click(within(dialog).getByRole('button', { name: 'Add Attribute' }))
  expect(within(dialog).getByText('Choose the column the value is read from.')).toBeTruthy()
  const field = within(dialog).getByLabelText(/^Field/) as HTMLSelectElement
  await waitFor(() => expect(within(field).queryByRole('option', { name: 'POINTS_BALANCE' })).not.toBeNull())
  expect(within(field).queryByRole('option', { name: 'PARTY_ID' })).toBeNull()                       // the ID column is how people are matched, not a value
  await user.selectOptions(field, 'POINTS_BALANCE')
  expect(await within(dialog).findByText('Sample: 1240 · 0 · 18450')).toBeTruthy()
  expect((within(dialog).getByLabelText(/^Refresh/) as HTMLSelectElement).value).toBe('NIGHTLY')
  await user.click(within(dialog).getByRole('button', { name: 'Add Attribute' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Attribute' })).toBeNull())
  const posted = calls.find((call) => call.method === 'POST' && call.url.endsWith('/customer-attributes/'))?.body
  expect(posted).toMatchObject({ key: 'lifetime_spend', label: 'Lifetime Spend', data_type: 'NUMBER', source: 'src-icrm', source_field: 'POINTS_BALANCE', refresh: 'NIGHTLY', make_tag: true })
  const row = within(await attributesTable()).getByText('Lifetime Spend').closest('tr')!
  expect(within(row).getByText('{{lifetime_spend}}')).toBeTruthy()
})

test('an attribute a tag reads cannot be removed; the reason is shown', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/customer-attributes')
  const table = await attributesTable()
  await user.click(within(within(table).getByText('Points Balance').closest('tr')!).getByRole('button', { name: 'Remove' }))
  const dialog = await screen.findByRole('dialog', { name: 'Remove Points Balance?' })
  await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
  expect((await screen.findAllByText(/reads this attribute/)).length).toBeGreaterThan(0)
})

test('a workspace without attributes: what they are and the two ways to start', async () => {
  installMockApi({ customerAttributes: [], attributeSources: [] })
  await renderAppAt('/settings/customer-attributes')
  expect(await screen.findByText('No customer attributes yet', undefined, { timeout: 5000 })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Add a Source' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Add Attribute' })).toBeTruthy()
})

test('without patch 0100 the page says so plainly', async () => {
  installMockApi({ customerAttributes: null })
  await renderAppAt('/settings/customer-attributes')
  expect(await screen.findByText('Customer Attributes are not set up on this server yet', undefined, { timeout: 5000 })).toBeTruthy()
})
