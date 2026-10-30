/** Drill-down and time comparisons: the helpers, a comparison added in the editor, and a chart drilled in the viewer. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, insightsCatalog, me, signIn } from '@/test/mockApi'
import { canDrill, deeper, stepWords } from './components/drill'
import { compareOptions, setAggregate, setCompare, timeAxis } from './editor/definition'
import type { CatalogDataset, DrillInfo, ReportDefinition } from './types'

const withInsights = { ...me, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

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

test('comparisons: the time axis is the first date by a bucket, an option says why it cannot apply, a calculation that does not add up drops the ones that need it', () => {
  const flat: ReportDefinition = { columns: [{ field: 'channel' }, { field: 'sent', aggregate: 'sum' }] }
  expect(timeAxis(messages, flat)).toBeNull()
  expect(timeAxis(messages, { columns: [{ field: 'submitted_at' }, { field: 'sent', aggregate: 'sum' }] })).toBeNull()      // a date and time as it is: no buckets to compare
  const monthly: ReportDefinition = { columns: [{ field: 'submitted_at', bucket: 'month' }, { field: 'sent', aggregate: 'sum' }] }
  expect(timeAxis(messages, monthly)).toEqual({ field: 'submitted_at', bucket: 'month' })
  const options = compareOptions(messages, monthly, monthly.columns[1])
  expect(options.map((o) => o.label)).toEqual(['Previous Month', 'Last Year', 'Change vs Previous Month', 'Change vs Last Year', 'Year to Date', 'Quarter to Date', 'Running Total',
    'Moving Average (3 Months)', '% of Total', 'Rank', '% of Target', 'Difference to Target'])
  expect(options.every((o) => !o.reason)).toBe(true)
  const without = compareOptions(messages, flat, flat.columns[1])
  expect(without.filter((o) => o.reason).map((o) => o.kind)).toEqual(['previous_period', 'previous_year', 'change_previous_period', 'change_previous_year', 'year_to_date', 'quarter_to_date', 'running_total', 'moving_average'])
  const compared = setCompare(monthly, 'sent', ['previous_year', 'running_total'])
  expect(compared.columns[1]).toEqual({ field: 'sent', aggregate: 'sum', compare: ['previous_year', 'running_total'] })
  expect(setAggregate(compared, 'sent', 'avg').columns[1]).toEqual({ field: 'sent', aggregate: 'avg', compare: ['previous_year'] })
  expect(setCompare(compared, 'sent', []).columns[1]).toEqual({ field: 'sent', aggregate: 'sum' })
})

test('drill helpers: a step in words, whether a click drills, and the path one level down', () => {
  const info: DrillInfo = { levels: [{ field: 'submitted_at', bucket: 'year', label: 'Sent by Year' }, { field: 'submitted_at', bucket: 'quarter', label: 'Sent by Quarter' }, { field: 'channel', label: 'Channel' }], path: [], depth: 0 }
  expect(stepWords({ field: 'submitted_at', bucket: 'quarter', value: '2026-07-01' })).toBe('Q3 2026')
  expect(stepWords({ field: 'submitted_at', bucket: 'year', value: '2026-01-01' })).toBe('2026')
  expect(stepWords({ field: 'channel', value: null })).toBe('Empty')
  expect(canDrill(info, { key: 'submitted_at', label: 'Sent', type: 'date', format: 'date' })).toBe(true)
  expect(canDrill(info, { key: 'channel', label: 'Channel', type: 'string', format: null })).toBe(false)
  expect(deeper(info, '2026-01-01')).toEqual([{ field: 'submitted_at', bucket: 'year', value: '2026-01-01' }])
  expect(canDrill({ ...info, depth: 2 })).toBe(false)
})

test('the editor: a measure takes a comparison once the report has a date by month, and the preview asks for it', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  const show = screen.getByRole('region', { name: 'Show' })
  await user.click(within(show).getByRole('button', { name: 'Sent Count calculation' }))
  let menu = screen.getByRole('region', { name: 'Sent Count calculation' })
  const lastYear = within(menu).getByRole('menuitemcheckbox', { name: /^Change vs Last Year.*needs a date/ })
  expect(lastYear.getAttribute('aria-disabled')).toBe('true')
  expect(within(menu).getByRole('menuitemcheckbox', { name: '% of Total' }).getAttribute('aria-disabled')).toBeNull()
  await user.keyboard('{Escape}')

  await user.click(within(screen.getByRole('complementary', { name: 'Fields' })).getByRole('button', { name: 'Sent, add' }))
  await user.selectOptions(within(screen.getByRole('region', { name: 'Split By' })).getByRole('combobox', { name: 'Sent bucket' }), 'month')
  await user.click(within(show).getByRole('button', { name: 'Sent Count calculation' }))
  menu = screen.getByRole('region', { name: 'Sent Count calculation' })
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Change vs Last Year' }))
  await user.keyboard('{Escape}')
  expect(within(show).getByRole('button', { name: 'Remove Change vs Last Year from Sent Count' })).toBeTruthy()
  await vi.waitFor(() => {
    const previews = calls.filter((call) => call.url.endsWith('/insights/reports/preview/'))
    const last = previews.at(-1)?.body as { definition: ReportDefinition } | undefined
    expect(last?.definition.columns.find((c) => c.field === 'sent')?.compare).toEqual(['change_previous_year'])
  })
  await user.click(within(show).getByRole('button', { name: 'Remove Change vs Last Year from Sent Count' }))
  expect(within(show).queryByRole('button', { name: /Remove Change vs Last Year/ })).toBeNull()
})

test('the viewer: in the chart a click on a bar drills a level down, the path says where it is, and Up One Level goes back', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await user.click(await screen.findByRole('radio', { name: 'Chart' }, { timeout: 5000 }))
  await screen.findByText('Click a bar, a slice or a stage to drill down to Channel.')
  fireEvent.click(screen.getByRole('group', { name: 'Sent Count by Campaign' }), { clientX: 80 })      // the first bar: Fall Launch
  const path = await screen.findByRole('navigation', { name: 'Drill path' })
  expect(within(path).getByText('Fall Launch').getAttribute('aria-current')).toBe('location')
  expect(within(path).getByText(/· Channel/)).toBeTruthy()
  await vi.waitFor(() => expect(screen.getByRole('group', { name: 'Sent Count by Channel' })).toBeTruthy())
  const drilled = calls.filter((call) => call.url.endsWith('/insights/reports/rep-1/run/')).map((call) => (call.body as { drill?: { path: unknown[] } }).drill).filter(Boolean)
  expect(drilled.at(-1)).toEqual({ path: [{ field: 'campaign_name', value: 'Fall Launch' }] })
  await user.click(within(path).getByRole('button', { name: 'Up One Level' }))
  await screen.findByText('Click a bar, a slice or a stage to drill down to Channel.')
  expect(screen.queryByRole('navigation', { name: 'Drill path' })).toBeNull()
})
