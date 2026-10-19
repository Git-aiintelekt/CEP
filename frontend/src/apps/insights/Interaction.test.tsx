/** Dashboards and interaction: a free canvas with a theme, text tiles and buttons, a phone layout; threshold alerts; comments and
 * annotations; tooltip reports; PowerPoint and the print-ready PDF. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsAlertsNow, insightsCommentsNow, insightsDashboardsNow, installMockApi, me, signIn } from '@/test/mockApi'
import { ReportResult } from './components/ReportViews'
import { cellsToRows, phoneOrder, rowsToCells, setBox } from './dashboards/canvas'
import { containerOf, setContainer } from './dashboards/pages'
import { themeStyle } from './dashboards/themes'
import { TextTile } from './dashboards/WordTiles'
import type { DashboardCell, DashboardLayout, RunResult } from './types'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string, before?: () => void) {
  const calls = installMockApi({ me: withInsights as never })
  before?.()
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

test('the canvas: rows become places and back, a tile stays inside the twelve columns, a phone reads top to bottom without the hidden tiles', () => {
  const rows = [{ width: '2-1' as const, tiles: [{ id: 't1', report_id: 'r', show: 'chart' as const }, { id: 't2', report_id: 'r', show: 'figure' as const }] },
                { width: '1' as const, tiles: [{ id: 't3', report_id: '', show: 'text' as const, text: 'Hi' }] }]
  const cells = rowsToCells(rows)
  expect(cells.map((c) => [c.id, c.x, c.y, c.w, c.h])).toEqual([['t1', 0, 0, 8, 5], ['t2', 8, 0, 4, 2], ['t3', 0, 5, 12, 2]])
  expect(cellsToRows(cells).map((row) => [row.width, row.tiles.map((t) => t.id)])).toEqual([['3', ['t1', 't2', 't3']]])
  expect(setBox(cells, 't2', { x: 11, w: 4 }).find((c) => c.id === 't2')).toMatchObject({ x: 8, w: 4 })
  expect(setBox(cells, 't2', { w: 20 }).find((c) => c.id === 't2')).toMatchObject({ x: 0, w: 12 })
  const hidden: DashboardCell[] = cells.map((c) => (c.id === 't2' ? { ...c, hide_on_phone: true } : c))
  expect(phoneOrder(hidden).map((c) => c.id)).toEqual(['t1', 't3'])
  const layout: DashboardLayout = { rows, theme: 'navy' }
  const canvas = setContainer(layout, 'p1', { rows: [], canvas: true, cells })
  expect(canvas).toMatchObject({ rows: [], canvas: true, theme: 'navy' })
  expect(containerOf(canvas, 'p1').cells).toHaveLength(3)
  expect(themeStyle('navy')).toMatchObject({ '--color-chart-1': 'var(--color-wordmark-navy)', '--color-chart-pair': 'var(--color-wordmark-teal)' })
  expect(themeStyle('default')).toBeUndefined()
})

test('a text tile reads paragraphs, bullets and bold, never HTML', () => {
  render(<TextTile tile={{ id: 'n', report_id: '', show: 'text', title: 'Read Me', text: 'First **line** <b>not bold</b>\n\n- one\n- two' }} />)
  const tile = screen.getByRole('region', { name: 'Read Me' })
  expect(within(tile).getByText('line').tagName).toBe('STRONG')
  expect(within(tile).getByText(/<b>not bold<\/b>/)).toBeTruthy()
  expect(within(tile).getAllByRole('listitem')).toHaveLength(2)
})

test('a chart marks a comment on its value, and its tooltip report shows on hover', async () => {
  installMockApi({ me: withInsights as never })
  const result: RunResult = { row_count: 2, duration_ms: 5, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: false,
    columns: [{ key: 'campaign_name', label: 'Campaign', type: 'string', format: null }, { key: 'sent', label: 'Sent Count', type: 'number', format: 'integer', aggregate: 'sum' }],
    rows: [['Fall Launch', 1800], ['Weekly Newsletter', 900]] }
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportResult result={result} view={{ type: 'chart', chart: 'bar', tooltip: 'rep-1' }} notes={[{ field: 'campaign_name', value: 'Weekly Newsletter', label: 'A quiet week' }]} tooltips />
    </QueryClientProvider>,
  )
  expect(container.querySelector('[data-note="1"]')).toBeTruthy()
  expect(container.querySelector('[data-legend-note]')).toBeTruthy()
  const plot = container.querySelector('[data-chart-plot]') as HTMLElement
  plot.focus()
  await userEvent.keyboard('{ArrowRight}{ArrowRight}')
  await vi.waitFor(() => expect(container.querySelector('[data-tooltip-note]')?.textContent).toBe('Comment: A quiet week'))
  expect(await screen.findByRole('tooltip', undefined, { timeout: 3000 })).toBeTruthy()
})

test('the viewer: Alerts sets one on Sent Count and Check Now emails once; Comments pins a note; PowerPoint and Print-Ready PDF download', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await user.click(await screen.findByRole('button', { name: 'Alerts' }, { timeout: 5000 }))
  const dialog = await screen.findByRole('dialog', { name: 'Alerts' })
  const form = within(dialog).getByRole('form', { name: 'New alert' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Condition' }), '>')
  await user.type(within(form).getByRole('spinbutton', { name: 'Threshold' }), '400')
  await user.click(within(form).getByRole('button', { name: 'Set Alert' }))
  expect(await within(dialog).findByText(/When Sent Count rises above 400, checked every day at 08:00/)).toBeTruthy()
  const posted = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/insights/alerts/')).at(-1)?.body as Record<string, unknown>
  expect(posted).toMatchObject({ report_id: 'rep-1', measure: 'sent', op: '>', threshold: 400, every: 'day', at_time: '08:00', recipients: ['aby.john@aiintelekt.com'] })
  await user.click(within(dialog).getByRole('button', { name: 'Check Now' }))
  expect(await within(dialog).findByText('Crossed')).toBeTruthy()
  expect(insightsAlertsNow[0]).toMatchObject({ state: 'TRIGGERED' })
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))

  await user.click(screen.getByRole('button', { name: 'Comments' }))
  const drawer = await screen.findByRole('dialog', { name: 'Comments' })
  await user.type(within(drawer).getByRole('textbox', { name: 'New comment' }), 'Fall Launch carried September.')
  await user.click(within(drawer).getByRole('button', { name: 'Add Comment' }))
  expect(await within(drawer).findByText('Fall Launch carried September.')).toBeTruthy()
  await user.click(within(drawer).getByRole('button', { name: 'Resolve' }))
  expect(await within(drawer).findByRole('region', { name: 'Resolved comments' })).toBeTruthy()
  expect(insightsCommentsNow[0]).toMatchObject({ kind: 'report', item: 'rep-1', anchor: null })
  await user.click(within(drawer).getByRole('button', { name: 'Close' }))

  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Export PowerPoint' }))
  await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/insights/reports/rep-1/export.pptx'))).toBe(true))
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Print-Ready PDF' }))
  const print = await screen.findByRole('dialog', { name: 'Print-Ready PDF' })
  await user.selectOptions(within(print).getByRole('combobox', { name: 'Paper' }), 'letter')
  await user.selectOptions(within(print).getByRole('combobox', { name: 'Orientation' }), 'landscape')
  await user.click(within(print).getByRole('checkbox', { name: /A section per Campaign/ }))
  await user.click(within(print).getByRole('button', { name: 'Download PDF' }))
  await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/insights/reports/rep-1/export.pdf?layout=print&size=letter&orientation=landscape&group=1'))).toBe(true))
})

test('a dashboard on a canvas with a theme: a text tile, a button to another page, tile comments, and PowerPoint', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1', () => {
    insightsDashboardsNow[0] = { ...insightsDashboardsNow[0], layout: { rows: [], theme: 'earth', pages: [
      { id: 'p1', title: 'Overview', rows: [], canvas: true, cells: [
        { id: 't1', report_id: 'rep-1', show: 'grid', x: 0, y: 0, w: 8, h: 4 },
        { id: 'n1', report_id: '', show: 'text', title: 'Read Me', text: 'Sends for the **period** above.', x: 8, y: 0, w: 4, h: 2 },
        { id: 'b1', report_id: '', show: 'button', label: 'Go to Detail', action: { kind: 'page', id: 'p2' }, x: 8, y: 2, w: 4, h: 1 }] },
      { id: 'p2', title: 'Detail', rows: [{ width: '1', tiles: [{ id: 't9', report_id: 'rep-1', show: 'grid', title: 'All Sends' }] }] }] } }
  })
  await screen.findByRole('heading', { name: 'Marketing Weekly' }, { timeout: 5000 })
  expect(document.querySelector('[data-theme-name="earth"]')).toBeTruthy()
  expect(await screen.findByRole('region', { name: 'Read Me' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Go to Detail' }))
  expect(await screen.findByRole('region', { name: 'All Sends' }, { timeout: 5000 })).toBeTruthy()
  await user.click(screen.getByRole('tab', { name: 'Overview' }))
  await user.click(await screen.findByRole('button', { name: /^Comments on Read Me/ }))
  const drawer = await screen.findByRole('dialog', { name: 'Comments' })
  expect(within(drawer).getByText('On Read Me')).toBeTruthy()
  await user.type(within(drawer).getByRole('textbox', { name: 'New comment' }), 'Add the revenue line here.')
  await user.click(within(drawer).getByRole('button', { name: 'Add Comment' }))
  await vi.waitFor(() => expect(insightsCommentsNow[0]).toMatchObject({ kind: 'dashboard', anchor: { tile_id: 'n1' } }))
  await user.click(within(drawer).getByRole('button', { name: 'Close' }))
  expect(await screen.findByRole('button', { name: 'Comments on Read Me, 1' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Export PowerPoint' }))
  await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/insights/dashboards/dash-1/export.pptx'))).toBe(true))
})

test('the dashboard editor: Free Canvas turns the rows into places, Add Text and the theme save with the layout', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' }, { timeout: 5000 })
  await user.click(screen.getByRole('radio', { name: 'Free Canvas' }))
  expect((await screen.findAllByRole('button', { name: /^Move / })).length).toBeGreaterThan(0)
  await user.click(screen.getByRole('button', { name: 'Add Text' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Text' })
  await user.type(within(dialog).getByRole('textbox', { name: /^Title/ }), 'Read Me')
  await user.type(within(dialog).getByRole('textbox', { name: /^Text/ }), 'How to read this board.')
  await user.click(within(dialog).getByRole('button', { name: 'Add to Dashboard' }))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'berry')
  await user.click(screen.getByRole('button', { name: 'Phone Preview' }))
  expect(document.querySelector('[data-canvas="phone"]')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Done' }))
  await vi.waitFor(() => {
    const put = calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/insights/dashboards/dash-1/')).at(-1)?.body as { layout: DashboardLayout } | undefined
    expect(put?.layout).toMatchObject({ canvas: true, theme: 'berry' })
    expect(put?.layout.cells?.some((c) => c.show === 'text' && c.title === 'Read Me' && c.text === 'How to read this board.')).toBe(true)
  })
})
