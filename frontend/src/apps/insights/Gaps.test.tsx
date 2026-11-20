/** The smaller gaps: custom fields, Top N with Others, drilling in a pivot. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsCatalog, installMockApi, me, signIn } from '@/test/mockApi'
import { removeCustom, setCustom, setTop, withCustom } from './editor/definition'
import type { CatalogDataset, ReportDefinition } from './types'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string) {
  const calls = installMockApi({ me: withInsights as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const messages = insightsCatalog.datasets[0] as unknown as CatalogDataset

test('custom fields join the dataset as text dimensions; removing one removes its columns and rules; Top N is set and cleared', () => {
  const base: ReportDefinition = { columns: [{ field: 'channel' }, { field: 'sent', aggregate: 'sum' }], filters: { combinator: 'and', rules: [] } }
  const grouped = setCustom(base, { label: 'Big Campaigns', kind: 'group', field: 'campaign_name', groups: [{ label: 'Big', values: ['Fall Launch'] }], other: 'Other' })
  expect(grouped.derived?.[0].key).toBe('c_big_campaigns')
  const shown = withCustom(messages, grouped)
  expect(shown.fields.at(-1)).toMatchObject({ key: 'c_big_campaigns', label: 'Big Campaigns', type: 'string', role: 'dimension', custom: true })
  const used: ReportDefinition = { ...grouped, columns: [{ field: 'c_big_campaigns' }, ...grouped.columns], filters: { combinator: 'and', rules: [{ field: 'c_big_campaigns', operator: '=', value: 'Big' }] } }
  const gone = removeCustom(used, 'c_big_campaigns')
  expect(gone.derived).toBeUndefined()
  expect(gone.columns.map((c) => c.field)).toEqual(['channel', 'sent'])
  expect(gone.filters?.rules).toEqual([])
  expect(setTop(base, 5, true).top).toEqual({ n: 5, others: true })
  expect(setTop(setTop(base, 5, true), null, true).top).toBeUndefined()
})

test('the editor: a custom field of groups, then Top 3 with Others, both sent with the preview', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' }, { timeout: 5000 })
  await user.click(screen.getByRole('button', { name: 'New Custom Field' }))
  const dialog = await screen.findByRole('dialog', { name: 'Custom Fields' })
  await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Big Campaigns')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /^From/ }), 'campaign_name')
  await user.type(within(dialog).getByRole('textbox', { name: 'Group 1 name' }), 'Big')
  await user.type(within(dialog).getByRole('textbox', { name: 'Group 1 values' }), 'Fall Launch, Weekly Newsletter')
  await user.click(within(dialog).getByRole('button', { name: 'Add Field' }))
  expect(within(dialog).getByRole('list', { name: 'Custom fields' })).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))
  const fields = screen.getByRole('complementary', { name: 'Fields' })
  await user.click(within(fields).getByRole('button', { name: 'Big Campaigns, add' }))
  await user.click(within(screen.getByRole('region', { name: 'Order' })).getByRole('button', { expanded: false }))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Top' }), '3')
  await vi.waitFor(() => {
    const body = calls.filter((call) => call.url.endsWith('/insights/reports/preview/')).at(-1)?.body as { definition: ReportDefinition } | undefined
    expect(body?.definition.derived?.[0]).toMatchObject({ key: 'c_big_campaigns', kind: 'group', field: 'campaign_name', groups: [{ label: 'Big', values: ['Fall Launch', 'Weekly Newsletter'] }] })
    expect(body?.definition.columns.some((c) => c.field === 'c_big_campaigns')).toBe(true)
    expect(body?.definition.top).toEqual({ n: 3, others: true })
  })
})

test('a pivot drills: a row label asks for the level below, keeping the levels under it', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await user.click(await screen.findByRole('radio', { name: 'Pivot' }, { timeout: 5000 }))
  await user.click(screen.getByRole('button', { name: /^Across: / }))
  await user.click(screen.getByRole('option', { name: 'Channel' }))
  await user.click(await screen.findByRole('button', { name: 'Fall Launch' }))
  await vi.waitFor(() => {
    const drilled = calls.filter((call) => call.url.endsWith('/insights/reports/rep-1/run/')).map((call) => (call.body as { drill?: unknown }).drill).filter(Boolean).at(-1)
    expect(drilled).toEqual({ path: [{ field: 'campaign_name', value: 'Fall Launch' }], keep_rest: true })
  })
})

test('pages: the first extra page turns the rows into page 1; renaming and removing work; the last page left turns back into rows', async () => {
  const { addPage, pagesOf, removePage, renamePage, setPageRows } = await import('./dashboards/pages')
  const { tiles } = await import('./dashboards/layout')
  const one = { rows: [{ width: '2' as const, tiles: [{ id: 't1', report_id: 'rep-1', show: 'grid' as const }] }] }
  const added = addPage(one)
  expect(added.pageId).toBe('p2')
  expect(pagesOf(added.layout).map((p) => [p.id, p.title, p.rows.length])).toEqual([['p1', 'Page 1', 1], ['p2', 'Page 2', 0]])
  const page2 = pagesOf(added.layout)[1]
  const withTile = setPageRows(added.layout, 'p2', [...page2.rows, { width: '2', tiles: [{ id: 't2', report_id: 'rep-1', show: 'chart' }] }])
  expect(tiles(withTile).map((t) => t.id)).toEqual(['t1', 't2'])                          // ids stay unique across pages
  expect(pagesOf(renamePage(withTile, 'p2', 'Trends'))[1].title).toBe('Trends')
  const back = removePage(withTile, 'p2')
  expect(back.pages).toBeUndefined()
  expect(back.rows[0].tiles[0].id).toBe('t1')
})

test('a range slicer on a number: added in the editor, then From and To narrow the tiles', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' }, { timeout: 5000 })
  await user.click(screen.getByRole('button', { name: 'Slicers · 1' }))
  const editor = screen.getByRole('group', { name: 'Slicers' })
  await user.click(within(editor).getByRole('button', { name: 'Add Slicer' }))
  await user.selectOptions(await within(editor).findByRole('combobox', { name: 'Slicer field' }), 'sent')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  const put = calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/insights/dashboards/dash-1/')).at(-1)?.body as { layout: { slicers: unknown[] } }
  expect(put.layout.slicers).toContainEqual({ field: 'sent', label: 'Sent Count', kind: 'range', type: 'number' })
  const bar = await screen.findByRole('group', { name: 'Slicers' })
  await user.click(within(bar).getByRole('button', { name: 'Sent Count' }))
  await user.type(await screen.findByRole('spinbutton', { name: 'Sent Count from' }), '100')
  await user.type(screen.getByRole('spinbutton', { name: 'Sent Count to' }), '500')
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(within(bar).getByRole('button', { name: 'Sent Count: 100 to 500' })).toBeTruthy()
  await vi.waitFor(() => {
    const run = calls.filter((call) => call.url.endsWith('/tiles/t1/run/')).at(-1)?.body as { slicers?: unknown }
    expect(run.slicers).toEqual({ sent: { from: 100, to: 500 } })
  })
})

test('saved views: the slicer picks are saved under a name, and picking the view later brings them back', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1')
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  const slicers = await screen.findByRole('group', { name: 'Slicers' })
  await user.click(within(slicers).getByRole('button', { name: 'Channel' }))
  await user.click(within(await screen.findByRole('listbox', { name: 'Channel' })).getByRole('option', { name: 'SMS' }))
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  await user.click(screen.getByRole('button', { name: 'View: Default' }))
  await user.click(await screen.findByRole('button', { name: 'Save the Current View' }))
  const dialog = await screen.findByRole('dialog', { name: 'Save the Current View' })
  await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Text only')
  await user.click(within(dialog).getByRole('checkbox', { name: 'Share with everyone who opens this dashboard' }))
  await user.click(within(dialog).getByRole('button', { name: 'Save View' }))
  await screen.findByRole('button', { name: 'View: Text only' })
  const posted = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/insights/dashboards/dash-1/views/')).at(-1)?.body as { name: string; shared: boolean; state: { selection: unknown } }
  expect(posted).toMatchObject({ name: 'Text only', shared: true, state: { selection: { channel: ['SMS'] } } })
  await user.click(within(slicers).getByRole('button', { name: 'Clear' }))
  await vi.waitFor(() => expect(within(slicers).getByRole('button', { name: 'Channel' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'View: Text only' }))
  await user.click(await screen.findByRole('button', { name: /^Text only/ }))
  await vi.waitFor(() => expect(within(slicers).getByRole('button', { name: 'Channel: SMS' })).toBeTruthy())
})
