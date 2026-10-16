/** Settings → Report Databases: the empty state with the grant to give, Connect a Database with Test Connection, the cards, and Map a Dataset: a source's columns named, previewed and saved. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, reportDatabasesNow, signIn } from '@/test/mockApi'

async function renderAppAt(path: string, before: () => void = () => undefined) {
  const calls = installMockApi()
  before()
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
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

test('nothing connected: the empty state and the SELECT-only grant for both engines; Connect a Database tests, then saves, and the card shows the account read-only', async () => {
  const calls = await renderAppAt('/settings/report-databases')
  const user = userEvent.setup()
  expect(await screen.findByText('No Databases Connected', {}, { timeout: 5000 })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Report Databases' })).toBeTruthy()                                  // the Settings menu
  expect(screen.getByText(/GRANT SELECT ON your_db\.\*/)).toBeTruthy()
  expect(screen.getByText(/GRANT SELECT ON ALL TABLES IN SCHEMA public/)).toBeTruthy()
  await user.click(screen.getAllByRole('button', { name: 'Connect a Database' })[0])
  const dialog = await screen.findByRole('dialog', { name: 'Connect a Database' })
  await user.type(within(dialog).getByLabelText(/^Name/), 'Store Operations')
  await user.type(within(dialog).getByLabelText(/^Host/), 'ops-db.northwind.local')
  await user.type(within(dialog).getByLabelText(/^Database/), 'nwa_ops')
  await user.type(within(dialog).getByLabelText(/^User/), 'cep_reader')
  await user.click(within(dialog).getByRole('button', { name: 'Test Connection' }))
  const checks = await within(dialog).findByRole('list', { name: 'Test Connection' })
  expect(within(checks).getByText(/Reached the server · MySQL 8.0 8.0.36/)).toBeTruthy()
  expect(within(checks).getByText(/14 tables and 6 views/)).toBeTruthy()
  expect(within(checks).getByText(/Read-only: the account holds SELECT/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await within(dialog).findByText("Give the account's password.")).toBeTruthy()                       // the server's word, no password sent
  await user.type(within(dialog).getByLabelText(/^Password/), 's3cret')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  const card = await screen.findByRole('listitem', { name: 'Store Operations' })
  const posted = calls.filter((call) => call.url.endsWith('/workspace/report-databases/') && call.method === 'POST').at(-1)?.body as Record<string, unknown>
  expect(posted).toMatchObject({ name: 'Store Operations', engine: 'mysql80', host: 'ops-db.northwind.local', port: 3306, database: 'nwa_ops', username: 'cep_reader', password: 's3cret', ssl: 'REQUIRED' })
  expect(within(card).getByText('✓ Read-only')).toBeTruthy()
  expect(within(card).getByText(/MySQL 8.0 8.0.36 · ops-db.northwind.local:3306 \/ nwa_ops/)).toBeTruthy()
  expect(within(card).getByRole('link', { name: 'Map a Dataset' }).getAttribute('href')).toBe('/settings/report-databases/db-1/map')
})

test('PostgreSQL gets port 5432 and a schema field; an account that can write is marked and cannot map', async () => {
  const calls = await renderAppAt('/settings/report-databases')
  const user = userEvent.setup()
  await user.click((await screen.findAllByRole('button', { name: 'Connect a Database' }, { timeout: 5000 }))[0])
  const dialog = await screen.findByRole('dialog', { name: 'Connect a Database' })
  await user.selectOptions(within(dialog).getByLabelText(/^Engine/), 'postgresql')
  expect((within(dialog).getByLabelText(/^Port/) as HTMLInputElement).value).toBe('5432')
  await user.type(within(dialog).getByLabelText(/^Name/), 'Loyalty Warehouse')
  await user.type(within(dialog).getByLabelText(/^Host/), 'loyalty.example.com')
  await user.type(within(dialog).getByLabelText(/^Database/), 'loyalty')
  await user.clear(within(dialog).getByLabelText(/^Schema/))
  await user.type(within(dialog).getByLabelText(/^Schema/), 'analytics')
  await user.type(within(dialog).getByLabelText(/^User/), 'loyalty_app')
  await user.type(within(dialog).getByLabelText(/^Password/), 'pw')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  const card = await screen.findByRole('listitem', { name: 'Loyalty Warehouse' })
  const postedPg = calls.find((call) => call.url.endsWith('/workspace/report-databases/') && call.method === 'POST')?.body as Record<string, unknown> | undefined
  expect(postedPg?.schema).toBe('analytics')
  expect(within(card).getByText('✕ Can write')).toBeTruthy()
  expect(within(card).getByText(/The account can write: INSERT, UPDATE/)).toBeTruthy()
  expect(within(card).queryByRole('link', { name: 'Map a Dataset' })).toBeNull()
  expect(within(card).getByText(/PostgreSQL 8.0.31 · loyalty.example.com:5432 \/ loyalty · analytics/)).toBeTruthy()
})

test('Map a Dataset: views first, a source’s columns typed with labels from their names, a personal field masked in the preview, Save posts the fields and the dataset lists under the cards', async () => {
  const calls = await renderAppAt('/settings/report-databases/db-1/map', () => {
    reportDatabasesNow.push({ id: 'db-1', name: 'Store Operations', engine: 'mysql80', engine_name: 'MySQL 8.0', host: 'ops-db.northwind.local', port: 3306, database_name: 'nwa_ops', schema_name: 'nwa_ops', username: 'cep_reader', ssl_mode: 'REQUIRED', status: 'ACTIVE',
      last_tested_at: '2026-10-16T09:12:00Z', last_test_ok: true, last_test_error: null, read_only: true, server_version: '8.0.36', server_timezone: 'UTC', created_at: '2026-10-16T09:12:00Z', updated_at: '2026-10-16T09:12:00Z', row_version: 1, usable: true, datasets: [] })
  })
  const user = userEvent.setup()
  expect(await screen.findByRole('heading', { name: 'Map a Dataset · Store Operations' }, { timeout: 5000 })).toBeTruthy()
  const aside = screen.getByRole('complementary', { name: 'Tables and views' })
  const buttons = await within(aside).findAllByRole('button')
  expect(buttons.map((b) => b.textContent)).toEqual(['v_daily_sales4 columns', 'sales_lines18 columns · 4.2 M rows'])
  await user.click(buttons[0])
  const columns = await screen.findByRole('table', { name: 'Columns' })
  expect((within(columns).getByRole('textbox', { name: 'net_sales label' }) as HTMLInputElement).value).toBe('Net Sales')
  expect((within(columns).getByRole('combobox', { name: 'net_sales role' }) as HTMLSelectElement).value).toBe('measure')
  expect(within(columns).getByRole('button', { name: 'Sum', pressed: true })).toBeTruthy()
  expect((screen.getByRole('textbox', { name: /Dataset Name/ }) as HTMLInputElement).value).toBe('Daily Sales')
  await user.selectOptions(within(columns).getByRole('combobox', { name: 'cashier_email sensitivity' }), 'PII')
  await user.click(within(columns).getByRole('checkbox', { name: 'Use sale_day' }))                              // leave one column out
  const preview = await screen.findByRole('table', { name: 'Preview' }, { timeout: 4000 })
  expect(await within(preview).findByText('Cashier Email (masked)', {}, { timeout: 4000 })).toBeTruthy()
  expect(within(preview).getByText('•••••')).toBeTruthy()
  await user.clear(screen.getByRole('textbox', { name: /Dataset Name/ }))
  await user.type(screen.getByRole('textbox', { name: /Dataset Name/ }), 'Store Sales')
  await user.click(screen.getByRole('button', { name: 'Save Dataset' }))
  expect(await screen.findByText('Store Sales is ready', {}, { timeout: 5000 })).toBeTruthy()                 // the toast, then the list page
  const table = await screen.findByRole('table', { name: 'Datasets from your databases' }, { timeout: 5000 })
  const posted = calls.find((call) => call.url.endsWith('/workspace/report-databases/db-1/datasets/') && call.method === 'POST')?.body as { label: string; source: string; fields: { column: string; sensitivity: string }[] }
  expect(posted.label).toBe('Store Sales')
  expect(posted.source).toBe('v_daily_sales')
  expect(posted.fields.map((f) => f.column)).toEqual(['store_name', 'net_sales', 'cashier_email'])
  expect(posted.fields[2].sensitivity).toBe('PII')
  expect(within(table).getByText('Store Sales')).toBeTruthy()
  expect(within(table).getByText('3 · 1 personal')).toBeTruthy()
})
