/** Highlights (docs/mockups/report-page.html): the rules' lines from a report's rows, and the card that shows them or the AI's words. */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { highlights } from './components/highlights'
import { ReportHighlights } from './components/ReportHighlights'
import type { ResultColumn, RunResult } from './types'

afterEach(cleanup)

const campaign: ResultColumn = { key: 'campaign', label: 'Campaign', type: 'string', format: null }
const month: ResultColumn = { key: 'month', label: 'Placed', type: 'date', format: null, bucket: 'month' }
const amount: ResultColumn = { key: 'amount', label: 'Amount', type: 'number', format: 'money', aggregate: 'sum' }

function resultOf(columns: ResultColumn[], rows: unknown[][], more: Partial<RunResult> = {}): RunResult {
  return { columns, rows, row_count: rows.length, duration_ms: 5, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: false, note: '', ...more } as RunResult
}

const revenue = resultOf([campaign, month, amount], [
  [null, '2026-08-01', 300], [null, '2026-10-01', 150],
  ['August Style Edit', '2026-08-01', 200],
  ['Fall Launch Preview', '2026-09-01', 120], ['Fall Launch Preview', '2026-10-01', 30],
  ['Hottest Designer Deals', '2026-10-01', 5],
])

test('the change from the first to the last date, the top value with its share and the runner-up, the lowest, and how many', () => {
  const lines = highlights(revenue)
  expect(lines[0]).toMatchObject({ tone: 'down' })
  expect(lines[0].lead).toMatch(/^Amount fell 63% from .+ to .+$/)
  expect(lines[1].lead).toBe('Rows with no Campaign is top for Amount')
  expect(lines[1].rest).toMatch(/^ at \$450\.00 \(56% of the total\), then August Style Edit at \$200\.00\.$/)
  expect(lines[2].lead).toBe('Hottest Designer Deals has the least Amount')
  expect(lines[3].lead).toBe('3 Campaign values')
  expect(lines[3].rest).toBe(' share $355.00, with $450.00 on rows with none.')
  expect(lines).toHaveLength(4)
})

test('no lines from a part of the rows, from one row, or without a sum or a count', () => {
  expect(highlights({ ...revenue, truncated: true })).toEqual([])
  expect(highlights({ ...revenue, rows: revenue.rows.slice(0, 1), row_count: 1 })).toEqual([])
  expect(highlights(resultOf([campaign, { ...amount, aggregate: 'avg' as never }], [['A', 1], ['B', 2]]))).toEqual([])
})

test('a rise reads as one; two values have no lowest or count line', () => {
  const lines = highlights(resultOf([month, amount], [['2026-08-01', 100], ['2026-09-01', 150]]))
  expect(lines[0]).toMatchObject({ tone: 'up' })
  expect(lines[0].lead).toMatch(/^Amount rose 50% /)
  expect(lines.some((line) => line.lead.includes('least'))).toBe(false)
})

test('the card: the lines, and Explain With AI only when the AI is allowed, asked once and swapped back', async () => {
  const user = userEvent.setup()
  render(<ReportHighlights result={revenue} ai={null} />)
  expect(screen.getByRole('heading', { name: 'Highlights' })).toBeTruthy()
  expect(screen.getByText('Worked out from these rows')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Explain With AI' })).toBeNull()
  cleanup()

  const explain = vi.fn()
  const { rerender } = render(<ReportHighlights result={revenue} ai={{ explain, pending: false, error: null, explanation: null }} />)
  await user.click(screen.getByRole('button', { name: 'Explain With AI' }))
  expect(explain).toHaveBeenCalledTimes(1)
  rerender(<ReportHighlights result={revenue} ai={{ explain, pending: false, error: null, explanation: { summary: 'Revenue is falling.', points: ['October is the lowest month.'], caution: '', counted: true } }} />)
  expect(screen.getByText('Revenue is falling.')).toBeTruthy()
  expect(screen.getByText('Written by AI from these rows')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Back to Highlights' }))
  expect(screen.getByText('Hottest Designer Deals has the least Amount')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Explain With AI' }))
  expect(explain).toHaveBeenCalledTimes(1)                                        // the AI's words are kept, not asked again
})

test('no card when the rules have nothing to say', () => {
  const { container } = render(<ReportHighlights result={{ ...revenue, truncated: true }} ai={null} />)
  expect(container.innerHTML).toBe('')
})
