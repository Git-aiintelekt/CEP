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
  const figures = screen.getByRole('group', { name: 'The last 7 days' })
  expect(within(figures).getByText('Runs in 7 days').previousElementSibling?.textContent).toBe('3')
  expect(within(figures).getByText('Timed out').previousElementSibling?.textContent).toBe('1')
  expect(within(figures).getByText('42 ms')).toBeTruthy()
  expect(within(table).queryByText('15 s statement timeout')).toBeNull()                       // the reason opens on its row
  await user.click(within(table).getByRole('button', { name: 'Timed Out: show why' }))
  expect(within(table).getByText('15 s statement timeout')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Outcome' }))
  await user.click(await screen.findByRole('option', { name: 'Timed Out' }))
  expect(screen.getByRole('button', { name: 'Outcome: Timed Out' })).toBeTruthy()
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Runs' })).getAllByRole('row').length).toBe(1 + 1))
})
