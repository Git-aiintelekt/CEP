/** Insights → Run Log: for report administrators only; the summary, the rows with their outcomes and reasons, the outcome filter. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }
const asAdmin = { ...withInsights, principal: { ...withInsights.principal, permissions: [...withInsights.principal.permissions, 'report.admin'] } }

async function renderAppAt(path: string, who: object) {
  installMockApi({ me: who as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the Run Log is in the menu for a report administrator only; it lists the runs with their outcomes and reasons, and filters by outcome', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports', withInsights)
  const nav = await screen.findByRole('navigation', { name: 'Main' })
  expect(within(nav).queryByRole('link', { name: 'Run Log' })).toBeNull()
  cleanup()
  await renderAppAt('/insights/runs', asAdmin)
  await screen.findByRole('heading', { name: 'Run Log' })
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Run Log' })).toBeTruthy()
  const table = await screen.findByRole('table', { name: 'Runs' })
  expect(within(table).getAllByRole('row').length).toBe(1 + 3)
  expect(screen.getByText(/3 runs · 1 timed out · 0 refused · 0 failed · median 42 ms/)).toBeTruthy()
  expect(within(table).getByText('15 s statement timeout')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Timed Out' }))
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Runs' })).getAllByRole('row').length).toBe(1 + 1))
})
