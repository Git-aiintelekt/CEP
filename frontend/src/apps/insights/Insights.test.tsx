/** Insights: the Reports list, New Report from a dataset, the viewer's grid, and how the shell offers Insights. */
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
  expect(definition.columns).toEqual([{ field: 'campaign_name' }, { field: 'channel' }, { field: 'sent', aggregate: 'sum' }, { field: 'delivered', aggregate: 'sum' }, { field: 'delivered_rate', aggregate: 'calc' }])
  expect(definition.orderBy).toEqual([{ field: 'sent', direction: 'desc' }])
})

test('with Insights on the workspace, Engagement’s menu offers it and the launcher lists it; the list shows the reports', async () => {
  await renderAppAt('/insights/reports')
  await screen.findByRole('navigation', { name: 'Main' })
  const table = await screen.findByRole('table', { name: 'Reports' })
  expect(within(table).getByRole('link', { name: 'Sends by campaign' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Reports' })).toBeTruthy()
  // the shell: the navigation is Insights' own menu here, and the launcher offers both components
  expect(within(nav()).getByRole('list', { name: 'Insights' })).toBeTruthy()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Apps' }))
  const apps = await screen.findByRole('region', { name: 'Apps' })
  expect(within(apps).getAllByRole('link').map((tile) => tile.textContent)).toEqual(['Engagement', 'Insights'])
})

test('Insights is an app on the rail when the workspace has it, never an item in Engagement’s menu', async () => {
  const insightsTile = () => within(screen.getByRole('navigation', { name: 'Apps' })).queryByRole('link', { name: /^Insights/ })
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  expect(within(nav()).queryByRole('link', { name: 'Insights' })).toBeNull()
  expect(insightsTile()?.getAttribute('href')).toBe('/insights')
  cleanup()
  await renderAppAt('/campaigns', me)
  await screen.findByRole('navigation', { name: 'Main' })
  expect(insightsTile()).toBeNull()
})

test('New Report: name it, pick a dataset, and the report opens in the editor with its rows previewed', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/new?component=cep')
  const dialog = await screen.findByRole('dialog', { name: 'Create Report' })
  await user.type(within(dialog).getByLabelText('Report Name'), 'Revenue by campaign')                // step 1: the name, then how to start
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  const create = await within(dialog).findByRole('button', { name: 'Create Report' })
  expect((create as HTMLButtonElement).disabled).toBe(true)                            // nothing picked yet
  await user.click(await within(dialog).findByRole('radio', { name: 'Attributed Orders' }))
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
  await user.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 5000 }))
  const actions = screen.getByRole('menu', { name: 'More actions' })
  expect(within(actions).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Explain', 'Edit', 'Share', 'Comments', 'Alerts', 'Versions', 'Export CSV', 'Export Excel', 'Export PDF', 'Export PowerPoint', 'Print-Ready PDF', 'Embed on Another Site', 'Report Details', 'Help With Reports', 'Delete'])
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu', { name: 'More actions' })).toBeNull()
  expect(screen.getByText(/3 rows · 42 ms · live data/)).toBeTruthy()
  const urls: string[] = []
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => { urls.push(blob.type); return 'blob:x' }, revokeObjectURL: () => undefined }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  await user.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 5000 }))
  await user.click(screen.getByRole('menuitem', { name: 'Export Excel' }))
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
  await user.click(screen.getByRole('button', { name: /^Across: / }))
  await user.click(screen.getByRole('option', { name: 'Channel' }))
  const pivot = screen.getByRole('region', { name: 'Report rows' })
  expect(within(pivot).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Campaign', 'EMAIL', 'SMS', 'Total'])
  const total = within(pivot).getAllByRole('row').at(-1) as HTMLElement
  expect(within(total).getAllByRole('cell').map((td) => td.textContent)).toEqual(['Total', '343,800', '25,100', '368,900'])
  const asked = calls.filter((call) => call.url.endsWith('/insights/reports/rep-1/run/')).map((call) => (call.body as { view?: { type: string; across?: string } } | null)?.view)
  expect(asked.at(-1)).toEqual({ type: 'pivot', across: 'channel' })                   // the engine totals for the view shown
  await user.click(screen.getByRole('radio', { name: 'Hierarchy' }))
  const tree = screen.getByRole('region', { name: 'Report rows' })
  const fall = within(tree).getByRole('button', { name: /^Fall Launch/ })
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
  await user.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 5000 }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  await screen.findByRole('heading', { name: 'Reports' })
  await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Sends by campaign' })).toBeNull())
})
