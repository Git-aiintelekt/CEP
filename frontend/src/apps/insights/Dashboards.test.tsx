/** Insights dashboards: the list, a new dashboard into the editor, Add Tile, Done into the viewer, the period switch and the figure's change. */
import { cleanup, render, screen, within } from '@testing-library/react'
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
