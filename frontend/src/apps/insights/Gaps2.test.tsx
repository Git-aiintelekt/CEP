/** The smaller gaps, second part: chart signals, Show the SQL, Explain This Report, Change with a Prompt, linked measures, embed links, usage. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsOpenedNow, installMockApi, me, signIn } from '@/test/mockApi'
import { ReportResult } from './components/ReportViews'
import { anomalies, forecast, nextDates } from './components/signals'
import { setBlend } from './editor/definition'
import type { ReportDefinition, RunResult } from './types'

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

test('the signals: a straight-line forecast three periods on, flags far off the trend, and the next buckets', () => {
  expect(forecast([10, 20, 30, 40])).toEqual([NaN, NaN, NaN, 40, 50, 60, 70])
  expect(forecast([5, 4, 3, 2]).slice(-3)).toEqual([1, 0, 0])                       // a count does not forecast below nothing
  const flagged = anomalies([10, 11, 10, 12, 11, 60, 11, 12])
  expect(flagged.map((f) => [f.index, f.above])).toEqual([[5, true]])
  expect(anomalies([10, 11, 12])).toEqual([])                                        // too few points
  expect(nextDates('2026-11-01', 'month')).toEqual(['2026-12-01', '2027-01-01', '2027-02-01'])
  expect(nextDates('2026-09-28', 'week', 2)).toEqual(['2026-10-05', '2026-10-12'])
  expect(nextDates('2026-10-01', 'quarter', 1)).toEqual(['2027-01-01'])
})

test('a chart with Forecast and Flag Anomalies: the forecast as a dashed line in the legend, the unusual point ringed', () => {
  const months = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']
  const result: RunResult = { columns: [{ key: 'submitted_at', label: 'Sent', type: 'date', format: 'date', bucket: 'month' }, { key: 'sent', label: 'Sent Count', type: 'number', format: 'integer', aggregate: 'sum' }],
    rows: months.map((month, i) => [month, [100, 110, 105, 120, 115, 400, 125, 130][i]]), row_count: 8, duration_ms: 5, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: false }
  const { container } = render(<ReportResult result={result} view={{ type: 'chart', chart: 'line', signals: ['forecast', 'anomalies'] }} />)
  expect(container.querySelector('[data-legend-reference]')?.textContent).toBe('Forecast: Sent Count')
  expect(screen.getByText('Unusual Point')).toBeTruthy()
  expect(container.querySelector('[data-flag="5"]')).toBeTruthy()
  expect(container.querySelector('[data-reference="forecast"]')).toBeTruthy()
  expect(screen.getByText(/The forecast carries the straight-line trend of the last 8 months of Sent Count 3 months on/)).toBeTruthy()
  expect(screen.getByText(/1 point sits far off the trend of Sent Count/)).toBeTruthy()
})

test('a chart along a text field says signals need dates', () => {
  const result: RunResult = { columns: [{ key: 'channel', label: 'Channel', type: 'string', format: null }, { key: 'sent', label: 'Sent Count', type: 'number', format: 'integer', aggregate: 'sum' }],
    rows: [['EMAIL', 10], ['SMS', 4]], row_count: 2, duration_ms: 5, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: false }
  render(<ReportResult result={result} view={{ type: 'chart', chart: 'bar', signals: ['forecast'] }} />)
  expect(screen.getByText(/Forecasts and anomaly flags need dates along the bottom/)).toBeTruthy()
})

test('the viewer: opening is counted; Explain says what it means, then the AI reads the rows; More shows the SQL and makes an embed link', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await vi.waitFor(() => expect(insightsOpenedNow).toContainEqual({ kind: 'report', id: 'rep-1' }))
  await user.click(await screen.findByRole('button', { name: 'Explain' }, { timeout: 5000 }))
  const explained = await screen.findByRole('region', { name: 'Explanation' })
  expect(await within(explained).findByText('Sent Count: 2,000.')).toBeTruthy()                 // What This Means first: rules, no prompt
  expect(calls.some((call) => call.url.endsWith('/insights/reports/rep-1/explain/'))).toBe(false)
  await user.click(within(explained).getByRole('tab', { name: 'What the Rows Show' }))
  expect(await within(explained).findByText(/Fall Launch sent the most/)).toBeTruthy()
  expect(within(explained).getByText('Email carried nine in ten sends.')).toBeTruthy()
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/insights/reports/rep-1/explain/'))).toBe(true)

  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Show the SQL' }))
  const sql = await screen.findByRole('dialog', { name: 'Show the SQL' })
  expect(await within(sql).findByText(/FROM "reporting"."rpt_messages"/)).toBeTruthy()
  await user.click(within(sql).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement)

  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Embed on Another Site' }))
  const embed = await screen.findByRole('dialog', { name: 'Embed on Another Site' })
  await user.type(await within(embed).findByRole('textbox', { name: /^Label/ }), 'Partner Portal')
  await user.click(within(embed).getByRole('button', { name: 'Make a Link' }))
  expect((await within(embed).findByRole('textbox', { name: 'Address' }) as HTMLInputElement).value).toMatch(/\/embed\/NWA\/s3cret-token$/)
  expect((within(embed).getByRole('textbox', { name: 'Code to paste into a page' }) as HTMLInputElement).value).toMatch(/^<iframe src=".*\/embed\/NWA\/s3cret-token"/)
  expect(await within(embed).findByText('Partner Portal')).toBeTruthy()
  await user.click(within(embed).getByRole('button', { name: 'Revoke' }))
  await vi.waitFor(() => expect(within(embed).getByText('No link yet.')).toBeTruthy())
})

test('the editor: Change with a Prompt changes the draft and Undo puts it back; Linked Measures adds Amount from Attributed Orders', async () => {
  const user = userEvent.setup()
  window.localStorage.setItem('insights.editor', 'wells')
  const calls = await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' }, { timeout: 5000 })
  await user.type(await screen.findByRole('textbox', { name: 'What to change' }), 'By channel only, as a bar chart')
  await user.click(screen.getByRole('button', { name: 'Change' }))
  expect(await screen.findByText(/Changed: By channel only, as a bar chart/)).toBeTruthy()
  await vi.waitFor(() => {
    const body = calls.filter((call) => call.url.endsWith('/insights/reports/preview/')).at(-1)?.body as { definition: ReportDefinition } | undefined
    expect(body?.definition.columns[0].field).toBe('channel')
  })
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(await screen.findByText('The change was undone.')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Linked Measures' }))
  const linked = await screen.findByRole('dialog', { name: 'Linked Measures' })
  expect(within(linked).getByText(/Both share Campaign, Channel, Sent by a period/)).toBeTruthy()
  await user.click(within(linked).getByRole('checkbox', { name: 'Amount' }))
  await user.click(within(linked).getByRole('button', { name: 'Apply' }))
  await vi.waitFor(() => {
    const body = calls.filter((call) => call.url.endsWith('/insights/reports/preview/')).at(-1)?.body as { definition: ReportDefinition } | undefined
    expect(body?.definition.blend).toEqual({ dataset: 'attributed_orders', columns: [{ field: 'amount', aggregate: 'sum' }] })
  })
  expect(screen.getByRole('button', { name: 'Linked Measures · 1' })).toBeTruthy()
})

test('removing linked measures drops a sort on them', () => {
  const blended: ReportDefinition = { columns: [{ field: 'campaign_name' }], orderBy: [{ field: 'attributed_orders.amount', direction: 'desc' }, { field: 'campaign_name', direction: 'asc' }],
    blend: { dataset: 'attributed_orders', columns: [{ field: 'amount', aggregate: 'sum' }] } }
  const gone = setBlend(blended, null)
  expect(gone.blend).toBeUndefined()
  expect(gone.orderBy).toEqual([{ field: 'campaign_name', direction: 'asc' }])
})

test('an embed link opens without signing in; a revoked one says so', async () => {
  installMockApi({ me: withInsights as never })
  window.history.pushState({}, '', '/embed/NWA/s3cret-token')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Sends by campaign' }, { timeout: 5000 })).toBeTruthy()
  expect(screen.getByText(/Northwind/)).toBeTruthy()
  expect(screen.getByText('Read-only. Personal data is masked.')).toBeTruthy()
  cleanup()
  window.history.pushState({}, '', '/embed/NWA/gone')
  vi.resetModules()
  const again = await import('@/App').then(cepReady)
  render(<again.default />)
  expect(await screen.findByText(/This link was revoked or has expired/, undefined, { timeout: 5000 })).toBeTruthy()
})

test('the usage page: most opened, who opens, and the reports nobody opened', async () => {
  await renderAppAt('/insights/usage')
  expect(await screen.findByRole('heading', { name: 'Usage' }, { timeout: 5000 })).toBeTruthy()
  const table = await screen.findByRole('table', { name: 'Openings' })
  expect(within(table).getByRole('link', { name: 'Sends by campaign' })).toBeTruthy()
  expect(within(table).getByText('42')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Spring Promo Clicks' })).toBeTruthy()
  expect(screen.getByText('59 openings in the last 30 days')).toBeTruthy()
})
