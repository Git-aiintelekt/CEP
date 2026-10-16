/** Insights: the Reports list grouped by component, New Report from a dataset, the viewer's grid, and how the shell offers Insights. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, insightsCatalog, me, signIn } from '@/test/mockApi'
import { starterDefinition } from './starter'

const withInsights = { ...me, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string, meOverride: object = withInsights) {
  const calls = installMockApi({ me: meOverride as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

const nav = () => screen.getByRole('navigation', { name: 'Main' })

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the starter definition: a dataset’s first dimensions, then every measure totalled, sorted by the first measure', () => {
  const definition = starterDefinition(insightsCatalog.datasets[0] as never)
  expect(definition.columns).toEqual([{ field: 'campaign_name' }, { field: 'channel' }, { field: 'sent', aggregate: 'sum' }, { field: 'delivered', aggregate: 'sum' }])
  expect(definition.orderBy).toEqual([{ field: 'sent', direction: 'desc' }])
})

test('with Insights on the workspace, Engagement’s menu offers it and the launcher lists it; the list shows the reports grouped by component', async () => {
  await renderAppAt('/insights/reports')
  await screen.findByRole('navigation', { name: 'Main' })
  const table = await screen.findByRole('table', { name: 'Reports' })
  expect(within(table).getByText('Engagement')).toBeTruthy()                            // the group row
  expect(within(table).getByRole('link', { name: 'Sends by campaign' })).toBeTruthy()
  expect(within(table).getByText('Messages')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'All Reports' })).toBeTruthy()
  // the shell: the navigation is Insights' own menu here, and the launcher offers both components
  expect(within(nav()).getByRole('list', { name: 'Insights' })).toBeTruthy()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Apps' }))
  const apps = await screen.findByRole('region', { name: 'Apps' })
  expect(within(apps).getAllByRole('link').map((tile) => tile.textContent)).toEqual(['Engagement', 'Insights'])
})

test('Engagement’s menu carries Insights in the integrated mode, not in the standalone mode, and never without the component', async () => {
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  expect(within(nav()).getByRole('link', { name: 'Insights' }).getAttribute('href')).toBe('/insights/reports?component=cep')
  cleanup()
  await renderAppAt('/campaigns', { ...withInsights, insights: { mode: 'standalone', standalone_path: '/insights' } })
  await screen.findByRole('navigation', { name: 'Main' })
  expect(within(nav()).queryByRole('link', { name: 'Insights' })).toBeNull()
  cleanup()
  await renderAppAt('/campaigns', me)
  await screen.findByRole('navigation', { name: 'Main' })
  expect(within(nav()).queryByRole('link', { name: 'Insights' })).toBeNull()
})

test('New Report: pick a dataset, name it, and the report opens in the viewer with its rows in the grid', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/new?component=cep')
  await screen.findByRole('heading', { name: 'New Report' })
  const create = await screen.findByRole('button', { name: 'Create Report' })
  expect((create as HTMLButtonElement).disabled).toBe(true)                            // nothing picked yet
  await user.click(screen.getByRole('radio', { name: /Attributed Orders/ }))
  await user.type(screen.getByLabelText('Name'), 'Revenue by campaign')
  await user.click(create)
  // the new report opens in the editor, named, with its rows previewed
  const nameBox = await screen.findByRole('textbox', { name: 'Report name' })
  expect((nameBox as HTMLInputElement).value).toBe('Revenue by campaign')
  const grid = await screen.findByRole('region', { name: 'Preview rows' })
  await vi.waitFor(() => expect(within(grid).getByText('Fall Launch')).toBeTruthy())
})

test('the viewer runs a saved report in the grid, with Edit and the two exports; Export Excel fetches the workbook', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  const grid = await screen.findByRole('region', { name: 'Report rows' })
  await vi.waitFor(() => expect(within(grid).getByText('Fall Launch')).toBeTruthy())
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Export PDF' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
  expect(screen.getByText(/3 rows · 42 ms · live data/)).toBeTruthy()
  const urls: string[] = []
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => { urls.push(blob.type); return 'blob:x' }, revokeObjectURL: () => undefined }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  await user.click(screen.getByRole('button', { name: 'Export Excel' }))
  await vi.waitFor(() => expect(urls).toEqual(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']))
  click.mockRestore()
})

test('the viewer switches the views: a pivot with totals on both edges, a hierarchy that folds, a chart', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await screen.findByRole('region', { name: 'Report rows' })
  await user.click(screen.getByRole('radio', { name: 'Pivot' }))
  expect(screen.getByText('A pivot needs a dimension to spread across the columns: put one in Columns, such as Sent by Month.')).toBeTruthy()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Across' }), 'channel')
  const pivot = screen.getByRole('region', { name: 'Report rows' })
  expect(within(pivot).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Campaign', 'EMAIL', 'SMS', 'Total'])
  const total = within(pivot).getAllByRole('row').at(-1) as HTMLElement
  expect(within(total).getAllByRole('cell').map((td) => td.textContent)).toEqual(['Total', '343,800', '25,100', '368,900'])
  const asked = calls.filter((call) => call.url.endsWith('/insights/reports/rep-1/run/')).map((call) => (call.body as { view?: { type: string; across?: string } } | null)?.view)
  expect(asked.at(-1)).toEqual({ type: 'pivot', across: 'channel' })                   // the engine totals for the view shown
  await user.click(screen.getByRole('radio', { name: 'Hierarchy' }))
  const tree = screen.getByRole('region', { name: 'Report rows' })
  const fall = within(tree).getByRole('button', { name: /Fall Launch/ })
  expect(fall.getAttribute('aria-expanded')).toBe('true')
  expect(within(tree).getAllByRole('row').length).toBe(1 + 6 + 1)                   // the header, three campaigns each with one channel, the total
  await user.click(fall)
  expect(within(tree).getAllByRole('row').length).toBe(1 + 5 + 1)
  await user.click(screen.getByRole('radio', { name: 'Chart' }))
  expect(screen.getByRole('group', { name: 'Sent Count by Campaign' })).toBeTruthy()
})

test('a reader without the right to personal data sees the PII column masked, named above the grid', async () => {
  const reader = { ...withInsights, principal: { ...withInsights.principal, permissions: withInsights.principal.permissions.filter((p) => p !== 'user.admin') } }
  await renderAppAt('/insights/reports/rep-1', reader)
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  const grid = await screen.findByRole('region', { name: 'Report rows' })
  await vi.waitFor(() => expect(within(grid).getByText('Customer (masked)')).toBeTruthy())
  expect(within(grid).getAllByText('•••••').length).toBe(3)
  expect(screen.getByRole('note').textContent).toBe('Customer is masked: personal data needs the report administration right.')
})

test('the viewer: the owner can delete, and the list no longer shows the report', async () => {
  const user = userEvent.setup()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await screen.findByRole('heading', { name: 'All Reports' })
  await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Sends by campaign' })).toBeNull())
})

test('the editor, field wells: a click adds a field to its well, a measure gets its calculation, the preview runs, Save writes a version', async () => {
  const user = userEvent.setup()
  window.localStorage.setItem('insights.editor', 'wells')
  await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  const fields = screen.getByRole('complementary', { name: 'Fields' })
  expect(within(fields).getByRole('button', { name: 'Campaign, in use' })).toBeTruthy()
  await user.click(within(fields).getByRole('button', { name: 'Sent, add' }))
  const rows = screen.getByRole('region', { name: 'Rows' })
  expect(within(rows).getByRole('combobox', { name: 'Sent bucket' })).toBeTruthy()
  const values = screen.getByRole('region', { name: 'Values' })
  expect(within(values).getByRole('combobox', { name: 'Sent Count calculation' })).toBeTruthy()
  await screen.findByRole('region', { name: 'Preview rows' })
  const save = screen.getByRole('button', { name: 'Save' })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  await user.click(save)
  await screen.findAllByText(/version 3/)                                              // the header and the toast both say it
})

test('the editor, steps: Summarize and Group By take fields from their pickers, the result sits under the steps, and the choice of editor is remembered', async () => {
  const user = userEvent.setup()
  window.localStorage.setItem('insights.editor', 'steps')
  await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  const groupBy = screen.getByRole('region', { name: '4 Group By' })
  await user.click(within(groupBy).getByRole('button', { name: 'Add Grouping' }))
  await user.click(await screen.findByRole('button', { name: 'Sent' }))
  expect(within(groupBy).getByRole('combobox', { name: 'Sent bucket' })).toBeTruthy()
  const summarize = screen.getByRole('region', { name: '3 Summarize' })
  expect(within(summarize).getByRole('combobox', { name: 'Sent Count calculation' })).toBeTruthy()
  expect(within(summarize).getByRole('button', { name: 'Add Value' })).toBeTruthy()
  await screen.findByRole('region', { name: 'Preview rows' })
  await user.click(screen.getByRole('radio', { name: 'Field Wells' }))
  expect(window.localStorage.getItem('insights.editor')).toBe('wells')
  expect(screen.getByRole('complementary', { name: 'Fields' })).toBeTruthy()
})
