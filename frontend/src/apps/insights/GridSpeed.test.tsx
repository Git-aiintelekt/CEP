/** Grids paged 20 rows at a time, a kept result with Refresh, and the filters a report asks (docs/mockups/grid-paging-and-speed.html,
 * option A): One Day or a Date Range, and a default of the latest (the newest campaign, its last send day). */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsCatalog, insightsResult, insightsRunExtras, installMockApi, me, signIn } from '@/test/mockApi'
import type { CatalogDataset, ReportParameter, RunResult } from './types'

const withInsights = { ...me, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }
const many = (n: number) => Array.from({ length: n }, (_, i) => [`Campaign ${String(i + 1).padStart(2, '0')}`, 'SMS', 1000 + i, 900 + i])

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function withQueries(node: React.ReactNode) {
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>)
}

test('a grid of more than 20 rows is paged under it: Previous, the pages, Next and rows per page, remembered; 20 rows or fewer have no pager', async () => {
  const { ResultGrid } = await import('./components/ResultGrid')
  const result: RunResult = { ...insightsResult, rows: many(45), row_count: 45 } as RunResult
  render(<ResultGrid result={result} />)
  const pages = screen.getByRole('navigation', { name: 'Pages' })
  expect(within(pages).getByText('Rows 1–20 of 45')).toBeTruthy()
  expect((within(pages).getByRole('button', { name: '‹ Previous' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(pages).getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page')
  await userEvent.click(within(pages).getByRole('button', { name: 'Next ›' }))
  expect(await within(pages).findByText('Rows 21–40 of 45')).toBeTruthy()
  await userEvent.click(within(pages).getByRole('button', { name: 'Page 3' }))
  expect(await within(pages).findByText('Rows 41–45 of 45')).toBeTruthy()
  expect((within(pages).getByRole('button', { name: 'Next ›' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(within(pages).getByRole('combobox', { name: 'Rows per page' }), { target: { value: '50' } })
  expect(await within(pages).findByText('Rows 1–45 of 45')).toBeTruthy()
  expect(window.localStorage.getItem('insights.grid.rows')).toBe('50')
  cleanup()
  render(<ResultGrid result={{ ...result, rows: many(14), row_count: 14 }} />)
  expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
})

test('the viewer says when a kept result ran, and Refresh runs the report again', async () => {
  const calls = installMockApi({ me: withInsights as never })
  Object.assign(insightsRunExtras, { cached: true, ran_at: '2026-10-24T10:42:00Z', duration_ms: 32_904, source: 'Citi-TT-Analysis DB 8.0', kept_s: 900 })
  signIn('/insights/reports/rep-1')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  const refresh = await screen.findByRole('button', { name: 'Refresh' })
  expect(await screen.findByText(/32\.9 s · live from Citi-TT-Analysis DB 8\.0 · kept from/)).toBeTruthy()
  await userEvent.click(refresh)
  expect(calls.filter((call) => call.url.endsWith('/insights/reports/rep-1/run/')).at(-1)?.body).toMatchObject({ fresh: true })
})

test('the filters: a campaign that defaults to the latest says which it was, and a send date is One Day or a Date Range', async () => {
  installMockApi({ me: withInsights as never })
  const { ParameterBar } = await import('./components/ParameterBar')
  const messages = insightsCatalog.datasets[0] as unknown as CatalogDataset
  const parameters: ReportParameter[] = [
    { key: 'channel', label: 'SMS Campaign', field: 'channel', operator: 'in', required: true, default: { latest: true } },
    { key: 'sent', label: 'Send Date', field: 'submitted_at', operator: 'between', required: false, default: { latest: true } },
  ]
  const onRun = vi.fn()
  await withQueries(<ParameterBar dataset="messages" fields={messages.fields} parameters={parameters} values={{}} onRun={onRun}
    used={[{ key: 'channel', label: 'SMS Campaign', value: ['SMS'], latest: true }, { key: 'sent', label: 'Send Date', value: ['2026-10-22', '2026-10-22'], latest: true }]} />)
  const campaign = await screen.findByRole('button', { name: 'SMS Campaign: Latest (SMS)' })
  expect(screen.getByRole('button', { name: 'Send Date: Latest (2026-10-22)' })).toBeTruthy()
  expect(onRun).not.toHaveBeenCalled()                                                         // the latest already answers it
  await userEvent.click(campaign)
  await userEvent.click(await screen.findByRole('option', { name: 'EMAIL' }))
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onRun).toHaveBeenLastCalledWith({ channel: ['EMAIL'] })                              // a change runs at once
  const day = screen.getByRole('button', { name: 'Send Date: Any Day' })                     // picked by hand: the latest send day no longer applies

  await userEvent.click(day)
  fireEvent.change(screen.getByLabelText('Send Date'), { target: { value: '2026-10-20' } })
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onRun).toHaveBeenLastCalledWith({ channel: ['EMAIL'], sent: ['2026-10-20', '2026-10-20'] })
  await userEvent.click(screen.getByRole('button', { name: 'Send Date: 2026-10-20' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Date Range' }))
  fireEvent.change(screen.getByLabelText('Send Date to'), { target: { value: '2026-10-23' } })
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onRun).toHaveBeenLastCalledWith({ channel: ['EMAIL'], sent: ['2026-10-20', '2026-10-23'] })
  expect(screen.getByRole('button', { name: 'Send Date: 2026-10-20 to 2026-10-23' })).toBeTruthy()
})

test('a parameter can default to the latest when its dataset has a time field', async () => {
  const { ParametersDialog } = await import('./editor/ParametersDialog')
  const messages = insightsCatalog.datasets[0] as unknown as CatalogDataset
  const onApply = vi.fn()
  render(<ParametersDialog dataset={messages} parameters={[{ key: 'campaign', label: 'Campaign', field: 'campaign_name', operator: 'in', required: false }]} onApply={onApply} onClose={() => undefined} />)
  await userEvent.click(screen.getByRole('checkbox', { name: 'Default to the Latest' }))
  expect((screen.getByRole('textbox', { name: 'Parameter 1 default' }) as HTMLInputElement).disabled).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onApply.mock.calls[0][0][0].default).toEqual({ latest: true })
})

test('Period: a drop-down of spans, 7 days by default; Custom shows two dates; it is always asked and the editor keeps it at the top', async () => {
  installMockApi({ me: withInsights as never })
  const { ParameterBar } = await import('./components/ParameterBar')
  const messages = insightsCatalog.datasets[0] as unknown as CatalogDataset
  const period: ReportParameter = { key: 'period', label: 'Period', field: 'submitted_at', operator: 'period', required: true, default: '7d' }
  const onRun = vi.fn()
  await withQueries(<ParameterBar dataset="messages" fields={messages.fields} parameters={[period]} values={{}} onRun={onRun} />)
  await userEvent.click(screen.getByRole('button', { name: 'Period: Last 7 Days' }))
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Last 7 Days', 'Last 15 Days', 'Last 30 Days', 'Last Quarter', 'Last Half Year', 'Last Year', 'Custom Range'])
  expect(screen.getByText(/ to .*\d{4}$/)).toBeTruthy()                                         // the days it covers, both years
  await userEvent.click(screen.getByRole('option', { name: 'Last Quarter' }))
  expect(onRun).toHaveBeenLastCalledWith({ period: 'quarter' })
  await userEvent.click(screen.getByRole('button', { name: 'Period: Last Quarter' }))
  await userEvent.click(screen.getByRole('option', { name: 'Custom Range' }))
  expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)      // two dates first
  fireEvent.change(screen.getByLabelText('Period from'), { target: { value: '2026-09-01' } })
  fireEvent.change(screen.getByLabelText('Period to'), { target: { value: '2026-09-30' } })
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onRun).toHaveBeenLastCalledWith({ period: ['2026-09-01', '2026-09-30'] })
  expect(screen.getByRole('button', { name: /^Period: .*2026 to .*2026$/ })).toBeTruthy()
  cleanup()

  const { ParametersDialog } = await import('./editor/ParametersDialog')
  const onApply = vi.fn()
  render(<ParametersDialog dataset={messages} parameters={[period, { key: 'store', label: 'Store', field: 'campaign_name', operator: 'in', required: false }]} onApply={onApply} onClose={() => undefined} />)
  expect(screen.getByRole('dialog', { name: 'Viewer Filters' })).toBeTruthy()
  const locked = screen.getByRole('listitem', { name: 'Period' })
  expect(within(locked).getByText('Always asked')).toBeTruthy()
  expect(within(locked).queryByRole('button', { name: /Remove/ })).toBeNull()
  fireEvent.change(within(locked).getByRole('combobox', { name: 'Parameter 1 default' }), { target: { value: '30d' } })
  expect(screen.getByRole('button', { name: 'Add Filter' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onApply.mock.calls[0][0][0]).toMatchObject({ key: 'period', operator: 'period', default: '30d' })
})

test('filter chips: an optional answer brings Clear Filters, which puts the defaults back and runs; Updating… shows while it runs', async () => {
  installMockApi({ me: withInsights as never })
  const { ParameterBar } = await import('./components/ParameterBar')
  const messages = insightsCatalog.datasets[0] as unknown as CatalogDataset
  const parameters: ReportParameter[] = [
    { key: 'period', label: 'Period', field: 'submitted_at', operator: 'period', required: true, default: '30d' },
    { key: 'channel', label: 'Channel', field: 'channel', operator: 'in', required: false },
  ]
  const onRun = vi.fn()
  await withQueries(<ParameterBar dataset="messages" fields={messages.fields} parameters={parameters} values={{}} onRun={onRun} />)
  expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull()
  expect(screen.queryByText('Updating…')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Channel' }))
  await userEvent.click(await screen.findByRole('option', { name: 'SMS' }))
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onRun).toHaveBeenLastCalledWith({ period: '30d', channel: ['SMS'] })
  expect(screen.getByRole('button', { name: 'Channel: SMS' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))
  expect(onRun).toHaveBeenLastCalledWith({ period: '30d' })
  expect(screen.getByRole('button', { name: 'Channel' })).toBeTruthy()
  cleanup()

  await withQueries(<ParameterBar dataset="messages" fields={messages.fields} parameters={parameters} values={{}} onRun={onRun} running />)
  expect(screen.getByText('Updating…')).toBeTruthy()
})
