/** A grid's Total row (view.totals): pinned under the rows, the engine's grand total under the totalled columns it names. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { insightsResult } from '@/test/mockApi'
import { gridTotalRow, ResultGrid } from './components/ResultGrid'
import type { RunResult } from './types'

afterEach(cleanup)

const result = { ...insightsResult, totals: [{ keys: {}, values: [368900, 361977] }] } as RunResult

test('the Total row takes the grand total under each totalled column and "Total" in the first other column', () => {
  expect(gridTotalRow(result, ['sent', 'delivered'])).toEqual({ c0: 'Total', c2: 368900, c3: 361977 })
  expect(gridTotalRow(result, ['delivered'])).toEqual({ c0: 'Total', c3: 361977 })
  expect(gridTotalRow(result, [])).toBeNull()
  expect(gridTotalRow({ ...result, totals: undefined }, ['sent'])).toBeNull()
})

test('a grid that totals its columns shows the Total row; one that does not, shows none', async () => {
  render(<ResultGrid result={result} totals={['sent', 'delivered']} />)
  expect(await screen.findByText('Total')).toBeTruthy()
  expect(await screen.findByText('368,900')).toBeTruthy()
  cleanup()
  render(<ResultGrid result={result} />)
  expect(screen.queryByText('Total')).toBeNull()
})
