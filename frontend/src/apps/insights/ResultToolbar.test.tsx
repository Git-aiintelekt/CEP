/** The result's toolbar (docs/mockups/report-page.html): the same three slots in every view, and the card's footer line. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { insightsResult } from '@/test/mockApi'
import { ViewBar } from './components/ReportViews'
import { ResultCard } from './components/ResultCard'
import type { ReportView, ResultColumn, RunResult } from './types'

afterEach(cleanup)

const columns = insightsResult.columns as ResultColumn[]
const result = insightsResult as unknown as RunResult

function renderBar(view: ReportView, onFold?: (open: boolean) => void) {
  const onChange = vi.fn()
  render(<ViewBar view={view} onChange={onChange} columns={columns} dimensions={[]} onFold={onFold} />)
  return onChange
}

test('the grid has only the view switch and Analyse', () => {
  renderBar({ type: 'grid' })
  const bar = screen.getByRole('toolbar', { name: 'Report view' })
  expect(within(bar).getByRole('radio', { name: 'Grid' })).toBeTruthy()
  expect(within(bar).getByRole('button', { name: 'Analyse' })).toBeTruthy()
  expect(within(bar).queryByRole('button', { name: 'Chart type' })).toBeNull()
  expect(within(bar).queryByRole('button', { name: /^Show/ })).toBeNull()
})

test('a chart: every kind in one Chart Type menu of three groups, Across beside it, and Show counts what is on', async () => {
  const user = userEvent.setup()
  const onChange = renderBar({ type: 'chart', chart: 'line', signals: ['forecast'] })
  expect(screen.getByRole('button', { name: 'Across: Each Value on Its Own' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Show · 1 on' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Chart type' }))
  const menu = screen.getByRole('region', { name: 'Chart type' })
  expect(within(menu).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Compare', 'Parts of a Whole', 'More Charts'])
  expect(within(menu).getAllByRole('button')).toHaveLength(15)
  expect(within(menu).getByRole('button', { name: 'Lines' }).getAttribute('aria-pressed')).toBe('true')
  await user.click(within(menu).getByRole('button', { name: 'Pie' }))
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ chart: 'pie' }))
  expect(screen.queryByRole('region', { name: 'Chart type' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Show · 1 on' }))
  await user.click(screen.getByRole('switch', { name: 'Flag Anomalies' }))
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ signals: ['forecast', 'anomalies'] }))
})

test('a pie takes no Across; a KPI card asks for its Target', () => {
  renderBar({ type: 'chart', chart: 'pie' })
  expect(screen.queryByRole('button', { name: /^Across: / })).toBeNull()
  cleanup()
  renderBar({ type: 'chart', chart: 'kpi' })
  expect(screen.getByRole('spinbutton', { name: 'Target' })).toBeTruthy()
})

test('a pivot: Across and Value in the middle as toolbar menus, All Values and Trend Column under Show', async () => {
  const user = userEvent.setup()
  const onChange = renderBar({ type: 'pivot', across: 'channel' })
  expect(screen.getByRole('button', { name: 'Across: Channel' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Pivot value: Sent Count' }))
  await user.click(screen.getByRole('option', { name: 'Delivered Count' }))
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ measure: 'delivered' }))
  await user.click(screen.getByRole('button', { name: 'Show' }))
  await user.click(screen.getByRole('switch', { name: 'Trend Column' }))
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sparklines: true }))
})

test('a hierarchy: Expand All and Collapse All in the toolbar', async () => {
  const user = userEvent.setup()
  const onFold = vi.fn()
  renderBar({ type: 'hierarchy' }, onFold)
  await user.click(screen.getByRole('button', { name: 'Expand All' }))
  expect(onFold).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Collapse All' }))
  expect(onFold).toHaveBeenLastCalledWith(false)
})

test('Analyse opens Key Influencers or the Decomposition Tree', async () => {
  const user = userEvent.setup()
  const onChange = renderBar({ type: 'grid' })
  await user.click(screen.getByRole('button', { name: 'Analyse' }))
  await user.click(screen.getByRole('button', { name: 'Decomposition Tree' }))
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'decomposition' }))
})

test('the card: the toolbar on top, the result, and a footer saying how a pivot reads', () => {
  render(<ResultCard result={result} view={{ type: 'pivot', across: 'channel', measure: 'delivered' }} bar={<span>Toolbar</span>} hint={<span>Click a row label to drill down.</span>}><p>Rows</p></ResultCard>)
  const card = screen.getByRole('region', { name: 'Report result' })
  expect(within(card).getByText('Toolbar')).toBeTruthy()
  expect(within(card).getByText('Delivered Count · Campaign down, Channel across')).toBeTruthy()
  expect(within(card).getByText('Click a row label to drill down.')).toBeTruthy()
  cleanup()
  const { container } = render(<ResultCard result={result} view={{ type: 'grid' }} bar={<span>Toolbar</span>}><p>Rows</p></ResultCard>)
  expect(container.querySelector('[data-result-footer]')).toBeNull()
})
