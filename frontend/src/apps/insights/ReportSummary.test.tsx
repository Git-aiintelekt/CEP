/** The report's figures and What This Means (docs/mockups/report-page.html): totals over the whole result, and the verdict only where a benchmark judges it. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { installMockApi, insightsBenchmarksNow, insightsResult, me, signIn } from '@/test/mockApi'
import type { RunResult } from './types'

afterEach(cleanup)

const withInsights = { ...me, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

const result = insightsResult as unknown as RunResult

async function signedIn() {
  const calls = installMockApi({ me: withInsights as never })
  signIn('/insights/reports/rep-1')
  vi.resetModules()
  const { ReportSummary } = await import('./components/ReportSummary')
  return { calls, ReportSummary }
}

async function renderSummary(shown: RunResult = result, onWhy = vi.fn()) {
  const { calls, ReportSummary } = await signedIn()
  render(<QueryClientProvider client={new QueryClient()}><ReportSummary reportId="rep-1" dataset="messages" result={shown} period="1 Oct 2026 to 28 Oct 2026" onWhy={onWhy} /></QueryClientProvider>)
  return calls
}

test('one figure per measure, the rows added up, with the dates under it; no What This Means without a benchmark', async () => {
  const calls = await renderSummary()
  const summary = screen.getByRole('region', { name: 'Summary' })
  expect(within(summary).getByText('Sent Count')).toBeTruthy()
  expect(within(summary).getByText('368,900')).toBeTruthy()
  expect(within(summary).getByText('361,977')).toBeTruthy()
  expect(within(summary).getAllByText('1 Oct 2026 to 28 Oct 2026')).toHaveLength(2)
  await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith('/insights/benchmarks/'))).toBe(true))
  expect(calls.some((call) => call.url.includes('/meaning/'))).toBe(false)
})

test('the engine’s grand total wins over the rows; a part of the rows with no total shows no figure', async () => {
  await renderSummary({ ...result, totals: [{ keys: {}, values: [500000, 490000] }] })
  expect(screen.getByText('500,000')).toBeTruthy()
  cleanup()
  await renderSummary({ ...result, truncated: true, row_count: 900 })
  expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull()
})

test('with a benchmark: the verdict line, the figure’s tag and target, and Why opens Explain', async () => {
  const user = userEvent.setup()
  const onWhy = vi.fn()
  const { calls, ReportSummary } = await signedIn()
  insightsBenchmarksNow.push({ id: 'bm-1', dataset: 'messages', dataset_label: 'Messages', measure: 'sent', measure_label: 'Sent Count', format: 'integer', higher_is_better: true, good: 1500, act: 1000, count_field: null, base_field: null, row_version: 1 } as never)
  render(<QueryClientProvider client={new QueryClient()}><ReportSummary reportId="rep-1" dataset="messages" result={result} onWhy={onWhy} /></QueryClientProvider>)
  expect(await screen.findByText('On Track')).toBeTruthy()
  expect(screen.getByText('1 of 1 figure on target.')).toBeTruthy()
  expect(screen.getByText('On Target')).toBeTruthy()
  expect(screen.getByText('target 1,500')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Why It’s Judged This Way' }))
  expect(onWhy).toHaveBeenCalled()
  expect(calls.some((call) => call.url.endsWith('/insights/reports/rep-1/meaning/'))).toBe(true)
})

test('a result with no measure shows no summary', async () => {
  await renderSummary({ ...result, columns: result.columns.filter((column) => !column.aggregate), rows: result.rows.map((row) => row.slice(0, 2)) })
  expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull()
})
