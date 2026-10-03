import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, signIn } from '@/test/mockApi'

import { findPages, readRecent, visibleGroups } from './settingsCatalogue'

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
  vi.restoreAllMocks()
})

const menu = () => screen.getByRole('navigation', { name: 'Settings sections' })
const links = () => within(menu()).getAllByRole('link').map((link) => link.textContent)

test('the sub menus: one button per group, its pages in a dropdown, the current group and page selected, the facts beside the page, the trail above it', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')
  await screen.findByRole('table', { name: 'Sending Engines' })
  expect(menu().getAttribute('data-settings-menu')).toBe('submenus')
  for (const name of ['Workspace', 'Sending', 'Audience', 'Integrations']) expect(within(menu()).getByRole('button', { name })).toBeTruthy()
  expect(within(menu()).queryByRole('link')).toBeNull()                                                   // nothing open: no page links in the bar
  const sending = within(menu()).getByRole('button', { name: 'Sending' })
  expect(sending.className).toContain('bg-brand-100 text-brand-800')                                     // the current page's group
  expect(within(menu()).getByRole('button', { name: 'Workspace' }).className).not.toContain('bg-brand-100')
  await user.click(sending)
  const panel = within(menu()).getByRole('region', { name: 'Sending' })
  expect(within(panel).getAllByRole('link').map((link) => link.textContent)).toEqual(['Sending Engines', 'Email Server', 'Notifications'])
  const current = within(panel).getByRole('link', { name: 'Sending Engines' })
  expect(current.getAttribute('aria-current')).toBe('page')
  expect(current.className).toContain('bg-brand-100 text-brand-800')
  await user.click(within(menu()).getByRole('button', { name: 'Audience' }))                               // one sub menu at a time
  expect(within(menu()).queryByRole('region', { name: 'Sending' })).toBeNull()
  expect(within(within(menu()).getByRole('region', { name: 'Audience' })).getAllByRole('link').map((link) => link.textContent)).toEqual(['Suppressions', 'Preference Centre', 'Consent Policy'])
  await user.keyboard('{Escape}')
  expect(within(menu()).queryByRole('region', { name: 'Audience' })).toBeNull()
  expect(within(menu()).queryByRole('region', { name: 'Recent' })).toBeNull()                            // nothing visited before this page
  const trail = screen.getByRole('navigation', { name: 'Where you are' })
  expect(trail.textContent).toBe('SettingsSendingSending Engines')
  // the menu sits across the top under the heading; the workspace facts in a column beside the page
  const page = screen.getByRole('region', { name: 'Settings page' })
  expect(menu().compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const facts = await screen.findByRole('complementary', { name: 'Workspace facts' })
  expect(facts.querySelector('dl')!.className).toContain('xl:grid-cols-1')
  expect(page.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('Find a Setting narrows the menu to the matching pages, by page or group; Escape and the clear button empty it', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/users')
  await screen.findByRole('table', { name: 'Users' })
  const box = within(menu()).getByRole('searchbox', { name: 'Find a setting' })
  await user.type(box, 'send')
  expect(within(menu()).getByRole('list', { name: 'Matching settings' })).toBeTruthy()
  expect(links()).toEqual(['Sending Engines', 'Email Server', 'Notifications'])                          // the Sending group's pages, by group name
  await user.clear(box)
  await user.type(box, 'xyz')
  expect(within(menu()).getByText(/Nothing matches/)).toBeTruthy()
  await user.click(within(menu()).getByRole('button', { name: 'Clear the search' }))
  expect(within(menu()).queryByRole('list', { name: 'Matching settings' })).toBeNull()
  await user.type(box, 'roles{Escape}')
  expect((box as HTMLInputElement).value).toBe('')
})

test('Recent is a sub menu of the pages visited here, newest first, three at most; Show All opens the columns, where a group folds and stays folded', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/users')
  await screen.findByRole('table', { name: 'Users' })
  expect(within(menu()).queryByRole('button', { name: 'Recent' })).toBeNull()
  const go = async (group: string, page: string) => {
    await user.click(within(menu()).getByRole('button', { name: group }))
    await user.click(within(within(menu()).getByRole('region', { name: group })).getByRole('link', { name: page }))
  }
  await go('Workspace', 'Roles')
  await go('Workspace', 'Security')
  await go('Sending', 'Notifications')
  await user.click(within(menu()).getByRole('button', { name: 'Recent' }))
  const recent = within(menu()).getByRole('region', { name: 'Recent' })
  expect(within(recent).getAllByRole('link').map((link) => link.textContent)).toEqual(['Security', 'Roles', 'Users'])   // the pages left, newest first; the current one is not listed
  expect(readRecent()).toEqual(['/settings/notifications', '/settings/security', '/settings/roles', '/settings/users'])

  await user.click(within(menu()).getByRole('button', { name: 'Show all settings' }))
  expect(menu().getAttribute('data-settings-menu')).toBe('open')
  expect(within(menu()).getByRole('region', { name: 'Recent' })).toBeTruthy()                             // the columns: Recent first, then every group with its pages
  expect(within(menu()).getByRole('link', { name: 'Suppressions' })).toBeTruthy()
  const audience = within(menu()).getByRole('button', { name: 'Audience' })
  await user.click(audience)
  expect(audience.getAttribute('aria-expanded')).toBe('false')
  expect(within(menu()).queryByRole('link', { name: 'Suppressions' })).toBeNull()
  expect(JSON.parse(window.localStorage.getItem('cep.settings.folded')!)).toEqual(['audience'])
  expect(JSON.parse(window.localStorage.getItem('cep.settings.panel')!)).toBe(false)

  await user.click(within(menu()).getByRole('button', { name: 'Show the sub menus' }))
  expect(menu().getAttribute('data-settings-menu')).toBe('submenus')
  expect(within(menu()).getByRole('searchbox', { name: 'Find a setting' })).toBeTruthy()
})

test('pages the workspace has no feature for are left out, and an empty group with them', () => {
  const groups = visibleGroups((feature) => feature !== 'api_access' && feature !== 'ereceipt')
  expect(groups.find((group) => group.key === 'integrations')!.pages.map((page) => page.label)).toEqual(['Integrations'])
  const none = visibleGroups(() => false)
  expect(none.map((group) => group.key)).toEqual(['workspace', 'sending', 'audience', 'integrations'])
  expect(findPages(groups, 'pos')).toEqual([])
  expect(findPages(groups, 'plan usage').map((page) => page.to)).toEqual(['/settings/plan'])
})
