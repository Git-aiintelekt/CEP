import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { todayIn } from '@/features/reports/period'
import type { Campaign } from '@/lib/types'
import { atZone } from '@/lib/zonedTime'
import { installMockApi, makeCampaign, signIn } from '@/test/mockApi'

const ZONE = 'America/New_York'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** `count` one-day campaigns today */
const today = (count: number): Campaign[] => Array.from({ length: count }, (_, index) => makeCampaign({
  id: `m${index}`, name: `Campaign ${index + 1}`, status: 'PRODUCTION_PUBLISHED', runs: [{
    id: `r${index}`, campaign: `m${index}`, tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null,
    started_at: atZone(todayIn(ZONE), `${String(9 + index).padStart(2, '0')}:00`, ZONE), completed_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', row_version: 1,
  }] as Campaign['runs'],
}))
const bars = (grid: HTMLElement) => within(grid).queryAllByRole('link', { name: /^Campaign \d/ })

test('three campaigns on a day: all three bars, no More', async () => {
  installMockApi({ campaigns: today(3) })
  await renderAppAt('/campaigns?view=calendar')
  const grid = await screen.findByRole('grid')
  await vi.waitFor(() => expect(bars(grid)).toHaveLength(3))
  expect(within(grid).queryByRole('button', { name: /More$/ })).toBeNull()
})

test('five campaigns on a day: two bars, then "+3 More" in the third lane, which lists all five', async () => {
  installMockApi({ campaigns: today(5) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns?view=calendar')
  const grid = await screen.findByRole('grid')
  await vi.waitFor(() => expect(bars(grid)).toHaveLength(2))
  const more = within(grid).getByRole('button', { name: '+3 More' })
  expect(more.style.gridRow).toBe('3')
  await user.click(more)
  const modal = await screen.findByRole('dialog')
  expect(within(modal).getAllByRole('link')).toHaveLength(5)
})
