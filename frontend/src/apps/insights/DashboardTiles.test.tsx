/** A dashboard's tiles (docs/mockups/dashboards.html, phase D3): the line saying what a tile reads, its ⋯, and a busy workspace tried again. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'
import { toCsv, tileTable } from './dashboards/tileExport'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string, busyFor = 0) {
  installMockApi({ me: withInsights as never })
  if (busyFor > 0) {
    const real = globalThis.fetch
    let left = busyFor
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/tiles/t2/run/') && left > 0) {
        left -= 1
        return Promise.resolve(new Response(JSON.stringify({ kind: 'refused', outcome: 'REFUSED', detail: 'Insights is busy with 4 reports for this workspace. Try again in a moment.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return real(input, init)
    })
  }
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

test('a tile says what it reads instead of its kind: a chart that filters the others; a figure named after its report says it once', async () => {
  await renderAppAt('/insights/dashboards/dash-1')
  const chart = await screen.findByRole('region', { name: 'Sends by Campaign' })
  await vi.waitFor(() => expect(within(chart).getByText('Click a bar to filter the other tiles')).toBeTruthy())
  expect(within(chart).queryByText('Chart')).toBeNull()
  const figure = screen.getByRole('region', { name: 'Sends by campaign' })
  await vi.waitFor(() => expect(within(figure).getByText('391,520')).toBeTruthy())
  expect(within(figure).getAllByText('Sends by campaign')).toHaveLength(1)                 // the title is the report's name: not said twice
  expect(within(figure).queryByText('Figure')).toBeNull()
})

test('a tile\'s ⋯: Open the Report, Show the Numbers, Export CSV and Comment', async () => {
  const user = userEvent.setup()
  const made = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tile')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  await renderAppAt('/insights/dashboards/dash-1')
  const figure = await screen.findByRole('region', { name: 'Sends by campaign' })
  await vi.waitFor(() => expect(within(figure).getByText('391,520')).toBeTruthy())

  await user.click(within(figure).getByRole('button', { name: 'Actions for Sends by campaign' }))
  const menu = screen.getByRole('menu', { name: 'Actions for Sends by campaign' })
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open the Report', 'Show the Numbers', 'Export CSV', 'Comment'])
  await user.click(within(menu).getByRole('menuitem', { name: 'Show the Numbers' }))
  const dialog = await screen.findByRole('dialog', { name: 'Sends by campaign' })
  expect(within(dialog).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Sent Count', 'Sent Count, Previous Period'])
  await user.click(within(dialog).getByRole('button', { name: /Close/ }))

  await user.click(within(figure).getByRole('button', { name: 'Actions for Sends by campaign' }))
  await user.click(screen.getByRole('menuitem', { name: 'Export CSV' }))
  expect(made).toHaveBeenCalledTimes(1)

  await user.click(within(figure).getByRole('button', { name: 'Actions for Sends by campaign' }))
  await user.click(screen.getByRole('menuitem', { name: 'Comment' }))
  expect(await screen.findByRole('dialog', { name: /Comments/ })).toBeTruthy()

  await user.keyboard('{Escape}')
  await user.click(within(figure).getByRole('button', { name: 'Actions for Sends by campaign' }))
  await user.click(screen.getByRole('menuitem', { name: 'Open the Report' }))
  await vi.waitFor(() => expect(window.location.pathname).toBe('/insights/reports/rep-1'))
})

test('a run refused because the workspace is busy is tried again, and the tile fills in', async () => {
  await renderAppAt('/insights/dashboards/dash-1', 1)
  const figure = await screen.findByRole('region', { name: 'Sends by campaign' })
  await vi.waitFor(() => expect(within(figure).getByText('391,520')).toBeTruthy(), { timeout: 5000 })
  expect(within(figure).queryByText(/is busy/)).toBeNull()
})

test('the CSV: a header of labels, values as they are, quotes where needed', () => {
  const table = tileTable({ kind: 'view', view: { type: 'grid' }, own_dates: false, bounds: { from: '2026-10-01', to: '2026-10-30', previous_from: '', previous_to: '' }, report: { id: 'r', name: 'R', version: 1 },
    result: { columns: [{ key: 'c', label: 'Campaign', type: 'string' }, { key: 's', label: 'Sent', type: 'number' }], rows: [['Fall, "Launch"', 1200], [null, 3]], row_count: 2, duration_ms: 1, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: false } } as never)
  expect(toCsv(table!)).toBe('Campaign,Sent\r\n"Fall, ""Launch""",1200\r\n,3')
})
