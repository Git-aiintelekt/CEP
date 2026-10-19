/** The chart kinds and analysing visuals: scatter, bubble, treemap, waterfall, KPI card, gauge, map, the matrix pivot, small
 * multiples, Key Influencers, the Decomposition Tree, and a dashboard's written summary. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsDashboardsNow, installMockApi, me, signIn } from '@/test/mockApi'
import { ReportResult } from './components/ReportViews'
import type { ReportView, RunResult } from './types'
import { guess, match } from './visuals/geo'
import { squarify, waterfallSteps } from './visuals/layout'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const base = { row_count: 0, duration_ms: 5, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: false }
const campaigns: RunResult = {
  ...base,
  columns: [{ key: 'campaign_name', label: 'Campaign', type: 'string', format: null }, { key: 'sent', label: 'Sent Count', type: 'number', format: 'integer', aggregate: 'sum' },
            { key: 'opened', label: 'Opened', type: 'number', format: 'integer', aggregate: 'sum' }, { key: 'clicked', label: 'Clicked', type: 'number', format: 'integer', aggregate: 'sum' }],
  rows: [['Fall Launch', 1800, 700, 90], ['Weekly Newsletter', 1400, 400, 30], ['Win-Back', 400, 90, 6]],
}
const months: RunResult = {
  ...base,
  columns: [{ key: 'submitted_at', label: 'Sent', type: 'date', format: 'datetime', bucket: 'month' }, { key: 'sent', label: 'Sent Count', type: 'number', format: 'integer', aggregate: 'sum' }],
  rows: [['2026-08-01', 400], ['2026-09-01', -100], ['2026-10-01', 600]], totals: [{ keys: {}, values: [900] }],
}
const show = (result: RunResult, view: ReportView) => render(<ReportResult result={result} view={view} minHeight={300} />)

test('the geometry: a treemap fills its box in proportion; a waterfall floats each step and ends on the whole; places match by code or name', () => {
  const laid = squarify([{ value: 6 }, { value: 3 }, { value: 1 }], { x: 0, y: 0, w: 100, h: 100 })
  expect(laid.map((box) => Math.round(box.w * box.h))).toEqual([6000, 3000, 1000])
  expect(waterfallSteps([400, -100, 600])).toEqual([{ start: 0, end: 400, kind: 'up' }, { start: 400, end: 300, kind: 'down' }, { start: 300, end: 900, kind: 'up' }, { start: 0, end: 900, kind: 'total' }])
  const sets = {
    us: { width: 10, height: 10, shapes: [{ id: 'GA', name: 'Georgia', codes: ['GA'], d: '' }, { id: 'FL', name: 'Florida', codes: ['FL'], d: '' }] },
    world: { width: 10, height: 10, shapes: [{ id: 'GA', name: 'Gabon', codes: ['GA', 'GAB'], d: '' }, { id: 'US', name: 'United States', codes: ['US', 'USA'], alt: ['United States of America'], d: '' }] },
  }
  expect(guess({ key: 'region', label: 'Region' }, ['GA'], sets)).toBe('us')
  expect(guess({ key: 'country', label: 'Country' }, ['GA'], sets)).toBe('world')
  expect(match(sets.world, [{ value: 'united states of america', amount: 3 }, { value: 'usa', amount: 2 }, { value: 'Narnia', amount: 1 }])).toEqual({ byShape: new Map([['US', 5]]), missing: ['Narnia'] })
})

test('scatter, bubble and treemap draw a mark per value; a bubble without a third value says why', () => {
  const { container } = show(campaigns, { type: 'chart', chart: 'scatter' })
  expect(container.querySelectorAll('[data-point]')).toHaveLength(3)
  expect(screen.getByRole('img', { name: 'Opened by Sent Count, per Campaign' })).toBeTruthy()
  cleanup()
  const bubble = show(campaigns, { type: 'chart', chart: 'bubble' })
  expect(bubble.container.querySelectorAll('[data-point]')).toHaveLength(3)
  cleanup()
  show({ ...campaigns, columns: campaigns.columns.slice(0, 3), rows: campaigns.rows.map((row) => row.slice(0, 3)) }, { type: 'chart', chart: 'bubble' })
  expect(screen.getByText(/A bubble chart needs three values/)).toBeTruthy()
  cleanup()
  const tree = show(campaigns, { type: 'chart', chart: 'treemap' })
  expect(tree.container.querySelectorAll('[data-treemap-box]')).toHaveLength(3)
})

test('a waterfall shows rises, falls and the total; a KPI card and a gauge read the grand total against the target', () => {
  const water = show(months, { type: 'chart', chart: 'waterfall' })
  expect([...water.container.querySelectorAll('[data-step]')].map((el) => el.getAttribute('data-step'))).toEqual(['up', 'down', 'up', 'total'])
  cleanup()
  const kpi = show(months, { type: 'chart', chart: 'kpi', target: 1000 })
  const card = kpi.container.querySelector('[data-kpi]') as HTMLElement
  expect(within(card).getByText('900')).toBeTruthy()
  expect(within(card).getByText('90.0% of target')).toBeTruthy()
  expect(card.querySelector('[data-sparkline]')).toBeTruthy()
  cleanup()
  const gauge = show(months, { type: 'chart', chart: 'gauge', target: 1000 })
  expect(screen.getByRole('img', { name: 'Sent Count: 900 of a 1,000 target' })).toBeTruthy()
  expect(gauge.container.querySelector('[data-gauge-target]')).toBeTruthy()
})

test('a map shades the states it knows and lists the rest', async () => {
  const states: RunResult = { ...base, columns: [{ key: 'region', label: 'Region', type: 'string', format: null }, { key: 'contacts', label: 'Contacts', type: 'number', format: 'integer', aggregate: 'count' }],
    rows: [['GA', 40], ['Florida', 30], ['Atlantis', 1]] }
  const { container } = show(states, { type: 'chart', chart: 'map' })
  await vi.waitFor(() => expect(container.querySelector('[data-shape="GA"]')).toBeTruthy(), { timeout: 5000 })
  expect(container.querySelector('[data-shape="GA"]')?.getAttribute('fill')).toBe('var(--color-chart-1)')
  expect(container.querySelector('[data-shape="TX"]')?.getAttribute('fill')).toBe('var(--color-fill-subtle)')
  expect(screen.getByText('Not on the map: Atlantis.')).toBeTruthy()
})

test('a pivot of every value side by side, with a trend per row; small multiples repeat the chart per channel', () => {
  const result: RunResult = { ...base,
    columns: [{ key: 'channel', label: 'Channel', type: 'string', format: null }, { key: 'submitted_at', label: 'Sent', type: 'date', format: 'datetime', bucket: 'month' },
              { key: 'sent', label: 'Sent Count', type: 'number', format: 'integer', aggregate: 'sum' }, { key: 'opened', label: 'Opened', type: 'number', format: 'integer', aggregate: 'sum' }],
    rows: [['EMAIL', '2026-08-01', 300, 100], ['EMAIL', '2026-09-01', 400, 150], ['SMS', '2026-08-01', 30, 0], ['SMS', '2026-09-01', 50, 0]] }
  const pivot = show(result, { type: 'pivot', across: 'submitted_at', matrix: true, sparklines: true })
  const table = screen.getByRole('region', { name: 'Report rows' })
  expect(within(table).getAllByRole('columnheader', { name: 'Opened' })).toHaveLength(4)                 // two months, the total, the trend
  expect(pivot.container.querySelectorAll('[data-sparkline]')).toHaveLength(6)                           // a line per value per row, and the total row
  cleanup()
  const multiples = show(result, { type: 'chart', chart: 'bar', multiples: 'channel' })
  expect(multiples.container.querySelectorAll('[data-multiple]')).toHaveLength(2)
  expect(screen.getByText('One chart per Channel, all on one scale.')).toBeTruthy()
})

test('the viewer: Analyse opens Key Influencers, then the Decomposition Tree splits by channel and lets AI pick the next field', async () => {
  const user = userEvent.setup()
  installMockApi({ me: withInsights as never })
  signIn('/insights/reports/rep-1')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  await screen.findByRole('heading', { name: 'Sends by campaign' }, { timeout: 5000 })
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Analyse' }), 'influencers')
  const raises = await screen.findByRole('region', { name: 'Raises It' })
  expect(within(raises).getByText('EMAIL')).toBeTruthy()
  expect(within(screen.getByRole('region', { name: 'Lowers It' })).getByText(/67% lower/)).toBeTruthy()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Analyse' }), 'decomposition')
  const total = await screen.findByRole('region', { name: 'Total' })
  expect(within(total).getByText('2,000')).toBeTruthy()
  await user.click(within(total).getByRole('button', { name: 'Split By' }))
  await user.click(screen.getByRole('menuitem', { name: /^Channel/ }))
  const level = await screen.findByRole('region', { name: 'Channel' })
  await user.click(await within(level).findByRole('button', { name: /EMAIL/ }))
  await user.click(within(level).getByRole('button', { name: 'Split By' }))
  await user.click(screen.getByRole('menuitem', { name: /High Value/ }))
  const next = await screen.findByRole('region', { name: 'Campaign' })
  expect(await within(next).findByText('Fall Launch')).toBeTruthy()
  expect(within(next).getByLabelText('Picked by High Value')).toBeTruthy()
})

test('a dashboard tile can be a written summary from AI', async () => {
  installMockApi({ me: withInsights as never })
  insightsDashboardsNow[0] = { ...insightsDashboardsNow[0], layout: { rows: [{ width: '1', tiles: [{ id: 't1', report_id: 'rep-1', show: 'summary' }] }] } }
  signIn('/insights/dashboards/dash-1')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  expect(await screen.findByText('Email carried nine in ten sends; Fall Launch led.', undefined, { timeout: 5000 })).toBeTruthy()
  expect(screen.getByText('Text sends stayed small.')).toBeTruthy()
  expect(screen.getByText(/Written by Claude Sonnet 5.5 from Sends by campaign/)).toBeTruthy()
})
