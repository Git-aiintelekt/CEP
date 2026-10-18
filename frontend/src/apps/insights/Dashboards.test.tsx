/** Insights dashboards: the list, a new dashboard into the editor, Add Tile, Done into the viewer, the period switch and the figure's change, the slicers and the cross-filter. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'
import { addTile, moveTile, periodBounds, removeTile, setRowWidth } from './dashboards/layout'
import type { DashboardLayout } from './types'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string) {
  installMockApi({ me: withInsights as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the layout helpers: a tile lands in the last row with room, a narrower row sheds its overflow to a new row, tiles move within their row', () => {
  let layout: DashboardLayout = { rows: [] }
  layout = addTile(layout, { report_id: 'rep-1', show: 'figure', measure: 'sent' })
  expect(layout.rows).toEqual([{ width: '4', tiles: [{ id: 't1', report_id: 'rep-1', show: 'figure', measure: 'sent' }] }])
  layout = addTile(layout, { report_id: 'rep-1', show: 'chart' })
  expect(layout.rows[0].tiles.map((t) => t.id)).toEqual(['t1', 't2'])
  layout = setRowWidth(layout, 0, '1')
  expect(layout.rows.map((row) => [row.width, row.tiles.map((t) => t.id)])).toEqual([['1', ['t1']], ['4', ['t2']]])
  layout = setRowWidth(layout, 0, '2')
  layout = addTile(layout, { report_id: 'rep-1', show: 'grid' })                        // the last row (four across) has room
  expect(layout.rows[1].tiles.map((t) => t.id)).toEqual(['t2', 't3'])
  layout = moveTile(layout, 't3', -1)
  expect(layout.rows[1].tiles.map((t) => t.id)).toEqual(['t3', 't2'])
  layout = removeTile(removeTile(layout, 't3'), 't2')
  expect(layout.rows).toEqual([{ width: '2', tiles: [{ id: 't1', report_id: 'rep-1', show: 'figure', measure: 'sent' }] }])
  expect(periodBounds({ preset: 'month' }, new Date('2026-10-15T12:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-15', previous_from: '2026-09-16', previous_to: '2026-09-30' })
  expect(periodBounds({ preset: '7d' }, new Date('2026-10-15T12:00:00Z')).from).toBe('2026-10-09')
})

test('the list shows the dashboards; the viewer runs the tiles on the period, a figure with its change, and the period can be switched', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards')
  const table = await screen.findByRole('table', { name: 'Dashboards' })
  expect(within(table).getByRole('link', { name: 'Marketing Weekly' })).toBeTruthy()
  expect(within(table).getByText('Workspace')).toBeTruthy()
  await user.click(within(table).getByRole('link', { name: 'Marketing Weekly' }))
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  expect(screen.getByRole('button', { name: 'Export PDF' })).toBeTruthy()
  const figure = await screen.findByRole('region', { name: 'Sends by campaign' })
  await vi.waitFor(() => expect(within(figure).getByText('391,520')).toBeTruthy())
  expect(within(figure).getByText('▲ 8.4% vs previous')).toBeTruthy()
  const chart = screen.getByRole('region', { name: 'Sends by Campaign' })
  await vi.waitFor(() => expect(within(chart).getByRole('group', { name: 'Sent Count by Campaign' })).toBeTruthy())
  const saved = /Sep 16 – Oct 15, 2026|16 Sep – 15 Oct 2026/                          // the locale decides the order
  expect(screen.getByText(saved)).toBeTruthy()
  await user.click(screen.getByRole('radio', { name: '7 Days' }))
  await vi.waitFor(() => expect(screen.queryByText(saved)).toBeNull())            // the bar now says the last seven days
})

test('a dashboard is scheduled as PDF only; the schedule shows under its title', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1')
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  await user.click(await screen.findByRole('button', { name: 'Schedule' }))
  const dialog = await screen.findByRole('dialog', { name: 'Schedule' })
  expect((within(dialog).getByRole('radio', { name: /^PDF/ }) as HTMLInputElement).checked).toBe(true)
  expect((within(dialog).getByRole('radio', { name: /^Excel/ }) as HTMLInputElement).disabled).toBe(true)
  await user.type(within(dialog).getByRole('textbox', { name: 'To' }), 'ops@northwind.example{Enter}')
  await user.click(within(dialog).getByRole('button', { name: 'Schedule' }))
  const banner = await screen.findByRole('status', { name: 'Schedule' })
  expect(banner.textContent).toContain('to 1 person as PDF')
})

test('New Dashboard opens the editor; Add Tile puts a report on it as a figure; Done saves and the viewer shows it', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards')
  await screen.findByRole('table', { name: 'Dashboards' })
  await user.click(screen.getByRole('button', { name: 'New Dashboard' }))
  const nameBox = await screen.findByRole('textbox', { name: 'Dashboard name' })
  expect((nameBox as HTMLInputElement).value).toBe('Untitled Dashboard')
  await user.clear(nameBox)
  await user.type(nameBox, 'Revenue by Channel')
  await user.click(screen.getByRole('button', { name: 'Add Tile' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Tile' })
  await user.click(await within(dialog).findByRole('button', { name: /Sends by campaign/ }))
  await user.click(await within(dialog).findByRole('radio', { name: /Sent Count/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Add to Dashboard' }))
  expect(screen.getByRole('combobox', { name: 'Row 1 width' })).toBeTruthy()
  const tile = await screen.findByRole('region', { name: 'Sends by campaign' })
  await vi.waitFor(() => expect(within(tile).getByText('391,520')).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Done' }))
  await screen.findByRole('heading', { name: 'Revenue by Channel' })
  expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
  expect(await screen.findByRole('region', { name: 'Sends by campaign' })).toBeTruthy()
})

test('a saved slicer is a chip under the period: picking a value narrows every tile, Clear undoes it, and a click on a bar cross-filters the rest for the visit', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1')
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  const chart = screen.getByRole('region', { name: 'Sends by Campaign' })
  await vi.waitFor(() => expect(within(chart).getByRole('group', { name: 'Sent Count by Campaign' })).toBeTruthy())
  expect(within(chart).getAllByText('Fall Launch').length).toBeGreaterThan(0)        // on the axis and in the numbers table
  const figure = screen.getByRole('region', { name: 'Sends by campaign' })
  await vi.waitFor(() => expect(within(figure).getByText('391,520')).toBeTruthy())

  const slicers = screen.getByRole('group', { name: 'Slicers' })
  await user.click(within(slicers).getByRole('button', { name: 'Channel' }))
  const menu = await screen.findByRole('listbox', { name: 'Channel' })
  await user.click(within(menu).getByRole('option', { name: 'SMS' }))
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(within(slicers).getByRole('button', { name: 'Channel: SMS' })).toBeTruthy()
  await vi.waitFor(() => expect(within(chart).queryAllByText('Fall Launch').length).toBe(0))   // the tiles ran again with the slicer
  expect(within(chart).getAllByText('Weekend Flash Sale').length).toBeGreaterThan(0)
  await vi.waitFor(() => expect(within(figure).getByText('25,100')).toBeTruthy())
  await user.click(within(slicers).getByRole('button', { name: 'Clear' }))
  await vi.waitFor(() => expect(within(chart).getAllByText('Fall Launch').length).toBeGreaterThan(0))

  fireEvent.click(within(chart).getByRole('group', { name: 'Sent Count by Campaign' }), { clientX: 700 })   // the last bar: Weekly Newsletter
  await vi.waitFor(() => expect(within(slicers).getByRole('button', { name: 'Campaign: Weekly Newsletter' })).toBeTruthy())
  await vi.waitFor(() => expect(within(figure).getByText('201,500')).toBeTruthy())
  await user.click(within(slicers).getByRole('button', { name: 'Remove the Campaign filter' }))
  await vi.waitFor(() => expect(within(figure).getByText('391,520')).toBeTruthy())
  expect(within(slicers).queryByRole('button', { name: /Campaign/ })).toBeNull()
})

test('the editor adds a slicer from the dimensions of the tiles\' datasets, removes one, and Done saves them with the layout', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' })
  const editor = screen.getByRole('group', { name: 'Slicers' })
  expect(within(editor).getByText('Channel')).toBeTruthy()
  await user.click(within(editor).getByRole('button', { name: 'Add Slicer' }))
  await user.selectOptions(await within(editor).findByRole('combobox', { name: 'Slicer field' }), 'campaign_name')
  expect(within(editor).getByText('Campaign')).toBeTruthy()
  await user.click(within(editor).getByRole('button', { name: 'Remove the Channel slicer' }))
  await user.click(screen.getByRole('button', { name: 'Done' }))
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  const slicers = await screen.findByRole('group', { name: 'Slicers' })
  expect(within(slicers).getByRole('button', { name: 'Campaign' })).toBeTruthy()
  expect(within(slicers).queryByRole('button', { name: 'Channel' })).toBeNull()
})

test('Drill Down on a chart tile: a click drills that tile instead of filtering the others, the path goes back up, and turning it off leaves the drill', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1')
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  const chart = screen.getByRole('region', { name: 'Sends by Campaign' })
  await vi.waitFor(() => expect(within(chart).getByRole('group', { name: 'Sent Count by Campaign' })).toBeTruthy())
  const figure = screen.getByRole('region', { name: 'Sends by campaign' })
  await vi.waitFor(() => expect(within(figure).getByText('391,520')).toBeTruthy())
  const toggle = within(chart).getByRole('button', { name: 'Drill Down' })
  await user.click(toggle)
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(within(chart).getByRole('group', { name: 'Sent Count by Campaign' }), { clientX: 80 })     // the first bar: Fall Launch
  const path = await within(chart).findByRole('navigation', { name: 'Drill path' })
  expect(within(path).getByText('Fall Launch')).toBeTruthy()
  await vi.waitFor(() => expect(within(chart).getByRole('group', { name: 'Sent Count by Channel' })).toBeTruthy())
  expect(within(figure).getByText('391,520')).toBeTruthy()                                                     // the other tiles were not filtered
  expect(within(screen.getByRole('group', { name: 'Slicers' })).queryByRole('button', { name: /Campaign/ })).toBeNull()
  await user.click(within(path).getByRole('button', { name: 'Campaign' }))
  await vi.waitFor(() => expect(within(chart).getByRole('group', { name: 'Sent Count by Campaign' })).toBeTruthy())
  await user.click(toggle)
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(within(chart).queryByText(/Click a value/)).toBeNull()
})
