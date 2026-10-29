/** Insights → Dashboards, laid out like Journeys (docs/mockups/dashboards.html, phase D1): the templates panel and its preview, Your Dashboards, its filters, views and row menu. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsDashboard, insightsDashboardsNow, installMockApi, me, signIn } from '@/test/mockApi'

const insights = { components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }
const editor = { ...me, ...insights, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit'] } }
const viewer = { ...me, ...insights, principal: { ...me.principal, permissions: me.principal.permissions.filter((p) => !p.startsWith('report.')) } }

async function renderAppAt(path: string, who: object = editor) {
  const calls = installMockApi({ me: who as never })
  insightsDashboardsNow.push({ ...structuredClone(insightsDashboard), id: 'dash-sms', name: 'SMS Weekly', description: 'Texts sent, delivered and replies', visibility: 'PRIVATE', owner_user_id: 'u9', owner_name: 'Sam Lee', can_edit: false })
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

test('the templates panel comes first: Start from Scratch, then the packs\' dashboards; Your Dashboards follows with its count', async () => {
  await renderAppAt('/insights/dashboards')
  const panel = await screen.findByRole('region', { name: 'Dashboard Templates' })
  const cards = within(panel).getByRole('list', { name: 'Start a Dashboard' })
  await vi.waitFor(() => expect(within(cards).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.slice(0, 18))).toEqual(['Start from Scratch', 'Management Dashboard', 'Campaign Performance']))
  expect(within(panel).queryByRole('button', { name: /View More/ })).toBeNull()
  expect(within(panel).getAllByText('From Email Campaign Reports')).toHaveLength(2)
  const yours = screen.getByRole('region', { name: /Your Dashboards/ })
  expect(within(yours).getByRole('heading').textContent).toBe('Your Dashboards2')
  expect(screen.getByRole('button', { name: 'Create Dashboard' })).toBeTruthy()
  expect(screen.queryByText('Pages of your reports, on one period.')).toBeNull()
})

test('a template opens its preview; Use This Template opens Add Base Reports on its pack', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards')
  await user.click(await screen.findByRole('button', { name: 'Management Dashboard' }))
  const preview = await screen.findByRole('dialog', { name: 'Management Dashboard' })
  expect(within(within(preview).getByRole('region', { name: 'Reports' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['Campaign KPIs', 'Link Clicks'])
  await user.click(within(preview).getByRole('button', { name: 'Use This Template' }))
  expect(screen.queryByRole('dialog', { name: 'Management Dashboard' })).toBeNull()
  expect(await screen.findByRole('dialog', { name: /Base Reports/ })).toBeTruthy()
})

test('someone who cannot make dashboards sees no templates and no Create Dashboard', async () => {
  await renderAppAt('/insights/dashboards', viewer)
  await screen.findByRole('table', { name: 'Dashboards' })
  expect(screen.queryByRole('region', { name: 'Dashboard Templates' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Create Dashboard' })).toBeNull()
})

test('search, Owner, Shared and Favourites narrow the list, live in the address, and Clear Filters undoes them', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards')
  const table = await screen.findByRole('table', { name: 'Dashboards' })
  const names = () => within(screen.getByRole('table', { name: 'Dashboards' })).getAllByRole('link').map((l) => l.textContent)
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Favourite', 'Dashboard', 'Tiles', 'Owner', 'Shared', 'Changed', 'Actions'])
  expect(names()).toEqual(['Marketing Weekly', 'SMS Weekly'])

  await user.type(screen.getByRole('searchbox', { name: 'Search dashboards' }), 'texts')
  expect(names()).toEqual(['SMS Weekly'])
  await user.clear(screen.getByRole('searchbox', { name: 'Search dashboards' }))

  await user.click(screen.getByRole('button', { name: /^Shared/ }))
  await user.click(screen.getByRole('option', { name: 'Workspace' }))
  expect(window.location.search).toContain('shared=workspace')
  expect(names()).toEqual(['Marketing Weekly'])

  await user.click(screen.getByRole('button', { name: 'Clear Filters' }))
  await user.click(screen.getByRole('button', { name: 'Favourites' }))
  expect(window.location.search).toContain('fav=1')
  expect(await screen.findByText('No Dashboards Match These Filters')).toBeTruthy()
  await user.click(screen.getAllByRole('button', { name: 'Clear Filters' })[0])
  expect(names()).toEqual(['Marketing Weekly', 'SMS Weekly'])
  expect(window.location.search).toBe('')
})

test('the grid view shows a card per dashboard, and the choice is remembered', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards')
  await screen.findByRole('table', { name: 'Dashboards' })
  await user.click(screen.getByRole('radio', { name: 'Grid View' }))
  const grid = screen.getByRole('list', { name: 'Dashboards' })
  expect(within(grid).getAllByRole('listitem')).toHaveLength(2)
  expect(within(grid).getAllByText(/^Changed /)).toHaveLength(2)
  expect(window.localStorage.getItem('insights.dashboards.view')).toBe('grid')
})

test('a row\'s ⋯ offers only what this person may do; Duplicate makes a private copy with the same tiles', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards')
  await screen.findByRole('table', { name: 'Dashboards' })
  await user.click(screen.getByRole('button', { name: 'Actions for SMS Weekly' }))
  expect(within(screen.getByRole('menu', { name: 'Actions for SMS Weekly' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Open', 'Duplicate', 'Add to Favourites'])
  await user.keyboard('{Escape}')

  await user.click(screen.getByRole('button', { name: 'Actions for Marketing Weekly' }))
  const menu = screen.getByRole('menu', { name: 'Actions for Marketing Weekly' })
  expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Open', 'Edit', 'Duplicate', 'Share…', 'Add to Favourites', 'Delete…'])
  await user.click(within(menu).getByRole('menuitem', { name: 'Duplicate' }))
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Dashboards' })).getByRole('link', { name: 'Copy of Marketing Weekly' })).toBeTruthy())
  const put = calls.filter((c) => c.method === 'PUT' && /\/insights\/dashboards\/dash-\d+\/$/.test(c.url)).at(-1)?.body as { layout: { rows: unknown[] } } | undefined
  expect(put?.layout.rows).toEqual(insightsDashboard.layout.rows)
})

test('Add to Favourites from the ⋯ stars the dashboard', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards')
  await screen.findByRole('table', { name: 'Dashboards' })
  await user.click(screen.getByRole('button', { name: 'Actions for SMS Weekly' }))
  await user.click(screen.getByRole('menuitem', { name: 'Add to Favourites' }))
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Remove SMS Weekly from favourites' }).getAttribute('aria-pressed')).toBe('true'))
})
