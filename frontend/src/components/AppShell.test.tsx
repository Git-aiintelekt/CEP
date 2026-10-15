/** The suite shell: the top bar (brand, launcher, account), the left navigation by component, collapsing, and the collapsed flyout. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const rail = () => screen.getByRole('complementary', { name: 'Sidebar' })
const nav = () => screen.getByRole('navigation', { name: 'Main' })
const topBar = () => screen.getByRole('banner')

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('240px: the component’s head and its menu, then Workspace Settings and Collapse at the foot; the brand sits in the white top bar', async () => {
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  expect(rail().className).toContain('w-60')
  expect(rail().className).not.toContain('border')

  // the brand: C360 and the open component's name, on the top bar, not in the navy
  expect(within(topBar()).getByText('C')).toBeTruthy()
  expect(topBar().querySelector('[data-component-name]')?.textContent).toBe('Engagement')
  expect(topBar().className).toContain('bg-surface')
  expect(within(rail()).queryByText('C360')).toBeNull()

  const menu = within(nav()).getByRole('list', { name: 'Engagement' })
  expect(within(menu).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Campaigns', 'Journeys', 'Templates', 'Contact lists', 'Reports'])
  expect(within(within(nav()).getByRole('list', { name: 'Workspace' })).getAllByRole('link').map((link) => link.textContent)).toEqual(['Workspace Settings'])
  expect(within(nav()).queryByRole('button', { name: 'All Components' })).toBeNull()               // one component: nothing to choose between

  const current = within(menu).getByRole('link', { name: 'Campaigns' })
  expect(current.getAttribute('aria-current')).toBe('page')
  expect(current.querySelector('[data-current-bar]')).toBeTruthy()
})

test('collapsing: 64px with one tile per component, labels gone at once, remembered; expanding brings the labels back after the width', async () => {
  const user = userEvent.setup()
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  const toggle = screen.getByRole('button', { name: 'Collapse navigation' })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')

  await user.click(toggle)
  expect(rail().className).toContain('w-16')
  expect(within(nav()).queryByRole('link', { name: 'Campaigns' })).toBeNull()
  const tile = within(within(nav()).getByRole('list', { name: 'Components' })).getByRole('button', { name: 'Engagement' })
  expect(tile.getAttribute('aria-current')).toBe('true')
  expect(window.localStorage.getItem('cep.nav.collapsed')).toBe('1')

  await user.click(screen.getByRole('button', { name: 'Expand navigation' }))
  expect(rail().className).toContain('w-60')
  await vi.waitFor(() => expect(within(nav()).getByRole('link', { name: 'Campaigns' }).textContent).toBe('Campaigns'))
})

test('collapsed, pointing at a component’s tile shows its menu as a flyout, with the current page marked', async () => {
  const user = userEvent.setup()
  window.localStorage.setItem('cep.nav.collapsed', '1')
  installMockApi()
  await renderAppAt('/templates')
  await screen.findByRole('navigation', { name: 'Main' })
  await user.hover(within(nav()).getByRole('button', { name: 'Engagement' }))
  const flyout = await screen.findByRole('region', { name: 'Engagement menu' })
  expect(within(flyout).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Campaigns', 'Journeys', 'Templates', 'Contact lists', 'Reports'])
  expect(within(flyout).getByRole('link', { name: 'Templates' }).getAttribute('aria-current')).toBe('page')
  await user.keyboard('{Escape}')
  await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Engagement menu' })).toBeNull())
})

test('the launcher lists the workspace’s components as tiles, marks the open one, and names what is coming', async () => {
  const user = userEvent.setup()
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  await user.click(within(topBar()).getByRole('button', { name: 'Apps' }))
  const apps = await screen.findByRole('region', { name: 'Apps' })
  const tiles = within(within(apps).getByRole('list', { name: 'Your apps' })).getAllByRole('link')
  expect(tiles.map((tile) => tile.textContent)).toEqual(['Engagement'])
  expect(tiles[0].getAttribute('aria-current')).toBe('true')
  expect(apps.textContent).toContain('Insights, CRM, Sales, Purchasing, Inventory and PIM are coming.')
})

test('with several components the navigation lists them first, and choosing one drills into its menu', async () => {
  const user = userEvent.setup()
  installMockApi({ me: { ...me, components: [...me.components, { key: 'cep', name: 'Engagement', tagline: 'Customer Engagement', access: 'TRIAL', until: '2026-10-31' }] } as never })
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  // the menu is open on the current component; All Components goes up a level
  await user.click(within(nav()).getByRole('button', { name: 'All Components' }))
  const list = within(nav()).getByRole('list', { name: 'Components' })
  expect(within(nav()).getByText('Northwind Apparel')).toBeTruthy()
  expect(within(nav()).getByText('Growth plan')).toBeTruthy()
  expect(within(list).getAllByRole('button').length).toBe(2)
  await user.click(within(list).getAllByRole('button')[0])
  expect(within(nav()).getByRole('list', { name: 'Engagement' })).toBeTruthy()
})

test('a component the workspace does not have is not offered anywhere', async () => {
  installMockApi({ me: { ...me, components: [{ key: 'crm', name: 'CRM', tagline: 'Accounts', access: 'PLAN', until: null }] } as never })
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  expect(within(nav()).queryByRole('list', { name: 'Engagement' })).toBeNull()
  expect(topBar().querySelector('[data-component-name]')).toBeNull()
})

test('without user.admin there is no Workspace Settings', async () => {
  installMockApi({ me: { ...me, principal: { ...me.principal, permissions: ['campaign.view'] } } as never })
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  expect(within(nav()).queryByRole('list', { name: 'Workspace' })).toBeNull()
})
