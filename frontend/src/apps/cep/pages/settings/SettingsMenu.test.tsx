import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

import { findPages, readRecent, visibleGroups } from './settingsCatalogue'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const INSIGHTS = { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }
const both = { ...me, components: [...me.components, INSIGHTS] }
const insightsAlone = { ...me, components: [INSIGHTS] }

const menu = () => screen.getByRole('navigation', { name: 'Settings sections' })
const links = () => within(menu()).getAllByRole('link').map((link) => link.textContent)

test('the menu: General, then a group per component the workspace has, with its pages; the current page selected, the trail above the page', async () => {
  installMockApi({ me: both as never })
  await renderAppAt('/settings/delivery')
  await screen.findByRole('table', { name: 'Sending Engines' })
  expect(within(menu()).getAllByRole('button', { name: /^(General|Engagement|Insights)$/ }).map((button) => button.textContent)).toEqual(['General', 'Engagement', 'Insights'])
  expect(within(menu()).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual(['Sending', 'Audience', 'Connections'])
  expect(links()).toEqual(['Set-Up', 'Users', 'Roles', 'Security', 'AI Assistant', 'API Keys', 'Plan & Usage',
    'Sending Engines', 'Email Server', 'UTM Tracking', 'Approvals', 'Tags', 'Notifications', 'Suppressions', 'Preference Centre', 'Consent Policy', 'Integrations', 'POS Receipts', 'Attribution', 'Events',
    'Report Databases', 'Report Access', 'Fiscal Year'])
  expect(within(menu()).queryByRole('region', { name: 'Recent' })).toBeNull()                            // nothing visited before this page
  const current = within(menu()).getAllByRole('link', { name: 'Sending Engines' }).at(-1)!
  expect(current.getAttribute('aria-current')).toBe('page')
  expect(current.className).toContain('bg-brand-100 text-brand-800')
  const trail = screen.getByRole('navigation', { name: 'Where you are' })
  expect(trail.textContent).toBe('SettingsEngagementSending Engines')
})

test('Find a Setting narrows the menu to the matching pages, by page or group; Escape and the clear button empty it', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/users')
  await screen.findByRole('table', { name: 'Users' })
  const box = within(menu()).getByRole('searchbox', { name: 'Find a setting' })
  await user.type(box, 'send')
  expect(within(menu()).getByRole('list', { name: 'Matching settings' })).toBeTruthy()
  expect(links()).toEqual(['Sending Engines', 'Email Server', 'UTM Tracking', 'Approvals', 'Tags', 'Notifications'])     // the pages under Sending, by heading
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

  const engagement = within(menu()).getByRole('button', { name: 'Engagement' })
  await user.click(engagement)
  expect(engagement.getAttribute('aria-expanded')).toBe('false')
  expect(within(menu()).queryByRole('link', { name: 'Suppressions' })).toBeNull()
  expect(JSON.parse(window.localStorage.getItem('cep.settings.folded')!)).toEqual(['engagement'])
  await user.click(engagement)

  await user.click(within(menu()).getByRole('button', { name: 'Collapse the settings menu' }))
  expect(menu().getAttribute('data-settings-menu')).toBe('folded')
  expect(within(menu()).queryByRole('searchbox')).toBeNull()
  expect(within(menu()).getByRole('link', { name: 'Suppressions' })).toBeTruthy()                        // folded: every page as an icon, groups never fold
  await user.click(within(menu()).getByRole('button', { name: 'Expand the settings menu' }))
  expect(within(menu()).getByRole('searchbox', { name: 'Find a setting' })).toBeTruthy()
})

test('pages the workspace has no feature for are left out; the group of a component shows only when the workspace has the component', () => {
  const groups = visibleGroups((feature) => feature !== 'api_access' && feature !== 'ereceipt')
  expect(groups.find((group) => group.key === 'engagement')!.pages.filter((page) => page.section === 'Connections').map((page) => page.label)).toEqual(['Integrations', 'Attribution', 'Events'])
  expect(groups.find((group) => group.key === 'general')!.pages.map((page) => page.label)).not.toContain('API Keys')
  const none = visibleGroups(() => false)
  expect(none.map((group) => group.key)).toEqual(['general', 'engagement', 'insights'])
  expect(visibleGroups(() => true, ['insights']).map((group) => group.key)).toEqual(['general', 'insights'])
  expect(visibleGroups(() => true, ['cep']).map((group) => group.key)).toEqual(['general', 'engagement'])
  expect(findPages(groups, 'pos')).toEqual([])
  expect(findPages(groups, 'plan usage').map((page) => page.to)).toEqual(['/settings/plan'])
})

test('a workspace with Insights alone sees General and Insights, and an Engagement page says it is not there', async () => {
  installMockApi({ me: insightsAlone as never })
  await renderAppAt('/settings/users')
  await screen.findByRole('table', { name: 'Users' })
  expect(within(menu()).getAllByRole('button', { name: /^(General|Engagement|Insights)$/ }).map((button) => button.textContent)).toEqual(['General', 'Insights'])
  expect(within(menu()).queryByRole('link', { name: 'Sending Engines' })).toBeNull()
  expect(within(menu()).getByRole('link', { name: 'Report Databases' })).toBeTruthy()
  cleanup()
  await renderAppAt('/settings/delivery')
  expect(await screen.findByText('This workspace does not have Engagement')).toBeTruthy()
  expect(screen.queryByRole('table', { name: 'Sending Engines' })).toBeNull()
})
