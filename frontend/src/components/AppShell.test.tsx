/** The suite shell: the navy top bar (toggle, brand, launcher, account), the app rail, the component's menu beside it, and collapsing. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

const rail = () => screen.getByRole('complementary', { name: 'Sidebar' })
const nav = () => screen.getByRole('navigation', { name: 'Main' })
const apps = () => screen.getByRole('navigation', { name: 'Apps' })
const topBar = () => screen.getByRole('banner')

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the app rail with Workspace Settings at its foot, the component’s menu beside it, and the brand and toggle in the navy top bar', async () => {
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })

  expect(within(topBar()).getByText('C')).toBeTruthy()
  expect(topBar().querySelector('[data-component-name]')?.textContent).toBe('Engagement')
  expect(topBar().className).toContain('bg-sidebar')
  expect(within(rail()).queryByText('C360')).toBeNull()
  expect(within(topBar()).getByRole('button', { name: 'Collapse navigation' })).toBeTruthy()
  expect(within(rail()).queryByRole('button', { name: /navigation/ })).toBeNull()

  const tiles = within(within(apps()).getByRole('list', { name: 'Components' })).getAllByRole('link')
  expect(tiles.map((tile) => tile.textContent)).toEqual(['Engagement'])
  expect(tiles[0].getAttribute('aria-current')).toBe('true')
  expect(tiles[0].querySelector('[data-current-bar]')).toBeNull()                                   // the fill alone marks it
  expect(within(within(apps()).getByRole('list', { name: 'Workspace' })).getByRole('link', { name: 'Settings' })).toBeTruthy()

  const menu = within(nav()).getByRole('list', { name: 'Engagement' })
  expect(within(menu).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Campaigns', 'Journeys', 'Templates', 'Contact lists', 'Reports'])
  const current = within(menu).getByRole('link', { name: 'Campaigns' })
  expect(current.getAttribute('aria-current')).toBe('page')
  expect(current.className).toContain('bg-brand-100')
  expect(nav().parentElement?.className).toContain('bg-surface')
})

test('collapsing turns the menu into a 64px column of icons, keeps the rail, and is remembered; expanding brings the labels back', async () => {
  const user = userEvent.setup()
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  const toggle = within(topBar()).getByRole('button', { name: 'Collapse navigation' })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')

  await user.click(toggle)
  expect(nav().parentElement?.className).toContain('w-16')
  const campaigns = within(nav()).getByRole('link', { name: 'Campaigns' })
  expect(campaigns.textContent).toBe('')                                                        // icon only, the label is a tooltip
  expect(campaigns.getAttribute('aria-current')).toBe('page')
  expect(campaigns.className).toContain('bg-brand-100')
  expect(within(nav()).queryByText('Customer Engagement')).toBeNull()
  expect(within(apps()).getByRole('link', { name: 'Engagement' })).toBeTruthy()
  expect(window.localStorage.getItem('cep.nav.collapsed')).toBe('1')

  const expand = within(topBar()).getByRole('button', { name: 'Expand navigation' })
  expect(expand.getAttribute('aria-expanded')).toBe('false')
  await user.click(expand)
  expect(nav().parentElement?.className).toContain('w-60')
  expect(within(nav()).getByRole('link', { name: 'Campaigns' }).textContent).toBe('Campaigns')
  expect(window.localStorage.getItem('cep.nav.collapsed')).toBe('0')
})

test('on a phone the top bar’s menu button opens the rail and the menu over the page and closes them again', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('button', { name: 'Open navigation' })
  expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull()

  await user.click(within(topBar()).getByRole('button', { name: 'Open navigation' }))
  expect(within(apps()).getByRole('link', { name: 'Engagement' })).toBeTruthy()
  expect(within(nav()).getByRole('link', { name: 'Campaigns' })).toBeTruthy()
  const close = within(topBar()).getByRole('button', { name: 'Close navigation' })
  expect(close.getAttribute('aria-expanded')).toBe('true')

  await user.click(close)
  expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull()
})

test('the launcher lists the workspace’s components as tiles, marks the open one, and names what is coming', async () => {
  const user = userEvent.setup()
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  await user.click(within(topBar()).getByRole('button', { name: 'Apps' }))
  const launcher = await screen.findByRole('region', { name: 'Apps' })
  const tiles = within(within(launcher).getByRole('list', { name: 'Your apps' })).getAllByRole('link')
  expect(tiles.map((tile) => tile.textContent)).toEqual(['Engagement'])
  expect(tiles[0].getAttribute('aria-current')).toBe('true')
  expect(launcher.textContent).toContain('CRM, Sales, Purchasing, Inventory and PIM are coming.')
})

test('with several components the rail has a tile for each, a trial is marked, and a tile opens that component’s Home', async () => {
  installMockApi({ me: { ...me, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'TRIAL', until: '2026-10-31' }] } as never })
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  const list = within(apps()).getByRole('list', { name: 'Components' })
  const [engagement, insights] = within(list).getAllByRole('link')
  expect(engagement.getAttribute('aria-current')).toBe('true')
  expect(engagement.getAttribute('href')).toBe('/')
  expect(insights.textContent).toBe('InsightsTrial')
  expect(insights.getAttribute('aria-current')).toBeNull()
  expect(insights.getAttribute('href')).toBe('/insights')
})

test('the account menu names the workspace and its plan', async () => {
  const user = userEvent.setup()
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  await user.click(within(topBar()).getByRole('button', { name: /^Account/ }))
  const workspace = document.querySelector('[data-workspace]')
  expect(workspace?.textContent).toBe('Northwind Apparel · Growth plan')
})

test('a component the workspace does not have is not offered anywhere', async () => {
  installMockApi({ me: { ...me, components: [{ key: 'crm', name: 'CRM', tagline: 'Accounts', access: 'PLAN', until: null }] } as never })
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Apps' })
  expect(within(apps()).queryAllByRole('link', { name: /CRM|Engagement/ })).toEqual([])
  expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  expect(topBar().querySelector('[data-component-name]')).toBeNull()
})

test('without user.admin there is no Workspace Settings', async () => {
  installMockApi({ me: { ...me, principal: { ...me.principal, permissions: ['campaign.view'] } } as never })
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  expect(within(apps()).queryByRole('list', { name: 'Workspace' })).toBeNull()
})

test('/cep/... is Engagement’s alias: it lands on the same page, query and all', async () => {
  installMockApi()
  await renderAppAt('/cep/campaigns?status=DRAFT')
  await screen.findByRole('navigation', { name: 'Main' })
  await vi.waitFor(() => expect(window.location.pathname + window.location.search).toBe('/campaigns?status=DRAFT'))
  await vi.waitFor(() => expect(within(nav()).getByRole('link', { name: 'Campaigns' }).getAttribute('aria-current')).toBe('page'))
})
