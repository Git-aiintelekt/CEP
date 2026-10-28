/** Scheduled delivery: Schedule from the viewer makes a schedule and the banner shows it; Insights → Scheduled lists it; Pause and Resume. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit'] },
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

test('Schedule on the viewer: weekly on Monday at 08:00 as Excel to two people; the banner says so; Scheduled lists it and pauses it', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await user.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 5000 }))
  await user.click(screen.getByRole('menuitem', { name: 'Schedule' }))
  const dialog = await screen.findByRole('dialog', { name: 'Schedule' })
  expect(within(dialog).getByRole('radio', { name: 'Week' }).getAttribute('aria-checked')).toBe('true')
  expect(within(dialog).getByRole('combobox', { name: 'On' })).toBeTruthy()
  const to = within(dialog).getByRole('textbox', { name: 'To' })
  await user.type(to, 'finance@northwind.example aby@northwind.example{Enter}')
  expect(within(dialog).getAllByRole('button', { name: /Remove .*@northwind.example/ }).length).toBe(2)
  await user.type(within(dialog).getByRole('textbox', { name: 'Note' }), "Last week's sends.")
  await user.click(within(dialog).getByRole('button', { name: 'Schedule' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const posted = calls.find((call) => call.url.endsWith('/insights/schedules/') && call.method === 'POST')?.body as Record<string, unknown>
  expect(posted).toMatchObject({ item_id: 'rep-1', every: 'week', on_day: 1, at_time: '08:00', format: 'xlsx', recipients: ['finance@northwind.example', 'aby@northwind.example'], note: "Last week's sends." })
  const banner = await screen.findByRole('status', { name: 'Schedule' })
  expect(banner.textContent).toContain('Every Monday at 08:00 to 2 people as Excel')
  await user.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 5000 }))
  expect(screen.getByRole('menuitem', { name: 'Scheduled · Every Monday at 08:00' })).toBeTruthy()
  await user.keyboard('{Escape}')
  await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Scheduled' }))
  const table = await screen.findByRole('table', { name: 'Schedules' })
  expect(within(table).getByRole('link', { name: 'Sends by campaign' })).toBeTruthy()
  expect(within(table).getByText('2 people')).toBeTruthy()
  await user.click(within(table).getByRole('button', { name: 'Pause' }))
  await within(table).findByText('Paused')
  await user.click(within(table).getByRole('button', { name: 'Resume' }))
  await vi.waitFor(() => expect(within(table).queryByText('Paused')).toBeNull())
})
