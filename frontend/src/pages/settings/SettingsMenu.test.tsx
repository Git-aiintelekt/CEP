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

test('the menu: every group with its pages, the current page selected, the trail above the page', async () => {
  installMockApi()
  await renderAppAt('/settings/delivery')
  await screen.findByRole('table', { name: 'Sending Engines' })
  for (const name of ['Workspace', 'Sending', 'Audience', 'Integrations']) expect(within(menu()).getByRole('button', { name })).toBeTruthy()
  expect(links()).toEqual(['Set-Up', 'Users', 'Roles', 'Tags', 'Security', 'Approvals', 'Plan & Usage', 'Sending Engines', 'Email Server', 'Notifications', 'Suppressions', 'Preference Centre', 'Consent Policy', 'Integrations', 'API Keys', 'POS Receipts'])
  expect(within(menu()).queryByRole('region', { name: 'Recent' })).toBeNull()                            // nothing visited before this page
  const current = within(menu()).getAllByRole('link', { name: 'Sending Engines' }).at(-1)!
  expect(current.getAttribute('aria-current')).toBe('page')
  expect(current.className).toContain('bg-brand-100 text-brand-800')
  const trail = screen.getByRole('navigation', { name: 'Where you are' })
  expect(trail.textContent).toBe('SettingsSendingSending Engines')
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

test('Recent lists the pages visited here, newest first, three at most; a group folds and stays folded; the panel folds to icons', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/users')
  await screen.findByRole('table', { name: 'Users' })
  await user.click(within(menu()).getAllByRole('link', { name: 'Roles' }).at(-1)!)
  await user.click(within(menu()).getAllByRole('link', { name: 'Security' }).at(-1)!)
  await user.click(within(menu()).getAllByRole('link', { name: 'Notifications' }).at(-1)!)
  const recent = within(menu()).getByRole('region', { name: 'Recent' })
  expect(within(recent).getAllByRole('link').map((link) => link.textContent)).toEqual(['Security', 'Roles', 'Users'])   // the pages left, newest first; the current one is not listed
  expect(readRecent()).toEqual(['/settings/notifications', '/settings/security', '/settings/roles', '/settings/users'])

  const audience = within(menu()).getByRole('button', { name: 'Audience' })
  await user.click(audience)
  expect(audience.getAttribute('aria-expanded')).toBe('false')
  expect(within(menu()).queryByRole('link', { name: 'Suppressions' })).toBeNull()
  expect(JSON.parse(window.localStorage.getItem('cep.settings.folded')!)).toEqual(['audience'])

  await user.click(within(menu()).getByRole('button', { name: 'Collapse the settings menu' }))
  expect(menu().getAttribute('data-settings-menu')).toBe('folded')
  expect(within(menu()).queryByRole('searchbox')).toBeNull()
  expect(within(menu()).getByRole('link', { name: 'Suppressions' })).toBeTruthy()                        // folded: every page as an icon, groups never fold
  await user.click(within(menu()).getByRole('button', { name: 'Expand the settings menu' }))
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
