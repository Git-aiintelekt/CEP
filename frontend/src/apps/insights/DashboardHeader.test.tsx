/** A dashboard's header and control line (docs/mockups/dashboards.html, phase D2). */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string) {
  const calls = installMockApi({ me: withInsights as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

const tileRuns = (calls: { url: string }[]) => calls.filter((c) => /\/insights\/dashboards\/dash-1\/tiles\/[\w-]+\/run\/$/.test(c.url))

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the header: ‹ Dashboards, the name and description, Updated with Refresh, Share and Edit as buttons, the rest in ⋯', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1')
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  expect(screen.getByRole('main').querySelector('a[href="/insights/dashboards"]')?.textContent?.trim()).toBe('Dashboards')
  expect(screen.getByText('Sends, revenue and the top campaigns, by week')).toBeTruthy()
  expect(screen.getByText(/^Updated /)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()

  await vi.waitFor(() => expect(tileRuns(calls).length).toBeGreaterThan(0))
  const before = tileRuns(calls).length
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  await vi.waitFor(() => expect(tileRuns(calls).length).toBeGreaterThan(before))

  await user.click(screen.getByRole('button', { name: 'Share' }))
  expect(await screen.findByRole('dialog', { name: /Share/ })).toBeTruthy()
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  await vi.waitFor(() => expect(window.location.pathname).toBe('/insights/dashboards/dash-1/edit'))
})

test('one control line: the period chip, Compare, the slicers and View: Default', async () => {
  await renderAppAt('/insights/dashboards/dash-1')
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  const line = screen.getByRole('group', { name: 'Dashboard controls' })
  expect(within(line).getByRole('button', { name: /^30 Days · / })).toBeTruthy()
  expect(within(line).getByRole('switch', { name: 'Compare With Previous Period' }).getAttribute('aria-checked')).toBe('true')
  expect(within(within(line).getByRole('group', { name: 'Slicers' })).getByRole('button', { name: 'Channel' })).toBeTruthy()
  expect(within(line).getByRole('button', { name: 'View: Default' })).toBeTruthy()
  expect(screen.queryByRole('radio', { name: '7 Days' })).toBeNull()
})

test('the period menu: a quick choice applies at once; two days on the calendar and Apply make a custom period', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1')
  await screen.findByRole('heading', { name: 'Marketing Weekly' })
  await user.click(screen.getByRole('button', { name: /^30 Days · / }))
  await user.click(screen.getByRole('option', { name: 'This Month' }))
  expect(screen.queryByRole('listbox', { name: 'Quick Choices' })).toBeNull()
  expect(screen.getByRole('button', { name: /^This Month · / })).toBeTruthy()
  await vi.waitFor(() => expect((tileRuns(calls).at(-1) as { body?: { period: { preset: string } } }).body?.period.preset).toBe('month'))

  await user.click(screen.getByRole('button', { name: /^This Month · / }))
  const grid = screen.getByRole('grid')
  const days = within(grid).getAllByRole('gridcell').filter((cell) => !cell.className.includes('text-ink-300'))
  expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(days[2])
  expect(screen.getByText('Now pick the last day')).toBeTruthy()
  await user.click(days[9])
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  await vi.waitFor(() => {
    const period = (tileRuns(calls).at(-1) as { body?: { period: { preset: string; from?: string; to?: string } } }).body?.period
    expect(period?.preset).toBe('custom')
    expect(period?.from?.endsWith('-03')).toBe(true)
    expect(period?.to?.endsWith('-10')).toBe(true)
  })
})
