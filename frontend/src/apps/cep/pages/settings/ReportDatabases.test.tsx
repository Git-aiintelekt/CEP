/** Settings → Report Databases: the empty state with the grant to give, Connect a Database with Test Connection, the cards, and Map a Dataset: a source's columns named, previewed and saved. */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, reportDatabasesNow, reportDbPolicy, reportSourcesNow, signIn } from '@/test/mockApi'

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
      last_tested_at: '2026-10-16T09:12:00Z', last_test_ok: true, last_test_error: null, read_only: true, server_version: '8.0.36', server_timezone: 'UTC', created_at: '2026-10-16T09:12:00Z', updated_at: '2026-10-16T09:12:00Z', row_version: 1, usable: true, datasets: [], limit_profile: 'STANDARD', query_timeout_s: null, max_concurrent: null, limits: { timeout_s: 15, concurrent: 4 } })
  })
  const user = userEvent.setup()
  expect(await screen.findByRole('heading', { name: 'Map a Dataset · Store Operations' }, { timeout: 5000 })).toBeTruthy()
  const aside = screen.getByRole('complementary', { name: 'Tables and views' })
  const names = await within(aside).findAllByRole('button', { name: /^(View|Table)/ })
  expect(names.map((b) => b.textContent)).toEqual(['Viewv_daily_sales', 'Tablesales_lines', 'Tablestores'])     // names only: details come when a table is chosen
  expect(within(aside).getByText(/names read live from nwa_ops/)).toBeTruthy()
  await user.click(names[0])
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
      last_tested_at: '2026-10-16T09:12:00Z', last_test_ok: true, last_test_error: null, read_only: true, server_version: '8.0.36', server_timezone: 'UTC', created_at: '2026-10-16T09:12:00Z', updated_at: '2026-10-16T09:12:00Z', row_version: 1, usable: true, datasets: [], limit_profile: 'STANDARD', query_timeout_s: null, max_concurrent: null, limits: { timeout_s: 15, concurrent: 4 } })
  })
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'Map a Dataset · Store Operations' }, { timeout: 5000 })
  const aside = screen.getByRole('complementary', { name: 'Tables and views' })
  await user.click(await within(aside).findByRole('button', { name: /^Viewv_daily_sales/ }))                  // v_daily_sales as the base
  const diagram = await screen.findByRole('group', { name: 'Tables in this dataset' })
  expect(within(diagram).getByLabelText('v_daily_sales, the base')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add a Join' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a Join' })
  await user.selectOptions(within(dialog).getByLabelText(/^Table/), 'stores')
  expect((await within(dialog).findByRole('combobox', { name: 'Key 1 of v_daily_sales' }) as HTMLSelectElement).value).toBe('store_id')   // suggested: store_id = id
  expect((within(dialog).getByRole('combobox', { name: 'Key 1 of stores' }) as HTMLSelectElement).value).toBe('id')
  await user.click(within(dialog).getByRole('button', { name: 'Check the Join' }))
  expect(await within(dialog).findByText(/Checked on the first 10,000 rows of v_daily_sales: 10,000 v_daily_sales rows, 9,812 with a match/)).toBeTruthy()
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
  last_tested_at: '2026-10-16T09:12:00Z', last_test_ok: true, last_test_error: null, read_only: true, server_version: '8.0.36', server_timezone: 'UTC', created_at: '2026-10-16T09:12:00Z', updated_at: '2026-10-16T09:12:00Z', row_version: 1, usable: true, datasets: [], limit_profile: 'STANDARD' as const, query_timeout_s: null, max_concurrent: null, limits: { timeout_s: 15, concurrent: 4 } }

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
  const dialog = await screen.findByRole('dialog', { name: 'Create Report' }, { timeout: 5000 })
  await user.click(within(dialog).getByRole('radio', { name: 'Write a Query' }))                     // step 1: how to start
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await user.click(await within(dialog).findByRole('radio', { name: 'Query Store Operations' }, { timeout: 5000 }))
  await user.click(within(dialog).getByRole('button', { name: 'Write the Query' }))
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
  const user = userEvent.setup()
  const dialog = await screen.findByRole('dialog', { name: 'Create Report' }, { timeout: 5000 })
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))                             // step 1, from data
  await within(dialog).findByRole('region', { name: 'C360 Data' }, { timeout: 5000 })
  return calls
}

/** Create Report's Your Databases, on step 2 */
const yourDatabases = () => within(screen.getByRole('dialog', { name: 'Create Report' })).findByRole('region', { name: 'Your Databases' }, { timeout: 5000 })

test('Connect a Database from New Report: a report author connects ClickHouse (HTTPS on 8443, or HTTP on 8123), saves only once it tests read-only, picks a table and the report opens in the editor', async () => {
  const calls = await renderNewReport(['report.view', 'report.edit'])
  const user = userEvent.setup()
  await user.click(within(await yourDatabases()).getByRole('button', { name: /Connect a Database/ }))
  const panel = screen.getByRole('dialog', { name: 'Create Report' })
  expect(within(panel).getByRole('navigation', { name: 'Where you are' }).textContent).toContain('Connect a Database')
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

  const step = screen.getByRole('dialog', { name: 'Create Report' })
  await within(step).findByRole('list', { name: 'Tables and views' })
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
  await user.click(within(await yourDatabases()).getByRole('button', { name: /Connect a Database/ }))
  const panel = screen.getByRole('dialog', { name: 'Create Report' })
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
  await within(panel).findByRole('list', { name: 'Tables and views' })
  await user.click(within(panel).getByRole('button', { name: 'write a query' }))
  expect(await screen.findByRole('heading', { name: 'Query · Loyalty' }, { timeout: 5000 })).toBeTruthy()
})

test('someone who cannot edit reports is not offered Connect a Database', async () => {
  await renderNewReport(['report.view'])
  expect(screen.queryByRole('button', { name: /Connect a Database/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Upload a File/ })).toBeNull()
})

test('Settings → Report Databases offers ClickHouse, with its own grant', async () => {
  await renderAppAt('/settings/report-databases')
  expect(await screen.findByText(/SETTINGS readonly = 2/, {}, { timeout: 5000 })).toBeTruthy()
  const user = userEvent.setup()
  await user.click(screen.getAllByRole('button', { name: 'Connect a Database' })[0])
  const dialog = await screen.findByRole('dialog', { name: 'Connect a Database' })
  expect(within(dialog).getByRole('option', { name: 'ClickHouse' })).toBeTruthy()
})

test('How reports treat a database (option B): Standard shows the workspace limits, Live Production Database is saved and shown on the card, Custom asks for the two values', async () => {
  const calls = await renderAppAt('/settings/report-databases', () => {
    reportDatabasesNow.push({ id: 'db-1', name: 'CG-Prod', engine: 'mysql57', engine_name: 'MySQL 5.7', host: 'db.cg-retail.internal', port: 3306, database_name: 'shop', schema_name: 'shop', username: 'c360_reports', ssl_mode: 'REQUIRED', status: 'ACTIVE',
      last_tested_at: '2026-10-16T09:12:00Z', last_test_ok: true, last_test_error: null, read_only: true, server_version: '5.7.44', server_timezone: 'UTC', created_at: '2026-10-16T09:12:00Z', updated_at: '2026-10-16T09:12:00Z', row_version: 1, usable: true, datasets: [], limit_profile: 'STANDARD', query_timeout_s: null, max_concurrent: null, limits: { timeout_s: 15, concurrent: 4 } })
  })
  const user = userEvent.setup()
  const card = await screen.findByRole('listitem', { name: 'CG-Prod' }, { timeout: 5000 })
  expect(within(card).getByText('Standard')).toBeTruthy()
  expect(within(card).getByText('15 s · 4 at once')).toBeTruthy()

  await user.click(within(card).getByRole('button', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit CG-Prod' })
  const group = within(dialog).getByRole('group', { name: 'How reports treat this database' })
  expect(within(group).getByText('15 seconds · 4 at once')).toBeTruthy()                                       // Standard: this workspace's limits
  expect((within(group).getByRole('radio', { name: /^Standard/ }) as HTMLInputElement).checked).toBe(true)
  await user.click(within(group).getByRole('radio', { name: /^Live Production Database/ }))
  expect(within(dialog).getByText(/One report at a time reads it/)).toBeTruthy()
  expect(within(dialog).queryByLabelText(/^Time Limit/)).toBeNull()                                            // a preset has no fields
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(within(screen.getByRole('listitem', { name: 'CG-Prod' })).getByText('60 s · 1 at once')).toBeTruthy(), { timeout: 4000 })
  const put = calls.filter((call) => call.url.endsWith('/workspace/report-databases/db-1/') && call.method === 'PUT').at(-1)?.body as Record<string, unknown>
  expect(put).toMatchObject({ limit_profile: 'LIVE' })
  expect(put.query_timeout_s).toBeUndefined()
  expect(within(screen.getByRole('listitem', { name: 'CG-Prod' })).getByText('Live Production Database')).toBeTruthy()

  await user.click(within(screen.getByRole('listitem', { name: 'CG-Prod' })).getByRole('button', { name: 'Edit' }))
  const again = await screen.findByRole('dialog', { name: 'Edit CG-Prod' })
  await user.click(within(again).getByRole('radio', { name: /^Custom/ }))
  const limit = within(again).getByLabelText(/^Time Limit/)
  await user.clear(limit)
  await user.type(limit, '90')
  await user.selectOptions(within(again).getByLabelText(/^Reports at Once/), '2')
  await user.click(within(again).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(within(screen.getByRole('listitem', { name: 'CG-Prod' })).getByText('90 s · 2 at once')).toBeTruthy(), { timeout: 4000 })
  const custom = calls.filter((call) => call.url.endsWith('/workspace/report-databases/db-1/') && call.method === 'PUT').at(-1)?.body as Record<string, unknown>
  expect(custom).toMatchObject({ limit_profile: 'CUSTOM', query_timeout_s: 90, max_concurrent: 2 })
})

test('Finding a table among 1,284 (option A): names only, the groups folded with their counts, search narrows them with chips, 50 at a time, a pin goes to the top, Reload the List reads them again', async () => {
  const calls = await renderAppAt('/settings/report-databases/db-1/map', () => {
    reportDatabasesNow.push({ ...BIG_DB })
    const prefixes = ['sales_', 'inv_', 'pos_', 'cust_']
    for (let n = 0; n < 1284; n += 1) reportSourcesNow.push({ name: `${prefixes[n % 4]}${String(n).padStart(4, '0')}`, kind: 'table', rows: null, columns: null, mappable: true, mapped_as: null })
  })
  const user = userEvent.setup()
  const aside = await screen.findByRole('complementary', { name: 'Tables and views' }, { timeout: 5000 })
  expect(await within(aside).findByText(/names read live from shop/)).toBeTruthy()
  expect(within(aside).getByRole('button', { name: /sales_\s*321/ }).getAttribute('aria-expanded')).toBe('false')   // folded, with its count
  expect(within(aside).queryAllByRole('button', { name: /^Table/ })).toHaveLength(0)                       // nothing drawn until a group opens or a search

  await user.type(within(aside).getByRole('searchbox', { name: 'Search tables and views' }), 'sales_00')
  expect(within(aside).getByText('25 of 1,284 match')).toBeTruthy()
  expect(within(aside).getAllByRole('button', { name: /^Table/ })).toHaveLength(25)

  await user.clear(within(aside).getByRole('searchbox', { name: 'Search tables and views' }))
  await user.type(within(aside).getByRole('searchbox', { name: 'Search tables and views' }), '1')
  expect(within(aside).getAllByRole('button', { name: /^Table/ })).toHaveLength(50)                       // the first 50 of the matches
  await user.click(within(aside).getByRole('button', { name: 'Show 50 More' }))
  expect(within(aside).getAllByRole('button', { name: /^Table/ })).toHaveLength(100)
  await user.click(within(aside).getByRole('button', { name: /^inv_/, pressed: false }))                     // a chip: the inv_ matches alone
  expect(within(aside).getAllByRole('button', { name: /^Table/ }).every((b) => b.textContent?.includes('inv_'))).toBe(true)

  await user.click(within(aside).getAllByRole('button', { name: /^Pin / })[0])
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/workspace/report-databases/db-1/pins/') && c.method === 'PUT')).toBe(true))
  await user.clear(within(aside).getByRole('searchbox', { name: 'Search tables and views' }))
  expect(await within(aside).findByRole('button', { name: /^Pinned/ })).toBeTruthy()

  await user.click(within(aside).getByRole('button', { name: 'Reload the List' }))
  await waitFor(() => expect(calls.some((c) => c.url.includes('/workspace/report-databases/db-1/sources/') && c.url.includes('reload=1'))).toBe(true))
})

test('Find Databases lists what the account can see, and the Database field becomes a choice', async () => {
  const calls = await renderAppAt('/settings/report-databases')
  const user = userEvent.setup()
  await user.click((await screen.findAllByRole('button', { name: 'Connect a Database' }, { timeout: 5000 }))[0])
  const dialog = await screen.findByRole('dialog', { name: 'Connect a Database' })
  await user.type(within(dialog).getByLabelText(/^Host/), 'db.cg-retail.internal')
  await user.type(within(dialog).getByLabelText(/^User/), 'c360_reports')
  await user.type(within(dialog).getByLabelText(/^Password/), 's3cret')
  await user.click(within(dialog).getByRole('button', { name: 'Find Databases' }))
  expect(await within(dialog).findByText(/3 found: pick one above/)).toBeTruthy()
  await user.selectOptions(within(dialog).getByLabelText(/^Database/), 'shop_reporting')
  expect(within(dialog).getByRole('option', { name: 'shop · 1,284 tables and views' })).toBeTruthy()
  const asked = calls.find((c) => c.url.endsWith('/workspace/report-databases/find-databases/'))?.body as Record<string, unknown>
  expect(asked).toMatchObject({ host: 'db.cg-retail.internal', username: 'c360_reports', password: 's3cret' })
})

const BIG_DB = { ...DB, name: 'CG-Prod', engine: 'mysql57' as const, engine_name: 'MySQL 5.7', database_name: 'shop', schema_name: 'shop' }

test('read-only not required (the global parameter off): an account that can write is shown with a warning, saved and used', async () => {
  const calls = await renderNewReport(['report.view', 'report.edit'])
  reportDbPolicy.readOnlyRequired = false
  const user = userEvent.setup()
  await user.click(within(await yourDatabases()).getByRole('button', { name: /Connect a Database/ }))
  const panel = screen.getByRole('dialog', { name: 'Create Report' })
  await user.type(within(panel).getByLabelText(/^Name/), 'Loyalty')
  await user.type(within(panel).getByLabelText(/^Host/), 'loyalty.example.com')
  await user.type(within(panel).getByLabelText(/^Database/), 'loyalty')
  await user.type(within(panel).getByLabelText(/^User/), 'cep_writer')
  await user.type(within(panel).getByLabelText(/^Password/), 'secret')
  await user.click(within(panel).getByRole('button', { name: 'Test Connection' }))
  expect(await within(panel).findByText(/Can write: the account holds INSERT, UPDATE .* Allowed here, because read-only is not required/)).toBeTruthy()
  expect(within(panel).queryByText(/Ask whoever runs the database/)).toBeNull()
  await user.click(within(panel).getByRole('button', { name: 'Save and Continue' }))
  expect(await within(panel).findByRole('list', { name: 'Tables and views' })).toBeTruthy()
  expect(calls.some((c) => c.url.endsWith('/workspace/report-databases/') && c.method === 'POST')).toBe(true)
})
