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
  expect(screen.getByText(/GRANT SELECT ON your_db\.\* TO 'cep_reader'@'%'/)).toBeTruthy()
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
  expect(buttons.map((b) => b.textContent)).toEqual(['v_daily_sales5 columns', 'sales_lines18 columns · 4.2 M rows', 'stores3 columns · 1,204 rows'])
  await user.click(buttons[0])
  const columns = await screen.findByRole('table', { name: 'Columns' })
  expect((within(columns).getByRole('textbox', { name: 'net_sales label' }) as HTMLInputElement).value).toBe('Net Sales')
  expect((within(columns).getByRole('combobox', { name: 'net_sales role' }) as HTMLSelectElement).value).toBe('measure')
  expect(within(columns).getByRole('button', { name: 'Sum', pressed: true })).toBeTruthy()
  expect((screen.getByRole('textbox', { name: /Dataset Name/ }) as HTMLInputElement).value).toBe('Daily Sales')
  await user.selectOptions(within(columns).getByRole('combobox', { name: 'cashier_email sensitivity' }), 'PII')
  await user.click(within(columns).getByRole('checkbox', { name: 'Use sale_day' }))                              // leave one column out
  await user.click(within(columns).getByRole('checkbox', { name: 'Use store_id' }))
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

test('Option J2: Add a Join brings a second table in on a suggested key, checks it, draws it as a card with the key marked, groups the fields by table, and Save posts the joins and the fields with their tables', async () => {
  const calls = await renderAppAt('/settings/report-databases/db-1/map', () => {
    reportDatabasesNow.push({ id: 'db-1', name: 'Store Operations', engine: 'mysql80', engine_name: 'MySQL 8.0', host: 'ops-db.northwind.local', port: 3306, database_name: 'nwa_ops', schema_name: 'nwa_ops', username: 'cep_reader', ssl_mode: 'REQUIRED', status: 'ACTIVE',
      last_tested_at: '2026-10-16T09:12:00Z', last_test_ok: true, last_test_error: null, read_only: true, server_version: '8.0.36', server_timezone: 'UTC', created_at: '2026-10-16T09:12:00Z', updated_at: '2026-10-16T09:12:00Z', row_version: 1, usable: true, datasets: [] })
  })
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'Map a Dataset · Store Operations' }, { timeout: 5000 })
  const aside = screen.getByRole('complementary', { name: 'Tables and views' })
  await user.click((await within(aside).findAllByRole('button'))[0])                                           // v_daily_sales as the base
  const diagram = await screen.findByRole('group', { name: 'Tables in this dataset' })
  expect(within(diagram).getByLabelText('v_daily_sales, the base')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add a Join' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a Join' })
  await user.selectOptions(within(dialog).getByLabelText(/^Table/), 'stores')
  expect((await within(dialog).findByRole('combobox', { name: 'Key 1 of v_daily_sales' }) as HTMLSelectElement).value).toBe('store_id')   // suggested: store_id = id
  expect((within(dialog).getByRole('combobox', { name: 'Key 1 of stores' }) as HTMLSelectElement).value).toBe('id')
  await user.click(within(dialog).getByRole('button', { name: 'Check the Join' }))
  expect(await within(dialog).findByText(/1,284 v_daily_sales rows, 1,280 with a match/)).toBeTruthy()
  const checked = calls.find((call) => call.url.endsWith('/join-check/'))?.body as { joins: unknown[] } | undefined
  expect(checked?.joins).toEqual([{ alias: 't1', table: 'stores', type: 'left', to: 't0', on: [['store_id', 'id']] }])
  await user.click(within(dialog).getByRole('button', { name: 'Add' }))
  const card = await within(diagram).findByLabelText('stores, joined left')
  expect(within(card).getByLabelText('key')).toBeTruthy()
  const columns = screen.getByRole('table', { name: 'Columns' })
  expect(within(columns).getByText(/Left on store_id = id/)).toBeTruthy()
  expect((within(columns).getByRole('textbox', { name: 'name label' }) as HTMLInputElement).value).toBe('Store Name')          // the joined table's name in the label
  await user.click(within(columns).getByRole('checkbox', { name: 'Use id of stores' }))                                          // the key need not be a field
  await user.clear(screen.getByRole('textbox', { name: /Dataset Name/ }))
  await user.type(screen.getByRole('textbox', { name: /Dataset Name/ }), 'Sales with Store')
  await user.click(screen.getByRole('button', { name: 'Save Dataset' }))
  await screen.findByText('Sales with Store is ready', {}, { timeout: 5000 })
  const posted = calls.find((call) => call.url.endsWith('/workspace/report-databases/db-1/datasets/') && call.method === 'POST')?.body as { joins: unknown[]; fields: { table: string; column: string; label: string }[] }
  expect(posted.joins).toEqual([{ alias: 't1', table: 'stores', type: 'left', to: 't0', on: [['store_id', 'id']] }])
  expect(posted.fields.filter((f) => f.table === 't1').map((f) => [f.column, f.label])).toEqual([['name', 'Store Name'], ['city', 'Store City']])
  expect(posted.fields.filter((f) => f.table === 't0').length).toBe(5)
})

const DB = { id: 'db-1', name: 'Store Operations', engine: 'mysql80' as const, engine_name: 'MySQL 8.0', host: 'ops-db.northwind.local', port: 3306, database_name: 'nwa_ops', schema_name: 'nwa_ops', username: 'cep_reader', ssl_mode: 'REQUIRED' as const, status: 'ACTIVE' as const,
  last_tested_at: '2026-10-16T09:12:00Z', last_test_ok: true, last_test_error: null, read_only: true, server_version: '8.0.36', server_timezone: 'UTC', created_at: '2026-10-16T09:12:00Z', updated_at: '2026-10-16T09:12:00Z', row_version: 1, usable: true, datasets: [] }

test('Query a Database from New Report: the visual builder writes the SQL, Run previews the rows, a second statement is refused, Write It for Me fills the window, and Create Report builds the report on the query and opens the editor', async () => {
  const { me } = await import('@/test/mockApi')
  const withRights = { ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), 'report.edit'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }
  const calls = installMockApi({ me: withRights as never })
  reportDatabasesNow.push({ ...DB })
  signIn('/insights/reports/new')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'New Report' }, { timeout: 5000 })
  await user.click(await screen.findByRole('button', { name: /Query Store Operations/ }, { timeout: 5000 }))
  await screen.findByRole('heading', { name: 'Query · Store Operations' }, { timeout: 5000 })
  const aside = screen.getByRole('complementary', { name: 'Tables and columns' })
  await user.click(await within(aside).findByRole('button', { name: 'Use sales_lines' }))                        // From
  const builder = await screen.findByRole('group', { name: 'Visual builder' })
  await user.click(within(builder).getByRole('button', { name: '+ column' }))
  await user.selectOptions(await within(builder).findByRole('combobox', { name: 'Column 1' }), 'b.store_name')
  await user.click(within(builder).getByRole('button', { name: '+ column' }))
  await user.selectOptions(within(builder).getByRole('combobox', { name: 'Column 2' }), 'b.net_sales')
  await user.selectOptions(within(builder).getByRole('combobox', { name: 'Column 2 calculation' }), 'sum')
  const window_ = screen.getByRole('textbox', { name: 'SQL' }) as HTMLTextAreaElement
  expect(window_.value).toBe('SELECT `store_name` AS `store_name`,\n       SUM(`net_sales`) AS `net_sales`\nFROM `sales_lines` b\nGROUP BY `store_name`'.replace(/`store_name` AS `store_name`/, '`b`.`store_name` AS `store_name`').replace(/SUM\(`net_sales`\)/, 'SUM(`b`.`net_sales`)').replace(/GROUP BY `store_name`/, 'GROUP BY `b`.`store_name`'))
  await user.click(screen.getByRole('button', { name: 'Run' }))
  const result = await screen.findByRole('table', { name: 'Result' })
  expect(within(result).getByText('Downtown')).toBeTruthy()
  expect(screen.getByText(/in 212 ms/)).toBeTruthy()
  expect(screen.getByText('2 rows')).toBeTruthy()
  // a pasted second statement is refused with the server's reason
  await user.click(screen.getByRole('radio', { name: 'SQL' }))
  await user.clear(window_)
  await user.type(window_, 'SELECT * FROM stores; DELETE FROM stores')
  await user.click(screen.getByRole('button', { name: 'Run' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('second statement'))
  // Write It for Me puts SQL in the window
  await user.type(screen.getByRole('textbox', { name: 'What should the query give?' }), 'Net sales by store')
  await user.click(screen.getByRole('button', { name: 'Write It for Me' }))
  await screen.findByText('The query is in the window')
  expect(window_.value.startsWith('SELECT s.name AS store_name')).toBe(true)
  const written = calls.find((c) => c.url.endsWith('/query/write/'))?.body as { prompt: string } | undefined
  expect(written?.prompt).toBe('Net sales by store')
  await user.click(screen.getByRole('button', { name: 'Run' }))
  await screen.findByRole('table', { name: 'Result' })
  await user.type(screen.getByRole('textbox', { name: 'Report name' }), 'Net Sales by Store')
  await user.click(screen.getByRole('button', { name: 'Create Report' }))
  await screen.findByRole('textbox', { name: 'Report name' }, { timeout: 5000 })                                   // the editor
  const made = calls.find((c) => c.url.endsWith('/query/dataset/') && c.method === 'POST')?.body as { label: string; sql: string }
  expect(made.label).toBe('Net Sales by Store')
  expect(made.sql.startsWith('SELECT s.name AS store_name')).toBe(true)
  const report = calls.find((c) => c.url.endsWith('/insights/reports/') && c.method === 'POST')?.body as { dataset: string; name: string }
  expect(report).toMatchObject({ dataset: 'x_net_sales_by_store', name: 'Net Sales by Store' })
})

async function renderNewReport(permissions: string[]) {
  const { me } = await import('@/test/mockApi')
  const rights = { ...me, principal: { ...me.principal, permissions }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', home: '/insights' }] }
  const calls = installMockApi({ me: rights as never })
  signIn('/insights/reports/new')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  await screen.findByRole('heading', { name: 'New Report' }, { timeout: 5000 })
  return calls
}

test('Connect a Database from New Report: a report author connects ClickHouse (HTTPS on 8443, or HTTP on 8123), saves only once it tests read-only, picks a table and the report opens in the editor', async () => {
  const calls = await renderNewReport(['report.view', 'report.edit'])
  const user = userEvent.setup()
  const databases = await screen.findByRole('list', { name: 'Your Databases' }, { timeout: 5000 })
  await user.click(within(databases).getByRole('button', { name: /Connect a Database/ }))
  const panel = await screen.findByRole('dialog', { name: 'Connect a Database' })
  const save = within(panel).getByRole('button', { name: 'Save and Continue' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  await user.type(within(panel).getByLabelText(/^Name/), 'Events Warehouse')
  await user.selectOptions(within(panel).getByLabelText(/^Engine/), 'clickhouse')
  expect((within(panel).getByLabelText(/^HTTP Port/) as HTMLInputElement).value).toBe('8443')
  expect(within(panel).getByRole('option', { name: 'HTTPS' })).toBeTruthy()
  expect(within(panel).queryByRole('option', { name: 'Preferred' })).toBeNull()
  await user.selectOptions(within(panel).getByLabelText(/^SSL/), 'OFF')
  expect((within(panel).getByLabelText(/^HTTP Port/) as HTMLInputElement).value).toBe('8123')
  await user.type(within(panel).getByLabelText(/^Host/), 'ch.cityht.example')
  await user.type(within(panel).getByLabelText(/^Database/), 'events')
  await user.type(within(panel).getByLabelText(/^User/), 'c360_reader')
  await user.type(within(panel).getByLabelText(/^Password/), 'ch-secret')
  await user.click(within(panel).getByRole('button', { name: 'Test Connection' }))
  expect(await within(panel).findByText(/Read-only: the account holds SELECT/)).toBeTruthy()
  expect(save.disabled).toBe(false)
  await user.click(save)

  const step = await screen.findByRole('dialog', { name: 'Events Warehouse' })
  const posted = calls.find((c) => c.url.endsWith('/workspace/report-databases/') && c.method === 'POST')?.body
  expect(posted).toMatchObject({ engine: 'clickhouse', ssl: 'OFF', port: 8123, host: 'ch.cityht.example', database: 'events', username: 'c360_reader', password: 'ch-secret' })
  const list = await within(step).findByRole('list', { name: 'Tables and views' })
  await user.type(within(step).getByRole('textbox', { name: 'Search tables and views' }), 'sales')
  expect(within(list).queryByText('stores')).toBeNull()
  await user.click(within(list).getByRole('radio', { name: /sales_lines/ }))
  await user.click(within(step).getByRole('button', { name: 'Create Report' }))
  await screen.findByRole('textbox', { name: 'Report name' }, { timeout: 5000 })                                   // the editor
  expect(calls.find((c) => c.url.endsWith('/datasets/') && c.method === 'POST')?.body).toEqual({ source: 'sales_lines' })
  expect(calls.find((c) => c.url.endsWith('/insights/reports/') && c.method === 'POST')?.body).toMatchObject({ dataset: 'x_sales_lines', name: 'Sales Lines report' })
})

test('Connect a Database from New Report: an account that can write is shown and not saved; fixed and tested again, it is saved and Write a Query opens the query window', async () => {
  const calls = await renderNewReport(['report.view', 'report.edit'])
  const user = userEvent.setup()
  await user.click(within(await screen.findByRole('list', { name: 'Your Databases' }, { timeout: 5000 })).getByRole('button', { name: /Connect a Database/ }))
  const panel = await screen.findByRole('dialog', { name: 'Connect a Database' })
  await user.type(within(panel).getByLabelText(/^Name/), 'Loyalty')
  await user.type(within(panel).getByLabelText(/^Host/), 'loyalty.example.com')
  await user.type(within(panel).getByLabelText(/^Database/), 'loyalty')
  await user.type(within(panel).getByLabelText(/^User/), 'cep_writer')
  await user.type(within(panel).getByLabelText(/^Password/), 'secret')
  await user.click(within(panel).getByRole('button', { name: 'Test Connection' }))
  expect(await within(panel).findByText(/Not read-only: the account holds INSERT, UPDATE/)).toBeTruthy()
  expect(within(panel).getByText(/Ask whoever runs the database for an account that can only read/)).toBeTruthy()
  expect((within(panel).getByRole('button', { name: 'Save and Continue' }) as HTMLButtonElement).disabled).toBe(true)
  expect(calls.some((c) => c.url.endsWith('/workspace/report-databases/') && c.method === 'POST')).toBe(false)
  // an account that can only read: tested again, saved, and the query window opened on it
  await user.clear(within(panel).getByLabelText(/^Host/))
  await user.type(within(panel).getByLabelText(/^Host/), 'ops-db.northwind.local')
  await user.click(within(panel).getByRole('button', { name: 'Test Connection' }))
  await within(panel).findByText(/Read-only: the account holds SELECT/)
  await user.click(within(panel).getByRole('button', { name: 'Save and Continue' }))
  const step = await screen.findByRole('dialog', { name: 'Loyalty' })
  await user.click(within(step).getByRole('button', { name: 'write a query' }))
  expect(await screen.findByRole('heading', { name: 'Query · Loyalty' }, { timeout: 5000 })).toBeTruthy()
})

test('someone who cannot edit reports is not offered Connect a Database', async () => {
  await renderNewReport(['report.view'])
  await screen.findByRole('group', { name: 'Dataset' }, { timeout: 5000 })
  expect(screen.queryByRole('button', { name: /Connect a Database/ })).toBeNull()
})

test('Settings → Report Databases offers ClickHouse, with its own grant', async () => {
  await renderAppAt('/settings/report-databases')
  expect(await screen.findByText(/SETTINGS readonly = 2/, {}, { timeout: 5000 })).toBeTruthy()
  const user = userEvent.setup()
  await user.click(screen.getAllByRole('button', { name: 'Connect a Database' })[0])
  const dialog = await screen.findByRole('dialog', { name: 'Connect a Database' })
  expect(within(dialog).getByRole('option', { name: 'ClickHouse' })).toBeTruthy()
})
